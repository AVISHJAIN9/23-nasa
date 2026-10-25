import mongoose from 'mongoose';
import { FusedAlert } from '../models/FusedAlert.js';
import { User } from '../models/User.js';
import { type FusionRepository } from './fusionRepository.js';
import { type InboxPublisher, toInboxItemDTO } from './inboxPublisher.js';
import { type Clock } from '../core/clock.js';
import { type AuditWriter } from '../core/audit.js';
import { type Principal, hasMedicalAccess, projectInboxItemForRole } from '../bus/audience.js';
import { originForRole } from '../bus/origin.js';
import {
  type InboxItemDTO,
  type InboxQuery,
  type InboxSummary,
  type AcknowledgeBody,
  type AssignBody,
  type SnoozeBody,
  type UnsnoozeBody,
  type ResolveBody,
  type AddNoteBody,
  type ActionResponse,
} from '../schemas/inbox.js';
import { type Page } from '../schemas/common.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../core/errors.js';
import {
  applyAcknowledge,
  applyAssign,
  applySnooze,
  applyUnsnooze,
  applyResolve,
  applyNote,
} from './workflow.js';

export interface InboxServiceDeps {
  repository: FusionRepository;
  inboxPublisher: InboxPublisher;
  auditWriter: AuditWriter;
  clock: Clock;
  dismissSuppressS: number;
  snoozeLimits: { maxWarningMin: number; maxWatchMin: number };
}

interface KeysetCursor {
  sortKey: number | string;
  id: string;
}

export class InboxService {
  constructor(private readonly deps: InboxServiceDeps) {}

  /**
   * Encodes a keyset pagination cursor into an opaque base64 string.
   */
  public static encodeCursor(sortKey: number | string, id: string): string {
    return Buffer.from(JSON.stringify({ sortKey, id })).toString('base64');
  }

  /**
   * Decodes an opaque base64 cursor.
   */
  public static decodeCursor(rawCursor: string): KeysetCursor {
    try {
      const decoded = Buffer.from(rawCursor, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded) as KeysetCursor;
      if (parsed.sortKey === undefined || !parsed.id) {
        throw new Error('Missing cursor fields');
      }
      return parsed;
    } catch {
      throw new ValidationError('Invalid pagination cursor', [
        { field: 'cursor', issue: 'Malformed base64 pagination cursor' },
      ]);
    }
  }

