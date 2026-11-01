// Candidate-only #147 finding: finally must not turn a native representation decline into a partial successful assign.
// Subject/control differ only in source key insertion order (b,a versus a,b).
export function probe(n:number):number { const t={a:0,b:0}; const s:Record<string,unknown>={b:"wrong",a:n}; try { Object.assign(t,s); } finally { return t.a; } }
