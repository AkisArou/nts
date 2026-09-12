# One placement, wrong three ways

A class's field initialisers were emitted at the **allocation site**: every
class's, base-first, before any constructor ran. One placement, and three
separate defects came out of it. I found it while checking where an optional
property's presence mask is set, which is a fourth thing it was wrong about.

## What the language says

`new D()` runs D's constructor; its `super()` invokes B's; B's constructor runs
its own `super()`, then **B's field initialisers**, then B's body; control
returns to D, which runs **D's field initialisers** and then D's body.

So a class's initialisers belong inside its own constructor — at the top when
there is no base, immediately after `super()` when there is.

## Defect one: a derived initialiser could not see `super()`

    class B { x: number; constructor(n: number) { this.x = n * 3 } }
    class D extends B { y: number = this.x + 10 }

`new D(2).y` is 16 in node. Here the initialiser ran before B's constructor, so
it read a field nobody had written: **28 of 29 cases disagreed**, answering
`nan`.

## Defect two: the napi boundary ran none of them

The wrapper calls `nts_construct_X()` and then the compiled constructor. There
is no allocation site, so for a class nothing constructs internally the
initialisers were emitted *nowhere*: `class Published { counter = 41 }`
published to JS had `counter` at 0, and the literal `41` appeared nowhere in the
emitted program at all.

## Defect three: the presence mask inherited both

The optional-property presence mask is set in the same place for the same
reason, so it had the same boundary.

**And it stayed open for an hour after the other two closed**, because moving
the *initialisers* into the constructor did not move the mask with them — the
mask was a separate call at the allocation site and the move said nothing about
it. What settled it was compiling a published class with an optional property
and looking: no `nts_presence_init` anywhere in the program. The ledger row had
by then been edited to say the boundary was closed by the same move, which it
was not.

A fix that closes three defects is three claims, and the third was the one I
had not checked.

## The fix is a move, not a mechanism

All three close by putting a class's own initialisers inside its own
constructor. **No per-class initialiser function was needed**, which is what I
first wrote down: the napi wrapper already calls the constructor, so putting
them in the constructor is what makes the wrapper run them.

The allocation site keeps exactly the classes *below* the one whose constructor
it calls — those declare none of their own, so nothing else would run them — and
they go **after** the call, because an implicit constructor is `super(...args)`
followed by this class's initialisers.

The index a constructor uses comes from its own class's layout, and base-first
layout makes it the same index in every subclass's. That is the same argument
the presence bit rests on, one representation apart.

The mask moves the same way and becomes per class rather than per allocation:
each constructor records the optional properties **its own class** declares, and
the union across the chain is what the single store at the allocation site used
to write. Own properties only — taking the flattened list would have each
constructor set its ancestors' bits as well, which is harmless and is also three
classes writing one word for no reason.

## The optimiser hid it, which is the part worth keeping

The first probe used a constant base value — `this.x = 1`, `y = this.x + 10` —
and **agreed with node on all 29 cases**. The first explanation offered was
stack reuse, and it was wrong: dirtying the stack before the call changed
nothing. Two optimisation levels on the same emitted C is what answered it, node
saying 11 throughout:

    -O0   first call after a dirty stack   10          the field read as 0
          second call                      7.9e+08     read as garbage
    -O2   both calls                       11          node's answer

Reading an uninitialised member is undefined behaviour, so at `-O2` clang is
free to produce the answer the program would have had if it were right. **A
release-build comparison agreed with node because the optimiser chose to, not
because the program computed it**, and `nts check` compiles at `-O1`.

Two things follow, and both are general. A probe whose expected answer is a
constant cannot tell "computed correctly" from "undefined behaviour that landed
well" — every value in `examples/a-field-initialiser` is derived from the
argument for that reason. And a defect whose symptom is UB can be invisible in
the one configuration everything is measured in, so a second optimisation level
is worth more than a second case.

Both levels answer 11 now.

## What else it was hiding behind

