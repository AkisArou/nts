/*---
description: Explicit string-key record control for Joining a typed symbol array throws for symbol members while an empty array succeeds unchanged.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-interfaces, ts-conversions, ts-errors]
---*/
// A declared symbol array field reaches Array.join implicit string conversion; node returns an empty string for no members and throws TypeError for symbol members.
type Token = string;
interface TokenData { description: string | undefined; registered: string | undefined; }
const tokenOrder: Token[] = [], tokenData: Record<string, TokenData> = {};
function fresh(description: string | undefined): Token { const id = "token:" + tokenOrder.length; tokenOrder.push(id); tokenData[id] = { description, registered: undefined }; return id; }
function tokenText(value: Token): string { const description = tokenData[value].description; return "Symbol(" + (description === undefined ? "" : description) + ")"; }
interface Holder { values: Token[]; }
function convert(holder: Holder): string { for (const value of holder.values) if (tokenData[value] !== undefined) throw new TypeError("implicit symbol string conversion"); return ""; }
for (const description of [undefined, "", "same", "\ud83d\ude00"]) {
  const first = fresh(description), second = fresh(description), rows: Token[][] = [[], [first], [second, first], [first, second, first]];
  for (const values of rows) {
    const holder: Holder = { values }, before: Token[] = values.slice();
    if (values.length === 0) assert.sameValue(convert(holder), ""); else assert.throws(TypeError, () => convert(holder));
    assert.sameValue(holder.values, values); assert.compareArray(holder.values, before); assert.compareArray(Object.keys(holder), ["values"]);
  }
  assert.sameValue(first === second, false);
}
