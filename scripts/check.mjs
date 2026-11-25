import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
import { sidebarBundle } from './build-sidebar.mjs';
import { widgetHtml } from '../src/server/service.mjs';
async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())await walk(path);else if(path.endsWith('.mjs')){const check=spawnSync(process.execPath,['--check',path],{encoding:'utf8',windowsHide:true});if(check.status!==0){process.stderr.write(path+': '+(check.error?.message||check.stderr||'syntax check failed')+'\n');process.exitCode=1;}}}}
for(const dir of ['src','scripts','tests','packaging','experiments','native-sidebar/src'])await walk(dir);
new Script(await sidebarBundle(),{filename:'bundled-sidebar.js'});
const html=await widgetHtml();
const module=html.match(/<script type="module">([\s\S]*?)<\/script>/);
if(!module)throw Error('Missing widget module.');
const parsed=spawnSync(process.execPath,['--input-type=module','--check'],{input:module[1],encoding:'utf8',windowsHide:true});
if(parsed.status!==0)throw Error(parsed.stderr||'Invalid bundled widget module.');
if(!process.exitCode)process.stdout.write('Syntax checks passed.\n');
