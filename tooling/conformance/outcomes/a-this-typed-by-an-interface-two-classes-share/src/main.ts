// **A `function` whose `this:` is an interface, called with an instance of
// a class that shares the interface's shape, stopped by name when a second
// class shared it too.** `read` declares `this: Valued`, and the body is read
// at `Valued`'s storage, so the call tests that the object is laid out there.
// The test named the shape's descriptor; but two classes of one shape each
// get a descriptor of their own (`Program::distinct_identities`), so `new
// Box(3)` failed it, and the program stopped with "a `function` called with a
// `this` that is not `Valued`", where node prints 19. The test is now by
// layout: every identity laid out where `Valued` is passes.
//
// **Control**: `readOne`, the same body over `Lone`, a shape only one class
// has, which always agreed.
//
// Found in batch review: a literal typed as a class now has an identity of
// its own too, so `examples/a-function-that-reads-its-own-this` and
// `a-function-declaration-that-reads-its-own-this` stopped the same way.
interface Valued {
  v: number;
}

class Box {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}

class Crate {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
}

const read = function (this: Valued, k: number): number {
  return this.v * k;
};

interface Lone {
  w: string;
}

class Only {
  w: string;
  constructor(w: string) {
    this.w = w;
  }
}

const readOne = function (this: Lone, suffix: string): string {
  return this.w + suffix;
};

observe("a box through this: Valued", String(read.call(new Box(3), 3)));
observe("a crate through this: Valued", String(read.call(new Crate(2), 5)));
observe("a literal through this: Valued", String(read.call({ v: 4 }, 2)));
observe("the control, one class of its shape", readOne.call(new Only("lone"), "!"));
done();
