# The addon loaded and died on the first call

A function whose body `codegen/c` refuses keeps its `Func` in the program. So
every question the Node-API pass can ask about it answers yes -- the signature
crosses, it is not a class, it is published -- and it wrote a wrapper naming a
symbol that does not exist.

I expected that to fail at the linker. It does not:

    node: symbol lookup error: …/x.node: undefined symbol: describe

**The addon loads.** Lazy binding does not resolve a symbol until it is used, so
`require` succeeds, the name appears on `exports`, and the process dies on the
first *call* -- not a JavaScript exception, not catchable, at whatever later
moment somebody reaches for it, and nowhere near the compile that caused it.

`loads.sh`, the check written an hour earlier for exactly this class of problem,
would have reported `loads, 2 name(s) published` about it.

## The pass had no way to ask

`Emitted` carried the diagnostics and not the names. "Did this body get emitted"
therefore had no answer available to the wrapper pass, which is why the question
was never asked rather than asked and got wrong.

The C backend now records the functions it dropped -- both paths, `emit_func`
returning an error and a body that calls a binding whose return no C definition
can spell -- and the wrapper declines them:

    no wrapper for describe: its body was refused by the backend,
                             so there is no symbol to call

Which is also the report the Node lane wanted from the other side. A link
failure surfaces as `no addon built`, and that reads as the module being far
away when it is one function's body.

## A guard form for absence

Nothing in `blockers-check.mjs` could assert that a name is *absent* from the
wrapper. `lowers` and `publishes` say what is there; `lacks-c` says what the C
lacks; the addon had only `emits-addon`.

Absence is what this class of correctness looks like, so `lacks-addon X` is the
fourth guard form. Controlled on the day it was written, as the other three
were: pointed at `nts_napi_passthrough`, which the same fixture's addon does
contain, it reports `REGRESSED  the wrapper names it now`.

## What made it findable

Nothing in the corpus. All 22 node modules build and load, so the profile never
produced one -- the construct that draws `NTS2006 an object type with no layout`
is `value === undefined` on an `unknown`, and `unknown` could not cross the
boundary until an hour ago.

It appeared in a *probe*: a four-line scratch file written to check that the
erased crossing worked, whose second function happened to draw a backend
refusal. The probe was not testing this and could not have been -- the thing it
found had been impossible until the change the probe was checking.

That is the third defect this week whose first appearance was in the commit that
made it reachable. `0229`'s missing contextual type was harmless for every
object-typed field there has ever been until a field could be a table. This one
was unreachable until a refused body could also be a *publishable* one.
