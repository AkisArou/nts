# React Compiler native lowering

Measured against NTS commit
`f7271caf9b7820415d423d2d65501246377c8c79`.

The recovered Counter passes strict TypeScript and enters NTS after a
probe-local automatic JSX transform. HIR contains the exported `Counter`, its
captured callback and two callable interface stubs; nothing is refused. The
memo cache is a concrete six-field object and all six literal indices become
direct field operations.

| Stage | Current evidence |
| --- | --- |
| HIR | `Counter` lowers; typed cache fields; erasure only in mixed JSX children |
| C | emits a 72-byte cache layout, then `NTS2010` omits `Counter` at external generic `_c` ABI |
| LLVM | 5,475 bytes of declarations/descriptors, zero definitions |
| JVM text | nine classes with constructors, zero callable methods |

These results distinguish frontend success from backend success. The cache
layout is already specialized in HIR; the C issue is the runtime ABI for a
program-specific return record. `blockers/react-compiler-cache-abi/` specifies
the descriptor-carrying intrinsic required to keep that layout.
