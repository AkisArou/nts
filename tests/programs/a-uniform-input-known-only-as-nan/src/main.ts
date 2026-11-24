// A computed NaN enum member gives its uniform entry a NaN-only declared
// fact; the literal enum member is the control. typeof NaN and a NaN default
// instead have the full number type. These admitted calls pass on main too:
// the guard unit tests and out-of-contract scratch probes test the fix.
function invoke(f: (x: number) => number, x: number): number { return f(x); }
function byTypeof(x: typeof NaN): number { return x === x ? 1 : 2; }
function byDefault(x = NaN): number { return x === x ? 1 : 2; }
enum Computed { OnlyNaN = 0 / 0 }
function byEnum(x: Computed.OnlyNaN): number { return x === x ? 1 : 2; }
enum Literal { Value = 0 }
function byLiteral(x: Literal.Value): number { return x === x ? 1 : 2; }
enum Positive { Value = 1 / 0 }
function byPositive(x: Positive.Value): number { return x === Infinity ? 1 : 2; }
enum Negative { Value = -1 / 0 }
function byNegative(x: Negative.Value): number { return x === -Infinity ? 1 : 2; }
export function typeofNaN(): number { return invoke(byTypeof, NaN); }
export function typeofFinite(): number { return invoke(byTypeof, 0); }
export function defaultNaN(): number { return invoke(byDefault, NaN); }
export function defaultFinite(): number { return invoke(byDefault, 0); }
export function enumNaN(): number { return invoke(byEnum, NaN); }
export function literalFinite(): number { return invoke(byLiteral, 0); }
export function positiveInfinity(): number { return invoke(byPositive, Infinity); }
export function negativeInfinity(): number { return invoke(byNegative, -Infinity); }
