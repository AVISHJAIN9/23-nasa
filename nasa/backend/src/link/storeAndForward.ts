/**
 * @module storeAndForward
 * Delay-Tolerant Network (DTN) Store-and-Forward Queue Service (Phase 4).
 *
 * Provides:
 * - Monotonic message ordering per direction
 * - Idempotency deduplication by key
 * - Comms delay and blackout holding
 * - Conflict-safe synchronization on comms reconnection (onboard_wins / ground_wins / merged)
 */

import { randomUUID } from 'node:crypto';
import { type Clock } from '../core/clock.js';
import { type EventBus } from '../bus/eventBus.js';
import { logger } from '../core/logger.js';
import {
  DtnMessage,
  type IDtnMessage,
  type DtnDirection,
  type DtnMessageStatus,
  type ConflictPolicy,
} from '../models/DtnMessage.js';
import { type CommsDelayEmulator } from './commsDelayEmulator.js';

export interface EnqueueMessageParams {
  message_id?: string;
  direction: DtnDirection;
  sender_id: string;
  sender_role: string;
  type: string;
  target_id?: string | null;
  payload: Record<string, unknown>;
  idempotency_key: string;
}

export interface DtnMessageItem {
  message_id: string;
  direction: DtnDirection;
  sender_id: string;
  sender_role: string;
  type: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  sequence_number: number;
  idempotency_key: string;
  status: DtnMessageStatus;
  created_at: string;
  release_at: string | null;
  delivered_at: string | null;
  conflict_resolution?: {
    resolved: boolean;
    policy: ConflictPolicy;
    winner_message_id?: string | null;
    details: string;
    reconciled_at: string;
    reconciled_by?: string | null;
  } | null;
}

export interface SyncResult {
  ok: boolean;
  link_state: {
    in_blackout: boolean;
    effective_delay_ms: number;
  };
  synced_count: number;
  delivered_count: number;
  conflicts_count: number;
  messages: DtnMessageItem[];
}

export interface StoreAndForwardDeps {
  clock: Clock;
  emulator: CommsDelayEmulator;
  eventBus?: EventBus;
}

export class StoreAndForwardQueue {
  constructor(private readonly deps: StoreAndForwardDeps) {}

  /**
   * Enqueues a message into the store-and-forward queue with deduplication,
   * monotonic sequence numbering, and delay computation.
   */
  public async enqueue(params: EnqueueMessageParams): Promise<DtnMessageItem> {
    // 1. Deduplication by idempotency key
    const existing = await DtnMessage.findOne({
      idempotency_key: params.idempotency_key,
    });
    if (existing) {
      logger.debug(
        { idempotency_key: params.idempotency_key, message_id: existing.message_id },
        '[DTN] Idempotent deduplication hit',
      );
      return this.toItem(existing);
    }

    const nowMs = this.deps.clock.nowMs();
    const messageId = params.message_id ?? randomUUID();

    // 2. Monotonic sequence numbering per direction
    const count = await DtnMessage.countDocuments({ direction: params.direction });
    const sequenceNumber = count + 1;

    // 3. Evaluate delivery against current link emulator state
    const decision = this.deps.emulator.delivery(nowMs, { blackoutPolicy: 'hold' });

    let status: DtnMessageStatus = 'queued';
    let releaseAt: Date | null = null;
    let deliveredAt: Date | null = null;

    if (decision.dropped) {
      status = 'dropped';
    } else if (decision.heldByBlackout) {
      status = 'queued';
    } else if (decision.deliverability === 'now') {
      status = 'delivered';
      releaseAt = new Date(nowMs);
      deliveredAt = new Date(nowMs);
    } else {
      status = 'in_flight';
      const releaseEpoch = decision.releaseAt ?? nowMs + decision.delayAppliedMs;
      releaseAt = new Date(releaseEpoch);
    }

    const created = await DtnMessage.create({
      message_id: messageId,
      direction: params.direction,
      sender_id: params.sender_id,
      sender_role: params.sender_role,
      type: params.type,
      target_id: params.target_id ?? null,
      payload: params.payload,
      sequence_number: sequenceNumber,
      idempotency_key: params.idempotency_key,
      status,
      created_at: new Date(nowMs),
      release_at: releaseAt,
      delivered_at: deliveredAt,
      conflict_resolution: null,
    });

    const item = this.toItem(created);

    // Publish event if bus is available
    if (this.deps.eventBus) {
      this.deps.eventBus.publish({
        topic: 'system.notice',
        subtopic: 'dtn.message_enqueued',
        audience: { level: 'all' },
        priority: 'standard',
        payload: {
          message_id: item.message_id,
          direction: item.direction,
          status: item.status,
          type: item.type,
          sequence_number: item.sequence_number,
        },
      });
    }

    return item;
  }

