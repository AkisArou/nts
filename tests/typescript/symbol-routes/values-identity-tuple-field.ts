/*---
description: A typed tuple field preserves repeated symbol identities without merging equal descriptions.
features: [ts-symbol-route-values, ts-symbols, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-tuples]
---*/
// A class tuple field carries two local symbols and a repeated reference; node keeps the exact identities through tuple rotation and field replacement.
type Token = symbol;
function fresh(description: string | undefined): Token { return Symbol(description); }
class Holder { values: [Token, Token, Token]; constructor(values: [Token, Token, Token]) { this.values = values; } }
function rotated(holder: Holder): [Token, Token, Token] { return [holder.values[1], holder.values[2], holder.values[0]]; }
function descriptions(holder: Holder): (string | undefined)[] { return [holder.values[0].description, holder.values[1].description, holder.values[2].description]; }
for (const description of [undefined, "", "same", "\ud83d\ude00"]) {
  const first = fresh(description), second = fresh(description), holder = new Holder([first, second, first]);
  assert.sameValue(first === second, false); assert.compareArray(holder.values, [first, second, first]); assert.compareArray(rotated(holder), [second, first, first]);
  assert.compareArray(descriptions(holder), [description, description, description]);
  holder.values[1] = first; assert.compareArray(holder.values, [first, first, first]); assert.compareArray(rotated(holder), [first, first, first]);
  holder.values[0] = second; assert.compareArray(holder.values, [second, first, first]); assert.compareArray(rotated(holder), [first, first, second]);
}
