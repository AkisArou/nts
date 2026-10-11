# Interfaces satisfied by shape

*Decided 2026-10-10: all three choices below as recommended. Being built in the plan's order.*

## In one paragraph

TypeScript is structurally typed: a class satisfies `interface S { go(): number }`
by *having* a `go`, and `implements S` is optional. nts dispatches **by name of
the declaration**: a call through `S` works only for classes that wrote
`implements S`, and a field read through `S` assumes the object is laid out the
way `S` is. Two consequences, one of them a wrong answer:

1. **Methods** — a call through an interface no class declares it implements is
   refused. It is the fourth-largest refusal in the runtime (95 distinct sites,
   781 occurrences across modules), and React's demos stop on it
   (`Wakeable#then`).
2. **Fields** — where an object's class is lost (an erased value unerased to an
   interface), a field is read and written at the *interface's* position, which
   is the wrong field for a class laid out in another order. That is a silent
   wrong answer on main today
   (`tooling/conformance/outcomes/a-field-through-an-interface-its-classes-order-differently`).
   Where the class is known, the same structural cast is refused instead when the
   layouts disagree: 60 distinct sites, 638 occurrences.

**Recommendation:** infer the "implements" edges from shape, for the whole
program at compile time, and keep today's dispatch tables — which are already
program-wide selector tables, so a call stays one indexed load. Treat an
interface's *fields* the same way, as getter and setter entries in those tables,
used only where an object's class is unknown and the layouts disagree. Close the
wrong answer first, with a guard, before any of it.

## What exists, and what it decided

- **Record 0201** made an interface method a *dispatch root*: the slot is
  numbered against the interface, every implementer fills it, the call is one
  indexed load from the object's descriptor. The edge comes from the `implements`
  clause.
- **Record 0294** decided how a class passed where an interface is wanted works:
  a *copy* of the callee for the concrete class, because all 63 sites measured
  were monomorphic. No cast, no dispatch. A cast is kept only where the
  interface's fields are the class's first fields; otherwise it is refused
  (the 60 sites above).
- **Record 0255**: a layout is discovered by whichever function first needs it,
  so "which layouts exist" is a whole-program fact, answerable only after
  lowering.
- `nts receivers` measures field accesses by receiver type. In `http`, 3,160 of
  12,876 accesses (24.5%) go through an interface; a sound narrow rule (every
  interface a class could fit by member name) would make 757 of them indirect.

So the missing piece in both halves is the same: **the edge from a class to an
interface it fits without saying so.**

## How other languages do it

| | How a call through an interface finds the method | Cost per call | Fit for nts |
|---|---|---|---|
| **Go itabs** | An interface value is two words: a table for (interface, concrete type), built when the value is made, then the object. | One load from the table. | Interface values would become two words everywhere: every field, parameter and array of interface type. A pervasive representation change, for tables nts can build statically. |
| **Java itables** | Each class lists (interface → method table); the call searches it. JITs hide the search behind inline caches. | A search, or a cache hit. | nts compiles ahead of time; there is no JIT on C or LLVM to hide the search. |
| **Lookup by name** | A hash of the member name, per call. | A hash lookup. | Slowest; only for truly dynamic objects. |
| **Whole-program selector tables** (Dixon 1989; Driesen's row displacement) | Number every selector program-wide; every class has a row; the call is `row[selector]`. Compress the table by letting selectors no class shares use one column ("coloring"). | One load, like a virtual call. | **What nts already has**, keyed by declaration (record 0201). It needs rows for classes that fit by shape. |

nts sees the whole program (`runtime/node`'s `http` and `net` are one program
when compiled together), so the static answer is available and is the fastest.

## Part 1 — methods: infer the edge

**Before numbering slots, for every interface `I` and every class `C`:** if `C` has every
method `I` declares (by name, with an ABI the slot can carry), record
`C implements I`. Then record 0201's machinery numbers the slot against `I`, `C`
fills it, and the call compiles as today's virtual call.

- **No new dispatch.** The call is the same indexed load from the descriptor.
- **Over-approximation is safe.** An edge for a class no value ever brings to
  `I` fills an entry nothing reads. TypeScript's checker already refuses to give
  `I` a value that does not fit, so an inferred edge can never be the only thing
  between a call and a wrong method.
- **ABI.** The slot is declared with `I`'s signature. Where `C`'s method was
  specialized differently (an `i32` result where `I` says `number`), the entry is
  an adapter, as an override's already is (`signatures::specialize` pins what a
  table names).
- **Reachability.** A call through `I.emit` keeps every implementer's `emit`
  reachable. With inferred edges that is every class with a fitting `emit`. To
  measure: the definitions census and code size, before and after.
- **JVM.** `C`'s class file declares `implements I`; `invokeinterface` and the
  JIT then do the rest. A bridge method where the descriptors differ, as
  overrides have.
