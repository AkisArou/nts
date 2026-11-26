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

**`JSON.parse(text) as T`**, `T` a plain object type, is a parser the compiler
generates for `T` (`compiler/core/src/hir/lower/json_parse.rs`). On C, LLVM
and the JVM it is built; on Wasm it is declined by name until its kernels
exist.

- **One boundary decision.** `typed_parse` says a node is this boundary: the
  global `JSON`'s checked `parse` (a `JSON` the program declares is its own),
  one argument typed `string`, and an assertion (`as T`, `<T>`) to a plain
  object type. The cast-face collector, assertion lowering and synchronous
  effects all read that one answer, so this cast makes no face and `T` keeps
  its own layout everywhere else. Any other cast of an erased value keeps its
  face and its field-family reads.
- **The whole text is checked first.** The runtime's scan
  (`runtime/c/nts_json.c`) validates the complete grammar before any of `T` is
  read, so invalid JSON is always a `SyntaxError`, with V8's message word for
  word. It writes a tape: each value's kind, span, and for a container its
  end and count. Nesting is a heap stack: no depth limit beyond memory.
- **One reader per type**, ordinary HIR over the tape, building the layout
  directly with no intermediate tree. An object reader finds each declared
  key's last value (a duplicate key takes the final value, and only that one
  is checked), skips an undeclared value in one step however deep it is, and
  reads the members in declaration order. An array reader allocates the
  counted length. A number is read by the runtime's decimal kernel, a string
  copied once, unescaped where it has an escape.
- **A mismatch is a `TypeError` naming the JSON path**:
  `JSON.parse as Row: $.rows[3].id: expected a number, found a string`, or
  `...: missing the property "id"`. Readers never raise: they answer null with
  the message in the parse's failure cell, and the boundary throws in the
  function the program wrote.
- **Admitted members:** `number`, `string`, `boolean`, `null`, nested plain
  objects, arrays of admitted types, `X | null` and optional members. Refused
  by name: a class as `T`, methods and accessors, literal, enum and other
  union types, tuples, `Map`, `Date`, `bigint`, a top-level array, and a
  recursive type, whose depth the type does not bound.
- **Key order and undeclared keys** are kept only where the program can
  observe them. A reader keeps neither, so a parse whose results the program
  can observe that way is refused by name. Observers are own-key reflection
  (`Object.keys` and its family, `Reflect.ownKeys`, `hasOwnProperty`,
  `for...in`, object spread, `in`, an object pattern's rest element) and what
  can reach one unseen (`JSON.stringify`, `console`, a native call, an
  export's value or result, a store into an `any` or `unknown` place). An
  operand counts when its type is a produced type, one a produced object may be
  assigned to (every member it requires, other than what every object
  inherits, is one a produced type has), or one the type does not decide
  (erased, generic, indexed). A `const` built of
  literals that the program never lets go of is no parse's result and does not
  count.
- **On native, simdjson's scanner** finds the structure of one-byte ASCII
  text (its C++ runtime linked statically, about +0.6 MB, only into programs
  that parse), and nts's own scan handles non-ASCII text. Today nts's scan
  serves every text.
- **On the JVM,** the same generated parser runs over Java kernels
  (`runtime/jvm/src/nts/rt/NtsJson.java`): `nts_json.c`'s grammar, tape and
  messages, unit for unit. The tape is a `number[]` in the program's own form
  (a bare `double[]`, or an `NtsArrayD` where arrays grow), and each kernel
  takes either. A number is Clinger's exact fast path where it applies, and
  the JDK's correctly rounded `Double.parseDouble` otherwise.
- **On Wasm,** the generated parser reads the text after one copy into a GC
  `i16` array (proposal W8, [JVM and Wasm](jvm-and-wasm.md)).
- **An untyped `JSON.parse`** (`any`, `unknown`) is served by the TypeScript
  parser below until the compiler has an untyped parser of its own, whose
  representation for untyped values is still to be designed. It is not
  provided yet (NTS1100).

`runtime/web-platform` holds a specification-exact JSON parser in TypeScript,
which moves to `runtime/ecmascript` ([builtins](builtins.md#decisions)). A
program can import it as ordinary code, and it is the oracle for the
generated parsers.

## Decisions

- Parsing typed JSON, the errors, key order, a class as `T`, simdjson linked
  statically, nts's own non-ASCII scan, and no depth limit:
  [log](../records/notebooks/decisions-log.md#numbers-and-json-10-22).
- Typed parsing is one boundary decision read by casts, assertions and
  effects; the whole text is checked first; a parse whose objects' key order
  or undeclared keys the program can observe is refused by name until those
  are kept (#1037, 11-26,
  [log](../records/notebooks/decisions-log.md#typed-jsonparse-on-c-and-llvm-11-26)).
- The TypeScript JSON parser serves an untyped `JSON.parse` until the compiler
  has its own untyped parser, and then becomes the test oracle (G9; 10-28,
  [log](../records/notebooks/decisions-log.md#builtins-and-globals-10-28)).
  Not built: no untyped `JSON.parse` is provided yet.

## Rows

### json

- `awfy-json`
- `jetstream-json-parse-inspector`
- `jetstream-json-stringify-inspector`
- `json-build-append`
- `json-build-join`
- `json-parse`
- `json-parse-builtin`
- `json-parse-typed`
- `json-quote`
- `json-scan`
- `json-serialize`
- `json-stringify-builtin`
- `json-stringify-doc`
- `json-stringify-fused`
- `json-stringify-inline`
- `json-stringify-typed`
