import { Alert } from '../models/Alert.js';
import { FusedAlert } from '../models/FusedAlert.js';
import { ruleAlertAdapter } from './inputs.js';
import { logger } from '../core/logger.js';
/**
 * Startup reconciliation: synchronizes existing raw threshold alerts with the fused alert collection.
 * (a) Fuses any active raw alert that is not already an active member of an unresolved fused alert.
 * (b) Clears any fused member whose underlying raw alert is now cleared in the database.
 * Bounded and idempotent.
 */
export async function reconcileStartupAlerts(fusionEngine, batchLimit = 1000) {
    const startTime = Date.now();
    let activeRuleAlertsProcessed = 0;
    let membersCleared = 0;
    try {
        // (a) Find active raw rule alerts
        const activeRawAlerts = await Alert.find({ status: 'active' }).limit(batchLimit).lean();
        for (const raw of activeRawAlerts) {
            const alertDto = {
                id: raw._id.toString(),
                crew_id: raw.crew_id,
                metric: raw.metric,
                value: raw.value,
                threshold_value: raw.threshold_value,
                direction: raw.direction,
                severity: raw.severity,
                status: raw.status,
                message: raw.message,
                raised_at: raw.raised_at,
                cleared_at: raw.cleared_at,
                mission_mode: raw.mission_mode,
                mission_day: raw.mission_day,
                request_id: raw.request_id,
            };
            const input = ruleAlertAdapter({ type: 'alert.raised', alert: alertDto });
            const groupKey = `${input.crew_id}:${input.hazard}`;
            // Check if already an active member of an unresolved fused alert
            const existing = await FusedAlert.findOne({
                group_key: groupKey,
                is_unresolved: true,
            }).lean();
            const isAlreadyActiveMember = existing?.members.some((m) => m.source === 'rule' && m.ref_id === input.ref_id && m.status === 'active');
            if (!isAlreadyActiveMember) {
                await fusionEngine.processInput(input);
                activeRuleAlertsProcessed += 1;
            }
        }
        // (b) Find unresolved fused alerts with active rule members
        const unresolvedFused = await FusedAlert.find({ is_unresolved: true }).limit(batchLimit).lean();
        const ruleRefIds = [];
        for (const fused of unresolvedFused) {
            for (const member of fused.members) {
                if (member.source === 'rule' && member.status === 'active') {
                    ruleRefIds.push(member.ref_id);
                }
            }
        }
        if (ruleRefIds.length > 0) {
            const clearedRawAlerts = await Alert.find({
                _id: { $in: ruleRefIds },
                status: 'cleared',
            }).lean();
            for (const clearedRaw of clearedRawAlerts) {
                const alertDto = {
                    id: clearedRaw._id.toString(),
                    crew_id: clearedRaw.crew_id,
                    metric: clearedRaw.metric,
                    value: clearedRaw.value,
                    severity: clearedRaw.severity,
                    status: 'cleared',
                    message: clearedRaw.message,
                    raised_at: clearedRaw.raised_at,
                    cleared_at: clearedRaw.cleared_at ?? new Date().toISOString(),
                    mission_mode: clearedRaw.mission_mode,
                    mission_day: clearedRaw.mission_day,
                };
                const clearedInput = ruleAlertAdapter({
                    type: 'alert.cleared',
                    alert: alertDto,
                });
                await fusionEngine.processInput(clearedInput);
                membersCleared += 1;
            }
        }
    }
    catch (err) {
        logger.error({ err }, 'Error during startup alert reconciliation');
    }
    const durationMs = Date.now() - startTime;
    return {
        activeRuleAlertsProcessed,
        membersCleared,
        durationMs,
    };
}
