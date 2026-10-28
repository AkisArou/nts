// Machine conditions wait; only an observed program verdict can refuse code.
import {execFileSync} from "node:child_process";
export type HoldObservation<T>={value:T}|{hold:string};
export type HoldStatus={state:"held";resource:string;reason:string;since:string;age_s:number;pid:number};
export function admitted<T>(resource:string,observe:()=>HoldObservation<T>,publish:(status:HoldStatus)=>void,options:{now?:()=>number;pause?:()=>void;recovered?:(seconds:number)=>void}={}):T {
 const now=options.now??Date.now,pause=options.pause??(()=>{execFileSync("sleep",["5"]);});
 let since:number|null=null;
 for(;;){
  const observation=observe();
  if("value"in observation){if(since!==null)options.recovered?.(Math.floor((now()-since)/1000));return observation.value;}
  since??=now();
  publish({state:"held",resource,reason:observation.hold,since:new Date(since).toISOString(),age_s:Math.floor((now()-since)/1000),pid:process.pid});
  pause();
 }
}