  /**
   * Validates that an ID is a valid MongoDB ObjectId.
   */
  private assertValidObjectId(id: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError(`Invalid alert ID format: "${id}"`, [
        { field: 'id', issue: 'Must be a 24-character hexadecimal ObjectId' },
      ]);
    }
  }

  /**
   * Lists inbox items with role-based scoping, rich filtering, and keyset pagination.
   */
  public async list(query: InboxQuery, principal: Principal): Promise<Page<InboxItemDTO>> {
    // 1. Role scoping: astronauts only see their own crew
    if (principal.role === 'astronaut') {
      if (query.crew_id && principal.crewId && query.crew_id !== principal.crewId) {
        throw new ForbiddenError(
          'Astronaut is not authorized to access inbox items of other crews',
        );
      }
    }

    const filter: Record<string, unknown> = {};

    if (principal.role === 'astronaut' && principal.crewId) {
      filter['crew_id'] = principal.crewId;
    } else if (query.crew_id) {
      filter['crew_id'] = query.crew_id;
    }

    // Default status: unresolved only
    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      filter['status'] = { $in: statuses };
    } else {
      filter['is_unresolved'] = true;
    }

    if (query.severity) filter['severity'] = query.severity;
    if (query.hazard) filter['hazard'] = query.hazard;
    if (query.source) filter['sources'] = query.source;
    if (query.condition) filter['condition'] = query.condition;

    if (query.assignee) {
      if (query.assignee === 'me') {
        filter['assignee_id'] = principal.userId;
      } else if (query.assignee === 'none') {
        filter['assignee_id'] = null;
      } else {
        filter['assignee_id'] = query.assignee;
      }
    }

    if (query.needs_attention) {
      filter['$or'] = [
        { status: 'open' },
        { status: 'snoozed', snoozed_until: { $lte: this.deps.clock.nowIso() } },
      ];
    }

    // Keyset pagination cursor
    const isPrioritySort = query.sort === 'priority';
    if (query.cursor) {
      const cursor = InboxService.decodeCursor(query.cursor);
      const cursorObjectId = new mongoose.Types.ObjectId(cursor.id);

      if (isPrioritySort) {
        const cursorPriority = Number(cursor.sortKey);
        filter['$or'] = [
          { priority_key: { $lt: cursorPriority } },
          { priority_key: cursorPriority, _id: { $lt: cursorObjectId } },
        ];
      } else {
        // recent sort
        const cursorTime = String(cursor.sortKey);
        filter['$or'] = [
          { last_activity_at: { $lt: cursorTime } },
          { last_activity_at: cursorTime, _id: { $lt: cursorObjectId } },
        ];
      }
    }

    // Sort order
    const sortSpec: Record<string, 1 | -1> = isPrioritySort
      ? { priority_key: -1, _id: -1 }
      : { last_activity_at: -1, _id: -1 };

    const limit = query.limit;
    // Fetch limit + 1 to detect has_more
    const docs = await FusedAlert.find(filter)
      .sort(sortSpec)
      .limit(limit + 1);

    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;

    let nextCursor: string | null = null;
    if (hasMore && pageDocs.length > 0) {
      const lastDoc = pageDocs[pageDocs.length - 1]!;
      const sortKey = isPrioritySort ? lastDoc.priority_key : lastDoc.last_activity_at;
      nextCursor = InboxService.encodeCursor(sortKey, lastDoc._id.toString());
    }

    const items = pageDocs.map((doc) =>
      projectInboxItemForRole(toInboxItemDTO(doc, false), principal),
    );

    return {
      items,
      next_cursor: nextCursor,
      has_more: hasMore,
    };
  }

  /**
   * Returns aggregated statistics for the inbox dashboard.
   */
  public async getSummary(principal: Principal): Promise<InboxSummary> {
    const baseFilter: Record<string, unknown> = {};
    if (principal.role === 'astronaut' && principal.crewId) {
      baseFilter['crew_id'] = principal.crewId;
    }

    const [openCount, ackCount, snoozedCount, resolvedCount] = await Promise.all([
      FusedAlert.countDocuments({ ...baseFilter, status: 'open' }),
      FusedAlert.countDocuments({ ...baseFilter, status: 'acknowledged' }),
      FusedAlert.countDocuments({ ...baseFilter, status: 'snoozed' }),
      FusedAlert.countDocuments({ ...baseFilter, status: 'resolved' }),
    ]);

    const [watchCount, warningCount, criticalCount] = await Promise.all([
      FusedAlert.countDocuments({ ...baseFilter, is_unresolved: true, severity: 'watch' }),
      FusedAlert.countDocuments({ ...baseFilter, is_unresolved: true, severity: 'warning' }),
      FusedAlert.countDocuments({ ...baseFilter, is_unresolved: true, severity: 'critical' }),
    ]);

    const unackedCritical = await FusedAlert.countDocuments({
      ...baseFilter,
      is_unresolved: true,
      status: 'open',
      severity: 'critical',
    });

    // Top 5 crews by max priority among unresolved items
    const topCrewsAgg = await FusedAlert.aggregate<{
      _id: string;
      max_priority: number;
      open_count: number;
    }>([
      { $match: { ...baseFilter, is_unresolved: true } },
      {
        $group: {
          _id: '$crew_id',
          max_priority: { $max: '$priority_key' },
          open_count: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
        },
      },
      { $sort: { max_priority: -1 } },
      { $limit: 5 },
    ]);

    const topCrews = topCrewsAgg.map((c) => ({
      crew_id: c._id,
      max_priority: c.max_priority,
      open_count: c.open_count,
    }));

    return {
      by_status: {
        open: openCount,
        acknowledged: ackCount,
        snoozed: snoozedCount,
        resolved: resolvedCount,
      },
      by_severity: {
        watch: watchCount,
        warning: warningCount,
        critical: criticalCount,
      },
      unacknowledged_critical: unackedCritical,
      top_crews_by_priority: topCrews,
    };
  }

  /**
   * Retrieves detail for a single fused alert card.
   */
  public async getById(id: string, principal: Principal): Promise<InboxItemDTO> {
    this.assertValidObjectId(id);
    const alert = await FusedAlert.findById(id);
    if (!alert) {
      throw new NotFoundError(`Inbox alert "${id}" not found`);
    }

    if (principal.role === 'astronaut' && principal.crewId && alert.crew_id !== principal.crewId) {
      throw new ForbiddenError('Astronaut is not authorized to access inbox items of other crews');
    }

    return projectInboxItemForRole(toInboxItemDTO(alert, true), principal);
  }

  /**
   * Acknowledge action: astronaut (own crew), flight_surgeon, mission_control, admin.
   */
  public async acknowledge(
    id: string,
    body: AcknowledgeBody,
    principal: Principal,
    requestId?: string,
  ): Promise<ActionResponse> {
    this.assertValidObjectId(id);
    const alert = await FusedAlert.findById(id);
    if (!alert) {
      throw new NotFoundError(`Inbox alert "${id}" not found`);
    }

    if (principal.role === 'astronaut' && principal.crewId && alert.crew_id !== principal.crewId) {
      throw new ForbiddenError(
        'Astronaut is not authorized to acknowledge inbox items of other crews',
      );
    }

    // Medical notes stored only if caller has medical access
    const note = hasMedicalAccess(principal) ? body.note : undefined;
    const nowIso = this.deps.clock.nowIso();

    const actor = {
      userId: principal.userId,
      role: principal.role,
      isMedicalOfficer: principal.isMedicalOfficer,
    };

    const { changed } = applyAcknowledge(alert.toObject(), actor, nowIso, note);

    if (!changed) {
      return {
        item: projectInboxItemForRole(toInboxItemDTO(alert, true), principal),
        changed: false,
        event: null,
      };
    }

    // Persist first
    const updated = await this.deps.repository.atomicAcknowledge(
      id,
      actor,
      nowIso,
      note,
      body.expected_version,
    );

    // Audit second
    await this.deps.auditWriter.write({
      actor_id: principal.userId,
      action: 'INBOX_ACKNOWLEDGED',
      target_id: id,
      request_id: requestId,
      metadata: {
        note_length: note?.length ?? 0,
      },
    });

    // Publish last
    const event = await this.deps.inboxPublisher.publishInboxEvent(
      'inbox.status_changed',
      updated,
      requestId,
      originForRole(principal.role),
    );

    return {
      item: projectInboxItemForRole(toInboxItemDTO(updated, true), principal),
      changed: true,
      event,
    };
  }

  /**
   * Assign action: flight_surgeon, admin, medical-officer astronaut.
   */
  public async assign(
    id: string,
    body: AssignBody,
    principal: Principal,
    requestId?: string,
  ): Promise<ActionResponse> {
    if (!hasMedicalAccess(principal)) {
      throw new ForbiddenError('Assign action requires medical officer or surgeon privileges');
    }

    this.assertValidObjectId(id);
    const alert = await FusedAlert.findById(id);
    if (!alert) {
      throw new NotFoundError(`Inbox alert "${id}" not found`);
    }

    let resolvedAssigneeId: string | null = body.assignee_id;
    if (resolvedAssigneeId === 'me') {
      resolvedAssigneeId = principal.userId;
    }

    if (resolvedAssigneeId !== null) {
      if (!mongoose.Types.ObjectId.isValid(resolvedAssigneeId)) {
        throw new ValidationError(`Invalid assignee user ID: "${resolvedAssigneeId}"`, [
          { field: 'assignee_id', issue: 'Must be a valid user ObjectId' },
        ]);
      }

      const user = await User.findById(resolvedAssigneeId);
      if (!user) {
        throw new NotFoundError(`Assignee user "${resolvedAssigneeId}" not found`);
      }

      const isEligible =
        user.role === 'flight_surgeon' ||
        user.role === 'admin' ||
        (user.role === 'astronaut' && Boolean(user.is_medical_officer));

      if (!isEligible) {
        throw new ValidationError(
          `User "${user.email}" is not eligible for assignment. Must be flight_surgeon, admin, or medical officer.`,
          [{ field: 'assignee_id', issue: 'User role ineligible for medical assignment' }],
        );
      }
    }

    const nowIso = this.deps.clock.nowIso();
    const actor = {
      userId: principal.userId,
      role: principal.role,
      isMedicalOfficer: principal.isMedicalOfficer,
    };

    const { state, changed } = applyAssign(alert.toObject(), actor, resolvedAssigneeId, nowIso);

    if (!changed) {
      return {
        item: projectInboxItemForRole(toInboxItemDTO(alert, true), principal),
        changed: false,
        event: null,
      };
    }

    const updated = await this.deps.repository.atomicUpdateAlert(id, state, body.expected_version);

    await this.deps.auditWriter.write({
      actor_id: principal.userId,
      action: 'ASSIGNED',
      target_id: id,
      request_id: requestId,
      metadata: {
        assignee_id: resolvedAssigneeId,
      },
    });

    const event = await this.deps.inboxPublisher.publishInboxEvent(
      'inbox.updated',
      updated,
      requestId,
      originForRole(principal.role),
    );

    return {
      item: projectInboxItemForRole(toInboxItemDTO(updated, true), principal),
      changed: true,
      event,
    };
  }

  /**
   * Snooze action: medical access only.
   */
  public async snooze(
    id: string,
    body: SnoozeBody,
    principal: Principal,
    requestId?: string,
  ): Promise<ActionResponse> {
    if (!hasMedicalAccess(principal)) {
      throw new ForbiddenError('Snooze action requires medical officer or surgeon privileges');
    }

    this.assertValidObjectId(id);
    const alert = await FusedAlert.findById(id);
    if (!alert) {
      throw new NotFoundError(`Inbox alert "${id}" not found`);
    }

    const nowIso = this.deps.clock.nowIso();
    const actor = {
      userId: principal.userId,
      role: principal.role,
      isMedicalOfficer: principal.isMedicalOfficer,
    };

    const { state } = applySnooze(
      alert.toObject(),
      actor,
      body.duration_min,
      body.reason,
      nowIso,
      this.deps.snoozeLimits,
    );

    const updated = await this.deps.repository.atomicUpdateAlert(id, state, body.expected_version);

    await this.deps.auditWriter.write({
      actor_id: principal.userId,
      action: 'SNOOZED',
      target_id: id,
      request_id: requestId,
      metadata: {
        duration_min: body.duration_min,
        reason_length: body.reason.length,
      },
    });

    const event = await this.deps.inboxPublisher.publishInboxEvent(
      'inbox.status_changed',
      updated,
      requestId,
      originForRole(principal.role),
    );

    return {
      item: projectInboxItemForRole(toInboxItemDTO(updated, true), principal),
      changed: true,
      event,
    };
  }

  /**
   * Unsnooze action: medical access only.
   */
  public async unsnooze(
    id: string,
    body: UnsnoozeBody,
    principal: Principal,
    requestId?: string,
  ): Promise<ActionResponse> {
    if (!hasMedicalAccess(principal)) {
      throw new ForbiddenError('Unsnooze action requires medical officer or surgeon privileges');
    }

    this.assertValidObjectId(id);
    const alert = await FusedAlert.findById(id);
    if (!alert) {
      throw new NotFoundError(`Inbox alert "${id}" not found`);
    }

    const nowIso = this.deps.clock.nowIso();
    const actor = {
      userId: principal.userId,
      role: principal.role,
      isMedicalOfficer: principal.isMedicalOfficer,
    };

    const { state } = applyUnsnooze(alert.toObject(), actor, nowIso);

    const updated = await this.deps.repository.atomicUpdateAlert(id, state, body.expected_version);

    await this.deps.auditWriter.write({
      actor_id: principal.userId,
      action: 'UNSNOOZED',
      target_id: id,
      request_id: requestId,
    });

    const event = await this.deps.inboxPublisher.publishInboxEvent(
      'inbox.status_changed',
      updated,
      requestId,
      originForRole(principal.role),
    );

    return {
      item: projectInboxItemForRole(toInboxItemDTO(updated, true), principal),
      changed: true,
      event,
    };
  }

  /**
   * Resolve action: medical access only.
   */
  public async resolve(
    id: string,
    body: ResolveBody,
    principal: Principal,
    requestId?: string,
  ): Promise<ActionResponse> {
    if (!hasMedicalAccess(principal)) {
      throw new ForbiddenError('Resolve action requires medical officer or surgeon privileges');
    }

    this.assertValidObjectId(id);
    const alert = await FusedAlert.findById(id);
    if (!alert) {
      throw new NotFoundError(`Inbox alert "${id}" not found`);
    }

    const nowIso = this.deps.clock.nowIso();
    const actor = {
      userId: principal.userId,
      role: principal.role,
      isMedicalOfficer: principal.isMedicalOfficer,
    };

    const { state } = applyResolve(
      alert.toObject(),
      actor,
      nowIso,
      this.deps.dismissSuppressS,
      body.resolution_note,
    );

    const updated = await this.deps.repository.atomicUpdateAlert(id, state, body.expected_version);

    await this.deps.auditWriter.write({
      actor_id: principal.userId,
      action: 'RESOLVED',
      target_id: id,
      request_id: requestId,
      metadata: {
        resolution_note_length: body.resolution_note?.length ?? 0,
        resolution: state.resolution,
      },
    });

    const event = await this.deps.inboxPublisher.publishInboxEvent(
      'inbox.status_changed',
      updated,
      requestId,
      originForRole(principal.role),
    );

    return {
      item: projectInboxItemForRole(toInboxItemDTO(updated, true), principal),
      changed: true,
      event,
    };
  }

  /**
   * Add Note action: medical access only.
   */
  public async addNote(
    id: string,
    body: AddNoteBody,
    principal: Principal,
    requestId?: string,
  ): Promise<ActionResponse> {
    if (!hasMedicalAccess(principal)) {
      throw new ForbiddenError('Adding notes requires medical officer or surgeon privileges');
    }

    this.assertValidObjectId(id);
    const alert = await FusedAlert.findById(id);
    if (!alert) {
      throw new NotFoundError(`Inbox alert "${id}" not found`);
    }

    const nowIso = this.deps.clock.nowIso();
    const actor = {
      userId: principal.userId,
      role: principal.role,
      isMedicalOfficer: principal.isMedicalOfficer,
    };

    const { state } = applyNote(alert.toObject(), actor, body.text, nowIso);

    const updated = await this.deps.repository.atomicUpdateAlert(id, state);

    await this.deps.auditWriter.write({
      actor_id: principal.userId,
      action: 'NOTE_ADDED',
      target_id: id,
      request_id: requestId,
      metadata: {
        note_length: body.text.length,
      },
    });

    const event = await this.deps.inboxPublisher.publishInboxEvent(
      'inbox.updated',
      updated,
      requestId,
      originForRole(principal.role),
    );

    return {
      item: projectInboxItemForRole(toInboxItemDTO(updated, true), principal),
      changed: true,
      event,
    };
  }
}
