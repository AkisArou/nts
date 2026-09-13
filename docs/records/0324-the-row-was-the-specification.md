# The row was the specification

> ✗ `sym.description` and `sym.toString()` as member reads — `nts_symbol_description`
> and `nts_symbol_to_string` exist and are tested, and nothing lowers a member
> access to them yet

Every clause of that was true, and together they are the whole of the work. Both
helpers were in `runtime/c`, in `hir::runtime`'s table and in LLVM's signatures
already. The feature is two arms in the lowering and **no runtime surface at
all** — nothing to add to a table three backends read, nothing to regenerate, no
lane to hold a commit for while it catches up.

That shape is rare enough here to be worth naming. Most of what this ledger
calls a gap is a representation question; this one was a wire that had not been
run, and the row said so a version of the compiler ago.

## Why the whole row was cheap and finding it was not

It was the *eighth* ✗ row probed in a sweep, and the sweep is the method. Of the
rows checked against the live compiler in one session:

```text
in over object, native key      landed already, example in the tree   [[0323]]
errors group, three classes     landed already                        [[0321]]
inferred generic instantiation  works; its cited sites are another row's [[0320]]
ToBigInt                        landed except from a string
a computed member name          landed for a Record, refused for a declared type
nested optional literal         refuses, and does not segfault as claimed
sym.description / toString      genuinely absent, and cheap
exported-but-uninstantiated     genuinely absent, and clears nothing
```

Two of eight were worth building. One was worth building and wasn't
(the last row clears nothing — measured, not assumed). The other five were
already true, or true in a narrower form than the row states.

**A sweep that only builds is a sweep that builds the wrong thing.** The reading
part is not overhead in front of the work; on this sample it *was* the work,
because five rows moved without a line of compiler code.

## The arm that earns the example

`String(sym)` lowered before this change and `sym.toString()` did not. They
reach one helper, so `sameAsConversion` asks the two spellings for the same
answer:

```ts
const viaMethod = tagged.toString();
const viaConversion = String(tagged);
return viaMethod === viaConversion ? (n & 7) + 1 : 0;
```

Without it every arm returns a small number that a wrong wiring could also
produce. With it, a member arm pointed at the wrong helper is a disagreement
between two spellings of one operation rather than a plausible length.

That is the same shape as `deferredOne` in the loop-capture example ([[0318]])
and as the three array lengths in `aggregated` ([[0322]]): pick the arm where
the two candidate implementations **differ**, not the arm that exercises the
feature most directly.

## A smaller thing, twice in one session

`member_of` and `lower_method_call` both went over the hundred-line lint the
moment a six-line branch was added, and both were already within a few lines of
it. The fix each time was to extract a helper — and `member_of` now dispatches
four natively-represented receivers (`Map`/`Set`, symbol, view, object) that had
been written four different ways.

Worth noting because the lint did the useful thing for a reason unrelated to
line count: a function accumulating one more special case per feature is exactly
what should be pushed back on, and the only instrument watching for it counts
lines.
