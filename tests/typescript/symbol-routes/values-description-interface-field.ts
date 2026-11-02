/*---
description: A symbol carried in an interface field retains its exact description and its independent identity.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-interfaces]
---*/
// An interface field carries symbols with absent, empty and Unicode descriptions; node preserves each description and distinct identities on replacement.
type Token = symbol;
function fresh(description: string | undefined): Token { return Symbol(description); }
interface Holder { value: Token; }
function describe(holder: Holder): string | undefined { return holder.value.description; }
const rows: (string | undefined)[] = [undefined, "", "same", "A\u0000B", "\ud83d\ude00", "\ud800", "__proto__"];
for (const expected of rows) {
  const first = fresh(expected), second = fresh(expected), holder: Holder = { value: first };
  assert.sameValue(first === second, false); assert.sameValue(holder.value, first); assert.sameValue(describe(holder), expected);
  holder.value = second; assert.sameValue(holder.value, second); assert.sameValue(describe(holder), expected); assert.sameValue(first === holder.value, false);
  assert.compareArray(Object.keys(holder), ["value"]); assert.compareArray([first, holder.value, first], [first, second, first]);
}
