import { mkdir, cp, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { VERSION } from '../src/core/context.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Windows x64 release must be built using Windows x64 Node.');
// Ship exactly the runtime version whose complete third-party license is included.
if(process.version!=='v24.19.0')throw new Error('Build with Node v24.19.0, or update the pinned runtime/license together.');
const output=join(root,'dist',`context-lens-${VERSION}-win32-x64`),plugin=join(output,'plugins','context-lens');
await mkdir(join(plugin,'runtime'),{recursive:true});await mkdir(join(output,'scripts'),{recursive:true});
await mkdir(join(output,'.agents','plugins'),{recursive:true});
await cp(join(root,'src'),join(plugin,'src'),{recursive:true});
for(const name of ['plugin.json','mcp.json'])await copyFile(join(root,'packaging',name),join(plugin,name));
for(const name of ['install.mjs','install-workflow.mjs','launch.mjs','launch-file.mjs'])await copyFile(join(root,'packaging',name),join(output,'scripts',name));
const runtimePath=join(plugin,'runtime','node.exe'),nodeBytes=await readFile(process.execPath);
const runtimeHash=createHash('sha256').update(nodeBytes).digest('hex');let existingRuntimeHash;
try{existingRuntimeHash=createHash('sha256').update(await readFile(runtimePath)).digest('hex');}catch(error){if(error.code!=='ENOENT')throw error;}
// Windows locks a running executable. Reuse it only when its bytes exactly match.
if(existingRuntimeHash!==runtimeHash)await copyFile(process.execPath,runtimePath);
await copyFile(join(root,'third_party','NODE-LICENSE.txt'),join(plugin,'runtime','NODE-LICENSE.txt'));
await copyFile(join(root,'LICENSE'),join(plugin,'LICENSE'));
try {
  await copyFile(join(root,'README.md'),join(output,'README.md'));
} catch (error) {
  if(error.code!=='ENOENT')throw error;
}
await cp(join(root,'docs'),join(output,'docs'),{recursive:true});
await writeFile(join(output,'.agents','plugins','marketplace.json'),JSON.stringify({name:'context-lens-local',interface:{displayName:'Context Lens Local'},plugins:[{name:'context-lens',source:{source:'local',path:'./plugins/context-lens'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]},null,2)+'\n');
const launch=(script,args='')=>`@echo off\r\nchcp 65001 >nul\r\n"%~dp0plugins\\context-lens\\runtime\\node.exe" "%~dp0scripts\\${script}.mjs" ${args}\r\npause\r\n`;
await writeFile(join(output,'Install.cmd'),launch('install'));
await writeFile(join(output,'Uninstall.cmd'),launch('install','--remove'));
await writeFile(join(output,'Start.cmd'),launch('launch-file','--follow-active'));
await writeFile(join(output,'Start-Fixed.cmd'),launch('launch-file'));
await writeFile(join(output,'Follow-New.cmd'),launch('launch-file','--follow-new'));
await writeFile(join(output,'Start-HTTP.cmd'),launch('launch'));
await writeFile(join(output,'RELEASE.json'),JSON.stringify({version:VERSION,installerRevision:2,platform:process.platform,arch:process.arch,runtime:process.version,readOnly:true,buildTime:new Date().toISOString()},null,2)+'\n');
await writeFile(join(output,'runtime.sha256'),runtimeHash+'  plugins/context-lens/runtime/node.exe\n');
process.stdout.write(`Built ${relative(root,output)}\nRuntime: ${(await stat(process.execPath)).size} bytes\n`);
