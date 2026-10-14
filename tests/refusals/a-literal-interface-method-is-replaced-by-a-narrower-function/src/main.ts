// expect: a literal converted to a method interface without a complete dispatch table
interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
function use(s:Sink,n:number):number{return s.take(n);}
export function result(n:number):number {const base=n;const w:Wide={take(x:number|string):number{return base;}};w.take=(x:3):number=>x;return use(w,n);}
