import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {supportedInstalledSidebar} from '../scripts/update-sidebar.mjs';
import {peContentHash} from '../scripts/pe-content-hash.mjs';
import {profileForUpgrade} from '../scripts/verify-native-profile.mjs';
import {RSPACK_4957_PROFILE,profilesForBuild} from '../native-sidebar/src/telemetry.mjs';

test('4957 is available in an uncustomized ZIP and needs no resource discovery',async()=>{
  const version='26.1117.4957.0';
  assert.equal(profilesForBuild(null).filter(p=>p.appVersion===version)[0],RSPACK_4957_PROFILE);
  const check=await profileForUpgrade(version,{version,family:'OpenAI.Codex_2p2nqsd0c76g0',location:'D:\\test'});
  assert.equal(check.mode,'bundled');
});
test('stable releases can repair or upgrade without accepting downgrades or unpublished prereleases',()=>{
  const supports=(version,release)=>supportedInstalledSidebar({id:'local.context-lens.sidebar',version},release);
  for(const installed of ['0.1.0','0.1.0-beta.4','0.1.0-alpha.13'])assert.equal(supports(installed,'0.1.0'),true);
  assert.equal(supports('0.1.0','0.2.0'),true);
  for(const installed of ['0.0.1','0.1.1','0.1.0-alpha.14','0.1.0-rc.1','00.1.0'])assert.equal(supports(installed,'0.1.0'),false);
  assert.equal(supports('0.1.0','0.1.0-beta.5'),false);
});
test('PE comparison requires real DOS, optional header and certificate directory boundaries',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lens-pe-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'fixture.exe'),pe=64,opt=pe+24,security=opt+144;
  const data=Buffer.alloc(520);
  data.write('MZ');data.writeUInt32LE(pe,60);data.writeUInt32LE(0x4550,pe);
  data.writeUInt16LE(0x8664,pe+4);data.writeUInt16LE(240,pe+20);data.writeUInt16LE(0x20b,opt);
  data.writeUInt32LE(16,opt+108);data.writeUInt32LE(512,security);data.writeUInt32LE(8,security+4);
  await writeFile(file,data);const hash=await peContentHash(file);
  data[519]=1;await writeFile(file,data);assert.equal(await peContentHash(file),hash);
  for(const [offset,value] of [[60,1],[pe+20,100],[opt+108,4]]){
    const copy=Buffer.from(data);copy.writeUInt32LE(value,offset);
    await writeFile(file,copy);await assert.rejects(peContentHash(file));
  }
  await writeFile(file,data.subarray(0,63));await assert.rejects(peContentHash(file),/Truncated/);
});
