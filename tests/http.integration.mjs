import test from 'node:test';
import assert from 'node:assert/strict';
import { startHttp } from '../src/server/http.mjs';
import { createService } from '../src/server/service.mjs';
test('loopback transport serves authenticated snapshots',async()=>{
  const app=await startHttp({service:createService({capabilities:()=>({}),listThreads:async()=>[]})});
  try{
    assert.equal((await fetch(app.origin+'/api/threads')).status,401);
    const r=await fetch(app.origin+'/api/threads',{headers:{Authorization:'Bearer '+app.token}});assert.equal(r.status,200);assert.deepEqual((await r.json()).threads,[]);
  }finally{await app.close();}
});
