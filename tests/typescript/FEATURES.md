# The TypeScript suite's concept index

Every case under `tests/typescript/<family>/` names the concepts it exercises
in its front matter's `features:` list, and the runner's report groups its
outcomes by them (`tooling/census/suites/typescript.ts`). This file is that
vocabulary: one row per tag, what it means, and where the concept comes from.
The `cases` column counts cases in this suite; `pending` counts cases in
`tests/typescript-pending/`, which node cannot be the oracle for yet (each of
its families has a `README.md` saying why).

A tag is `ts-<concept>`, lower case and hyphenated. Reuse a tag before adding
one; add a row here in the same commit as the first case that uses it.

## Where the concepts come from

1. **TypeScript's own conformance taxonomy**: the directories of
   `tests/cases/conformance/` in TypeScript's repository (classes, enums, es6,
   expressions, functions, generators, internalModules, types, decorators and
   the rest), read for concepts only. Bootstrap supplies the pinned corpus at
   `third_party/typescript/tsc/testdata/tests/cases/conformance/`.
   Written `conformance/<dir>` below.
2. **typescript-eslint's AST**: the TypeScript-only node kinds
   (`TSEnumDeclaration`, `TSModuleDeclaration`, `TSParameterProperty`,
   `TSAsExpression`, ...). Written `ts-eslint <Kind>` below.
3. **The typed paths a compiler like nts depends on**, where a type steers a
   value's representation: generics at each kind of type argument, interfaces
   with several implementations, unions and narrowing, tuples, numbers that
   stop being integers. Written `typed paths` below.
