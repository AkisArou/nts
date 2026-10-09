# Native declarations

The hand-written `libc.d.ts` contains ambient modules such as `c:stdlib`,
`c:math`, and `c:stdint`. Include this declaration file in the compilation;
no `paths` mapping or per-header configuration is required. Functions and
types enter scope only through imports. Compiler-wide automatic loading is
not implemented yet.

```ts
import { abs } from "c:stdlib";
import * as math from "c:math";

export function calculate(n: number): number {
  return abs(n | 0) + math.sqrt(4) + 0.25;
}
```

The numbers in these declarations are kinds from `@nts/scalars`
(`scalars.d.ts`, which `libc.d.ts` references): `c_int`, `Float64`, `Uint8`,
`AsNumber<c_size_t>` and the rest. Each is the C ABI the declaration states. A
kind is a `number` -- or a `bigint`, where every bit of a 64-bit integer is
wanted -- with an optional label, so a plain number is written where one is
wanted, with no cast, and a result needs no `as number`. nts checks the label
instead: a number reaching a C integer or float must be proven one of the
kind's values, or the build stops (NTS5001). `n | 0` is proven an `int`; an
`as` is accepted only where nts proves it. A 64-bit integer handed over as a
number (`AsNumber<C>`) is exact, and a `RangeError` past 2^53. A label has no
run-time value, and reading one is refused. `docs/scalar-numbers.md` has the
whole design.

The initial declarations target LP64; generated C checks `int`, `long`, `size_t`,
and `ptrdiff_t` widths. Link the C library and `libm` where required. The scalar
tests compile the foreign implementation separately and check the curated
libc declarations alongside the system headers with compiler builtins disabled.

C and LLVM emit the scalar ABI from the same declaration facts. LLVM tests
also compare scalar widths and extension attributes with clang's independently
compiled C definitions. LLVM's managed C aggregate calls currently target the
AMD64 System V ABI, including whole-aggregate stack placement when integer
argument registers are exhausted.

NTS host bridges opt into the managed calling convention on each declaration:

```ts
/** @ntsAbi managed */
declare function hostRead(name: string): string;
```

This convention passes numbers as `double`, strings as `NtsString *`, arrays
as `NtsArray *`, objects and closures as `NtsHeader *`, `bigint` as `__int128`,
and `unknown` as `NtsValue`. A closure is a managed object invoked through its descriptor; it is
not a C function pointer. Arguments are borrowed for the call; a host retaining
one must retain it, and a managed result transfers a reference to the caller.
The annotation does not prove absence of mutation or retention. The compiler
keeps exposed storage conservative and retains callbacks reachable from it.
Compile generated C with the host's own header visible to check the authored
signature against the implementation. Unknown ABI tags are refused.

Compiler-owned runtime intrinsics use `@ntsAbi intrinsic` instead. That requests
an entry from the selected backend's intrinsic table; it cannot import an
arbitrary C symbol. JVM provider declarations use this path, while C host bridges
use the managed convention above.

Opaque C handles use `Opaque<"Counter">` imported from `c:types`, where `Counter`
is the C struct tag. A foreign constructor can return `Opaque<"Counter"> | null`;
locals, parameters, returns, null checks, equality, and closure captures preserve
the pointer and its pointee identity. See `examples/interop/c-from-ts` for a
complete separately compiled C library and caller.

Opaque handles have no managed header and receive no automatic retain, release,
or tracing. Destruction remains an explicit library call. The owner must keep a
captured handle alive for every closure use. Boxing into `unknown`, numeric
conversions, property reads, forged object literals, and runtime containers of
handles are refused. Node-API and JVM do not marshal opaque C pointers.

Native scalar/struct access, `addrOf`, `local<T>(count)`, `sizeof<T>()`, typed
`malloc<T>(byteCount)` and `free` are described in
[the native operations contract](../../docs/native-operations.md). The
[poll example](../../examples/interop/native-poll/src/main.ts) uses local, fixed
array, and heap request storage. Local addresses cannot escape; foreign borrowing
uses the declaration's `@ntsNoEscape` contract. General heap ownership remains
manual.

C function-pointer callbacks, variadic functions, structs by value, and
ResourceFlow ownership checking remain outside the implemented surface.
