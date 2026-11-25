import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {ensureCodeModeHost} from '../experiments/desktop-context-window/code-mode-host.mjs';

test('a missing code-mode host is detected in checks and restored from verified package bytes on launch',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lens-host-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const src=join(root,'package'),out=join(root,'backend'),name='codex-code-mode-host.exe';
  await mkdir(src);await mkdir(out);
  const bytes=Buffer.from('matching test package');
  const expected=createHash('sha256').update(bytes).digest('hex');
  const check=()=>ensureCodeModeHost(src,out,{expected,checkOnly:true});
  const start=()=>ensureCodeModeHost(src,out,{expected});
  await writeFile(join(src,name),'unexpected bytes');
  await assert.rejects(check(),/缺少/);
  await assert.rejects(start(),/不匹配/);
  assert.deepEqual(await readdir(out),[]);
  await writeFile(join(src,name),bytes);
  await Promise.all([start(),start()]);
  await check();
  assert.deepEqual(await readdir(out),[name]);
  await writeFile(join(out,name),'unexpected installed bytes');
  await assert.rejects(start(),/不匹配/);
  assert.equal(await readFile(join(out,name),'utf8'),'unexpected installed bytes');
});
