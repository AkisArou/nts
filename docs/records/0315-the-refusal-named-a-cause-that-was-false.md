# The refusal named a cause that was false

`TypeError(m)` — a provided class **called** rather than constructed — refused
with:

```text
NTS1001 `TypeError`, a builtin this compiler does not provide
```

`TypeError` is the second entry of `hir::builtin::ERRORS`. The compiler provides
it, constructs it, and `new TypeError(m).message` compiles and runs. The sentence
is false, and it is false in the expensive direction: it sends its reader to
`hir::builtin` to add a class that is already there.

## The arm had already been split once

The code above it says so:

```rust
// Two different failures wore one sentence. A name the checker
// resolved to no declaration is either a builtin this compiler has
// not implemented, or a name from a package whose implementation is
// not in this program [...] Reporting it as a missing builtin sends
// its reader to `hir::builtin`, where nothing is missing.
```

Somebody found that exact failure, wrote that exact sentence, split the arm — and
the third case walked into the remaining `else` and wore the message anyway. The
comment now reads `Three different failures`, which is the honest state and
probably not the last one.

**A diagnostic's default arm accumulates.** Splitting it once does not make it a
cause; it makes it a slightly smaller catch-all. The `else` of a message that
names a cause is a place new causes arrive silently, because nothing fails when
one does — the program still refuses, the refusal still prints, and only a reader
who knows the subject can tell the sentence is wrong.

## How it was found, which is the part worth keeping

Not from a report. From working the ledger row for **calling a class value**,
whose whole content was `nothing in the profile asks for one`.

The row was right. Measured rather than quoted: 239 lines of `runtime/node` name
a provided error class as a callee and **every one of them writes `new`**, so the
demand is zero. Both directions of the instrument were checked — a synthetic
control fires, and the 239-to-0 drop across the `new` exclusion is what shows the
pattern ran on real data rather than matching nothing.

So the row was confirmed and nothing was built. **The finding was in the probe
written to confirm it.** This is now the second row in two days where that
happened — [[0314]] found a wrong answer that runs in a cell that was empty, and
this found a false sentence in a cell that was correct. The common part is not
"empty cells hide things": it is that **writing the smallest program that
exercises a row shows you the row's neighbourhood**, and the neighbourhood is
where the defects are. A row confirmed by reading is confirmed about its claim.
A row confirmed by running is confirmed about its claim *and* tells you what
happens next to it.

## Why the fix is a name list and not a question

The new arm tests `PROVIDED_ERROR_NAMES` rather than asking whether the callee is
a class, and that reads like a shortcut. It is the whole of it:

```text
class Declared { ... }
Declared(n)   TS2348  Value of type 'typeof Declared' is not callable.
                      Did you mean to include 'new'?
```

Measured, not assumed. A class the program declares never becomes a lowering
question, so only a class declared in `lib.d.ts` can reach that arm, and the list
*is* the set of those this compiler provides. A broader test would be a wider
net over water with nothing in it.

## What the fix does not do

It changes a sentence. Calling a class value still refuses, still has zero corpus
demand, and still wants the same machinery as `new` through a class value — a
token carrying an instance descriptor and a constructor. With no site asking for
either, they are one feature and neither is worth building alone.
`blockers/a-provided-class-called-without-new` holds it with two controls: the
same class **with** `new`, which compiles, and the call bound to a name first.

## A second thing, from the same hour

The build that was supposed to carry this fix reported success and had not run:

```text
cargo build --release -p nts  |  tail -5     →  exit 0
error: package ID specification `nts` did not match any packages
```

`nts` is a *binary* in `nts-cli`, not a package. The pipe made the status
`tail`'s, and the background runner reported `exit code 0` in good faith. It was
caught in one step because the probe printed the **old** message — the artefact
disagreed with the claim — and `strings target/release/nts` found the new text
absent, and the binary's mtime was 38 minutes stale.

That is [[0296]]'s sentence one layer out: the source of a pass is not its
output, and **the exit status of a pipeline is not the exit status of the thing
you care about**. Run the gate's own command (`cargo build --release`, no `-p`)
rather than one that resembles it, redirect rather than pipe when the status is
the answer, and check the artefact's timestamp before believing a rebuild
happened.
