# The prefix was already there

A generator could only be walked where it was made. Handed to another function
it was refused — and refused a step earlier than the loop, at the parameter,
because `Generator<T, TReturn, TNext>` had no representation and a signature
cannot name a type that has none.

Closing it added no new concept. Every piece was already in the compiler, and
the work was almost entirely in finding that out.

## What the artefact said that the pass did not

The obstacle, as `hir/lower.rs` stated it, was that the resumption does not
exist when the loop is lowered: `hir::suspend` splits a generator into an entry
and a resumption long afterwards, so `generator_walk` derived the resumption's
*name* from the call that produced the frame. A parameter has no call behind it.

That is true, and it is a statement about names rather than about layout. The
layout question is answered by the emitted C, which I read before designing
anything:

    struct NtsObj_plain_frame {          struct NtsObj_Counter_named_frame {
        NtsHeader header;                    NtsHeader header;
        int32_t state;      // 24            int32_t state;      // 24
        int32_t yielded;    // 28            int32_t yielded;    // 28
        int32_t n;          // 32            NtsObj_Counter *this;
        int32_t held0;                       int32_t held0;
    };                                   };

**Every generator frame already began with the same two fields, at the same two
offsets, and diverged only from 32 on.** The abstract generator did not have to
be invented, only named. `Generator<T, …>` is laid out as exactly that prefix,
by the same `generator_prefix` that lays out the frames — one function, so the
two cannot drift — and a concrete frame is already a structural prefix of it.

Had I designed from the pass instead of from its output, I would have added a
header field and changed every frame's layout to get a relationship the frames
already had. Record 0287 is the same lesson from the other end and I nearly
repeated it here.

## The identity was already decided

The first design gave the abstract generator a synthetic type id in a band of
its own, beside the cells, frames, closures and class tokens. The id space is
partitioned and there was room.

It is the wrong answer, and the reason generalises. The checker has already
decided that `Generator<number>` written in two files is **one type**, and
`generator_element` was already reading the element off that very id. A
synthetic band would have been a second identity for a fact that already had
one, and the two would have had to be kept agreeing.

So the class *is* the checker's `TypeId` for `Generator<number>`. No new band,
no new constant, and `provided_representation` — which already recognises
`Date`, `ArrayBuffer` and `DataView` by name — gained three lines.

`Generator` alone, deliberately. A generator satisfies `Iterator<T>` and
`IterableIterator<T>`, but so does a hand-written object with a `next`, and that
shape *already works* as a protocol object with a `{ value, done }` result.
Representing those two names as a frame would take a working case and give it
the wrong machine value.

## The dispatch was already there

`NtsDescriptor` carries `void *const *methods`, described in the runtime header
as "null for every class in a hierarchy where nothing is overridden, which is
most of them. Where there is one, a call is a load of this pointer and an
indirect call through it". `Layout` carries `methods: Vec<Option<String>>`.
`Callee::Virtual { slot, declared }` exists, numbered against the class that
first declared the method.

So the abstract generator declares the resumption in a slot and each frame
overrides it, and the emitted call is one line:

    v3 = ((bool (*)(NtsObj_Generator0 *))v0->header.descriptor->methods[0])(v0);

The hierarchy gained one `generator_slot` beside `closure_slot`, on the same
terms and for the same stated reason: one slot rather than one per element type,
because every resumption has the same signature — it takes the frame and answers
whether the generator is done, the element being read from `yielded` afterwards
and never returned.

## What a peer's numbers changed

The first design put a resumption **pointer in the frame**. The JVM lane refused
it with a measurement, and the measurement is one I could not have taken:

> If the resumption pointer is typed as a signature layout, it goes through the
> closure-base machinery (`Layout.base` → `Fn$`) — and that is where the `(D)D`
> tax lives. A generator whose `next(v)` takes and returns `number` would get
> `call(D)D` from the declared type even where every operation in the body is
> int-exact, which measured **2.6x on ART and 0% on HotSpot**.

Zero percent on HotSpot. Every measurement I would have taken of that design, on
this machine, would have said it was free.

The same lane's ART table is why the direct call survives:

    ART      field read 1058   virtual, 1 subclass 2178 (2.06x)   interface 2162 (2.04x)
    HotSpot  field read 1056   virtual, 1 subclass 1079 (1.02x)

