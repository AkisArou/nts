// A bound signature retains the target's optional/nullable absence contract.
// Controls supply a non-absent value through the same bound function.
// Main 547: C/LLVM/JVM 174/174 agree; Wasm 116/174 agree, 58 declines.
// Checkpoint 932: C/LLVM/JVM abort after 17 new admission stops (32/174
// compared); Wasm retains its 116/174 and 58 existing declines.
export function invoke(callback: (x?: any) => number, value: any, supplied: boolean): number { return supplied ? callback(value) : callback(); }
function text(x?: string): number { return x === undefined ? 7 : x.length; }
function number(x?: number): number { return x === undefined ? 7 : x; }
function nullable(x: string | null): number { return x === null ? 7 : x.length; }
export function textMissing(n: number): number { return invoke(text.bind(undefined), undefined, false); }
export function textSupplied(n: number): number { return invoke(text.bind(undefined), "abc", true); }
export function numberMissing(n: number): number { return invoke(number.bind(undefined), undefined, false); }
export function numberSupplied(n: number): number { return invoke(number.bind(undefined), n, true); }
export function textNull(n: number): number { return invoke(nullable.bind(undefined), null, true); }
export function textPresent(n: number): number { return invoke(nullable.bind(undefined), "abc", true); }
