import { buildTiers, remainingPercent, WarningTracker, clamp, finite, VERSION, selectFollowEnvelope } from '../core/context.mjs';

const $ = id => document.getElementById(id);
const ids = ['setup','threads','bind','stage','meter','grip','rail','fill','thumb','reading','phase','capacity','percent','horizontal-preview','slider','menu','notice','notice-text','notice-action','dismiss','details','facts','limitations','details-close','status','mode-label','connection','follow-empty','follow-window','follow-options','resume-follow','host-mode'];
const el = Object.fromEntries(ids.map(id => [id, $(id)]));
const coarse = matchMedia('(pointer:coarse)').matches;
const warnings = new WarningTracker();
let snapshot=null, capabilities={}, threadId=null, bindingEpoch=0, demo=false, demoUsed=180000;
let phase='idle', draft=0, raw=null, orientation='vertical', docked=true, x=0, y=20, geom=null, drag=null, move=null;
let holdTimer=null, holdEpoch=0, pollTimer=null, polling=false, disconnected=false, suppressClick=0;
let noticeTimer=null, noticeLeft=5000, noticeStarted=0, noticeHover=false, noticeFocus=false;
let autoFollow=false,followData=null,followWindowKey=null,followSelectedKey=null,followDeadline=null;
let backendVersion=null;
const followCurrent=()=>followData?.follow?.scope==='selected-local';
const modeLabel=()=>demo?'演示 · 不修改真实会话':autoFollow?(followCurrent()?'实验 · 当前对话':'实验 · 仅新对话'):'只读 · 固定会话';
const say = text => el.status.textContent=text;
const isHost = window.parent !== window;

