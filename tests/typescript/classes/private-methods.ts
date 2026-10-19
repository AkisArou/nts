/*---
description: A `#private` method and a `#private` accessor are callable inside the class only.
features: [ts-class, ts-private-fields, ts-accessors]
---*/
class Temperature {
  #celsius: number;
  constructor(celsius: number) {
    this.#celsius = celsius;
  }
  #toFahrenheit(): number {
    return this.#celsius * 9 / 5 + 32;
  }
  get #label(): string {
    return `${this.#toFahrenheit()}F`;
  }
  describe(): string {
    return this.#label;
  }
}
assert.sameValue(new Temperature(100).describe(), "212F");
assert.sameValue(new Temperature(-40).describe(), "-40F");
assert.sameValue(Object.getOwnPropertyNames(Temperature.prototype).join(","), "constructor,describe");
