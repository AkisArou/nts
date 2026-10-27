// The stored callback reads dynamic this, rather than capturing its object.
// The method control changes only which concrete supplier is selected.
interface Valued { value: number; }
interface Maybe extends Valued {
  run?: ((n: number) => number) | undefined;
}
function read(this: Stored, n: number): number { return this.value * 10 + n; }
class Method {
  value: number;
  constructor(n: number) { this.value = n; }
  run(n: number): number { return this.value * 10 + n; }
}
class Stored {
  value: number;
  constructor(n: number) { this.value = n; }
  run = read;
}
function choose(stored: boolean, n: number): Maybe {
  if (stored) return new Stored(n);
  return new Method(n);
}
export function storedReceiver(n: number): number {
  return choose(true, n).run?.(3) ?? -1;
}
export function methodReceiver(n: number): number {
  return choose(false, n).run?.(3) ?? -1;
}

// Control for an-accessor-cannot-supply-a-callable-projection: a real field
// supplies the same function that the refused getter would return.
interface PlainMaybe { run?: ((n: number) => number) | undefined; }
function increment(n: number): number { return n + 1; }
class PlainMethod { run(n: number): number { return n + 1; } }
class PlainStored { run = increment; }
function plainChoice(stored: boolean): PlainMaybe {
  if (stored) return new PlainStored();
  return new PlainMethod();
}
export function getterStorageControl(n: number): number {
  return plainChoice((n & 1) !== 0).run?.(n) ?? -1;
}
