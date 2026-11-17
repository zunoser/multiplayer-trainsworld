import type { CooperativeContext, CooperativeResult } from "../workers/protocol";

export function compactContext(context: CooperativeContext): CooperativeContext {
  return context.competition ? { ...context, ownershipOmitted: true,
    competition: { companies: context.competition.companies, owners: {} } } : context;
}

export function expandContext(context: CooperativeContext, owners: Record<string, string>): CooperativeContext {
  if (!context.competition || !context.ownershipOmitted) return context;
  const expanded = { ...context, competition: { ...context.competition, owners } };
  delete expanded.ownershipOmitted;
  return expanded;
}

export function compactResult(result: CooperativeResult): CooperativeResult {
  if (!result.before.competition || !result.after.competition) return result;
  const before = result.before.competition.owners, after = result.after.competition.owners;
  const ownershipDelta: Record<string, string | null> = {};
  for (const [key, owner] of Object.entries(after)) if (before[key] !== owner) ownershipDelta[key] = owner;
  for (const key of Object.keys(before)) if (!(key in after)) ownershipDelta[key] = null;
  return { ...result, before: compactContext(result.before), after: compactContext(result.after), ownershipDelta };
}

export function expandResult(result: CooperativeResult, owners: Record<string, string>): CooperativeResult {
  if (!result.ownershipDelta) return result;
  const before = expandContext(result.before, owners);
  const after = { ...before.competition?.owners };
  for (const [key, owner] of Object.entries(result.ownershipDelta)) {
    if (owner === null) delete after[key]; else after[key] = owner;
  }
  return { ...result, before, after: expandContext(result.after, after) };
}
