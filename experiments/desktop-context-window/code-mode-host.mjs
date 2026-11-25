import {createHash, randomUUID} from 'node:crypto';
import {constants, createReadStream} from 'node:fs';
import {copyFile, link, lstat, rm} from 'node:fs/promises';
import {join} from 'node:path';

const fileName='codex-code-mode-host.exe';
// The two signed Store files have identical payloads outside the PE checksum
// and certificate data. Only these exact complete files are accepted.
const hostHashes=['fbab23b15832cf705c53fcff36f7323afb78efeb1eac3d081336f71ebe1e92a9',
  '753d65baafa0cafa62eb7f0a43f934421fc2eb67cc100c6ff0d8f9749a1ac5f6'];

async function verify(path, expected){
  if(!(await lstat(path)).isFile())throw Error('实验后台的工具宿主必须是普通文件。');
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  if(!expected.has(hash.digest('hex')))throw Error('工具宿主文件与已验证的 Codex 版本不匹配。');
}

export async function ensureCodeModeHost(resources, destination, {checkOnly=false, expected=hostHashes}={}){
  const allowed=new Set(Array.isArray(expected)?expected:[expected]);
  const target=join(destination,fileName);
  try{await verify(target,allowed);return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(checkOnly)throw Error('实验后台缺少 '+fileName+'，请正常打开实验扩容入口以补齐。');
  // Stage only the matching file shipped with the user's installed Store package.
  // Publish the verified bytes without replacing a concurrent launcher's file.
  const temporary=join(destination,randomUUID()+'.tmp');
  try{
    await copyFile(join(resources,fileName),temporary,constants.COPYFILE_EXCL);
    await verify(temporary,allowed);
    try{await link(temporary,target);}
    catch(error){if(error.code!=='EEXIST')throw error;}
    await verify(target,allowed);
  }finally{await rm(temporary,{force:true});}
}

export async function inspectCodeModeHost(resources,destination){
  const allowed=new Set(hostHashes);
  try{await verify(join(destination,fileName),allowed);return 'installed';}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await verify(join(resources,fileName),allowed);
  return 'available-in-store';
}
