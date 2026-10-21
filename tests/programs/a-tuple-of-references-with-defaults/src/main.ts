// **A tuple of unlike references whose elements may be missing.** A pattern's
// defaults make its tuple's elements optional: `[a = () => 1, b = function
// () { ... }] = []` is two function types, either of which may be absent,
// so the tuple's length varies. A struct has a slot for every element and
// refused both the empty literal ("a tuple literal of 0 element(s) where the
// type has 2") and the defaults ("a default on a property that can be `null`
// as well as missing"), which is what giving such tuples a struct did to 138
// test262 cases. So they are an array, of erased values: variable in length,
// and honest about what each slot holds.

class Point {
  constructor(public x: number) {}
}

function both([a = () => 1, b = function () { return 2; }] = []): number {
  return a() + b();
}

function either([label = "none", point = new Point(7)]: [string?, Point?] = []): string {
  return `${label}:${point.x}`;
}

export function defaults(seed: number): number {
  return both() * 10 + seed;
}

export function partly(seed: number): string {
  return either(["seeded"]) + "|" + either() + "|" + either(["given", new Point(seed)]);
}
