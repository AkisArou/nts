interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
function use(s:Sink,n:number):number{return s.take(n);}
function change(w:Wide,replacement:Wide['take']):void{w.take=replacement;}
export function result(n:number):number {const base=n;const w:Wide={take(x:number|string):number{return base;}};change(w,(x:number|string):number=>base+5);return use(w,n);}