- **Cross-module.** `net`'s socket satisfying `http`'s `HTTPDuplex` is the same
  rule, since both are one program.

**Where it has to be careful:**
- *Generic interfaces* (`Thenable<T>`): fit is judged per instantiation, as the
  slot already is.
- *Optional methods* (`then?()`): an implementer may lack it; the slot entry is
  then a named stop, which is the language's `TypeError` made loud.
- *Object literals* that fit an interface are classes here too (each literal
  shape is a layout), so they get rows like any class.

*Built (`infer_implements` in `hir/lower.rs` and the shared bridge builder in
`lower/virtual_returns.rs`), with these limits:*

- **An interface declares its own ABI.** An adapter drops extra slot inputs,
  erases a value into a wider parameter, upcasts along an `extends` base chain,
  or converts a narrower answer. A void answer becomes `undefined` when the
  slot returns `unknown`. Callable parameters use the existing uniform callable
  representation. Equivalent adapters for one body are shared across slots.
- **Only conversions preserving the body's facts.** TypeScript permits
  bivariant method inputs, including a literal or subclass narrower than the
  interface parameter. Those need a checked conversion and block inference
  here. An interface edge is never a storage-prefix upcast. Overloaded/generic/rest methods,
  additional optional implementation parameters, and function-valued properties
  on declared classes against method slots remain unsupported.
- **Absence conversions are part of an adapter.** A nullable and an optional
  string input share pointer storage, but erase that pointer with different
  tags. Those adapters remain distinct. When one class needs both at the same
  JVM member name and descriptor, the JVM backend declines that class by name;
  native dispatch tables can distinguish the slots.
- **One conversion plan per body and convention.** Class return bridges and
  interface adapters share identical plans. An identity projection remains a
  recorded fact after allocation merging consumes its wrapper, so the JVM can
  prove a slot forwarder also serves a covariant bridge. Conflicting bodies,
  including inherited forwarders, decline by name instead of shadowing a slot.
  Interface declarations take their body witness from the filled table, which
  also covers a subclass served by a nonimplementing base.
- **An optional method blocks the fit.** If the class lacks it, a subclass
  that declares it fills the inherited slot with whatever signature it chose.
  `EventEmitter` fitted `LegacyDestroyable` on `emit` alone, and `Readable`
  and `Writable` became two disagreeing `destroy`s.
- **All or none per interface.** An inferred edge gives the interface slots.
  A class TypeScript accepts as the interface but that does not fit has no
  entry in them, and a call through the interface on it, with its class lost
  in an array, jumps through a null pointer. Main does exactly that wherever a
  class *declares* the interface beside such a class
  (`outcomes/a-structural-misfit-dispatched-through-an-interface`). So one
  candidate that can neither fit nor adapt leaves the interface as it was.
  Adaptable candidates now receive entries, including beside a class with a
  written `implements`; the crash fixture is an example under
  `examples/a-structural-misfit-dispatched-through-an-interface`.
  Contextual literal owners participate too. Every initial function and possible
  method write must satisfy the contract before their rows can fill the slots.

### Part 1c — literal supplies

On the JVM, a literal allocated at an interface's own layout can give that
layout instance fields. The backend then emits it as a class. A separately
shaped literal cannot be stored or passed as that class, including through
arrays, maps, sets and promises: the shared JVM assignability check refuses
the transfer by name before an array store or later payload cast can throw.
Emitting a separate concrete literal class behind a JVM interface remains
queued with interface accessors.

The allocation and the supply census use the same contextual owner, including
literals in typed arrays and tuple positions. An owner represents every literal
built at that type. It gains an edge only if every initial function and every
possible later write fits each slot. A contextual method signature alone is
not enough: TypeScript permits a narrower authored parameter through method
bivariance. Classes and literals share the candidate filter; only provably
disjoint primitive families can be excluded from all-or-none.

A direct literal method fills the row with its actual owner-named body, even
when an interface inherited the declaration. A stored method fills it with a
forwarder that loads that object's current closure field on every call. Captures,
replacements and each literal's own receiver remain distinct. The forwarder
passes arguments through the uniform callable ABI, checks a raising result before
reading it, and checks the erased result before recovering a concrete value.
Discarding a result through a void face releases it under reference counting.
An unsupported result contract blocks the edge; a value violating a supported
contract stops by name.

Adapter sharing includes owner, field, callable ABI, precise parameter absence
and result absence. Shared bodies receive the meet of their input facts. A field
forwarder is never an identity projection: loading and invoking the current
closure remains necessary. Any new layouts it needs go through the ordinary
whole-program layout merge before callable declaration shells are made.

