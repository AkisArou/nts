// run: check
// Valid native-payload control: only b's source value changes from a string to a number.
export function probe(n:number):number { const t={a:0,b:0}; const s:Record<string,unknown>={b:0,a:n}; try { Object.assign(t,s); } finally { return t.a; } }
