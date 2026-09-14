# native-copy

`*destination = *source` — one whole aggregate, moved.

    copy(destination, source);

## Why it is an operation and not an assignment

A record member projects as `Ptr<T>`, deliberately: `p.inner` is the bytes that
are there, not a duplicate of them, so `p.inner = q.inner` is a *pointer*
assignment and reads like one. There is nowhere in the surface to write a copy,
so copying is a named thing.

`Ptr` on the destination and `ConstPtr` on the source — C's own
`memcpy(void *restrict, const void *restrict, size_t)` minus the size, because
the size is the type's and both sides share the type. **Overlap is undefined**,
as it is for `memcpy`; nothing here checks it.

## The one check that separates a copy from a pointer

`struct sample` is two nested structs, an inline array of eight, and a double —
32 bytes, so a copy has to move more than one word and more than one member.
Then `copyThenDivergeSource` does the thing that matters:

    copy(destination, source);
    if (sample_equal(destination, source) === 0) return -1;
    sample_fill(source, seed + 100);          // the source becomes something else
    if (sample_equal(destination, source) !== 0) return -2;   // and this must not follow

**A pointer assignment passes every check before that line and fails it.** The
equality check alone proves nothing: two names for one object are equal.

Both sabotages were tried by changing the emitter and rebuilding:

| the emitter emits | the example |
|---|---|
| nothing | fails |
| `memcpy(d, s, 4)` | fails |
| `*d = *s` | passes |

`copyOneMember` is the second shape: `copy(b.origin, a.origin)` moves eight
bytes out of the middle of one object into the middle of another, and asserts
that `extent` — the member beside it — did *not* move.

## What each backend emits

    *v2 = *v1;                                                    /* C */
    call void @llvm.memcpy.p0.p0.i64(ptr align 8 %v2, ptr align 8 %v1, i64 32, i1 false)

C's own aggregate assignment rather than a `memcpy` with `sizeof`: the size is
a number `program.c` has already asserted against the C compiler, and restating
it would be a second derivation of one fact. The LLVM side has no struct type
to assign — every address there is a byte GEP — so it names the size and the
alignment, both from the same layout.

## Build

    sh examples/interop/native-copy/build.sh
