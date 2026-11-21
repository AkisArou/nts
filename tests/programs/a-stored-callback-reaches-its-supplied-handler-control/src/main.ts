let observed=0;
interface Scheduler { reportError(error:unknown):void; }
class Scheduler { reportError(_error:unknown):void { observed=91; } }
const scheduler=new Scheduler();
function reportError(error:unknown):void { scheduler.reportError(error); }
function direct(n:number):void { observed=n+1; }
class Holder {
 constructor(readonly subscribers:((n:number)=>void)[]){}
 publish(n:number):void {
  for(let i=0;i<this.subscribers.length;i++){
   const callback=this.subscribers[i];
   if(callback===undefined)continue;
   try { callback(n); } catch(error) { reportError(error); }
  }
 }
}
const holder=new Holder([(n:number):void=>{observed=n+1;}]);
export function probe(n:number):number { observed=0; holder.publish(n); return observed; }
