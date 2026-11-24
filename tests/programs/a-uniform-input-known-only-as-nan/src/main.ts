// Reachability probes: a NaN value does not necessarily give a parameter a
// NaN-only declared fact. Each pair changes only the value passed to the slot.
function invoke(f: (x: number) => number, x: number): number { return f(x); }
function byTypeof(x: typeof NaN): number { return x === x ? 1 : 2; }
function byDefault(x = NaN): number { return x === x ? 1 : 2; }
enum Computed { OnlyNaN = 0 / 0 }
function byEnum(x: Computed.OnlyNaN): number { return x === x ? 1 : 2; }
export function typeofNaN(): number { return invoke(byTypeof, NaN); }
export function typeofFinite(): number { return invoke(byTypeof, 0); }
export function defaultNaN(): number { return invoke(byDefault, NaN); }
export function defaultFinite(): number { return invoke(byDefault, 0); }
export function enumNaN(): number { return invoke(byEnum, NaN); }
export function enumFinite(): number { return invoke(byEnum, 0); }
