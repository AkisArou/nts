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

**After lowering, for every interface `I` and every class `C`:** if `C` has every
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

## Part 2 — fields: the same tables, as accessors

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

## Part 3, later — smaller tables

The tables are almost empty: in `http`, 187 rows of 126 slots, 423 of 23,562
entries filled (1.8%). Inferred edges fill more. Selector coloring (two slots no
class fills together share a column) would shrink them several times over. It
does not change correctness or the cost of a call; it is a size optimization,
taken when the measured size says so.

## Plan

| Step | What | Measured by |
|---|---|---|
| 0 | The guard at an access through an interface whose classes disagree about the field | the outcomes fixture: wrong answer → named stop |
| 1 | Infer `implements` by shape, for methods | the 95 structural-call sites; React's `Wakeable#then`; `blockers/a-method-through-a-structural-interface` → example; definitions census; code size |
| 2 | Interface fields as getter and setter slots where layouts disagree and the class is lost | the fixture → example; the 60 refused casts; `nts receivers` |
| 3 | Selector coloring | table bytes per module |

## Decided (2026-10-10): all three as recommended

1. **Edges by shape, whole program** (recommended), against Go-style two-word
   interface values or a lookup by name. The difference is a representation
   change everywhere (Go) or a slower call (lookup) for no gain nts needs.
2. **Fields through interfaces as accessor slots** (recommended), against a test
   chain per access.
3. **The guard first** (recommended): it closes a wrong answer today, before the
   larger steps.
