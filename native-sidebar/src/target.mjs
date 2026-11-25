import {capacityLevels,tierWindow} from '../../src/control/levels.mjs';
import {targetPreferenceKey,readTargetPreference} from '../../src/control/target-preference.mjs';
import {UUID, clamp} from './telemetry.mjs';

// Standalone ZIP fallback from the 26.1117.3838.0 desktop model catalog.
// The local launcher replaces this snapshot with the installed catalog.
const installedModelRows = null;
const sidebarModels = new Map((installedModelRows ?? [
  ['gpt-6.2-astra',272000,872000,95], ['gpt-6-astra',272000,872000,95],
  ['gpt-6-sol',272000,872000,95], ['gpt-6-luna',272000,872000,95],
  ['gpt-6.2-sol',500000,872000,95], ['gpt-6.1-sol',500000,872000,95], ['gpt-6.1-terra',500000,872000,95],
]).map(([slug,context_window,max_context_window,effective_context_window_percent])=>
  [slug,{slug,context_window,max_context_window,effective_context_window_percent}]));

export const formatWindow = tokens => (tokens / 1000) + 'k';

export function targetContext(check, snapshot, models=sidebarModels) {
  if (!snapshot || !UUID.test(check?.threadId ?? '') || check.threadId !== snapshot.threadId ||
      check.host !== 'local' || !models.has(check.model)) return null;
  const catalog=models.get(check.model), levels=capacityLevels(catalog);
  if(levels.length<2)return null;
  return {key:targetPreferenceKey(check.threadId,check.model), threadId:check.threadId, model:check.model, levels, effectivePercent:catalog.effective_context_window_percent};
}

// Locate the reported effective window on the preset scale, including custom sizes between detents.
function liveFraction(ctx, capacity) {
  const limits=ctx.levels.map(tier=>Math.floor(tier*ctx.effectivePercent/100));
  const upper=limits.findIndex(limit=>limit>=capacity);
  if (upper<0) return 1;
  if (upper===0) return 0;
  const part=(capacity-limits[upper-1])/(limits[upper]-limits[upper-1]);
  return (upper-1+part)/(limits.length-1);
}

