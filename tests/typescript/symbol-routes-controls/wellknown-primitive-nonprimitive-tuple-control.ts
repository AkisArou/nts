/*---
description: Plain string-hook record control for A conversion hook carried in a typed tuple rejects non-primitive results for every hint.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-tuples, ts-unions, ts-function-types, ts-conversions, ts-errors, ts-arrow-functions, ts-numbers, ts-strings, ts-record]
---*/
// String hook record: A PrimitiveValue and hint travel together in a tuple; node throws TypeError for an object hook result and accepts the same receiver after a data change.
type Hint = "number" | "string" | "default";
const hookKey = "hook:primitive", log: unknown[] = [];
interface PrimitiveValue { fail: boolean; amount: number; keys: string[]; hooks: Record<string, (self: PrimitiveValue, hint: Hint) => number | { value: number }>; }
function make(amount: number, fail: boolean): PrimitiveValue {
  return { amount, fail, keys: [hookKey], hooks: { [hookKey]: (self, hint) => {
    log.push(self, hint); return self.fail ? { value: self.amount } : self.amount;
  } } };
}
function convert(pair: [PrimitiveValue, Hint]): number | string {
  const [target, hint] = pair; if (!target.keys.includes(hookKey)) throw new TypeError("hook");
  const result = target.hooks[hookKey](target, hint); if (typeof result === "object") throw new TypeError("non-primitive");
  return hint === "number" ? Number(result) : hint === "string" ? String(result) : String(result) + "!";
}
const hints: Hint[] = ["number", "string", "default"];
for (const amount of [-0, NaN, 5]) for (const fail of [false, true]) for (const hint of hints) {
  log.length = 0; const target = make(amount, fail), pair: [PrimitiveValue, Hint] = [target, hint];
  const expected = hint === "number" ? amount : hint === "string" ? String(amount) : `${amount}!`;
  if (fail) assert.throws(TypeError, () => convert(pair)); else assert.sameValue(convert(pair), expected);
  assert.compareArray(log, [target, hint]); assert.sameValue(target.amount, amount); assert.sameValue(target.fail, fail);
  target.fail = false; assert.sameValue(convert(pair), expected);
  assert.compareArray(log, [target, hint, target, hint]); assert.sameValue(target.amount, amount);
}
