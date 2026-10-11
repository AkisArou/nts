// run: check
interface NullReader {read(x:string|null):string}
interface MissingReader {read(x:string|undefined):string}
interface Wide {read(x:string|null|undefined):string}
function pair(a:NullReader,b:MissingReader,n:number):string{return a.read(n>0?null:"a")+b.read(n>0?undefined:"b")}
export function result(n:number):string{const base="base";const a:Wide={read(x:string|null|undefined):string{return x===null?base+"null":x===undefined?base+"undefined":base+x}};return pair(a,a,n)}
