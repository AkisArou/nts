# A static field is storage, and a `unique symbol` is a symbol

    if (isError && events.get(EventEmitter.errorMonitor) !== undefined) {

Refused as "`EventEmitter`, a class used as a value" — the message for a
different construct. Record 0269 separated the three things that message
covered; this is the second, and it turned out to be the one under the largest
item on the axis.

`EventEmitter#emit` reads `EventEmitter.errorMonitor`. Under `emit` sit
`addListener`, `EventEmitter#on`, `net.Server`'s constructor, `http.Server`'s,
and `createServer` — **274 failing test files**. `EventEmitter#on` lowers now.

## A static field is a global

One location for the program, written once when the class is defined — which is
during module evaluation, at a point among the other statements and observable
from any of them. So it is `collect_module_scope`'s machinery keyed on the
property's own symbol: a read resolves as a module-scope `const`'s does, a write
is a global write, and nothing downstream can tell the two apart.

Named `Class.field`, which is what a static *method* is already called, and `.`
is not an identifier character so it cannot collide.

Both the read and the write resolve **before the receiver is lowered**. Lowering
it first is what produced the wrong message: the class name has no value in
either position, and asking for one is asking the wrong question.

A class joins the ordered statement list **only if it has a static field with an
initializer**. Putting every class in gave a file that had no module evaluation
an empty `module#init` — a new exported function in every such program.
`examples/delete` went from eight exports to nine, caught by a test asserting
the count exactly. An assertion on a total is usually the weakest kind and this
is the case it is for.

## `unique symbol` had no representation

`TypeFlagsUniqueESSymbol` is `1 << 14`, and one arrived as
`Structured { flags: 16384 }` — so *every* declaration of one was "of
unrepresentable type", static field and module-scope `const` alike. That is most
of `runtime/node`'s private keys.

The uniqueness is a type-level identity: it is what lets the checker treat
`[kRefed]` as its own member name. The runtime value is an interned symbol like
any other, and the arm above the fix already said so — "a `unique symbol` used
as a **member name** never reaches here" — without the other half of the
sentence being true.

One consequence, checked rather than assumed: `module#init` now interns a symbol
per declaration where before there was none. `compiler/core/tests/symbol_values.rs`
asserted no function makes one, and the assertion is narrowed to exempt
`module#init` — because the claim it guards is that a symbol *member name* costs
what a field costs, which is about the accessor. Verified that `module#init` is
the only function in `examples/symbol-keys` that makes a symbol at all.

## What it moved

    events   902 function(s) -> 926
    http    1524 function(s) -> 1564

and 164 of 164 examples agree with node, 164 of 164 under reference counting,
22 of 22 addons build. The axis had already moved 43 to 45 on the commit before
this one.

`blockers/a-static-field-read` becomes a guard. It was filed the same day it was
cleared, which is short even for this tree — and the reason it was filed at all
is that the Node lane measured the three shapes apart before anyone started, so
the first move was the right one rather than the obvious one.
