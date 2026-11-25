/** Pure calculations shared by the local reader and the UI. Tokens use decimal k. */
export const VERSION = '0.1.0';
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const validTokens = value => Number.isSafeInteger(value) && value >= 0;

export function buildTiers({ defaultWindow, maxWindow, currentWindow } = {}) {
  if (!validTokens(maxWindow) || !maxWindow) return [];
  return [...new Set([defaultWindow, 384000, 512000, 768000, maxWindow, currentWindow])]
    .filter(value => validTokens(value) && value > 0 && value <= maxWindow)
    .sort((a, b) => a - b);
}

export function remainingPercent(used, window) {
  if (!validTokens(used) || !validTokens(window) || !window) return null;
  return clamp((1 - used / window) * 100, 0, 100);
}

/** Client-side deadline/identity gate, including when a producer stops publishing. */
export function selectFollowEnvelope(data, windowKey = null, now = Date.now()) {
  const f=data?.follow;
  const empty=(state,message)=>({state,message,threadId:null,snapshot:null,windowKey:null,validUntil:0});
  if(!f||!finite(data.generatedAt)||now-data.generatedAt>4000||data.generatedAt>now+2000)return empty('unavailable','监控连接已暂停');
  const w=f.windows?.find(w=>w.key===(windowKey??f.selectedWindowKey));
  if(!windowKey&&f.state!=='following')return empty(f.state,f.message);
  if(!w)return empty('waiting',windowKey?'所选窗口已失效':'等待窗口确认');
  if(w.state!=='following')return empty(w.state,w.message);
  if(!finite(w.validUntil)||w.validUntil<=now)return empty('expired','页面信号已过期，请切换对话重新确认');
  if(!w.threadId||w.snapshot?.threadId!==w.threadId)return empty('unavailable','会话身份未确认');
  return {state:'following',message:w.message,threadId:w.threadId,snapshot:w.snapshot,windowKey:w.key,validUntil:w.validUntil};
}

export function normalizeSnapshot(raw, model = null, now = Date.now()) {
  const effectiveWindow = validTokens(raw.window) && raw.window > 0 ? raw.window : null;
  const used = validTokens(raw.used) ? raw.used : null;
  const reported = finite(raw.reportedRemainingPercent) && raw.reportedRemainingPercent >= 0 && raw.reportedRemainingPercent <= 100;
  const percent = reported ? raw.reportedRemainingPercent : remainingPercent(used, effectiveWindow);
  // Only map a runtime window to the catalog default when its documented factor matches exactly.
  // This is a labeled inference, never evidence that a configuration write succeeded.
  const matchesDefault = model && effectiveWindow === Math.floor(model.defaultWindow * model.effectivePercent / 100);
  const hasConfigured = validTokens(raw.configuredWindow) && raw.configuredWindow > 0;
  const configuredWindow = hasConfigured
    ? raw.configuredWindow : matchesDefault ? model.defaultWindow : null;
  const measuredAt = typeof raw.measuredAt === 'string' && finite(Date.parse(raw.measuredAt)) ? raw.measuredAt : null;
  return {
    threadId: raw.threadId,
    model: typeof raw.model === 'string' ? raw.model : null,
    usedTokens: used,
    effectiveWindow,
    configuredWindow,
    windowBasis: hasConfigured ? 'reported' : matchesDefault ? 'catalog-default-match' : 'runtime-window',
    displayWindow: configuredWindow ?? effectiveWindow,
    modelMaxWindow: model?.maxWindow ?? null,
    modelDefaultWindow: model?.defaultWindow ?? null,
    remainingPercent: percent,
    quality: percent === null ? 'unknown' : reported ? 'reported' : 'estimated',
    source: raw.source ?? 'local-rollout',
    measuredAt,
    readAt: new Date(now).toISOString(),
    state: raw.state ?? 'unknown',
    compactionEpoch: raw.compactionEpoch ?? null,
    revision: String(raw.revision ?? measuredAt ?? 'unknown'),
    limitsSource: model ? 'local-model-catalog' : 'unknown',
  };
}

/** Warnings depend on unrounded, observed usage, never on slider previews. */
export class WarningTracker {
  #threads = new Map();
  observe(snapshot, { initial = false } = {}) {
    if (!snapshot?.threadId || !finite(snapshot.remainingPercent)) return false;
    let state = this.#threads.get(snapshot.threadId);
    if (!state) state = { armed: true, revision: null, window: null, epoch: null };
    const nextWindow = snapshot.effectiveWindow;
    const same = state.revision === snapshot.revision && state.window === nextWindow;
    if (same) return false;
    if (snapshot.remainingPercent > 25 || (state.epoch && snapshot.compactionEpoch !== state.epoch)) state.armed = true;
    const alert = !initial && state.armed && snapshot.remainingPercent <= 20;
    if (snapshot.remainingPercent <= 20) state.armed = false;
    state.revision = snapshot.revision; state.window = nextWindow; state.epoch = snapshot.compactionEpoch;
    this.#threads.set(snapshot.threadId, state);
    return alert;
  }
}

export class UnsupportedCapabilityError extends Error {
  constructor(message = '此宿主未验证会话扩容接口，当前仅监控。') { super(message); this.code = 'UNSUPPORTED_CAPABILITY'; }
}

/** A control adapter must return authoritative effective state, not echo a requested number. */
export class WindowController {
  #versions = new Map();
  #states = new Map();
  constructor(adapter) { this.adapter = adapter; }
  state(threadId) { return this.#states.get(threadId) ?? null; }
  async apply(threadId, window) {
    if (!this.adapter.capabilities?.runtimeWindowUpdate) throw new UnsupportedCapabilityError();
    const limits = await this.adapter.limits(threadId);
    if (!buildTiers(limits).includes(window)) throw new RangeError('档位不在本会话允许范围内。');
    const previous = this.state(threadId);
    const version = (this.#versions.get(threadId) ?? 0) + 1;
    this.#versions.set(threadId, version);
    this.#states.set(threadId, { status: 'applying', requestedWindow: window, effectiveWindow: previous?.effectiveWindow ?? null });
    try {
      const result = await this.adapter.apply({ threadId, window, version });
      if (result.threadId !== threadId || result.applied !== true || result.configuredWindow !== window || !validTokens(result.effectiveWindow) || !result.effectiveWindow) {
        throw new Error('后端未确认目标会话的实际窗口，保留原值。');
      }
      if (this.#versions.get(threadId) !== version) return { ignored: true };
      const state = { status: 'effective', requestedWindow: window, effectiveWindow: result.effectiveWindow };
      this.#states.set(threadId, state); return state;
    } catch (error) {
      if (this.#versions.get(threadId) === version) this.#states.set(threadId, { ...previous, status: 'failed', error: error.message });
      throw error;
    }
  }
}
