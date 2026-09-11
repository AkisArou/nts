// expect: an array of
//
// **The parameter case closed on 2026-09-11 and this is what is left.** Passing
// a class where a structural interface is wanted is now specialised -- a copy of
// the callee over the concrete type, reading each field at *that* class's
// offset -- and `examples/a-structural-cast-that-is-not-a-prefix` guards it on
// all three backends. Record 0294.
//
// Specialisation needs the concrete type at the call. Two places do not have
// one, and they fail differently, which is the reason this file still exists.
//
// # An array of the interface type, which refuses
//
// `Named[]` holding a `Thing[]` is refused by name: the two hold different
// widths, so a pointer to one is not a pointer to the other. That is the
// expectation above, and it is the honest failure -- nothing is emitted and the
// message says why.
//
// # A *field* of the interface type, which does not refuse, and segfaults
//
// **`storedInAField` is the worse one and it is not guarded here, because a
// refusal is what this directory can assert and this does not refuse.**
//
//     class Holder { held: Named; constructor(n) { this.held = new Thing(n) } }
//     readName(new Holder(n).held)
//
// lowers completely, emits C, builds, and dies with **signal 11**. The store
// casts a `Thing *` into a slot typed `Named *`, and every later read through
// that slot is at the wrong offset -- `name` at 24 where the object has `id`.
//
// Confirmed pre-existing rather than assumed: it crashes identically under the
// pinned compiler at `a2a499b4`, the last green gate before the specialisation
// landed. The parameter case was refused all along and the field case never was,
// so the guard that made one safe was never asked about the other.
//
// **What it wants is the refusal, first.** `coerce` asks
// `laid_out_as_a_prefix` on the way into a parameter and the field store does
// not, so the fix is to ask the same question at the same place -- which turns a
// crash into a message and makes this fixture able to hold it. Specialising a
// *field* is a different and larger thing: a field has no call site to read a
// concrete type from, which is the quarter of this construct that needs an
// interface to have a representation of its own.

interface Named {
  name: string;
}

class Thing {
  id: number;
  name: string;

  constructor(n: number) {
    this.id = n;
    this.name = "thing";
  }
}

function readName(v: Named): number {
  return v.name.length;
}

/** Control: the concrete type is at the call, so this is specialised. Lowers. */
export function atACall(n: number): number {
  return readName(new Thing(n)) + n * 0;
}

/** Under test: an array of the interface type. Refused by name. */
export function inAnArray(n: number): number {
  const xs: Named[] = [new Thing(n)];
  return readName(xs[0]!);
}

/**
 * **Under test and unguarded: this lowers and segfaults.** See the header. It is
 * here so the construct is written down beside the one that refuses, not because
 * this file can assert what it does.
 */
class Holder {
  held: Named;

  constructor(n: number) {
    this.held = new Thing(n);
  }
}

export function storedInAField(n: number): number {
  return readName(new Holder(n).held);
}
