import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {startFile} from '../src/server/file.mjs';
import {normalizeSnapshot,VERSION} from '../src/core/context.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
let selected='w1',state='following',used=136000,revision=1,deadline=null;
function data(){
 const now=Date.now(),windows=[['w1',A,used],['w2',B,68000]].map(([key,id,n],i)=>({key,windowId:i+1,label:'窗口 '+(i+1),state,threadId:state==='following'?id:null,message:state==='following'?'跟随新对话':'页面信号已过期',validUntil:deadline??now+10000,snapshot:state==='following'?normalizeSnapshot({threadId:id,model:'fixture',used:n,window:272000,revision,measuredAt:new Date().toISOString()},{defaultWindow:272000,maxWindow:872000,effectivePercent:100}):null}));
 return {version:VERSION,generatedAt:now,capabilities:{activeThreadBinding:true},follow:{scope:'selected-local',state,selectedWindowKey:selected,windows,registeredCount:2,message:'页面信号已过期'}};
}
const app=await startFile({follower:{start:async()=>{},close:async()=>{},read:async()=>data()},intervalMs:100});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
 const page=await browser.newPage({viewport:{width:300,height:540}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url);await page.waitForFunction(()=>document.querySelector('#percent').textContent==='≈50%');
 assert.match(await page.locator('#mode-label').innerText(),/当前对话/);assert.equal(await page.locator('#version').textContent(),VERSION.replace('0.1.0-',''));
 used=223040;revision++;await page.waitForFunction(()=>document.querySelector('#percent').textContent==='≈18%');assert(await page.locator('#notice').isVisible());
 selected='w2';await page.waitForFunction(()=>document.querySelector('#percent').textContent==='≈75%');assert(await page.locator('#notice').isHidden(),'switch must clear previous alert');
 await page.locator('#meter').click({button:'right'});await page.locator('#follow-window').selectOption('w1');await page.waitForFunction(()=>document.querySelector('#percent').textContent==='≈18%');
 state='expired';await page.locator('#meter').waitFor({state:'hidden'});assert.equal(await page.locator('#percent').textContent(),'—');assert(await page.locator('#follow-empty').isVisible());
 await page.locator('#stage').click({button:'right',position:{x:30,y:30}});await page.waitForTimeout(1200);assert(await page.locator('#menu').isVisible(),'waiting polls must not keep closing window menu');
 await page.locator('#follow-window').selectOption('');state='following';selected='w2';await page.waitForFunction(()=>document.querySelector('#percent').textContent==='≈75%');
 // Even with fresh producer timestamps, an expired route must disappear.
 deadline=Date.now()+700;await page.waitForTimeout(1500);assert(await page.locator('#meter').isHidden());
 deadline=null;await page.waitForFunction(()=>document.querySelector('#percent').textContent==='≈75%');
 await app.close();await page.locator('#meter').waitFor({state:'hidden',timeout:8000});assert.equal(await page.locator('#percent').textContent(),'—');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Start.cmd'));
 const fixed=await startFile({threadId:A,source:{capabilities:()=>({}),snapshot:async()=>normalizeSnapshot({threadId:A,used:136000,window:272000})}});
 try{await page.goto(fixed.url);await page.waitForFunction(()=>document.querySelector('#percent').textContent==='≈50%');await fixed.close();await page.locator('#meter').waitFor({state:'hidden',timeout:8000});assert.equal(await page.locator('#percent').textContent(),'—');assert.match(await page.locator('#status').innerText(),/Start.cmd/);}finally{await fixed.close();}
 assert.deepEqual(errors,[]);await mkdir('.research',{recursive:true});await page.screenshot({path:'.research/alpha3-follow-paused.png'});
 console.log('PASS: active scope/version display, window switching/pinning, warning isolation, unknown-state menu, lease expiry and auto/fixed producer disconnect.');
}finally{await browser.close();await app.close().catch(()=>{});}
