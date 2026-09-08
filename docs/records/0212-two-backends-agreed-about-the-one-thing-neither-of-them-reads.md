# Two backends agreed about the one thing neither of them reads

A table of handlers is what shared source is made of, and this compiler could
not read one:

    type Step = (value: number) => number;

    const steps = new Map<string, Step>();
    steps.set("inc", (v) => v + 1);

    export function through(name: string, value: number): number {
      const step = steps.get(name);
      return step === undefined ? -1 : step(value);
    }

`NTS2006 an object type with no layout`, at `steps.get`. The JVM session
reported it against `Map<string, Signature>` and against an array of closures;
the array half already worked, and finding out why led to two defects wearing
one message.

## The first: a container is a type, one level in

A function type is a *signature* rather than a class, so no program ever
constructs one. Its layout comes from `materialize`, which walks the types a
signature mentions and asks for the layouts they need — and it walked
*containers*: an array's element, and a promise's settled value.

A map's key and value and a set's element are the same question. `table.get(name)`
hands back a `Step`; `for (const step of seen)` binds one. Nothing else in the
program says the type exists.

    Array(payload) | Promise(payload) | Set(payload)   one arm, one payload each
    Map(key, value)                                    two, and both are read

`View` carries an element and is deliberately **not** here. Every one comes from
`builtin::typed_array_element` or is refused by `element_kind`, and both answer
only with an `Int` or a `Float`, so an arm for it would be a line that cannot
run. Three of the four cases named in the report; the fourth was named wrongly,
by me, from the shape of the enum rather than from what fills it.

## The second, which the first uncovered

With the walk in, `examples/keyed-closures` compiled on C and on LLVM, agreed
with node on 261 cases through both, and agreed under `NTS_RC=1`. The JVM
refused it:

    NTS4001 a closure call through a slot its type declares nothing for
      (in `fromEmptySet`)

A signature layout is **empty until something implements it**.
`relate_closures_to_signatures` iterates *closures* and declares `Fn…#call` on
the signature each one is a value of — so a signature with no closure anywhere
in the program gets a layout with a hole where its one method belongs. And
`materialize` is exactly what creates those: it gives `Map<string, Weigh>` a
layout for `Weigh` *because a signature mentions it*, which is the case where
nothing constructs one.

C and LLVM were right to compile it. A closure call dispatches through the
receiver's own descriptor —

    v16 = ((double (*)(NtsObj_Fn2_2_2__2 *, double, double, double))
            v14->header.descriptor->methods[0])(v14, v7, v1, v15);

— so the static layout's method table is never read, and a hole in it changes
nothing they emit. The JVM has to name a method and a descriptor at the call
site, reads the static layout, and finds nothing.

**Two backends agreeing is not evidence when the thing they agree about is the
one thing neither of them looks at.** That is the fourth time the checked-cast
backend has seen a type-level lie the pointer backends compiled happily, after
merged function-type layouts, an erased-singleton scan, and an unerase to `{}`.

The repair is `declare_unfilled_signatures`, running straight after the closure
pass: for a signature layout with nothing in the closure slot, synthesise the
abstract declaration — `abstract_declaration = true`, one block, `Unreachable`,
no body.

### The descriptor comes from the call

Not from the checker. `Callee::Closure` already says why — "the signature is
built from the call itself, which knows the argument types and the result type
exactly" — and it is the same principle the two existing declarers apply when
they take a signature from an implementer: a descriptor that has to agree with
something else is *checkable*, and one synthesised from the checker would be a
third opinion nothing else holds.

Where two call sites disagree about a signature's shape, nothing is declared and
the backend's refusal stands. Two calls through one signature that disagree is a
fact worth refusing over, not one to pick a winner in.

The scan is over **live block ops** rather than `func.values`. A `ValueId` is an
index, so a pass that removes a call from the control flow leaves it in the value
list; record 0211 is three readers that each made that mistake, and a declaration
synthesised for a call nothing performs is a function the program does not need.

## Which half moved the number, measured rather than assumed

Two binaries over one corpus, `runtime/node` as it stood. First the container
walk on its own:

    head   19266 NTS1001   7552 NTS1003   253 NTS2006   48 NTS2009   14 NTS2008
    mat    19266 NTS1001   7552 NTS1003   253 NTS2006   48 NTS2009   14 NTS2008

**Identical in every class.** The walk closes five real refusals that
`examples/keyed-closures` reproduces on the old binary, and the node corpus does
not reach the shape at all. Worth writing down, because a change that fixes a
real thing and moves no measured total is exactly where quoting the wrong number
is easiest.

Then the same measurement with the unerase repair as well:

    head   19266 NTS1001   7552 NTS1003   253 NTS2006
    full   19268 NTS1001   7546 NTS1003   237 NTS2006

Sixteen `NTS2006` and six `NTS1003` closed, and `NTS1001` up by two. Counting by
*code* says almost nothing about what happened, and counting by **message** says
all of it — 68 refusals closed and 48 different ones opened:

    -16  an object type with no layout
    -13  an erased value where a concrete representation is wanted
    -12  `null` or `undefined` where what it stands in for is not a reference
    -12  a method `call` with no declaration in the hierarchy
     -6  ... and nine more, one and two at a time

    +32  a property `prototype` of unrepresentable type (any)
    +12  a property `headers` of unrepresentable type
           (a union of `Iterable` | an object | undefined)
     +3  a property `#closeCapability` of unrepresentable type
           (a union of `PromiseWithResolvers` | undefined)
     +1  a property `expression` of unrepresentable type (`RegExp`)

