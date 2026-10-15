// Null/undefined receiver checks belong to the access, across erased TS
// assertions too. The non-null branch differs only in the receiver.
// index() and rhs() make the reference evaluation order observable.
let trace = "";
function index(): number { trace += "index;"; return 3; }
function rhs(): number { trace += "rhs;"; return 9; }
function receiver(values: number[] | null): number[] | null {
  trace += "receiver;";
  return values;
}
function errorText(error: unknown): string {
  return error instanceof TypeError ? "TypeError: " + error.message : "another error";
}

function readBangValue(values: number[] | null): number {
  return receiver(values)![index()];
}
export function readBang(n: number): string {
  trace = "";
  try { return String(readBangValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function readCastValue(values: number[] | null): number {
  return (receiver(values) as number[])[index()];
}
export function readCast(n: number): string {
  trace = "";
  try { return String(readCastValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function readPlainValue(values: number[] | null): number {
  // @ts-ignore -- the same read is reachable in unchecked JS.
  return receiver(values)[index()];
}
export function readPlain(n: number): string {
  trace = "";
  try { return String(readPlainValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function readUndefinedValue(values: number[] | undefined): number {
  return values![index()];
}
export function readUndefined(n: number): string {
  trace = "";
  try { return String(readUndefinedValue(n < 0 ? undefined : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function writeBangValue(values: number[] | null): number {
  return receiver(values)![index()] = rhs();
}
export function writeBang(n: number): string {
  trace = "";
  try { return String(writeBangValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function writeCastValue(values: number[] | null): number {
  return (receiver(values) as number[])[index()] = rhs();
}
export function writeCast(n: number): string {
  trace = "";
  try { return String(writeCastValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function writePlainValue(values: number[] | null): number {
  // @ts-ignore -- the same store is reachable in unchecked JS.
  return receiver(values)[index()] = rhs();
}
export function writePlain(n: number): string {
  trace = "";
  try { return String(writePlainValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function writeUndefinedValue(values: number[] | undefined): number {
  return values![index()] = rhs();
}
export function writeUndefined(n: number): string {
  trace = "";
  try { return String(writeUndefinedValue(n < 0 ? undefined : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function compoundValue(values: number[] | null): number {
  return receiver(values)![index()] += rhs();
}
export function compound(n: number): string {
  trace = "";
  try { return String(compoundValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function postIncrementValue(values: number[] | null): number {
  return receiver(values)![index()]++;
}
export function postIncrement(n: number): string {
  trace = "";
  try { return String(postIncrementValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function preDecrementValue(values: number[] | null): number {
  return --receiver(values)![index()];
}
export function preDecrement(n: number): string {
  trace = "";
  try { return String(preDecrementValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function readPropertyValue(values: { x: number } | null): number {
  return values!.x;
}
export function readProperty(n: number): string {
  trace = "";
  try { return String(readPropertyValue(n < 0 ? null : { x: 7 })) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function writePropertyValue(values: { x: number } | null): number {
  return values!.x = rhs();
}
export function writeProperty(n: number): string {
  trace = "";
  try { return String(writePropertyValue(n < 0 ? null : { x: 7 })) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function readPropertyUndefinedValue(values: { x: number } | undefined): number {
  return (values as { x: number }).x;
}
export function readPropertyUndefined(n: number): string {
  trace = "";
  try { return String(readPropertyUndefinedValue(n < 0 ? undefined : { x: 7 })) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function readStringValue(values: string | null): number {
  return values![index()].length;
}
export function readString(n: number): string {
  trace = "";
  try { return String(readStringValue(n < 0 ? null : "abcdefgh")) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

function readLengthValue(values: number[] | null): number {
  return values!.length;
}
export function readLength(n: number): string {
  trace = "";
  try { return String(readLengthValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

export function optionalControl(n: number): string {
  trace = "";
  const values = n < 0 ? null : [0, 1, 2, 7];
  return String(values?.[index()]) + ";" + trace;
}

function erasedReadValue(values: unknown): number {
  return (values as number[])[index()];
}
export function erasedNull(n: number): string {
  trace = "";
  try { return String(erasedReadValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}
export function erasedUndefined(n: number): string {
  trace = "";
  try { return String(erasedReadValue(n < 0 ? undefined : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}
function readIndexValue(values: number[] | null, at: number): number {
  return values![at];
}
export function numericKey(n: number): string {
  try { return String(readIndexValue(null, n)); }
  catch (error) { return errorText(error); }
}
function methodValue(values: number[] | null): number {
  return values!.indexOf(rhs());
}
export function methodRead(n: number): string {
  trace = "";
  try { return String(methodValue(n < 0 ? null : [0, 1, 2, 7])) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}

export function finallyKeepsLocalBindings(n: number): number {
  let count = 0;
  const values = n < 0 ? null : [0, 1, 2, 7];
  try {
    try { count += (values as number[])[3]; }
    finally { count += 10; }
  } catch (error) {
    count += error instanceof TypeError ? 100 : 1000;
  }
  return count;
}

function discardedValue(values: number[] | null): number {
  (values as number[])[3];
  return 4;
}
export function discardedRead(n: number): string {
  try { return String(discardedValue(n < 0 ? null : [0, 1, 2, 7])); }
  catch (error) { return errorText(error); }
}
function typeofValue(values: number[] | null): string {
  return typeof (values as number[])[3];
}
export function typeofRead(n: number): string {
  try { return typeofValue(n < 0 ? null : [0, 1, 2, 7]); }
  catch (error) { return errorText(error); }
}

const fieldKey = Symbol("field description");
class SymbolBox {
  [fieldKey]: number;
  constructor() { this[fieldKey] = 8; }
}
function symbolReadValue(values: SymbolBox | null): number { return values![fieldKey]; }
export function symbolRead(n: number): string {
  try { return String(symbolReadValue(n < 0 ? null : new SymbolBox())); }
  catch (error) { return errorText(error); }
}
function symbolWriteValue(values: SymbolBox | null): number { return values![fieldKey] = rhs(); }
export function symbolWrite(n: number): string {
  trace = "";
  try { return String(symbolWriteValue(n < 0 ? null : new SymbolBox())) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}
function symbolUndefinedValue(values: SymbolBox | undefined): number { return values![fieldKey]; }
export function symbolUndefined(n: number): string {
  try { return String(symbolUndefinedValue(n < 0 ? undefined : new SymbolBox())); }
  catch (error) { return errorText(error); }
}
function bothAbsencesValue(values: number[] | null | undefined): number { return values![3]; }
export function bothAbsences(n: number): string {
  try { return String(bothAbsencesValue(n < 0 ? n < -1 ? null : undefined : [0, 1, 2, 7])); }
  catch (error) { return errorText(error); }
}

// Erased primitives still carry enough information for an exact diagnostic.
function primitiveKeyValue(values: Record<string, number> | null, key: any): number {
  return values![key];
}
export function erasedPrimitiveKey(n: number): string {
  let key: any = n;
  if (n === 0) key = null;
  else if (n === 1) key = undefined;
  else if (n === 2) key = true;
  else if (n === 3) key = "a string key";
  else if (n === 4) key = 9007199254740993n;
  else if (n === 5) key = Symbol("description");
  try { return String(primitiveKeyValue(null, key)); }
  catch (error) { return errorText(error); }
}
class SideEffectingKey {
  toString(): string { trace += "coerced;"; return "x"; }
}
export function erasedObjectKeyRunsNoCode(n: number): string {
  trace = "";
  const key: any = n < 0 ? new SideEffectingKey() : "x";
  try { return String(primitiveKeyValue(null, key)) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}
const longKey = Symbol("α".repeat(129));
class LongSymbolBox {
  [longKey]: number;
  constructor() { this[longKey] = 8; }
}
function longSymbolReadValue(values: LongSymbolBox | null): number { return values![longKey]; }
export function longSymbolRead(n: number): string {
  try { return String(longSymbolReadValue(n < 0 ? null : new LongSymbolBox())); }
  catch (error) { return errorText(error); }
}

// The original AWFY shape: a nullable field is asserted at the access site.
class NullableRows {
  freeRows: number[] | null;
  constructor(rows: number[] | null) { this.freeRows = rows; }
  read(): number { return this.freeRows![3]; }
  write(): number { return this.freeRows![3] = rhs(); }
}
export function nullableFieldRead(n: number): string {
  try { return String(new NullableRows(n < 0 ? null : [0, 1, 2, 7]).read()); }
  catch (error) { return errorText(error); }
}
export function nullableFieldWrite(n: number): string {
  trace = "";
  try { return String(new NullableRows(n < 0 ? null : [0, 1, 2, 7]).write()) + ";" + trace; }
  catch (error) { return errorText(error) + ";" + trace; }
}
