// `async` methods, which were refused for a reason that had stopped being true.
//
// The refusal said `Promise<T>` has no representation, so an `async` method
// "resolved to `-> void` and returned an `f64` from it anyway".
// `ManagedType::Promise` has existed for some time and `async` *functions* have
// worked throughout; only the method lowering never got the prologue that
// allocates the promise.
//
// So none of this is new machinery. A method's receiver is a parameter like any
// other, which means it goes into the suspended frame beside the rest and comes
// back out on resumption -- which is the one thing worth testing hardest here.

class Counter {
  base: number;
  constructor(base: number) {
    this.base = base;
  }

  // The simplest shape: reads `this`, returns a number.
  async scaled(by: number): Promise<number> {
    return this.base * by;
  }

  // `this` read *after* an await, so the receiver has to survive the
  // suspension -- it is in the frame or it is gone.
  async afterASuspension(by: number): Promise<number> {
    const first = await this.scaled(by);
    return first + this.base;
  }

  // Two suspensions, so the frame has three states and `this` is live across
  // both of them.
  async twice(by: number): Promise<number> {
    const one = await this.scaled(by);
    const two = await this.scaled(one % 7);
    return one * 100 + two + this.base;
  }

  // A local declared before the first await and read after it, beside `this`.
  async withALocal(by: number): Promise<number> {
    const held = by + 1;
    const got = await this.scaled(by);
    return got + held + this.base;
  }

  // An `async` method returning nothing, which settles with `undefined`.
  async record(by: number): Promise<void> {
    this.base = this.base + by;
  }

  // A loop containing an await, so the frame is entered from a back edge.
  async accumulate(rounds: number): Promise<number> {
    let total = 0;
    for (let i = 0; i < rounds % 5; i++) {
      total = total + (await this.scaled(i));
    }
    return total + this.base;
  }

  // An early return before any suspension, so one path never awaits.
  async maybe(by: number): Promise<number> {
    if (by < 0) {
      return -1;
    }
    return await this.scaled(by);
  }
}

// A `static` async method has no receiver, which is the other half of the
// parameter question.
class Statics {
  static async doubled(n: number): Promise<number> {
    return n * 2;
  }
  static async viaAnother(n: number): Promise<number> {
    return (await Statics.doubled(n)) + 1;
  }
}

// An `async` method overridden by a subclass, so the dispatch slot holds two
// state machines rather than one.
class Base {
  // Awaits, so that both this and the override below are *split* into an entry
  // and a resumption. A body with no `await` keeps its promise prologue and is
  // never split, which makes it the wrong fixture for a claim about two state
  // machines.
  async describe(n: number): Promise<number> {
    const scaled = await Statics.doubled(n);
    return scaled * 5;
  }
}

class Derived extends Base {
  override async describe(n: number): Promise<number> {
    return (await super.describe(n)) + 1;
  }
}

export async function simple(n: number): Promise<number> {
  return await new Counter(n).scaled(3);
}

export async function receiverSurvivesASuspension(n: number): Promise<number> {
  return await new Counter(n).afterASuspension(2);
}

export async function twoSuspensions(n: number): Promise<number> {
  return await new Counter(n).twice(2);
}

export async function aLocalAndAReceiver(n: number): Promise<number> {
  return await new Counter(n).withALocal(4);
}

export async function settlesWithNothing(n: number): Promise<number> {
  const c = new Counter(n);
  await c.record(5);
  return c.base;
}

export async function awaitInALoop(n: number): Promise<number> {
  return await new Counter(n).accumulate(n);
}

export async function onePathNeverAwaits(n: number): Promise<number> {
  return await new Counter(n).maybe(n);
}

export async function staticMethods(n: number): Promise<number> {
  return await Statics.viaAnother(n);
}

export async function overridden(n: number): Promise<number> {
  const b: Base = n > 0 ? new Derived() : new Base();
  return await b.describe(n);
}

// Two objects with their own state, interleaved, so a frame confused with
// another object's would show as one counter's base leaking into the other.
export async function twoReceivers(n: number): Promise<number> {
  const a = new Counter(n);
  const b = new Counter(n + 100);
  const first = await a.afterASuspension(1);
  const second = await b.afterASuspension(1);
  return first * 1000 + second;
}
