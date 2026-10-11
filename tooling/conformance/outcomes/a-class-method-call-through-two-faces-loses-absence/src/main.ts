// run: check
interface NullReader {read(x:string|null):string}
interface MissingReader {read(x:string|undefined):string}
class Wide {read(x:string|null|undefined):string{return x===null?"null":x===undefined?"undefined":x}}
function pair(a:NullReader,b:MissingReader,n:number):string{return a.read(n>0?null:"a")+b.read(n>0?undefined:"b")}
export function result(n:number):string{const a=new Wide();return pair(a,a,n)}
