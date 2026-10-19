/*---
description: An abstract class's parameter properties are assigned through a subclass's super call.
features: [ts-class, ts-abstract, ts-parameter-properties, ts-inheritance]
---*/
abstract class Employee {
  constructor(public readonly fullName: string, protected rate: number) {}
  abstract pay(hours: number): number;
}
class Contractor extends Employee {
  constructor(fullName: string) {
    super(fullName, 50);
  }
  pay(hours: number): number {
    return hours * this.rate;
  }
}
const staff: Employee = new Contractor("Kim");
assert.sameValue(staff.fullName, "Kim");
assert.sameValue(staff.pay(3), 150);
