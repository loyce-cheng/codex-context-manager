// Capacity control contract. Production writing remains disabled until a native
// per-thread reload adapter is proven; an RPC success alone never changes the meter.
import {capacityLevels,modelCapacity,tierWindow} from './levels.mjs';
export {capacityLevels,modelCapacity};
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const NATIVE_CAPACITY_CAPABILITY=Object.freeze({mode:'unsupported',validated:false,
  reason:'Isolated per-thread reload works; native ownership, complete settings preservation and UI hydration remain unverified.'});
const integer=value=>Number.isSafeInteger(value)&&value>0;
export function capacityRequest(snapshot,model,requestedWindow) {
  const limits=modelCapacity(model);
  if(!snapshot||!UUID.test(snapshot.threadId??'')||snapshot.host!=='local'||snapshot.model!==limits.model)throw Error('THREAD_IDENTITY_UNVERIFIED');
  if(!capacityLevels(model).includes(requestedWindow))throw Error('CAPACITY_LEVEL_NOT_ALLOWED');
  if(!Number.isSafeInteger(snapshot.used)||snapshot.used<0||!integer(snapshot.capacity))throw Error('CONTEXT_READING_UNAVAILABLE');
  // Product policy: request compaction at 95% of the usable window, with total
  // active context accounting. This is not a claim about the model's default.
  const {usable:expectedUsableWindow,requestedCompactLimit,compactAt}=tierWindow(requestedWindow,limits.effectivePercent);
  if(snapshot.used>=compactAt)throw Error('REQUEST_WOULD_REQUIRE_IMMEDIATE_COMPACTION');
  return Object.freeze({threadId:snapshot.threadId,host:'local',model:limits.model,
    requestedWindow,expectedUsableWindow,previousUsableWindow:snapshot.capacity,
    config:Object.freeze({model_context_window:requestedWindow,model_auto_compact_token_limit:requestedCompactLimit,
      model_auto_compact_token_limit_scope:'total'})});
}
export class CapacityTransaction {
  constructor({snapshot,model,capability=NATIVE_CAPACITY_CAPABILITY,now=Date.now}) {
    this.snapshot=snapshot;this.model=model;this.capability=capability;this.now=now;
    this.state='idle';this.plan=null;this.generation=0;this.deadline=0;this.inFlight=false;this.abort=null;
  }
  select(snapshot,model=this.model){this.abort?.abort();this.generation++;this.snapshot=snapshot;this.model=model;this.plan=null;this.state='idle';}
  async apply(requestedWindow,backend) {
    if(this.capability.mode!=='reload-thread'||this.capability.validated!==true)throw Error('NATIVE_CAPACITY_WRITE_UNVERIFIED');
    if(this.inFlight||['applying','awaiting-observation','unconfirmed'].includes(this.state))throw Error('CAPACITY_CHANGE_IN_PROGRESS');
    if(!this.snapshot||this.snapshot.activeTurnId!==null||this.snapshot.otherSubscribers!==false)throw Error('THREAD_NOT_SAFE_TO_RELOAD');
    const plan=capacityRequest(this.snapshot,this.model,requestedWindow),generation=++this.generation;
    this.plan=plan;this.state='applying';this.inFlight=true;this.abort=new AbortController();
    try {
      await backend.reloadThread(plan,{isCurrent:()=>generation===this.generation,signal:this.abort.signal});
      if(generation!==this.generation)return {state:'superseded'};
      this.state='awaiting-observation';this.deadline=this.now()+30000;
      return {state:this.state};
    }catch(error){if(generation===this.generation){this.state=error.recovery==='required'?'recovery-required':'failed';this.plan=null;}throw error;}
    finally{this.inFlight=false;this.abort=null;}
  }
  observe(snapshot) {
    if(snapshot?.threadId!==this.snapshot?.threadId||snapshot?.host!==this.snapshot?.host||snapshot?.model!==this.snapshot?.model)return this.state;
    this.snapshot=snapshot;
    if(['awaiting-observation','unconfirmed'].includes(this.state)&&this.plan) {
      // A quiet chat can go minutes without a new native usage event. Keep the
      // request until observed or explicitly superseded by a selection change.
      if(snapshot.capacity===this.plan.expectedUsableWindow){this.state='applied';this.plan=null;}
      else if(this.now()>this.deadline)this.state='unconfirmed';
    }
    return this.state;
  }
  // Only observed runtime capacity is authoritative. Preview/apply never replaces it.
  get actualCapacity(){return this.snapshot?.capacity??null;}
}
