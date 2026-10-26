import { SEVERITY_RANKS, BASE_PRIORITY_SCORES, CORROBORATION_BONUS, ATTENTION_WEIGHTS, } from './fusionConfig.js';
/**
 * Returns the higher of two severities according to SEVERITY_RANKS.
 */
export function maxSeverity(a, b) {
    return SEVERITY_RANKS[a] >= SEVERITY_RANKS[b] ? a : b;
}
/**
 * Returns the lower of two severities according to SEVERITY_RANKS.
 */
export function minSeverity(a, b) {
    return SEVERITY_RANKS[a] <= SEVERITY_RANKS[b] ? a : b;
}
/**
 * Recomputes effective severity for all members, taking into account
 * whether any rule alert is active in the group (corroboration lifts ML confidence cap).
 */
export function recomputeMemberEffectiveSeverities(members, minConfidence) {
    const hasActiveRuleMember = members.some((m) => m.source === 'rule' && m.status === 'active');
    return members.map((m) => {
        if (m.source === 'rule') {
            return {
                ...m,
                effective_severity: m.severity,
                confidence_capped: false,
            };
        }
        // ML members (anomaly / risk)
        const isLowConfidence = m.confidence !== undefined && m.confidence < minConfidence;
        if (isLowConfidence && !hasActiveRuleMember) {
            return {
                ...m,
                effective_severity: minSeverity(m.severity, 'watch'),
                confidence_capped: true,
            };
        }
        return {
            ...m,
            effective_severity: m.severity,
            confidence_capped: false,
        };
    });
}
/**
 * Computes fused severity from active members.
 * If no active members remain, preserves the last known severity.
 */
export function computeFusedSeverity(members, fallbackSeverity) {
    const activeMembers = members.filter((m) => m.status === 'active');
    if (activeMembers.length === 0) {
        return fallbackSeverity;
    }
    let highest = 'watch';
    for (const m of activeMembers) {
        if (SEVERITY_RANKS[m.effective_severity] > SEVERITY_RANKS[highest]) {
            highest = m.effective_severity;
        }
    }
    return highest;
}
/**
 * Computes priority score and composite priority_key.
 * priority_score = base + corroboration bonus (capped at +20)
 * priority_key = attention_weight * 1000 + priority_score
 */
export function computePriority(severity, status, members) {
    const baseScore = BASE_PRIORITY_SCORES[severity];
    const activeMembers = members.filter((m) => m.status === 'active');
    const activeSources = new Set(activeMembers.map((m) => m.source));
    const activeMetrics = new Set(activeMembers.map((m) => m.metric).filter((m) => Boolean(m)));
    const extraSources = Math.max(0, activeSources.size - 1);
    const extraMetrics = Math.max(0, activeMetrics.size - 1);
    const rawBonus = extraSources * CORROBORATION_BONUS.PER_EXTRA_SOURCE +
        extraMetrics * CORROBORATION_BONUS.PER_EXTRA_METRIC;
    const bonus = Math.min(CORROBORATION_BONUS.MAX_BONUS, rawBonus);
    const priorityScore = baseScore + bonus;
    const attentionWeight = ATTENTION_WEIGHTS[status];
    const priorityKey = attentionWeight * 1000 + priorityScore;
    return { priority_score: priorityScore, priority_key: priorityKey };
}
/**
 * Builds deterministic title, summary, explanation, and top factors without LLMs.
 */
