/*---
description: Exported consts and functions are ordinary local bindings inside their own module.
features: [ts-modules, ts-exports]
flags: [module]
---*/
export const rate = 0.2;
export function withTax(amount: number): number {
  return amount * (1 + rate);
}
assert.sameValue(withTax(100), 120);
assert.sameValue(rate, 0.2);
