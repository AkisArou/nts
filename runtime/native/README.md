# Native declarations

The hand-written `libc.d.ts` contains ambient modules such as `c:stdlib`,
`c:math`, and `c:stdint`. Include this declaration file in the compilation;
no `paths` mapping or per-header configuration is required. Functions and
types enter scope only through imports. Compiler-wide automatic loading is
not implemented yet.

```ts
import { abs } from "c:stdlib";
import * as math from "c:math";
import type { c_int, c_double } from "c:types";

export function calculate(n: number): number {
  return abs(n as c_int) + math.sqrt(4 as c_double) + 0.25;
}
```

Branded parameters identify the declared C ABI. The compiler inserts conversions
at foreign calls; TypeScript functions and arithmetic retain ordinary `number`
semantics. Results need no `as number` assertion. An assertion does not validate
range: values must be representable by the requested C conversion. The 64-bit
integer brands retain JavaScript number precision, so large C results can round.
Brand properties have no runtime value and their reads are refused.

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

The inbound milestone is still in progress. Opaque handles and validation of
the repository's managed Node host integration remain.
C function-pointer callbacks, variadic functions, structs by value, pointer dereferencing, and
ownership checking are outside this milestone; these files do not claim them.
