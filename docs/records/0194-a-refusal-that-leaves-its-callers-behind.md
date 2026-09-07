# 0194 — A refusal that leaves its callers behind

`drop_callers_of_refused` runs before any backend sees the program. Its comment
says why it has to exist:

> Before anything looks at the program: a function that calls a refused one has
> a call to nothing in it.

It cannot see a refusal made *after* it. The C backend makes those — it emits
each function speculatively, keeps the ones that succeeded, and pushes a
diagnostic for the rest — and it kept every call to the ones it dropped.

The output is a translation unit that calls a symbol nothing defines. node's
`punycode` is the smallest case: `error(type: ErrorType): never` was refused,
and its **eight call sites were emitted anyway**.

The phrasing the Node session used is the right one and worth keeping: *a
refusal that leaves its callers behind is not a refusal, it is a link error
with a diagnostic attached.* And the only reason it is a link error rather than
something worse is that C wants a definition at link time. A lane that resolves
lazily, or a call on a path nothing takes, and the same defect ships quietly.

## Two fixes, and only one of them is the bug

**The bug** is that the backend does not drop callers. It does now, to a fixed
point — `caller` goes because it calls `refused`, `outer` goes because it calls
`caller` — with an `NTS2009` naming each. Direct calls only; a dropped function
that a dispatch table names is still a dangling symbol, unchanged and rare,
because `emit_object_descriptors` reads the program's layouts rather than the
emitted bodies and a null slot is worse than a link error.

**The refusal itself was also wrong**, and that is separate. `c_type` refuses
`HirType::Never` in these words:

> `never` reaching a value position means control got somewhere the type system
> said it could not.

True of a value. A function's *return* type of `never` is not a value position:
it says the function does not return, which is an ordinary thing for a function
to say and which C spells `void`. One message was answering two questions, and
the shorter answer was wrong for one of them.

Not `_Noreturn void`. The attribute would be true, and it would license clang to
delete code after a call — code this backend has already decided is unreachable.
It buys nothing and adds a second place that has to stay right about it.

## Fixing the refusal makes the module compile; fixing the bug makes it refuse

Worth stating together, because in isolation each reads like the wrong outcome.

With only the caller-drop, `punycode` gets *worse* by the measure anyone would
reach for: two clang errors become five refusals, as `error` takes `decode` and
`encode`, which take `mapDomain`, which takes `toUnicode` and `toASCII` — the
module's entire public surface. That is the honest state of a compiler that
cannot emit `error`, and the clang errors were hiding it behind a number that
looked like two small problems.

With both, `punycode.node` publishes `decode`, `encode`, `toASCII` and
`toUnicode` — its whole public surface, and the first module in the profile to
publish all of it.

So the sabotage for the caller-drop is the *other* fix removed, and it is the
only configuration in which the bug is visible at all. Five `NTS2009`s where
there were two silent clang errors, and the emitted C is then clean:
`clang -fsyntax-only` accepts it and there is not one `error(` left in it.

## What to take

A pass that enforces an invariant enforces it at the point it runs. This one is
named for the invariant — every call has a callee — and reads like a property of
the program, so nothing prompted anyone to ask what happens to a refusal made
later. Two stages can refuse, and only one of them cleaned up.

The general form: when a second stage gains the power to reject, it inherits
every obligation the first one discharged. Nothing announces that, and the
inherited obligations are invisible precisely because the first stage is
handling them correctly.
