// A method taken as a value whose body reads `this` takes the call's `this`, as
// a `function` does (`docs/function-receivers.md`). JavaScript does not bind a
// method read off an object: `c.get.bind(c)`, a method stored in a field and
// called through it, and `m.call(other)` each give the body a `this` of their
// own. Until this, such a read was refused (`RECEIVER_IS_NOT_BOUND`), since
// binding it to the object it was read from is only right while the body
// cannot tell.
//
// The implementation that runs is the read object's. Where a subclass
// overrides the method, the call's `this` must be the read object itself
// (`overriddenSameObject`), the shape the runtime's own uses have; where
// nothing overrides it, any instance of the declaring class will do
// (`anotherInstance`).

class Counter {
  count: number;
  constructor(count: number) {
    this.count = count;
  }
  get(): number {
    return this.count;
  }
  add(by: number): number {
    this.count += by;
    return this.count;
  }
}

/** `obj.m.bind(obj)`: the commonest spelling, `this.handler.bind(this)`. */
export function boundToItself(n: number): number {
  const c = new Counter(n & 7);
  const add = c.add.bind(c);
  add(1);
  return add(2) * 10 + c.get.bind(c)();
}

class Stream {
  written = 0;
  writev: (count: number) => number;
  constructor() {
    this.writev = this.writeVector;
  }
  writeVector(count: number): number {
    this.written += count;
    return this.written;
  }
}

/** A method stored in a field of its own object and called through it. */
export function storedInAField(n: number): number {
  const s = new Stream();
  s.writev(n & 7);
  return s.writev(3);
}

/** `m.call(other)`: nothing overrides `get`, so any `Counter` will do. */
export function anotherInstance(n: number): number {
  const read = new Counter(1).get;
  return read.call(new Counter(n & 7)) * 100 + read.call(new Counter(5));
}

class Shape {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
  area(): number {
    return this.size;
  }
}

class Square extends Shape {
  area(): number {
    return this.size * this.size;
  }
}

/** Overridden: dispatched on the object it was read from, called on it. */
export function overriddenSameObject(n: number): number {
  const shapes: Shape[] = [new Shape(n & 7), new Square(n & 3)];
  let total = 0;
  for (const shape of shapes) {
    const area = shape.area.bind(shape);
    total = total * 100 + area();
  }
  return total;
}

class Guard {
  limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  check(v: number): number {
    if (v > this.limit) {
      throw new Error("over " + String(this.limit));
    }
    return v;
  }
}

/** Its `throw`, caught around a `call` of it; half the inputs throw. */
export function aThrowInsideATry(n: number): string {
  const guard = new Guard(3);
  const check = guard.check;
  try {
    return String(check.call(guard, n & 7));
  } catch (e) {
    return (e as Error).message;
  }
}

class Limit {
  limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  check(v: number): number {
    if (v > this.limit) {
      throw new Error("over " + String(this.limit));
    }
    return v;
  }
}

class StrictLimit extends Limit {
  check(v: number): number {
    if (v >= this.limit) {
      throw new Error("at or over " + String(this.limit));
    }
    return v * 2;
  }
}

/** Overridden, so the `throw` comes back through the raising slot. */
export function anOverrideThrowsInsideATry(n: number): string {
  const limits: Limit[] = [new Limit(3), new StrictLimit(3)];
  let out = "";
  for (const limit of limits) {
    const check = limit.check;
    try {
      out += String(check.call(limit, n & 7)) + ";";
    } catch (e) {
      out += (e as Error).message + ";";
    }
  }
  return out;
}

class Plain {
  check(v: number): number {
    if (v > 3) {
      throw new Error("plain over 3");
    }
    return v;
  }
}

/**
 * A method that reads no `this`, bound to its object as before. Its `throw`
 * inside a `try` stopped the program by name until the wrapper learned to name
 * a method's raising copy.
 */
export function aMethodReadingNoThisThrows(n: number): string {
  const plain = new Plain();
  const check = plain.check;
  try {
    return String(check.call(plain, n & 7));
  } catch (e) {
    return (e as Error).message;
  }
}
