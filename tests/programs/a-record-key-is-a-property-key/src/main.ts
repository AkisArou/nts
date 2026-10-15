// Record access converts primitive keys; Map access keeps SameValueZero.
// Object coercion and symbol stores deliberately live in refusal outcomes
// until their representation/protocol slice, so every case here must agree.
function pick(n: number): any {
  const k = ((n | 0) >>> 0) % 12;
  if (k === 0) return "x";
  if (k === 1) return 1;
  if (k === 2) return -0;
  if (k === 3) return 1.5;
  if (k === 4) return true;
  if (k === 5) return false;
  if (k === 6) return null;
  if (k === 7) return undefined;
  if (k === 8) return 17n;
  if (k === 9) return NaN;
  if (k === 10) return Infinity;
  return -Infinity;
}
function spelling(n: number): string {
  const k = ((n | 0) >>> 0) % 12;
  if (k === 0) return "x";
  if (k === 1) return "1";
  if (k === 2) return "0";
  if (k === 3) return "1.5";
  if (k === 4) return "true";
  if (k === 5) return "false";
  if (k === 6) return "null";
  if (k === 7) return "undefined";
  if (k === 8) return "17";
  if (k === 9) return "NaN";
  if (k === 10) return "Infinity";
  return "-Infinity";
}
function values(): Record<string, number> {
  return {
    x: 1, "1": 2, "0": 3, "1.5": 4, "true": 5, "false": 6,
    "null": 7, "undefined": 8, "17": 9, "NaN": 10,
    "Infinity": 11, "-Infinity": 12,
  };
}
function unknownValues(): Record<string, unknown> {
  return { "": 99, x: 1, "1": 2, "0": 3, "1.5": 4, "true": 5, "false": 6,
    "null": 7, "undefined": 8, "17": 9, "NaN": 10,
    "Infinity": 11, "-Infinity": 12 };
}
// Drive every key kind in each run: the differential input pool alone does
// not visit every residue modulo 12. The control differs only in its key.
function exercise(key: any, spelling: string, n: number): string {
  const record = values();
  const read = record[key];
  const present = key in record;
  const own = Object.hasOwn(record, key);
  record[key] = n & 3;
  record[key] += 2;
  const post = record[key]++;
  const pre = ++record[key];
  const down = record[key]--;
  const before = --record[key];
  const stored = record[spelling];
  const removed = delete record[key];
  const again = delete record[key];
  const absent = key in record;
  return String(read) + ":" + String(present) + ":" + String(own) + ":"
    + String(post + pre + down + before + stored) + ":"
    + String(removed) + ":" + String(again) + ":" + String(absent) + ";";
}
export function readPrimitive(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) result += exercise(pick(i), spelling(i), n);
  return result;
}
export function readStringControl(n: number): string {
  let result = "";
  for (let i = 0; i < 12; i++) result += exercise(spelling(i), spelling(i), n);
  return result;
}
export function writePrimitive(n: number): number {
  const record = values();
  record[pick(n)] = n | 0;
  return record[spelling(n)]!;
}
export function writeStringControl(n: number): number {
  const record = values();
  record[spelling(n)] = n | 0;
  return record[spelling(n)]!;
}
export function hasPrimitive(n: number): boolean {
  return pick(n) in values();
}
export function hasStringControl(n: number): boolean {
  return spelling(n) in values();
}
export function ownsPrimitive(n: number): boolean {
  return Object.hasOwn(values(), pick(n));
}
export function deletePrimitive(n: number): number {
  const record = values();
  const key = pick(n);
  const first = delete record[key];
  const second = delete record[key];
  return (first ? 10 : 0) + (second ? 1 : 0) + (key in record ? 100 : 0);
}
export function deleteStringControl(n: number): number {
  const record = values();
  const key = spelling(n);
  const first = delete record[key];
  const second = delete record[key];
  return (first ? 10 : 0) + (second ? 1 : 0) + (key in record ? 100 : 0);
}
export function compoundPrimitive(n: number): number {
  const record = values();
  const key = pick(n);
  record[key] += n & 3;
  return record[spelling(n)]!;
}
export function updatePrimitive(n: number): number {
  const record = values();
  const key = pick(n);
  const post = record[key]++;
  const pre = ++record[key];
  const down = record[key]--;
  const before = --record[key];
  return post + pre + down + before + record[spelling(n)]!;
}
export function symbolMisses(n: number): string {
  const record = unknownValues();
  const key: any = Symbol("x");
  const read = String(record[key]);
  const has = key in record;
  const own = Object.hasOwn(record, key);
  const removed = delete record[key];
  return read + ";" + String(has) + ";" + String(own) + ";" + String(removed) + ";" + String(n & 3);
}
export function nullableStringKey(n: number): string {
  const key: string | null = (n & 1) === 0 ? null : "null";
  return String(unknownValues()[key as any]);
}
export function optionalRecord(n: number): string {
  const record: Record<string, unknown> | null = (n & 1) === 0 ? unknownValues() : null;
  return String(record?.[pick(n)]);
}
let trace = "";
function keyEffect(): any { trace += "key;"; return true; }
function rhsEffect(n: number): number { trace += "rhs;"; return n & 3; }
export function storeOrder(n: number): string {
  const record = values();
  trace = "";
  record[keyEffect()] = rhsEffect(n);
  return trace + String(record.true);
}
export function compoundOrder(n: number): string {
  const record = values();
  trace = "";
  record[keyEffect()] += rhsEffect(n);
  return trace + String(record.true);
}
export function deleteNullable(n: number): string {
  const record: Record<string, unknown> | null = (n & 1) === 0 ? unknownValues() : null;
  trace = "";
  try { return String(delete record![keyEffect()]) + ";" + trace; }
  catch (error) { return (error as Error).name + ": " + (error as Error).message + ";" + trace; }
}
export function mapKeepsItsKeys(n: number): number {
  const map = new Map<any, number>();
  const object = { x: n & 3 };
  const symbol = Symbol("1");
  map.set(1, 2); map.set("1", 3);
  map.set(true, 5); map.set("true", 7);
  map.set(object, 11); map.set(symbol, 13);
  map.set(NaN, 17); map.set(-0, 19);
  return map.get(1)! + map.get("1")! + map.get(true)! + map.get("true")!
    + map.get(object)! + map.get(symbol)! + map.get(NaN)! + map.get(0)!;
}

export function staticPrimitiveKeys(n: number): string {
  const record = unknownValues();
  const symbol = Symbol("x");
  // @ts-ignore -- JavaScript ToPropertyKey accepts boolean keys.
  const booleanKey = String(record[true]);
  // @ts-ignore -- JavaScript ToPropertyKey accepts null keys.
  const nullKey = String(record[null]);
  // @ts-ignore -- JavaScript ToPropertyKey accepts bigint keys.
  const bigintKey = String(record[17n]);
  // @ts-ignore -- A symbol misses in a string-keyed record.
  const symbolKey = String(record[symbol]);
  return booleanKey + ";" + nullKey + ";" + bigintKey + ";" + symbolKey
    + ";" + String(record[1.5]) + ";" + String(n & 3);
}
export function missingPrimitiveKeys(n: number): string {
  const record = unknownValues();
  const key: any = (n & 1) === 0 ? 999 : "999";
  return String(record[key]) + ";" + String(key in record) + ";"
    + String(Object.hasOwn(record, key)) + ";" + String(delete record[key]);
}
