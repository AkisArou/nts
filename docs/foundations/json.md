# JSON

How `JSON.stringify` and `JSON.parse` are compiled, and what they promise. The
output must match node's byte for byte; the cost must beat node's and Bun's.

## Writing: `JSON.stringify`

A typed program has already answered the questions the specification's
`SerializeJSONProperty` asks of each value at run time. So
`JSON.stringify(x)`, where the program states `x`'s type, becomes a writer the
compiler generates for that type, as ordinary HIR, which every backend runs
unchanged (`compiler/core/src/hir/lower/json.rs`):

- an object writes its keys as constants the compiler quoted (`{"id":`,
  `,"name":`) and each member by its type's rule; a nested object calls its
  type's writer, and an array loops over its element's;
- a number writes its shortest digits, and `null` where it is not finite;
- a string is quoted by the runtime's escape kernel where the backend has one
  (`nts_json_quote` on C and LLVM, SIMD), and by a generated loop elsewhere;
- a reference that may be `null` writes `null`; absent or `undefined` members
  are omitted, and an `undefined` array element writes `null`.

Each concatenation becomes an append in place, so the output is one string,
written once.

## Reading: `JSON.parse`

The global `JSON.parse` is not provided today (NTS1100). The design:

- **`JSON.parse(text) as T`** is a parser the compiler generates for `T`. It
  reads the text once and builds `T`'s layout directly, with no intermediate
  tree. A text that does not match `T` throws a `TypeError` naming the JSON
  path; invalid JSON is always a `SyntaxError` first.
- **Key order and undeclared keys** are kept only where the program can
  observe them.
- **A class as `T`** is refused for now; plain object types only.
- **On native,** simdjson's scanner finds the structure (its C++ runtime is
  linked statically, about +0.6 MB per program), and nts's own scan handles
  non-ASCII strings. There is no nesting-depth limit beyond memory.
- **On the JVM,** the same generated parser runs over Java kernels.
- **On Wasm,** the generated parser reads the text after one copy into a GC
  `i16` array (proposal W8, [JVM and Wasm](jvm-and-wasm.md)).
- **An untyped `JSON.parse`** (`any`, `unknown`) needs a representation for
  untyped values that is still to be designed.

`runtime/web-platform` holds a specification-exact JSON parser in TypeScript
(G9 in [open questions](../open-questions.md)). A program can import it as
ordinary code, and it is the oracle for the generated parsers.

## Decisions

- Parsing typed JSON, the errors, key order, a class as `T`, simdjson linked
  statically, nts's own non-ASCII scan, and no depth limit:
  [log](../records/notebooks/decisions-log.md#numbers-and-json-10-22).
