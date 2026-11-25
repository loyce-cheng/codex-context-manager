// Read static application assets only. No execution, UI automation, or user state.
import { open, mkdir, writeFile } from 'node:fs/promises';
const appVersion='26.1103.4239.0';
const path=`C:/Program Files/WindowsApps/OpenAI.Codex_${appVersion}_x64__2p2nqsd0c76g0/app/resources/app.asar`;
const file=await open(path,'r'),found=[];
const terms=['thread/unsubscribe','thread/resume','thread/settings/update','model_context_window','model_auto_compact_token_limit'];
try{
 const bytes=Buffer.alloc(8);await file.read(bytes,0,8,0);
 const length=bytes.readUInt32LE(4),header=Buffer.alloc(length);await file.read(header,0,length,8);
 const tree=JSON.parse(header.subarray(8,8+header.readUInt32LE(4)).toString());
 async function visit(node,prefix=''){
  for(const[name,entry]of Object.entries(node.files??{})){
   const namePath=prefix+name;
   if(entry.files)await visit(entry,namePath+'/');
   else if(namePath.startsWith('webview/assets/')&&namePath.endsWith('.js')&&!entry.unpacked&&entry.size<18000000){
    const data=Buffer.alloc(entry.size);await file.read(data,0,data.length,8+length+Number(entry.offset));const text=data.toString('utf8');
    for(const term of terms){let index=-1,count=0;while((index=text.indexOf(term,index+1))>=0&&count++<8)found.push({asset:namePath,term,offset:index,excerpt:text.slice(Math.max(0,index-250),index+500)});}
   }
  }
 }
 await visit(tree);await mkdir('.research',{recursive:true});await writeFile('.research/capacity-assets.json',JSON.stringify({appVersion,found},null,2)+'\n');
 console.log(JSON.stringify({appVersion,matches:found.map(({asset,term,offset})=>({asset,term,offset}))},null,2));
}finally{await file.close();}
