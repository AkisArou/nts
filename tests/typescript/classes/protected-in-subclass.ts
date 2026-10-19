/*---
description: A protected member is read and written by a subclass's methods.
features: [ts-class, ts-protected, ts-inheritance]
---*/
class Meter {
  protected reading = 0;
  current(): number {
    return this.reading;
  }
}
class GasMeter extends Meter {
  burn(units: number): void {
    this.reading += units * 2;
  }
}
const gas = new GasMeter();
gas.burn(3);
gas.burn(1);
assert.sameValue(gas.current(), 8);
