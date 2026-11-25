// Use the production slider in an isolated browser, with the real test thread ID
// and its latest app-server usage. The returned value has the Loader inspect shape.
import {createRequire} from 'node:module';
import {sidebarBundle} from '../../scripts/build-sidebar.mjs';

export async function sampleSidebarChoice({threadId, model, capacity, used, reset}) {
  const require = createRequire(import.meta.url);
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH});
  try {
    const page = await browser.newPage();
    await page.route('http://context-lens.test/**', route => route.fulfill({contentType:'text/html', body:
      '<style>nav{width:52px;height:95vh;display:flex;flex-direction:column}button{height:32px}</style>'+
      '<nav data-app-navigation-rail><div style="flex:1"><button>Chat</button></div><div><button aria-label="Open profile menu">P</button></div></nav>'}));
    await page.goto('http://context-lens.test/');
    await page.addScriptTag({content:await sidebarBundle({fixture:true})});
    await page.evaluate(({threadId,model,capacity,used})=>{
      window.monitor=createSidebarFixture({
        read:async()=>({status:'following',snapshot:{threadId,capacity,used,percent:100*(1-used/capacity)}}),
        diagnostics:()=>({capacityPreflight:{threadId,model,host:'local'}})
      });
    },{threadId,model,capacity,used});
    const track=page.locator('context-lens-sidebar #track');
    await page.waitForFunction(()=>window.monitor.status().status==='following');
    await track.press('Home');
    if(!reset){
      await track.press('ArrowRight');
      await track.press('ArrowRight');
    }
    await track.press('Enter');
    return await page.evaluate(()=>monitor.status());
  } finally {
    await browser.close();
  }
}