4. **The facts nts proves from code, and the routes that invalidate them**:
   bounds and lengths, numeric ranges and zero signs, element kinds, call
   targets and captures. Their sources are listed under
   [proof contracts](#proof-contracts); `ts-proof-*` names the fact and
   `ts-route-*` names how it changes.

5. **The lifetime facts nts proves from code**: frame and region homes,
   borrowing and moves, in-place reuse, acyclic graphs, disjoint loop
   slots and scalar replacement. [Lifetime contracts](#lifetime-contracts)
   name their sources; `ts-lifetime-*` names the fact and `ts-route-*`
   names the retention or observation route.

6. **Unicode data and context, held to the pinned node**: case mappings,
   RegExp properties and folding, normalization, URL hosts, locale case
   and grapheme boundaries. [Unicode contracts](#unicode-contracts)
   name the sources; `ts-unicode-*` identifies the area and test layer.

7. **Builtin identity through typed routes:** lexical declarations, asserted
   constructor types, stored values, subclasses, invocation forms and
   reflection. [Builtin identity contracts](#builtin-identity-contracts)
   name the sources; `ts-builtin-*` identifies the route.

A concept with no run-time effect (a type alias, an interface's existence, a
variance annotation) has no case of its own: it appears only where a value
flows through it.

## The families

| family | what it holds |
| --- | --- |
| `ambient/` | `declare` forms, which emit nothing and resolve to what the program provides |
| `async/` | async functions, methods and generators, promises, `for await` (`flags: [async]`) |
| `bigint/` | bigint arithmetic, conversions, widths, literal types |
| `builtin-identity/` | builtin declarations and runtime targets through TypeScript routes, with node as the oracle |
| `builtin-identity-controls/` | single-route counterparts using the builtin or direct operation, with node as the oracle |
| `classes/` | fields under define semantics, parameter properties, inheritance, abstract, private, static, accessors |
| `conversions/` | ToPrimitive under each operator, number and string conversions |
| `enums/` | numeric, string, const, heterogeneous, computed, merged enums and their objects |
| `errors/` | exceptions typed `unknown`, Error subclasses, finally |
| `expressions/` | assertions, `satisfies`, non-null, tagged templates and operators, all erased or evaluated as written |
| `functions/` | parameters, overloads, closures, `this` parameters, `length` and names |
| `generics/` | a matrix of six positions by eight kinds of type argument, then the facets of type parameters |
| `interfaces/` | dispatch through interfaces over classes and literals of different layouts, and the interface forms |
| `iteration/` | the iteration protocols, generators, iterator helpers |
| `lifetimes/` | lifetime facts followed by a retention or observation route, allocation churn and exact checks, with node as the oracle |
| `lifetimes-controls/` | single-change counterparts and measured findings for lifetime cases, with node as the oracle |
| `literal-types/` | literal types and the values they admit, `as const`, template literal types |
| `modules-and-exports/` | module code in one file (`flags: [module]`) |
| `namespaces/` | namespaces, their objects, merging and aliases |
| `objects/` | object literals and types, structural assignment, keys, spread, Record |
| `proofs/` | facts proved from code, followed by a route that can invalidate them, with node as the oracle |
| `proofs-controls/` | counterparts that remove one invalidating effect or callback throw from a proofs finding, with node as the oracle |
| `resource-management/` | `using`, `await using`, DisposableStack |
| `soundness/` | checker-accepted false type claims from variance, aliases and guards, with node as the oracle |
| `symbols/` | symbols as keys, unique symbols, well-known symbols |
| `tuples/` | tuples with optional, rest and labelled elements, readonly, variadic |
| `type-operators/` | values through keyof, typeof, indexed access, mapped and conditional types |
| `typed-paths/` | where a static type and the run-time value part ways, and where a number's representation shows |
| `unicode/` | exhaustive code-point blocks, contextual sequences and Unicode conformance inputs, with the pinned node as the oracle |
| `unions/` | unions and every way TypeScript narrows them |

Each family has one or more `combination-*.ts` cases pairing its concept
with others. The `soundness/` matrix instead uses `<route>-<place>-<read>.ts`
to identify each combination of an unsoundness route, storage and read.
The `proofs/` matrix uses `<fact>-<route>-<detail>.ts`: one fact and one
invalidation route per case, tagged with one `ts-proof-*`, one `ts-route-*`
and the existing container and syntax tags. A literal allocation, range or
guard establishes the fact before the route acts; several inputs exercise
the same code, and an exact assertion observes the result after the route.

The `lifetimes/` matrix likewise uses `<fact>-<route>-<detail>.ts` in place
of combination cases: one `ts-lifetime-*` and one `ts-route-*` tag per
case. A local allocation or ownership pattern establishes the candidate
fact before the route acts. Repeated rounds allocate more values after
the route, then check every retained field, object identity and exact
string contents and length. Async and generator cases keep their natural
syntax; a compiler refusal remains a finding.

The `unicode/` family uses `<area>-<detail>.ts` instead of combination
cases. Exhaustive cases include lone surrogates and assert a separate
32-bit FNV-1a hash over UTF-16 code units for each 4,096-code-point
block. Sequence and conformance cases use escaped input and expected
strings, with exact assertions and source-row diagnostics. Standalone
TypeScript generators under `tooling/unicode-cases/` produce expected
values with the node in `.tool-versions`; they require that exact Node
version and fixed Unicode/ICU data versions (also Ada for URL hosts).
They are not part of nts builds or runs.
A compiler refusal remains a finding and does not alter the case.

The `builtin-identity/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. Each case takes several inputs through one typed route
and observes the actual constructor, function or object with exact values,
side-effect counts or class identity. Its counterpart in
`builtin-identity-controls/` adds `-control` to the name and changes only the
route to the builtin or direct operation, with consequent expectations.
Only the cast area asserts an own value to a builtin type. Both members of
each pair must pass strict TypeScript and the suite's unchanged node oracle.
Compiler outcomes are recorded separately by the maintainers; a refusal is
a finding and does not change the case.

## Coverage, source by source

### TypeScript's conformance directories

| directory | where |
| --- | --- |
| ambient | `ambient/`; `declare const enum` in pending `transform-divergence/` |
| async, es2017 | `async/` |
| classes (abstract, classDeclarations, classExpressions, classHeritageSpecification, classStaticBlock, constructorDeclarations, indexMemberDeclarations, members, mixinClassesAndInterfaces, propertyMemberDeclarations) | `classes/`; auto-accessors in pending `accessor-fields/` |
| constEnums | `enums/` (`const-enum*.ts`); `declare const enum` pending |
| controlFlow | `unions/`, `functions/never-returning.ts`, `expressions/definite-assignment-let.ts` |
| decorators, esDecorators | pending `legacy-decorators/`, `decorators/` |
| dynamicImport, externalModules, importAttributes, importDefer | pending `modules/` and `commonjs-interop/` for dynamic import, elision, `export =` and `import = require`; import attributes and `import defer` need a JSON or a second module the one-file format cannot give, and have no case |
| enums | `enums/` |
| es2018 (async iteration), es2020 (bigint), es2021 (logical assignment), es2022 (class fields, private names, static blocks) | `async/`, `bigint/`, `objects/logical-assignment.ts`, `classes/` |
| es6 (arrowFunction, computedProperties, defaultParameters, destructuring, for-ofStatements, newTarget, restParameters, shorthandPropertyAssignment, spread, Symbols, templates, yieldExpressions) | `functions/`, `objects/`, `iteration/`, `symbols/`, `expressions/`, `classes/new-target.ts` |
| es7 (exponentiation) | `expressions/exponent-operator.ts` |
| expressions (asOperator, assignmentOperator, binaryOperators, commaOperator, contextualTyping, elementAccess, functionCalls, newOperator, nullishCoalescingOperator, objectLiterals, optionalChaining, superCalls, superPropertyAccess, thisKeyword, typeAssertions, typeGuards, typeSatisfaction, unaryOperators) | `expressions/`, `conversions/`, `objects/`, `unions/` |
| functions | `functions/` |
| generators | `iteration/`, `async/async-generator.ts` |
| interfaces (declarationMerging, interfaceDeclarations, interfacesExtendingClasses) | `interfaces/` |
| internalModules (codeGeneration, DeclarationMerging, exportDeclarations, importDeclarations, moduleBody, moduleDeclarations) | `namespaces/`; cross-block unqualified references in pending `transform-divergence/` |
| jsx | pending `jsx/` |
| override | `classes/override-*.ts`, `generics/override-generic-method.ts` |
| statements (tryStatements, labeledStatements, switchStatements, for-in, using declarations) | `errors/`, `iteration/labelled-loops.ts`, `resource-management/` |
| types (any, conditional, intersection, keyof, literal, mapped, never, nonPrimitive, objectTypeLiteral, primitives, rest, spread, thisType, tuple, typeAliases, typeParameters, typeRelationships, union, uniqueSymbol, unknown) | `type-operators/`, `generics/`, `tuples/`, `unions/`, `literal-types/`, `typed-paths/`, `objects/` |
| declarationEmit, directives, jsdoc, moduleResolution, node, nonjsExtensions, parser, references, salsa, scanner, typings | no run-time effect on a TypeScript program, or JavaScript-only: no case |

### typescript-eslint's TypeScript-only nodes

| node | where |
| --- | --- |
| TSEnumDeclaration, TSEnumMember | `enums/` |
| TSModuleDeclaration, TSModuleBlock, TSQualifiedName | `namespaces/` (the `module` keyword form is rejected by the pre-switch tsgo 7 and node alike, TS1540, so it has no case) |
| TSParameterProperty | `classes/parameter-*.ts`, `classes/override-parameter-property.ts` |
| TSAbstractMethodDefinition, TSAbstractPropertyDefinition, TSAbstractKeyword | `classes/abstract-*.ts` |
| TSAbstractAccessorProperty, AccessorProperty | pending `accessor-fields/` |
| Decorator | pending `decorators/`, `legacy-decorators/` |
| TSAsExpression, TSTypeAssertion | `expressions/as-*.ts`, `expressions/angle-bracket-assertion.ts` |
| TSSatisfiesExpression | `expressions/satisfies-is-erased.ts`, `literal-types/satisfies-keeps-literals.ts` |
| TSNonNullExpression | `expressions/non-null-*.ts`, `errors/calling-a-missing-method.ts` |
| TSInstantiationExpression | `generics/instantiation-expression.ts` |
| TSImportEqualsDeclaration | `namespaces/import-alias*.ts`, `namespaces/export-import-alias.ts`; the `require` form pending `commonjs-interop/` |
| TSExternalModuleReference, TSExportAssignment | pending `commonjs-interop/` |
| TSDeclareFunction, TSEmptyBodyFunctionExpression | `functions/overloads.ts`, `functions/method-overloads.ts`, `classes/constructor-overloads.ts`, `ambient/declare-function.ts` |
| TSTypePredicate | `unions/user-type-guard.ts`, `unions/this-type-guard.ts`, `unions/assertion-function.ts` |
| TSIndexSignature | `interfaces/*-index-signature.ts`, `classes/index-signature.ts`, `classes/static-index-signature.ts` |
| TSTupleType, TSNamedTupleMember, TSOptionalType, TSRestType | `tuples/` |
| TSMappedType, TSConditionalType, TSInferType, TSIndexedAccessType, TSTypeOperator, TSTypeQuery, TSTemplateLiteralType | `type-operators/`, `literal-types/` |
| TSCallSignatureDeclaration, TSConstructSignatureDeclaration, TSConstructorType, TSFunctionType | `interfaces/call-signature.ts`, `interfaces/construct-signature.ts`, `classes/abstract-constructor-type.ts`, `generics/constructor-type-parameter.ts` |
| PropertyDefinition with `declare`, `definite`, `optional`, `readonly`, `override` | `classes/declare-field.ts`, `classes/definite-assignment-field.ts`, `classes/optional-field.ts`, `classes/readonly-is-not-frozen.ts`, `classes/derived-field-redeclared.ts` |
| `this` parameter | `functions/this-parameter.ts`, `functions/function-length.ts` |
| TSNamespaceExportDeclaration (`export as namespace`), TSImportType, TSTypeAliasDeclaration, TSInterfaceDeclaration on their own, keyword types | no run-time effect: covered only through values that flow through them |

### Typed paths

| path | where |
| --- | --- |
| generics over number, string, boolean, a class, a union, a function, an array and a nested generic, in a function, a class, a method, an interface member, a constraint and a default | `generics/<position>-<kind>.ts`, 48 cases |
| interfaces: one implementing class, several in different field orders, an object literal | `typed-paths/interface-*.ts`, `interfaces/field-orders-differ.ts`, `interfaces/literals-in-different-orders.ts`, `interfaces/classes-and-literals-mixed.ts` |
| structural assignment between classes and literals | `objects/class-to-literal-type.ts`, `objects/literal-to-class-type.ts`, `interfaces/class-without-implements.ts` |
| unions and narrowing: typeof, instanceof, `in`, discriminants, type guards, assertion functions | `unions/` |
| tuples with optional, rest and labelled elements; readonly arrays and tuples | `tuples/` |
| index signatures and Record | `interfaces/`, `objects/record-*.ts`, `typed-paths/missing-record-key.ts` |
| optional, default and rest parameters; overloads | `functions/` |
| abstract classes, inheritance, `this` types, accessors, statics, `#x` and `private x`, protected | `classes/` |
| keyof, typeof, indexed access, mapped, conditional and template literal types | `type-operators/`, `literal-types/` |
| `satisfies`, `as const`, definite assignment, non-null | `expressions/`, `literal-types/`, `tuples/as-const-tuple.ts` |
| enums of every kind, merging | `enums/` |
| namespaces with values, nesting, merged with classes, functions and enums | `namespaces/`, `enums/merged-with-namespace.ts` |
| class fields under `useDefineForClassFields`, parameter properties and their order | `classes/` |
| `accessor` fields | pending `accessor-fields/` (node v24 cannot parse them) |
| `using`, `await using` | `resource-management/` (node v24 runs both natively) |
| async functions, generators, async generators | `async/`, `iteration/` |
| valueOf and toString under every converting operator | `conversions/`, `typed-paths/value-of-under-plus.ts` |
| BigInt | `bigint/` |
| symbols as keys, Symbol.iterator on a class | `symbols/`, `iteration/class-symbol-iterator.ts` |
| getters and setters on classes and literals | `classes/`, `objects/literal-accessors.ts` |
| closures over typed locals | `functions/closure*.ts`, `generics/closure-over-type-parameter.ts` |
| exceptions typed as `unknown` | `errors/`, `async/rejection-caught-as-unknown.ts` |
| numbers that stop being integers, -0, NaN, int32 operators, reads past the end | `typed-paths/` |

### Proof contracts

| source | concepts |
| --- | --- |
| [Objects, Arrays](../../docs/foundations/objects.md#arrays), including Typed arrays | range and same-array length proofs, allocation lengths, element kinds, array identity, and length-changing effects through calls, aliases and callbacks |
| [Numbers, Integers proved from doubles](../../docs/foundations/numbers.md#integers-proved-from-doubles) | intervals, whole numbers, NaN and negative zero, guards, joins, loop edges, stores, calls and truncated sums |
| [Language, Numbers](../../docs/language/numbers.md#number) | the JavaScript numeric results that every proof must preserve |
| [Objects, Calls](../../docs/foundations/objects.md#calls) and [Functions as values](../../docs/foundations/objects.md#functions-as-values) | known receivers and closure classes, dispatch signatures, captured cells and closure calls |
| [Language, Functions](../../docs/language/functions.md#this), including Methods | receivers, extracted methods, and call, apply and bind semantics with rest arguments, generics and dynamic argument lists |
| [Language, Closures](../../docs/language/functions.md#closures) | per-iteration bindings, writes in a loop body, and readers and writers that share one iteration's binding |
| ECMAScript [Function prototype methods](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-properties-of-the-function-prototype-object), [ForBodyEvaluation](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html#sec-forbodyevaluation) and [ForIn/OfBodyEvaluation](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html#sec-runtime-semantics-forinofbodyevaluation-lhs-stmt-iterator-lhskind-labelset) | supplied receivers and argument lists, bound argument prefixes, and separate mutable bindings for successive loop iterations |

The `proofs/` matrix covers seven facts through ten routes: loops, merges,
chains, calls, aliases, callbacks, accessors, conversions, exceptions and
suspension. Every bounds route has both past-the-end reads and a separate
in-range or append-after-shrink witness.

Proof cases use natural TypeScript, including forms nts cannot compile yet.
A current compiler refusal is recorded as a finding and can become a passing
case when the feature lands; it is not a reason to rewrite or omit the case.
The permanent exclusions are `eval`, `new Function` of a run-time string,
`with` and sloppy-mode code. Strict checking and node's exact answer remain
the admission criteria.

### Second proof family: effects in new positions

The second family adds 126 cases across the same seven facts, concentrating
on four routes that produced wrong answers in the first family. Each cell
below contains independent cases with several inputs and exact node answers.

| fact | implicit calls | static calls through `this` | function replaced in a loop | awaited `.then` throw | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| bounds | 8 | 4 | 3 | 3 | 18 |
| length | 8 | 4 | 3 | 3 | 18 |
| whole-number | 8 | 4 | 3 | 3 | 18 |
| negative-zero | 8 | 4 | 3 | 3 | 18 |
| element-kind | 8 | 4 | 3 | 3 | 18 |
| call-target | 8 | 4 | 3 | 3 | 18 |
| capture | 8 | 4 | 3 | 3 | 18 |
| **Total** | **56** | **28** | **21** | **21** | **126** |

Implicit calls appear in compound assignment, comparisons, successive
template interpolations, computed keys, the left operand of `in`, object
spread and destructuring defaults or assignment targets. They use class and
literal accessors, `valueOf`, `toString`, and class iterator acquisition or
generator `next` calls. Static overrides run through `this` in compound
operands, parameter defaults, destructuring defaults and resumed generators;
further subclasses change the receiver's fields, including class expressions.
Loop cases replace a function through update-clause destructuring, a class
iterator's back edge or a resumed generator using rest/spread arguments.
Awaited `.then` throws interrupt compound assignments, destructuring defaults
and async-generator yields; both the catch and the retained write are checked.

These four route groups reuse the existing tags: implicit calls use
`ts-route-accessor`, `ts-route-conversion` or `ts-route-call`; static dispatch
uses `ts-route-call`; loop replacement uses `ts-route-loop`; and the awaited
throws use `ts-route-exception`. Every file still has exactly one fact tag
and one route tag. Every bounds route represented here has separate
past-the-end and in-range or append-after-shrink witnesses.

The expression positions follow ECMAScript's [expression evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html),
including assignment, comparison, property-key and destructuring order.
The async cases follow [NewPromiseReactionJob](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-newpromisereactionjob)
and [Await](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#await):
a callback's throw rejects its result promise, and awaiting that rejection
enters the surrounding catch. These are ordinary strict TypeScript programs;
current compiler refusals remain findings rather than reasons to change a case.

### Third proof family: collections and buffer views

The third family adds 140 cases extending element-kind proofs to Map and Set
contents and bounds proofs to typed-array views. Each of the ten routes has
four Map cases, four Set cases and three pairs of view cases.

| route | Map contents | Set contents | fixed views | tracking views | transfer | total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| loop | 4 | 4 | 2 | 2 | 2 | 14 |
| merge | 4 | 4 | 2 | 2 | 2 | 14 |
| chain | 4 | 4 | 2 | 2 | 2 | 14 |
| call | 4 | 4 | 2 | 2 | 2 | 14 |
| alias | 4 | 4 | 2 | 2 | 2 | 14 |
| callback | 4 | 4 | 2 | 2 | 2 | 14 |
| accessor | 4 | 4 | 2 | 2 | 2 | 14 |
| conversion | 4 | 4 | 2 | 2 | 2 | 14 |
| exception | 4 | 4 | 2 | 2 | 2 | 14 |
| suspension | 4 | 4 | 2 | 2 | 2 | 14 |
| **Total** | **40** | **40** | **20** | **20** | **20** | **140** |

Map and Set cases begin with small whole numbers. A writer introduces a
fraction, a wider integer, another value kind or explicit `undefined`;
separate readers check the exact stored value. Readers include `Map.get`,
`forEach`, `for-of`, spread, `Array.from` and iterator advancement. Live
traversal cases check every visited value, including values added during
traversal. Presence and iteration checks distinguish stored `undefined` from
an absent entry or an exhausted iterator. Expected values are scalar, so the expectations
introduce no additional widening stores into a collection.

Each route's bounds cases have three past-the-end witnesses and three
independent in-range witnesses: fixed views on resizable buffers,
offset length-tracking views through resize, and source or destination views
through transfer. They cover retained prefixes, bytes zeroed by shrink and
regrowth, writes after resizing, and fresh views on transferred storage.
Fixed in-range cases write through a fresh sibling view, read the original
guarded view and check the buffer byte length. All in-range cases make their
observations without an out-of-range read.

The existing `ts-proof-element-kind` tag covers the 80 collection cases;
`ts-proof-bounds` covers the 60 view cases. Every case has exactly one of
these fact tags and one existing `ts-route-*` tag. Current compiler refusals
remain findings; cases use ordinary strict TypeScript.

The collection behavior follows ECMAScript's [Map objects](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-map-objects)
and [Set objects](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-set-objects),
including their live iterators and `forEach` callbacks. Buffer behavior follows
[resize](https://tc39.es/ecma262/multipage/structured-data.html#sec-arraybuffer.prototype.resize),
[ArrayBufferCopyAndDetach](https://tc39.es/ecma262/multipage/structured-data.html#sec-arraybuffercopyanddetach)
and [typed-array indexed access](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-typedarraygetelement).

### Builtin identity contracts

| source | concepts |
| --- | --- |
| [Builtins, Where nts stands](../../docs/foundations/builtins.md#where-nts-stands), including Feature identity, and [Resolution at build time](../../docs/foundations/builtins.md#resolution-at-build-time) | builtin identity follows the declaring symbol and reached value, including when an own declaration shares its spelling |
| [Language, Classes and objects](../../docs/language/README.md#classes-and-objects), [The type system](../../docs/language/README.md#the-type-system) and [Values](../../docs/language/README.md#values) | typed constructors, function values, subclasses, casts and builtin call versus construct semantics |
| [Boundaries, In scope, not yet built](../../docs/language/boundaries.md#in-scope-not-yet-built) and [Decisions](../../docs/language/boundaries.md#decisions) | reflection routes remain executable oracle cases under this family's handoff, without predicting a backend result |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `look-alikes` | 150 | 150 | Typed namesakes in module, function, block, parameter and namespace bindings |
| `casts` | 38 | 38 | Own classes, returning functions and objects asserted to builtin types |
| `values` | 16 | 16 | Real and conditional builtin values in typed storage, arguments, returns and destructuring |
| `subclasses` | 30 | 30 | Six builtin bases, each with implicit and explicit constructors, method overrides and inherited or overridden statics |
| `call-construct` | 30 | 30 | Call and construction semantics through typed parameters, fields and aliases |
| `reflection` | 8 | 8 | Reflect.construct, Reflect.apply, globalThis.Map and direct-prototype equality through typed values |

### Lifetime contracts

| source | concepts |
| --- | --- |
| [Memory, Where nts stands](../../docs/foundations/memory.md#where-nts-stands) and [The ladder of homes](../../docs/foundations/memory.md#the-ladder-of-homes) | frame and region placement, borrowing, moves, string growth, cycle exclusion, disjoint loop slots and scalar replacement |
| [Memory, The design](../../docs/foundations/memory.md#the-design) | per-site homes, aliases, captures, exceptions, continuations, re-entry and observable in-place updates |
| [Memory, Resetting a region is safe only if nothing can still walk into it](../../docs/foundations/memory.md#resetting-a-region-is-safe-only-if-nothing-can-still-walk-into-it) and [A region needs two proofs](../../docs/foundations/memory.md#a-region-needs-two-proofs) | result descendants, runtime reachability and bounded retention at a reset |
| [Memory, How small the dynamic part can get](../../docs/foundations/memory.md#how-small-the-dynamic-part-can-get) and [Cycles through foreign objects](../../docs/foundations/memory.md#cycles-through-foreign-objects) | uniqueness, cycle-forming stores and roots outside ordinary object fields |
| [Record 0024](../../docs/records/0024-one-ownership-answer-per-value.md), [Record 0006](../../docs/records/0006-objects-and-their-lifetimes.md) and [Record 0029](../../docs/records/0029-a-string-that-grows.md) | anchors and consuming transfers, frame objects and bounded strings, and consuming string append with a uniqueness check |

Node checks observable values and identity without assumptions about GC
timing. Reclamation of unreachable cycles and bounded retained memory
remain the maintainers' steady-heap checks; ordinary Node assertions
cannot establish those properties. Native foreign-holder cycles have no
one-file Node oracle.

### Unicode contracts

| source | concepts |
| --- | --- |
| [Unicode, The design](../../docs/foundations/unicode.md#the-design) | one Unicode version across case conversion, RegExp data, normalization, URL hosts and grapheme breaking; locale case and ICU services |
| [Unicode, Staying identical to node](../../docs/foundations/unicode.md#staying-identical-to-node) | exhaustive code-point comparisons, exact contextual sequences, official conformance inputs and observable locale-list behaviour |
| [Unicode, Build order](../../docs/foundations/unicode.md#build-order) | cases retained for each stage even before nts supports the corresponding API |
| [Unicode Character Database](https://www.unicode.org/ucd/), UAX #15, UAX #29 and UTS #46 | versioned case data and the NormalizationTest, GraphemeBreakTest and IdnaTestV2 inputs; each generator records its exact source versions and hashes |

The expected values come from the pinned node, including its ICU and
URL implementation. The generators retain source provenance and
copyright notices, check input hashes, and provide `--check` for
byte-for-byte regeneration. They keep areas independent so each can
land without another open Unicode pull request.

## Tags

<!-- tags:begin -->
| tag | meaning | source | cases | pending |
| --- | --- | --- | ---: | ---: |
| `ts-abstract` | an `abstract` class and its abstract members | conformance/classes/classDeclarations/classAbstractKeyword; ts-eslint TSAbstractMethodDefinition, TSAbstractPropertyDefinition | 7 | 1 |
| `ts-accessor-fields` | an `accessor` field (auto-accessor), static, private or abstract | conformance/classes/propertyMemberDeclarations/autoAccessor; ts-eslint AccessorProperty, TSAbstractAccessorProperty | 0 | 7 |
| `ts-accessors` | `get`/`set` accessors on a class or an object literal | conformance/classes/propertyMemberDeclarations; typed paths | 92 | 4 |
| `ts-ambient` | an ambient declaration (`declare var/function/class/namespace/global`), which emits nothing | conformance/ambient; ts-eslint TSDeclareFunction, `declare` modifiers | 6 | 1 |
| `ts-any` | an explicitly `any`-typed value, the dynamic escape hatch | conformance/types/any; ts-eslint TSAnyKeyword | 4 | 0 |
| `ts-arrays` | typed arrays of values (`T[]`, `Array<T>`) and their methods | conformance/types/primitives; ts-eslint TSArrayType | 1353 | 0 |
| `ts-arrow-functions` | an arrow function, generic or typed | conformance/es6/arrowFunction | 169 | 0 |
| `ts-as-const` | a const assertion (`as const`), which is not a freeze | conformance/expressions/typeAssertions/constAssertions | 4 | 0 |
| `ts-assertion-functions` | an assertion function (`asserts value is T`, `asserts condition`) | conformance/controlFlow/assertionTypePredicates; ts-eslint TSTypePredicate.asserts | 101 | 0 |
| `ts-async-generators` | an async generator, `for await`, and `Symbol.asyncIterator` | conformance/es2018 (asyncGenerators, forAwait); conformance/types/forAwait | 13 | 0 |
| `ts-async` | async functions, methods and arrows, and the promises they return | conformance/async; conformance/es2017 | 100 | 1 |
| `ts-bigint` | `bigint` values, literals and literal types in typed code | conformance/es2020 (bigint); ts-eslint TSBigIntKeyword | 34 | 0 |
| `ts-builtin-cast` | an own value asserted to a builtin constructor or object type keeps its runtime identity | builtin identity contracts; ts-eslint TSAsExpression | 76 | 0 |
| `ts-builtin-identity` | the declaration or runtime value selects a builtin operation; spelling and asserted types do not establish identity | builtin identity contracts: Builtins, Feature identity; typed paths | 544 | 0 |
| `ts-builtin-invocation` | call and construction preserve argument semantics through typed targets | builtin identity contracts; conformance/expressions/newOperator, callExpressions; typed paths | 60 | 0 |
| `ts-builtin-name` | a typed class, function, object or parameter shadows a builtin name in lexical scope | builtin identity contracts; conformance/classes, functions, internalModules | 300 | 0 |
| `ts-builtin-reflection` | typed values reach builtin identity through Reflect, globalThis or direct-prototype inspection | builtin identity contracts; Language, Boundaries; typed paths | 16 | 0 |
| `ts-builtin-subclass` | a class extending a built-in (Array, Error, Map) | conformance/es6/classDeclaration; typed paths | 67 | 0 |
| `ts-builtin-value` | a builtin is called or constructed through typed storage, a parameter, a return, a condition or destructuring | builtin identity contracts; conformance/types/members; typed paths | 32 | 0 |
| `ts-call-signatures` | a call signature in an interface or type literal: a callable object with properties | conformance/types/members; ts-eslint TSCallSignatureDeclaration | 22 | 0 |
| `ts-class-expression` | a class expression, named or anonymous | conformance/classes/classExpressions; conformance/es6/classExpressions | 13 | 0 |
| `ts-class-fields` | instance and static field declarations, with define semantics (`useDefineForClassFields`) | conformance/classes/propertyMemberDeclarations; ts-eslint PropertyDefinition | 253 | 4 |
| `ts-class-static-block` | a `static { }` block | conformance/classes/classStaticBlock; ts-eslint StaticBlock | 2 | 0 |
| `ts-class` | a class declaration or expression | conformance/classes | 776 | 29 |
| `ts-closures` | a function or class capturing typed locals | conformance/functions; typed paths | 418 | 1 |
| `ts-commonjs` | a CommonJS-format TypeScript module | conformance/externalModules | 0 | 5 |
| `ts-computed-keys` | a computed property key in a literal, a class or a type | conformance/es6/computedProperties | 23 | 0 |
| `ts-conditional-types` | a conditional type (`T extends U ? X : Y`), distributive over unions | conformance/types/conditional; ts-eslint TSConditionalType | 4 | 0 |
| `ts-const-enum` | a `const enum` | conformance/constEnums; ts-eslint TSEnumDeclaration (const) | 3 | 1 |
| `ts-const-type-parameters` | a `const` type parameter | conformance/types/typeParameters/typeParameterLists; ts-eslint TSTypeParameter.const | 1 | 0 |
| `ts-construct-signatures` | a construct signature or constructor type (`new () => T`) | conformance/types/members; ts-eslint TSConstructorType, TSConstructSignatureDeclaration | 69 | 0 |
| `ts-conversions` | implicit and explicit conversions of typed values: ToPrimitive, ToNumber, ToString, ToBoolean | conformance/expressions/binaryOperators; conformance/expressions/unaryOperators; typed paths | 598 | 0 |
| `ts-declaration-merging` | two declarations of one name merged into one entity | conformance/internalModules/DeclarationMerging; conformance/interfaces/declarationMerging | 11 | 5 |
| `ts-declare-field` | a `declare` class field, which emits nothing | conformance/classes/propertyMemberDeclarations; ts-eslint PropertyDefinition.declare | 1 | 0 |
| `ts-decorators` | standard (TC39) decorators on classes, methods, fields, accessors; context, addInitializer, metadata | conformance/esDecorators; ts-eslint Decorator | 0 | 12 |
| `ts-default-parameters` | a parameter with a default value | conformance/es6/defaultParameters | 15 | 0 |
| `ts-definite-assignment` | a definite assignment assertion (`x!: T`, `let x!: T`) | conformance/controlFlow/definiteAssignmentAssertions; ts-eslint PropertyDefinition.definite | 2 | 0 |
| `ts-destructuring` | a typed destructuring declaration, parameter or assignment | conformance/es6/destructuring | 154 | 0 |
| `ts-discriminated-unions` | a union of object types told apart by a literal-typed property | conformance/types/union/discriminatedUnionTypes | 8 | 0 |
| `ts-dynamic-import` | a dynamic `import()` of a typed module | conformance/dynamicImport | 0 | 1 |
| `ts-enum-computed` | an enum member whose initialiser is an expression, constant or not | conformance/enums | 6 | 0 |
| `ts-enum-reverse-mapping` | a numeric enum member's value mapped back to its name | conformance/enums | 5 | 0 |
| `ts-enum-string` | a string-valued enum member | conformance/enums | 6 | 0 |
| `ts-enum` | an `enum` declaration and its object | conformance/enums; ts-eslint TSEnumDeclaration | 32 | 3 |
| `ts-errors` | exceptions in typed code: `catch` bindings typed `unknown`, Error subclasses, finally | conformance/statements/tryStatements; typed paths | 179 | 0 |
| `ts-expando` | properties assigned to a function declaration (an expando) | conformance/functions (expando assignments, TypeScript 3.1) | 1 | 0 |
| `ts-exponent` | the `**` operator and `**=` | conformance/es7/exponentiationOperator | 2 | 0 |
| `ts-export-equals` | `export =` | conformance/externalModules; ts-eslint TSExportAssignment | 0 | 4 |
| `ts-exports` | export declarations, lists, renames and defaults, read back within the module | conformance/externalModules; conformance/es6/modules; ts-eslint ExportNamedDeclaration | 10 | 3 |
| `ts-expressions` | ordinary operators in typed code: increments, comma, void, delete, in | conformance/expressions | 64 | 0 |
| `ts-function-types` | a function type (`(x: T) => U`) for a parameter, field or type argument | conformance/types/members; ts-eslint TSFunctionType | 153 | 0 |
| `ts-functions` | function declarations, expressions and calls in typed code | conformance/functions; conformance/es6/functionDeclarations | 1780 | 4 |
| `ts-generators` | a generator function or method, typed `Generator<T, TReturn, TNext>` | conformance/generators; conformance/es6/yieldExpressions | 69 | 0 |
| `ts-generic-constraints` | a type parameter's constraint (`<T extends C>`) | conformance/types/typeParameters/typeArgumentLists; ts-eslint TSTypeParameter.constraint | 15 | 0 |
| `ts-generic-defaults` | a type parameter's default (`<T = number>`) | conformance/types/typeParameters/typeParameterLists | 9 | 0 |
| `ts-generics` | type parameters on a function, class, method or interface | conformance/types/typeParameters; ts-eslint TSTypeParameter | 230 | 0 |
| `ts-import-alias` | `import X = N.Y`, an alias for a namespace or a value it exports (`export import` too) | conformance/internalModules/importDeclarations; ts-eslint TSImportEqualsDeclaration | 3 | 0 |
| `ts-import-require` | `import x = require("...")` | conformance/externalModules; ts-eslint TSImportEqualsDeclaration, TSExternalModuleReference | 0 | 5 |
| `ts-import-type` | `import type` and TypeScript's elision of imports used only as types | conformance/externalModules/typeOnly; ts-eslint ImportDeclaration.importKind | 0 | 2 |
| `ts-imports` | import declarations between modules: named, default, namespace, side-effect, cycles | conformance/externalModules; conformance/es6/modules | 0 | 9 |
| `ts-index-signatures` | an index signature (`[key: string]: T`) on a type, interface or class | conformance/classes/indexMemberDeclarations; ts-eslint TSIndexSignature | 32 | 0 |
| `ts-indexed-access` | an indexed access type (`T[K]`) | conformance/types/keyof; ts-eslint TSIndexedAccessType | 7 | 0 |
| `ts-infer` | `infer` in a conditional type | conformance/types/conditional; ts-eslint TSInferType | 1 | 0 |
| `ts-inheritance` | `extends` between classes: super calls, super property access, the prototype chain | conformance/classes/classDeclarations/classHeritageSpecification; conformance/expressions/superCalls | 196 | 3 |
| `ts-instanceof` | `instanceof`, and narrowing by it | conformance/expressions/typeGuards/typeGuardsWithInstanceOf | 193 | 0 |
| `ts-instantiation-expression` | an instantiation expression (`f<number>`), erased | conformance/types/typeParameters/typeArgumentLists/instantiationExpressions; ts-eslint TSInstantiationExpression | 1 | 0 |
| `ts-interface-extends` | an interface extending interfaces or a class | conformance/interfaces/interfaceDeclarations; conformance/interfaces/interfacesExtendingClasses; ts-eslint TSInterfaceHeritage | 4 | 0 |
| `ts-interfaces` | an interface, implemented by a class or satisfied by a literal | conformance/interfaces; ts-eslint TSInterfaceDeclaration | 74 | 0 |
| `ts-intersections` | an intersection type (`A & B`) and values of it | conformance/types/intersection; ts-eslint TSIntersectionType | 2 | 0 |
| `ts-iteration` | the iteration protocols in typed code: Iterable, Iterator, for-of, spread, destructuring | conformance/es6/for-ofStatements; conformance/types/forAwait; lib.es2015.iterable.d.ts | 1864 | 0 |
| `ts-jsx` | JSX in a `.tsx` file, compiled to factory calls | conformance/jsx; ts-eslint JSX nodes | 0 | 6 |
| `ts-keyof` | `keyof T`, and values of that type | conformance/types/keyof; ts-eslint TSTypeOperator | 9 | 0 |
| `ts-legacy-decorators` | `experimentalDecorators`: class, method, property, accessor and parameter decorators | conformance/decorators | 0 | 8 |
| `ts-lifetime-acyclic` | a construction route closes a cycle that an acyclicity proof must include | lifetime contracts: Memory, How small the dynamic part can get; Cycles through foreign objects | 24 | 0 |
| `ts-lifetime-borrow` | a borrowed reference remains live after its original anchor or read-only call ends | lifetime contracts: Memory, Where nts stands; The ladder of homes; record 0024 | 24 | 0 |
| `ts-lifetime-frame` | an object or bounded string must outlive a frame after a retention route acts | lifetime contracts: Memory, The ladder of homes; Where nts stands | 28 | 0 |
| `ts-lifetime-in-place` | a retained old value remains observable during or after a string append or immutable update | lifetime contracts: Memory, The design, Principles and What it unlocks; record 0029 | 24 | 0 |
| `ts-lifetime-move` | a last-use transfer must preserve a reference still reachable through another route | lifetime contracts: Memory, Where nts stands; The ladder of homes; record 0024 | 25 | 0 |
| `ts-lifetime-region` | a reference remains reachable after the original call result reaches its last use | lifetime contracts: Memory, The ladder of homes; Resetting a region is safe only if nothing can still walk into it; A region needs two proofs | 25 | 0 |
| `ts-lifetime-scalar` | an object initially used through fields gains an observable identity or shared mutation | lifetime contracts: Memory, Where nts stands; The ladder of homes | 20 | 0 |
| `ts-lifetime-slot` | successive loop allocations remain distinct when their live instances overlap | lifetime contracts: Memory, Where nts stands; The one memory analysis | 18 | 0 |
| `ts-literal-types` | string, number and boolean literal types and the values they admit | conformance/types/literal; conformance/types/stringLiteral; ts-eslint TSLiteralType | 21 | 0 |
| `ts-map-set` | `Map<K, V>` and `Set<T>` in typed code | typed paths | 352 | 0 |
| `ts-mapped-types` | a mapped type (`{ [K in keyof T]: U }`), with modifiers and `as` remapping | conformance/types/mapped; ts-eslint TSMappedType | 6 | 0 |
| `ts-mixins` | a function returning a subclass of the class it is given | conformance/classes/mixinClassesAndInterfaces | 4 | 0 |
| `ts-modules` | an ES module (the `module` flag): module scope, strictness, top-level await | conformance/externalModules; conformance/es6/modules | 324 | 10 |
| `ts-namespace` | a namespace (internal module) and its object | conformance/internalModules; ts-eslint TSModuleDeclaration | 88 | 6 |
| `ts-narrowing` | control-flow narrowing of a union or `unknown` | conformance/controlFlow; conformance/expressions/typeGuards | 321 | 0 |
| `ts-never` | the `never` type: an unreachable value or a function that does not return | conformance/types/never | 3 | 0 |
| `ts-new-target` | `new.target` | conformance/es6/newTarget | 7 | 0 |
| `ts-non-null` | a non-null assertion (`x!`), erased, never a check | conformance/expressions (non-null assertions); ts-eslint TSNonNullExpression | 5 | 0 |
| `ts-null-undefined` | `null`, `undefined` and `T | undefined` under strictNullChecks | conformance/types/primitives; typed paths | 156 | 0 |
| `ts-numbers` | IEEE doubles in typed code: fractions, -0, NaN, int32 operators, formatting | conformance/types/primitives/number; typed paths | 671 | 0 |
| `ts-object-type` | the non-primitive `object` type | conformance/types/nonPrimitive; ts-eslint TSObjectKeyword | 1 | 0 |
| `ts-objects` | object literals and object types: properties, methods, keys, copies | conformance/expressions/objectLiterals; conformance/types/objectTypeLiteral; ts-eslint TSTypeLiteral | 688 | 0 |
| `ts-optional-chaining` | `?.` on properties, calls and elements, in typed code | conformance/expressions/optionalChaining | 8 | 0 |
| `ts-optional-parameters` | a parameter marked `?` | conformance/functions; conformance/types/members | 7 | 0 |
| `ts-optional-properties` | a property marked `?` in a type, a class or an interface | conformance/types/members; conformance/types/objectTypeLiteral | 18 | 0 |
| `ts-overloads` | overload signatures on a function, method or constructor | conformance/functions/functionOverloads; ts-eslint TSDeclareFunction, TSEmptyBodyFunctionExpression | 7 | 0 |
| `ts-override` | the `override` modifier on a method, accessor or field | conformance/override; ts-eslint MethodDefinition.override | 92 | 0 |
| `ts-parameter-properties` | a constructor parameter with a modifier, which declares and assigns a field | conformance/classes/constructorDeclarations; ts-eslint TSParameterProperty | 9 | 0 |
| `ts-private-fields` | ECMAScript `#private` fields, methods and accessors | conformance/classes/members/privateNames | 8 | 2 |
| `ts-private-keyword` | the `private` modifier, a compile-time check over an ordinary property | conformance/classes/members/accessibility; ts-eslint TSPrivateKeyword | 7 | 0 |
| `ts-proof-bounds` | an index proved in range before a route changes the index or the container | proof contracts: Objects, Arrays; Numbers, Integers proved from doubles | 166 | 0 |
| `ts-proof-call-target` | a known receiver or closure target changes before a dispatch or specialized call | proof contracts: Objects, Calls and Functions as values; Language, Functions | 89 | 0 |
| `ts-proof-capture` | a write invalidates copying a captured binding instead of sharing its cell | proof contracts: Objects, Functions as values; Language, Functions | 65 | 0 |
| `ts-proof-element-kind` | a non-integer store invalidates a whole-program integer element kind | proof contracts: Objects, Arrays; Numbers, Integers proved from doubles | 151 | 0 |
| `ts-proof-length` | an allocation or guard proves a length before a route changes it | proof contracts: Objects, Arrays | 82 | 0 |
| `ts-proof-negative-zero` | a zero sign becomes observable after a route invalidates its omission | proof contracts: Numbers, Integers proved from doubles; Language, Numbers | 63 | 0 |
| `ts-proof-whole-number` | a whole finite value in range loses its integer representation proof | proof contracts: Numbers, Integers proved from doubles; Language, Numbers | 89 | 0 |
| `ts-protected` | the `protected` modifier | conformance/classes/members/accessibility; ts-eslint TSProtectedKeyword | 1 | 0 |
| `ts-readonly` | `readonly` properties, arrays and tuples, which are not frozen | conformance/types/tuple/readonlyArraysAndTuples; ts-eslint TSReadonlyKeyword | 87 | 0 |
| `ts-record` | `Record<K, V>` | conformance/types/mapped; lib | 8 | 0 |
| `ts-rest-parameters` | a rest parameter, typed as an array or a tuple | conformance/es6/restParameters | 17 | 0 |
| `ts-route-accessor` | a getter or setter runs user code between proof and use | proof contracts: Objects, Calls; conformance/classes/accessors | 59 | 0 |
| `ts-route-alias` | a second name, field or container entry writes the value a proof describes; also a second name retains a reference after its original owner ends | proof contracts: Objects, Arrays and Functions as values; lifetime contracts | 70 | 0 |
| `ts-route-await` | an async continuation keeps a local reference across await | lifetime contracts: Memory, The one memory analysis | 12 | 0 |
| `ts-route-call` | a direct, nested or recursive call changes the value between proof and use | proof contracts: Objects, Arrays and Calls | 127 | 0 |
| `ts-route-callback` | a callback passed to a builtin changes the value between proof and use; also a builtin or program callback retains a reference past its original owner | proof contracts: Objects, Arrays and Functions as values; lifetime contracts | 76 | 0 |
| `ts-route-chain` | a change propagates through many assignments, fields or loop-carried dependencies | proof contracts: Numbers, Integers proved from doubles; Objects, Arrays | 41 | 0 |
| `ts-route-closure` | a stored closure retains a value for a later call | lifetime contracts: Memory, The one memory analysis | 16 | 0 |
| `ts-route-container` | an array, map, set or object field keeps a value beyond its original owner | lifetime contracts: Memory, The one memory analysis | 19 | 0 |
| `ts-route-conversion` | valueOf or toString runs user code during primitive conversion | proof contracts: Objects, Calls; conformance/expressions; ToPrimitive | 76 | 0 |
| `ts-route-exception` | a thrown or unwinding edge preserves a partial update before use | proof contracts: Objects, Calls; conformance/statements/tryStatements | 55 | 0 |
| `ts-route-global` | a module variable or static field keeps a value after its producer ends | lifetime contracts: Memory, The one memory analysis | 16 | 0 |
| `ts-route-hook` | an implicit getter, setter, conversion, iterator hook or comparator retains or observes a value | lifetime contracts: Memory, The one memory analysis | 18 | 0 |
| `ts-route-iterator` | iterator results or a spread hand out references retained by the consumer | lifetime contracts: Memory, The one memory analysis | 16 | 0 |
| `ts-route-loop` | a back edge, nested loop or loop exit carries a change to a later use | proof contracts: Numbers, Integers proved from doubles; conformance/statements | 104 | 0 |
| `ts-route-merge` | paths with different facts join before the value is used | proof contracts: Numbers, Integers proved from doubles; conformance/controlFlow | 85 | 0 |
| `ts-route-re-entry` | a callback re-enters a function while an earlier activation still uses a value | lifetime contracts: Memory, The one memory analysis | 15 | 0 |
| `ts-route-return-chain` | a value is retained after returning through many distinct functions | lifetime contracts: Memory, The one memory analysis | 16 | 0 |
| `ts-route-suspension` | yield or await lets other code change a proved value before resumption | proof contracts: Objects, Functions as values; conformance/generators; conformance/async | 44 | 0 |
| `ts-route-throw` | a thrown value or finally block carries a reference past unwinding | lifetime contracts: Memory, The one memory analysis | 16 | 0 |
| `ts-route-yield` | a suspended generator keeps a local reference until resumption | lifetime contracts: Memory, The one memory analysis | 12 | 0 |
| `ts-satisfies` | the `satisfies` operator, which leaves its value and the value's type alone | conformance/expressions/typeSatisfaction; ts-eslint TSSatisfiesExpression | 3 | 0 |
| `ts-spread` | spread and rest of objects and arrays in typed code | conformance/types/spread; conformance/es6/spread | 91 | 1 |
| `ts-static` | static fields, methods and accessors | conformance/classes/propertyMemberDeclarations; ts-eslint TSStaticKeyword | 84 | 4 |
| `ts-strings` | strings in typed code: UTF-16 length and indexing against code points | conformance/types/primitives/string; typed paths | 491 | 0 |
| `ts-structural-typing` | a value accepted for its shape, not its declared name: literals and classes that never say `implements` | conformance/types/typeRelationships; typed paths | 44 | 0 |
| `ts-symbols` | symbols as keys, well-known symbols, `unique symbol` | conformance/Symbols; conformance/es6/Symbols; conformance/types/uniqueSymbol | 32 | 2 |
| `ts-tagged-templates` | a tagged template with a typed tag function | conformance/es6/templates | 1 | 0 |
| `ts-template-literal-types` | a template literal type, and the intrinsic string types (Uppercase, Capitalize, ...) | conformance/types/literal/templateLiteralTypes; ts-eslint TSTemplateLiteralType | 8 | 0 |
| `ts-template-literals` | template literal expressions and their substitutions | conformance/es6/templates | 80 | 0 |
| `ts-this-parameter` | a `this` parameter, which is erased | conformance/types/thisType; conformance/functions | 22 | 0 |
| `ts-this-type` | the polymorphic `this` type | conformance/types/thisType | 2 | 0 |
| `ts-this` | `this` in methods, arrow fields and detached calls | conformance/expressions/thisKeyword | 78 | 1 |
| `ts-to-primitive` | an object converted to a primitive: `valueOf`, `toString`, `Symbol.toPrimitive` | typed paths | 89 | 0 |
| `ts-to-string` | an object converted to a string by its `toString` | typed paths | 52 | 0 |
| `ts-tuple-labels` | a labelled tuple element (`[start: number]`) | conformance/types/tuple/named; ts-eslint TSNamedTupleMember | 2 | 0 |
| `ts-tuple-optional` | an optional tuple element (`[a, b?]`) | conformance/types/tuple; ts-eslint TSOptionalType | 2 | 0 |
| `ts-tuple-rest` | a rest element in a tuple, leading, middle or trailing | conformance/types/tuple; ts-eslint TSRestType | 2 | 0 |
| `ts-tuples` | a tuple type and the array that carries it | conformance/types/tuple; ts-eslint TSTupleType | 397 | 0 |
| `ts-type-aliases` | a `type` alias, generic or recursive | conformance/types/typeAliases; ts-eslint TSTypeAliasDeclaration | 14 | 0 |
| `ts-type-assertions` | a type assertion (`x as T`, `<T>x`), erased, never a conversion | conformance/expressions/asOperator; conformance/expressions/typeAssertions; ts-eslint TSAsExpression, TSTypeAssertion | 81 | 0 |
| `ts-type-guards` | a user-defined type predicate (`value is T`) | conformance/expressions/typeGuards; ts-eslint TSTypePredicate | 100 | 0 |
| `ts-type-operators` | values flowing through type-level operators: keyof, typeof, indexed access, mapped and conditional types | conformance/types (keyof, typeQueries, mapped, conditional) | 18 | 0 |
| `ts-typeof-operator` | the run-time `typeof` operator over typed values | conformance/expressions/typeGuards/typeGuardsWithTypeOf | 538 | 0 |
| `ts-typeof-type` | `typeof x` in a type position | conformance/types/typeQueries; ts-eslint TSTypeQuery | 96 | 0 |
| `ts-unicode-case-mapping` | default lower/uppercase mappings, expansions, Final_Sigma, surrogate handling and newly assigned letters | Unicode contracts; UCD SpecialCasing, DerivedAge and UnicodeData | 207 | 0 |
| `ts-unicode-exhaustive` | every code point, including lone surrogates, checked by a Node-generated FNV-1a UTF-16 hash per 4096-point block | Unicode contracts: Staying identical to node, exhaustive layer | 34 | 0 |
| `ts-unicode-sequences` | exact contextual strings or API observations that a per-code-point sweep cannot establish | Unicode contracts: Staying identical to node, sequence and behaviour layers | 173 | 0 |
| `ts-unions` | a union type and the values that flow through it | conformance/types/union; ts-eslint TSUnionType | 162 | 0 |
| `ts-unique-symbol` | a `unique symbol` constant as a member key | conformance/types/uniqueSymbol | 1 | 0 |
| `ts-unknown` | the `unknown` type, narrowed before use | conformance/types/unknown; ts-eslint TSUnknownKeyword | 288 | 0 |
| `ts-unsound-arity` | a shorter function signature hides an optional parameter from a wider caller | conformance/types/typeRelationships; typed paths | 3 | 0 |
| `ts-unsound-assertion` | an assertion function claims a type without establishing it at runtime | conformance/controlFlow/assertionTypePredicates; typed paths | 89 | 0 |
| `ts-unsound-bivariance` | method parameter bivariance permits a wider writer to violate a narrow value type | conformance/types/typeRelationships; typed paths | 151 | 0 |
| `ts-unsound-covariant-array` | array covariance permits a wider writer to violate the original element type | conformance/types/typeRelationships; typed paths | 72 | 0 |
| `ts-unsound-covariant-view` | a readonly or covariant view retains a narrow claim after a mutable wider alias writes | conformance/types/typeRelationships; typed paths | 90 | 0 |
| `ts-unsound-generic-widening` | a wider generic instantiation writes an incompatible value or retains an invalid property claim | conformance/types/typeParameters; typed paths | 91 | 0 |
| `ts-unsound-object-assign` | Object.assign overwrites a property while the original target retains its narrow type | conformance/types/typeRelationships; typed paths | 1 | 0 |
| `ts-unsound-overload` | an overload return type can disagree with its accepted implementation | conformance/functions/overloads; typed paths | 1 | 0 |
| `ts-unsound-predicate` | a user-written type predicate claims a type the runtime value does not have | conformance/controlFlow/typePredicate; typed paths | 89 | 0 |
| `ts-unsound-private` | compile-time privacy allows literal-key access that can participate in a false type claim | conformance/classes/propertyMemberDeclarations; typed paths | 5 | 0 |
| `ts-unsound-refinement` | control-flow narrowing survives a call that mutates the narrowed value | conformance/controlFlow; typed paths | 9 | 0 |
| `ts-using` | `using` and `await using` declarations, Disposable and DisposableStack | conformance/statements/VariableStatements/usingDeclarations | 10 | 0 |
| `ts-utility-types` | the lib's utility types (Partial, Pick, Omit, ReturnType, Parameters, Awaited, ...) through values | lib.es5.d.ts; conformance/types/mapped | 10 | 0 |
| `ts-variadic-tuples` | a variadic tuple type (`[...A, ...B]`) | conformance/types/tuple/variadicTuples | 2 | 0 |
| `ts-void` | the `void` return type, which does not discard a returned value | conformance/types/primitives/void; ts-eslint TSVoidKeyword | 1 | 0 |
<!-- tags:end -->
