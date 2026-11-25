// Offline Responses fixture for disposable app-server conversations.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';

export async function startCompactionFixture() {
  const prefix='/'+randomUUID()+'/v1', samples=[];
  let pendingResponse=null;
  function holdNextResponse(){
    if(pendingResponse)throw Error('A fixture response is already reserved');
    let arrive,release;
    const arrived=new Promise(resolve=>{arrive=resolve;});
    const released=new Promise(resolve=>{release=resolve;});
    const hold={arrive,released};
    pendingResponse=hold;
    return {arrived,release(){if(pendingResponse===hold)pendingResponse=null;release();}};
  }
  const summaryText='Context Lens test summary: the prior synthetic history contains oak.';
  const server=createServer(async (req,res)=>{
    if(req.method!=='POST' || req.url!==prefix+'/responses'){res.writeHead(404).end();return;}
    try {
      const chunks=[];let size=0;
      for await(const chunk of req){
        size+=chunk.length;
        if(size>8_000_000){res.writeHead(413).end();return;}
        chunks.push(chunk);
      }
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!Array.isArray(body.input))throw Error('Missing fixture input');
      const input=JSON.stringify(body.input);
      const inputBytes=Buffer.byteLength(input);
      const inputTokens=Math.ceil(inputBytes/4);
      samples.push({inputBytes,inputTokens,containsPriorSummary:input.includes(summaryText)});
      if(pendingResponse){
        const hold=pendingResponse;pendingResponse=null;
        hold.arrive();await hold.released;
      }
      const id='resp_'+randomUUID(),item={id:'msg_'+randomUUID(),type:'message',role:'assistant',status:'completed',
        content:[{type:'output_text',text:summaryText,annotations:[]}]};
      const usage={input_tokens:inputTokens,output_tokens:18,total_tokens:inputTokens+18};
      res.writeHead(200,{'content-type':'text/event-stream'});
      const emit=(type,fields)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...fields})+'\n\n');
      emit('response.created',{response:{id,status:'in_progress',output:[]}});
      emit('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
      emit('response.output_item.done',{output_index:0,item});
      emit('response.completed',{response:{id,status:'completed',output:[item],usage}});
      res.end();
    }catch{res.writeHead(400).end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {url:'http://127.0.0.1:'+server.address().port+prefix,samples,holdNextResponse,close:()=>new Promise(done=>server.close(done))};
}
