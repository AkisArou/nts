// run: check

// A direct read isolates field presence from callback exception transport.
// The cast claims Error.code exists, but the Error has no such own field.
// The control changes only code:string to code?:string. Node returns 91 on
// the selected inputs; all earlier inputs keep the ordinary arithmetic arm.

interface SystemError extends Error { code:string; }
export function probe(n:number):number {
 if(!(n>5))return n+1;
 const wider=new Error(String(n)) as SystemError;
 return wider.code===undefined?91:wider.code.length;
}
