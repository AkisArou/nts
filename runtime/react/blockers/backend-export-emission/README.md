# LLVM and JVM export emission

## Reproduction

```sh
npm run --prefix runtime/react representation:probe
```

At NTS commit `70522ab7491986072f2d719862702c03c5e51106`, the shared fixture
produces four verified exported functions in HIR and four global functions in
optimized C assembly. `emit-llvm` exits successfully but its 3,975-byte module
contains descriptors and declarations with zero function definitions.
`emit-jvm --text` exits successfully but lists only constructors for the two
record shapes and `nts/gen/Program`; it contains none of the four exported
methods.

## Expected interface

Both backends should either emit callable definitions for
`typedHookReads`, `erasedHookReads`, `typedAlternatingReads` and
`erasedAlternatingReads`, or report a refusal for every function they cannot
represent. A successful artifact with no entry methods cannot be benchmarked
or used as a React runtime.

The React experiment needs stable exported-call ABI metadata for typed and
erased parameters, plus enough textual or object output to count boxing,
unboxing, tag tests, allocations and indirect calls. Backend parity tests must
invoke the functions and compare results before their timings are accepted.
