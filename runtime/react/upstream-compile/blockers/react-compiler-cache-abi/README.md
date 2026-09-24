# React Compiler cache ABI

## Reproduction

```sh
npm run --prefix runtime/react compiler:probe
npm run --prefix runtime/react compiler:native
```

The fixture is real output from the pinned React Compiler. The recovery pass
restores its source types, gives its evolving locals concrete annotations,
specializes `_c(6)` to a six-element tuple and lowers JSX to a typed `jsx` call
for this probe. NTS HIR lowers `Counter` and its closure completely.

The tuple has concrete HIR fields: number, closure, string, closure, number and
element. Cache access uses `field.get`/`field.set`; the cache itself has no
`erase`, `tag.of` or `unerase`. Only the mixed string/number JSX children array
uses erased elements.

The C backend emits the 72-byte `Tuple9` layout but omits `Counter` with
`NTS2010`: the external generic call `c<obj9>` returns a program-specific tuple
that the ordinary external ABI cannot name. LLVM currently emits descriptors
and declarations but no function definitions. JVM emits the involved classes
and constructors but no callable methods.

## Required interface

Treat `_c<const N, Slots>(N)` as a trusted React Compiler intrinsic rather than
an ordinary external generic function. Its backend ABI can be equivalent to:

```c
void *nts_react_memo_cache_get(
    uint32_t cache_index,
    uint32_t slot_count,
    const NtsDescriptor *slot_layout);
```

The generated call site knows the program-local `Slots` descriptor and casts
the returned allocation to that exact layout. The runtime owns lookup through
the currently rendering component, mount initialization, copy-on-write from the
current Fiber, render-attempt indexing and commit/discard behavior. A descriptor
mismatch must trap rather than reinterpret memory.

The intrinsic must preserve upstream's atomic-write assumption and current
`enableNoCloningMemoCache` choice. With the present false flag, an update clones
the committed cache for a render attempt, and an interrupted attempt cannot
publish partial writes. A slot whose reaching writes disagree falls back to a
checked erased field without widening the other slots.

The fast path must allocate no array wrapper, perform no per-access descriptor
check after the cache frame has been validated, and expose literal-index fields
to HIR so C, LLVM and JVM retain the direct layout shown by this probe.