Writes through private helpers are proved from **every incoming supply**, using
the same closed-call evidence as erased-parameter source copies. Exported or
escaping helpers, unknown callers, reassigned parameters and unknown function
values provide no permission. Dictionary, array and fresh unrelated object writes
do not replace record fields; an erased alias that can reach the literal still
participates.

Calls through another method interface use the proved table rather than a source
copy, which preserves the slot's raising, absence and input contracts. A source
copy remains permitted for private callers whose whole transitive flow uses the
object's methods only for identity, strict comparison or typeof. The proof follows
immutable aliases and downstream closed helpers; a method call or unknown consumer
removes that permission.

A face mixing method-value reads with calls stays on the legacy path globally,
until Part 2 can return the original closure through an accessor. The classification
is computed once before inference and controls inference, copies and forwarders.
This preserves programs main already handles. The existing wrong answer in
`outcomes/a-literal-method-compared-and-called-through-a-wider-face` remains pinned
and queued. A pure identity caller receiving an array element has lost its concrete
owner: reading that method through the face is still refused by name rather than
returning a fresh wrapper with different identity.

Function-valued properties on declared classes remain deferred. A contextual owner
also used by a declared class cannot assume that class has the literal's closure
field. Typed heterogeneous tuples retain the separately pinned core storage defect;
this change does not reinterpret their elements as compatible object pointers.

React's actual Thenable supplies satisfy Wakeable's contract and gain inferred
edges in the CLI product build. Raising-family numbering now also seeds calls in
exactly the named and closure raising bodies offered by the selected gate arm.
The existing family-wide carry check and slot fill serve both classes and literals;
nonthrowing members use their ordinary entries. The class and stored-literal
transitive-call witnesses pass on C, LLVM, JVM and RC, including the nonthrowing
controls. The strict gate still withholds unsupported closure copies.

Both GTK counter products clear their two `then@raises` roots (138 to 136 roots).
They still refuse 769 functions and drop the entry invocation: its next reported
stop is `resolveLazy<erased>@raises`, whose `LazyComponent` parameter has no
representation. It is pinned by the generic-interface-member blocker. The GTK
and libadwaita widget-driver controls remain separate from a working demo.
A concrete source copy of a nonthrowing interface method still names a missing
raising body; its directly guarded-family witness is pinned independently.
Then Part 2 comes next: the legacy-only fallback covers 127 interface
occurrences across 14 runtime families (stream 12, HTTP 13), and none in either
GTK counter or GTK state. Wakeable itself is not legacy-only.

It was built once before, on 2026-09-22, by name and shape, and set aside: it
cleared no refusal in the runtime and turned two upcasts into casts between
structs that disagree about their fields. This time the census gains a little
(see the commit), and the largest cascades stay. Their interfaces
(`URLParser`, `RandomSource`, `CancelHandle`) are implemented by literals in
`runtime/web-platform/host`, outside the program, which no inference inside
it can find. A written `implements` on a *generic* class reaches only the
declaration's type and not its instantiations. Inference covers an
instantiation that fits exactly; substituting the heritage clause per
instantiation is the rest.

## Part 2 — fields: the same tables, as accessors

The native field implementation uses one whole-program family per used field.
Every structural candidate must supply the read and, for a writable face, the
write. Its table entry names a real function reading the concrete field or
calling the concrete getter or setter. Shared bodies have the same storage,
absence contract and ABI; their input facts are valid for every incoming face.

User accessors and reads whose representation changes are lowered at the source,
before exception handlers are analysed. Dot reads, calls through function fields,
binding patterns and assignment patterns use that same contract. Actual read
types and absence facts survive constant aliases, including destructuring;
asserting a narrower interface cannot remove an implementer's null or undefined.
Pure storage access waits until source specialization has recovered any known
class. A remaining access whose layouts disagree becomes indexed dispatch;
known-class and common-prefix loads stay direct.

A narrow stored field needs an initialization proof: an initializer, a parameter
property, or an unconditional constructor write before the receiver can escape.
A definite-assignment assertion grants no such proof. Missing optional readonly
fields can return undefined; incomplete supplies retain named stops. Spread and
own-property reflection require separate evidence about every concrete own shape
and literal allocation. A prototype getter is not an own property.

The JVM currently declines these dispatch sites as NTS4001, classified as
`interface field accessor dispatch`. Stateful JVM interfaces are stage C.
Legacy method-value classification stays until stage D; source copies remain
specialization, and field correctness no longer depends on them.

Method values need the same accessor mechanism. A read through a method
interface must return the implementer's own closure: a stored literal supplies
its current field, and a class method supplies its existing bound-value
representation. A fresh wrapper for the literal changes `===`. Add this as an
accessor slot alongside field getters and setters, then remove Part 1c's legacy
classification for mixed method-value and invocation flows. Its pinned wrong
answer is `outcomes/a-literal-method-compared-and-called-through-a-wider-face`.

