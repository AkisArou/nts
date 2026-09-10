// expect: `_read`, declared by `Readable` with a type that has no representation
//
// A class method that the constructor **assigns to** — node's per-instance
// override idiom, and the extension mechanism of every stream class.
//
//     _read(_size: number): void { throw new ERR_METHOD_NOT_IMPLEMENTED(); }
//     ...
//     if (typeof options.read === "function") this._read = options.read;
//
// A method is a dispatch-table entry, so the class has no slot to store the
// override in. Asked for one, the member's *type* is a function type, which has
// no representation as a field — hence the message, which is about the type and
// the cause is the assignment.
//
// # What is behind it
//
// `Readable`, `Writable`, `Duplex` and `Transform` all publish nothing:
//
//     no wrapper for Readable: is a class whose constructor was not compiled
//
// **129 failing test files** across the first three, by the Node lane's ranking:
// 80 for `Readable`, 36 for `Writable`, 13 for `Transform`. The same shape is
// `_write`, `_writev`, `_final`, `_destroy`, `_construct`, `_transform` and
// `_flush` — the hooks are the API.
//
// Counted per module, function-typed field refusals: `http` 7, `fs` 6,
// `process` 6, `net` 5, `stream` 4. Not all of them are this shape; the two in
// `stream` that are not are `EventTargetLike`'s `addEventListener` and
// `removeEventListener`, which are an *interface* declaring methods in method
// syntax — `blockers/method-syntax-in-an-interface`'s case, and a different one.
//
// # It was standing behind another refusal until this morning
//
// Until `examples/an-array-literal-at-the-slots-element` landed, `Readable`'s
// constructor refused earlier on an array literal built at the wrong element
// width, and these three sites carried **no diagnostic at all**. The Node lane
// measured the exchange: seven array-width refusals in `stream` went to one, and
// `no wrapper for Readable` stayed byte-identical. That is what this fixture is
// for — the obstacle that was already there, finally saying so at a source line.
//
// # What it would take
//
// A method that is ever assigned has to be a **stored slot holding a closure**
// rather than a dispatch-table entry, with the class's own implementation
// installed there by the constructor. Whether a method is ever assigned is a
// whole-program question, like `arrays_can_grow`: one `this.m = f` anywhere puts
// every instance's `m` in a slot.
//
// That is a representation decision and not a member-kind check, which is why
// this is filed rather than fixed. It is also why the message is worth keeping
// as it is: "a type that has no representation" is true, and the reason there is
// no representation is that a method was asked to be a field.
//
// # The control
//
// `neverAssigned` is the same class shape with no assignment, and it compiles.
// So this is the assignment and not the method, and not the optional callback
// in the options object either.

interface Options {
  read?: (size: number) => void;
}

class Readable {
  count: number;
  constructor(options?: Options) {
    this.count = 0;
    if (options && typeof options.read === "function") this._read = options.read;
  }
  _read(_size: number): void {
    this.count += 1;
  }
  pull(size: number): number {
    this._read(size);
    return this.count;
  }
}

export function subject(n: number): number {
  return new Readable().pull(n);
}

/** The control: the same shape with nothing assigning the method. */
class Fixed {
  count = 0;
  _read(_size: number): void {
    this.count += 1;
  }
  pull(size: number): number {
    this._read(size);
    return this.count;
  }
}

export function control(n: number): number {
  return new Fixed().pull(n);
}
