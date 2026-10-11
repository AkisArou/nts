# Raising interface families need transitive seeds

An interface call in a helper's raising copy needs the same family slot as
an interface call directly guarded by a try. The original collector only
seeded directly guarded calls: the interface declaration has no body, so
walking the named copies could not recover its implementers. A class was
refused; a captured literal could lose exceptions before Part 1c made that
boundary an honest refusal.

Naming now publishes calls from exactly the named and closure raising bodies
the selected gate arm offers. The optimistic arm includes the pending closure
roots; the strict arm includes no closure roots. The existing shared call walker
collects them, and the existing `interface_member_of` family seed consumes them
alongside directly guarded calls. The family-wide carry predicate, slot numbering,
adapter conversion and per-owner fill remain one mechanism. A nonthrowing member
uses its ordinary body in the raising family.

## Evidence

Main's control pin is `394e7548416f`, SHA-256
`a64b4036de701b15e2b1a020eb999a3711e10245b29867ed536cfbe3679ace80`.
The source pin is `9c3964ed37b7`, SHA-256
`ff43d756eb6eec219848fdfcaf615bec4ea38aa18689db1bc3ef10111a406f5d`.
The paired tsgo binary is unchanged from record 0349.

The class and stored-literal witnesses move from blockers to examples.
Both compare 58 of 58 cases on C, LLVM, JVM and C with reference counting,
including nonthrowing controls. The class control passes a mixed Wakeable array
so the calls retain their interface receiver and actually exercise both family
rows. Prepared-HIR tests follow those rows through adapters to the throwing
class's raising body and the quiet class's ordinary body, and follow the literal
forwarder to its uniform raising entry. The strict-gate witness still refuses
its closure call while its named-callee control compiles.

Across 512 examples, every differential lane reports 510 unchanged, two fixed,
zero regressed, changed, unstable or unmeasured. All 139 outcomes retain their
records (67 holds, 72 reproductions). There are 322 expected blockers: the two
promotions and one newly pinned independent boundary. JVM review reports
25,166 of 25,172 runtime classes, no unresolved, unfilled or shadowed methods,
and a byte-identical public API. Its mixed throwing Reader array agrees too.

The 29-module census changes from 51,679 to 51,680 definitions. The added item
is the declaration shell `SearchParamsOwner#currentQuery@raises`, rather than
a new runtime body. The function-state comparison reports no moves.
Normalized refusal occurrences remain 17,020, distinct messages 658, and
source sites 1,535; every refusal text occurs exactly as often on both pins.

Only URL's generated C changes: its query synchronization raising body calls
the raising family and tests the flag before continuing. That family uses URL's
ordinary `currentQuery` body. Total native tables grow from 62,480 to 62,592
bytes; O2 objects grow from 11,702,981 to 11,703,074 bytes. Every runtime module
emits valid C and compiles at O2. All 62 benchmark emissions, translated LTO
objects and linked binaries are byte-identical to the quiet measured binaries
from record 0348, using the harness's actual runtime-before-program link order.
No benchmark runtime/support source or compiler flag changes, so those timings
carry forward. Compiler cost is 8,518 billion instructions across the runtime
against 8,722 recorded (0.98x); every module passes the cost ratchet.

## The next stop remains visible

Both CLI GTK counter products clear the two `then@raises` roots: 138 roots
become 136. They still refuse 769 functions, drop the entry invocation and run
with no output. The entry chain now reaches `resolveLazy<erased>@raises`, whose
`LazyComponent` parameter has no representation. The existing generic-interface
member blocker holds that shape. The counter is still not a working demo.

A concrete source copy of a nonthrowing interface member still names a missing
raising body. The new Quiet blocker directly guards an interface call first,
so its family is already seeded on main; it reproduces the identical missing
`Quiet#then@raises` cause on both pins. Its ordinary-call control agrees in all
29 cases on every backend. The existing rootless-cause diagnostic is recorded
as owned debt and remains queued separately from family seeding.
