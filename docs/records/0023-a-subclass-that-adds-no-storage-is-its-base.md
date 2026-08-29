# 0023 — A subclass that adds no storage is its base

`a base Uint8Array of unrepresentable type` was the largest refusal in the node
profile at 92 instances. All 92 are one declaration:

```ts
export class Buffer extends Uint8Array { … }
```

reported once per use site across eight modules. Counting distinct sites before
designing anything is what made the rest of this short.

## There is no `Uint8Array` to inherit from

It is not a class anywhere in this compiler, and `runtime/c` has no such type.
A typed array *is* `ManagedType::Array(u8)` — an `NtsArray` header followed by
its items inline — and the compiler emits array operations directly against it.

So the question was never "how do we model the base". It is only "what does the
subclass's own storage do to the layout":

```
NtsArray:      header │ items[]           items are inline, so they are last
an object:     header │ field │ field
a subclass
that adds one: header │ field │ items[]   a third layout
```

The third would make the item offset vary per type, so every array read in the
program — `NTS_ITEMS` — would consult a descriptor instead of a fixed offset.
That is a cost paid by all typed code to support one shape.

**A subclass that adds no storage needs none of it.** It *is* the array. Its
methods are ordinary functions taking that array as `this`, `new Bytes(4)` is
the allocation `new Uint8Array(4)` already was, and `this[i]` is the element
access it already was.

The rule is stated over any class descending from any typed array with no
fields of its own — `inherited_typed_array` walks the base chain the same way
`provided_error_base` does, and nothing anywhere mentions `Buffer`. The case
that stays refused is exactly the one that needs the third layout.

## Where the identity goes

Representing `Buffer` as `Array(u8)` throws away its type id, and method
dispatch needs it: `buf.fill(0)` reached the runtime's array helpers looking
for a method the program wrote.

The checker still knows. A representation says how the bytes are arranged and
nothing about what declared them, so the member is resolved from the type the
checker gives the *receiver node* rather than from the value's representation.
`lower_object_method` then works unchanged, because it resolves through the
hierarchy and only falls back to a layout.

## What was actually in the way

The rule fired on a hand-written fixture and not on `Buffer`, which had 63
properties marked `own`. One of them was `byteLength`, typed `number` — so the
class looked as though it declared a field.

`Buffer` declares `static byteLength(value, encoding)`. `own_member_names`
walks a declaration's members and collects their names **without excluding
statics**, so a static method marked the *instance* property of the same name,
inherited from `Uint8Array`, as one the class declares itself.

That is a general bug and not a `Buffer` one: `own` is what separates what a
class wrote from what the flattened property list inherited, and it decided the
`Error` path's fields by the same test.

## The measurement

The node profile: **504 lowered functions to 525**, and the 92 refusals to 0.

71 of 71 examples agree with node. The corpus is unchanged at 44, and `invalid
HIR` is still 0.
