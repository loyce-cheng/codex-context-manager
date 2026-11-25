import {open} from 'node:fs/promises';

// Follow only bytes appended to this rollout after the user submitted a tier.
// A capacity belongs to a turn only when its native start and model context agree.
export async function openTurnReceipt(source, record){
  const path=await source.rolloutPath(record.threadId);
  const file=await open(path,'r');
  let offset,identity,skip=false;
  try{
    const stat=await file.stat({bigint:true});
    if(stat.size>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Rollout size out of range.');
    identity=stat.ino;
    offset=Number(stat.size);
    const head=Buffer.alloc(Math.min(offset,1024*1024));
    const {bytesRead}=await file.read(head,0,head.length,0);
    const end=head.subarray(0,bytesRead).indexOf(10);
    if(end<0)throw Error('Missing session metadata.');
    const meta=JSON.parse(head.toString('utf8',0,end));
    if(meta.type!=='session_meta'||typeof meta.payload?.id!=='string'||
      meta.payload.id.toLowerCase()!==record.threadId.toLowerCase())throw Error('Session identity mismatch.');
    const last=Buffer.alloc(1);await file.read(last,0,1,offset-1);
    skip=last[0]!==10;
  }finally{await file.close();}
  let carry=Buffer.alloc(0), start=null, observed=null, invalid=false;
  return async function readNext(submittedAt){
    if(observed||invalid)return observed;
    const handle=await open(path,'r');
    try{
      const stat=await handle.stat({bigint:true});
      if(stat.ino!==identity || stat.size<BigInt(offset) || stat.size>BigInt(Number.MAX_SAFE_INTEGER)){invalid=true;return null;}
      const length=Math.min(512*1024,Number(stat.size)-offset);
      if(!length)return null;
      const chunk=Buffer.alloc(length);
      const {bytesRead}=await handle.read(chunk,0,length,offset);
      offset+=bytesRead;
      const data=Buffer.concat([carry,chunk.subarray(0,bytesRead)]);
      let pos=0,end;
      while((end=data.indexOf(10,pos))>=0){
        const line=data.subarray(pos,end);pos=end+1;
        if(skip){skip=false;continue;}
        if(!line.includes('"task_started"') && !line.includes('"turn_context"'))continue;
        let row;try{row=JSON.parse(line);}catch{continue;}
        const p=row?.payload;
        if(row?.type==='event_msg' && p?.type==='task_started'){
          start=null;
          if(Date.parse(row.timestamp)>submittedAt && typeof p.turn_id==='string' && p.turn_id.length<=64 &&
            p.turn_id.length>0 && Number.isSafeInteger(p.model_context_window) && p.model_context_window>0)
            start={turn:p.turn_id,capacity:p.model_context_window};
        }else if(start && row?.type==='turn_context' && p?.turn_id===start.turn){
          if(p.model===record.expectedModel){observed=start.capacity;return observed;}
          start=null;
        }
      }
      if(data.length-pos>1024*1024)skip=true;
      carry=skip?Buffer.alloc(0):Buffer.from(data.subarray(pos));
      return null;
    }finally{await handle.close();}
  };
}
