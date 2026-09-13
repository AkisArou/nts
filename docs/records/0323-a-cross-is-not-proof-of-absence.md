# A ✗ is not proof of absence

The ledger's standing caveat runs one way: *a ✅ is not proof of coverage —
record 0153 has one green while 56 sites were refused by name.* It runs the
other way too, and that is the cheaper error to make because nobody goes looking.

## The row was ✗ and the example was in the tree

> ✗ `in` over `object` naming a key a **natively represented** type answers for —
> `then`, `length`, `size`, `buffer`, `name`. […] `"then" in v` is the one that
> bites: it is how every thenable test is written.

`examples/in-on-an-object-a-native-answers-for` runs **290 cases across ten
functions** and agrees with node. Its own header describes this row's subject in
the past tense.

Probed separately before believing it: `"then" in v` over a `Promise` and a
plain object, `"length" in v` over an array, `"buffer"`/`"byteLength"` over a
`Uint8Array` and an `ArrayBuffer` — 145 cases, five functions, each arm
answering differently for its two branches so a constant `false` would show. All
agree. And they agree on the binary from the **start of the session**, so this
was not something the day's work enabled.

The machinery is `natives_declaring`, a name-to-native table sitting in
`lower.rs` with a paragraph above it about what it deliberately omits. `size` is
the only key still open and not for this row's reason: it maps to `Map` and
`Set`, which are deferred, so the entry is present and unreachable.

**Nothing was built. A queue item closed by being read against the corpus**, and
the work was noticing that the fixture already existed.

## The biggest count had no yield

The same queue's largest number was *a generic class exported but not
instantiated in its own compilation*, at what the row called 129 sites. It is 23
([[0320]]), and the 23 clear nothing:

```text
async_hooks    14 of the 23 sites
               0 NTS1003 cascade refusals in the whole module
               12 declined exports, naming neither class
```

So closing it removes fourteen refusal lines, publishes no export, unblocks no
function and changes no answer. That is [[0303]]'s rule — rank by what clears,
not by reach — arriving at a row where reach and yield differ by everything.

Two things fell out of probing it that the row states wrongly. The trigger is
not `new`: an exported `class Held<T>` refuses once per member, and adding a
function that merely **names** `Held<number>` in a parameter position clears all
of them, because the checker interns the type. And the cheap fix the corpus
suggests — `AsyncLocalStorage<T = unknown>` has a default, so the language
already specifies its canonical instantiation — is not reachable, because
`TypeKind::TypeParameter` carries a `constraint` and no default. That is a
schema change and a tsgo fetch, priced and declined on the yield rather than on
the difficulty.

## Six stale rows in one session

`in` over `object` was ✗ and landed. The `errors` group listed three classes as
gaps that work. A generic row's cited evidence belonged to the row below it. A
blocker quoted a census figure of 57-across-23 for a row that no longer exists
under that message. Row 309 quoted 87 cases where the example runs 116. Row 330
quoted 129 sites for 23.

**Every one was found by running something, and none by reading.** The ledger is
prose about a compiler that moves underneath it, and the only operation that
distinguishes a true row from a stale one is execution. Which is what the header
says about ✅ and is equally true of ✗ — with the asymmetry that a wrong ✅
invites a check and a wrong ✗ invites work.

*Incidental, and the reason it is here: this cell was written into the middle of
a markdown table twice within an hour, splitting it both times. Counting `|` per
line caught it both times. A structural check that takes one `awk` is worth
running on any generated edit to a table.*
