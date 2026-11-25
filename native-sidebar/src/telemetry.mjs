// A deliberately version-bound adapter. Never guess minified exports after an App update.
export const PROFILE = Object.freeze({
  kind: 'esm',
  appVersion: '26.1023.6123.0',
  asset: 'app-initial-b0cd131b9dba.js',
  usageExport: 'awn', // VZn -> resumed conversation's latestTokenUsageInfo
  hostExport: 'VJn', // Kw -> conversation host
});
export const RSPACK_PROFILE = Object.freeze({
  kind: 'rspack', appVersion: '26.1103.3517.0',
  asset: '348410.4b841496e2.js', moduleId: 'tl5a', usageExport: 'k2', hostExport: 'qX',
  stateAsset: 'async/182735.e33af7cdca.js', composerAsset: 'async/309406.7154f09b4b.js',
  primaryAsset: 'async/499225.e7acf901f8.js',
});
export const RSPACK_4239_PROFILE = Object.freeze({
  kind: 'rspack', appVersion: '26.1103.4239.0',
  asset: '348410.792d1c9584.js', moduleId: 'tl5a', usageExport: 'k2', hostExport: 'qX',
  stateAsset: 'async/182735.bb2cb0d2af.js', composerAsset: 'async/309406.7154f09b4b.js',
  primaryAsset: 'async/499225.6d2e47bea2.js',
});
export const RSPACK_1111_PROFILE = Object.freeze({
  kind: 'rspack', appVersion: '26.1111.2228.0',
  asset: '348410.374a9b8f98.js', moduleId: 'tl5a', usageExport: 'k2', hostExport: 'qX',
  stateAsset: 'async/907538.0572f09d40.js', composerAsset: 'async/486887.8844429c7e.js',
  primaryAsset: 'async/200114.81334159bb.js',
  // Scalar selectors verified in this exact module. Never expose complete thread state.
  preflightExports: Object.freeze({ model: 'Zs', responseInProgress: 'uF', requestCount: 'LO',
    pendingRequestKind: 'Zv', resumeState: 'nX', ephemeral: 'v7', runtimeStatus: 'F9', latestTurnStatus: 'VY' }),
});
export const RSPACK_9664_PROFILE = Object.freeze({
  ...RSPACK_1111_PROFILE, appVersion: '26.1111.9664.0',
  asset: '348410.16a4406b14.js', stateAsset: 'async/907538.0c31293919.js',
  composerAsset: 'async/486887.d08998ca6f.js', primaryAsset: 'async/14459.e3d526c839.js',
});
// The project launcher can fill this slot after checking the installed ASAR.
export const RSPACK_3838_PROFILE = Object.freeze({
  ...RSPACK_9664_PROFILE, appVersion: '26.1117.3838.0',
  asset: '348410.26eb37f9ae.js', stateAsset: 'async/911644.2b086ab057.js',
  composerAsset: 'async/839700.66dbf76ec5.js', primaryAsset: 'async/881612.aefa82aed9.js',
});
export const RSPACK_4957_PROFILE = Object.freeze({
  ...RSPACK_3838_PROFILE, appVersion: '26.1117.4957.0',
  asset: '348410.35ea11b6a0.js', stateAsset: 'async/911644.eaf037cac0.js',
  composerAsset: 'async/839700.c1fe868f96.js', primaryAsset: 'async/881612.d5f896add0.js',
});
export const RSPACK_5083_PROFILE = Object.freeze({
  ...RSPACK_4957_PROFILE, appVersion: '26.1120.5083.0',
  asset: '348410.477a16d4d9.js', stateAsset: 'async/49792.ab5b643c25.js',
  composerAsset: 'async/993845.177eaa6113.js', primaryAsset: 'async/163341.4e4e6d0ab5.js',
});
const verifiedLocalBuild = null;
export function profilesForBuild(local){
  if(!local)return [PROFILE,RSPACK_PROFILE,RSPACK_4239_PROFILE,RSPACK_1111_PROFILE,RSPACK_9664_PROFILE,RSPACK_3838_PROFILE,RSPACK_4957_PROFILE,RSPACK_5083_PROFILE];
  if(local.unsupported)return [];
  return [{...RSPACK_9664_PROFILE,...local}];
}
export const PROFILES = Object.freeze(profilesForBuild(verifiedLocalBuild));

