# 0003 — What TypeScript information the frontend extracts

Status: complete for the features that change emitted code
Recorded: 2026-08-26

The compiler's value proposition is that TypeScript's types let it emit exact
machine code where a dynamic runtime must box, tag and check. That only pays if
the information is actually extracted, so this records what is and what is not.

The criterion throughout is **does this change emitted C, LLVM IR, or JVM
bytecode** — not "does TypeScript have it".

## Extracted

| Feature | What it decides |
| --- | --- |
| Primitives, literal types | machine types and immediates rather than boxes |
| Type at every node | representation per expression |
| Symbols, binding identity, declaration sites | a use resolves to its definition |
| Module exports, compiled file set | ABI surface; reachability roots |
| Diagnostics | refuses to compile a program that does not typecheck |
| Object members, own vs inherited | JVM `field_info`; base-first field offsets |
| readonly, by keyword **and** by mapped type | `ACC_FINAL`, `const`, no write barrier |
| Optional properties | presence bit or undefined slot |
| Index signatures | rules out a flat struct entirely |
| Tuples | fixed arity, so a flat layout instead of pointer + length |
| Arrays | element type rather than the prototype |
| Unions, intersections | tag representation |
| Call signatures: params, optional, rest, return | JVM descriptors, C prototypes |
| Construct signatures | `new` expressions |
| Call targets, overloads resolved per site | a static call instead of a dispatch |
| Type predicates, including `asserts` | narrowing, so a dispatch becomes direct |
| Accessors | a call, not a field load |
| Generic type parameters and constraints | what monomorphization specializes over |
| Conditional, indexed-access, template literal types | no longer opaque placeholders |
| Enum constants; const-enum reads | immediates; const enums *must* fold |
| Modifiers: static/abstract/async/visibility/declare | JVM access flags; async lowering |
| `let`/`const`/`var` | immutability without proving it |
| Heritage: `extends` vs `implements`, base types | `super_class`, vtables |
| Assignability | a question, asked where a coercion might be needed |
| TSX | needs nothing special; JSX nodes and element types come free |
| Spans, provenance | debug maps, DWARF, source-level errors |

## Deliberately not extracted

| Feature | Why |
| --- | --- |
| Decorators | RFC does not require them; `experimentalDecorators` stays off |
| Namespaces | merged declarations are already handled; the namespace object is not a lowering target |
| `keyof T` and remaining exotic types | recorded as `Structured { flags }`; no lowering needs them yet |
| Template literal placeholder *types* | the literal segments are kept; the placeholders are not answered by any endpoint |
| Default library, package `.d.ts` | the boundary the compiler does not lower past (RFC §14) |

## Things the API does not say plainly

Each cost a wrong first attempt and is now pinned by a test.

- **readonly needs two sources.** `CheckFlagsReadonly` is set only on *computed*
  symbols, so it catches `Readonly<T>` and misses `readonly host: string`. The
  declaration modifier catches exactly the opposite case.
- **Parameter optionality is in the AST**, not on the symbol.
  `getParametersOfSignature` sets neither `SymbolFlagsOptional` nor
  `CheckFlagsOptionalParameter`; the `?` is a `QuestionToken` child. Rest-ness is
  only on the signature.
- **`SignatureResponse::parameters` ids are unusable.** They come from
  `symbolHandles`, which never registers them, so every symbol endpoint rejects
  them. `getParametersOfSignature` registers, and carries names too.
- **`getConstantValue` folds const-enum reads only.** An ordinary enum has a
  runtime object and TypeScript deliberately emits a property access.
- **`getBaseTypes` answers the base class only.** `implements` clauses come from
  the AST heritage clause, discriminated by node data bits.
- **`getConstraintOfType` panics the server** on a type parameter — its handler
  does an unchecked `AsSubstitutionType` cast. Use
  `getConstraintOfTypeParameter`, which takes a different parameter shape.
- **A template literal's segments arrive once.** They are on the type response
  and answered by no endpoint, so they must be captured at classification.
- **A tuple is array-like and object-like.** Whichever test runs first claims it,
  and the array path loses the arity that makes a flat layout possible.
- **A prefix unary operator is a dense index, not a `SyntaxKind`.** The encoder
  documents the six small bits as holding "the operator's SyntaxKind value (e.g.
  `PlusPlusToken=45`, `TildeToken=54`)" and asserts at startup that
  `KindLastUnaryOperator` fits in them. `encoder_generated.go` then writes
  `0..=5`, and `decoder_generated.go` reads it back with `commonData & 7`. A `-`
  arrives as `1`. Believing the prose rejects every unary expression; believing
  it and being lenient reads `!` as `~`, which still compiles.
- **A `PrefixUnaryExpression`'s operator is not a child node.** A
  `BinaryExpression` holds a real `OperatorToken` node, so a child walk finds it.
  The unary operator is a struct field, so a child walk finds only the operand.
