# The library reading was unreachable code

    let standalone = args.any(|a| a == "--main") || !entry.is_empty();

`named_entry()` returns `vec![MODULE_INIT]` when nothing is named — module
evaluation is a root in the same sense a named entry is, and that default is
correct. So `!entry.is_empty()` **is never false**, `standalone` is always true,
and the `else` branch below it has never run.

    export function addTwo(n: number): number { return n + 2; }

    emit-jvm --text    class nts/gen/Program
                         <init>()V              and nothing else
    emit-c             addTwo, twice

Same file, same tsconfig, same run. Every `emit-jvm` without `--main` compiled
as an executable — `Roots::Entry(["module#init"])` — so an exported function
nothing calls internally was pruned before any backend saw it.

`emit_c` was never affected: it has the same decision written out separately and
correctly, asking only for `--main`. So the defect was confined to the two
callers of `emit_options`, and the duplication is what hid it — the correct copy
is thirty lines away and reads the same at a glance.

The fix asks the arguments rather than a synthesized default. `--main` says the
product is an executable; `--entry` names its roots; a default nobody wrote is
not a claim about either.

## The comment above it already described the cost

That function carries a long doc comment about exactly this axis: a root is a
wall, so its parameters stay as wide as their declared types, and the JVM lane
found that by emitting one case both ways and noticing the descriptors differed.
The comment is about getting the reading right. The line under it made one
reading unreachable.

**A condition that cannot be false is not caught by any test that exercises
it.** Everything `emit-jvm` produced was self-consistent; it was consistently
the wrong reading.

## What it cost, measured by the lane it cost

The JVM lane's `dexes.sh` passes no `--entry`, so under the bug it was dexing a
skeleton:

    case              as shipped   under the bug
    fib                        6               4
    checksum                   6               4
    array-methods              6               4
    symbol-keys                7               4
    node-utf8                 11               4

Four members every time -- constructor, `seed`, `<clinit>`, `module$init` --
across 211 cases, reporting `0 refused` on each. With the fix: **228 dexed, 0
refused**, across every export of every example and bench case.

They reproduced the old reading with `--main` to get that table rather than
infer it, which is the reason it is a measurement and not a story.

**It is the failure that step was added to prevent, wearing its own uniform.**
The argument for adding it was that the existing `d8_accepts_the_runtime_jar`
check only ever sees hand-written Java and therefore cannot fail; the new one
only ever saw a skeleton. Its own header says "an instrument that cannot fail
reads exactly like one that keeps passing", written the same day about a
different instrument.

Their ART measurements are unaffected -- `agrees-on-device.sh` and
`bytes-on-device.sh` pass `--entry` explicitly -- so the allocation survey, the
59-of-60 agreement sweep and all three ART fixes stand. The `__@kCount@2` defect
that motivated the ratchet was found by the agreement sweep on a real program.
**The ratchet was hollow and the finding was not**, and those are worth keeping
apart.

## Found while tracing something else

The chain was `http.createServer` -> `Server@server#constructor` ->
`Server#constructor` -> `EventEmitter#on` -> `addListener`, and the tracing
turned up two instrument facts worth more than the fix.

**`nts hir` does not run the NTS1003 cascade.** It shows raw lowering — "what
maps onto the source" — and `--prepared` shows what a backend receives. I read
`export func Server@server#constructor` out of a plain dump and concluded the
274-file root had cleared. It had not: the emit path drops it because a callee
was refused, and `--prepared` reports 892 NTS1003 where the default reports
none.

That is documented behaviour and reading past it produced a confident wrong
claim, which I had already sent to another lane before checking. **A dump of
"what was lowered" is not an answer to "what will be emitted"**, and the two
differ by every cascade in the program.

**`emit-c --napi` and `nts hir` disagreeing was the tell.** One said the
constructor lowered and the other said `no wrapper for createServer: no function
of that name was compiled`. Both were right about different programs. The
instinct to trust the one that agreed with me is what cost the hour.

## What the class-as-value change actually bought

`Server@server#constructor` moved from being a **root** refusal — the Node lane
measured it as the single NTS1001 in its range — to being an NTS1003 subject.
The class-as-a-value refusal is gone and the `super()` chain underneath it is
what remains. That is progress that moves no count, and saying so plainly is
better than the alternative: the 274 files do not move yet, and the next root
down is `addListener`, which gates `EventEmitter#on` and therefore every emitter
in the corpus.
