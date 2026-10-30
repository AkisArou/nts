// Control for a-generic-method-keeps-its-parameter-unresolved.
// AWFY CD/Havlak companion. The generic parameter belongs to free take instead of Method#take, with the same body.
function take<E>(value: E): void {}
export function work(n: number): number { take<number>(n); return n; }
