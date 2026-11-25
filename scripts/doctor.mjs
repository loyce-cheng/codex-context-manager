import { LocalCodexSource } from '../src/adapters/local-codex.mjs';
const source=new LocalCodexSource();
const arg=process.argv.indexOf('--thread'),id=arg>=0?process.argv[arg+1]:null;
const report={node:process.versions.node,platform:process.platform,capabilities:source.capabilities(),localThreadCount:(await source.listThreads()).length};
if(id)report.snapshot=await source.snapshot(id);
process.stdout.write(JSON.stringify(report,null,2)+'\n');
