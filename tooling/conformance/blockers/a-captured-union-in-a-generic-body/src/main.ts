// expect: NTS1001 a captured variable of unrepresentable type (a union of a function type | the type parameter `S`)
//
// **The expectation is the printed `S`.** `united<f64>` has a copy — the message
// names it in the cascade — so the enclosing generic *is* instantiated and the
// substitution for `S` exists. The capture's type is nevertheless read at the
// declaration, which is why the sentence prints the type parameter rather than
// the `(() => number) | number` this copy pins it to. A capture whose type were
// genuinely unrepresentable would print that type.
//
// And the discriminator is in the file: `capturePlain` **compiles**. A closure
// capturing a plainly `S`-typed variable in the same position gets the copy's
// substitution and lowers, so this is not "closures in generic bodies do not see
// the copy" — something narrower than that is true, and the union is what
// crosses it. Two arms differing in one thing, which is the only way to tell.
//
// Found on 2026-09-25 while measuring the function-copy expansion, and confirmed
// identical on the binary before it (7fe682c1) — so it is a gap this compiler
// already had rather than one that change published. It is the same family
// though: `lower_wanted_closures` builds a closure's `Copy` from
// `Shared::class_copies`, which does hold a generic *function*'s copies, and
// `examples/a-generic-pinned-through-two-unions` is the case that made those
// copies worth having.
//
// The shape matters because it is React's: every hook takes `(() => S) | S` and
// every hook body closes over its argument.

function render(component: () => number): number {
  return component();
}

/** **Control.** A plain type parameter captured the same way, which compiles. */
function plain<S>(value: S): number {
  function again(): number {
    const held: S = value;
    return typeof held === "number" ? 1 : 2;
  }
  return render(again);
}

/** The subject: the captured type is a union mentioning `S`. */
function united<S>(value: (() => S) | S): number {
  function again(): number {
    return typeof value === "function" ? 1 : 2;
  }
  return render(again);
}

export function capturePlain(start: number): number {
  return plain(start);
}

export function captureUnion(start: number): number {
  return united(start);
}
