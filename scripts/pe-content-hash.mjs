import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// For compatibility comparisons of signed x64 PE images only. Runtime
// verification continues to use hashes of complete files, including signatures.
export async function peContentHash(path){
  const file=await open(path,'r');
  try{
    const {size}=await file.stat();
    const header=Buffer.alloc(4096);
    const {bytesRead}=await file.read(header,0,header.length,0);
    if(bytesRead<64)throw Error('Truncated DOS header.');
    const pe=header.readUInt32LE(60),opt=pe+24,checksum=opt+64,security=opt+112+32;
    if(header.toString('ascii',0,2)!=='MZ' || pe<64 || security+8>bytesRead || header.readUInt32LE(pe)!==0x4550 ||
      header.readUInt16LE(pe+20)<security+8-opt || header.readUInt32LE(opt+108)<5 ||
      header.readUInt16LE(pe+4)!==0x8664 || header.readUInt16LE(opt)!==0x20b)throw Error('Expected a signed x64 PE image.');
    const cert=header.readUInt32LE(security),length=header.readUInt32LE(security+4);
    if(cert<security+8 || length<8 || cert+length>size)throw Error('Invalid PE certificate table.');
    const digest=createHash('sha256');
    for(const [start,end] of [[0,checksum],[checksum+4,security],[security+8,cert],[cert+length,size]]){
      if(end>start)for await(const chunk of file.createReadStream({start,end:end-1,autoClose:false}))digest.update(chunk);
    }
    return digest.digest('hex');
  }finally{await file.close();}
}
