# 0071 — A handler is a block

0070 argued the decision — explicit cleanup, not DWARF — and sketched a shape:
a `can_throw` fixpoint, a pending slot, a `throw` that sets it and returns.
This is what got built, which is that shape for the case it was written for and
something simpler for the case that turned out to be almost all of them.

## The simplification

A `throw` caught in the *same function* never touches a slot. It is a jump:

    b2:;
        v16 = &v16_frame;                                  // the Error, in the frame
        v21 = nts_value_of_reference(v16, NTS_TAG_OBJECT);  // erased
        v19 = v21; v20 = v2;                               // the handler's parameters
        goto b1;

`b1` is the `catch`. It takes the thrown value as a block parameter, and the
edge carries it like any other block argument.

That this works at all is 0070's argument arriving somewhere it did not expect.
The reason DWARF is unnecessary is that `own` already knows what a frame holds
and `rc` already emits the releases an edge implies — but if that is true, a
handler edge does not need *new* cleanup machinery, it needs to be an edge, and
then every pass in the compiler handles it without being told. Not one line of
`rc`, `escape`, `liveness` or `dce` was needed to make this work, and nothing
was added to `Terminator`, which has 304 match sites across 27 files. `own`
changed twice, but for neither of them was the feature broken without it — both
are in "Two things the memory suite found" below, and both are about making it
*cost* nothing rather than about making it work.

## What `catch (e)` being `unknown` buys

One representation. `throw "text"`, `throw 7`, `throw new Error(m)` and
`throw new MyError()` all erase to an `NtsValue`, because the language says the
handler receives one static type and that type is `unknown`. So there is no
union to build, no tag to invent, and `typeof e === "string"` is what an erased
value already supports:

    v21 = nts_value_tag(v19);
    v24 = v21 == 3;

One integer compare. The feature rides on erasure rather than beside it.

## The stale reduction, which a `catch` made observable

`lower_throw` reduced `new Error(m)` to `m` and threw the string. Its comment
said `Error` "is not one this compiler can construct — it is `lib.d.ts`'s". It
is `hir::builtin`'s, and has been since the four error classes landed; 0070
opened with the same false premise and was corrected in place.

Nothing could observe the difference while an uncaught throw was the only
outcome, since both spellings print the message and stop. A `catch` binding
observes it immediately, and `catch (e) { return e }` would have returned a
string where node returns an `Error`. It is a regression test now.

## Why the handler's parameters cannot be decided first

Every `throw` in a body is one edge in, and they need not agree about anything.
`edgesDisagree` assigns `seen` between its two `throw`s:

    handler parameters: [thrown, seen]

`seen` gets one because the edges disagree about it; nothing else in scope does,
so nothing else gets one. That is decided *after* the body is lowered — the
handler block is created empty, each `throw` records the bindings it had, and
every edge's terminator is patched once the parameter list exists.

The block is created lazily, by the first `throw` rather than by the `try`.
Creating it eagerly left a block with no predecessors behind every defensive
`try` around code that cannot throw, and the verifier rejects those: `invalid
HIR: Unreachable { func: "neverThrows", block: BlockId(1) }`. `neverThrows` is
in the example because of it.

## Two things the memory suite found

Neither is about exceptions. Both were found by writing a case for one.

**`costs_nothing` and `counted_here` disagreed about three constants.** A frame
object has no destructor, so `rc` emits by hand the walk that gives its fields
back. That walk skips a slot proven *inert* — one that only ever holds a null or
another frame object. It did not skip a slot holding a **string literal**,
though the pass that decides whether a value needs counting at all had answered
`false` for a literal all along. Two lists, one question, three cases apart.
`constant-field` measures it: a load, a call and a branch an iteration, to read
an immortal word and return. 9 operations to 0.