  /**
   * Retrieves messages from the queue with optional filtering.
   */
  public async getQueue(filter?: {
    direction?: DtnDirection;
    status?: DtnMessageStatus;
    target_id?: string;
    limit?: number;
  }): Promise<DtnMessageItem[]> {
    const query: Record<string, unknown> = {};
    if (filter?.direction) query['direction'] = filter.direction;
    if (filter?.status) query['status'] = filter.status;
    if (filter?.target_id) query['target_id'] = filter.target_id;

    const limit = Math.min(filter?.limit ?? 100, 500);
    const docs = await DtnMessage.find(query)
      .sort({ sequence_number: 1, created_at: 1 })
      .limit(limit);

    return docs.map((d) => this.toItem(d));
  }

  /**
   * Synchronizes queued and in-flight messages upon comms reconnection.
   * Performs conflict-safe reconciliation between concurrent ground and onboard updates.
   */
  public async syncOnReconnect(options?: {
    nowMs?: number;
    reconciledBy?: string;
  }): Promise<SyncResult> {
    const nowMs = options?.nowMs ?? this.deps.clock.nowMs();
    const linkState = await this.deps.emulator.getState();

    // If still in blackout, cannot drain queued messages
    if (linkState.inBlackout) {
      return {
        ok: false,
        link_state: {
          in_blackout: true,
          effective_delay_ms: linkState.effectiveDelayMs,
        },
        synced_count: 0,
        delivered_count: 0,
        conflicts_count: 0,
        messages: [],
      };
    }

    // Find all queued messages or in-flight messages whose release_at has arrived
    const eligibleDocs = await DtnMessage.find({
      $or: [{ status: 'queued' }, { status: 'in_flight', release_at: { $lte: new Date(nowMs) } }],
    }).sort({ created_at: 1 });

    if (eligibleDocs.length === 0) {
      return {
        ok: true,
        link_state: {
          in_blackout: false,
          effective_delay_ms: linkState.effectiveDelayMs,
        },
        synced_count: 0,
        delivered_count: 0,
        conflicts_count: 0,
        messages: [],
      };
    }

    // Detect target-level conflicts between concurrent uplink and downlink messages
    const groupedByTarget = new Map<string, IDtnMessage[]>();
    const generalMessages: IDtnMessage[] = [];

    for (const doc of eligibleDocs) {
      const target =
        doc.target_id ??
        (typeof doc.payload['emergency_id'] === 'string'
          ? (doc.payload['emergency_id'] as string)
          : null) ??
        (typeof doc.payload['protocol_id'] === 'string'
          ? (doc.payload['protocol_id'] as string)
          : null);

      if (target) {
        const list = groupedByTarget.get(target) ?? [];
        list.push(doc);
        groupedByTarget.set(target, list);
      } else {
        generalMessages.push(doc);
      }
    }

    let conflictsCount = 0;
    let deliveredCount = 0;
    const reconciledDocs: IDtnMessage[] = [];

    // Process grouped targets for conflict safety
    for (const [targetId, messages] of groupedByTarget.entries()) {
      const uplinks = messages.filter((m) => m.direction === 'uplink');
      const downlinks = messages.filter((m) => m.direction === 'downlink');

      if (uplinks.length > 0 && downlinks.length > 0) {
        // Conflict detected on target: apply conflict policy
        // Check if downlink involves life-safety / emergency / protocol action
        const isLifeSafety = downlinks.some(
          (d) =>
            d.type === 'protocol_action' ||
            d.type === 'emergency_action' ||
            Boolean(d.payload['is_emergency']) ||
            Boolean(d.payload['emergency_id']),
        );

        if (isLifeSafety) {
          // Onboard wins for immediate crew health & life safety
          conflictsCount += uplinks.length;
          const winnerDownlink = downlinks[downlinks.length - 1]!;

          for (const up of uplinks) {
            up.status = 'conflict';
            up.conflict_resolution = {
              resolved: true,
              policy: 'onboard_wins',
              winner_message_id: winnerDownlink.message_id,
              details: `Crew Medical Officer on-scene immediate action for ${targetId} takes clinical precedence over ground directive.`,
              reconciled_at: new Date(nowMs),
              reconciled_by: options?.reconciledBy ?? 'system_reconciliation',
            };
            await up.save();
            reconciledDocs.push(up);
          }

          for (const down of downlinks) {
            down.status = 'delivered';
            down.delivered_at = new Date(nowMs);
            await down.save();
            reconciledDocs.push(down);
            deliveredCount++;
          }
        } else {
          // Ground wins for non-emergency clinical review or prescription policy
          conflictsCount += downlinks.length;
          const winnerUplink = uplinks[uplinks.length - 1]!;

          for (const down of downlinks) {
            down.status = 'conflict';
            down.conflict_resolution = {
              resolved: true,
              policy: 'ground_wins',
              winner_message_id: winnerUplink.message_id,
              details: `Flight Surgeon ground oversight protocol took precedence for target ${targetId}.`,
              reconciled_at: new Date(nowMs),
              reconciled_by: options?.reconciledBy ?? 'system_reconciliation',
            };
            await down.save();
            reconciledDocs.push(down);
          }

          for (const up of uplinks) {
            up.status = 'delivered';
            up.delivered_at = new Date(nowMs);
            await up.save();
            reconciledDocs.push(up);
            deliveredCount++;
          }
        }
      } else {
        // No conflict across directions for this target — deliver all
        for (const msg of messages) {
          msg.status = 'delivered';
          msg.delivered_at = new Date(nowMs);
          await msg.save();
          reconciledDocs.push(msg);
          deliveredCount++;
        }
      }
    }

    // Process general messages
    for (const msg of generalMessages) {
      msg.status = 'delivered';
      msg.delivered_at = new Date(nowMs);
      await msg.save();
      reconciledDocs.push(msg);
      deliveredCount++;
    }

    if (this.deps.eventBus) {
      this.deps.eventBus.publish({
        topic: 'system.notice',
        subtopic: 'dtn.sync_completed',
        audience: { level: 'all' },
        priority: 'high',
        payload: {
          synced_count: eligibleDocs.length,
          delivered_count: deliveredCount,
          conflicts_count: conflictsCount,
        },
      });
    }

    return {
      ok: true,
      link_state: {
        in_blackout: false,
        effective_delay_ms: linkState.effectiveDelayMs,
      },
      synced_count: eligibleDocs.length,
      delivered_count: deliveredCount,
      conflicts_count: conflictsCount,
      messages: reconciledDocs.map((d) => this.toItem(d)),
    };
  }

