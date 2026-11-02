/*---
description: Explicit string-key record control for A union element narrowed from a typed array keeps its symbol identity and exact description.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-unions, ts-typeof-operator]
---*/
// A declared union array mixes symbols, numbers and undefined; node narrows symbol elements and records exact identity, description and strings in source order.
type Token = string;
interface TokenData { description: string | undefined; registered: string | undefined; }
const tokenOrder: Token[] = [], tokenData: Record<string, TokenData> = {};
function fresh(description: string | undefined): Token { const id = "token:" + tokenOrder.length; tokenOrder.push(id); tokenData[id] = { description, registered: undefined }; return id; }
function tokenText(value: Token): string { const description = tokenData[value].description; return "Symbol(" + (description === undefined ? "" : description) + ")"; }
type ElementValue = Token | number | undefined;
function inspect(values: ElementValue[]): { tokens: Token[]; descriptions: (string | undefined)[]; strings: string[] } {
  const tokens: Token[] = [], descriptions: (string | undefined)[] = [], strings: string[] = [];
  for (const value of values) if (typeof value === "string") { tokens.push(value); descriptions.push(tokenData[value].description); strings.push(tokenText(value)); }
  return { tokens, descriptions, strings };
}
for (const description of [undefined, "", "same", "\ud83d\ude00"]) {
  const first = fresh(description), second = fresh(description), text = description === undefined ? "Symbol()" : "Symbol(" + description + ")";
  const rows: { values: ElementValue[]; expected: Token[] }[] = [{ values: [], expected: [] }, { values: [undefined, -0, NaN], expected: [] }, { values: [first], expected: [first] }, { values: [first, 0, second, undefined, first, NaN], expected: [first, second, first] }];
  for (const row of rows) {
    const before = row.values.slice(), result = inspect(row.values), descriptions: (string | undefined)[] = [], strings: string[] = [];
    for (const value of row.expected) { descriptions.push(description); strings.push(text); }
    assert.compareArray(result.tokens, row.expected); assert.compareArray(result.descriptions, descriptions); assert.compareArray(result.strings, strings); assert.compareArray(row.values, before);
    assert.sameValue(first === second, false);
  }
}
