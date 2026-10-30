// expect: a parameter of unrepresentable type (the type parameter `E`)
// AWFY CD/Havlak companion. The generic parameter belongs to free take instead of Method#take, with the same body.
class Method { take<E>(value: E): void {} }
function take<E>(value: E): void {}
export function work(n: number): number { new Method().take<number>(n); return n; }
