# A name taken from a node's text, and not its type

    for (let i = 0; i < buf.length; i++) buf[i] = f(source[i]);

    NTS1001 `i`, which `UnknownArrayLike` does not declare

A sentence about the *loop counter's spelling*, said of a type. `i` was never a
member anywhere.

`names_a_property` asked `literal_name(index).is_some()`, and `literal_name`
answers for any node carrying text — an identifier carries its own. So
`source[i]` took the property path and looked for a member called `i`.

## Three defects, one cause, found from one question

The queue said `string_decoder` needed the class arm to publish **accessors**.
It does not: `member_kind` maps `get x()` to a napi getter and `field_accessors`
synthesises one per instance field, both already there. **The accessor question
is answered and it was not the blocker.**

What blocks it is that `StringDecoder#constructor` calls `Buffer.alloc`, and
under that: `Buffer#fill`, `Buffer.from`, `objectToBuffer`, `fromArrayLike`, and
`source[i]`. The module has **zero own-source root refusals** and publishes
nothing, entirely through that chain. It is 0 of 5, not 4 of 5.

Asking that question turned up three separate defects, each a name taken from
the wrong place:

**An index's name is its type, not its text.** `literal_name` returns the
variable's spelling. The checker has already given `key` the type
`Literal(String("readableHighWaterMark"))`, which is one name and the right one
— `indexed_member_name` asks it. Only in an index position: a *shorthand*
property `{ a }` is an identifier whose text **is** the name while its type is
whatever `a` holds, so consulting the type there would be the same mistake
pointing the other way.

**An index that names no single member is not a property at all.**
`names_one_member` asks whether the checker gave the index one value — a literal
or a `unique symbol`, whose whole purpose is to be one member name. An ordinary
`number` is computed, and `source[i]` now says `indexing `UnknownArrayLike`,
which is not an array`, which is **true**.

**A computed field name was never initialized.** `class Keyed { [kTag] = 7 }`
answered **0** where node answers 7, with nothing refused and nothing emitted.
`initialize_fields` resolves a quoted or numeric name through `literal_name`, and
a computed one is not a literal at all — the layout holds it under the generated
`__@kTag@2` that `symbol_member_name` produces. That is the **third** spelling of
one member name to be silently skipped there, after the quoted and numeric ones
in record 0275.

Found by an example written for the *first* defect. A control for one thing
running a neighbouring thing for the first time is the third time that has
happened in two days.

## What it moved

`getHighWaterMark` lowers, and so do `ReadableState#constructor` and
`Readable#constructor` — the chain `blockers/a-key-held-in-a-variable` was filed
against, carrying **249 failing test files in `stream`, 59 of them stopping at
`Readable is not a constructor`**.

`Readable` still does not publish, and the reason moved: it is now
`EventEmitter#emit`, which the backend refuses because
`callback.call(this, ...args)` rebinds a closure's receiver. **That is the same
construct `http.createServer` now waits on.** The two largest concentrations in
the tree are one construct apart, and it is a representation decision — our
closures capture `this` as a field — so it is filed rather than started.

## The queue's other two items, checked against the corpus

**The `process` global collision is stale.** `version`, `platform` and
`environment` emit as functions only; no variable of those names reaches the C,
and clang reports no redefinition. `process` builds, loads and publishes.
Confirmed rather than assumed, which is what the goal asks for before building
anything a document names.

**The napi export pass already keeps the specific reason.**
`report_unrepresentable_exports` skips any name already in `skipped`, with a
comment saying why — "a specific reason already given is the better one, and
this pass cannot improve on it". Re-deriving was fixed before this session.

## What is left, named

`options[key]` where `key: "a" | "b"` names two members and would need a branch
on which arrived. `blockers/a-key-held-in-a-variable` says so and its table is
corrected: the second row was "a single literal, still refuses" and is now
"compiles".

`UnknownArrayLike` — an interface whose members are `length` and a numeric index
signature — has no array representation.
`blockers/an-index-signature-is-not-an-array` states the three storage shapes
behind that one type and why choosing at compile time would be right for two of
them.
