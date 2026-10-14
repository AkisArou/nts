// `using x = …`, and why it is refused rather than accepted.
//
// It **was** accepted, and that was worse. Nothing in this compiler had heard
// of `using`: `VariableKind::from_flags` knew `Let = 1` and `Const = 2` and not
// `Using = 1 << 2`, so a plain `using` read as **`var`** and an `await using`
// — which the frontend spells `Const | Using` — read as **`const`**. The
// declaration lowered as an ordinary binding and `[Symbol.dispose]` was never
// called:
//
//     let disposed = 0;
//     class R { [Symbol.dispose]() { disposed = 1; } }
//     function f() { using r = new R(); }
//     f();                    // node: disposed is 1.  this compiler: 0
//
// The program compiled, ran, and silently did nothing at scope exit. That is
// the failure mode this repository keeps naming: a construct that is skipped
// rather than refused cannot be seen by a refusal census, and `nts check`
// reports "agreed on every case" for every program that does not read the
// effect back.
//
// # It was listed as working
//
// `docs/conformance/typescript.md` carried `using` among shapes "probed and
// passing". It passes only if the probe stops at whether the program builds —
// which is exactly the arm that cannot fail, and the reason the first probe
// written for this file reported agreement before a second one asked whether
// `dispose` had run.
//
// # Why refusing and not implementing
//
// Disposal is a scope-exit call in reverse declaration order, on the normal
// path and on a throw, with `await using` awaiting it — real work, and nothing
// in `runtime/node` or the example corpus writes `using` at all. 190 files in
// test262 declare `explicit-resource-management`, and they are better served by
// an honest `unsupported` than by a pass that did not dispose.
//
// # This example compares nothing, deliberately
//
// Every export below is refused, so `nts check` prints `nothing to check`. That
// is the same shape as `dates-unsupported`, `enum-reverse-map-unsupported`,
// `generator-unsupported` and `generic-classes-unsupported`, and the gate
// counts it as `bare` rather than as agreement.

class Resource {
  readonly id: number;

  constructor(id: number) {
    this.id = id;
  }

  [Symbol.dispose](): void {
    // Whatever this does is the point, and it does not run.
  }
}

/** The plain form, which read as `var`. */
export function scoped(n: number): number {
  using held = new Resource(n);
  return held.id;
}

/** Two of them, which the specification disposes in reverse order. */
export function twoOfThem(n: number): number {
  using first = new Resource(n);
  using second = new Resource(n + 1);
  return first.id + second.id;
}