// Only the known initialized cache record is read. Never invoke a runtime or module factory.
export function cachedBindings(namespace, profile) {
  const matches = [];
  for (const key of Object.keys(namespace ?? {})) {
    try {
      const runtime = Object.getOwnPropertyDescriptor(namespace, key)?.value;
      if (typeof runtime !== 'function') continue;
      const cache = Object.getOwnPropertyDescriptor(runtime, 'c')?.value;
      const factories = Object.getOwnPropertyDescriptor(runtime, 'm')?.value;
      if (!cache || !factories || !Object.hasOwn(factories, profile.moduleId)) continue;
      const record = Object.getOwnPropertyDescriptor(cache, profile.moduleId)?.value;
      if (!record || Object.getOwnPropertyDescriptor(record, 'error')) continue;
      const exports = Object.getOwnPropertyDescriptor(record, 'exports')?.value;
      if (!exports || !Object.hasOwn(exports, profile.usageExport) || !Object.hasOwn(exports, profile.hostExport)) continue;
      // These two exports (including qX's re-export getter) are verified in this exact asset profile.
      const usageAtom = exports[profile.usageExport], hostAtom = exports[profile.hostExport];
      if (usageAtom && hostAtom && !matches.some(v => v.usageAtom === usageAtom && v.hostAtom === hostAtom)) {
        let preflightAtoms = null;
        if (profile.preflightExports) {
          try {
            const fields = Object.entries(profile.preflightExports);
            if (fields.every(([, name]) => Object.hasOwn(exports, name) && exports[name]))
              preflightAtoms = Object.fromEntries(fields.map(([field, name]) => [field, exports[name]]));
          } catch { /* Optional preflight failure must not disable the usage meter. */ }
        }
        matches.push({ usageAtom, hostAtom, preflightAtoms, appVersion: profile.appVersion });
      }
    } catch { /* Do not let one unreadable export trigger arbitrary fallback module execution. */ }
  }
  return matches.length === 1 ? matches[0] : null;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const MESSAGES = {
  waiting: '等待当前对话的上下文用量',
  initializing: '等待 Codex 初始化当前页面的用量模块',
  unsupported: '当前 Codex 版本尚未适配左栏监控',
  ambiguous: '未能唯一确认当前对话，监控已暂停',
  unavailable: '当前页面没有可读取的本地对话',
  failed: '上下文读取暂不可用，正在重试',
  stopped: '监控已停止',
};
export function scalarSnapshot(threadId, usage) {
  const used = usage?.last?.totalTokens, capacity = usage?.modelContextWindow;
  if (!UUID.test(threadId ?? '') || !Number.isSafeInteger(used) || used < 0 ||
      !Number.isSafeInteger(capacity) || capacity <= 0) return null;
  return { threadId, capacity, used, percent: clamp(100 * (1 - used / capacity), 0, 100), source: 'native-token-usage' };
}
export function isVisible(el) {
  if (!el?.isConnected || el.closest('[hidden], [inert], [aria-hidden="true"], [data-app-shell-active-page="false"]')) return false;
  const box = el.getBoundingClientRect(), style = getComputedStyle(el);
  return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}
function scopeLike(value) {
  return value && typeof value === 'object' && typeof value.get === 'function' && typeof value.watch === 'function';
}
// Only the visible composer's ancestor chain is inspected; no message content or React tree crawl.
export function composerFiber(element) {
  // ProseMirror creates its editable node outside React. Start at its nearest
  // React-owned DOM ancestor, stopping at the known composer root boundary.
  for (let node = element, depth = 0; node && depth < 16; node = node.parentElement, depth++) {
    const key = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
    if (key) return node[key];
    if (node.hasAttribute?.('data-codex-composer-root')) break;
  }
  return null;
}
export function composerScopes(element, maxDepth = 40) {
  const found = new Set();
  const add = value => {
    for (const candidate of [value, value?.current, value?.scope]) {
      if (scopeLike(candidate) && candidate.value && typeof candidate.value.kind === 'string') found.add(candidate);
    }
  };
  for (let fiber = composerFiber(element), depth = 0; fiber && depth < maxDepth; fiber = fiber.return, depth++) {
    // memoizedProps/state only: pendingProps/alternate may belong to a previous or uncommitted chat.
    add(fiber.memoizedProps?.value);
    for (let hook = fiber.memoizedState, i = 0; hook && i < 160; hook = hook.next, i++) add(hook.memoizedState);
    for (let dep = fiber.dependencies?.firstContext, i = 0; dep && i < 40; dep = dep.next, i++) add(dep.memoizedValue);
  }
  return [...found];
}
export function chooseComposer(scopes) {
  const main = scopes.filter(s => s.value?.placement === 'main');
  if (!main.length) return { status: 'unavailable' };
  // A new/remote composer must invalidate the old reading, even if it has no thread UUID.
  if (main.some(s => s.value.kind !== 'local' || !UUID.test(s.value.conversationId ?? ''))) return { status: 'unavailable' };
  const ids = new Set(main.map(s => s.value.conversationId));
  if (ids.size !== 1) return { status: 'ambiguous' };
  return { status: 'ready', threadId: main[0].value.conversationId, scope: main[0] };
}
export function capacityPreflight(values = {}) {
  const known = (value, options) => options.includes(value) ? value : null;
  const boolean = value => typeof value === 'boolean' ? value : null;
  const model = typeof values.model === 'string' && /^[a-zA-Z0-9._:-]{1,96}$/.test(values.model) ? values.model : null;
  const resumeState = known(values.resumeState, ['resumed', 'resuming', 'not-resumed', 'notResumed', 'failed']);
  const responseInProgress = boolean(values.responseInProgress), ephemeral = boolean(values.ephemeral);
  const runtimeStatus = known(values.runtimeStatus?.type, ['idle', 'active', 'notLoaded', 'systemError']);
  const latestTurnStatus = known(values.latestTurnStatus, ['inProgress', 'completed', 'interrupted', 'failed']);
  const requestCount = Number.isSafeInteger(values.requestCount) && values.requestCount >= 0 && values.requestCount <= 10000 ? values.requestCount : null;
  // Keep the presence only; approval/elicitation payloads never leave native state.
  const pendingRequest = values.pendingRequestKind === null ? false : typeof values.pendingRequestKind === 'string' ? true : null;
  const identityKnown = values.host === 'local' && UUID.test(values.threadId ?? '');
  const idle = responseInProgress === true || runtimeStatus === 'active' || latestTurnStatus === 'inProgress' ? false :
    responseInProgress === false && runtimeStatus === 'idle' && ['completed', 'interrupted', 'failed'].includes(latestTurnStatus) ? true : null;
  const reasons = [];
  if (!identityKnown) reasons.push('local-thread-unverified');
  if (!model) reasons.push('model-unavailable');
  if (resumeState !== 'resumed') reasons.push('thread-not-resumed');
  if (idle !== true) reasons.push(idle === false ? 'thread-busy' : 'idle-unverified');
  if (requestCount !== 0 || pendingRequest !== false) reasons.push('requests-not-cleared');
  if (ephemeral !== false) reasons.push('persistent-thread-unverified');
  // A scalar readiness snapshot is not an exclusive lease and cannot authorize writes.
  reasons.push('exclusive-ownership-unverified', 'settings-preservation-unverified', 'ui-hydration-unverified');
  return { mode: 'read-only', canApply: false, threadId: identityKnown ? values.threadId : null,
    host: identityKnown ? 'local' : null, model, resumeState, responseInProgress, runtimeStatus,
    latestTurnStatus, requestCount, pendingRequest, ephemeral, idle, reasons };
}
export class NativeSource {
  constructor() { this.module = null; this.runtime = null; this.runtimeProfile = null; this.loading = null; this.stopped = false; this.binding = null; this.loadStatus = 'unsupported'; }
  unbind() { const old = this.binding; this.binding = null; try { old?.dispose?.(); } catch { /* A dead native scope may already have disposed itself. */ } }
  empty(status, threadId = null) { this.unbind(); return { status, threadId, snapshot: null }; }
  async load() {
    if (this.module) return this.module;
    if (this.runtime && this.runtimeProfile) { this.loadStatus = 'initializing'; return cachedBindings(this.runtime, this.runtimeProfile); }
    if (this.loading) return this.loading;
    // Import only a verified, already loaded App asset; no direct RPC or extra HTTP service.
    const entries = [
      ...document.querySelectorAll('script[src], link[rel="modulepreload"][href]'),
    ].map(el => el.src || el.href).concat(performance.getEntriesByType('resource').map(e => e.name));
    const candidates = [...new Set(entries)].flatMap(value => {
      try {
        const url = new URL(value);
        if (url.protocol !== 'app:' || url.host !== '-' || url.search || url.hash) return [];
        const profile = PROFILES.find(p => url.pathname === `/assets/${p.asset}`);
        return profile ? [{ url: url.href, profile }] : [];
      } catch { return []; }
    });
    this.loadStatus = 'unsupported';
    if (candidates.length !== 1) return null;
    const { url, profile } = candidates[0];
    this.loading = import(url).then(mod => {
      if (this.stopped) return null;
      if (profile.kind === 'rspack') {
        this.runtime = mod; this.runtimeProfile = profile; this.loadStatus = 'initializing';
        return cachedBindings(mod, profile);
      }
      if (!mod[profile.usageExport] || !mod[profile.hostExport]) return null;
      this.module = { usageAtom: mod[profile.usageExport], hostAtom: mod[profile.hostExport], appVersion: profile.appVersion };
      return this.module;
    }).finally(() => { this.loading = null; });
    return this.loading;
  }
  selection() {
    const elements = [...document.querySelectorAll('[data-codex-composer]')].filter(isVisible);
    return chooseComposer([...new Set(elements.flatMap(el => composerScopes(el)))]);
  }
  preflight(selected, mod) {
    if (this.stopped || selected?.status !== 'ready' || !mod?.preflightAtoms) return capacityPreflight();
    try {
      const { scope, threadId } = selected;
      const host = scope.get(mod.hostAtom, threadId);
      if (host !== 'local') return capacityPreflight();
      const values = Object.fromEntries(Object.entries(mod.preflightAtoms).map(([name, atom]) => [name, scope.get(atom, threadId)]));
      const after = this.selection();
      if (after.threadId !== threadId || after.scope !== scope || scope.get(mod.hostAtom, threadId) !== host) return capacityPreflight();
      return capacityPreflight({ ...values, host, threadId });
    } catch { return capacityPreflight(); }
  }
  currentPreflight() {
    const mod=this.module ?? (this.runtime && this.runtimeProfile ? cachedBindings(this.runtime,this.runtimeProfile) : null);
    return this.preflight(this.selection(),mod);
  }
  diagnostics() {
    // Fixed, bounded scalar diagnostics only; no text, React props, URLs or arbitrary selectors.
    const elements = [...document.querySelectorAll('[data-codex-composer]')];
    const visible = elements.filter(isVisible);
    const scopes = [...new Set(visible.flatMap(el => composerScopes(el)))];
    const selected = chooseComposer(scopes);
    const hints = list => list.slice(0, 8).map(scope => ({
      kind: ['local', 'remote', 'new'].includes(scope.value?.kind) ? scope.value.kind : 'other',
      placement: ['main', 'side', 'sidebar'].includes(scope.value?.placement) ? scope.value.placement : 'other',
      hasConversationId: UUID.test(scope.value?.conversationId ?? ''),
    }));
    let host = null;
    const mod = this.module ?? (this.runtime && this.runtimeProfile ? cachedBindings(this.runtime, this.runtimeProfile) : null);
    if (selected.scope && mod) {
      try { const value = selected.scope.get(mod.hostAtom, selected.threadId); host = value === 'local' ? 'local' : value == null ? 'missing' : 'other'; }
      catch { host = 'unreadable'; }
    }
    return { profile: mod?.appVersion ?? null, visibility: document.visibilityState,
      composerCount: elements.length, visibleComposerCount: visible.length,
      fiberComposerCount: visible.filter(el => Object.keys(el).some(k => k.startsWith('__reactFiber$'))).length,
      fiberAnchorCount: visible.filter(el => composerFiber(el)).length,
      scopeCount: scopes.length, scopes: hints(scopes),
      selection: selected.status, host, capacityPreflight: this.preflight(selected, mod) };
  }
  async read() {
    if (this.stopped) return { status: 'stopped', snapshot: null };
    try {
      const mod = await this.load();
      if (this.stopped) return { status: 'stopped', snapshot: null };
      if (!mod) return this.empty(this.loadStatus);
      const selected = this.selection();
      if (selected.status !== 'ready') return this.empty(selected.status);
      const { scope, threadId } = selected;
      if (scope.get(mod.hostAtom, threadId) !== 'local') return this.empty('unavailable');
      const preflightAtoms = Object.values(mod.preflightAtoms ?? {});
      if (this.binding?.scope !== scope || this.binding?.threadId !== threadId || this.binding?.usageAtom !== mod.usageAtom || this.binding?.hostAtom !== mod.hostAtom ||
          preflightAtoms.length !== this.binding?.preflightAtoms?.length || preflightAtoms.some((atom, i) => atom !== this.binding.preflightAtoms[i])) {
        this.unbind();
        // Keep only this chat's native state subscription alive. Release it on navigation/disable.
        const dispose = scope.watch(({ get }) => {
          get(mod.usageAtom, threadId);
          for (const atom of preflightAtoms) { try { get(atom, threadId); } catch { /* Keep usage alive if an optional selector is unavailable. */ } }
        });
        this.binding = { scope, threadId, usageAtom: mod.usageAtom, hostAtom: mod.hostAtom, preflightAtoms, dispose: typeof dispose === 'function' ? dispose : null };
      }
      const usage = scope.get(mod.usageAtom, threadId);
      const after = this.selection();
      if (after.threadId !== threadId || after.scope !== scope) return this.empty('ambiguous');
      const snapshot = scalarSnapshot(threadId, usage);
      return { status: snapshot ? 'following' : 'waiting', threadId, snapshot };
    } catch { this.module = null; this.runtime = null; this.runtimeProfile = null; return this.empty('failed'); }
  }
  close() { this.stopped = true; this.unbind(); this.module = null; this.runtime = null; this.runtimeProfile = null; }
}
