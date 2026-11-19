// run: check

// The required Error.code claim is false after the stored callback throws.
// A separate generic-method closure was refused until #843, and its refusal
// turned off the program's closure raising gate: main then lost the
// subscriber's handler, while 3(b)'s repair reached the false field claim.
// Since #843 that closure compiles (`Picker#pick<f64>`), the gate stays on,
// and the claim is still false on its own. The sibling control removes only
// the subscriber's throw, keeping the same claim body without entering it.

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
const holder=new Holder([(n:number):void=>{observed=n+1;}]);
export function probe(n:number):number { observed=0; holder.publish(n); return observed; }
