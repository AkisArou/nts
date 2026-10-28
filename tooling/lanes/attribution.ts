// Pure recovery attribution. The controller owns execution, persistence and
// notifications; this component never moves a ref or performs a revert.
export type LandingPrefix={id:string;base:string;tip:string};
export type InitialRed={kind:"verdict";revision:string;steps:string[];host:string;canonical:boolean;run:string;failed:string[]};
export type Hold={kind:"hold";category:"instrument"|"timeout"|"oom"|"setup"|"unknown"|"contradiction";reason:string;run?:string};
export type Request={revision:string;steps:readonly string[];host:string;invocation:string;cache:"off"};
type Evidence={revision:string;steps:string[];host:string;canonical:boolean;run:string;invocation:string;fresh:boolean};
export type Outcome=Hold|(Evidence&({kind:"green"}|{kind:"verdict";failed:string[]}));
export type Attempt={phase:string;request:Request;outcome:Outcome};
export type Batch={id:string;base:string;tip:string;steps:string[];landings:LandingPrefix[];red:InitialRed};
export type Attribution={kind:"held";category:Hold["category"];reason:string;attempts:Attempt[]}|{
 kind:"culprit";landing:LandingPrefix;steps:string[];host:string;
 proof:{baseline:Outcome;reds:[Outcome,Outcome];parent:Outcome};attempts:Attempt[];
};
const same=(a:readonly string[],b:readonly string[])=>a.length===new Set(a).size&&b.length===new Set(b).size&&a.length===b.length&&a.every(s=>b.includes(s));
const sha=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{40}$/.test(value);
function validOutcome(value:Outcome,request:Request):string|null {
 if(!value||!["green","verdict","hold"].includes(value.kind))return "untyped gate outcome";
 if(value.kind==="hold")return ["instrument","timeout","oom","setup","unknown","contradiction"].includes(value.category)&&typeof value.reason==="string"&&value.reason?null:"invalid hold outcome";
 if(value.revision!==request.revision||!Array.isArray(value.steps)||!same(value.steps,request.steps))return "gate evidence does not cover the exact requested prefix and steps";
 if(value.host!==request.host||value.canonical!==true)return "gate evidence changed host identity or is non-canonical";
 if(value.invocation!==request.invocation||value.fresh!==true||typeof value.run!=="string"||!value.run)return "gate evidence is not a fresh answer to this invocation";
 if(value.kind==="verdict"&&(!Array.isArray(value.failed)||!value.failed.length||value.failed.some(s=>!request.steps.includes(s))))return "verdict lacks measured failures in the selected steps";
 return null;
}
export async function attribute(batch:Batch,gate:(request:Request)=>Outcome|Promise<Outcome>):Promise<Attribution> {
 const attempts:Attempt[]=[];
 const held=(reason:string,category:Hold["category"]="contradiction"):Attribution=>({kind:"held",reason,category,attempts});
 if(!batch||!batch.id||!sha(batch.base)||!sha(batch.tip)||!Array.isArray(batch.steps)||!batch.steps.length||batch.steps.some(s=>typeof s!=="string"||!/^[a-z0-9-]+$/.test(s))||!Array.isArray(batch.landings)||!batch.landings.length)return held("invalid frozen batch");
 let previous=batch.base;const seen=new Set([batch.base]),ids=new Set<string>();
 for(const landing of batch.landings){if(!landing||!landing.id||ids.has(landing.id)||landing.base!==previous||!sha(landing.tip)||seen.has(landing.tip))return held("landing prefixes are not a continuous frozen range");previous=landing.tip;seen.add(landing.tip);ids.add(landing.id);}
 if(previous!==batch.tip||!batch.red||batch.red.kind!=="verdict"||!Array.isArray(batch.red.steps)||!same(batch.red.steps,batch.steps)||batch.red.revision!==batch.tip||batch.red.canonical!==true||typeof batch.red.host!=="string"||!batch.red.host||typeof batch.red.run!=="string"||!batch.red.run||!Array.isArray(batch.red.failed)||!batch.red.failed.length||batch.red.failed.some(s=>!batch.steps.includes(s)))return held("initial red is not an exact canonical measured batch verdict","unknown");
 const steps=[...new Set(batch.red.failed)].sort(),host=batch.red.host;
 async function run(phase:string,revision:string):Promise<Outcome> {
  const request:Request=Object.freeze({revision,steps:Object.freeze([...steps]),host,invocation:`${batch.id}:${attempts.length}:${phase}`,cache:"off"});
  let outcome:Outcome;
  try {
   outcome=structuredClone(await gate(request));
   const invalid=validOutcome(outcome,request);if(invalid)outcome={kind:"hold",category:"unknown",reason:invalid};
  }catch(error){outcome={kind:"hold",category:"instrument",reason:`gate execution failed: ${String(error)}`};}
  attempts.push({phase,request,outcome});return outcome;
 }
 const baseline=await run("baseline",batch.base);
 if(baseline.kind!=="green")return held(baseline.kind==="hold"?baseline.reason:"red on the verified baseline",baseline.kind==="hold"?baseline.category:"contradiction");
 const tip=await run("tip",batch.tip);
 if(tip.kind!=="verdict")return held(tip.kind==="hold"?tip.reason:"the frozen red tip no longer reproduces",tip.kind==="hold"?tip.category:"contradiction");
 if(!same(tip.failed,steps))return held("the frozen tip's failures changed since the original verdict");
 let low=0,high=batch.landings.length;
 while(high-low>1){
  const mid=Math.floor((low+high)/2),sample=await run("search",batch.landings[mid-1].tip);
  if(sample.kind==="hold")return held(sample.reason,sample.category);
  if(sample.kind==="green")low=mid;else high=mid;
 }
 const landing=batch.landings[high-1];
 const first=await run("reproduce-1",landing.tip);
 if(first.kind!=="verdict")return held(first.kind==="hold"?first.reason:"the narrowed prefix did not reproduce",first.kind==="hold"?first.category:"contradiction");
 const second=await run("reproduce-2",landing.tip);
 if(second.kind!=="verdict")return held(second.kind==="hold"?second.reason:"the narrowed prefix did not reproduce twice",second.kind==="hold"?second.category:"contradiction");
 if(first.run===second.run||!same(first.failed,second.failed))return held("the two fresh prefix failures disagree or reuse one run");
 const parent=await run("parent",landing.base);
 if(parent.kind!=="green")return held(parent.kind==="hold"?parent.reason:"the immediate parent is no longer green",parent.kind==="hold"?parent.category:"contradiction");
 return {kind:"culprit",landing,steps,host,proof:{baseline,reds:[first,second],parent},attempts};
}
