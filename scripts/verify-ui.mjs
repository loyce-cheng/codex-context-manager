import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startFile } from '../src/server/file.mjs';
import { normalizeSnapshot } from '../src/core/context.mjs';
const require=createRequire(import.meta.url);
// Optional development dependency, never included in the release runtime.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const id='11111111-1111-4111-8111-111111111111';let used=136000,revision=1;
const model={defaultWindow:272000,maxWindow:872000,effectivePercent:100};
const source={capabilities:()=>({runtimeWindowUpdate:false}),snapshot:async()=>normalizeSnapshot({threadId:id,model:'fixture',used,window:272000,revision,measuredAt:new Date().toISOString()},model)};
const app=await startFile({source,threadId:id,intervalMs:100});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
await mkdir('.research',{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:400,height:540}});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await page.goto(app.url);await page.locator('#meter').waitFor({state:'visible'});console.log('File snapshot loaded');assert.equal(await page.locator('#percent').textContent(),'≈50%');
  let box=await page.locator('#meter').boundingBox();assert.equal(box.width,36);
  const centered=await Promise.all(['grip','reading','rail','slider'].map(x=>page.locator('#'+x).boundingBox()));const axis=centered[0].x+centered[0].width/2;centered.forEach(r=>assert(Math.abs(r.x+r.width/2-axis)<1));
  used=223040;revision++;await page.waitForFunction(()=>document.getElementById('percent').textContent==='≈18%',null,{timeout:8000});console.log('Snapshot refreshed');await page.waitForTimeout(320);
  const fill=await page.locator('#fill').boundingBox(),rail=await page.locator('#rail').boundingBox();assert(Math.abs(fill.height/rail.height-.18)<.01);
  assert(await page.locator('#meter').evaluate(n=>n.classList.contains('warning')));assert(await page.locator('#notice').isVisible());
  await page.screenshot({path:'.research/alpha-18-percent.png'});await page.waitForTimeout(5200);assert(await page.locator('#notice').isHidden());
  const locked=await page.locator('#slider').boundingBox();await page.mouse.click(locked.x+locked.width/2,locked.y+locked.height/2);assert(await page.locator('#notice').isVisible());assert.equal(await page.locator('#capacity').textContent(),'272k');await page.locator('#dismiss').click();
  await page.locator('#meter').click({button:'right',position:{x:3,y:70}});await page.locator('[data-action="demo"]').click();await page.waitForTimeout(320);
  const input=await page.locator('#slider').boundingBox();await page.mouse.move(input.x+input.width/2,input.y+input.height/2);await page.mouse.down();
  assert.equal(await page.locator('#capacity').textContent(),'272k','press must not jump tiers');
  await page.mouse.move(input.x+input.width/2,input.y+input.height/2-48,{steps:12});assert.equal(await page.locator('#capacity').textContent(),'512k');
  const label=await page.locator('#reading').boundingBox(),thumb=await page.locator('#thumb').boundingBox();assert(label.y+label.height<=thumb.y,'preview sits above thumb');
  assert.equal((await page.locator('#meter').boundingBox()).width,36);await page.screenshot({path:'.research/alpha-direct-drag.png'});
  await page.mouse.up();await page.waitForTimeout(450);assert.equal(await page.locator('#phase').textContent(),'已应用');
  await page.waitForTimeout(1000);assert.equal(await page.locator('#phase').textContent(),'已应用');await page.waitForTimeout(650);assert.equal(await page.locator('#phase').textContent(),'');
  await page.locator('#slider').focus();await page.keyboard.press('ArrowUp');await page.keyboard.press('Escape');assert.equal(await page.locator('#capacity').textContent(),'512k');
  const grip=await page.locator('#grip').boundingBox();await page.mouse.move(grip.x+13,grip.y+11);await page.mouse.down();await page.mouse.move(grip.x+93,grip.y+30,{steps:10});await page.mouse.up();await page.waitForTimeout(320);
  box=await page.locator('#meter').boundingBox();assert(box.width>box.height,'drag right becomes horizontal');
  assert.equal(box.height,44,'horizontal height matches vertical width');
  const parts=await Promise.all(['capacity','rail','percent'].map(id=>page.locator('#'+id).boundingBox()));assert(parts[0].x+parts[0].width<=parts[1].x&&parts[1].x+parts[1].width<=parts[2].x,'capacity, rail, percent are ordered left to right');
  // Move into free space before rotating so only viewport bounds, never a reset, can move it.
  const horizontalGrip=await page.locator('#grip').boundingBox();await page.mouse.move(horizontalGrip.x+20,horizontalGrip.y+20);await page.mouse.down();await page.mouse.move(horizontalGrip.x-10,horizontalGrip.y-80,{steps:10});await page.mouse.up();await page.waitForTimeout(320);
  const beforeRotate=await page.locator('#meter').boundingBox();await page.locator('#meter').click({button:'right',position:{x:6,y:4}});await page.locator('[data-action="vertical"]').click();await page.waitForTimeout(320);
  box=await page.locator('#meter').boundingBox();assert.equal(box.width,44);assert(Math.abs(box.x-beforeRotate.x)<1,'changing orientation must not snap to an edge');
  const verticalGrip=await page.locator('#grip').boundingBox();await page.mouse.move(verticalGrip.x+13,verticalGrip.y+11);await page.mouse.down();await page.mouse.move(verticalGrip.x+55,verticalGrip.y+31,{steps:10});await page.mouse.up();await page.waitForTimeout(320);
  box=await page.locator('#meter').boundingBox();assert.equal(box.width,44,'dragging a vertical float keeps it vertical');assert(box.x>beforeRotate.x+20);
  await page.locator('#meter').click({button:'right',position:{x:4,y:70}});await page.locator('[data-action="horizontal"]').click();await page.waitForTimeout(320);
  const midWidth=(await page.locator('#meter').boundingBox()).width;
  await page.locator('#slider').focus();await page.keyboard.press('End');await page.waitForTimeout(320);const maxWidth=(await page.locator('#meter').boundingBox()).width;assert(maxWidth>midWidth+30,'float grows with selected capacity');assert.equal((await page.locator('#meter').boundingBox()).height,44);
  await page.keyboard.press('Home');await page.waitForTimeout(320);assert((await page.locator('#meter').boundingBox()).width<midWidth-30,'no empty maximum-width reservation');await page.keyboard.press('Escape');
  for(let sample=0;sample<4;sample++){await page.waitForTimeout(70);const frame=await page.locator('#meter').boundingBox(),label=await page.locator('#percent').boundingBox();assert(label.x+label.width<=frame.x+frame.width+1,'percentage stays inside during resizing');}
  await page.waitForTimeout(100);
  await page.screenshot({path:'.research/alpha2-horizontal.png'});
  await page.setViewportSize({width:220,height:440});await page.waitForTimeout(320);box=await page.locator('#meter').boundingBox();assert(box.x>=0&&box.x+box.width<=220);
  assert.deepEqual(errors,[]);console.log('PASS: file snapshot refresh, remaining 18% fill, warning expiry, real-mode control lock, centered 36px rail, first-press drag, preview, snap/hold, Escape, floating orientation, resize.');
}finally{await browser.close();await app.close();}
