const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const positive = v => /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
const bool = v => v === 'true' ? true : v === 'false' ? false : null;
const ROUTE_EVENT = 'IAB_LIFECYCLE received browser sidebar owner sync';
export const FOLLOW_MESSAGES = {
  waiting: '等待对话确认：请在 Codex 切换一次对话', following: '跟随新对话', historical: '仅新对话模式：当前对话不在登记范围。跟随已有对话请运行新版 Start.cmd',
  unfocused: '等待 Codex 窗口获得焦点', ambiguous: '多个窗口状态冲突，暂不显示用量',
  expired: '页面信号已过期，请切换对话重新确认', unavailable: '日志读取中断，等待恢复',
  unsupported: '当前页面或日志格式不支持', 'snapshot-unavailable': '等待此对话的本地用量快照',
};

/** Parse only logger-owned scalar fields. Ignore payloads, titles, tool text and browser ownership IDs. */
export function parseDesktopLine(line, sessionId) {
  if (typeof line !== 'string' || line.length > 65536 || !UUID.test(sessionId)) return [];
  const prefix = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) info \[electron-message-handler\] /.exec(line);
  if (!prefix) return [];
  const at = Date.parse(prefix[1]); if (!Number.isFinite(at)) return [];
  const rest = line.slice(prefix[0].length), first = rest.search(/\b[A-Za-z][A-Za-z0-9_]*=/);
  const invalidRoute = () => [{at,sessionId:sessionId.toLowerCase(),type:'invalid-route'}];
  if (first < 0) return rest.trim()===ROUTE_EVENT ? invalidRoute() : [];
  const label = rest.slice(0, first).trim(), fields = new Map();
  const keys = new Set(['threadId','conversationId','ownerRoutePath','windowId','originWebContentsId','rendererWindowId','rendererWebContentsId','rendererWindowAppearance','rendererWindowVisible','rendererWindowFocused']);
  for (const m of rest.slice(first).matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_]*)=("(?:\\.|[^"\\])*"|\S+)/g)) {
    if (!keys.has(m[1])) continue;
    if (fields.has(m[1])) return label===ROUTE_EVENT ? invalidRoute() : [];
    let v=m[2]; if(v.startsWith('"')) {try{v=JSON.parse(v);}catch{return label===ROUTE_EVENT ? invalidRoute() : [];}}
    fields.set(m[1],v);
  }
  const get=k=>fields.get(k), events=[], base={at,sessionId:sessionId.toLowerCase()};
  if (positive(get('rendererWindowId')) && positive(get('rendererWebContentsId')) && get('rendererWindowAppearance')==='primary' && bool(get('rendererWindowVisible'))!==null && bool(get('rendererWindowFocused'))!==null) {
    events.push({...base,type:'window',windowId:Number(get('rendererWindowId')),rendererId:Number(get('rendererWebContentsId')),visible:bool(get('rendererWindowVisible')),focused:bool(get('rendererWindowFocused'))});
  }
  if(label==='Conversation created' && UUID.test(get('threadId')??'') && get('threadId')===get('conversationId'))events.push({...base,type:'created',threadId:get('threadId').toLowerCase()});
  if(label===ROUTE_EVENT) {
    // A missed or unidentifiable navigation must not leave the previous selection alive.
    if(!positive(get('windowId'))||!positive(get('originWebContentsId')))return invalidRoute();
    const route=get('ownerRoutePath'); let threadId=null;
    // Match the original pathname, before URL normalization can erase ../ or backslashes.
    if(typeof route==='string' && !route.includes('\\')) {
      const match=/^\/local\/([^/?#]+)(\?[^#]*)?$/.exec(route);
      if(match&&UUID.test(match[1])) {
        // Sidebar clicks omit the query; the navigation tool explicitly adds hostId=local.
        // Only these verified forms are supported. A query must still identify a local host.
        if(!match[2])threadId=match[1].toLowerCase();
        else try{const url=new URL(route,'https://context-lens.invalid');if(url.searchParams.getAll('hostId').length===1&&url.searchParams.get('hostId')==='local')threadId=match[1].toLowerCase();}catch{}
      }
    }
    events.push({...base,type:'route',windowId:Number(get('windowId')),rendererId:Number(get('originWebContentsId')),threadId});
  }
  return events;
}

/** Window state and new-chat enrollment are independent; file modification time never selects a chat. */
export class FollowRegistry {
  constructor({startedAt=Date.now(),routeTtlMs=null,windowTtlMs=25000,now=Date.now,scope='new'}={}) {
    if(!['new','active'].includes(scope))throw new Error('Unknown follow scope');this.scope=scope;
    this.startedAt=startedAt;this.routeTtlMs=routeTtlMs;this.windowTtlMs=windowTtlMs;this.now=now;
    this.enrolled=new Set();this.windows=new Map();this.pending=new Map();this.session=null;this.sessionAt=0;this.retired=new Set();this.revision=0;this.healthy=true;
  }
  invalidate(reason='unavailable') {this.windows.clear();this.pending.clear();this.healthy=false;this.reason=reason;this.startedAt=this.now();this.revision++;}
  recover(){this.healthy=true;this.reason=null;this.revision++;}
  ingest(events) {
    for(const e of events) {
      if(!this.healthy||e.at<this.startedAt||e.at>this.now()+2000||this.retired.has(e.sessionId))continue;
      if(e.type==='invalid-route'){this.invalidate('unsupported');return;}
      if(e.type==='created'){this.enrolled.add(e.threadId);this.revision++;continue;}
      if(e.type==='route') {
        const k=`${e.sessionId}:${e.windowId}:${e.rendererId}`,old=this.pending.get(k);
        if(!old||e.at>=old.at)this.pending.set(k,e);
        if(this.pending.size>64)this.pending.delete(this.pending.keys().next().value);
      }
      // Only a fresh primary-window observation establishes/replaces an app session.
      if(e.sessionId!==this.session){
        if(e.type!=='window'||!e.visible||e.at<this.sessionAt)continue;
        if(this.session)this.retired.add(this.session);
        this.session=e.sessionId;this.sessionAt=e.at;this.windows.clear();this.revision++;
      }
      const key=String(e.windowId);let w=this.windows.get(key);
      if(e.type==='window') {
        if(w&&e.at<w.observedAt)continue;
        if(!w||w.rendererId!==e.rendererId){w={key:`${e.sessionId}:${e.windowId}:${e.rendererId}`,windowId:e.windowId,rendererId:e.rendererId,route:null};this.windows.set(key,w);}
        // Windows gives focus to one primary window. A newer positive observation supersedes older ones.
        if(e.focused&&e.visible)for(const other of this.windows.values())if(other!==w&&other.observedAt<e.at)other.focused=false;
        Object.assign(w,{visible:e.visible,focused:e.focused,observedAt:e.at});this.revision++;
        const p=this.pending.get(w.key);if(p&&(!w.route||p.at>w.route.at))w.route={at:p.at,threadId:p.threadId};
      } else if(e.type==='route'&&w&&w.rendererId===e.rendererId&&(!w.route||e.at>=w.route.at)) {
        w.route={at:e.at,threadId:e.threadId};this.revision++;
      }
      // An explicit active-chat mode accepts a fresh route only after primary-renderer verification.
      if(this.scope==='active'&&w?.route?.threadId)this.enrolled.add(w.route.threadId);
    }
  }
  view() {
    const now=this.now();
    const windows=[...this.windows.values()].slice(0,16).map(w=>{
      const fresh=now-w.observedAt<this.windowTtlMs;
      // Route events describe changes, not heartbeats. Retain a route only while
      // the reader has uninterrupted coverage and this primary window stays fresh.
      // A numeric route TTL is retained for strict adapters and regression fixtures.
      const routeDeadline=this.routeTtlMs===null?Infinity:(w.route?.at??0)+this.routeTtlMs;
      let state=!fresh?'expired':!w.visible?'unfocused':!w.route?'waiting':now>=routeDeadline?'expired':!w.route.threadId?'unsupported':!this.enrolled.has(w.route.threadId)?'historical':'following';
      return {key:w.key,windowId:w.windowId,label:`窗口 ${w.windowId}`,visible:fresh&&w.visible,focused:fresh&&w.visible&&w.focused,state,threadId:state==='following'?w.route.threadId:null,
        validUntil:w.route?Math.min(w.observedAt+this.windowTtlMs,routeDeadline):0,confirmedAt:w.route?.at??null,message:state==='following'&&this.scope==='active'?'跟随当前本地对话':FOLLOW_MESSAGES[state]};
    });
    const focused=windows.filter(w=>w.focused);let state,selected=null;
    if(!this.healthy)state=this.reason??'unavailable';
    else if(focused.length>1||this.windows.size>16)state='ambiguous';
    else if(focused.length===1){selected=focused[0];state=selected.state;}
    // A standalone monitor takes foreground focus itself. One known visible Codex window
    // is unambiguous even while unfocused; multiple windows still require focus or pinning.
    else if(windows.length===1&&windows[0].visible){selected=windows[0];state=selected.state;}
    else state=windows.length?'unfocused':'waiting';
    return {mode:'desktop-log-'+this.scope,state,message:state==='following'?selected.message:FOLLOW_MESSAGES[state]??FOLLOW_MESSAGES.unavailable,selectedWindowKey:selected?.key??null,threadId:state==='following'?selected.threadId:null,
      validUntil:selected?.validUntil??0,windows,registeredCount:this.enrolled.size,revision:this.revision,scope:this.scope==='active'?'selected-local':'since-monitor-start',routeTtlMs:this.routeTtlMs,selectionPolicy:this.routeTtlMs===null?'continuous-log':'timed-route'};
  }
}
