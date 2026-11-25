import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, readdir, lstat} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {activeLoaderDirectory} from '../../../scripts/sidebar-loader-client.mjs';

const version = '0.6.2';
export const cliVersion='0.171.0-alpha.13';
export const expectedCliHash='7607040dd04a0bf2ed92874e4c12e02de7cc16f593d5ed6cb2ca18651734b10d';
const dist=fileURLToPath(new URL('../../../dist/',import.meta.url));
const releases=new Map([
  ['26.1117.3838.0',{directory:'experimental-loader-0.6.2',hash:'d520d91d43fc9b9d4cf63c8f74caa6af0bddb087e68a1459ccb8da8c4378ada6'}],
  ['26.1117.4957.0',{directory:'experimental-loader-0.6.2-26.1117.4957.0',hash:'34df152f7958568267baab63bd74ee33dc3f6cff64a8e12356474a1f7effe95d'}],
]);
export function desktopSetupReleases(){
  return [...releases].map(([desktop,build])=>({desktop,...build}));
}
export function experimentalLoaderFor(appVersion){
  const release=releases.get(appVersion);
  return release ? join(dist,release.directory,'CodexScriptLoader.exe') : null;
}
const manifestFile = 'context-lens-build.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function verifyExperimentalCli(binary){
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(binary))digest.update(chunk);
  if(digest.digest('hex')!==expectedCliHash)throw Error('实验后台完整性校验失败。');
}

export async function verifyExperimentalLoader(localData, appVersion, installed) {
  installed??=await activeLoaderDirectory(localData);
  const release=releases.get(appVersion);
  if (!release || basename(dirname(installed)) !== version) {
    const error=Error('当前 Codex 或 Loader 版本尚未验证实验扩容。');
    error.code='UNVERIFIED_VERSION';
    throw error;
  }
  const directory=join(dist,release.directory);
  await verifyLoaderBuild(directory,release.hash);
  return experimentalLoaderFor(appVersion);
}

export async function verifyLoaderBuild(directory,expectedHash){
  const data = await readFile(join(directory, manifestFile));
  if (sha256(data) !== expectedHash) throw Error('实验 Loader 的构建清单校验失败。');
  const expected = new Map(JSON.parse(data).files.map(file => [file.path, file.sha256]));
  async function visit(prefix) {
    const folder = join(directory, prefix);
    if (!(await lstat(folder)).isDirectory()) throw Error('实验 Loader 目录无效。');
    for (const entry of await readdir(folder, {withFileTypes:true})) {
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) { await visit(name); continue; }
      if (!entry.isFile()) throw Error('实验 Loader 包含未知类型的文件。');
      if (name === manifestFile) continue;
      if (!expected.has(name) || sha256(await readFile(join(directory, name))) !== expected.get(name))
        throw Error('实验 Loader 文件校验失败：' + name);
      expected.delete(name);
    }
  }
  await visit('');
  if (expected.size) throw Error('实验 Loader 缺少运行文件。');
}
