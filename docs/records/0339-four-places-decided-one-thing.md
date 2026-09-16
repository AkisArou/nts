# Four places decided which helper a rejection takes, and two were wrong

`nts_promise_reject(NtsPromise *, NtsHeader *)` takes a reference. An **erased**
reason is an `NtsValue` — sixteen bytes, tagged — and passing one emits

    error: operand of type 'NtsValue' (aka 'struct NtsValue') where arithmetic
    or pointer type is required
        nts_promise_reject(v13, (NtsHeader *)v1);

`emit-c` exits zero over that, because a refusal and a successful emission are
told apart by diagnostics rather than by status, and this is neither: it is C the
compiler believes in and clang does not.

## It was already shipping

Measured on the **pinned `072a53e7` binary**, the one the green gate ran, with no
`Promise.withResolvers` anywhere in the program:

```ts
export function viaStatic(reason: unknown): Promise<number> {
  return Promise.reject(reason) as Promise<number>;
}
export function viaExecutor(reason: unknown): Promise<number> {
  return new Promise<number>((_resolve, reject) => { reject(reason); });
}
```

Two exports, two errors, two independent paths into the same mistake.

## Why nothing caught it

Four places in `lower.rs` decided which helper a rejection takes:

```text
  throw, inside an async function     Erased -> reject_value    correct
  a `new Promise` executor's reject   Erased -> reject          wrong
  Promise.reject                      Erased -> reject          wrong
  Promise.withResolvers (new)         no check at all           wrong
```

The first knew. Its comment even says why — *"the runtime reads the reference out
of the tag rather than this guessing a type for it"* — and `nts_promise_reject_value`
has existed for exactly this since. Two others listed `Erased` as an acceptable
reason and then emitted the helper that cannot take one: the guard was there, and
it guarded the wrong half.

**The corpus could not reach either.** Every erased rejection reason in
`runtime/node` lives in `web-platform`'s streams, and those were refused earlier
for an unrelated reason — `Promise.withResolvers` in a field initialiser. So the
defect sat *behind* a refusal, and was published the moment that refusal cleared:
`addons.sh` went from `24 of 24` to `12 of 24 still build, 12 regressed`, and the
first three lines under each module named `new Set`, `Uint8Array.of` and
`Object.getPrototypeOf` — the next blockers, not the cause. The cause was eleven
clang errors further down, in a module that does not write `withResolvers` at all.

## What it cost, before it cost anything

[[0337]] reverted a correct representation on the strength of this regression,
and concluded that promise capabilities need synthetic closures before they can
be represented at all. They do not. That conclusion stood for three days and was
quoted between two sessions as settled.

A latent defect in a path that nothing reaches is not free. Its price is paid by
**the next change that reaches it**, which is charged for a bug it did not write
and has no reason to look for — and the obvious reading of a regression is that
the change causing it is wrong.

## What to take

**Count the places that decide one thing.** Not "is this decision right here" but
"how many copies of it are there". Four is not a number anyone chose; it is what
a decision becomes when each new caller writes its own. Two copies agreed and two
did not, and the disagreement was invisible because the two wrong ones were
unreachable. They are one function now — `reject_with` — which is the same shape
as `Wrote::published` ceasing to respell what `emit` already knew, on the same
day.

**And when a change regresses something, the cause is not necessarily the change.**
The honest sequence is: control it (it was mine), then find the mechanism (it was
not). Stopping after the first step is what [[0337]] did, and it was right about
the attribution and wrong about the cause.