A field read through an interface is correct when the object's class is known
(record 0294's copies) or when every class that can arrive puts the field where
the interface does. It is wrong — today — when neither holds.

**Recommendation:** where an access goes through an interface *and* some class
that fits the interface lays the field out elsewhere *and* the class is not
known at the access, the access becomes a call to the interface's getter or
setter slot. Each class fills it with a two-line accessor for its own field, or
with its own getter where it has one (which is what the 60 refused casts are:
`Agent` has a `protocol` getter where `RequestAgent` declares a field).

- **Where the class is known, nothing changes:** the copy reads the field
  directly.
- **Where the layouts agree, nothing changes:** a plain load.
- **Only the disagreeing, class-lost accesses pay a call**, which the JVM inlines
  and C and LLVM can, where the slot has one implementer. If one turns out hot,
  the slot can hold an offset instead of a function (a load, not a call) on C and
  LLVM — a later step, taken on a measurement.
- **Representation.** Every class filling a field slot keeps the field at one
  width, as `keep_storage_together` already requires of fields that share
  storage.

The alternative was a test chain on the object's descriptor (`OpenFieldGet`,
which unions use). It costs a comparison per arm (2 to 175 arms measured), and
its store form, `OpenFieldSet`, has never been built, so ownership, escape and
reference counting have never seen it. Accessor slots reuse the call path every
pass already knows.

## Part 0 — the wrong answer, first

Before any of the above, the erased path must not be quieter than the typed one.
An unerase to an interface is where the class is lost, and today it trusts the
interface's layout. The guard: an access through an interface to a field that
some class implementing it holds elsewhere checks the object's class at run time,
and stops by name if it is one of those classes. A named stop instead of a wrong
answer, and the outcomes fixture moves from a wrong answer to a refusal. Part 2
then lifts the stop.

*Built (`hir::interface_fields`) at the access, not at the unerase.* A first
version tested the class at the unerase, and refused at compile time an erased
join with an arm laid out otherwise. It cost seven functions in `web-platform`.
Those are sites that make a `SocketConnector` out of an `AdoptingConnector` and
only call its methods, which dispatch correctly whatever the layout. Tested at
the access, a program stops only where it would have read the wrong field, and
the test is placed exactly where Part 2's getter call goes. One pass after
lowering sees every access path, and the layouts are complete by then.

## Part 3, as built — native tables contain their readers

The native tables were mostly padding. Inferred edges made them larger
(record 0346), but most numbered slots have no surviving native table read.
Projecting rows onto the selectors native code actually reads removes this
padding without needing selector coloring or a proof about possible receivers.

Logical selectors and `Layout::methods` stay unchanged. At the end of prepare,
`hir::native_dispatch` sorts the surviving readers and assigns each a distinct
native column. Every layout keeps exactly its body or null in each retained
column; a missing method cannot acquire another selector's body. C and LLVM
use this one plan for rows and loads. Calls still cost the same indexed load.
The JVM continues to use logical slots.

The same native plan supplies an emission view that omits bodies made
unreferenced by discarded columns, including their otherwise unreferenced
direct callees. Public and foreign entries, printing and every projected row
keep their bodies. Both native backends use the view for code and its resources;
logical declarations remain available for signatures and JVM emission.

Readers include virtual and closure calls, promise subscriptions, context
bridges, symbolic `DispatchSlot` callback arguments, and the exported
`nts_closure_call_slot` that handwritten hosts read. `DispatchSlot` carries no
numeric fact before emission: native code spells its column, and the JVM spells
its logical value. The verifier checks the plan; both native emitters separately
require a column at every actual read.

Co-filled column sharing is deferred until there is a measured need. Sharing
requires a further proof that a reachable null cannot become another method,
especially through structural or erased receivers. Projection preserves nulls
on every layout by construction.

## Plan

| Step | What | Measured by |
|---|---|---|
| 0 | The guard at an access through an interface whose classes disagree about the field | the outcomes fixture: wrong answer → named stop |
| 1 | Infer `implements` by shape, for methods | the 95 structural-call sites; React's `Wakeable#then`; `blockers/a-method-through-a-structural-interface` → example; definitions census; code size |
| 2 | Interface fields as getter and setter slots where layouts disagree and the class is lost | the fixture → example; the 60 refused casts; `nts receivers` |
| 3 | Native reader projection; selector coloring deferred | table and optimized object bytes per module |

## Decided (2026-10-10): all three as recommended

1. **Edges by shape, whole program** (recommended), against Go-style two-word
   interface values or a lookup by name. The difference is a representation
   change everywhere (Go) or a slower call (lookup) for no gain nts needs.
2. **Fields through interfaces as accessor slots** (recommended), against a test
   chain per access.
3. **The guard first** (recommended): it closes a wrong answer today, before the
   larger steps.
