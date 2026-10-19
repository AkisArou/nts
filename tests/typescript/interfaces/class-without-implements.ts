/*---
description: A class that does not name an interface still satisfies it structurally and is passed where it is expected.
features: [ts-interfaces, ts-class, ts-structural-typing]
---*/
interface Pricing {
  cost(quantity: number): number;
}
class Flat {
  cost(quantity: number): number {
    return 10 + quantity * 0;
  }
}
class PerUnit {
  constructor(private unit: number) {}
  cost(quantity: number): number {
    return quantity * this.unit;
  }
}
function quote(pricing: Pricing, quantity: number): number {
  return pricing.cost(quantity);
}
assert.sameValue(quote(new Flat(), 5), 10);
assert.sameValue(quote(new PerUnit(3), 5), 15);