  private toItem(doc: IDtnMessage): DtnMessageItem {
    return {
      message_id: doc.message_id,
      direction: doc.direction,
      sender_id: doc.sender_id,
      sender_role: doc.sender_role,
      type: doc.type,
      target_id: doc.target_id ?? null,
      payload: doc.payload as Record<string, unknown>,
      sequence_number: doc.sequence_number,
      idempotency_key: doc.idempotency_key,
      status: doc.status,
      created_at: doc.created_at.toISOString(),
      release_at: doc.release_at ? doc.release_at.toISOString() : null,
      delivered_at: doc.delivered_at ? doc.delivered_at.toISOString() : null,
      conflict_resolution:
        doc.conflict_resolution && doc.conflict_resolution.resolved
          ? {
              resolved: doc.conflict_resolution.resolved,
              policy: doc.conflict_resolution.policy,
              winner_message_id: doc.conflict_resolution.winner_message_id ?? null,
              details: doc.conflict_resolution.details,
              reconciled_at: doc.conflict_resolution.reconciled_at
                ? doc.conflict_resolution.reconciled_at instanceof Date
                  ? doc.conflict_resolution.reconciled_at.toISOString()
                  : new Date(doc.conflict_resolution.reconciled_at).toISOString()
                : new Date().toISOString(),
              reconciled_by: doc.conflict_resolution.reconciled_by ?? null,
            }
          : null,
    };
  }
}
