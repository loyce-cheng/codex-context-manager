// Protocol controller, deliberately independent of the desktop renderer.
// A native adapter must first prove that it can hold automatic resumes/new turns,
// exclude other subscribers, and preserve the complete current resume settings.
// The shipped sidebar has no such adapter and cannot call this controller.
import {capacityLevels,capacityRequest} from './capacity.mjs';
import {targetPreferenceKey,readTargetPreference} from './target-preference.mjs';
const ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const CONFIG_KEYS = ['model_context_window', 'model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class CapacityReloadError extends Error {
  constructor(code, { recovery = 'not-needed', cause } = {}) {
    super(code, { cause }); this.code = code; this.recovery = recovery;
  }
}
function validatePlan(plan) {
  if (!ID.test(plan?.threadId ?? '') || plan.host !== 'local' || typeof plan.model !== 'string' || !plan.model.length ||
      !Number.isSafeInteger(plan.config?.model_context_window) || plan.config.model_context_window <= 0 ||
      !Number.isSafeInteger(plan.config?.model_auto_compact_token_limit) || plan.config.model_auto_compact_token_limit <= 0 ||
      plan.config.model_auto_compact_token_limit >= plan.config.model_context_window ||
      plan.config.model_auto_compact_token_limit_scope !== 'total' ||
      Object.keys(plan.config).some(key => !CONFIG_KEYS.includes(key))) throw new CapacityReloadError('INVALID_CAPACITY_PLAN');
}
function checkLease(lease, plan) {
  if (lease?.host !== 'local' || lease.threadId !== plan.threadId || lease.model !== plan.model ||
      lease.exclusive !== true || lease.holdsTurnsAndResumes !== true || lease.settingsPreserved !== true ||
      typeof lease.check !== 'function' || typeof lease.request !== 'function' || typeof lease.release !== 'function') throw new CapacityReloadError('RELOAD_LEASE_UNVERIFIED');
  const p = lease.resumeParams;
  if (p?.threadId !== plan.threadId || p.model !== plan.model || Object.hasOwn(p, 'history') || Object.hasOwn(p, 'path') ||
      !p.config || typeof p.config !== 'object' || Array.isArray(p.config) ||
      !Number.isSafeInteger(p.config.model_context_window) || p.config.model_context_window <= 0 ||
      !Object.hasOwn(p.config, 'model_auto_compact_token_limit') || !Object.hasOwn(p.config, 'model_auto_compact_token_limit_scope'))
    throw new CapacityReloadError('RESUME_SETTINGS_UNVERIFIED');
}

// For a host already restoring a thread. Keep its original hydration and permission
// choices, including omitted fields. This helper does not initiate an RPC.
export function resumeWithCapacity(params, plan, resolved) {
  validatePlan(plan);
  // Desktop requests can include a rollout path. For an unloaded thread the
  // server gives that path precedence, so check it against independent thread
  // metadata and the filename's ID before preserving it.
  const path=params?.path;
  const verifiedPath=typeof path==='string' && path===resolved?.threadMetadata?.path &&
    resolved.threadMetadata.id===plan.threadId && path.toLowerCase().endsWith('-'+plan.threadId.toLowerCase()+'.jsonl');
  if(params?.threadId!==plan.threadId || resolved?.threadId!==plan.threadId ||
      resolved.host!==plan.host || resolved.model!==plan.model ||
      (params.model!=null && params.model!==resolved.model) ||
      params.history!=null || (path!=null && !verifiedPath) ||
      (params.config!=null && (typeof params.config!=='object'||Array.isArray(params.config)))) {
    throw new CapacityReloadError('RESUME_SETTINGS_UNVERIFIED');
  }
  return {...params,config:{...params.config,...plan.config}};
}

