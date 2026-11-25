import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function sidebarBundle({ fixture = false } = {}) {
  const files = ['telemetry', '../../src/control/levels', '../../src/control/target-preference', 'preferences', 'layout', 'target', 'view', 'entry'];
  const {version}=JSON.parse(await readFile(new URL('../native-sidebar/manifest.json',import.meta.url),'utf8'));
  let bundle = `const sidebarManifest = ${JSON.stringify({version})};\n`;
  for (const file of files) {
    const code = await readFile(new URL(`../native-sidebar/src/${file}.mjs`, import.meta.url), 'utf8');
    bundle += `\n// ${file}.mjs\n` + code.replace(/^import .*?;\r?\n/gm, '').replace(/^export /gm, '');
  }
  // Fixture entry is never part of the distributable. Production exposes only Loader lifecycle.
  return `(function(){'use strict';\n${bundle}\n${fixture ? 'globalThis.createSidebarFixture = createSidebar; globalThis.NativeSourceFixture = NativeSource;' : 'module.exports = { start, stop, invokeHostCommand };'}\n})();\n`;
}
export async function buildSidebar() {
  const manifest = JSON.parse(await readFile(new URL('../native-sidebar/manifest.json', import.meta.url), 'utf8'));
  const operations=manifest.hostCommands?.operations;
  if(!Array.isArray(operations) || operations.length<1 || operations.length>16 ||
     new Set(operations).size!==operations.length ||
     operations.some(name=>typeof name!=='string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name))){
    throw Error('The sidebar declares host commands incompatible with Loader 0.6.1.');
  }
  const out = resolve('dist', `context-lens-sidebar-${manifest.version}`);
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'index.js'), await sidebarBundle());
  for (const name of ['manifest.json', 'README.md', 'NOTICE.md']) await copyFile(resolve('native-sidebar', name), resolve(out, name));
  await copyFile(resolve('LICENSE'), resolve(out, 'LICENSE'));
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await buildSidebar());
