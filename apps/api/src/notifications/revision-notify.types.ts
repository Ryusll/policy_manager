export type PolicyRevisionNotifyConfig = {
  enabled: boolean;
  userIds: string[];
  groupIds: string[];
};

export function parseRevisionNotifyFromMetadata(metadata: unknown): PolicyRevisionNotifyConfig {
  const empty: PolicyRevisionNotifyConfig = { enabled: false, userIds: [], groupIds: [] };
  if (!metadata || typeof metadata !== 'object') return empty;
  const meta = metadata as Record<string, unknown>;
  if (meta.revisionNotifyEnabled === true && !meta.revisionNotify) {
    return { enabled: true, userIds: [], groupIds: [] };
  }
  const raw = meta.revisionNotify;
  if (!raw || typeof raw !== 'object') return empty;
  const cfg = raw as Record<string, unknown>;
  return {
    enabled: cfg.enabled === true,
    userIds: Array.isArray(cfg.userIds) ? cfg.userIds.filter((id) => typeof id === 'string') : [],
    groupIds: Array.isArray(cfg.groupIds) ? cfg.groupIds.filter((id) => typeof id === 'string') : [],
  };
}