// Bind only a target preference. Native usage continues to drive the actual meter.
export function bindTargetSlider({track, label, on, context, reading, horizontal, bubble, startSizing, resizeBy, endSizing}) {
  let edit=null, settle=0, animation=0;
  const choices=new Map();
  function rememberChoice(ctx,selection) {
    const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
    const choice={threadId:ctx.threadId,expectedModel:ctx.model,selection,chosenAt:Date.now(),id};
    choices.delete(ctx.threadId);
    choices.set(ctx.threadId,{choice,staged:false,message:null});
    if(choices.size>64)choices.delete(choices.keys().next().value);
  }
  function stored(ctx) {
    return readTargetPreference(key=>localStorage.getItem(key),ctx.key,ctx.levels);
  }
  function stopGesture() {
    clearTimeout(settle);cancelAnimationFrame(animation);
    const pointer=edit?.pointer;
    edit=null;label.hidden=true;track.removeAttribute('data-edit');
    track.removeAttribute('data-preview-low');track.style.removeProperty('--preview-scale');
    track.setAttribute('role','button');
    for(const attr of ['aria-orientation','aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext'])track.removeAttribute(attr);
    if(pointer!=null && track.hasPointerCapture(pointer)) track.releasePointerCapture(pointer);
  }
  function reset() {
    if (!edit) return;
    stopGesture();endSizing();
  }
  function positionLabel() {
    if (label.hidden) return;
    const box=track.getBoundingClientRect();
    const x=horizontal()?box.right:box.left+box.width/2;
    label.style.left=clamp(x-label.offsetWidth/2,2,Math.max(2,innerWidth-label.offsetWidth-2))+'px';
    label.style.top=clamp(box.top-label.offsetHeight-7,2,Math.max(2,innerHeight-label.offsetHeight-2))+'px';
  }
  function show() {
    const last=edit.ctx.levels.length-1;
    const index=clamp(Math.round(edit.fraction*last),0,last), tier=edit.ctx.levels[index];
    const actual=reading(), atLive=!edit.saved && !edit.selected && edit.start===edit.live;
    const {usable}=tierWindow(tier,edit.ctx.effectivePercent);
    const percent=atLive ? Math.round(actual.percent) : clamp(Math.round(100*(1-actual.used/usable)),0,100);
    const estimate='预计有效 '+formatWindow(usable);
    let caption=(tier===edit.ctx.levels[0]?'默认 ':'预设 ')+formatWindow(tier)+' · '+estimate+' · 约 '+percent+'%';
    if(atLive)caption='当前 '+formatWindow(actual.capacity)+' · '+percent+'%';
    if(edit.saved)caption=formatWindow(tier)+(edit.staged?' 已提交':' 预设已保存')+' · '+estimate;
    if(label.textContent!==caption)label.textContent=caption;
    track.style.setProperty('--preview-scale',percent/100);
    track.toggleAttribute('data-preview-low',percent<=20);
    track.setAttribute('aria-valuenow',tier);
    track.setAttribute('aria-valuetext',label.textContent);
    label.hidden=false;
    positionLabel();
    return tier;
  }
  // The gesture is measured from its press point; never derive travel from a moving track.
  function displacement(fraction) {
    const d=fraction-edit.start;
    if (d===0) return 0;
    return d>0 ? edit.grow*d/(1-edit.start) : edit.shrink*d/edit.start;
  }
  function draw(delta, fraction) {
    edit.visibleFraction=fraction;
    if (edit.delta===delta) return;
    edit.delta=delta;resizeBy(delta);
  }
  function easeTo(delta,fraction,done) {
    cancelAnimationFrame(animation);
    const from=edit.delta, fromFraction=edit.visibleFraction, started=performance.now(), gesture=edit;
    if (from===delta || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(delta,fraction);done?.();return;
    }
    function frame(now) {
      if (edit!==gesture) return;
      const t=clamp((now-started)/180,0,1);
      const remaining=(1-t)**3;
      draw(delta+(from-delta)*remaining, fraction+(fromFraction-fraction)*remaining);
      if (t<1) animation=requestAnimationFrame(frame);else done?.();
    }
    animation=requestAnimationFrame(frame);
  }
  function begin(pointer,coord) {
    const ctx=context();
    // A second gesture can catch the bar in its snap, hold or return animation.
    const resume=edit?.saved && edit.ctx.key===ctx?.key && edit.capacity===reading()?.capacity ? edit.visibleFraction : null;
    if(resume!==null)stopGesture();else reset();
    if(!ctx){bubble('等待已适配的本地对话和模型用量');return false;}
    const capacity=reading().capacity, live=liveFraction(ctx,capacity), fraction=resume??live;
    edit={ctx,pointer,origin:coord,capacity,live,start:fraction,fraction,visibleFraction:fraction,
      delta:0,selected:false,saved:false,...startSizing(fraction)};
    track.setAttribute('data-edit','');track.setAttribute('role','slider');
    track.setAttribute('aria-valuemin',ctx.levels[0]);track.setAttribute('aria-valuemax',ctx.levels.at(-1));
    track.setAttribute('aria-orientation',horizontal()?'horizontal':'vertical');show();return true;
  }
  function commit() {
    if(!edit || !edit.selected || edit.saved || context()?.key!==edit.ctx.key || reading()?.capacity!==edit.capacity){reset();return;}
    const tier=show();
    const {compactAt}=tierWindow(tier, edit.ctx.effectivePercent);
    if(reading().used>=compactAt){reset();bubble('当前用量已达到这一档的预计压缩阈值，请选择更大档位。');return;}
    try {localStorage.setItem(edit.ctx.key,String(tier));}
    catch {reset();bubble('无法保存此对话的预设');return;}
    rememberChoice(edit.ctx,tier===edit.ctx.levels[0]?'default':{tokens:tier});
    edit.saved=true;
    edit.fraction=edit.ctx.levels.indexOf(tier)/(edit.ctx.levels.length-1);show();
    const pointer=edit.pointer;edit.pointer=null;
    if(pointer!=null && track.hasPointerCapture(pointer)) track.releasePointerCapture(pointer);
    easeTo(displacement(edit.fraction),edit.fraction);
    settle=setTimeout(()=>easeTo(edit.home,edit.live,reset),1500);
  }
  const axis=event=>horizontal()?event.clientX:-event.clientY;
  on(track,'pointerdown',event=>{
    if(!event.isPrimary||event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    if(begin(event.pointerId,axis(event)))track.setPointerCapture(event.pointerId);
  });
  on(track,'pointermove',event=>{
    if(!edit||event.pointerId!==edit.pointer)return;
    const delta=axis(event)-edit.origin;
    const span=delta>=0 ? edit.grow : edit.shrink;
    const room=delta>=0 ? 1-edit.start : edit.start;
    // Keep tiers selectable even when native controls leave almost no room to grow.
    edit.fraction=clamp(edit.start+delta*room/Math.max(24*room,span,1),0,1);
    edit.selected=edit.fraction!==edit.start;
    draw(displacement(edit.fraction),edit.fraction);show();
  });
  on(track,'pointerup',event=>{if(edit && event.pointerId===edit.pointer)commit();});
  on(track,'pointercancel',reset);
  on(track,'lostpointercapture',event=>{if(edit && event.pointerId===edit.pointer)reset();});
  on(window,'blur',reset);on(window,'resize',reset);
  on(track,'blur',()=>{if(edit?.pointer===null)reset();});
  on(document,'keydown',event=>{if(event.key==='Escape')reset();});
  on(track,'keydown',event=>{
    if(!['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','Home','End','Enter',' '].includes(event.key))return;
    event.preventDefault();
    const opening=!edit || edit.saved;
    if(opening && !begin(null,0))return;
    if(edit.pointer!==null)return;
    if(context()?.key!==edit.ctx.key){reset();return;}
    const last=edit.ctx.levels.length-1;
    if(['Enter',' '].includes(event.key)){if(!opening)commit();return;}
    const index=edit.fraction*last, up=['ArrowUp','ArrowRight'].includes(event.key);
    edit.fraction=event.key==='Home'?0:event.key==='End'?1:clamp((up?Math.floor(index)+1:Math.ceil(index)-1)/last,0,1);
    edit.selected=true;
    draw(displacement(edit.fraction),edit.fraction);show();
  });
  function warningChoice() {
    const ctx=context(), actual=reading();
    if(!ctx || !actual || actual.percent>20)return null;
    const tier=ctx.levels.find(level=>{
      const {usable}=tierWindow(level,ctx.effectivePercent);
      return usable>actual.capacity && actual.used<usable*.8;
    });
    if(!tier || stored(ctx)>=tier)return null;
    return {key:ctx.key,tier,usable:tierWindow(tier,ctx.effectivePercent).usable};
  }
  return {
    reset, positionLabel,
    currentChoice(){
      if(!choices.size)return null;
      const ctx=context();
      const choice=choices.get(ctx?.threadId)?.choice;
      return choice && choice.expectedModel===ctx?.model ? choice : null;
    },
    acknowledgeChoice(id){
      const ctx=context();
      const item=choices.get(ctx?.threadId);
      if(!ctx || item?.choice.id!==id || item.choice.expectedModel!==ctx.model)return false;
      if(item.staged)return true;
      item.staged=true;
      if(edit?.saved){edit.staged=true;show();}
      const selection=item.choice.selection;
      const tier=selection==='default'?ctx.levels[0]:selection.tokens;
      const usable=tierWindow(tier,ctx.effectivePercent).usable;
      bubble((selection==='default'?'默认 ':'')+formatWindow(tier)+' 已提交 · 预计有效 '+formatWindow(usable)+'，下一回合确认。');
      return true;
    },
    confirmTurn(id,capacity){
      const ctx=context(),item=choices.get(ctx?.threadId);
      if(!ctx || !item?.staged || item.choice.id!==id || item.choice.expectedModel!==ctx.model ||
          !Number.isSafeInteger(capacity) || capacity<=0)return false;
      if(item.message)return true;
      const tier=item.choice.selection==='default'?ctx.levels[0]:item.choice.selection.tokens;
      const expected=tierWindow(tier,ctx.effectivePercent).usable;
      item.message=capacity===expected?'已生效 · '+formatWindow(capacity):
        '本回合实测 '+formatWindow(capacity)+'，所选档位预计有效 '+formatWindow(expected)+'。';
      bubble(item.message);
      return true;
    },
    validate(){if(edit){if(context()?.key!==edit.ctx.key || reading()?.capacity!==edit.capacity)reset();else if(!edit.saved)show();}},
    clearAction(){
      const ctx=context();if(!ctx||!stored(ctx))return null;
      return ()=>{
        if(context()?.key!==ctx.key)return;
        try{localStorage.removeItem(ctx.key);rememberChoice(ctx,'default');bubble('已清除本对话的容量预设');}catch{bubble('无法清除容量预设');}
      };
    },
    warningAction(){
      const offered=warningChoice();
      if(!offered)return null;
      return {label:'预设 '+formatWindow(offered.tier)+' · 预计有效 '+formatWindow(offered.usable),select(){
        const current=warningChoice();
        if(current?.key!==offered.key || current.tier!==offered.tier)return;
        reset();
        if(!begin(null,0))return;
        edit.fraction=edit.ctx.levels.indexOf(offered.tier)/(edit.ctx.levels.length-1);
        edit.selected=true;commit();
      }};
    },
    describe(){
      const ctx=context(),tier=ctx&&stored(ctx);
      if(!ctx)return '当前模型暂无可调整的档位。';
      const base=ctx.levels[0], prefix=ctx.model+' 默认 '+formatWindow(base)+'，预计有效 '+formatWindow(tierWindow(base,ctx.effectivePercent).usable)+'。';
      const item=choices.get(ctx.threadId);
      const receipt=item?.choice.expectedModel===ctx.model && item.message?' 最近一次调档：'+item.message:'';
      if(!tier)return prefix+'按住进度条可选择档位。'+receipt;
      const {usable,compactAt}=tierWindow(tier,ctx.effectivePercent);
      return prefix+'当前有效容量 '+formatWindow(reading().capacity)+'。本对话已保存 '+formatWindow(tier)+' 预设。预计可用 '+formatWindow(usable)+'，预计压缩点 '+formatWindow(compactAt)+'。'+receipt;
    },
  };
}