**No free monomorphic case on ART.** So a walk emits `Callee::Direct` where the
generator was made locally — which is the hot path of every element of every
walk, and the 1.07x-of-hand-written-C++ number in §10 — and dispatches
indirectly only where the question cannot be answered statically. On HotSpot
that split buys nothing; on Android it buys about 2x on every resumption.

They also corrected the part I had wrong in the other direction: a structural
prefix **is not a subtype on the JVM**, which relates classes by name. Fields
coinciding at offsets 24 and 28 buys that backend nothing, and a frame passed
where `Generator<T>` is declared would have been NTS4001. The fix was to
*record* the relationship rather than leave it implied — `Layout.base` on each
frame — which is one field and which C and LLVM ignore because their layouts are
base-first anyway.

Their third warning was already closed: `Layout::same_shape` takes the base as a
parameter rather than as a comparison its callers make, "so that neither of them
can forget it", so two frames that capture nothing and differ only in base
cannot merge.

## The declaration is the caller's problem

With the slot filled, the C backend answered:

    NTS2006 no declaration for `Generator0#resume` to take a signature from

Record 0090 is this exact failure for `abstract area(): number`, and its answer
applies unchanged: the *caller* needs a declaration to build the function-pointer
cast from, so the abstract generator's resumption is lowered as a real function
with the declared signature and an `Unreachable` body. Never reached, because
every receiver that exists is a frame whose override filled the slot.

Its signature is taken **from an implementer** rather than synthesized, which is
`declare_interface_methods`' rule and worth restating: every resumption must
agree with the others or dispatching through the slot is meaningless, and taking
the signature from one of them makes that agreement checkable. A signature
invented at the declaration would be a third opinion none of them held. This has
to run after `suspend` builds the resumptions, because before that there is
nothing to copy from.

## The one thing it broke, and why three readings missed it

The `fs` and `readline` addons stopped building. Their refusals named
`runtime/web-platform` constructs, all of which were present in a census taken
before this work, so I reported the regression as pre-existing. Then I compared
the cascades: **843 NTS1003 before, 843 after, identical to the byte.** Both
readings were true and both were about the wrong thing.

Nothing was refused differently. The *emitted C* was different and did not
compile:

    error: field has incomplete type 'void'
     11129 |     void yielded;

`emitKeys` in `readline` is `Generator<void, void, string>` -- a generator driven
entirely by what the caller passes to `next(v)`, whose elements go in rather than
out. It has no element, so the prefix's `yielded` field has no type.

A concrete frame never met this, because a frame is built only for a generator
that lowers and none with a `void` element ever did. **The abstract generator is
emitted whenever a signature names one**, which is the first time such a layout
has existed. So the construct was old, the layout was new, and the only artefact
that showed it was the C.

It is refused by name now -- "a generator that yields nothing" -- at the
generator rather than at the layout, because the honest sentence is about the
generator and the layout's would be about a struct the source never wrote.

The instrument that settled it took four minutes and should have been first: the
pinned pre-change binary against the same sources answered **24 of 24 still
build, 0 regressed**. Refusal counts, cascade counts and message censuses all
answer "what did the compiler decide"; only compiling the artefact answers "what
did it write".

## What it is worth, measured honestly

**Zero refusals in the corpus.**

    zlib     1780 -> 1780
    stream   1669 -> 1669
    events   1127 -> 1127

Not a disappointment to be explained away — it is the measurement the census
predicted and I should have read it that way before building. Of 356
generator-and-iteration refusals in `runtime/node`, **305 are async**: 136
`for await` loops, 112 async generators, 57 `Async{Generator,Iterator}` of
unrepresentable type. The sync half is 51, and `yield*` is 21 of those.

So this is a prerequisite rather than a yield. It is the thing `yield*`, the
value of a `yield`, the iterator helpers and the async protocol all needed
first, and none of them could have been built before it. The corpus number for
*this* row is zero and will stay zero.

`examples/a-generator-walked-elsewhere` is 174 cases across six exports, and the
one that matters is `twoGeneratorsOneWalk`: two generators whose frames are
**byte-identical in shape** — `{header, state, yielded, limit, held0}` — passed
through one parameter. A walk that resolved the resumption statically would call
one body for both and still run, answering the same sum twice. Two shapes
through one site is the only arrangement where that is a different number rather
than an invisible bug.
