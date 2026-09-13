# C calling TypeScript

The native counterpart to `ts-from-java`, and like that one it **works today**.
`./build.sh` compiles this TypeScript to C, links a plain C program against it,
and runs it:

    add(2, 3)        = 5
    clamp(42, 0, 10) = 10

No node, no napi, no runtime initialisation. A scalar export is an ordinary C
function — `double add(double, double)` — and a C program calls it the way it
calls anything else.

## Why this direction is the easy one

The same reason `ts-from-java` is: **the output is already the host's native
form.** Our C backend emits C, so there is no boundary to cross — the "interop"
is a function call. Compare `c-from-ts` next door, which does not compile,
because *calling out* needs the callee's ABI and ownership expressed in
TypeScript and neither exists yet.

That asymmetry is worth stating plainly, because it is easy to read "interop
works" off this directory and conclude the native lane is further along than it
is. It is not one capability with two directions. It is two capabilities, and
only this one is free.

## What it prints

    add(2, 3)         = 5
    clamp(42, 0, 10)  = 10
    bool_(false)      = 1
    greetLength(7)    = 4
    later: state before checkpoint = 0
    later: state after  checkpoint = 1
    later: value                   = 42

Every line is one row of `docs/native-interop.md`'s "awkward spots". The exports
that cannot be called from C are in `src/main.ts` with the reason, and
`native/caller.c` says at each omission what is missing rather than leaving a
silence.

## The six spots, and where each one is in this directory

| # | spot | where to look |
| --- | --- | --- |
| 1 | names mangled on collision, invisibly | `export function bool` → `bool bool_(bool)`; `caller.c` hand-writes every prototype because no header is generated |
| 2 | an anonymous object type's C name is a whole-program fact | `sumOf` vs `sumOfNamed` — see below |
| 3 | C can receive a managed value, not make one | `greet` is uncallable from C; `greetLength` is the shape that works |
| 4 | a generator hands back its frame | `counted` is uncallable: no exported `next` |
| 5 | a promise needs a checkpoint | the three `later:` lines above |
| 6 | a class is a real struct — the good news | `makePoint` → `NtsObj_Point *`, with `_Static_assert`ed offsets |

### Spot 2 is worse than "generated names", measured

The emitted C name for an anonymous object type depends on **the rest of the
program**:

| program | emitted C name |
| --- | --- |
| the anonymous type alone | `NtsObj_Type3` |
| plus an **unused** named type of the same shape | `NtsObj_Type5` |
| plus a **used** named type of the same shape | `NtsObj_Pair` |

Layouts merge structurally, so an anonymous type borrows a named one's name —
but only if that named type is used somewhere, because an unused type never gets
a layout to merge into. And the `TypeN` number moves when unrelated declarations
are added above it.

So a header exporting the *internal* name would change under edits touching
nothing nearby. The fix is the generated header itself — it exports a stable
alias derived from the export, and the churn stays inside:

    typedef struct NtsObj_Type3 sumOf_o_t;   /* regenerated every build */
    double sumOf(sumOf_o_t *o);

`sumOf` and `sumOfNamed` are here to *show the measurement* — that structural
merging makes the internal name a whole-program fact — not to recommend writing
the second. Anonymous object types are fine to export; an earlier draft proposed
refusing them, which was a restriction paying for an implementation detail.

## The three gaps this example exists to name

**1. No header is generated for a program's own exports.** `emit-c` writes
`program.c`, `nts_runtime.c` and the runtime's own headers — nothing that
declares `add`. `native/caller.c` hand-writes its prototypes, and a hand-written
prototype that disagrees with the emitted one is the `double abs(double)` bug
from `docs/native-interop.md` pointed the other way. A generated `program.h` is
the fix and it is small.

**2. A C caller can receive a managed value but cannot easily make one.**
`greet(name: string): string` compiles to
`NtsString *greet(NtsString *)`, and C can hold that pointer — but there is no
public constructor to build one. The emitted code makes literals as a
compile-time `static const struct { NtsHeader header; unsigned char data[N]; }`,
which a caller cannot reasonably reproduce. So today the usable surface from C
is **scalars in, scalars out**, which is why `caller.c` stops there.

**3. The link line has one non-obvious rule.** `quickjs/*.c` must *not* be
compiled separately: `nts_runtime.c` already includes them, and doing both gives
`multiple definition of js_dtoa` and forty more. `build.sh` carries the working
command so nobody rediscovers it.

## What would make this good

A generated `program.h`, and a small C-facing API for constructing the managed
types a signature can mention. Both are bounded, neither needs the RFC, and
together they turn "a C program can call a scalar function" into "a C program
can use this as a library".

Worth doing before the harder direction, on the same reasoning the JVM lane
arrived at: the direction that already works is where the DX lessons are cheap.
