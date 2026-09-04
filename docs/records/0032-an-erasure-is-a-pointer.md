# 0032 — An erasure is a pointer, and four places forgot

A correctness bug in escape analysis, found while closing an unrelated refusal.
Any function returning `SomeObject | null | undefined` handed its caller a
pointer into a dead stack frame, with the object's reference fields already
freed. It was not reachable by any example in the tree, and it had been there
for as long as two absences have selected the erased representation.

## What it emitted

```ts
class Held {
  label: string;
  constructor(v: number) { this.label = "h" + String(v); }
}

function either(n: number): Held | null | undefined {
  if (n < 10) return null;
  if (n < 20) return undefined;
  return new Held(n);
}
```

```c
static NtsValue either(double v0) {
b4:;
    v7_frame.header.descriptor = &nts_desc_NtsObj_Held;   /* the frame */
    v7 = &v7_frame;
    Held__constructor(v7, v0);
    v9 = nts_value_of_reference((NtsHeader *)v7, NTS_TAG_OBJECT);
    v11 = v7->label;
    nts_release((NtsHeader *)v11);                        /* the walk */
    return v9;                                            /* and both */
}
```

Two defects and one cause. The object is placed in the frame, so the caller
receives `&v7_frame` — storage that ends with the call. And because it is a
frame object, the emitter also runs the reference-field walk at the end of its
live range, which frees `label` before the caller has read it.

The same function returning `Held | null` is correct, and that is the tell: one
absence is a pointer, so there is no erasure. Two absences need a tag, and the
tag is what hid the pointer.

## The cause

`escaped()` in `hir/escape.rs` follows the erase chain, and its doc comment
describes this exact failure: "marking only the erasure left the payload looking
frame-local, which is a pointer into a dead frame wherever the slot outlives the
function." It was right, it was written down, and four places did not call it —
marking the value with a bare `escapes.values.insert` instead:

- `Terminator::Return(Some(value))`, which is this bug.
- Both arms of `hand_on` that give up on a block parameter.
- `escape_into`, for an argument a callee lets escape.
- `OpKind::Suspend`, for a promise and a coroutine frame.

The last four were not reached by anything in the tree; they are the same defect
and are fixed for the same reason rather than because a case found them. What
makes them one defect is the shape: a value marked escaped by hand is a value
whose payload was not.

So the rule is now stated where it can be read: no site marks a value escaped by
hand, there is one door, and the four examples above are in its doc as why.

## How it was found, which is the part worth keeping

Not by a test for it. `examples/absent` covers `string | null | undefined`,
`number | null | undefined`, both absences in a `Map`, `typeof` across every
tag — and none of that allocates an *object*, so no example in ninety-one
returned one through two absences.

It surfaced because closing the `v?.length` refusal (record 0031) made
`held?.label` expressible, and the case written to prove *that* used a class.
The example agreed with node under the default allocator and failed under
`NTS_RC=1`, which is the only configuration that frees anything: under the bump
allocator the dead frame is never reused and the released label is never handed
back, so the wrong program prints the right answer.

Then the bisect said the opposite of what the change suggested. Narrowing by
hand — `h !== null && h !== undefined ? h.label : "-"` — fails identically, with
no `?.` anywhere in it. The refusal I had just closed was not the cause; it was
the reason a shape nobody had written finally got written.

Two lessons, and only the second is new. The first: `rc.sh` is the step that can
observe a lifetime bug at all, and a correctness gate that never frees is a
gate that cannot see one. The second: the coverage gap was not in the operator,
it was in the *value*. Ninety-one examples exercised two absences over every
primitive and never over an object, because an example covers what somebody
thought to write down. The sweep exists for exactly that reason and does not
reach here: it produces values and applies operations, and "a class instance
inside a two-absence union, returned across a call boundary" is a shape it does
not build.

## Cost

Nothing measurable. All 23 memory cases stay at both floors — the objects this
moves to the heap are ones that were never legally on the frame, and no case in
the suite returns one.
