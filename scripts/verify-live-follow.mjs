// Read-only live observation. Does not navigate, send model messages or write Codex state.
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setTimeout as wait} from 'node:timers/promises';
import {DesktopFollower} from '../src/adapters/desktop-follow.mjs';
import {assertThreadId} from '../src/adapters/local-codex.mjs';
const expected=assertThreadId(process.argv[2]);
const follower=new DesktopFollower({scope:'active'}),startedAt=Date.now(),samples=[];
const output=new URL('../docs/evidence/alpha7-live-follow.json',import.meta.url);
await follower.start();
console.log('Observer ready; waiting for a fresh selected-page event.');
try{
  for(let i=0;i<20;i++){
    await wait(5000);const data=await follower.read();
    const window=data.follow.windows.find(w=>w.key===data.follow.selectedWindowKey);
    const sample={elapsedMs:Date.now()-startedAt,state:data.follow.state,threadId:data.threadId,remainingPercent:data.snapshot?.remainingPercent??null,routeAgeMs:window?.confirmedAt?Date.now()-window.confirmedAt:null,selectionPolicy:data.follow.selectionPolicy};
    samples.push(sample);if(i%2===0)console.log(JSON.stringify(sample));
  }
}finally{
  await follower.close();
  const after60=samples.filter(s=>s.routeAgeMs>=60000);
  const result={recordedAt:new Date().toISOString(),kind:'live-read-only-local-logs',expectedThreadId:expected,samples,
    sustainedRouteObserved:after60.some(s=>s.state==='following'&&s.threadId===expected),
    wrongFollowingThreadObserved:samples.some(s=>s.state==='following'&&s.threadId!==expected),
    limitations:'Tests the workspace backend, not an installed Alpha 7 UI. Window freshness can still expire during idle periods. No model requests.'};
  await mkdir(new URL('../docs/evidence/',import.meta.url),{recursive:true});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output:fileURLToPath(output),sustainedRouteObserved:result.sustainedRouteObserved,wrongFollowingThreadObserved:result.wrongFollowingThreadObserved}));
}
