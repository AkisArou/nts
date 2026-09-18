// `o?.m()` where `o` is a class instance.
//
// The optional call's merge parameter is **erased**, because one arm is
// `undefined`, and lowering types the call erased to match it. A later pass
// then narrows the call to what `m` actually declares -- a `double` -- and
// bridges every reader with a conversion so the merge edge still receives what
// it expects.
//
// That bridge was `Convert`, which is a numeric conversion. An erasure is not
// one, so what came out was
//
//     v22 = (NtsValue)v10;
//     error: used type 'NtsValue' where arithmetic or pointer type is required
//
// from clang, on a program every pass before it called well typed. Wrong for as
// long as that pass has narrowed returns, on an ordinary optional method call.
//
// The neighbours are what make it worth pinning: `o?.b` -- a **field** -- was
// always right, and so was `o?.items?.[0]`. Only a *call* has a declared return
// for the pass to narrow, so only a call reached the bridge.
//
// The two erasure directions are now named rather than folded in with the
// numeric one, and this example drives both: a method returning a number is the
// erase direction, and one returning a string is the same edge with a managed
// payload.

class Held {
  public b: number;
  public items: number[];

  constructor(n: number) {
    this.b = n;
    this.items = [n * 3, n * 5];
  }

  doubled(): number {
    return this.b * 2;
  }

  label(): string {
    return `held(${this.b})`;
  }

  nothing(): void {
    this.b += 0;
  }
}

function held(n: number): Held | undefined {
  return n > 0 ? new Held(n) : undefined;
}

// The shape: a call through an optional link, result folded by `??`.
export function anOptionalMethodCall(n: number): number {
  return held(n)?.doubled() ?? -1;
}

// The same call with the absence tested explicitly rather than folded, so the
// merge is read as a value instead of being consumed by `??`.
export function theResultTestedForAbsence(n: number): number {
  const got = held(n)?.doubled();
  return got === undefined ? -1 : got;
}

// A managed payload over the same edge. The result is bound rather than chained
// into `.length`, because a non-optional link after an optional one is a
// separate gap with its own fixtures, and an arm that refuses measures nothing
// here.
export function anOptionalMethodReturningAString(n: number): number {
  const label = held(n)?.label();
  return label === undefined ? -1 : label.length;
}

// A `void` method, where the merge carries nothing at all.
export function anOptionalMethodReturningVoid(n: number): number {
  const before = held(n);
  before?.nothing();
  return before === undefined ? -1 : before.b;
}

// A field through the same optional link, which was always right -- the arm
// that says this was about the *call* and not about optional access.
export function aFieldThroughTheSameLink(n: number): number {
  return held(n)?.b ?? -1;
}

// An index read off the same link, also always right -- bound first for the
// same reason as the string arm above.
export function anIndexThroughTheSameLink(n: number): number {
  const items = held(n)?.items;
  return items === undefined ? -1 : items[1];
}