**An `erase` was counted unconditionally.** Erasing takes no reference of its
own — an erased value is exactly what it wraps, seen through a tag — so it costs
what the wrapped value costs. It fell through to `true`, so a thrown frame
object was retained on the edge into the handler and released on both ways out
of it. `throw-and-catch` measures it, and reads 0 operations and 0 allocations:
a `throw` caught in the same function allocates nothing and counts nothing.

## What it costs

    case              C++      nts C   nts LLVM    nts f64       node        bun
    exceptions   20.08 us   33.41 us   33.41 us   71.91 us   14.21 ms    2.30 ms

Against node, 425×. Against bun, 69×. Those numbers are large because a JS
engine's `throw` allocates an `Error` and captures a stack trace, and this one
is a branch and a struct in the frame.

The C++ column is deliberately *not* a C++ `throw`, which would walk unwind
tables and lose by orders of magnitude. It is the branch the exception should
compile to, because that is the harder question and the only interesting one.
1.66× says a `throw` still costs more than its branch — the erasure and the
frame object's two field stores — and that is the honest gap on this row.

## `finally`, which is the same stack with a second kind of entry

A `catch` *stops* a `throw`. A `finally` is *run through* by everything: a
`return`, a `break`, a `continue`, and a `throw` on its way somewhere else. So
there is one stack of exits with two kinds of entry, and each way out walks it
differently — a `throw` runs the `finally`s above the nearest `catch` and stops
there, a `return` runs every one of them, a `break` runs the ones inside its
loop.

The body is **duplicated**, once per way out. `loopThroughFinally` leaves its
`try` three ways and has three copies. The alternative is one shared copy with a
variable saying where to continue and a switch on that variable at the bottom,
which is a branch per exit and a value carried to feed it — for a block that is
usually one statement. Duplication is also the only version that composes with
`return`, which has to run the body and then *leave*, rather than come back.

Three details fell out of writing it rather than out of designing it. A
`finally` is taken off the exit stack while it is being lowered, because a
`throw` inside one belongs to whatever encloses the `try` and not to the `try`
whose `finally` it is — without that it finds its own `catch` and jumps back
into it. A `finally` that returns or throws *replaces* the completion that was
leaving: `try { return 5 } finally { return 99 }` returns 99, which falls out
for free, because the body terminates the block itself and the `return` that
called for it is then simply never emitted.

The third is that "every pending `finally`" is wrong for one `return` in the
language. An array method compiled as a loop puts the callback's body inside the
caller, and a `return` there means "this element is done" — so it leaves the
`try`s written *inside the callback* and not one the `forEach` itself sits in,
which is not being left at all. The floor for that walk is the callback's own
synthesized loop, which already records how deep the exit stack was when it
began, so it needed no new state — only noticing that the two kinds of `return`
have different floors.

Why it was worth doing now rather than later: `runtime/node` — the code this
compiler exists to compile — has **31 `finally` blocks against 49 `catch`
clauses**. It is not a corner.

## What is next

A `throw` that crosses a **call**. That is the other half, and it is where
0070's pending slot belongs. The slot was written for this commit and taken back
out of it: no pass emits it yet, and a runtime entry point nothing calls is
scaffolding.

The design is unchanged, and its static half is the same as ever — the lowering
inserts a check after every call inside a `try`, conservatively, because it is
the only place that knows the bindings a handler edge must carry, and the
`can_throw` fixpoint's job is then to *delete* the checks whose callee cannot
throw. A program with no `throw` in it loses every one.

One thing this commit did *not* reach, named so it is not lost: a frame object
with reference fields is still counted even when every one of those fields is
inert, because `counted` is asked in sixteen places and some of them run while
the map that knows about inertness is still being built. `throw new Error(m)`
caught locally therefore costs two reference operations per throw, where the
argument says zero. Threading the sharp answer everywhere is a change to
`own`'s whole surface; an attempt that changed only `rc` made it *worse*,
because `own::owned` kept the conservative answer and the two disagreed — one
site retained what another released.