That is the whole value of the repair and it is not the net −20. Asking for a
layout at the unerase means `layout_of` answers, and `layout_of` **names the
field it cannot represent** — so "an object type with no layout" becomes "a
property `prototype` of unrepresentable type (any)", which is §13's metaobject
boundary saying so in its own words, thirty-two times. The other three are a
union representation, twice, and the regular-expression row.

**Refusals rebaselined by underlying feature**, which is what the goal asks for
and what a code-level count cannot show: 68 anonymous refusals became 48 that
name their cause, and a reader can now tell which of them is `∅` and which is
work.

So the split is: the walk closed nothing here and the unerase did all of it. Two
changes in one sitting is how a total gets credited to whichever half is easier
to tell a story about.

### Nothing else changed, and that is the bench row

Emitted C for every example, HEAD against this, byte for byte:

    same 133   differed 1   skipped 1

The one that differs is `keyed-closures`, which did not compile before, and the
one skipped is `examples/invalid`, which is the directory the gate exempts by
name for failing on purpose. So there is no benchmark row for this change and
the reason is measured rather than argued: **no program that already compiled
emits a different instruction.**

### The first run of that measurement said zero

Zero diagnostics from *both* binaries, which reads like the best result
imaginable and was every one of the 22 modules failing at the frontend. The CLI
resolves its frontend as

    std::env::var("NTS_TSGO").unwrap_or_else(|_| "tsgo".to_owned())

— the bare name, through `PATH`, which on this machine is an asdf shim with no
version set. Every gate script exports `NTS_TSGO`, so nothing in the gate ever
sees it; `all.sh` carries a comment about `0 of 128` from the same cause.

`tsgo::locate()` exists precisely to answer this question and was called in one
place. Its own doc says why it was written: "the tests skip silently without a
path, so a suite run with the variable unset is green whatever it would have
found". The same sentence is true of the CLI, and more sharply — a machine with
*some* `tsgo` on `PATH` would not fail at all. It would compile against an
unpinned frontend and be quietly wrong.

Ten sites now go through one, which resolves `NTS_TSGO`, then the repository's
own build, and only then the bare name. The bare name is kept as the last resort
rather than removed: a checkout that has not run the bootstrap, and a `tsgo` a
reader installed themselves, are both real.

## And 199 messages that were not identifiers

The node lane split the 253 by text — 199 `an object type with no layout` and 54
`no declaration for X to take a signature from`, two diagnostics under one code.
The 54 name a method. The 199 carried nothing at all, so every one was
indistinguishable from every other in any output: not groupable, not countable
by cause, and no way to tell one had moved.

They name their type now. The id rather than a name, because this backend holds
a `Program` and a program with no layout for a type has no name for it either —
and `nts types` and `nts layouts` both print the id, so it is the handle that
resolves. Four of the remaining ones in `timers` become one line:

    priority-queue.ts:95:26  an object type with no layout: type 1022

which is `setPosition(childItem, position)` on `PriorityQueue<T extends object>`,
whose field is `((node: T, position: number) => void) | undefined`. A signature
mentioning a type parameter, needing the substitution to represent. A different
question from this one, and now a legible one.

## What it ships with

`examples/keyed-closures`, six exported functions, 261 cases against node on C,
LLVM, JVM and `NTS_RC=1`. Three of its signatures are function types: one with
three arrows, two with none at all.

`compiler/core/tests/unfilled_signatures.rs`, three tests, each broken on purpose
and watched to fail. The first one written asserted `Lowered::is_complete()` and
**passed with the walk removed** — `NTS2006` is raised by the C emitter, not by
the lowering, so a layout resolved where code is generated is invisible to a test
at this stage. It asserts on the layouts now, and the trap is written at the test
rather than left for the next reader.

A third gap, found by a *control* rather than by the feature. The memory case
was written as a module-scope table, so the controls that isolate it were a
local one — and a **local** `Map<string, Step>` still refused:

    layouts, module scope   Fn2__2 [1] / Closure0 base 1 -> Fn2__2
    layouts, local          Closure0, no base, and no Fn2__2 at all

A module global's type is represented and a local's is not, so the signature
acquired a layout at module scope and nowhere else. The repair is at the
`Unerase`, which is where an erased value acquires a class and is the one place
that always needs the layout — the same repair, at the other end of the same
question, as the closure-call path that materialises a call result.

## The memory case is not here, and why

`tooling/memory/cases/keyed-closure-read` was written and measured and is **not
committed**. It reads 10 operations against the 0 argued for it, and the suite
is right to refuse it: a case above its floor is a failure, and adding one would
make a gate step red for three sessions.

The 10 are not this feature's. Two controls, each a two-line program:

    global-numbers   Map<string, number>, global, one read      2 ops
    global-hit       Map<string, Step>,   global, one read      6 ops
    global-array     number[],            global, walked        0 ops   (committed)

A global `number[]` load is borrowed and costs nothing. A global `Map` load
costs two, with no closure anywhere near it, because the map is passed to
`nts_map_get` — an `External` call, whose body no pass reads, so the borrow
ends there. `own::RUNTIME_HANDS_BACK` names the helpers that hand an argument
back; nothing yet names the ones that only *read* one.

So the suite's "every case is at its floor" held because no case read a
container out of a global. `map-and-set` builds both locally. That is a green
claim about what was looked at, and this is what was not.

Named work, with a two-line reproduction, and the case is written and waiting
for it.
