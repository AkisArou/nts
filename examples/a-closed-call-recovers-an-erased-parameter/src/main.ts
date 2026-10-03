// Copies are positional, keep the ordinary ABI, and require both a producer
// representation and closed parameter uses. The roots must survive lowering;
// comparing only the ordinary arithmetic control would miss this feature.

function fixed(value: any, digits: number): string {
  if (digits < 0) throw new RangeError("negative digits");
  return value.toFixed(digits);
}

function forwards(value: any, digits: number): string {
  return fixed(value, digits);
}

function aliased(value: any): number {
  const first = value;
  const second = first;
  return second.toFixed(1).length;
}

function recurses(value: any, depth: number): number {
  if (depth > 0) return recurses(value, depth - 1);
  return value.toFixed(1).length;
}

function sliced(value: any): number {
  return value.slice(1, 3).length;
}

function mixed(first: any, second: any): number {
  return first.slice(0, 2).length;
}

function otherPosition(first: any, second: any): number {
  return second.toFixed(0).length;
}

function arithmetic(value: any): number {
  return value * value + value;
}

function numericString(value: any): number {
  return value * value + 1;
}

function equality(value: any): number {
  return value === value ? 1 : 0;
}

function compares(first: any, second: any): number {
  return first === second ? 1 : 0;
}

function unknownEquality(value: unknown): number {
  return value === value ? 3 : 7;
}

function guarded(value: any): number {
  if (typeof value === "number") return value.toFixed(1).length;
  return value === value ? 2 : 0;
}

let evaluations = 0;
function produces(value: number): number {
  evaluations++;
  return value + 0.25;
}

export function aNumber(n: number): number {
  return fixed(n, 1).length;
}

export function aString(n: number): number {
  return sliced("abcdef") + (n & 1);
}

export function forwarding(n: number): number {
  return forwards(n, 2).length;
}

export function constantAliases(n: number): number {
  return aliased(n);
}

export function recursion(n: number): number {
  return recurses(n, n & 3);
}

export function independentPositions(n: number): number {
  return mixed("abcdef", n) * 100 + otherPosition("ignored", n);
}

export function evaluatedOnce(n: number): number {
  evaluations = 0;
  const answer = fixed(produces(n), 2).length;
  return answer * 10 + evaluations;
}

export function aLiteralAlias(n: number): number {
  const text = "a😀bc";
  return sliced(text) + (n & 1);
}

export function anOrdinaryEntryStillWorks(n: number): number {
  let erased: any = n;
  return equality(erased);
}

export function numericOperators(n: number): number {
  return arithmetic(n);
}

export function aStringUsedNumerically(n: number): number {
  return numericString("2") + numericString(n);
}

export function aPartlyErasedComparison(n: number): number {
  let erased: any = n;
  return compares(n, erased);
}

export function differentPrimitives(n: number): number {
  return compares(n, "1");
}

export function narrowingKeepsItsOrdinaryEntry(n: number): number {
  return guarded(n) * 10 + guarded("text");
}

export function aCopyBelowTry(n: number): number {
  try {
    return forwards(n, -1).length;
  } catch {
    return -23;
  }
}

export function aBuiltinThrowBelowTry(n: number): number {
  try {
    return fixed(n, 101).length;
  } catch {
    return -31;
  }
}

export function anUnknownProducer(n: number): number {
  return unknownEquality(n) + unknownEquality("text");
}

function ordered(first: any, second: any): number {
  return first < second ? 1 : 0;
}

export function recoveredStringOrdering(n: number): number {
  return ordered("2", "10") * 100 + ordered("a", "b") * 10 + ordered("2", n);
}
