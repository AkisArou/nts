// Walking a user type through its own iterator.
//
// This is the walk that allocates, and it is here to price exactly that. The
// four built-in walks avoid the iteration protocol on purpose -- an array is a
// counted loop with no iterator and no result object, and a `Map` is two reads
// with no `[key, value]` pair ever built -- and the reason is this case.
//
// `next()` returns a fresh `{ value, done }` on every call, so the protocol
// costs one object per element plus one to learn there are none left, plus the
// iterator itself. Nothing else in the loop allocates: the `Counted` never
// leaves `work`.

type Step = { value: number; done: boolean };

class Steps {
  at: number;
  constructor(at: number) {
    this.at = at;
  }
  next(): Step {
    this.at = this.at - 1;
    return { value: this.at < 0 ? 0 : this.at, done: this.at < 0 };
  }
}

class Counted {
  from: number;
  constructor(from: number) {
    this.from = from;
  }
  [Symbol.iterator](): Steps {
    return new Steps(this.from);
  }
}

export function work(n: number): number {
  let total = 0;
  for (const v of new Counted(8 + n)) {
    total = total + v;
  }
  return total;
}
