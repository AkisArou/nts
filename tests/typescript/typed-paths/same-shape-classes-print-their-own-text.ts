/*---
description: Two classes of one field shape each print by their own toString.
features: [ts-class, ts-to-string]
---*/
class Celsius {
  constructor(public degrees: number) {}
  toString(): string {
    return this.degrees + "C";
  }
}
class Fahrenheit {
  constructor(public degrees: number) {}
  toString(): string {
    return this.degrees + "F";
  }
}
assert.sameValue(String(new Celsius(1)), "1C");
assert.sameValue(`${new Fahrenheit(2)}`, "2F");
