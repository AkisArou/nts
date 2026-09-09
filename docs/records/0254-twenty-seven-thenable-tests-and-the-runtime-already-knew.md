# Twenty-seven thenable tests, and the runtime already knew

`"then" in value` where `value` is `object` refused, and had refused since the
whole-program answer was written. So did `"length" in value`, `"name" in value`
and `"buffer" in value`: fifty functions across `runtime/node`, of which
twenty-seven were the one line every thenable test in the corpus is written as.

The refusal was correct and said why:

    an `in` naming `then` on an `object`, which a natively represented type
    answers for -- an array, a `Map`, a `Promise` and a `Date` are all `object`
    and none of them has a layout to find the name on

`"k" in v` over an `object` is answered from the closed set of types declaring
`k`, compared against the value's descriptor. That set is built from
`program.layouts`, an array is not in it, a `Promise` is not in it, and for
their own property names JavaScript answers `true`. Rather than fold to `false`,
the lowering carried a list of the names it would have got wrong and refused
them by name.

## What changed is that none of them needs a layout

Each is one descriptor comparison the runtime already performs for `instanceof`:

    length       nts_is_array, a view that is not a DataView, and the tag
    size         nts_is_map, nts_is_set
    then         nts_is_promise
    buffer       nts_value_is_view
    byteLength   nts_value_is_view, nts_is_buffer
    name         the tag

`nts_is_promise` was already in the signature table, already had an LLVM
signature and already had a JVM row, because `x instanceof Promise` compiles.
The list of names the answer would get wrong was, name for name, a list of tests
the runtime had. So the refusal became a table and the natives are folded onto
the class answer with `||`.

A function is not a descriptor comparison at all. A closure's erased form
carries `tags::FUNCTION`, so `"name" in f` is `TagOf` and a comparison — no call
and nothing for a backend to be missing.

## The join is a branch, and not `BinOp::BitOr`

Every backend routes the bitwise operators through `ToInt32`: C casts both
operands, the JVM narrows them with `d2i`. TypeScript rejects `a | b` on two
`boolean`s, so no program has ever put a bool on either side of one, and making
this the first would rest on three backends each happening to do the right thing
with an operand shape none was written for — and failing silently in whichever
did not.

## An operation that names nothing

`InstanceOf` with an empty class list was the identity for that `||`, and the C
emitter agreed: it resolves each id to a layout, drops the ones that have none,
and emits `= false` when nothing is left. The JVM emitter does not drop them. It
said `an instanceof against no class at all` and **declined fourteen functions
of the fixture written for this change**.

Neither behaviour is the defect. The operation is. `"byteLength" in value` asks
which types declare the name and `lib.d.ts` declares it on `ArrayBuffer`, on a
`DataView` and on nine typed arrays — object types in the snapshot, natively
represented here, allocated by nothing and laid out as nothing. Four absent
classes emitted `= false` in one backend and read as correct.

`prune_class_tests` runs once over the finished program: every `InstanceOf`
keeps only classes the program has a layout for, and one that keeps none becomes
a constant. It cannot be done during lowering — a layout is discovered by
whichever function first needs it, and the set is not complete until every
function has been lowered — and it should not be done in a backend, which is how
the two came to disagree.

## The instrument could not fail, and the pool is why

The first fixture dispatched on `n % 10` and let the differential pick `n`. **No
value in that pool is congruent to 4 modulo 10.** The `Promise` receiver was
never built. Deleting `Native::Promise` from the compiler left it reporting
`agreed on every case` over 290 of them.

The rewrite loops over all ten receivers inside each case, which takes the
harness's choice out of the question. With the table emptied, eight of the ten
cases disagree and the two controls do not; with only the `Promise` entry
emptied, 87 cases disagree. Both were run.

The pool is a fine sample and a bad *dispatcher*. A fixture that indexes a case
table by a generated number is asserting something about the generator, and
nothing in either file says what.

## What it bought, counted honestly

    in-refusals across runtime/node    405 -> 378
      a natively represented type       50 -> 0
      declares optionally              188 -> 208
      not an object                     19 -> 22

**Twenty-seven of the fifty cleared and twenty moved one wall along.** Every
`then` site cleared. Every `length` site and every `name` site now refuses
because some type in the program declares that name *optionally* — including
`buffer/src/main.ts:189`, `hasArrayLikeShape`, which is the head of
`Buffer.from`'s cascade. It refuses on the same line for a different reason, by
an anonymous type, and `string_decoder` is exactly where it was.

That is the shape `tooling/conformance/prize.mjs` was written about: the head of
a chain advancing inside the same function while no module moves. Reporting this
as "fifty closed" would have been true of the message and false of the program.

## And the wall behind it got taller while nobody was looking

`Buffer.alloc` was filed as having a second head — `Uint8Array#fill`, which the
compiler had no method for. It has had one since 2026-09-09. So the cascade under
that one line is now:

    hasArrayLikeShape -> objectToBuffer -> Buffer.from -> Buffer.of
                                                       -> Buffer#fill -> Buffer.alloc
                                                       -> search, transcode
                                                       -> bytesOf -> StringDecoder

**Both halves of the `Buffer` API stand behind `return "length" in value`**, and
the blocker's own header said otherwise until this was measured. A fixture that
records why a fix will not be enough keeps saying so after it becomes enough.

What holds that line now is `Declares::Optionally`, by an **anonymous** type —
the least actionable form the message has. Whether that refusal is necessary is
a different question from the one this record answers: two object literals of one
optional-field type share a layout with an erased slot, measured, so `{}` and
`{ k: undefined }` really are indistinguishable *once allocated*. What is not yet
asked is whether the poisoning type is allocated at all.

`blockers/in-on-an-undeclared-object` is kept as a guard, labelled with what it
certifies — that four functions lower — and what it does not, which is that they
answer correctly. A constant `false` lowers just as cleanly, and a constant
`false` is what this construct did before the refusal was put in front of it.
The answer is `examples/in-on-an-object-a-native-answers-for`'s to certify.

## The one lane that cannot run it

`nts_value_is_view` — "a typed array or a `DataView`" — has no JVM row.
`runtime/jvm` carries `isDataView` and `isViewKind` and not the pair. That is a
method and a table row in the JVM lane's files, so the LLVM floors go 146 to 147
and the JVM floor stays at 142, with the gap named in `tooling/gate/all.sh`
rather than absorbed into the number.
