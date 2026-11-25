// Real service logic behind an isolated MCP UI host; not a real Codex screenshot.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createService,widgetHtml} from '../src/server/service.mjs';
import {normalizeSnapshot,VERSION} from '../src/core/context.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const oldId='11111111-1111-4111-8111-111111111111',liveId='22222222-2222-4222-8222-222222222222';
const widget=await widgetHtml();
function envelope(mode,id=null){
  const at=Date.now(),state=id?'following':'waiting',scope=mode==='active'?'selected-local':'since-monitor-start';
  const snapshot=id?normalizeSnapshot({threadId:id,model:'reconnect-fixture',used:id===oldId?223040:97920,window:272000,revision:1,measuredAt:new Date().toISOString()},{defaultWindow:272000,maxWindow:872000,effectivePercent:100}):null;
  const window={key:'fixture-window',label:'窗口 1',windowId:1,visible:true,focused:true,state,threadId:id,snapshot,validUntil:at+25000,confirmedAt:at,message:id?'跟随当前本地对话':'等待页面信号'};
  return {version:VERSION,generatedAt:at,snapshot,threadId:id,capabilities:{runtimeWindowUpdate:false},follow:{mode:'desktop-log-'+mode,scope,state,threadId:id,windows:[window],selectedWindowKey:window.key,message:window.message,selectionPolicy:'continuous-log'}};
}
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
  for(const mode of ['active','new']){
    let selected=null,starts=0,closes=0;const scopes=[],requests=[],errors=[];
    const freshService=()=>createService({capabilities:()=>({runtimeWindowUpdate:false}),listThreads:async()=>[]},{followerFactory:scope=>{
      scopes.push(scope);return {start:async()=>{starts++;},read:async()=>envelope(scope,selected),close:async()=>{closes++;}};
    }});
    let service=freshService();
    const page=await browser.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
    await page.exposeFunction('hostToolCall',async(name,args)=>{
      requests.push({name,args});try{return await service.call(name,args);}catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
    });
    await page.addInitScript(()=>{
      window.__seenPercents=[];
      new MutationObserver(()=>{const value=document.querySelector('#percent')?.textContent;if(value&&window.__seenPercents.at(-1)!==value)window.__seenPercents.push(value);}).observe(document,{subtree:true,childList:true,characterData:true});
    });
    const cached=envelope(mode,oldId);
    const host=`<!doctype html><html><body><iframe src="/widget" style="width:400px;height:540px"></iframe><script>
      addEventListener('message',async event=>{
        if(event.source!==document.querySelector('iframe').contentWindow||event.data?.jsonrpc!=='2.0')return;
        const m=event.data;
        if(m.method==='ui/notifications/initialized'){
          event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(cached)}}},event.origin);return;
        }
        let result;
        if(m.method==='ui/initialize')result={protocolVersion:m.params.protocolVersion,hostCapabilities:{},hostContext:{displayMode:'fullscreen',availableDisplayModes:['inline','fullscreen']}};
        else if(m.method==='tools/call')result=await hostToolCall(m.params.name,m.params.arguments);
        else return;
        event.source.postMessage({jsonrpc:'2.0',id:m.id,result},event.origin);
      });
    </script></body></html>`;
    try{
      await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:new URL(route.request().url()).pathname==='/widget'?widget:host}));
      await page.goto('https://context-lens-reconnect.test/');const app=page.frameLocator('iframe');
      await app.locator('#status').getByText('等待页面信号',{exact:true}).waitFor();
      assert.equal(starts,1);assert.equal(await app.locator('#meter').isVisible(),false);
      assert.equal(await app.locator('body').evaluate(()=>window.__seenPercents.includes('≈18%')),false,'cached usage must never be presented as a live restored reading');
      selected=liveId;await app.locator('#percent').getByText('≈64%',{exact:true}).waitFor();
      assert.match(await app.locator('#status').textContent(),/22222222/);
      // Replace the service while retaining the very same iframe and polling loop.
      await service.close();service=freshService();selected=null;
      await app.locator('#status').getByText('等待页面信号',{exact:true}).waitFor();
      assert.equal(starts,2);assert.equal(await app.locator('#meter').isVisible(),false);
      selected=liveId;await app.locator('#percent').getByText('≈64%',{exact:true}).waitFor();
      assert.deepEqual(scopes,[mode,mode]);assert.equal(starts,2);assert.equal(closes,1);
      const refreshes=requests.filter(r=>r.name==='read_active_context_snapshot');
      assert(refreshes.length>=4);assert(refreshes.every(r=>r.args.follow_mode===mode));
      assert(requests.every(r=>r.name==='read_active_context_snapshot'||r.name==='list_context_threads'),'recovery must not create another monitor widget');
      assert.deepEqual(errors,[]);
      console.log('PASS: '+mode+' restored card and backend reconnect initialize once, discard cached selection and resume only from fresh snapshots.');
    }finally{await page.close();await service.close();}
  }
}finally{await browser.close();}
