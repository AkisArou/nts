
function raw(strings: TemplateStringsArray): number { return strings.raw.length; }
function mutable(strings: TemplateStringsArray): number {
  const values = strings as unknown as string[];
  values[0] = "changed";
  return values.length;
}
function invalid(strings: TemplateStringsArray, a?: number, b?: number): number {
  return strings[0] === undefined ? 1 : 0;
}
export function rawAccess(n: number): number { return raw`a` + n; }
export function writableCast(n: number): number { return mutable`a` + n; }
export function invalidWhole(n: number): number { return invalid`\unicode` + n; }
export function invalidHead(n: number): number { return invalid`\unicode${n}b`; }
export function invalidMiddle(n: number): number { return invalid`a${n}\unicode${n}b`; }
export function invalidTail(n: number): number { return invalid`a${n}\unicode`; }

function missing(strings: TemplateStringsArray): number {
  return strings[2] === undefined ? 1 : 0;
}
export function checkedMissingElement(n: number): number { return missing`a` + n; }
