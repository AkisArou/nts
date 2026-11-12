// The memory owner of one tokened case. Forecasts decide admission; the
// independent hard cap decides whether the case exhausted its budget.
import {isAbsolute,relative,resolve} from 'node:path';
import {caseMemoryKey,caseReservation,peakReservation,type CaseIdentity,type CaseHistory,type CaseObservation} from './step-scheduling.ts';
import {CgroupDeparted} from './host-observations.ts';

export type CaseMemoryMeter={charge():number;peak():number;close():void};
export type CaseMemoryEffects={
  history(step:string):CaseHistory;
  completed(step:string,observation:CaseObservation):void;
  open(group:string):CaseMemoryMeter;
};

/** Content and compiler identities are deliberately absent: a new compiler
 * still needs the memory the same case held on the preceding compiler. */
export function caseIdentity(step:string,context:Record<string,unknown>,root:string):CaseIdentity {
  if(context.scope==='step'){
    if(context.project!==undefined)throw Error('case memory: a step lease cannot also name a case');
    return {step,backend:'',path:'@step'};
  }
  const path=context.project;
  if(typeof path!=='string'||!path.trim())throw Error(`case memory: ${step} has no case path`);
  const local=relative(root,resolve(root,path));
  if(local==='..'||local.startsWith('../')||isAbsolute(local))throw Error(`case memory: ${step} case is outside its source tree: ${path}`);
  const backend=context.backend;
  if(backend!==undefined&&typeof backend!=='string')throw Error(`case memory: ${step} has an invalid backend`);
  return {step,backend:backend??'',path:local.replaceAll('\\','/').replace(/\/$/,'')};
}

const positive=(bytes:number,what:string)=>{
  if(!Number.isSafeInteger(bytes)||bytes<1)throw Error(`case memory: ${what} is not a positive byte count`);
  return bytes;
};
const contains=(parent:string,child:string)=>child===parent||child.startsWith(parent+'/');

/** Kept until the token is returned, including the case's final observation.
 * A scope may span several cases; its meter resets on this lease's open. */
export class CaseMemoryLease {
  readonly identity:CaseIdentity;
  readonly key:string;
  readonly forecast:number|undefined;
  #effects:CaseMemoryEffects;
  #scopes=new Map<string,{cap:number;meter:CaseMemoryMeter}>();
  #charge=0;
  #peak=0;
  #closed=false;
  constructor(identity:CaseIdentity,effects:CaseMemoryEffects){
    this.identity=identity;this.key=caseMemoryKey(identity);this.#effects=effects;
    this.forecast=caseReservation(effects.history(identity.step),this.key);
  }
  /** Known cases keep their forecast; growth beyond it and unknown cases
   * use exactly the ledger's live-use-plus-margin arithmetic. */
  get bytes(){return Math.max(this.forecast??0,peakReservation([Math.max(1,this.#charge)]));}
  get measured(){return this.forecast!==undefined;}
  get closed(){return this.#closed;}
  get charge(){return this.#charge;}
  get peak(){return this.#peak;}
  get groups(){return this.#roots().map(([group])=>group);}
  /** Concurrent roots add caps; a nested scope is already inside its root. */
  get capBytes(){return this.#roots().reduce((sum,[,scope])=>sum+scope.cap,0);}
  #roots(){return [...this.#scopes].filter(([group])=>![...this.#scopes.keys()].some(other=>other!==group&&contains(other,group)));}
  attach(group:string,cap:number):void{
    if(this.#closed)throw Error('case memory: attaching to a released lease');
    if(!group.startsWith('/')||group==='/'||group.split('/').includes('..'))throw Error('case memory: invalid worker cgroup '+group);
    positive(cap,'case cap');
    const previous=this.#scopes.get(group);
    if(previous){if(previous.cap!==cap)throw Error('case memory: an attached scope changed its case cap');return;}
    for(const [parent,scope] of this.#scopes){
      if((contains(parent,group)&&scope.cap<cap)||(contains(group,parent)&&cap<scope.cap))throw Error('case memory: a nested case cap exceeds its enclosing case');
    }
    this.#scopes.set(group,{cap,meter:this.#effects.open(group)});
    this.sample();
  }
  sample():void{
    if(this.#closed)return;
    let charge=0;
    for(const [group,scope] of this.#roots()){
      try{
        const current=scope.meter.charge();
        if(!Number.isSafeInteger(current)||current<0)throw Error('case memory: worker observation is invalid');
        this.#observePeak(current);this.#observePeak(scope.meter.peak());charge+=current;
      }catch(error){
        if(!(error instanceof CgroupDeparted)||error.group!==group)throw error;
        // The retained peak descriptor may still report the final peak after
        // pathname removal. If the kernel has retired it too, keep the peak
        // already observed, never fabricate a zero or suppress another error.
        try{this.#observePeak(scope.meter.peak());}
        catch(peakError){if(!(peakError instanceof CgroupDeparted)||peakError.group!==group)throw peakError;}
        this.#discard(group);
      }
    }
    this.#charge=charge;this.#peak=Math.max(this.#peak,charge);
  }
  retire(group:string):void{
    if(!this.#scopes.has(group))return;
    this.sample();this.#discard(group);
  }
  #observePeak(peak:number):void{
    if(!Number.isSafeInteger(peak)||peak<0)throw Error('case memory: worker observation is invalid');
    this.#peak=Math.max(this.#peak,peak);
  }
  #discard(group:string):void{
    for(const [path,scope] of this.#scopes)if(contains(group,path)){scope.meter.close();this.#scopes.delete(path);}
  }
  close(record=true):void{
    if(this.#closed)return;
    try{
      this.sample();
      if(record&&this.#peak>0)this.#effects.completed(this.identity.step,{key:this.key,peak:this.#peak});
    }finally{
      this.#closed=true;
      for(const scope of this.#scopes.values())scope.meter.close();
    }
  }
}