export function buildDeterministicPresentation(hazard, severity, members) {
    const activeMembers = members.filter((m) => m.status === 'active');
    const relevantMembers = activeMembers.length > 0 ? activeMembers : members;
    // Title: format as e.g. "Respiratory: SpO2 low (critical)" or "Thermal: Core temp high (warning)"
    const hazardFormatted = hazard.charAt(0).toUpperCase() + hazard.slice(1).replace('_', ' ');
    const topMember = relevantMembers
        .slice()
        .sort((a, b) => SEVERITY_RANKS[b.effective_severity] - SEVERITY_RANKS[a.effective_severity])[0] ?? relevantMembers[0];
    const metricOrDetail = topMember?.metric ? topMember.metric : (topMember?.title ?? hazard);
    const title = `${hazardFormatted}: ${metricOrDetail} (${severity})`;
    // Summary: e.g. "2 sources agree: rule 'spo2' and anomaly model 'iforest-v1' (confidence 0.82)"
    const activeSources = Array.from(new Set(relevantMembers.map((m) => m.source)));
    const sourceSummaries = [];
    for (const src of activeSources) {
        const srcMembers = relevantMembers.filter((m) => m.source === src);
        if (src === 'rule') {
            const metricList = Array.from(new Set(srcMembers.map((m) => m.metric).filter(Boolean)));
            sourceSummaries.push(`rule '${metricList.join(', ') || 'threshold'}'`);
        }
        else {
            const topModel = srcMembers[0];
            const modelLabel = topModel?.model_id ?? `${src} model`;
            const confStr = topModel?.confidence !== undefined ? ` (confidence ${topModel.confidence.toFixed(2)})` : '';
            sourceSummaries.push(`${src} '${modelLabel}'${confStr}`);
        }
    }
    let summary;
    if (sourceSummaries.length > 1) {
        summary = `${sourceSummaries.length} sources agree: ${sourceSummaries.join(' and ')}`;
    }
    else if (sourceSummaries.length === 1) {
        summary = `1 source reporting: ${sourceSummaries[0]}`;
    }
    else {
        summary = `Hazard alert for ${hazard}`;
    }
    // Explanation: explanation of highest-severity active member
    const explanation = topMember?.explanation || topMember?.title || `Clinical hazard detected for ${hazard}`;
    // Top 5 factors from ML member with highest confidence
    const mlMembersWithFactors = relevantMembers
        .filter((m) => (m.source === 'anomaly' || m.source === 'risk') && m.factors && m.factors.length > 0)
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const factors = mlMembersWithFactors[0]?.factors?.slice(0, 5) ?? [];
    // Overall confidence: max active ML confidence or null
    const activeMlConfs = activeMembers
        .filter((m) => (m.source === 'anomaly' || m.source === 'risk') && m.confidence !== undefined)
        .map((m) => m.confidence);
    const confidence = activeMlConfs.length > 0 ? Math.max(...activeMlConfs) : null;
    return { title, summary, explanation, factors, confidence };
}
/**
 * Prunes members to stay within maxMembers limit.
 * Oldest cleared members are dropped first. Drops are counted in dropped_members.
 */
export function pruneMembers(members, maxMembers) {
    if (members.length <= maxMembers) {
        return { members, droppedCount: 0 };
    }
    const excess = members.length - maxMembers;
    // Separate cleared vs active
    const cleared = members
        .filter((m) => m.status === 'cleared')
        .sort((a, b) => new Date(a.cleared_at ?? a.last_seen_at).getTime() -
        new Date(b.cleared_at ?? b.last_seen_at).getTime());
    const active = members.filter((m) => m.status === 'active');
    let droppedCount = 0;
    let remainingCleared = [...cleared];
    if (remainingCleared.length >= excess) {
        remainingCleared = remainingCleared.slice(excess);
        droppedCount = excess;
    }
    else {
        droppedCount = remainingCleared.length;
        remainingCleared = [];
        const remainingToDrop = excess - droppedCount;
        // active members drop oldest last_seen_at if absolutely required
        active.sort((a, b) => new Date(a.last_seen_at).getTime() - new Date(b.last_seen_at).getTime());
        active.splice(0, remainingToDrop);
        droppedCount += remainingToDrop;
    }
    return {
        members: [...active, ...remainingCleared],
        droppedCount,
    };
}
/**
 * Checks whether an incoming active event matches an unresolved fused alert's suppression window
 * (i.e. alert was dismissed while condition was active).
 */
export function isSuppressedByDismissal(dismissedAlert, input, nowIso) {
    if (!dismissedAlert ||
        dismissedAlert.status !== 'resolved' ||
        dismissedAlert.resolution !== 'dismissed' ||
        !dismissedAlert.suppress_until ||
        !dismissedAlert.dismissed_severity) {
        return false;
    }
    const suppressUntilMs = new Date(dismissedAlert.suppress_until).getTime();
    const nowMs = new Date(nowIso).getTime();
    if (nowMs >= suppressUntilMs) {
        return false; // suppression window expired
    }
    // Suppressed if effective input severity is <= dismissed severity
    return SEVERITY_RANKS[input.severity] <= SEVERITY_RANKS[dismissedAlert.dismissed_severity];
}
/**
 * Pure function: applies an incoming FusionInput event to a FusedAlert state (or creates initial state).
 * Returns the updated state and whether a notable change occurred.
 */
