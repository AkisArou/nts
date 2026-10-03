// Tagged calls share the ordinary argument convention and one immutable
// cooked array per source site, including copies of the containing function.
let trace = 0;
function mark(value: number): number { trace = trace * 10 + value; return value; }
function first(strings: TemplateStringsArray, value: number = mark(3)): number {
  return strings.length * 100 + value;
}
function optional(strings: TemplateStringsArray, value?: number): number {
  return value === undefined ? strings.length : value;
}
function rest(strings: TemplateStringsArray, ...values: number[]): number {
  let sum = strings.length * 100;
  for (const value of values) sum = sum * 10 + value;
  return sum;
}
function all(...values: (TemplateStringsArray | number)[]): number { return values.length; }
function defaults(strings: TemplateStringsArray, a: number = mark(3), b: number = a + strings.length): number {
  return a * 100 + b;
}
function ordinary(a: number = mark(3), b: number = mark(4)): number { return a * 10 + b; }
function withTail(strings: TemplateStringsArray, a: number = mark(3), ...values: number[]): number {
  return a * 10 + values.length;
}
function throwing(strings: TemplateStringsArray, n: number): number {
  if (n > 0) throw new RangeError("tag");
  return strings.length;
}
function generic<T>(strings: TemplateStringsArray, value: T): T { return value; }

export function excess(n: number): number {
  trace = 0;
  // @ts-expect-error JavaScript evaluates and discards the excess substitution.
  const value = first`a${mark(1)}b${mark(2)}c`;
  return value * 100 + trace + (n & 1);
}
export function absentDefault(n: number): number {
  trace = 0;
  return first`a` * 100 + trace + (n & 1);
}
export function absentOptional(n: number): number { return optional`a` + (n & 1); }
export function restValues(n: number): number { return rest`a${n & 3}b${2}c`; }
export function emptyRest(n: number): number { return rest`a` + (n & 1); }
export function restIncludesTemplate(n: number): number { return all`a${n & 3}b${2}c`; }
export function defaultReadsEarlierParameters(n: number): number { return defaults`a` + (n & 1); }
export function suppliedExpressionsBeforeDefaults(n: number): number {
  trace = 0;
  const value = defaults`a${undefined}b${mark(2)}c`;
  return value * 1000 + trace + (n & 1);
}
export function ordinaryExpressionsBeforeDefaults(n: number): number {
  trace = 0;
  const value = ordinary(undefined, mark(2));
  return value * 1000 + trace + (n & 1);
}
export function defaultThenEmptyRest(n: number): number { return withTail`a` + (n & 1); }
export function catchTag(n: number): number {
  try { return throwing`a${n & 1}b`; } catch (e) { return e instanceof RangeError ? -1 : -2; }
}
export function genericTag(n: number): number { return generic`a${n}b`; }

function keep(strings: TemplateStringsArray, value?: unknown): TemplateStringsArray { return strings; }
function site(n: number): TemplateStringsArray { return keep`same${n}site`; }
function copied<T>(value: T): TemplateStringsArray { return keep`copy${value}site`; }
function raisesAtSite(n: number): TemplateStringsArray {
  const strings = keep`raising`;
  if (n > 0) throw new RangeError("site");
  return strings;
}
function erased(strings: TemplateStringsArray): unknown { return strings; }
function erasedSite(): unknown { return erased`erased`; }
function cooked(strings: TemplateStringsArray, value: number): number {
  return strings[0].length * 100 + strings[1].length * 10 + value;
}
export function repeatIdentity(n: number): number { return site(n) === site(n + 1) ? 1 : 0; }
export function differentSites(n: number): number {
  const a = keep`same`;
  const b = keep`same`;
  return a === b ? 0 : 1 + (n & 1);
}
export function copiedIdentity(n: number): number { return copied(n) === copied("text") ? 1 : 0; }
export function raisingCopyIdentity(n: number): number {
  const before = raisesAtSite(0);
  try { return before === raisesAtSite(n & 0) ? 1 : 0; } catch { return -1; }
}
export function erasedIdentity(n: number): number { return erasedSite() === erasedSite() ? 1 + (n & 1) : 0; }
export function heldInContainer(n: number): number {
  const before = site(n);
  const values = [before];
  site(n + 1);
  return values[0] === before && values[0] === site(n + 2) ? 1 : 0;
}
export function cookedEscapes(n: number): number { return cooked`a\tb${n & 3}c\nd`; }

function readErased(value: unknown): number {
  return Array.isArray(value) ? (value[0] === "abc" ? 1 : 0) : -1;
}
function isErasedArray(value: unknown): number { return Array.isArray(value) ? 1 : 0; }
export function erasedRead(n: number): number { return readErased(keep`abc`) + (n & 1); }
export function erasedIsArray(n: number): number { return isErasedArray(keep`array`) + (n & 1); }
export function erasedType(n: number): number { return typeof erasedSite() === "object" ? 1 + (n & 1) : 0; }

const moduleTemplate = site(0);
export function moduleIdentity(n: number): number { return moduleTemplate === site(n) ? 1 : 0; }
