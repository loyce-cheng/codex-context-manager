import { clamp, MESSAGES } from './telemetry.mjs';
import { locateRail, fitDock } from './layout.mjs';
import { readSidebarPreferences, saveSidebarPreferences } from './preferences.mjs';
import { bindTargetSlider, targetContext } from './target.mjs';

export function createSidebar(source) {
  const root = document.createElement('context-lens-sidebar');
  root.setAttribute('aria-label', 'Context Lens 上下文监控');
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{box-sizing:border-box;display:flex;align-self:center;flex:0 0 auto;width:36px;height:180px;margin:0;z-index:1;color:var(--text-primary,#34433c);font:11px/1.35 system-ui,sans-serif;-webkit-app-region:no-drag}
    *,*::before,*::after{box-sizing:border-box}button{font:inherit;color:inherit;border:0;background:none;cursor:pointer}
    #meter{display:flex;flex-direction:column;align-items:center;gap:3px;width:100%;height:100%;padding:4px 0 7px;border-radius:12px;user-select:none}
    #grip{appearance:none;margin:0;padding:4px;border:0;flex:none;display:grid;place-items:center;cursor:grab;touch-action:none;border-radius:5px}
    #grip:hover,#grip:focus-visible{background:color-mix(in srgb,currentColor 10%,transparent)}#grip:active{cursor:grabbing}
    #grip-dots{display:grid;grid-template:repeat(2,3px)/repeat(3,3px);gap:2px;pointer-events:none}
    #grip-dots i{border-radius:50%;background:currentColor}
    :host([data-mode="horizontal"]) #grip-dots{grid-template:repeat(3,3px)/repeat(2,3px)}
    #capacity,#percent{font-variant-numeric:tabular-nums;white-space:nowrap;line-height:16px}#capacity{font-weight:600}#percent{order:2}
    #track{order:3;flex:1;width:6px;min-height:24px;position:relative;background:color-mix(in srgb,currentColor 12%,transparent);border-radius:8px;overflow:hidden;margin:5px 0 0}
    #fill{position:absolute;inset:0;background:#20874d;border-radius:inherit;transform-origin:left bottom;transform:scaleY(var(--preview-scale,var(--actual-scale,0)));transition:transform .28s ease}
    :host([data-mode="horizontal"]) #fill{transform:scaleX(var(--preview-scale,var(--actual-scale,0)))}
    :host([data-low]) #fill{background:#d84242}:host([data-empty]) #track{opacity:.35}
    :host([data-mode="horizontal"]){height:36px!important;width:auto;position:fixed;z-index:10000}
    :host([data-mode="horizontal"]) #meter{flex-direction:row;padding:0 7px;gap:7px}
    :host([data-mode="horizontal"]) #track{order:1;height:6px;width:auto;min-width:40px;min-height:0;margin:0}
    :host([data-mode="vertical"]){position:fixed;z-index:10000}
    :host([data-mode="horizontal"]) #meter,:host([data-mode="vertical"]) #meter{background:var(--surface-primary,#fff);border:1px solid color-mix(in srgb,currentColor 15%,transparent);box-shadow:0 3px 12px #0002}
    #bubble,#menu{position:fixed;z-index:10001;background:var(--surface-primary,#fff);color:var(--text-primary,#34433c);border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:9px;box-shadow:0 4px 20px #0002;padding:8px;width:210px;font:12px/1.5 system-ui,sans-serif}
    #bubble[hidden],#menu[hidden]{display:none}#menu button{display:block;text-align:left;width:100%;padding:6px;border-radius:5px}#menu button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}#menu button[disabled]{cursor:default;opacity:.55}
    #bubble button{display:block;padding:3px 0;margin-top:4px;font-weight:600;text-decoration:underline;text-underline-offset:2px}
    @media(prefers-color-scheme:dark){:host{color:var(--text-primary,#dce5df)}#bubble,#menu,:host([data-mode="horizontal"]) #meter,:host([data-mode="vertical"]) #meter{background:var(--surface-primary,#222824);color:var(--text-primary,#dce5df)}}
    @media(prefers-reduced-motion:reduce){#fill{transition:none}}
    #track{overflow:visible;cursor:ns-resize;touch-action:none}
    #track::before{content:"";position:absolute;inset:0 -9px}
    #thumb{display:none;position:absolute;top:0;left:50%;width:10px;height:10px;border-radius:50%;background:currentColor;transform:translate(-50%,-50%);pointer-events:none}
    #track[data-edit] #thumb{display:block}
    #meter:has(#track[data-edit]) :is(#capacity,#percent){visibility:hidden}
    :host #track[data-edit] #fill{transition:none;background:#20874d}
    :host #track[data-preview-low] #fill{background:#d84242}
    :host([data-mode="horizontal"]) #track{cursor:ew-resize}
    :host([data-mode="horizontal"]) #track::before{inset:-9px 0}
    :host([data-mode="horizontal"]) #thumb{top:50%;left:100%}
    #target-preview{position:fixed;z-index:10002;pointer-events:none;white-space:nowrap;border-radius:6px;padding:3px 6px;background:var(--surface-primary,#fff);color:var(--text-primary,#34433c);box-shadow:0 1px 6px #8886;font-size:11px}
    @media(prefers-color-scheme:dark){#target-preview{background:var(--surface-primary,#222824);color:var(--text-primary,#dce5df)}}
  </style>
  <div id="meter"><button id="grip" aria-label="拖动上下文监控" title="拖动监控，右击打开菜单"><span id="grip-dots" aria-hidden="true">${'<i></i>'.repeat(6)}</span></button><span id="capacity">—</span><span id="percent">—</span><div id="track" role="button" aria-label="预设本对话容量" tabindex="0"><div id="fill"></div><span id="thumb" aria-hidden="true"></span></div></div>
  <output id="target-preview" hidden></output><div id="bubble" role="status" hidden></div><div id="menu" role="menu" hidden></div>`;
  const el = id => shadow.getElementById(id);
  const preferences = readSidebarPreferences(window);
  let stopped = false, busy = false, mode = preferences.mode, snapshot = null, drag = null;
  let position = preferences.position, frame = 0, bubbleTimer = 0;
  let currentStatus = 'waiting', layoutOK = false, lastRead = 0, layoutProblem=null;
  const warnings = new Map(), abort = new AbortController();
  const on = (target, type, fn, options = {}) => target.addEventListener(type, fn, { ...options, signal: abort.signal });
  const fill=el('fill');
  const dockLimits = {};
  let sizing = null;
  fill.setAttribute('role','progressbar');fill.setAttribute('aria-label','上下文剩余比例');
  fill.setAttribute('aria-valuemin','0');fill.setAttribute('aria-valuemax','100');
  el('track').title='按住拖动预设本对话容量；方向键选择，回车保存';
  const slider=bindTargetSlider({track:el('track'),label:el('target-preview'),on,reading:()=>snapshot,horizontal:()=>mode==='horizontal',bubble,
    startSizing, resizeBy(delta) { sizing.delta = delta; arrange(); },
    endSizing() { sizing = null; arrange(); },
    context:()=>{try {return targetContext(source.currentPreflight ? source.currentPreflight() : source.diagnostics?.()?.capacityPreflight,snapshot);} catch {return null;}}});
  const capacityLabel = capacity => capacity ? `${Number((capacity / 1000).toFixed(1))}k` : '—';
  const length = () => Math.round(clamp(120 + ((snapshot?.capacity ?? 272000) - 272000) / 600000 * 100, 100, 220));
  const size = () => mode === 'horizontal' ? { width: Math.min(length() + 94, innerWidth - 8), height: 36 } : { width: 36, height: Math.min(length() + 64, innerHeight - 8) };
  function startSizing(start) {
    const horizontal = mode === 'horizontal';
    const box = root.getBoundingClientRect(), trackBox = el('track').getBoundingClientRect();
    const axis = horizontal ? 'width' : 'height';
    const minimum = Math.max(mode === 'docked' ? 112 : 0, box[axis] - trackBox[axis] + (horizontal ? 40 : 24));
    const maximum = mode === 'docked' ? dockLimits.maxHeight : (horizontal ? innerWidth : innerHeight) - 8;
    const travel = horizontal ? 132 : 96;
    const restingLength = sizing?.restingLength ?? box[axis];
    sizing = { box, delta: 0, restingLength };
    return { home: restingLength - box[axis], shrink: Math.max(0, Math.min(travel * start, box[axis] - minimum)),
      grow: Math.max(0, Math.min(travel * (1 - start), maximum - box[axis])) };
  }
  function arrange() {
    if (stopped) return;
    root.dataset.mode = mode;
    if (mode === 'docked') {
      root.style.position = ''; root.style.left = ''; root.style.top = ''; root.style.width = '36px';
      const location=locateRail();
      watchRail(location?.rail ?? null);
      layoutOK = fitDock(root, location, sizing ? sizing.box.height + sizing.delta : size().height, dockLimits, !!sizing);
      layoutProblem=layoutOK?null:location?'space':'rail';
    } else {
      watchRail(null);
      if (root.parentNode !== document.body) document.body.append(root);
      const dimensions = sizing ? {
        width: sizing.box.width + (mode === 'horizontal' ? sizing.delta : 0),
        height: sizing.box.height + (mode === 'vertical' ? sizing.delta : 0),
      } : size();
      root.style.display = 'flex'; root.style.width = `${dimensions.width}px`; root.style.height = `${dimensions.height}px`;
      const maxX = Math.max(0, innerWidth - dimensions.width), maxY = Math.max(0, innerHeight - dimensions.height);
      root.style.left = (sizing ? clamp(sizing.box.left, 0, maxX) : clamp(position.x, 0, 1) * maxX) + 'px';
      root.style.top = (sizing ? clamp(sizing.box.bottom - dimensions.height, 0, maxY) : clamp(position.y, 0, 1) * maxY) + 'px';
      layoutOK = true;
      layoutProblem=null;
    }
    if (sizing) slider.positionLabel();
  }
  function schedule() { if (!frame && !stopped) frame = requestAnimationFrame(() => { frame = 0; arrange(); }); }
  function popup(node, x, y) {
    node.hidden = false;
    node.style.left = `${clamp(x, 4, Math.max(4, innerWidth - node.offsetWidth - 4))}px`;
    node.style.top = `${clamp(y, 4, Math.max(4, innerHeight - node.offsetHeight - 4))}px`;
  }
  function bubble(text,action) {
    clearTimeout(bubbleTimer); el('bubble').textContent = text;
    if(action){
      const button=document.createElement('button');button.type='button';button.textContent=action.label;
      button.onclick=()=>{
        if(!button.isConnected || el('bubble').hidden)return;
        clearTimeout(bubbleTimer);el('bubble').hidden=true;action.select();
      };
      el('bubble').append(button);
    }
    const rect = root.getBoundingClientRect(); popup(el('bubble'), rect.right + 6, rect.top);
    bubbleTimer = setTimeout(() => { el('bubble').hidden = true; }, 5000);
  }
  function paint(result) {
    const next=result?.snapshot ?? null;
    const status=result?.status ?? 'failed';
    if(root.hasAttribute('data-mode') && currentStatus===status && snapshot?.threadId===next?.threadId &&
        snapshot?.capacity===next?.capacity && snapshot?.used===next?.used && snapshot?.percent===next?.percent){
      slider.validate();
      return;
    }
    const sizeChanged=snapshot?.capacity!==next?.capacity;
    if (snapshot?.threadId !== result?.snapshot?.threadId) { clearTimeout(bubbleTimer); el('bubble').hidden = true; el('menu').hidden=true; }
    snapshot = result?.snapshot ?? null; currentStatus = result?.status ?? 'failed';
    slider.validate();
    const valid = snapshot !== null;
    root.toggleAttribute('data-empty', !valid); root.toggleAttribute('data-low', valid && snapshot.percent <= 20);
    el('capacity').textContent = capacityLabel(snapshot?.capacity);
    el('percent').textContent = valid ? `${Math.round(snapshot.percent)}%` : '—';
    const remaining=(snapshot?.percent??0)/100;
    fill.style.setProperty('--actual-scale',remaining);
    if (valid) fill.setAttribute('aria-valuenow', String(snapshot.percent));
    else fill.removeAttribute('aria-valuenow');
    root.title = valid
      ? `当前对话 ${snapshot.threadId.slice(0, 8)}\n已用 ${snapshot.used.toLocaleString()} / 有效 ${snapshot.capacity.toLocaleString()} tokens\n百分比表示剩余容量。按住进度条可预览档位。`
      : MESSAGES[currentStatus] ?? MESSAGES.failed;
    if (valid) {
      let armed = warnings.get(snapshot.threadId) ?? true;
      if (snapshot.percent > 25) armed = true;
      if (armed && snapshot.percent <= 20) {
        bubble('上下文快满了，Codex 可能即将自动压缩。',slider.warningAction()); armed = false;
      }
      warnings.delete(snapshot.threadId); warnings.set(snapshot.threadId, armed);
      if (warnings.size > 128) warnings.delete(warnings.keys().next().value);
    }
    if(sizeChanged)schedule();
  }
  function changeMode(next) {
    slider.reset();el('menu').hidden = true; mode = next;
    paint({ status: currentStatus, snapshot }); arrange();
    saveSidebarPreferences(window,{mode,position});
  }
  function openMenu(event) {
    event.preventDefault(); event.stopPropagation();
    const menu = el('menu'); menu.replaceChildren();
    const clearTarget=slider.clearAction();
    const actions = [
      [mode === 'docked' ? '拉出为横向悬浮条' : '固定回左侧栏', () => changeMode(mode === 'docked' ? 'horizontal' : 'docked')],
      ...(mode !== 'docked' ? [[mode === 'horizontal' ? '改为竖向' : '改为横向', () => changeMode(mode === 'horizontal' ? 'vertical' : 'horizontal')]] : []),
      ['查看容量预设', () => { menu.hidden=true;bubble(slider.describe()); }],
      ...(clearTarget?[['清除本对话预设',()=>{menu.hidden=true;clearTarget();}]]:[]),
      ['查看容量检查', () => {
        menu.hidden = true;
        let check;try { check = source.diagnostics?.()?.capacityPreflight; } catch { /* Report unavailable without changing the meter. */ }
        if (!check?.threadId || check.threadId !== snapshot?.threadId) { bubble('尚未取得当前对话的容量检查状态。'); return; }
        const state = check.idle === true ? '对话空闲' : check.idle === false ? '对话正在运行' : '空闲状态待确认';
        bubble(`${check.model ?? '模型待确认'} · ${state}。当前左栏可保存本对话的预设，实际容量以 Codex 上报为准。`);
      }],
      ['查看状态', () => { menu.hidden = true; bubble(root.title); }],
    ];
    for (const [label, action] of actions) {
      const button = document.createElement('button'); button.textContent = label; button.setAttribute('role', 'menuitem');
      button.disabled = !action; if (action) button.onclick = action; menu.append(button);
    }
    popup(menu, event.clientX, event.clientY); menu.querySelector('button')?.focus();
  }
  on(root, 'contextmenu', openMenu);
  on(el('grip'), 'pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    slider.reset();
    event.preventDefault(); event.stopPropagation(); el('menu').hidden = true;
    const box = root.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, offsetX: event.clientX - box.left, offsetY: event.clientY - box.top, originalMode: mode, originalPosition: position };
    // Window capture survives reparenting from rail to body, unlike element pointer capture.
  });
  on(window, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    if (mode === 'docked') {
      if (event.clientX - drag.x < 8) return;
      mode = 'horizontal'; drag.offsetY = 18; drag.offsetX = 16;
    }
    const dimensions = size();
    position = { x: clamp((event.clientX - drag.offsetX) / Math.max(1, innerWidth - dimensions.width), 0, 1), y: clamp((event.clientY - drag.offsetY) / Math.max(1, innerHeight - dimensions.height), 0, 1) };
    arrange();
  }, { capture: true });
  function cancelDrag(){
    if(!drag)return;
    mode=drag.originalMode;position=drag.originalPosition;drag=null;arrange();
  }
  on(window, 'pointerup', event => {
    if(event.pointerId!==drag?.id)return;
    saveSidebarPreferences(window,{mode,position});drag=null;
  }, { capture: true });
  on(window, 'pointercancel', event => { if(event.pointerId===drag?.id)cancelDrag(); }, { capture: true });
  on(window, 'blur', cancelDrag);
  on(document, 'pointerdown', event => { if (!event.composedPath().includes(root)) el('menu').hidden = true; }, { capture: true });
  on(document, 'keydown', event => { if (event.key === 'Escape') { cancelDrag(); el('menu').hidden = true; el('bubble').hidden = true; } });
  on(window, 'resize', schedule);
  let watchedRail=null;
  const sizes=new ResizeObserver(schedule);
  function observeControls(){
    sizes.disconnect();
    if(!watchedRail)return;
    sizes.observe(watchedRail);
    for(const node of watchedRail.querySelectorAll(':scope > *,button,a,input,[role="button"],[tabindex],[data-codexpp="usage-slot"]')){
      if(node!==root)sizes.observe(node);
    }
  }
  const observer=new MutationObserver(records=>{
    if(records.some(r=>r.type==='childList' && [...r.addedNodes,...r.removedNodes].some(n=>n!==root)))observeControls();
    if(records.some(r=>r.target!==root))schedule();
  });
  function watchRail(rail){
    if(rail===watchedRail)return;
    observer.disconnect();watchedRail=rail;observeControls();
    if(rail)observer.observe(rail,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','aria-label']});
  }
  let visibilityEpoch=0,timer;
  async function tick() {
    if (stopped || document.hidden) return;
    if(mode==='docked'){
      const location=locateRail();
      if((location?.rail??null)!==watchedRail || (location && root.nextElementSibling!==location.utilities))schedule();
    }else if(!root.isConnected)schedule();
    // Invalidate rather than retain a value if an adapter is stuck or the renderer was suspended.
    if (lastRead && Date.now() - lastRead > 3000) paint({ status: 'failed', snapshot: null });
    if (busy) return;
    busy = true;
    const epoch=visibilityEpoch;
    try { const value = await source.read(); if (!stopped && epoch===visibilityEpoch) { lastRead = Date.now(); paint(value); } }
    catch { if (!stopped && epoch===visibilityEpoch) paint({ status: 'failed', snapshot: null }); }
    finally { busy = false; }
  }
  function startPolling(){
    if(!document.hidden){timer=setInterval(tick,500);tick();}
  }
  on(document,'visibilitychange',()=>{
    clearInterval(timer);visibilityEpoch++;lastRead=0;
    paint({status:'waiting',snapshot:null});
    startPolling();
  });
  paint({ status: 'waiting', snapshot: null }); arrange(); startPolling();
  return {
    acknowledgeChoice(id){return slider.acknowledgeChoice(id);},
    confirmTurn(id,capacity){return !document.hidden && layoutOK && slider.confirmTurn(id,capacity);},
    status: () => ({ mode, status: currentStatus, layoutOK,layoutProblem,turnReceipts:true, threadId: snapshot?.threadId ?? null, capacity: snapshot?.capacity ?? null, percent: snapshot?.percent ?? null, capacityChoice: slider.currentChoice(), diagnostics: source.diagnostics?.() ?? null }),
    stop() {
      if (stopped) return; stopped = true;
      slider.reset();clearInterval(timer); clearTimeout(bubbleTimer); cancelAnimationFrame(frame);
      observer.disconnect(); sizes.disconnect(); abort.abort(); source.close?.(); root.remove(); warnings.clear();
    },
  };
}
