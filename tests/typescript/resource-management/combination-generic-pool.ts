/*---
description: A generic pool hands out leases that `using` returns to it, over two resource types, with errors disposing too.
features: [ts-using, ts-generics, ts-class, ts-errors, ts-interfaces]
---*/
class Pool<T> {
  private free: T[];
  constructor(items: T[]) {
    this.free = [...items];
  }
  lease(): Disposable & { value: T } {
    const value = this.free.pop()!;
    return { value, [Symbol.dispose]: () => this.free.push(value) };
  }
  get available(): number {
    return this.free.length;
  }
}
const ports = new Pool([8080, 8081]);
const names = new Pool(["a"]);
{
  using port = ports.lease();
  using name = names.lease();
  assert.sameValue(`${name.value}:${port.value}`, "a:8081");
  assert.sameValue(ports.available + names.available, 1);
}
assert.throws(TypeError, () => {
  using port = ports.lease();
  throw new TypeError(String(port.value));
});
assert.sameValue(ports.available, 2);
assert.sameValue(names.available, 1);
