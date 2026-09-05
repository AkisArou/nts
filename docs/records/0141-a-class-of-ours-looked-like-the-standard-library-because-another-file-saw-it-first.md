# A class of ours looked like the standard library because another file saw it first

Two categories accounted for a sixth of every refusal in `runtime/node`:

    a base `X` of unrepresentable type          187
    a member of `X`, a class this compiler
      has no type for                           129

Both were one bug, and it is nine lines from the feature work that found it.

## Following it down

`Duplex extends Readable extends Stream`, so 127 of the 187 bases were `Duplex`
and 35 more were `Readable`. `Readable`'s own type came back
`Structured { flags: 1048576 }` — and the first thing I got wrong was reading
that as TypeScript's `TypeFlags.Union`. This frontend has its own numbering, in
which `1 << 20` is **OBJECT**. So: an ordinary object type that was never
decomposed.

Never decomposed is not the same as decomposed and refused, and the walk has
exactly one place it declines:

    if !array_like && !Self::is_ours(snapshot, slot) { continue; }

That is the library boundary, and it is right to exist — a class prototype pulls
the standard library's whole type graph in, measured at 5,773 types from a
180-node file. `is_ours` is one question:

    snapshot.symbols.get(symbol).is_some_and(|d| !d.declarations.is_empty())

**`Readable` had none.** A class declared in `stream/src/readable.ts`, in the
compiled set, looked exactly like something from `lib.d.ts`.

The budget was the obvious suspect and was not it: `per_seed` from 16 to 256
changed the refusal count by zero, which is the sort of thing worth checking
before it becomes the story.

## The cause

Symbols are interned once, and `declaration_index` keeps only the declarations
that are in the file *currently being interned* — correctly, because a `NodeId`
indexes that file's slice of the shared arena. What was missing is that
interning is **first-come-first-served**:

    if let Some(&existing) = interned.get(&response.id) {
        return existing;          // whatever it was recorded with
    }

A symbol first reached from a file that only *mentions* it was recorded with
zero declarations, and the cache handed that empty record back forever — including
when its own file was interned a moment later.

Which symbols go wrong is therefore decided by the order tsgo lists the compiled
files in, which is why it presented as a property of two particular classes
rather than of the mechanism. The trigger in `stream` is a **cycle with a
type-only import**: `readable.ts` imports a value from `from.ts`, so `from.ts` is
the dependency and is interned first, and `from.ts` names `Readable` in a
signature under `import type`.

The fix is to fill them in when the declaring file arrives. It can only go from
empty to filled — two files cannot both hold one symbol's declarations.

## Measured

    profile refusal sites   2118 -> 1886   (distinct site and message)
    profile refusals        10085 -> 9434  (occurrences)

    a base `X` of unrepresentable type     187 -> 7
    a class this compiler has no type for  129 -> 20

The remaining twenty are generic classes — `AsyncLocalStorage<T>`,
`StorageContextEntry<T>`, `AbortableAsyncSource<T>` — whose instantiations are
*inferred* rather than written, which record 0127's machinery does not find. A
handful of categories went up, all of them refusals newly exposed by code that
now gets far enough to reach a later one.

## The ratchet is the profile, and it had none

**I could not build a unit test that fails without the fix**, and I should say
what that cost before saying what replaced it. Three fixtures were written and
all three were vacuous: a two-file import (the declaring file is the dependency,
so it is interned first), a three-file chain chosen so the consumer sorts first
alphabetically (the order is dependency order, not alphabetical), and a cycle
with a type-only import — where the type-only import is *elided* before it can
intern anything, which is precisely why the real one works only because
`from.ts` also uses the name in a signature.

Each looked right, and the mutation survived each. `examples/cross-file-class`
is kept because it is a legitimate multi-file fixture that agrees with node on 87
cases, and it is **not** claimed as this change's ratchet.

What is, is a thing that should have existed already. The project's own standing
order says *"`runtime/node` is the signal, not ledger count"*, and nothing gated
that signal. The `profile` step emitted every module and checked only for
panics, so a change that quietly moved reach backwards by 651 refusals failed
nothing.

It now counts refusals in the same pass and holds a ceiling. Verified the only
way worth verifying:

    with the fix      9434 refusals   green
    without it       10085 refusals   above the ceiling of 9600 -- reach went backwards

A ceiling rather than an exact number, loose enough that ordinary work does not
trip it and tight enough that a large regression does, and it prints which
direction to edit when a feature earns a lower one — the same bargain as the
example floors.

## What this is an instance of

The gate acquired a *second* zero-subject guard on the same day. `benches.sh`
was skipping all fifty cases and exiting green in zero seconds, because the
per-case `tsconfig.json` files it globbed for had been deleted; the `profile`
step's own module loop had the same shape and now fails when it finds nothing.

So three instruments in one day were green while looking at nothing: a benchmark
step with no cases, `-Xverify:all` on a class with no methods, and a symbol
mutation that survived because the map's hash never let equality run. The
pattern is not that the checks were weak. It is that **an empty search and a
successful search produce the same output**, and only one of them is worth
having.
