# 0199 — Three repairs, one number, and the index underneath

    BrokenBase { layout: "Duplex", base: "Readable" }
    BrokenBase { layout: "ReadStream", base: "Readable" }

`node:process` stopped verifying the hour it gained `net` and `fs`. Not
`stream`, not `net`, not `http` — only the program in which all of them meet.

`nts layouts`, added for this, says what the message cannot:

    BROKEN Duplex over Readable
      base   _readableState __@captureRejectionSymbol _events _eventsCount ...
      layout __@captureRejectionSymbol _events _eventsCount ... _readableState _writableState ...

`Readable` came back with **its own** `_readableState` ahead of the
`EventEmitter` fields it inherits. `Duplex` and `ReadStream`, which extend it,
came back with the inherited ones first. Both are consistent flattenings of one
hierarchy and only one of them is a layout.

`fields_of` builds a class's fields from the checker's flattened property list
and trusts that list to be base-first. **It is not guaranteed to be**, and the
guarantee had held for every program until three modules were linked together.

## Three repairs, and they all cost the same thousand

    take the base's fields as the prefix, filter the rest by `own`   +1,017
    same, de-duplicated by name instead of by `own`                  +1,002
    take only the base's ORDER, keeping every field and its type     +1,002

Three implementations with different bugs would not agree to the digit. The
number is what they share, and what they shared was calling `layout_of` for the
base from inside `fields_of` — which does not merely *read* a layout, it
**creates** one, and `collect_layouts` merges in creation order with a declared
name beating a generated one. Asking earlier changes which layouts exist when a
merge is decided, everywhere in the program.

So the repair was moved out to a pass over finished layouts, reordering nothing
but positions. **It cost the same thousand again.**

## `OpKind::FieldGet { field: u32 }`

The field is an **index**.

Every field access in the program is a position into the layout, assigned during
lowering. A pass that reorders fields afterwards invalidates all of them —
silently, because an index that is still in range still loads something.

That is record 0196's lesson exactly one day later and one type over. There the
renumbering was `BlockId` and the thing that did not travel with the terminators
was a handler id inside an operation. Here it is the field index, and it is
inside every operation that touches an object.

The two are the same rule and it is worth stating plainly: **an index is an
identity that is not written down anywhere near the thing it identifies.** A
`BlockId` lives in terminators and in one `Await`. A field index lives in every
`FieldGet` and `FieldSet` in the program. Neither is findable from the
definition of the thing being renumbered.

## What is left, and what it needs

Reverted. What survives is the diagnosis, the instrument, and the constraint the
next attempt has to satisfy:

  - reordering during construction perturbs merge order and costs a thousand
    refusals — measured three ways;
  - reordering afterwards needs every `FieldGet` and `FieldSet` remapped, per
    the layout the access is typed against, which is derivable from the
    object's type and is not free;
  - the base-first invariant is what makes an upcast a no-op pointer cast, so
    it is not optional; `verify::check_layouts` is currently the only thing
    holding it and it holds it by refusing rather than by construction.

The honest ordering is: remap first, as its own change with its own evidence,
and reorder second. Doing them together is how a thousand refusals get
attributed to the wrong half.

## What to take

Three attempts agreeing on a number is data. It says the thing they share is the
cause, and none of the three differences is — which is a stronger statement than
any single measurement, and it was available after the second one.

I took the third measurement anyway, and then a fourth after moving the pass,
before asking what all four had in common. The question "what do these have in
common" was cheaper than any of them and I asked it last.
