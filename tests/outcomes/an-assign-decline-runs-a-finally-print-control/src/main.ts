// A native decline must stop before JavaScript finally prints.
// Subject/control differ only in b's source payload kind.
export function probe(n:number):number { const t={a:0,b:0}; const s:Record<string,unknown>={b:0,a:n}; try { Object.assign(t,s); } finally { console.log("finally"); } return t.a; }
console.log("before");
console.log(probe(7));
console.log("after");
