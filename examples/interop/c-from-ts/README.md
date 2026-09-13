# TypeScript calling C

The native counterpart to `java-from-ts`. **Nothing in `src/` compiles yet** —
this directory exists so the target is a file somebody can read rather than a
paragraph, and so the refusals are measured against a real program instead of a
sketch.

Run it and see where it stops:

    nts emit-c examples/interop/c-from-ts --out /tmp/x

## What this is for

`docs/native-interop.md` argues the design. This is the same argument as a
program: the DX we want, written as if it already worked, with a note at each
line saying what happens today.

## The two things that make it different from the JVM lane

**A class file carries types; a C header does not.** `int abs(int)` and
`double abs(double)` are different functions with the same name in the only
sense a linker cares about, and today this compiler emits the second when you
write `declare function abs(v: number): number` — measured, see `docs/
native-interop.md`. So the TypeScript signature has to carry the C ABI, and
`number` cannot.

**Ownership is not in the header either.** `gtk_window_new` hands back a
floating reference; `gtk_widget_get_parent` hands back a borrowed one. Same C
type, opposite obligations, and nothing in `GtkWidget *` distinguishes them.

## What it does today, measured

    nts emit-c examples/interop/c-from-ts --out /tmp/x
    -> exit 1, 39 TypeScript errors

    37  TS2304  Cannot find name ...     (c_int, Owned, Ref, CFn, Ptr, CStr, addrOf)
     2  TS7006  Parameter implicitly has an 'any' type

**It does not reach the compiler at all.** Thirty-seven of thirty-nine are
missing names, so the first thing the RFC's types buy is not a better lowering —
it is the program being *expressible*. There is nothing to refuse yet because
there is nothing the checker will accept.

That is worth knowing before anyone prices the work: "make `c-from-ts` compile"
is a language-surface task first and a lowering task second, and the two have
very different shapes.

## The order these unblock in

Numbered to match `docs/native-interop.md`'s build order, so the two cannot
drift apart:

| # | what | this file's blocked line |
| --- | --- | --- |
| 0 | the scalar types, **branded** `number`s (`c_int` and friends) | `clamped` |
| 1 | `libc.d.ts`, shipped and curated | nothing here directly — it is what every *other* program needs |
| 2 | opaque handles (`Counter`) | `named`, and every other function here |
| 4 | `Owned`/`Ref`, the discharge check, and `using` | `named`, `scoped`, `label` |
| 5 | `CFn` — a real function pointer | `watched` |
| 5 | `Ptr` and `addrOf` over a place | `readOut` |

0 and 2 are independent of the ownership language and are what make a walking
skeleton run. 4 is `ResourceFlow`. 5 is what makes *ordinary* C libraries
reachable rather than only simple ones — GTK is signal-driven, so a binding
without `CFn` is a binding that cannot open a window and respond to it.

Step 3 (the LLVM `declare` path) and step 7 (the generator) do not block a line
here: the first is invisible from the source and the second is what would have
*written* `types/counter.d.ts` instead of me.
