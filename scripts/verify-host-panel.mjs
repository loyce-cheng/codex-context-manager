// Contract test in an isolated host fixture; this is NOT a real Codex panel test.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { widgetHtml } from '../src/server/service.mjs';
import { normalizeSnapshot, VERSION } from '../src/core/context.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const id='11111111-1111-4111-8111-111111111111';
const snapshot=normalizeSnapshot({threadId:id,model:'host-fixture',used:223040,window:272000,revision:1,measuredAt:new Date().toISOString()},{defaultWindow:272000,maxWindow:872000,effectivePercent:100});
const data={version:VERSION,snapshot,binding:{mode:'explicit-thread',threadId:id},capabilities:{runtimeWindowUpdate:false}};
const widget=await widgetHtml();
const host=`<!doctype html><html><body><iframe title="Context Lens" src="/widget" style="width:400px;height:540px"></iframe><script>
  window.requests=[];window.acceptDisplay=false;
  window.context={displayMode:'fullscreen',availableDisplayModes:['inline','fullscreen']};
  const data=${JSON.stringify(data)};
  function notify(method,params){document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method,params},location.origin);}
  window.changeContext=patch=>{Object.assign(context,patch);notify('ui/notifications/host-context-changed',patch);};
  addEventListener('message',event=>{
    if(event.source!==document.querySelector('iframe').contentWindow)return;
    const m=event.data;if(m?.jsonrpc!=='2.0')return;requests.push(m);
    if(m.method==='ui/notifications/initialized'){notify('ui/notifications/tool-result',{structuredContent:data});return;}
    let result;
    if(m.method==='ui/initialize')result={protocolVersion:m.params.protocolVersion,hostInfo:{name:'isolated-contract-fixture',version:'1'},hostCapabilities:{},hostContext:context};
    else if(m.method==='ui/request-display-mode'){if(acceptDisplay)context.displayMode=m.params.mode;result={mode:context.displayMode};}
    else if(m.method==='tools/call')result={content:[],structuredContent:m.params.name==='list_context_threads'?{threads:[]}:data};
    else return;
    event.source.postMessage({jsonrpc:'2.0',id:m.id,result},event.origin);
  });
</script></body></html>`;
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(6000);
  // Fulfill inside the browser test runner: no listening port or external request.
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:new URL(route.request().url()).pathname==='/widget'?widget:host}));
  await page.goto('https://context-lens-fixture.test/');
  const app=page.frameLocator('iframe');
  await app.locator('#meter').waitFor({state:'visible'});
  assert.equal(await app.locator('#host-mode').getAttribute('data-mode'),'fullscreen');
  assert.equal(await app.locator('#percent').textContent(),'≈18%');
  const initialized=await page.evaluate(()=>requests.find(r=>r.method==='ui/initialize'));
  assert.deepEqual(initialized.params.appCapabilities.availableDisplayModes,['inline','fullscreen']);
  await app.locator('#grip').click();
  await app.locator('[data-action="inline"]').click();
  await app.locator('#notice').waitFor({state:'visible'});
  assert.match(await app.locator('#notice-text').textContent(),/没有切换/);
  assert.equal(await app.locator('#host-mode').getAttribute('data-mode'),'fullscreen','a declined request cannot pretend to change modes');
  await app.locator('#dismiss').click();
  await page.evaluate(()=>{window.acceptDisplay=true;});
  await app.locator('#grip').click();await app.locator('[data-action="inline"]').click();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#host-mode').dataset.mode==='inline');
  await app.locator('#grip').click();assert(await app.locator('[data-action="fullscreen"]').isVisible());
  await app.locator('[data-action="fullscreen"]').click();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#host-mode').dataset.mode==='fullscreen');
  // The mode label is now a visible action; it must work without the hidden menu.
  await app.locator('#host-mode').click();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#host-mode').dataset.mode==='inline');
  assert.match(await app.locator('#host-mode').textContent(),/展开监控/);
  await app.locator('#host-mode').click();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#host-mode').dataset.mode==='fullscreen');
  // Host notifications can be partial; the supported mode list must survive.
  await page.evaluate(()=>changeContext({displayMode:'inline'}));
  await app.locator('#grip').click();assert(await app.locator('[data-action="fullscreen"]').isVisible());
  await page.evaluate(()=>changeContext({availableDisplayModes:['inline']}));
  await app.locator('[data-action="fullscreen"]').waitFor({state:'hidden'});
  assert.equal(await app.locator('#host-mode').isEnabled(),false);
  assert.equal(await app.locator('[data-action="pip"]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: isolated MCP UI handshake, snapshot rendering, fullscreen/inline transitions, declined transitions, partial context updates, unsupported mode gating. Real Codex UI verification is separate.');
}finally{await browser?.close();}
