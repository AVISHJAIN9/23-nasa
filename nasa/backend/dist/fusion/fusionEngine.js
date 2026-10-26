import { KeyedQueue } from './keyedQueue.js';
import { ruleAlertAdapter } from './inputs.js';
import { applyMemberEvent, isSuppressedByDismissal } from './fusionCore.js';
import { logger } from '../core/logger.js';
import { reconcileStartupAlerts } from './reconcile.js';
export class FusionEngine {
    repository;
    inboxPublisher;
    clock;
    options;
    alertPublisher;
    keyedQueue = new KeyedQueue();
    unsubscribeAlertPublisher = null;
    isRunning = false;
    lastReconcileAt = null;
    constructor(repository, inboxPublisher, clock, options, alertPublisher) {
        this.repository = repository;
        this.inboxPublisher = inboxPublisher;
        this.clock = clock;
        this.options = options;
        this.alertPublisher = alertPublisher;
    }
    /**
     * Starts the fusion engine: subscribes to rule alerts and runs startup reconciliation if configured.
     */
    async start() {
        if (!this.options.enabled) {
            logger.info('FusionEngine is disabled by ASTRO_FUSION_ENABLED=false');
            return;
        }
        if (this.isRunning)
            return;
        this.isRunning = true;
        // Subscribe to in-process 2b AlertPublisher
        if (this.alertPublisher) {
            this.unsubscribeAlertPublisher = this.alertPublisher.subscribe((event) => {
                try {
                    const input = ruleAlertAdapter(event);
                    // Never throw out of subscriber: enqueue asynchronously
                    this.processInput(input).catch((err) => {
                        logger.error({ err, ref_id: input.ref_id, group_key: `${input.crew_id}:${input.hazard}` }, 'Failed to process rule alert in FusionEngine subscriber');
                    });
                }
                catch (err) {
                    logger.error({ err, alertId: event.alert?.id }, 'Failed to adapt rule alert in FusionEngine subscriber');
                }
            });
        }
        // Startup reconciliation
        if (this.options.reconcileOnStart) {
            try {
                await reconcileStartupAlerts(this);
                this.lastReconcileAt = this.clock.nowIso();
            }
            catch (err) {
                logger.error({ err }, 'Error during startup reconciliation in FusionEngine.start()');
            }
        }
    }
    /**
     * Stops the fusion engine and unsubscribes from alerts.
     */
    stop() {
        if (this.unsubscribeAlertPublisher) {
            this.unsubscribeAlertPublisher();
            this.unsubscribeAlertPublisher = null;
        }
        this.isRunning = false;
    }
    /**
     * Processes an incoming FusionInput (from rule alert or external ML intake).
     * Serialized per group_key using KeyedQueue.
     */
    async processInput(input) {
        if (!this.options.enabled) {
            return null;
        }
        const groupKey = `${input.crew_id}:${input.hazard}`;
        const startMs = this.clock.nowMs();
        return await this.keyedQueue.enqueue(groupKey, async () => {
            // 1. Fetch current unresolved alert (or dismissed alert for suppression lookup)
            let existing = await this.repository.findUnresolvedByGroupKey(groupKey);
            if (!existing) {
                // If no unresolved alert, check if suppressed by a recently dismissed alert
                const latestDismissed = await this.repository.findLatestDismissedByGroupKey(groupKey);
                if (latestDismissed &&
                    isSuppressedByDismissal(latestDismissed.toObject(), input, this.clock.nowIso())) {
                    await this.repository.incrementSuppressedCount(latestDismissed._id.toString());
                    logger.debug({ groupKey, ref_id: input.ref_id }, 'Input event suppressed by active dismissal window');
                    return null;
                }
                // A cleared input with no existing unresolved alert is a no-op
                if (input.status === 'cleared') {
                    return null;
                }
            }
            // 2. Call pure core logic
            const coreResult = applyMemberEvent(existing ? existing.toObject() : null, input, {
                minConfidence: this.options.minConfidence,
                maxMembers: this.options.maxMembers,
                timelineMax: this.options.timelineMax,
            });
            const latencyMs = Math.max(0, this.clock.nowMs() - startMs);
            let saved;
            // 3. Persist atomically
            if (!existing) {
                try {
                    saved = await this.repository.saveNewAlert(coreResult.state, latencyMs);
                }
                catch (err) {
                    // If race condition duplicate key error (code 11000): retry as attach!
                    const isDupKey = typeof err === 'object' &&
                        err !== null &&
                        'code' in err &&
                        err.code === 11000;
                    if (isDupKey) {
                        existing = await this.repository.findUnresolvedByGroupKey(groupKey);
                        if (!existing) {
                            throw err;
                        }
                        const retryCoreResult = applyMemberEvent(existing.toObject(), input, {
                            minConfidence: this.options.minConfidence,
                            maxMembers: this.options.maxMembers,
                            timelineMax: this.options.timelineMax,
                        });
                        saved = await this.repository.atomicUpdateAlert(existing._id.toString(), retryCoreResult.state, existing.version, latencyMs);
                    }
                    else {
                        throw err;
                    }
                }
            }
            else {
                saved = await this.repository.atomicUpdateAlert(existing._id.toString(), coreResult.state, existing.version, latencyMs);
            }
            // 4. Update coalescing & bus publication
            if (coreResult.eventType) {
                const lastPubMs = saved.last_published_at ? new Date(saved.last_published_at).getTime() : 0;
                const coalesceWindowPassed = this.clock.nowMs() - lastPubMs >= this.options.updateCoalesceS * 1000;
                if (coreResult.significantChange || coalesceWindowPassed) {
                    await this.inboxPublisher.publishInboxEvent(coreResult.eventType, saved);
                    await this.repository.updateLastPublished(saved._id.toString(), this.clock.nowIso());
                }
            }
            return saved;
        });
    }
    /**
     * Health / Readiness check data for "fusion_engine".
     */
    async getReadiness() {
        const unresolvedCount = await this.repository.countUnresolved();
        const unackedCritical = await this.repository.countUnacknowledgedCritical();
        const queueDepth = this.keyedQueue.getDepth();
        return {
            running: this.isRunning,
            unresolved_count: unresolvedCount,
            unacked_critical: unackedCritical,
            queue_depth: queueDepth,
            last_reconcile_at: this.lastReconcileAt,
        };
    }
}