A stack-allocated frame sets `descriptor` and `reserved` and never `flags`,
which was safe only because `nts_retain` and `nts_release` both test
`reserved == NTS_IMMORTAL` **first** and short-circuit before reading it — an
ordering dependency between two clauses of one condition, stated nowhere. The
presence bits are read by a helper behind no such gate. The frame now zeroes the
word: one `uint32_t` store beside the two that construction already emits,
against a defect that is currently unreachable only because escape analysis
happens to put every object whose presence is asked about on the heap.

## And a fourth defect, underneath, that only this reached

Moving the initialisers put an object and a closure capturing it on a path where
the reference-counting gate had never looked, and two things were wrong there.

**A class holding a closure that captures `this` was emitted as not cyclic.**
`Program::cyclic_layouts` builds its edges from each field's *declared* type,
and a field declared `(n: number) => void` names the **signature** layout, which
is fieldless. So `Holder` had no outgoing edge at all, its descriptor carried
`cyclic = 0`, and `nts_possible_root` returns on its first line for such a
descriptor — the object was never offered to the cycle collector and leaked for
the life of the program. The edge has to follow the *subtypes* of a base, which
is what a closure is stored as.

Three probes bound it, and the third is the one that found it:

    a plain two-object cycle                    collected
    a closure cycle at the allocation site      collected
    a closure cycle formed inside a callee      leaked

The middle one is why this survived: an object that never escapes has its fields
released at the end of its scope, and that tears the cycle down by hand without
the collector ever being asked. Every fixture with this shape avoided the defect
by not escaping.

**What is left is a double count**, and it is listed in `tooling/gate/rc.sh`
rather than fixed. The caller retains the receiver before a constructor call as
though the callee takes ownership, and the callee retains it again when storing
it into the closure; a count of two with one holder is not garbage to any
collector. `own.rs`'s `consuming` decides one and something else decides the
other — two derivations of one fact, which is the shape this tree has now been
bitten by five times. Instrumenting `consuming` says the receiver is not even
considered: it reports parameter 1 and never parameter 0.

## And a cost, which the memory suite named

The presence bits took two rows from **0 allocations to 17** — `deleted-field`
and `optional-unassigned`. The helpers take the object pointer, so handing the
receiver to one is an escape and every object with an optional property somebody
asks about moved to the heap. `runtime::keeps` is where a helper says it keeps
nothing; saying so put both rows back to 0.

A third row survived that: `callback-field`, one counted operation against a
floor of zero — a store into a header word nothing ever reads. So a presence bit
is now maintained only for property names some `in` in the program asks about.
The bit *index* is unchanged, still a position among all the layout's optional
fields, so tracking a subset renumbers nothing.

**Neither of those was visible on the JVM lane**, which emits the helpers inline
and so never sees the escape. A cost that only one backend can observe is worth
one of them looking.

## Two emitters, one invariant, and only one was told

The frame fix above went into the C backend. LLVM builds its frames separately
— an `alloca` and the header written out — and did not get it. So on that
backend `"other" in o` answered **true for a property never written**, 16 of 29
cases, while C agreed on all of them. I had checked the example on both backends
and then changed one of them.

`start_frame_object` and LLVM's `frame_header` are two spellings of one
invariant: *a frame's header holds what `nts_object_new`'s `memset` would have
put there*. Both already wrote the descriptor, the count word and a zero in
every reference field; the flags word was new and only one learned it.

That is the fifth time in one day that one fact had two derivations and they
disagreed — `owns` against `hands_over`, these two emitters, `cyclic_layouts`
following declared types where values are stored, the two LLVM floors below, and
`presence::of` against the checker's property order. The tree has a name for
this failure and it keeps happening anyway, which suggests the name is not the
remedy. What would have caught this one is asking, at the moment of writing a
store into a header: *who else writes this header*.

## A ratchet raised from a number that was not its own

`llvm` and `llvm_rc` are two runs asking different questions, and I set both
floors to 188 from the `llvm` line. `llvm_rc` had printed **187** in the same
log, one below because `this-in-a-field-initializer` leaks under counting.

A floor raised from somebody else's number is worse than one left too low: it
fails on the next clean run and the failure names the wrong thing. It is back to
187, with the example named in the comment and the diagnosis cross-referenced to
`tooling/gate/rc.sh` rather than restated.
