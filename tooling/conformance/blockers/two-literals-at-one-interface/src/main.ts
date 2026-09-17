// expect: NTS1001 a second object literal declaring `twice` at one type

// Two object literals assigned to the **same named interface**, each declaring
// its method.
//
// A member's function is named after the type the literal is built at — which
// is deliberate and is what makes a call through the interface find it — so
// both of these are `T2#twice`.
//
// # It used to be invalid HIR, which is the worst way to fail
//
// Until 2026-09-18 the second function was pushed anyway and `verify` reported
// `DuplicateFunction { name: "T2#twice" }`. `emit-c` then printed *refusing to
// emit code from invalid HIR*, wrote nothing, and **exited 0** — and the only
// diagnostic a reader saw was the cascade,
//
//     `f` cannot be compiled because it calls `T2#twice`, which was refused above
//
// with nothing above it, because nothing was. A false sentence and a silently
// unbuilt program. It refuses by name now; this fixture holds that.
//
// # What closing it actually needs
//
// Dispatch. Two literals at one interface are two *implementations* of it, and
// the call site has only the interface — which is what a virtual slot is for,
// and the hierarchy already has them for classes. Each literal would become its
// own class implementing `T2`, and `a.twice()` would dispatch on the receiver.
//
// The **anonymous** case was solved on 2026-09-17 by the opposite move: every
// anonymous object type carrying a member is registered separately, and
// `__object` is declined as a nominal identity, so two anonymous literals each
// get their own name and neither collides. That answer is not available here,
// because `T2` *is* a nominal name and both literals genuinely have it — the
// type is the thing they share.
//
// So it is not "name them apart": it is "one name, two bodies, chosen by the
// receiver", which is dispatch and nothing less.
//
// A `FIXED` here means that landed. `oneLiteral` below is the control that must
// keep working either way — a single literal at a named interface is a static
// call and should stay one.

interface T2 {
  v: number;
  twice(): number;
}

export function oneLiteral(n: number): number {
  const a: T2 = {
    v: n,
    twice(): number {
      return this.v * 2;
    },
  };
  return a.twice();
}

export function twoLiterals(n: number): number {
  const a: T2 = {
    v: n,
    twice(): number {
      return this.v * 2;
    },
  };
  const b: T2 = {
    v: 1,
    twice(): number {
      return this.v * 3;
    },
  };
  return a.twice() * 10 + b.twice();
}
