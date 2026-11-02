/*---
description: Number conversion of a symbol in an interface field throws while number values keep their exact value.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-interfaces, ts-unions, ts-conversions, ts-errors, ts-numbers]
---*/
// An interface field carries a symbol-or-number union; node throws TypeError for Number(symbol) and preserves ordinary numeric controls including negative zero and NaN.
type Token = symbol;
function fresh(description: string | undefined): Token { return Symbol(description); }
interface Holder { value: Token | number; }
function convert(holder: Holder): number { return Number(holder.value); }
for (const description of [undefined, "", "same", "\ud83d\ude00"]) {
  const first = fresh(description), second = fresh(description), rows: { value: Token | number; fails: boolean }[] = [
    { value: first, fails: true }, { value: second, fails: true }, { value: -0, fails: false }, { value: NaN, fails: false }, { value: 7, fails: false }
  ];
  for (const row of rows) {
    const holder: Holder = { value: row.value }, before = holder.value;
    if (row.fails) assert.throws(TypeError, () => convert(holder)); else assert.sameValue(convert(holder), row.value);
    assert.sameValue(holder.value, before); assert.compareArray(Object.keys(holder), ["value"]);
  }
  assert.sameValue(first === second, false);
}
