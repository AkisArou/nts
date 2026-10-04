// Assertions have native safety checks. The explicit guards below provide
// the same oracle in Node, which erases `as` and `!`. Native lowering folds
// those guards from the asserted type, so only a real assertion check can
// keep the failure paths and their try handlers.
function numberValue(value: unknown): number {
  const checked = value as number;
  if (typeof checked !== "number") throw new TypeError("oracle");
  return checked + 2;
}
function stringValue(value: unknown): number {
  const checked = value as string;
  if (typeof checked !== "string") throw new TypeError("oracle");
  return checked.length;
}
function booleanValue(value: unknown): number {
  const checked = value as boolean;
  if (typeof checked !== "boolean") throw new TypeError("oracle");
  return checked ? 3 : 4;
}
class Base { constructor(public value: number) {} }
class Child extends Base {}
class Similar { constructor(public value: number) {} }
function classValue(value: unknown): number {
  const checked = value as Base;
  if (!(checked instanceof Base)) throw new TypeError("oracle");
  return checked.value;
}
function presentValue(value: string | null): number {
  const checked = value!;
  if (checked === null) throw new TypeError("oracle");
  return checked.length;
}
export function checkedNumber(n: number): number {
  try { return numberValue(n >= 0 ? n : "wrong"); }
  catch (error) { return error instanceof TypeError ? -11 : -12; }
}
export function checkedString(n: number): number {
  try { return stringValue(n >= 0 ? "text" : n); }
  catch (error) { return error instanceof TypeError ? -21 : -22; }
}
export function checkedBoolean(n: number): number {
  try { return booleanValue(n >= 0 ? false : "wrong"); }
  catch (error) { return error instanceof TypeError ? -31 : -32; }
}
export function checkedClass(n: number): number {
  try { return classValue(n >= 0 ? new Base(n) : new Similar(n)); }
  catch (error) { return error instanceof TypeError ? -41 : -42; }
}
export function subclassControl(n: number): number {
  return classValue(new Child(n));
}
export function identityControl(n: number): number {
  const before = new Base(n);
  const erased: unknown = before;
  const after = erased as Base;
  return before === after ? after.value : -51;
}
export function checkedPresence(n: number): number {
  try { return presentValue(n >= 0 ? "text" : null); }
  catch (error) { return error instanceof TypeError ? -61 : -62; }
}
export function nestedAssertion(n: number): number {
  try {
    const checked = (n >= 0 ? n : "wrong") as unknown as number;
    if (typeof checked !== "number") throw new TypeError("oracle");
    return checked + 1;
  } catch (error) { return error instanceof TypeError ? -71 : -72; }
}
export function typeofKeepsAssertion(n: number): number {
  try {
    const held: unknown = n >= 0 ? n : "wrong";
    const checked = held as number;
    if (typeof checked !== "number") throw new TypeError("oracle");
    return typeof checked === "number" ? 8 : -81;
  } catch (error) { return error instanceof TypeError ? -82 : -83; }
}
export function satisfiesControl(n: number): number {
  const held = n satisfies unknown;
  return held + 1;
}

function nullableString(value: string | null): number {
  const checked = value as string;
  if (typeof checked !== "string") throw new TypeError("oracle");
  return checked.length;
}
function undefinedString(value: string | undefined): number {
  const checked = value as string;
  if (typeof checked !== "string") throw new TypeError("oracle");
  return checked.length;
}
function nullableClass(value: Base | null): number {
  const checked = value as Base;
  if (!(checked instanceof Base)) throw new TypeError("oracle");
  return checked.value;
}
function widenedNullable(value: string | null): number {
  const erased = value as unknown;
  return stringValue(erased);
}
function admittedNullable(value: unknown): number {
  const checked = value as string | null;
  if (checked === null) return 9;
  if (typeof checked !== "string") throw new TypeError("oracle");
  return checked.length;
}
function admittedNullableClass(value: unknown): number {
  const checked = value as Base | null;
  if (checked === null) return 9;
  if (!(checked instanceof Base)) throw new TypeError("oracle");
  return checked.value;
}
export function checkedNullableString(n: number): number {
  try { return nullableString(n >= 0 ? "text" : null); }
  catch (error) { return error instanceof TypeError ? -91 : -92; }
}
export function checkedUndefinedString(n: number): number {
  try { return undefinedString(n >= 0 ? "text" : undefined); }
  catch (error) { return error instanceof TypeError ? -101 : -102; }
}
export function checkedNullableClass(n: number): number {
  try { return nullableClass(n >= 0 ? new Base(n) : null); }
  catch (error) { return error instanceof TypeError ? -111 : -112; }
}
export function checkedWidenedNullable(n: number): number {
  try { return widenedNullable(n >= 0 ? "text" : null); }
  catch (error) { return error instanceof TypeError ? -121 : -122; }
}
export function nullableTarget(n: number): number {
  try { return admittedNullable(n > 0 ? "text" : n < 0 ? null : n); }
  catch (error) { return error instanceof TypeError ? -131 : -132; }
}
export function nullableClassTarget(n: number): number {
  try { return admittedNullableClass(n > 0 ? new Child(n) : n < 0 ? null : new Similar(n)); }
  catch (error) { return error instanceof TypeError ? -141 : -142; }
}
