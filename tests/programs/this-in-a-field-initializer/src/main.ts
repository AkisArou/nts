// A field initializer whose value is an arrow that captures `this`.
//
//     class Readable {
//       count = 0;
//       _read: (size: number) => void = (_size) => { this.count += 1; };
//     }
//
// Refused until 2026-09-10 as "`this` outside a method" — a sentence about the
// source that is false. The initializer is inside a class body and its `this`
// is the instance being constructed.
//
// The cause is that a field initializer is lowered **at the allocation site**
// rather than in a constructor, so `initialize_fields` runs inside whatever
// function wrote `new Readable()`. For a free function that is a builder with
// no receiver at all, and the capture asked `self.this` and got nothing. The
// receiver it wanted is the object being allocated, which that function already
// holds as a value.
//
// # Why this is the shape that matters
//
// It is what stands behind node's per-instance override idiom:
//
//     if (typeof options.read === "function") this._read = options.read;
//
// the extension mechanism of `Readable`, `Writable`, `Duplex` and `Transform`,
// and **129 failing test files** by the Node lane's ranking. A method that is
// assigned needs a stored slot holding a closure rather than a dispatch-table
// entry — and the slot's default is an arrow written in the class body, which
// captures `this` almost always. `blockers/a-method-assigned-per-instance` is
// the remaining half: turning method *syntax* into that field. This is the half
// that had to come first, because the target form did not compile either.
//
// `this` in a field initializer was measured to be the only thing stopping it:
// with the member written as a field, nothing is refused and every case agrees.
//
// # Controls
//
// `capturesNothing` is the same shape whose arrow closes over no `this`, which
// is the case that already worked — so this fixture distinguishes the capture
// from the field-of-function-type representation, which was never the problem.
// `directRead` reads `this` in an initializer *without* an arrow, a second way
// to need the same receiver.
// `throughTheBase` allocates a subclass and calls through a base-typed binding,
// so the slot the base's initializer wrote is the slot the override replaced.
// `inheritsTheArrow` is the one that costs a module if it is missing: a derived
// class that does **not** override, so the base's arrow is allocated with a
// *derived* receiver. The closure's two halves are built by different builders
// and merged, and they have to agree on the captured `this`'s type -- the body
// reads it at the class that declares the arrow, and this side used to write
// whatever receiver was in hand. Those were the same thing for as long as a
// closure could only be allocated in a method. `class GlobalConsole extends
// Console` put a `GlobalConsole *` in a slot the body reads as `NtsObj_Console
// *` and clang refused `console` outright, seven times.

interface Options {
  read?: (size: number) => void;
}

class Readable {
  count = 0;
  _read: (size: number) => void = (_size: number): void => {
    this.count += 1;
  };
  constructor(options?: Options) {
    if (options && typeof options.read === "function") {
      this._read = options.read;
    }
  }
  pull(size: number): number {
    this._read(size);
    return this.count;
  }
}

class Doubling extends Readable {
  override _read: (size: number) => void = (size: number): void => {
    this.count += size;
  };
}

/** Under test: the base's own initializer, which captures `this`. */
export function base(n: number): number {
  return new Readable().pull(n);
}

/** The subclass's initializer replaces the slot the base's wrote. */
export function subclass(n: number): number {
  return new Doubling().pull(n);
}

/** And the call finds the override through a base-typed binding. */
export function throughTheBase(n: number): number {
  const r: Readable = new Doubling();
  return r.pull(n) * 10;
}

class Counter {
  step = 2;
  // Control: an arrow in a field initializer that captures nothing. This
  // compiled before, which is what says the refusal was the capture.
  twice: (n: number) => number = (n: number): number => n * 2;
  apply(n: number): number {
    return this.twice(n) + this.step;
  }
}

/** Control: the same representation with no `this` in it. */
export function capturesNothing(n: number): number {
  return new Counter().apply(n);
}

class Derived2 {
  first = 5;
  // Control: `this` in an initializer with no arrow around it.
  second = this.first * 3;
  sum(): number {
    return this.first + this.second;
  }
}

/** Control: a receiver an initializer reads directly. */
export function directRead(n: number): number {
  return new Derived2().sum() + n * 0;
}

class OnlyBase {
  seen = 0;
  // Declared here, and `OnlyBase` is never constructed: every allocation of
  // this closure is a `OnlyDerived`, so the derived type is the only one that
  // reaches the capture field.
  note: (n: number) => void = (n: number): void => {
    this.seen += n;
  };
  read(): number {
    return this.seen;
  }
}

class OnlyDerived extends OnlyBase {
  extra = 4;
  total(n: number): number {
    this.note(n);
    return this.read() + this.extra;
  }
}

/**
 * Control: a base whose arrow field is only ever allocated by a subclass.
 *
 * This is the shape that costs a module, and the condition is the narrow one:
 * `OnlyBase` is **never constructed**. A closure's layout is built by two
 * different builders and merged, and they must agree on the captured `this`'s
 * type -- the body reads it at the class that *declares* the arrow, and the
 * allocation used to write whatever receiver was in hand. While the base is
 * also allocated somewhere its own type wins the merge and the defect hides,
 * which is why `Readable` above does not reproduce it and this does.
 *
 * `class GlobalConsole extends Console` is exactly this, and `Console` is never
 * constructed on its own: clang refused the module with `incompatible pointer
 * types assigning to 'NtsObj_Console *' from 'NtsObj_GlobalConsole *'`, seven
 * times, and `console` is the only inheritance in that file.
 */
export function onlyEverDerived(n: number): number {
  return new OnlyDerived().total(n);
}
