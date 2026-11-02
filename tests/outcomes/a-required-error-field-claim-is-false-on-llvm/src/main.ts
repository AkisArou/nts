// run: check
// backend: llvm

// The required Error.code claim is false after the stored callback throws.
// A separate generic-method closure is deliberately refused: main then loses
// the subscriber's handler, while 3(b)'s repair reaches the false field claim.
// The sibling control removes only the subscriber's throw, keeping that
// unrelated refusal and the same claim body without entering it.

class Picker { pick<T>(value:T):T { throw value; } }
const unrelated=(n:number)=>new Picker().pick(n);
let observed=0;
interface SystemError extends Error { code:string; }
function reportError(error:unknown):void { const wider=new Error(String(error)) as SystemError; observed=wider.code===undefined?91:wider.code.length; }
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
const holder=new Holder([(n:number):void=>{if(n>5)throw n;observed=n+1;}]);
export function probe(n:number):number { observed=0; holder.publish(n); return observed; }
