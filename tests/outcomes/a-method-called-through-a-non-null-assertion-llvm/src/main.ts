// backend: llvm
// run: check
//
// A method called through a non-null assertion, `s.get!()`, on a class
// instance (#882). TypeScript erases the `!` and emits `s.get()`, a member call
// whose `this` is `s`; this compiler instead reads `get` as a function value and
// calls it with a `this` that is not the receiver, so every case ends the
// program with "a `function` called with a `this` that is not `this`, which
// stands for `S` here, which its body is read at" where node answers `n`.
// No closure and no `try` are involved.
//
// Found by #843 while writing the control for #866, and measured identically
// on main's pin 39f4978a7230, on C, LLVM, the JVM and C with reference counting.
// The one-difference control is
// programs/a-method-called-through-a-non-null-assertion-control: the call is
// `s.get()`, without the `!`.

class S {
  v = 3;
  get(): number {
    return this.v;
  }
}

export function probe(n: number): number {
  const s = new S();
  s.v = n;
  return s.get!();
}
