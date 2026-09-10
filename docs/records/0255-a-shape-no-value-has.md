# A shape no value has

`"length" in value` where `value` is `object` refused, at
`buffer/src/main.ts:189`, which is `hasArrayLikeShape` and the head of
`Buffer.from`'s cascade. The message named the cause:

    an `in` naming `length` on an `object`, which an anonymous type declares
    optionally -- its slot exists here whether or not it was written, so no
    test of the value can say which

The reasoning is right about a value. An optional field is a slot that exists
whether or not it was written: two literals of one optional-field type print as
**one layout** with the field as `Erased`, so `{}` and `{ k: undefined }` are the
same bytes and no test of the value can tell them apart. That was measured
rather than assumed, because the alternative was to trust it.

It is not right about a shape nothing holds.

## An anonymous type is not a place

`an anonymous type` was the whole of what the message said, and it points at
nothing: somewhere in forty thousand lines a declaration writes `length?`. A
type with no name still has a declaration, and where it is written is what a
reader needs — so the message says that now, and where there is not even a
declaration it says what the type *holds*:

    which the anonymous `{ length?, toString?, toLocaleString?, pop?, push?,
    concat?, ... }` declares optionally

That is `Array` with every member optional. It has no symbol, no declaration, no
layout, and 208 refusals across `runtime/node` were standing behind shapes of
that kind with nothing naming them.

## The property, after a proxy that was not one

A value's runtime shape is decided **where it is allocated**, an allocation is an
expression, and an expression has a type. So every shape a value can have is
some node's type — and a type table holds far more than a program builds. The
type above is the type of **no node**: `nodes-with-this-type=0`.

The first attempt was "has no symbol", which the same type also satisfies and
which looked like the rule for exactly that reason. **Twelve of `buffer`'s 144
laid-out types have no symbol either** — `Type190`, `Type410`, `Type796`,
`Type1126`, `Type1232`, a signature type, two closures and the four error
constructors. A property true of the example in front of you and false of the
set, refuted by counting rather than by argument.

The exact question is "does it have a layout", and it cannot be asked during
lowering: a layout is discovered by whichever function first needs one, so the
set is not complete until every function has been lowered. That is why
`prune_class_tests` runs afterwards and why this cannot.

## What it is conservative about, deliberately

A **written** interface is the type of its own declaration node, so declaring one
with an optional field keeps the refusal however unused it is — and a type used
only as a parameter annotation keeps it too. Both were checked by writing a type
that nothing builds and watching the refusal stay. That is the right direction:
a declaration is something the program could construct tomorrow, and only a type
the checker synthesised and never attached to anything is excluded.

## Measured, and the count is not the point

    in-refusals across runtime/node       378 -> 371
      declares optionally                 208 -> 201
      not an object                        22 ->  22

**Seven, at two source sites.** `buffer/src/main.ts:189`, counted once in each
of the six module builds that reported it, and `http/src/outgoing.ts:200`, which
asks `"keys" in value`. That is the whole of it.

A change worth seven refusals is not obviously worth writing down, and this one
is, because of *which* seven. `buffer/src/main.ts:189` is `hasArrayLikeShape`,
and `Buffer.from`, `Buffer.of`, `Buffer#fill`, `Buffer.alloc`, `search`,
`transcode`, `bytesOf` and `StringDecoder` are all downstream of it. Ranking this
work by the count would have put it below a dozen things that clear more and
unblock nothing — which is the failure `tooling/conformance/prize.mjs` was
written about, arriving from the other end: not a large number that buys
nothing, but a small one that buys the largest cone in the profile.

`hasArrayLikeShape` compiles. `Buffer.from`
does not: the Node lane confirmed the before and after on two pins, by presence
rather than by absence — a probe holding both functions publishes `callShape`
and refuses only `callIsView` — and named the three heads that remain.

    184  isTypedArrayView   `ArrayBufferView` has no representation, and the
                            `in` message was describing the value instead
    196  objectToBuffer     an erased value after a type predicate
    218  fromArrayLike      `source[i]`, where the index signature is not
                            consulted for a non-literal index

So `string_decoder` is unmoved. One of four heads is not a module.

## Three vacuous instruments in one night, all found the same way

The fixture written for this was **controlled and failed the control**. It asked
`"cause" in v` and `"writable" in v` — `ErrorOptions` and `PropertyDescriptor`,
both `lib.d.ts`, both declaring the name optionally — and agreed with node over
174 cases. Forcing the check to `false` left it agreeing over all 174: those
types were never candidates, so the fixture was measuring nothing. Deleted.

`blockers/an-optional-on-a-type-no-value-has` is what survives, and it carries a
**frozen copy of `validators.ts`** because the trigger could not be reduced.
Bisecting `buffer`'s seven imports names that file; truncating it moves the
answer at line 229, which is the closing brace of `validateAbortSignal`; and four
attempts to reproduce that function's shape on its own all failed — a `const`
generic over `readonly string[]`, nested assertion predicates, `in`-narrowing on
an `unknown`, and the abort-signal predicate itself. Truncation is localising how
much of the file typechecks, and therefore how much of its type table tsgo
emits, rather than localising a construct. Saying so is the finding; a smaller
fixture would have been a fixture for something else.

It asserts `once-c static bool hasArrayLikeShape(NtsValue v0) {` rather than
`lowers`, because the copy refuses twenty things that are not the subject and a
guard tied to those goes red on somebody else's progress. The function's body is
one `return "length" in value`, so a definition in the emitted C is exactly the
question. Controlled both ways: forced false, `emitted 0 time(s), not once`.

The other two were the same night's. `examples/in-on-an-object-a-native-answers-for`
dispatched on `n % 10` and **no value in the differential's pool is congruent to
4 modulo 10**, so the `Promise` receiver was never built. And an expectation
written without the `emit-c --napi ->` prefix ran `nts hir` and reported FIXED
for a construct that always refuses.

All three passed while measuring nothing. None was found by reading it. Each was
found by forcing the answer and watching what did not change.
