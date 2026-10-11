interface Counter { value: number; }
class First implements Counter { value = 0; other = 700; }
class Last implements Counter { other = 700; value = 0; }
class Checked implements Counter {
  private state = 0;
  get value(): number {
    if (this.state < 0) throw new RangeError("get");
    return this.state;
  }
  set value(n: number) {
    if (n < -3) throw new RangeError("set");
    this.state = n;
  }
}
function update(counter: Counter, n: number): number {
  counter.value = n;
  return counter.value;
}
function guarded(counter: Counter, n: number): number {
  try { counter.value = n; return counter.value; }
  catch { return -71; }
}
export function reordered(n: number): number {
  const counters: Counter[] = [new First(), new Last()];
  return update(counters[n > 0 ? 0 : 1]!, n) + 700;
}
export function caughtAccessor(n: number): number {
  const counters: Counter[] = [new First(), new Checked()];
  return guarded(counters[n > 10 ? 0 : 1]!, n);
}
export function transitiveAccessor(n: number): number {
  const counters: Counter[] = [new Last(), new Checked()];
  try { return update(counters[n > 10 ? 0 : 1]!, n); }
  catch { return -73; }
}
interface ReadonlyName { readonly label: string; }
class StoredName { label = "plain"; }
class GetterName {
  constructor(private n: number) {}
  get label(): string { return "getter" + this.n; }
}
function labelOf(value: ReadonlyName): string { return value.label; }
export function readonlyGetter(n: number): string {
  const values: ReadonlyName[] = [new StoredName(), new GetterName(n)];
  return values.map(value => labelOf(value)).join("/");
}
interface NullName { text: string | null; }
interface OptionalName { text: string | undefined; }
class Both { text: string | null | undefined = undefined; }
function nullFace(value: NullName): string {
  const text = value.text;
  return (text === null ? "null" : String(text)) + "/" + typeof text;
}
function optionalFace(value: OptionalName): string {
  const text = value.text;
  return (text === undefined ? "undefined" : String(text)) + "/" + typeof text;
}
export function actualAbsences(n: number): string {
  const value = new Both();
  value.text = n > 2 ? null : n > 1 ? undefined : "present";
  return nullFace(value as NullName) + "/" + optionalFace(value as OptionalName);
}

interface LiteralCounter { value: number; }
class LiteralLast { other = 200; value = 7; }
function literalUpdate(value: LiteralCounter, n: number): number {
  value.value += n;
  return value.value;
}
export function mixedLiteral(n: number): number {
  const values: LiteralCounter[] = [{value: 3}, new LiteralLast()];
  return literalUpdate(values[n > 1 ? 0 : 1]!, n);
}
export function specializedSetter(n: number): number {
  const values: Counter[] = [new First(), new Last()];
  let total = 0;
  for (let i = 0; i < (n & 31); i++) total += update(values[i & 1]!, i);
  return total;
}
interface CallableHolder { readonly call: () => number; }
class HeldCallback { other = 300; call = () => 7; }
function heldCall(value: CallableHolder): number { return value.call(); }
export function storedCallable(n: number): number {
  const values: CallableHolder[] = [{call: () => 3}, new HeldCallback()];
  return heldCall(values[n > 1 ? 0 : 1]!);
}

function destructured(counter: Counter): number { const { value } = counter; return value; }
export function caughtPattern(n: number): number {
  const value = new Checked();
  value.value = n < -3 ? -1 : n;
  const values: Counter[] = [new First(), value];
  try { return destructured(values[n > 10 ? 0 : 1]!); }
  catch { return -79; }
}

function parameter({value}: Counter): number { return value; }
export function caughtParameter(n: number): number {
  const value = new Checked();
  value.value = n < -3 ? -1 : n;
  const values: Counter[] = [new First(), value];
  try { return parameter(values[n > 10 ? 0 : 1]!); }
  catch { return -83; }
}
export function caughtAssignment(n: number): number {
  const value = new Checked();
  value.value = n < -3 ? -1 : n;
  const values: Counter[] = [new First(), value];
  let result = 0;
  try { ({value: result} = values[n > 10 ? 0 : 1]!); return result; }
  catch { return -89; }
}
function patternNullFace(value: NullName): string {
  const {text} = value;
  return (text === undefined ? "undefined" : String(text)) + "/" + typeof text;
}
export function actualPatternAbsences(n: number): string {
  const value = new Both();
  value.text = n > 2 ? null : n > 1 ? undefined : "present";
  return patternNullFace(value as NullName);
}
