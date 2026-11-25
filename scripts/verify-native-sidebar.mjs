// Isolated DOM/React-scope fixtures. This does not launch, inject into, or control Codex.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { sidebarBundle } from './build-sidebar.mjs';
import { RSPACK_3838_PROFILE } from '../native-sidebar/src/telemetry.mjs';
const manifest=JSON.parse(await readFile(new URL('../native-sidebar/manifest.json',import.meta.url),'utf8'));
const require=createRequire(import.meta.url), {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const code=await sidebarBundle({fixture:true});
const html=`<!doctype html><meta charset="utf-8"><title>Context Lens isolated native-layout fixture</title>
<style>body{margin:0;font:14px system-ui;background:#fafbf9;color:#34433c;display:flex}nav{width:52px;height:100vh;display:flex;flex-direction:column;box-sizing:border-box;background:#edf1ed;padding:8px 0;gap:8px}button{height:36px;width:36px;margin:0 8px;background:transparent;border:1px solid #d2dad2;border-radius:9px}#destinations{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}#utilities{flex:none;height:36px}main{padding:24px;flex:1}article{height:320px}textarea{margin-top:40px;width:80%;height:90px}</style>
<aside class="app-shell-left-panel"><nav data-app-navigation-rail><div><button aria-label="Home">⌂</button></div><div id="destinations"><button aria-label="Chats">聊</button><button aria-label="Files">文</button><button aria-label="Tools">工</button></div><div id="utilities"><button aria-label="Open profile menu">我</button></div></nav></aside>
<main><h2>左栏布局隔离测试</h2><p>这里是测试夹具，并非真实 Codex 截图。</p><article>当前对话 A</article><div data-codex-composer-root><div data-codex-composer><textarea aria-label="测试输入框"></textarea></div></div></main>`;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const errors=[],checks=[];
async function setup(page,id=a){
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
  // Fulfill locally so real Web Storage is available without an external request.
  await page.route('http://context-lens.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
  await page.goto('http://context-lens.test/');await page.addScriptTag({content:code});
  await page.evaluate(({a,b,id})=>{
    window.fixtureUsage={[a]:{last:{totalTokens:223040},total:{totalTokens:9999999},modelContextWindow:272000},[b]:{last:{totalTokens:102400},modelContextWindow:512000}};
    window.fixtureSubscriptions=0;
    window.fixtureScope={value:{kind:'local',placement:'main',conversationId:id},watch(fn){fixtureSubscriptions++;fn({get:this.get});return ()=>fixtureSubscriptions--;},get(atom,thread){return atom==='host'?'local':fixtureUsage[thread];}};
    document.querySelector('[data-codex-composer-root]').__reactFiber$fixture={memoizedState:{memoizedState:{scope:fixtureScope}},return:null};
    window.nativeSource=new NativeSourceFixture();
    window.fixtureRuntime=()=>{throw Error('Must never execute runtime');};
    fixtureRuntime.m={tl5a:()=>{throw Error('Must never execute factory');}};
    fixtureRuntime.c={tl5a:{exports:{k2:'usage',qX:'host'}}};
    nativeSource.runtime={renamedRuntimeExport:fixtureRuntime};
    nativeSource.runtimeProfile={kind:'rspack',appVersion:'26.1103.4239.0',moduleId:'tl5a',usageExport:'k2',hostExport:'qX'};
    window.monitor=createSidebarFixture(nativeSource);
  },{a,b,id});
}
async function verifyGrip(page, horizontal){
  const grip=page.locator('context-lens-sidebar #grip');
  const shape=await grip.evaluate(button=>{
    const box=button.getBoundingClientRect(), dots=[...button.querySelectorAll('i')];
    const rects=dots.map(dot=>dot.getBoundingClientRect());
    return {
      count:dots.length,
      cols:new Set(rects.map(r=>r.left)).size,rows:new Set(rects.map(r=>r.top)).size,
      complete:dots.every((dot,i)=>rects[i].width===3&&rects[i].height===3&&getComputedStyle(dot).borderRadius==='50%'),
      inset:[Math.min(...rects.map(r=>r.left))-box.left,box.right-Math.max(...rects.map(r=>r.right)),
        Math.min(...rects.map(r=>r.top))-box.top,box.bottom-Math.max(...rects.map(r=>r.bottom))],
    };
  });
  assert.deepEqual(shape,{count:6,cols:horizontal?2:3,rows:horizontal?3:2,complete:true,inset:[4,4,4,4]});
  const b=await grip.boundingBox();
  for(const [x,y,inside] of [[.5,.5,true],[.08,.5,true],[.92,.5,true],[.5,.08,true],[.5,.92,true],[-.15,.5,false],[1.15,.5,false]]){
    const px=b.x+b.width*x, py=b.y+b.height*y;
    await page.mouse.move(px,py);
    const hit=await grip.evaluate((el,[x,y])=>({
      hovered:el.matches(':hover'),grab:el.getRootNode().elementFromPoint(x,y)===el,
      highlighted:getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)',
    }),[px,py]);
    assert.deepEqual(hit,{hovered:inside,grab:inside,highlighted:inside});
  }
}
const page=await browser.newPage({viewport:{width:1000,height:700}});
try{
  await setup(page);const meter=page.locator('context-lens-sidebar');
  await meter.locator('#percent').getByText('18%',{exact:true}).waitFor();
  assert.equal(await meter.evaluate(e=>e.getBoundingClientRect().width),36);
  assert.equal(await meter.getAttribute('data-low'),'');
  await page.waitForFunction(()=>{
    const track=document.querySelector('context-lens-sidebar')?.shadowRoot?.getElementById('track');
    return track && Math.abs(track.querySelector('#fill').getBoundingClientRect().height/track.getBoundingClientRect().height-.18)<.01;
  },null,{timeout:4000});
  const ratio=await meter.locator('#track').evaluate(e=>e.querySelector('#fill').getBoundingClientRect().height/e.getBoundingClientRect().height);
  assert.ok(Math.abs(ratio-.18)<.01,'Expected 18% fill, observed '+ratio);checks.push('36px dock; remaining 18% fills 18%; red threshold');
  await meter.locator('#bubble').waitFor({state:'visible'});await meter.locator('#bubble').waitFor({state:'hidden',timeout:5500});
  checks.push('low-capacity notice disappears after 5 seconds');
  const dockReads=await page.evaluate(async()=>{
    const button=document.querySelector('#utilities button');
    const rect=button.getBoundingClientRect;
    let reads=0;
    button.getBoundingClientRect=function(){reads++;return rect.call(this);};
    try{
      for(let i=0;i<12;i++){
        document.querySelector('article').append(document.createTextNode('x'));
        await new Promise(done=>setTimeout(done,60));
      }
      return reads;
    }finally{delete button.getBoundingClientRect;}
  });
  assert.equal(dockReads,0,'steady readings and streamed text should not remeasure navigation controls');
  checks.push('streaming outside the rail and unchanged usage cause no dock control measurements');
  await page.evaluate(b=>{fixtureScope.value.conversationId=b;},b);
  await meter.locator('#percent').getByText('80%',{exact:true}).waitFor();
  assert.equal(await meter.locator('#capacity').textContent(),'512k');assert.equal(await meter.getAttribute('data-low'),null);
  await page.evaluate(()=>{fixtureScope.value.conversationId=null;});
  await meter.locator('#percent').getByText('—',{exact:true}).waitFor();
  await page.evaluate(a=>{fixtureScope.value.conversationId=a;},a);
  await meter.locator('#percent').getByText('18%',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>fixtureSubscriptions),1);
  checks.push('switch A → B → new chat → A; native adapter clears old readings');
  await page.evaluate(()=>{const quota=document.createElement('div');quota.id='quota';quota.dataset.codexpp='usage-slot';quota.style.cssText='height:380px;flex:none';quota.textContent='原生额度';document.querySelector('nav').insertBefore(quota,document.querySelector('#utilities'));});
  await meter.waitFor({state:'hidden'});
  assert.equal(await page.locator('#utilities').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),true);
  await page.evaluate(()=>document.querySelector('#quota').remove());await meter.waitFor({state:'visible'});
  const overlap=await page.evaluate(()=>{const a=document.querySelector('context-lens-sidebar').getBoundingClientRect();return [...document.querySelectorAll('nav button')].some(e=>{const b=e.getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;});});
  assert.equal(overlap,false);checks.push('native quota insertion hides crowded dock; removal restores without overlapping controls');
  await mkdir('.research',{recursive:true});await page.screenshot({path:'.research/native-sidebar-fixture-dock.png'});
  const grip=await meter.locator('#grip').boundingBox();
  await verifyGrip(page,false);
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(290,220);
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await meter.getAttribute('data-mode'),'docked');
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(360,240,{steps:5});await page.mouse.up();
  assert.equal(await meter.getAttribute('data-mode'),'horizontal');assert.equal(await meter.evaluate(e=>e.getBoundingClientRect().height),36);
  await verifyGrip(page,true);
  const order=await meter.evaluate(e=>{const s=e.shadowRoot;return ['capacity','track','percent'].map(id=>s.getElementById(id).getBoundingClientRect().left);});assert.ok(order[0]<order[1]&&order[1]<order[2]);
  const shortWidth=await meter.evaluate(e=>e.getBoundingClientRect().width);
  await page.evaluate(b=>{fixtureScope.value.conversationId=b;},b);await meter.locator('#percent').getByText('80%',{exact:true}).waitFor();
  assert.ok(await meter.evaluate(e=>e.getBoundingClientRect().width)>shortWidth);
  checks.push('single-press undock; horizontal order capacity/bar/percent; length follows actual capacity');
  await meter.click({button:'right'});await meter.getByRole('menuitem',{name:'改为竖向',exact:true}).click();
  const verticalGrip=await meter.locator('#grip').boundingBox();
  await verifyGrip(page,false);
  await page.mouse.move(verticalGrip.x+12,verticalGrip.y+8);await page.mouse.down();await page.mouse.move(640,340,{steps:5});await page.mouse.up();
  assert.equal(await meter.getAttribute('data-mode'),'vertical');assert.equal(await meter.evaluate(e=>e.getBoundingClientRect().width),36);
  await page.setViewportSize({width:340,height:420});await page.waitForTimeout(350);
  assert.equal(await meter.evaluate(e=>{const r=e.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight&&r.left>=0&&r.top>=0;}),true);
  checks.push('vertical floating retains orientation during drag; viewport resize keeps it visible');
  const beforeReload=await meter.boundingBox();
  await page.evaluate(()=>{
    const runtime=nativeSource.runtime,profile=nativeSource.runtimeProfile;
    monitor.stop();nativeSource=new NativeSourceFixture();nativeSource.runtime=runtime;nativeSource.runtimeProfile=profile;
    monitor=createSidebarFixture(nativeSource);
  });
  await meter.locator('#percent').getByText('80%',{exact:true}).waitFor();
  assert.equal(await meter.getAttribute('data-mode'),'vertical');
  // paint updates the text first, then arranges the floating widget on the next frame.
  await meter.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const afterReload=await meter.boundingBox();
  assert.ok(Math.abs(afterReload.x-beforeReload.x)<1&&Math.abs(afterReload.y-beforeReload.y)<1,JSON.stringify({beforeReload,afterReload}));
  assert.equal(await page.evaluate(()=>fixtureSubscriptions),1);
  checks.push('hot reload retains vertical floating position through namespaced Web Storage without storing chat data');
  await page.screenshot({path:'.research/native-sidebar-fixture-floating.png'});
  // A separate renderer sees a different thread. No shared localStorage or global last-selected thread.
  const other=await browser.newPage({viewport:{width:900,height:700}});await setup(other,a);
  await other.locator('context-lens-sidebar #percent').getByText('18%',{exact:true}).waitFor();
  assert.equal(await meter.locator('#percent').textContent(),'80%');
  await other.evaluate(()=>{monitor.stop();monitor.stop();});
  assert.equal(await other.locator('context-lens-sidebar').count(),0);await other.close();
  checks.push('two isolated renderer windows keep independent conversations; repeated stop cleans up');
  await page.setViewportSize({width:1000,height:700});
  await meter.click({button:'right'});await meter.getByRole('menuitem',{name:'固定回左侧栏',exact:true}).click();
  await page.evaluate(()=>{const rail=document.querySelector('nav');rail.querySelector('context-lens-sidebar').remove();const next=rail.cloneNode(true);rail.replaceWith(next);});
  await meter.waitFor({state:'visible'});assert.equal(await page.locator('context-lens-sidebar').count(),1);
  checks.push('native rail remount reattaches exactly once');
  await page.evaluate(()=>{fixtureRuntime.c={};});
  await meter.locator('#percent').getByText('—',{exact:true}).waitFor();
  assert.match(await meter.getAttribute('title'),/初始化/);
  assert.equal(await page.evaluate(()=>fixtureSubscriptions),0);
  await page.evaluate(()=>{fixtureRuntime.c={tl5a:{exports:{k2:'usage-replacement',qX:'host'}}};});
  await meter.locator('#percent').getByText('80%',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>fixtureSubscriptions),1);
  checks.push('Rspack cache disappearance clears values and releases subscription; replacement recovers');
  await page.evaluate(profile=>{
    window.fixturePreflight={model:'gpt-6-astra',responseInProgress:false,requestCount:0,pendingRequestKind:null,
      resumeState:'resumed',ephemeral:false,runtimeStatus:{type:'idle'},latestTurnStatus:'completed'};
    fixtureScope.get=(atom,thread)=>atom==='host'?'local':Object.hasOwn(fixturePreflight,atom)?fixturePreflight[atom]:fixtureUsage[thread];
    nativeSource.runtimeProfile=profile;
    Object.assign(fixtureRuntime.c.tl5a.exports,Object.fromEntries(Object.entries(profile.preflightExports).map(([field,key])=>[key,field])));
  },RSPACK_3838_PROFILE);
  await page.waitForFunction(()=>monitor.status().diagnostics.capacityPreflight.idle===true);
  assert.equal(await page.evaluate(()=>monitor.status().diagnostics.capacityPreflight.canApply),false);
  assert.equal(await page.evaluate(()=>fixtureSubscriptions),1);
  await meter.click({button:'right'});await meter.getByRole('menuitem',{name:'查看容量检查',exact:true}).click();
  await meter.locator('#bubble').getByText(/gpt-6-astra · 对话空闲/).waitFor();
  await page.evaluate(()=>{fixturePreflight.responseInProgress=true;});
  await meter.click({button:'right'});await meter.getByRole('menuitem',{name:'查看容量检查',exact:true}).click();
  await meter.locator('#bubble').getByText(/对话正在运行/).waitFor();
  assert.equal(await meter.locator('#percent').textContent(),'80%');
  checks.push('new native profile preflight follows idle/busy; menu stays read-only; usage and one subscription retained');
  const track=meter.locator('#track'), preview=meter.locator('#target-preview');
  async function geometry(horizontal=false) {
    return meter.evaluate((root,h)=>{
      const box=id=>root.shadowRoot.getElementById(id).getBoundingClientRect();
      const bar=box('track'),thumb=box('thumb'),widget=root.getBoundingClientRect(),label=box('target-preview');
      return {length:h?bar.width:bar.height,base:h?bar.left:bar.bottom,tip:h?bar.right:bar.top,
        thumb:h?thumb.left+thumb.width/2:thumb.top+thumb.height/2,widget:h?widget.width:widget.height,
        labelEnd:label.bottom,labelX:label.left+label.width/2,labelWidth:label.width,barTop:bar.top,
        fill:h?box('fill').width/bar.width:box('fill').height/bar.height};
    },horizontal);
  }
  function near(a,b,why,tolerance=1){assert.ok(Math.abs(a-b)<=tolerance,why+' ('+a+', '+b+')');}
  async function pressBar(){
    const r=await track.boundingBox(), x=r.x+r.width/2,y=r.y+r.height/2;
    await page.mouse.move(x,y);await page.mouse.down();return {x,y};
  }
  async function checkTravel(before,h,delta) {
    const g=await geometry(h);
    near(g.base,before.base,'fixed origin');near(g.length,before.length+delta,'track travels with pointer');
    near(g.widget,before.widget+delta,'widget fits track');near(g.thumb,g.tip,'thumb stays at tip');
    near(g.labelEnd,g.barTop-7,'label follows tip height');
    if(h)near(g.labelX,g.tip,'horizontal preview follows thumb');
    return g;
  }
  const targetKey='context-lens.target.v1.local.'+b+'.gpt-6-astra';
  await page.evaluate(b=>{fixtureUsage[b].modelContextWindow=258400;fixtureUsage[b].last.totalTokens=210000;},b);
  const warningButton=meter.locator('#bubble').getByRole('button',{name:'预设 384k · 预计有效 364.8k',exact:true});
  await warningButton.click();
  await preview.getByText(/384k 预设已保存/).waitFor();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),targetKey),'384000');
  assert.equal(await meter.locator('#capacity').textContent(),'258.4k');
  assert.equal(await meter.getAttribute('data-low'),'');
  await preview.waitFor({state:'hidden'});
  await meter.click({button:'right'});await meter.getByRole('menuitem',{name:'查看容量预设',exact:true}).click();
  await meter.locator('#bubble').getByText(/当前有效容量 258.4k。.*384k.*预计可用 364.8k，预计压缩点 345.6k/).waitFor();
  await meter.click({button:'right'});await meter.getByRole('menuitem',{name:'清除本对话预设',exact:true}).click();
  await page.evaluate(b=>{fixtureUsage[b].last.totalTokens=102400;},b);
  await meter.locator('#percent').getByText('60%',{exact:true}).waitFor();
  await page.evaluate(b=>{fixtureUsage[b].last.totalTokens=210000;},b);
  await warningButton.waitFor();
  await warningButton.evaluate((button,a)=>{fixtureScope.value.conversationId=a;button.click();},a);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),targetKey),null);
  assert.equal(await page.evaluate(a=>localStorage.getItem('context-lens.target.v1.local.'+a+'.gpt-6-astra'),a),null);
  await page.evaluate(b=>{fixtureScope.value.conversationId=b;fixtureUsage[b].last.totalTokens=102400;},b);
  await meter.locator('#percent').getByText('60%',{exact:true}).waitFor();
  checks.push('warning offers the smallest sufficient larger tier; one click saves only this chat, leaves real capacity/red state intact, and a stale alert cannot write after navigation');
  await meter.locator('#capacity').getByText('258.4k',{exact:true}).waitFor();
  const before=await geometry(), press=await pressBar();
  await preview.getByText('当前 258.4k · 60%',{exact:true}).waitFor();await checkTravel(before,false,0);
  for(const delta of [4,9,42]){
    await page.mouse.move(press.x,press.y-delta);await checkTravel(before,false,delta);
    await preview.getByText(delta<10?/默认 272k · 预计有效 258.4k/:/预设 512k · 预计有效 486.4k · 约 79%/).waitFor();
  }
  await page.waitForTimeout(300); // Polling must not reset a held gesture.
  near((await checkTravel(before,false,42)).fill,.79,'preview shows remaining fraction',.01);
  await page.mouse.up();
  await preview.getByText(/512k 预设已保存 · 预计有效 486.4k/).waitFor();
  const chosen=await page.evaluate(()=>monitor.status().capacityChoice);
  assert.equal(chosen.threadId,b);assert.equal(chosen.selection.tokens,512000);
  assert.equal(await page.evaluate(id=>monitor.acknowledgeChoice(id),chosen.id),true);
  await preview.getByText(/512k 已提交/).waitFor();
  await page.waitForTimeout(300);await checkTravel(before,false,48);
  await page.waitForTimeout(750);await checkTravel(before,false,48);
  assert.equal(await meter.locator('#percent').textContent(),'60%');
  await preview.waitFor({state:'hidden',timeout:2300});
  near((await geometry()).length,before.length,'return to reported capacity');
  assert.equal(await page.evaluate(id=>monitor.confirmTurn(id,486400),chosen.id),true);
  await meter.locator('#bubble').getByText('已生效 · 486.4k',{exact:true}).waitFor();
  assert.equal(await page.evaluate(([id,a,b])=>{fixtureScope.value.conversationId=a;const rejected=monitor.confirmTurn(id,486400);fixtureScope.value.conversationId=b;return rejected;},[chosen.id,a,b]),false);
  checks.push('native next-turn receipt shows effective capacity once and rejects a different visible chat');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),targetKey),'512000');
  for(let attempt=0;attempt<2;attempt++) {
    const p=await pressBar();
    await preview.getByText('当前 258.4k · 60%',{exact:true}).waitFor();
    await page.mouse.move(p.x,p.y-24);await preview.getByText(/预设 384k/).waitFor();
    await page.mouse.move(p.x,p.y-96);await preview.getByText(/预设 872k/).waitFor();await page.mouse.up();
    await preview.getByText(/872k 预设已保存/).waitFor();
    if(attempt===0){
      const reported=await page.evaluate(()=>{const id=monitor.status().capacityChoice.id;
        const premature=monitor.confirmTurn(id,258400);monitor.acknowledgeChoice(id);return [premature,monitor.confirmTurn(id,258400)];});
      assert.deepEqual(reported,[false,true]);
      await meter.locator('#bubble').getByText(/本回合实测 258.4k/).waitFor();
      assert.equal(await page.evaluate(id=>monitor.confirmTurn(id,486400),chosen.id),false);
    }
    await preview.waitFor({state:'hidden'});
    near((await geometry()).length,before.length,'full return before a fresh drag');
  }
  await pressBar();await page.mouse.up();await preview.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),targetKey),'872000','a tap preserves the saved target');
  checks.push('258.4k live window → 872k preset → full return → upward drag to 872k again; tapping preserves the saved preset');
  await page.evaluate(b=>{fixtureUsage[b].modelContextWindow=400000;},b);
  await meter.locator('#capacity').getByText('400k',{exact:true}).waitFor();
  await track.press('Enter');await preview.getByText(/当前 400k/).waitFor();
  await track.press('ArrowDown');await preview.getByText(/预设 384k/).waitFor();await track.press('Escape');
  await track.press('ArrowUp');await preview.getByText(/预设 512k/).waitFor();
  await page.evaluate(b=>{fixtureUsage[b].modelContextWindow=486400;},b);
  await meter.locator('#capacity').getByText('486.4k',{exact:true}).waitFor();
  await preview.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),targetKey),'872000','native capacity change cancels the old preview');
  checks.push('custom effective window starts between detents, keyboard reaches each neighbor, changed live capacity cancels the stale gesture');
  for (const [h,menu] of [[true,'拉出为横向悬浮条'],[false,'改为竖向']]) {
    await meter.click({button:'right'});await meter.getByRole('menuitem',{name:menu,exact:true}).click();
    const original=await geometry(h), p=await pressBar();
    await preview.getByText(/当前 486.4k/).waitFor();await checkTravel(original,h,0);
    for(const delta of [4,9,-22]){
      await page.mouse.move(p.x+(h?delta:0),p.y-(h?0:delta));await checkTravel(original,h,delta);
    }
    await preview.getByText(/预设 384k/).waitFor();
    await page.keyboard.press('Escape');await page.mouse.up();await preview.waitFor({state:'hidden'});
    near((await geometry(h)).length,original.length,'cancel restores geometry');
  }
  checks.push('dock and both floating orientations: no press jump, continuous track and widget growth, tip and label follow, bidirectional drag from measured middle tier despite saved maximum; release snaps, holds and returns');
  await meter.click({button:'right'});await meter.getByRole('menuitem',{name:'固定回左侧栏',exact:true}).click();
  const dock=await geometry(), first=await pressBar();
  await page.mouse.move(first.x,first.y-24);await page.mouse.up();
  await preview.getByText(/768k 预设已保存/).waitFor();await page.waitForTimeout(200);
  const held=await geometry(), second=await pressBar();await checkTravel(held,false,0);
  await page.mouse.move(second.x,second.y+24);await page.mouse.up();
  await preview.getByText(/512k 预设已保存/).waitFor();await preview.waitFor({state:'hidden'});
  near((await geometry()).length,dock.length,'re-grabbing the extended bar still returns to the original length');
  await page.setViewportSize({width:640,height:408});await page.waitForTimeout(300);
  const compact=await geometry(), small=await pressBar();await page.mouse.move(small.x,small.y-96);
  await preview.getByText(/预设 872k/).waitFor();
  const full=await geometry();assert.ok(full.length>compact.length+2 && full.length<compact.length+48,'compact dock grows within available room');
  const clear=await meter.evaluate(e=>{const bar=e.getBoundingClientRect();return [...document.querySelectorAll('nav button')].every(b=>{
    const r=b.getBoundingClientRect();return r.bottom<=bar.top||r.top>=bar.bottom;
  });});assert.ok(clear,'expanded compact dock leaves native buttons clear');
  await page.keyboard.press('Escape');await page.mouse.up();
  await page.setViewportSize({width:1000,height:700});await page.waitForTimeout(300);
  checks.push('re-grabbing during the hold starts at the visible length; compact dock leaves native buttons clear even at the highest tier');
  const again=await pressBar();await page.mouse.move(again.x,again.y-100);
  await preview.getByText(/预设 872k/).waitFor();
  await page.evaluate(()=>{fixturePreflight.model='gpt-6.2-sol';});await page.mouse.up();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),targetKey),'512000');
  await track.focus();await track.press('Home');await preview.getByText(/默认 500k · 预计有效 475k/).waitFor();
  await track.press('Escape');await preview.waitFor({state:'hidden'});
  await page.evaluate(a=>{fixtureScope.value.conversationId=a;},a);
  await meter.locator('#percent').getByText('18%',{exact:true}).waitFor();
  await track.press('End');await preview.getByText(/预设 872k/).waitFor();
  await page.evaluate(b=>{fixtureScope.value.conversationId=b;},b);
  await track.press('Enter');
  assert.equal(await page.evaluate(a=>localStorage.getItem('context-lens.target.v1.local.'+a+'.gpt-6.2-sol'),a),null);
  await page.evaluate(()=>{fixturePreflight.model='unsupported-model';});
  await track.press('End');await preview.waitFor({state:'hidden'});
  checks.push('one-press tier preview, 1.5s dismissal, live usage preserved, keyboard snap, model and thread change cancel');
  await page.evaluate(()=>{nativeSource.module=null;nativeSource.runtime=null;});
  await meter.locator('#percent').getByText('—',{exact:true}).waitFor();
  assert.match(await meter.getAttribute('title'),/版本尚未适配/);
  assert.equal(await page.evaluate(()=>fixtureSubscriptions),0);
  await page.evaluate(()=>monitor.stop());await page.waitForTimeout(350);assert.equal(await meter.count(),0);
  checks.push('unknown app asset clears usage; unload leaves no meter');
  assert.deepEqual(errors,[]);
  for(const deviceScaleFactor of [1.25,2]){
    const scaled=await browser.newPage({viewport:{width:900,height:700},deviceScaleFactor});
    await setup(scaled,a);
    const widget=scaled.locator('context-lens-sidebar');
    await widget.locator('#percent').getByText('18%',{exact:true}).waitFor();
    await verifyGrip(scaled,false);
    await widget.click({button:'right'});
    await widget.getByRole('menuitem',{name:'拉出为横向悬浮条'}).click();
    await verifyGrip(scaled,true);
    if(deviceScaleFactor===2){
      const onResume=await scaled.evaluate(()=>{
        const clock=Date.now;
        Object.defineProperty(document,'hidden',{configurable:true,value:true});
        try{
          document.dispatchEvent(new Event('visibilitychange'));
          Date.now=()=>clock()+5000;
          Object.defineProperty(document,'hidden',{configurable:true,value:false});
          document.dispatchEvent(new Event('visibilitychange'));
          return monitor.status().status;
        }finally{Date.now=clock;delete document.hidden;}
      });
      assert.equal(onResume,'waiting');
      await scaled.waitForFunction(()=>monitor.status().status==='following');
      checks.push('resume after a long hidden interval waits for a fresh reading without a false failure');
    }
    await scaled.close();
  }
  checks.push('six complete centered dots; horizontal hover highlight and drag hit area agree at 1x, 1.25x and 2x');
  const evidence={kind:'isolated-browser-fixture',version:manifest.version,nativeCodexAcceptance:false,checks,errors};
  const evidenceTag=manifest.version.split('-').at(-1).replaceAll('.','');
  await mkdir('docs/evidence',{recursive:true});await writeFile(`docs/evidence/native-sidebar-${evidenceTag}-fixture.json`,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();}
