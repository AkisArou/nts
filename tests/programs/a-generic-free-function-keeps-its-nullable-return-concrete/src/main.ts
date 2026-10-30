// Control for a-generic-method-keeps-its-nullable-return-unresolved.
// AWFY CD/Havlak companion. The generic return comes from free get instead of Method#get, with the same body.
function get<E>(value: E): E | null { return value; }
export function work(n: number): number { return get<number>(n) ?? 0; }
