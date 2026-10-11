// expect: a literal converted to a method interface without a complete dispatch table
interface Reader {read(x:number):number}
interface Wide {read(x:number|string):number}
function call(r:Reader,n:number):number{return r.read(n)}
export function result(n:number):number {const a:Wide={read:(x:3):number=>x};return call(a,n)}