class Bridge {
  constructor(){
    this.pending=new Map();this.nextId=1;
    this.hostContext={};this.mcpReady=false;this.displayPending=false;
    this.fileMode=location.protocol==='file:';
    window.addEventListener('message',e=>{
      if(e.source!==window.parent||!e.data||e.data.jsonrpc!=='2.0')return;
      const p=this.pending.get(e.data.id);
      if(p){clearTimeout(p.timer);this.pending.delete(e.data.id);e.data.error?p.reject(new Error(e.data.error.message)):p.resolve(e.data.result);}
      if(e.data.method==='ui/notifications/tool-result')receiveToolResult(e.data.params);
      if(e.data.method==='ui/notifications/host-context-changed')this.updateHostContext(e.data.params);
    });
    window.addEventListener('openai:set_globals',e=>{if(e.detail?.globals?.toolOutput)receiveToolResult({structuredContent:e.detail.globals.toolOutput});});
    this.token=new URLSearchParams(location.hash.slice(1)).get('token');
  }
  request(method,params={}){
    return new Promise((resolve,reject)=>{const id=this.nextId++;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('宿主未响应界面请求。'));},8000);this.pending.set(id,{resolve,reject,timer});window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});
  }
  async initialize(){
    if(this.fileMode||!isHost){const data=this.fileMode?await this.fileSnapshot():await this.get('/api/bootstrap');backendVersion=data.version??null;capabilities=data.capabilities;if(data.follow){autoFollow=true;applyFollow(data);schedulePoll();}else if(data.threadId)await bindThread(data.threadId);return;}
    if(window.openai?.toolOutput)receiveToolResult({structuredContent:window.openai.toolOutput});
    try{const result=await this.request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'context-lens',version:VERSION},appCapabilities:{availableDisplayModes:['inline','fullscreen']}});this.mcpReady=true;this.updateHostContext(result?.hostContext);window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');}catch(error){if(!window.openai?.callTool)throw error;this.updateHostContext({displayMode:window.openai.displayMode});}
  }
  async get(path){const r=await fetch(path,{headers:{Authorization:'Bearer '+this.token},cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error??'读取失败');return data;}
  fileSnapshot(){return new Promise((resolve,reject)=>{const script=document.createElement('script');const timer=setTimeout(()=>{script.remove();reject(new Error('本地快照读取超时。'));},5000);script.src='./snapshot.js?t='+Date.now();script.onload=()=>{clearTimeout(timer);script.remove();const data=window.__contextLensFile;if(!data||data.error)return reject(new Error(data?.error??'快照为空'));if(!finite(data.generatedAt)||Date.now()-data.generatedAt>(data.follow?4000:5000))return reject(new Error('监控进程已停止更新。请重新运行新版 Start.cmd，并保持启动窗口打开。'));resolve(data);};script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('监控数据源已关闭或不可用。请重新运行新版 Start.cmd，并保持启动窗口打开。'));};document.head.append(script);});}
  async call(name,args={}){
    if(this.fileMode){const data=await this.fileSnapshot();if(name==='read_context_snapshot'&&args.thread_id!==data.threadId)throw new Error('固定模式按启动时选定会话绑定，请重新运行 Start-Fixed.cmd 切换。');return data;}
    if(!isHost){if(name==='list_context_threads')return this.get('/api/threads');if(name==='read_context_snapshot')return this.get('/api/snapshot?thread='+encodeURIComponent(args.thread_id));if(name==='get_context_capabilities')return this.get('/api/bootstrap');throw new Error('不支持的操作。');}
    let result;
    if(this.mcpReady)result=await this.request('tools/call',{name,arguments:args});
    else if(window.openai?.callTool)result=await window.openai.callTool(name,args);
    else throw new Error('宿主界面连接尚未就绪。');
    if(result?.isError)throw new Error(result.content?.[0]?.text??'读取失败');
    if(result?.structuredContent)return result.structuredContent;
    throw new Error('宿主未返回结构化快照。');
  }
  updateHostContext(context){
    if(!context||typeof context!=='object')return;
    this.hostContext={...this.hostContext,...context};
    const {displayMode,availableDisplayModes=[]}=this.hostContext;
    el['host-mode'].hidden=!isHost;
    const target=displayMode==='inline'?'fullscreen':displayMode==='fullscreen'?'inline':null;
    el['host-mode'].textContent=this.displayPending?'切换中…':displayMode==='fullscreen'?'收起监控 ↙':displayMode==='inline'?'展开监控 ↗':'位置未确认';
    el['host-mode'].dataset.mode=displayMode??'unknown';
    el['host-mode'].disabled=this.displayPending||!target||!availableDisplayModes.includes(target);
    el['host-mode'].title=displayMode==='inline'?'点击请求展开；也可使用卡片标题旁的双向斜箭头':displayMode==='fullscreen'?'点击返回对话卡片；位置由 Codex 管理':'等待 Codex 确认显示模式';
    for(const mode of ['inline','fullscreen'])el.menu.querySelector(`[data-action="${mode}"]`).hidden=!availableDisplayModes.includes(mode)||mode===displayMode;
  }
  async display(mode){
    if(!isHost||!this.hostContext.availableDisplayModes?.includes(mode))throw new Error('当前宿主未提供此显示模式。');
    if(this.displayPending)return null;
    this.displayPending=true;this.updateHostContext({});
    try{
      const result=await this.request('ui/request-display-mode',{mode});
      if(result?.mode)this.updateHostContext({displayMode:result.mode});
      if(result?.mode!==mode)throw new Error('Codex 没有切换显示模式，请使用卡片标题旁的双向斜箭头。');
      return result.mode;
    }finally{this.displayPending=false;this.updateHostContext({});}
  }
}
const bridge = new Bridge();
function receiveToolResult(result){
  const data=result?.structuredContent;if(data?.version)backendVersion=data.version;if(data?.capabilities)capabilities=data.capabilities;
  if(data?.follow){
    const newMode=!autoFollow||followData?.follow?.scope!==data.follow.scope;autoFollow=true;
    if(!demo){
      // A restored card may replay an old result into a new server connection.
      // Restore only the chosen mode; a new read must establish the live selection.
      if(isHost){if(newMode){followData=data;el.setup.hidden=true;clearFollow('正在连接自动监控…');}}
      else applyFollow(data);
      schedulePoll();
    }
    return;
  }
  const id=data?.binding?.threadId??data?.snapshot?.threadId;if(id&&!demo&&(!threadId||data.binding)){bindThread(id,data.snapshot).catch(error=>say(error.message));}
}
function clearFollow(message){
  if(snapshot||threadId){resetGesture();bindingEpoch++;}hideNotice();clearTimeout(followDeadline);snapshot=null;threadId=null;followSelectedKey=null;disconnected=true;
  paint();say(message??'等待页面确认');
}
function applyFollow(data){
  followData=data;backendVersion=data.version??backendVersion;capabilities=data.capabilities??capabilities;el.setup.hidden=true;
  const chosen=selectFollowEnvelope(data,followWindowKey),changed=threadId!==chosen.threadId||followSelectedKey!==chosen.windowKey;
  const options=[['','自动跟随当前窗口'],...(data.follow?.windows??[]).map(w=>[w.key,w.label])];
  if(followWindowKey&&!options.some(o=>o[0]===followWindowKey))options.push([followWindowKey,'所选窗口已失效']);
  const signature=JSON.stringify(options);if(el['follow-window'].dataset.options!==signature){el['follow-window'].replaceChildren(...options.map(([value,label])=>new Option(label,value)));el['follow-window'].dataset.options=signature;}el['follow-window'].value=followWindowKey??'';
  if(chosen.state!=='following'){clearFollow(chosen.message);return;}
  if(changed){resetGesture();hideNotice();bindingEpoch++;}
  threadId=chosen.threadId;followSelectedKey=chosen.windowKey;snapshot=chosen.snapshot;disconnected=false;
  if(warnings.observe(snapshot,{initial:changed}))notify(`上下文估算剩余 ${Math.round(snapshot.remainingPercent)}%。接近用满时由 Codex 自动压缩。`);
  clearTimeout(followDeadline);followDeadline=setTimeout(()=>{if(autoFollow&&!demo)clearFollow('页面确认已过期，等待新的切换信号');},Math.max(0,Math.min(chosen.validUntil, data.generatedAt+4000)-Date.now()));
  paint();say(`跟随 ${threadId.slice(0,8)} · ${followWindowKey?'指定窗口':'自动窗口'} · ${followCurrent()?'当前本地对话':'仅本次启动后登记的新对话'}`);
}
function tiers(){return buildTiers({defaultWindow:snapshot?.modelDefaultWindow,maxWindow:snapshot?.modelMaxWindow,currentWindow:snapshot?.displayWindow});}
function clearHold(){clearTimeout(holdTimer);holdTimer=null;holdEpoch++;}
function releaseDrag(){const d=drag;drag=null;if(d&&el.slider.hasPointerCapture(d.id))el.slider.releasePointerCapture(d.id);return d;}
function resetGesture(){clearHold();releaseDrag();move=null;phase='idle';raw=null;el.menu.hidden=true;}
function paint(){
  $('version').textContent=VERSION.includes('-')?VERSION.slice(VERSION.indexOf('-')+1):VERSION;$('version').title=`界面 ${VERSION} · 后端 ${backendVersion??'尚未确认'}`;
  el['follow-options'].hidden=!autoFollow;el['resume-follow'].hidden=!autoFollow||!demo;el['follow-empty'].hidden=!!snapshot||!(autoFollow||threadId||disconnected);
  el['mode-label'].textContent=modeLabel();
  el.connection.textContent=disconnected?'更新暂停':snapshot?.quality==='estimated'?'≈ 估算':snapshot?'已连接':'等待连接';
  el.meter.hidden=!snapshot;if(!snapshot){el.capacity.textContent='—';el.percent.textContent='—';el.fill.style.width='0';el.fill.style.height='0';el.rail.removeAttribute('aria-valuenow');if(!el.details.hidden)drawDetails();return;}
  const list=tiers(),actualIndex=Math.max(0,list.indexOf(snapshot.displayWindow)),editing=phase!=='idle';
  const selected=editing?list[draft]:snapshot.displayWindow;
  const percent=editing&&demo?remainingPercent(snapshot.usedTokens,selected):snapshot.remainingPercent;
  const horizontal=orientation==='horizontal',box=el.stage.getBoundingClientRect();
  const rail=horizontal?clamp(box.width-110,24,220):Math.min(166,box.height-(coarse?154:132));
  const base=rail*.44,point=i=>base+(rail-base)*i/Math.max(1,list.length-1);
  const head=phase==='editing'&&raw!==null?raw:point(editing?draft:actualIndex),length=head;
  const header=(coarse?110:88)+(editing?28:0),width=horizontal?length+102:(coarse?44:docked?36:44),height=horizontal?44:length+header;
  if(drag&&!horizontal&&!docked)y=drag.bottom-height;
  if(docked){x=(box.width-width)/2;y=box.height-height-8;}else{x=clamp(x,4,box.width-width-4);y=clamp(y,4,box.height-height-4);}
  geom={rail,base,point,head,length,width,height,horizontal};
  el.meter.classList.toggle('horizontal',horizontal);
  el.meter.classList.toggle('direct',!!drag||!!move?.moved);el.meter.classList.toggle('floating',!docked);el.meter.classList.toggle('warning',finite(percent)&&percent<=20);el.meter.classList.toggle('preview',phase==='editing'||phase==='applying');el.meter.classList.toggle('disconnected',disconnected);
  Object.assign(el.meter.style,{left:x+'px',top:y+'px',width:width+'px',height:height+'px'});
  el.capacity.textContent=finite(selected)?Math.round(selected/1000)+'k':'—';
  el.percent.textContent=finite(percent)?(snapshot.quality==='estimated'&&!editing?'≈':'')+Math.round(percent)+'%':'—';
  el.phase.textContent=phase==='editing'?'预览':phase==='applying'?'应用中':phase==='settled'?'已应用':'';el.phase.hidden=horizontal||!editing;
  el.reading.title=`${snapshot.quality==='estimated'?'估算剩余':'剩余'} ${finite(percent)?percent.toFixed(1)+'%':'未知'}；${demo?'演示数据':(autoFollow?'跟随会话 ':'固定会话 ')+threadId}`;
  if(finite(percent))el.rail.setAttribute('aria-valuenow',String(percent));else el.rail.removeAttribute('aria-valuenow');
  el.rail.setAttribute('aria-valuetext',finite(percent)?`${snapshot.quality==='estimated'?'估算':''}剩余 ${percent.toFixed(1)}%`:'上下文占用未知');
  el.thumb.hidden=!editing;
  const cx=horizontal?50+head:width/2,hy=horizontal?22:height-12-head,ly=hy-(editing?10:0)-6-(editing?56:38),hit=coarse?44:32;
  el.grip.textContent=horizontal?'':'⠿';el.grip.title=horizontal?'拖动容量标签 · 右击设置':'拖动 · 右击设置';
  Object.assign(el.thumb.style,{left:cx+'px',top:hy+'px'});
  el['horizontal-preview'].hidden=!horizontal||!editing;
  if(horizontal){
    Object.assign(el.reading.style,{display:'contents',left:'',top:''});
    Object.assign(el.capacity.style,{left:'8px',top:'13px',width:'34px'});Object.assign(el.percent.style,{left:(58+head)+'px',top:'13px',width:'36px'});
    Object.assign(el.grip.style,{left:'2px',top:'0px',width:'44px',height:'44px'});
    Object.assign(el.rail.style,{left:'50px',top:'19px',bottom:'auto',width:length+'px',height:'6px'});Object.assign(el.fill.style,{width:(head*(percent??0)/100)+'px',height:'100%'});
    Object.assign(el.slider.style,{left:'42px',top:(22-hit/2)+'px',bottom:'auto',width:(length+16)+'px',height:hit+'px',writingMode:'horizontal-tb',direction:'ltr',cursor:'ew-resize'});
    el['horizontal-preview'].textContent=el.phase.textContent+'\n'+el.capacity.textContent+'\n'+el.percent.textContent;
    Object.assign(el['horizontal-preview'].style,{left:(cx-23)+'px',top:(y>=68?-64:50)+'px'});
  }else{
    Object.assign(el.reading.style,{display:'block',left:(cx-18)+'px',top:ly+'px'});el.capacity.removeAttribute('style');el.percent.removeAttribute('style');
    Object.assign(el.grip.style,{left:(cx-(coarse?22:13))+'px',top:(ly-(coarse?44:22)-4)+'px',width:(coarse?44:26)+'px',height:(coarse?44:22)+'px'});
    Object.assign(el.rail.style,{left:(width/2-3)+'px',top:'auto',bottom:'12px',width:'6px',height:length+'px'});Object.assign(el.fill.style,{width:'100%',height:(head*(percent??0)/100)+'px'});Object.assign(el.slider.style,{left:(width/2-hit/2)+'px',top:'auto',bottom:'1px',width:hit+'px',height:(length+22)+'px',writingMode:'vertical-lr',direction:'rtl',cursor:'ns-resize'});
  }
  el.slider.value=String(head/rail*1000);el.slider.setAttribute('aria-valuetext',`${selected??'未知'} tokens，剩余 ${finite(percent)?Math.round(percent)+'%':'未知'}`);
  el.slider.setAttribute('aria-disabled',String(!demo));el.slider.disabled=phase==='applying';
  if(!el.details.hidden)drawDetails();
}
function drawDetails(){
  el.facts.replaceChildren();
  const entries=[['界面版本',VERSION],['后端版本',backendVersion??'尚未确认'],['模式',modeLabel()],['会话',threadId??'未绑定'],['模型',snapshot?.model??'未知'],['显示容量',snapshot?.displayWindow??'未知'],['容量依据',snapshot?.windowBasis==='catalog-default-match'?'与模型默认值按有效比例匹配（推断）':snapshot?.windowBasis==='reported'?'宿主报告配置':'运行时窗口'],['运行时容量',snapshot?.effectiveWindow??'未知'],['最近请求用量',snapshot?.usedTokens??'未知'],['快照时间',snapshot?.measuredAt??'未知'],['来源',snapshot?.source??'未知'],['显示口径',snapshot?.quality==='estimated'?'估算：100% − 最近请求总用量 ÷ 运行时窗口':snapshot?.quality==='reported'?'宿主报告':'未知']];
  if(autoFollow){const w=followData?.follow?.windows?.find(w=>w.key===followSelectedKey);entries.push(['监控窗口',w?.label??'未确认'],['页面确认时间',w?.confirmedAt?new Date(w.confirmedAt).toLocaleTimeString():'未确认'],['登记范围',followCurrent()?'由新页面信号确认的已有和新本地对话':'本次启动后新建的本地对话']);}
  for(const [name,value] of entries){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=String(value);el.facts.append(dt,dd);}
  el.limitations.textContent=demo?'当前是隔离演示，拖动只更新演示数据。':autoFollow?'实验性日志跟随。'+(followCurrent()?'已有和新对话均可跟随。':'仅登记本次启动后新建的对话。')+(followData?.follow?.selectionPolicy==='continuous-log'?'连续读取日志时保留已确认的选择；窗口状态超过 25 秒未确认、读取中断或切换无法识别时暂停。':'没有新页面确认时最长 60 秒暂停。')+'后台用量不决定选中对话。右击可指定窗口；原生左侧窄条和真实热扩容尚未支持。':'本版本读取本地 token_count 快照；不保证与原生状态百分比完全一致。固定会话模式不跟随切换。'+(bridge.fileMode?' 固定监控另一条对话请重新运行 Start-Fixed.cmd。':'');
}
function pauseNotice(){if(noticeTimer){clearTimeout(noticeTimer);noticeTimer=null;noticeLeft=Math.max(0,noticeLeft-(Date.now()-noticeStarted));}}
function resumeNotice(){if(el.notice.hidden||noticeTimer||noticeHover||noticeFocus)return;noticeStarted=Date.now();noticeTimer=setTimeout(()=>{el.notice.hidden=true;noticeTimer=null;},noticeLeft);}
function notify(text,action=false){pauseNotice();el['notice-text'].textContent=text;el['notice-action'].hidden=!action;el.notice.hidden=false;noticeLeft=5000;noticeHover=false;noticeFocus=false;resumeNotice();}
function hideNotice(){pauseNotice();el.notice.hidden=true;}
function unsupported(){notify('当前版本仅监控。尚未验证本会话扩容接口，因此不会修改容量或全局配置。');say('可从右键菜单进入隔离演示，体验已确认的调节交互。');}
async function listThreads(){const data=await bridge.call('list_context_threads');capabilities=data.capabilities??capabilities;el.threads.replaceChildren();for(const item of data.threads??[]){const option=document.createElement('option');option.value=item.threadId;option.textContent=item.label;el.threads.append(option);}if(threadId)el.threads.value=threadId;}
async function bindThread(id,first){
  resetGesture();hideNotice();clearTimeout(followDeadline);autoFollow=false;demo=false;threadId=id;const epoch=++bindingEpoch;clearTimeout(pollTimer);snapshot=null;paint();
  const data=first?{snapshot:first}:await bridge.call('read_context_snapshot',{thread_id:id});if(epoch!==bindingEpoch)return;
  snapshot=data.snapshot;backendVersion=data.version??backendVersion;capabilities=data.capabilities??capabilities;disconnected=false;warnings.observe(snapshot,{initial:true});el.setup.hidden=true;paint();say('已绑定 '+id.slice(0,8)+'；不会跟随其他会话。');schedulePoll();
}
function schedulePoll(){clearTimeout(pollTimer);if(!demo&&(threadId||autoFollow))pollTimer=setTimeout(poll,autoFollow?(document.hidden?1500:500):(document.hidden?8000:1500));}
async function poll(){
  if(polling||demo||(!threadId&&!autoFollow))return;polling=true;const epoch=bindingEpoch,id=threadId;
  try{
    const followMode=followData?.follow?.scope==='selected-local'?'active':followData?.follow?.scope==='since-monitor-start'?'new':null;
    if(autoFollow&&!followMode)throw new Error('无法确认监控模式，请重新打开监控。');
    const data=await bridge.call(autoFollow?'read_active_context_snapshot':'read_context_snapshot',autoFollow?{follow_mode:followMode}:{thread_id:id});if(epoch!==bindingEpoch||demo)return;if(autoFollow){applyFollow(data);return;}snapshot=data.snapshot;disconnected=false;if(warnings.observe(snapshot))notify(`上下文${snapshot.quality==='estimated'?'估算':''}剩余 ${Math.round(snapshot.remainingPercent)}%。接近用满时由 Codex 自动压缩。`);paint();
  }
  catch(error){if(epoch===bindingEpoch){if(autoFollow)clearFollow(error.message);else{disconnected=true;snapshot=null;paint();say(error.message);}}}
  finally{polling=false;schedulePoll();}
}
function startDemo(){resetGesture();hideNotice();clearTimeout(pollTimer);clearTimeout(followDeadline);bindingEpoch++;demo=true;threadId='demo-only';snapshot={threadId,model:'演示 Astra',displayWindow:272000,configuredWindow:272000,effectiveWindow:272000,modelMaxWindow:872000,modelDefaultWindow:272000,usedTokens:demoUsed,remainingPercent:remainingPercent(demoUsed,272000),quality:'reported',source:'isolated-demo',measuredAt:new Date().toISOString()};el.setup.hidden=true;paint();say('隔离演示：按住原条直接拖动，松手吸附。');}
function applyDraft(){
  if(!demo){unsupported();return;}releaseDrag();raw=null;phase='applying';const ticket=++holdEpoch,selected=tiers()[draft];paint();
  if(selected<=snapshot.usedTokens){phase='idle';paint();notify('该档低于当前占用，演示保留原值。');return;}
  setTimeout(()=>{if(ticket!==holdEpoch||!demo)return;Object.assign(snapshot,{displayWindow:selected,configuredWindow:selected,effectiveWindow:selected,remainingPercent:remainingPercent(snapshot.usedTokens,selected)});phase='settled';paint();holdTimer=setTimeout(()=>{if(ticket!==holdEpoch)return;phase='idle';raw=null;paint();},1500);},300);
}
function openMenu(event){const box=el.stage.getBoundingClientRect();el.menu.hidden=false;const menuBox=el.menu.getBoundingClientRect();el.menu.style.left=clamp(event?.clientX?event.clientX-box.left:x+(geom?.width??36),0,Math.max(0,box.width-menuBox.width))+'px';el.menu.style.top=clamp(event?.clientY?event.clientY-box.top:y,0,Math.max(0,box.height-menuBox.height))+'px';}
el.slider.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;event.preventDefault();event.stopPropagation();if(!demo){unsupported();return;}if(phase==='applying')return;
  clearHold();hideNotice();if(phase==='idle')draft=Math.max(0,tiers().indexOf(snapshot.displayWindow));phase='editing';raw=null;drag={id:event.pointerId,x:event.clientX,y:event.clientY,bottom:y+geom.height,moved:false};paint();Object.assign(drag,{head:geom.head,base:geom.base,rail:geom.rail,horizontal:geom.horizontal});el.slider.setPointerCapture(event.pointerId);
});
el.slider.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;event.preventDefault();const delta=drag.horizontal?event.clientX-drag.x:drag.y-event.clientY;drag.moved ||= Math.abs(delta)>=1;raw=clamp(drag.head+delta,drag.base,drag.rail);draft=clamp(Math.round((raw-drag.base)/(drag.rail-drag.base)*(tiers().length-1)),0,tiers().length-1);paint();});
el.slider.addEventListener('pointerup',event=>{if(!drag||drag.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();const old=releaseDrag();raw=null;if(old.moved)applyDraft();else paint();});
el.slider.addEventListener('pointercancel',()=>{resetGesture();paint();});
el.slider.addEventListener('lostpointercapture',()=>{if(drag){resetGesture();paint();}});
el.slider.addEventListener('keydown',event=>{const keys=['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','Home','End','Enter','Escape'];if(!keys.includes(event.key))return;event.preventDefault();if(event.key==='Escape'){resetGesture();paint();return;}if(!demo){unsupported();return;}if(phase==='applying')return;clearHold();if(phase==='idle')draft=Math.max(0,tiers().indexOf(snapshot.displayWindow));phase='editing';raw=null;if(event.key==='Enter'){applyDraft();return;}if(event.key==='Home')draft=0;else if(event.key==='End')draft=tiers().length-1;else draft=clamp(draft+(['ArrowUp','ArrowRight'].includes(event.key)?1:-1),0,tiers().length-1);paint();});
el.grip.addEventListener('click',()=>{if(Date.now()>suppressClick)openMenu();});
el.meter.addEventListener('contextmenu',event=>{event.preventDefault();openMenu(event);});
el.meter.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();openMenu();el.menu.querySelector('button').focus();}});
el.meter.addEventListener('pointerdown',event=>{if(event.button!==0||event.target===el.slider||phase!=='idle'&&!el.grip.contains(event.target))return;event.preventDefault();move={id:event.pointerId,sx:event.clientX,sy:event.clientY,ox:x,oy:y,docked,orientation,moved:false,fromGrip:el.grip.contains(event.target)};el.meter.setPointerCapture(event.pointerId);});
el.meter.addEventListener('pointermove',event=>{if(!move||move.id!==event.pointerId)return;const dx=event.clientX-move.sx,dy=event.clientY-move.sy;if(!move.moved&&Math.hypot(dx,dy)<7)return;if(docked&&dx<24)return;if(!move.moved){clearHold();phase='idle';if(move.docked){docked=false;orientation='horizontal';}}move.moved=true;x=move.ox+dx;y=move.oy+dy;paint();});
function endMove(event,cancel=false){if(!move||move.id!==event.pointerId)return;const old=move;move=null;if(cancel){docked=old.docked;orientation=old.orientation;x=old.ox;y=old.oy;}if(old.moved){suppressClick=Date.now()+400;say('仅在插件面板内移动；原生窗口停靠未验证。');}else if(old.fromGrip&&!cancel){suppressClick=Date.now()+400;openMenu();}paint();}
el.meter.addEventListener('pointerup',event=>endMove(event));el.meter.addEventListener('pointercancel',event=>endMove(event,true));
async function requestDisplay(mode){const actual=await bridge.display(mode);if(actual)say(actual==='fullscreen'?'Codex 已接受展开请求；若右侧未出现，请点击卡片标题旁的双向斜箭头。':'Codex 已接受收起请求。');}
el['host-mode'].addEventListener('click',()=>requestDisplay(bridge.hostContext.displayMode==='inline'?'fullscreen':'inline').catch(error=>notify(error.message)));
el.menu.addEventListener('click',async event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;el.menu.hidden=true;try{if(action==='resume-follow'){demo=false;bindingEpoch++;clearFollow('正在恢复跟随');schedulePoll();}else if(action==='select'){if(autoFollow){notify('当前为自动跟随。固定会话请使用 Start-Fixed.cmd；跟随已有对话请使用新版 Start.cmd。');return;}resetGesture();demo=false;bindingEpoch++;clearTimeout(pollTimer);threadId=null;snapshot=null;paint();el.setup.hidden=false;await listThreads();}else if(action==='details'){el.details.hidden=false;drawDetails();}else if(action==='demo')startDemo();else if(action==='fullscreen'||action==='inline')await requestDisplay(action);else{resetGesture();docked=action==='dock';orientation=action==='dock'?'vertical':action;paint();}}catch(error){notify(error.message);}});
el['follow-window'].addEventListener('change',()=>{followWindowKey=el['follow-window'].value||null;bindingEpoch++;if(!demo&&followData)applyFollow(followData);schedulePoll();});
el.stage.addEventListener('contextmenu',event=>{if(!el.meter.contains(event.target)&&!el.menu.contains(event.target)){event.preventDefault();openMenu(event);}});
el.bind.addEventListener('click',()=>{if(el.threads.value)bindThread(el.threads.value).catch(error=>notify(error.message));});
el['details-close'].addEventListener('click',()=>el.details.hidden=true);el.dismiss.addEventListener('click',hideNotice);el['notice-action'].addEventListener('click',()=>{hideNotice();if(demo){draft=Math.min(tiers().indexOf(snapshot.displayWindow)+1,tiers().length-1);applyDraft();}});
el.notice.addEventListener('pointerenter',()=>{noticeHover=true;pauseNotice();});el.notice.addEventListener('pointerleave',()=>{noticeHover=false;resumeNotice();});el.notice.addEventListener('focusin',()=>{noticeFocus=true;pauseNotice();});el.notice.addEventListener('focusout',event=>{if(!el.notice.contains(event.relatedTarget)){noticeFocus=false;resumeNotice();}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'){if(drag||phase!=='idle'){resetGesture();paint();}el.menu.hidden=true;hideNotice();}});
document.addEventListener('pointerdown',event=>{if(!el.menu.contains(event.target)&&!el.grip.contains(event.target))el.menu.hidden=true;});
document.addEventListener('visibilitychange',()=>{if(autoFollow&&!demo&&followData)applyFollow(followData);schedulePoll();});
let previousSize='';new ResizeObserver(entries=>{const r=entries[0].contentRect,key=`${r.width}:${r.height}`;if(previousSize&&key!==previousSize)resetGesture();previousSize=key;paint();}).observe(el.stage);
async function boot(){paint();try{await bridge.initialize();if(!threadId&&!autoFollow)await listThreads();}catch(error){disconnected=true;paint();say(error.message);el.threads.replaceChildren(new Option('无法读取本地会话',''));}el.meter.classList.add('ready');}
boot();