export function applyMemberEvent(existingAlert, input, options) {
    const { minConfidence, maxMembers, timelineMax } = options;
    const isNew = existingAlert === null;
    // Initialize or copy members
    let members = existingAlert ? [...existingAlert.members] : [];
    let memberCountTotal = existingAlert?.member_count_total ?? 0;
    let droppedMembers = existingAlert?.dropped_members ?? 0;
    const existingMemberIndex = members.findIndex((m) => m.source === input.source && m.ref_id === input.ref_id);
    let memberStatusChanged = false;
    let isNewMember = false;
    if (existingMemberIndex >= 0) {
        const prevMember = members[existingMemberIndex];
        memberStatusChanged = prevMember.status !== input.status;
        const updatedMember = {
            ...prevMember,
            metric: input.metric ?? prevMember.metric,
            model_id: input.model_id ?? prevMember.model_id,
            model_version: input.model_version ?? prevMember.model_version,
            severity: input.severity,
            status: input.status,
            confidence: input.confidence ?? prevMember.confidence,
            title: input.title,
            explanation: input.explanation,
            factors: input.factors ?? prevMember.factors,
            cleared_at: input.status === 'cleared' ? input.event_at : prevMember.cleared_at,
            last_seen_at: input.event_at,
        };
        members[existingMemberIndex] = updatedMember;
    }
    else {
        // If input is cleared and member is unknown, this is a no-op!
        if (input.status === 'cleared') {
            if (!existingAlert) {
                throw new Error('Cannot create a fused alert from an unknown cleared input');
            }
            return {
                state: existingAlert,
                eventType: null,
                significantChange: false,
            };
        }
        isNewMember = true;
        memberCountTotal += 1;
        const newMember = {
            source: input.source,
            ref_id: input.ref_id,
            metric: input.metric,
            model_id: input.model_id,
            model_version: input.model_version,
            severity: input.severity,
            effective_severity: input.severity, // temporary, recomputed below
            status: input.status,
            confidence: input.confidence,
            confidence_capped: false,
            raised_at: input.raised_at,
            cleared_at: undefined,
            last_seen_at: input.event_at,
            title: input.title,
            explanation: input.explanation,
            factors: input.factors,
        };
        members.push(newMember);
    }
    // Recompute effective severities & confidence caps
    members = recomputeMemberEffectiveSeverities(members, minConfidence);
    // Prune members if exceeding maxMembers
    const pruneResult = pruneMembers(members, maxMembers);
    members = pruneResult.members;
    droppedMembers += pruneResult.droppedCount;
    // Compute condition
    const hasActiveMembers = members.some((m) => m.status === 'active');
    const condition = hasActiveMembers ? 'active' : 'cleared';
    // Compute fused severity & peak
    const previousSeverity = existingAlert?.severity ?? input.severity;
    const severity = computeFusedSeverity(members, previousSeverity);
    const peakSeverity = existingAlert
        ? maxSeverity(existingAlert.peak_severity, severity)
        : severity;
    // Check escalation
    let status = existingAlert?.status ?? 'open';
    let severityAtAck = existingAlert?.severity_at_ack;
    let isEscalated = false;
    if (existingAlert &&
        (status === 'acknowledged' || status === 'snoozed') &&
        severityAtAck !== undefined &&
        SEVERITY_RANKS[severity] > SEVERITY_RANKS[severityAtAck]) {
        status = 'open';
        severityAtAck = undefined;
        isEscalated = true;
    }
    // Check auto-resolution: Cleared plus acknowledged or cleared plus snoozed auto-resolves with resolved_by "system"
    let resolvedAt = existingAlert?.resolved_at;
    let resolvedBy = existingAlert?.resolved_by;
    let resolution = existingAlert?.resolution;
    let isAutoResolved = false;
    if (condition === 'cleared' && (status === 'acknowledged' || status === 'snoozed')) {
        status = 'resolved';
        resolvedAt = input.event_at;
        resolvedBy = 'system';
        resolution = 'condition_cleared';
        isAutoResolved = true;
    }
    // Priority score
    const { priority_score, priority_key } = computePriority(severity, status, members);
    // Deterministic presentation
    const presentation = buildDeterministicPresentation(input.hazard, severity, members);
    // Timeline entries
    const timeline = existingAlert ? [...existingAlert.timeline] : [];
    if (isNew) {
        timeline.push({
            at: input.event_at,
            type: 'created',
            actor_id: 'system',
            actor_role: 'system',
            to_status: 'open',
            severity,
            ref_id: input.ref_id,
        });
    }
    else if (isNewMember) {
        timeline.push({
            at: input.event_at,
            type: 'member_attached',
            actor_id: 'system',
            actor_role: 'system',
            severity: input.severity,
            ref_id: input.ref_id,
        });
    }
    else if (memberStatusChanged && input.status === 'cleared') {
        timeline.push({
            at: input.event_at,
            type: 'member_cleared',
            actor_id: 'system',
            actor_role: 'system',
            severity: input.severity,
            ref_id: input.ref_id,
        });
    }
    if (existingAlert && severity !== previousSeverity) {
        timeline.push({
            at: input.event_at,
            type: 'severity_changed',
            actor_id: 'system',
            actor_role: 'system',
            severity,
        });
    }
    if (isEscalated) {
        timeline.push({
            at: input.event_at,
            type: 'escalated',
            actor_id: 'system',
            actor_role: 'system',
            from_status: existingAlert?.status,
            to_status: 'open',
            severity,
        });
    }
    if (isAutoResolved) {
        timeline.push({
            at: input.event_at,
            type: 'resolved',
            actor_id: 'system',
            actor_role: 'system',
            from_status: existingAlert?.status,
            to_status: 'resolved',
            note: 'condition_cleared',
        });
    }
    // Cap timeline
    const cappedTimeline = timeline.length > timelineMax ? timeline.slice(-timelineMax) : timeline;
    const distinctSources = Array.from(new Set(members.map((m) => m.source)));
    const distinctMetrics = Array.from(new Set(members.map((m) => m.metric).filter((m) => Boolean(m))));
    const groupKey = `${input.crew_id}:${input.hazard}`;
    const isUnresolved = status !== 'resolved';
    const newState = {
        crew_id: input.crew_id,
        hazard: input.hazard,
        group_key: groupKey,
        is_unresolved: isUnresolved,
        status,
        condition,
        severity,
        peak_severity: peakSeverity,
        severity_at_ack: severityAtAck,
        priority_score,
        priority_key,
        title: presentation.title,
        summary: presentation.summary,
        explanation: presentation.explanation,
        factors: presentation.factors,
        confidence: presentation.confidence,
        sources: distinctSources,
        metrics: distinctMetrics,
        members,
        member_count_total: memberCountTotal,
        dropped_members: droppedMembers,
        mission_mode: input.mission_mode,
        mission_day: input.mission_day ?? existingAlert?.mission_day,
        raised_at: existingAlert?.raised_at ?? input.raised_at,
        last_activity_at: input.event_at,
        acknowledged_at: existingAlert?.acknowledged_at,
        acknowledged_by: existingAlert?.acknowledged_by,
        assignee_id: existingAlert?.assignee_id,
        assigned_at: existingAlert?.assigned_at,
        assigned_by: existingAlert?.assigned_by,
        snoozed_until: existingAlert?.snoozed_until,
        snoozed_by: existingAlert?.snoozed_by,
        snooze_reason: existingAlert?.snooze_reason,
        cleared_at: condition === 'cleared' ? (existingAlert?.cleared_at ?? input.event_at) : undefined,
        resolved_at: resolvedAt,
        resolved_by: resolvedBy,
        resolution,
        resolution_note: existingAlert?.resolution_note,
        dismissed_severity: existingAlert?.dismissed_severity,
        suppress_until: existingAlert?.suppress_until,
        suppressed_events: existingAlert?.suppressed_events ?? 0,
        reopen_count: existingAlert?.reopen_count ?? 0,
        last_published_at: existingAlert?.last_published_at,
        version: (existingAlert?.version ?? 0) + 1,
        timeline: cappedTimeline,
    };
    // Determine event type and significance
    if (isNew) {
        return {
            state: newState,
            eventType: 'inbox.raised',
            significantChange: true,
        };
    }
    const statusChanged = existingAlert.status !== newState.status;
    const conditionChanged = existingAlert.condition !== newState.condition;
    const severityChanged = existingAlert.severity !== newState.severity;
    const newSourcesOrMetrics = newState.sources.length !== existingAlert.sources.length ||
        newState.metrics.length !== existingAlert.metrics.length;
    const significantChange = statusChanged || conditionChanged || severityChanged || newSourcesOrMetrics;
    const eventType = statusChanged ? 'inbox.status_changed' : 'inbox.updated';
    return {
        state: newState,
        eventType,
        significantChange,
    };
}