// Only enrich a resume the host already intends to send. If a saved target
// cannot be checked, preserve the exact native request and its defaults.
export function resumeWithSavedTarget(params,{snapshot,model,threadMetadata,readPreference}) {
  if (!ID.test(params?.threadId??'') || !snapshot || snapshot.host!=='local' || snapshot.threadId!==params.threadId ||
      snapshot.model!==model?.slug || threadMetadata?.id!==params.threadId ||
      threadMetadata.status?.type!=='notLoaded' || threadMetadata.ephemeral!==false ||
      threadMetadata.model!==snapshot.model || !snapshot.modelProvider ||
      threadMetadata.modelProvider!==snapshot.modelProvider ||
      (params.modelProvider!=null && params.modelProvider!==snapshot.modelProvider)) return params;
  try {
    const tier=readTargetPreference(readPreference,targetPreferenceKey(snapshot.threadId,snapshot.model),capacityLevels(model));
    if(tier===null || tier===model.context_window)return params;
    const plan=capacityRequest(snapshot,model,tier);
    if(CONFIG_KEYS.some(key=>params.config?.[key]!=null && params.config[key]!==plan.config[key]))return params;
    return resumeWithCapacity(params,plan,{...snapshot,threadMetadata});
  } catch {return params;}
}

// Called by the owner of an ordinary thread/resume, with its original request.
// Returning to the chat must still work when an expansion is no longer eligible.
export async function resumeWithRequestedExpansion(params,{plan,model,host,getSnapshot,readThread,resume,isCurrent}) {
  let next=params, expectedProvider;
  if(host==='local' && plan?.host===host && plan.threadId===params?.threadId &&
      plan.model===model?.slug && ID.test(plan.threadId) && params.history==null){
    try {
      const {thread}=isCurrent()?await readThread({threadId:plan.threadId,includeTurns:false}):{};
      const snapshot=getSnapshot();
      if(isCurrent() && thread?.id===plan.threadId && thread.status?.type==='notLoaded' &&
          thread.ephemeral===false && thread.model===plan.model &&
          typeof thread.modelProvider==='string' && thread.modelProvider.length>0 &&
          thread.modelProvider===snapshot?.modelProvider &&
          (params.modelProvider==null || params.modelProvider===thread.modelProvider) &&
          snapshot.threadId===plan.threadId && snapshot.capacity===plan.previousUsableWindow) {
        const checked=capacityRequest(snapshot,model,plan.requestedWindow);
        if(checked.expectedUsableWindow===plan.expectedUsableWindow &&
            checked.expectedUsableWindow>snapshot.capacity &&
            !CONFIG_KEYS.some(key=>params.config?.[key]!=null && params.config[key]!==checked.config[key])){
          next=resumeWithCapacity(params,checked,{...snapshot,threadMetadata:thread});
          expectedProvider=thread.modelProvider;
        }
      }
    } catch { /* A failed metadata/limits check leaves the native resume intact. */ }
  }
  // Keep dispatch outside the preflight catch. Never replay an ambiguous resume.
  const response=await resume(next);
  if(next===params)return {response,state:'unchanged'};
  const same=response?.thread?.id===plan.threadId && response.model===plan.model &&
    response.modelProvider===expectedProvider;
  return {response,state:same?'awaiting-observation':'unconfirmed'};
}
// Do not mistake a missing ID on page 1, an RPC failure, or a corrupt page for
// proof of unload. The exclusive lease must also prevent concurrent reloading.
export async function threadIsLoaded(request, threadId) {
  let cursor = null; const cursors = new Set();
  for (let page = 0; page < 32; page++) {
    const value = await request('thread/loaded/list', { limit: 100, ...(cursor === null ? {} : { cursor }) });
    if (!Array.isArray(value?.data) || value.data.some(id => !ID.test(id)) ||
        !(value.nextCursor === null || typeof value.nextCursor === 'string' && value.nextCursor.length > 0))
      throw new CapacityReloadError('LOADED_STATE_UNVERIFIED');
    if (value.data.includes(threadId)) return true;
    if (value.nextCursor === null) return false;
    if (cursors.has(value.nextCursor)) throw new CapacityReloadError('LOADED_STATE_UNVERIFIED');
    cursors.add(value.nextCursor); cursor = value.nextCursor;
  }
  throw new CapacityReloadError('LOADED_STATE_UNVERIFIED');
}
export class ThreadCapacityReloader {
  constructor({ acquire, now = Date.now, wait = sleep, unloadTimeoutMs = 120000, pollMs = 500 }) {
    this.acquire = acquire; this.now = now; this.wait = wait;
    this.unloadTimeoutMs = unloadTimeoutMs; this.pollMs = pollMs; this.running = false;
  }
  async reloadThread(input, { isCurrent = () => true, signal, onPhase = () => {} } = {}) {
    if (this.running) throw new CapacityReloadError('CAPACITY_CHANGE_IN_PROGRESS');
    validatePlan(input);
    const plan = structuredClone(input);
    this.running = true;
    let lease, original, unsubscribeIssued = false, unsubscribeSettled = false, resumeIssued = false, resumeAcknowledged = false;
    const emit = phase => { try { onPhase(phase); } catch { /* Observers cannot break recovery. */ } };
    const current = () => { if (signal?.aborted || !isCurrent()) throw new CapacityReloadError('CAPACITY_CHANGE_CANCELLED'); };
    let recovery = 'not-needed', primaryFailure;
    try {
      current(); emit('checking');
      lease = await this.acquire(plan);
      checkLease(lease, plan);
      original = structuredClone(lease.resumeParams);
      const safe = async () => {
        current();
        const state = await lease.check();
        current();
        if (state?.threadId !== plan.threadId || state.host !== plan.host || state.model !== plan.model ||
            state.idle !== true || state.exclusive !== true || state.holdsTurnsAndResumes !== true)
          throw new CapacityReloadError('THREAD_NOT_SAFE_TO_RELOAD');
      };
      await safe();
      emit('releasing'); unsubscribeIssued = true;
      const result = await lease.request('thread/unsubscribe', { threadId: plan.threadId });
      unsubscribeSettled = true;
      if (!['unsubscribed', 'notLoaded'].includes(result?.status)) throw new CapacityReloadError('THREAD_RELEASE_UNCONFIRMED');
      emit('waiting-for-unload');
      const deadline = this.now() + this.unloadTimeoutMs;
      for (;;) {
        await safe();
        if (!await threadIsLoaded(lease.request, plan.threadId)) break;
        if (this.now() >= deadline) throw new CapacityReloadError('THREAD_UNLOAD_TIMEOUT');
        await this.wait(Math.min(this.pollMs, Math.max(1, deadline - this.now())));
      }
      await safe();
      emit('resuming'); resumeIssued = true;
      const response = await lease.request('thread/resume', resumeWithCapacity({...original,excludeTurns:true},plan,lease));
      // An error/timeout after dispatch can be ambiguous. Never report rollback
      // or issue competing settings blindly after an unknown resume outcome.
      if (response?.thread?.id !== plan.threadId) throw new CapacityReloadError('RESUME_IDENTITY_UNCONFIRMED');
      resumeAcknowledged = true;
      emit('awaiting-observation');
      return { threadId: plan.threadId, state: 'awaiting-observation', observedCapacity: null };
    } catch (cause) {
      if (unsubscribeIssued && !resumeIssued && original) {
        emit('restoring');
        try {
          // Recovery always targets the captured original thread, even after
          // navigation. It preserves the old overrides and never sends a turn.
          const response = await lease.request('thread/resume', { ...original, excludeTurns: true });
          recovery = unsubscribeSettled && response?.thread?.id === plan.threadId ? 'restored' : 'required';
        } catch { recovery = 'required'; }
      } else if (resumeIssued && !resumeAcknowledged) recovery = 'required';
      emit(recovery === 'required' ? 'recovery-required' : 'failed');
      primaryFailure=new CapacityReloadError(cause.code ?? 'CAPACITY_RELOAD_FAILED', { recovery, cause });
      throw primaryFailure;
    } finally {
      try { await lease?.release?.({ recovery, resumeAcknowledged }); }
      catch (cause) {
        if(primaryFailure)throw new CapacityReloadError(primaryFailure.code,{recovery:'required',cause:new AggregateError([primaryFailure,cause],'Reload and lease release failed')});
        throw new CapacityReloadError('RELOAD_LEASE_RELEASE_FAILED', { recovery: 'required', cause });
      }
      finally { this.running = false; }
    }
  }
}
