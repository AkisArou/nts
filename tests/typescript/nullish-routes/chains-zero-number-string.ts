/*---
description: "Optional method access on numeric zero does not short circuit. Route: number or undefined class field"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Optional method access on numeric zero does not short circuit. Route: number or undefined class field. Node prints chains-zero-number-string:ok.
class NumberHolder {
  item: number | undefined;
  constructor(item: number | undefined) { this.item = item; }
  show(): string | undefined {
    const result = this.item?.toString();
    return result;
  }
}
assert.sameValue(new NumberHolder(0).show(), "0");
assert.sameValue(new NumberHolder(-0).show(), "0");
assert.sameValue(new NumberHolder(undefined).show(), undefined);
console.log("chains-zero-number-string:ok");
