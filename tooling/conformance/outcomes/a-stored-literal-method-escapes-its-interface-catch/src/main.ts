// run: check
interface Reader {read(x:number):number}
interface Wide {read(x:number|string):number}
function call(r:Reader,n:number):number {try{return r.read(n)}catch{return 17}}
export function result(n:number):number {const a:Wide={read:(x:number|string):number=>{if(typeof x==="number"&&x<0)throw new Error("bad");return n+5}};return call(a,n)}
