/*---
description: A derived constructor passes computed arguments to the base constructor.
features: [ts-class, ts-inheritance]
---*/
class Vehicle {
  readonly wheels: number;
  constructor(wheels: number) {
    this.wheels = wheels;
  }
}
class Truck extends Vehicle {
  readonly axles: number;
  constructor(axles: number) {
    super(axles * 2);
    this.axles = axles;
  }
}
const truck = new Truck(3);
assert.sameValue(truck.wheels, 6);
assert.sameValue(truck.axles, 3);
