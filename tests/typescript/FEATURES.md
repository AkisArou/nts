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

7. **Typed function-value routes to a call**: parameter adaptation,
   receivers, exceptions, suspension and independent callback populations.
   [Typed call routes](#typed-call-routes) name their contracts;
   `ts-call-route-*` identifies the area.
8. **Builtin identity through typed routes:** lexical declarations, asserted
   constructor types, stored values, subclasses, invocation forms and
   reflection. [Builtin identity contracts](#builtin-identity-contracts)
   name the sources; `ts-builtin-*` identifies the route.
9. **Map and Set contents across typed routes:** widening and narrowing,
   key identity, enumeration, Set methods and stored representations.
   [Map and Set contents contracts](#map-and-set-contents-contracts)
   name the sources; `ts-contents-*` identifies the area.
10. **Throws across typed routes**: calls, implicit hooks, construction,
   iteration, promises and unwinding. [Typed throw routes](#typed-throw-routes)
   name their contracts; `ts-throw-route-*` identifies the area.

11. **Array contents across typed routes:** widening and narrowing, writes,
   reads, stored representations and mutation during iteration.
   [Array contents contracts](#array-contents-contracts) name the sources;
   `ts-array-*` identifies this family and its areas.
12. **Implicit calls through typed views**: accessors, conversion hooks,
   iterator protocols, JSON hooks, thenables and their combined order.
   [Implicit call contracts](#implicit-call-contracts) name the sources;
   `ts-implicit-*` identifies the area.

13. **Numeric values across typed routes:** integer proofs, signed zero,
    NaN, division, text conversions and widening.
    [Numeric route contracts](#numeric-route-contracts) name the sources;
    `ts-number-route-*` identifies the area.

14. **Typed-array contents across typed routes:** element conversion, shared
   bytes, changing buffers, methods and subclass contents.
   [Typed-array contents contracts](#typed-array-contents-contracts) name the
   sources; `ts-typed-array-*` identifies this family and its areas.

15. **JSON through typed routes:** matching declared shapes, unknown
   narrowing, revivers, serialization, replacers, toJSON and spacing.
   [JSON route contracts](#json-route-contracts) name the sources;
   `ts-json-*` identifies this family and its areas.

16. **Captured bindings across typed routes:** later writes, per-iteration
    bindings, lexical receivers, suspension and retained readers.
    [Capture route contracts](#capture-route-contracts) name the sources;
    `ts-capture-route-*` identifies the area.

17. **Objects across fixed-field and table views:** unknown narrowing,
   Record and index parameters, copying, mapped and generic views, and shape
   mutations. [Record route contracts](#record-route-contracts) name the
   sources; `ts-record-*` identifies this family and its areas.

18. **Iterator protocols across typed routes:** acquisition, arguments,
    delivery, completion, closing, delegation and mutation during traversal.
    [Iterator route contracts](#iterator-route-contracts) name the sources;
    `ts-iterator-route-*` identifies the area.

19. **Generic instantiations and their representations:** functions, classes,
   containers, narrowing and callbacks, paired with explicit non-generic
   specializations. [Generic route contracts](#generic-route-contracts) name
   the sources; `ts-generic-route-*` identifies each area.

20. **Union values across typed routes:** primitive storage, narrowing,
   object layouts, widening and the values whose kind or identity is easy to
   lose. [Union route contracts](#union-route-contracts) name the sources;
   `ts-union-route-*` identifies each area and its concrete-record controls.

A concept with no run-time effect (a type alias, an interface's existence, a
variance annotation) has no case of its own: it appears only where a value
flows through it.

## The families

| family | what it holds |
| --- | --- |
| `ambient/` | `declare` forms, which emit nothing and resolve to what the program provides |
| `array-contents/` | typed array writes and reads, exact values, order and slot presence, with node as the oracle |
| `array-contents-controls/` | counterparts using one declared element type across writes and reads, with node as the oracle |
| `async/` | async functions, methods and generators, promises, `for await` (`flags: [async]`) |
| `bigint/` | bigint arithmetic, conversions, widths, literal types |
| `builtin-identity/` | builtin declarations and runtime targets through TypeScript routes, with node as the oracle |
| `builtin-identity-controls/` | single-route counterparts using the builtin or direct operation, with node as the oracle |
| `call-routes/` | typed routes from a function value to its call, holding arguments, receivers, results and throws to node |
| `call-routes-controls/` | single-change direct-call or nonthrowing counterparts for call-route cases |
| `capture-routes/` | current binding values, identities, read/write order and final state across typed captures, held to node |
| `capture-routes-controls/` | matching observations with the tested closures removed and their bindings or retained live state read directly |
| `classes/` | fields under define semantics, parameter properties, inheritance, abstract, private, static, accessors |
| `conversions/` | ToPrimitive under each operator, number and string conversions |
| `enums/` | numeric, string, const, heterogeneous, computed, merged enums and their objects |
| `errors/` | exceptions typed `unknown`, Error subclasses, finally |
| `expressions/` | assertions, `satisfies`, non-null, tagged templates and operators, all erased or evaluated as written |
| `functions/` | parameters, overloads, closures, `this` parameters, `length` and names |
| `generic-routes/` | simultaneous generic instantiations and crossings that preserve exact runtime values, with node as the oracle |
| `generic-routes-controls/` | separate non-generic declarations for every used type argument, retaining computations, input values and assertions |
| `generics/` | a matrix of six positions by eight kinds of type argument, then the facets of type parameters |
| `implicit-calls/` | implicit calls through interfaces, constrained generics, unions and declared class shapes, with exact call logs, state and results |
| `implicit-calls-controls/` | explicit-call counterparts for implicit-call cases, preserving their instrumentation and observations |
| `interfaces/` | dispatch through interfaces over classes and literals of different layouts, and the interface forms |
| `iteration/` | the iteration protocols, generators, iterator helpers |
| `json-routes/` | typed JSON parsing, narrowing, serialization and hooks with exact values, key order, outputs and callback logs |
| `json-routes-controls/` | counterparts using unknown narrowing or plain literal values with the same text and assertions |
| `iterator-routes/` | complete protocol histories, delivered values, cleanup and final state through typed iterator routes, held to node |
| `iterator-routes-controls/` | the same protocol advanced and closed explicitly, with matching inputs, effects and observations |
| `lifetimes/` | lifetime facts followed by a retention or observation route, allocation churn and exact checks, with node as the oracle |
| `lifetimes-controls/` | single-change counterparts and measured findings for lifetime cases, with node as the oracle |
| `literal-types/` | literal types and the values they admit, `as const`, template literal types |
| `map-set-contents/` | typed Map and Set writes and reads, exact contents and enumeration, with node as the oracle |
| `map-set-contents-controls/` | counterparts using one declared collection type across writes and reads, with node as the oracle |
| `modules-and-exports/` | module code in one file (`flags: [module]`) |
| `namespaces/` | namespaces, their objects, merging and aliases |
| `number-routes/` | exact numeric values, zero signs, NaN, results and text across typed carriers, held to node |
| `number-routes-controls/` | the same inputs and computations with plain local number carriers and the same observations |
| `objects/` | object literals and types, structural assignment, keys, spread, Record |
| `proofs/` | facts proved from code, followed by a route that can invalidate them, with node as the oracle |
| `proofs-controls/` | counterparts that remove one invalidating effect or callback throw from a proofs finding, with node as the oracle |
| `record-routes/` | exact object values, enumeration and alias writes across laid-out, table, narrowed, mapped and generic views |
| `record-routes-controls/` | counterparts declared at their final read type from construction, with the same values, operations and assertions |
| `resource-management/` | `using`, `await using`, DisposableStack |
| `soundness/` | checker-accepted false type claims from variance, aliases and guards, with node as the oracle |
| `symbols/` | symbols as keys, unique symbols, well-known symbols |
| `throw-routes/` | exception identity, ordered cleanup and retained effects across typed routes, held to node |
| `throw-routes-controls/` | direct calls to the same throwing bodies inside the caller try, with the same observations |
| `tuples/` | tuples with optional, rest and labelled elements, readonly, variadic |
| `type-operators/` | values through keyof, typeof, indexed access, mapped and conditional types |
| `typed-array-contents/` | typed-array writes and reads, exact conversions, shared bytes, resize histories and subclass contents, with node as the oracle |
| `typed-array-contents-controls/` | counterparts holding the view locally at its exact type with the same writes and assertions, with node as the oracle |
| `typed-paths/` | where a static type and the run-time value part ways, and where a number's representation shows |
| `unicode/` | exhaustive code-point blocks, contextual sequences and Unicode conformance inputs, with the pinned node as the oracle |
| `union-routes/` | exact union payloads, identities and branch histories across storage, narrowing, object layouts and widening, held to node |
| `union-routes-controls/` | the same computations using one kind record with separate concrete payload fields and explicit branches |
| `unions/` | unions and every way TypeScript narrows them |

Each family has one or more `combination-*.ts` cases pairing its concept
with others. The `soundness/` matrix instead uses `<route>-<place>-<read>.ts`
to identify each combination of an unsoundness route, storage and read.
The `proofs/` matrix uses `<fact>-<route>-<detail>.ts`: one fact and one
invalidation route per case, tagged with one `ts-proof-*`, one `ts-route-*`
and the existing container and syntax tags. A literal allocation, range or
guard establishes the fact before the route acts; several inputs exercise
the same code, and an exact assertion observes the result after the route.

The `call-routes/` matrix uses `<area>-<route>.ts` in place of combination
cases. Each case has one `ts-call-route-*` tag and existing syntax and
container tags. Its counterpart under `call-routes-controls/` appends
`-control` to the same name and changes the call to its direct form or
selects the nonthrowing variant. Receiver expectations change only where
a direct call necessarily supplies a different receiver. Several inputs
exercise each route, with exact argument, result, state and ordered-log
checks on return and throw paths. Strict TypeScript and the pinned node
oracle admit the cases; maintainers measure each backend.
The `throw-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. One `ts-throw-route-*` tag names the area, alongside
existing type and syntax tags. Each case exercises both successful
and throwing inputs through the same typed route, then checks the
complete event log, final state, caught identity, class and message.
Non-Error throws are narrowed from `unknown` and checked by type and
value. A counterpart under `throw-routes-controls/` appends `-control`
and calls the same throwing body directly inside the caller try,
preserving its logs and assertions. Protocol controls explicitly
perform the surrounding steps and cleanup where needed. Strict
checking uses one script per program unless the case is module-flagged;
node still uses the suite oracle's module wrapper.
The `implicit-calls/` matrix uses `<area>-<operation>-<view>.ts` and
`<area>-<operation>-<origin>-<view>.ts` in place of combination cases.
One `ts-implicit-*` tag names the area, alongside existing syntax and
container tags. Each case reaches a user-defined hook through a typed
route, runs several inputs through the same consumer, and checks the
entire ordered log, hook arguments, independent state and result. Its
counterpart under `implicit-calls-controls/` appends `-control` and
makes the implicit call explicit, keeping the observations unchanged.
Protocol consumers may expand to explicit acquisition, stepping and
closing; thenable controls preserve the queued call. Strict TypeScript
and the pinned node oracle admit the cases; maintainers measure nts.

The `number-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-number-route-*` tag plus
existing syntax and carrier tags. Several small, wide, fractional and
special inputs exercise the same typed route. Fixed expectations use
`Object.is`, `typeof`, exact string forms and observable reciprocals
to distinguish signed zero. Expectations remain in record fields,
so unrelated numeric expectation arrays do not widen a tested array.
The `-control` counterpart under `number-routes-controls/` replaces
the numeric carrier with plain local `number` variables and retains
the same computation, input values and assertions. Enum and literal
fixtures use their identical plain numeric values in the control.
Each program passes strict checking as a script unless module-flagged,
including all default-library diagnostics, and the unchanged node oracle.

The `capture-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-capture-route-*` tag plus
existing syntax and carrier tags. Several inputs exercise each
binding history, including signed zero, NaN, fractions, wide
integers, strings, booleans, undefined, bigint and identity-bearing
objects and arrays as applicable. Every tested reader result is
checked with `Object.is` and `typeof`; an exact ordered log observes
the writes and reads, and assertions check the final state.
The `-control` counterpart under `capture-routes-controls/` removes
the tested closures and reads the binding directly at the same
points. Both members retain identical state slots for delayed loop
observations, or live aliases for escaped generator and recursive
state, where a lexical binding is no longer directly in scope.
Controls keep the inputs, writes, event order and assertions.
Strict admission checks each program as a script unless module-
flagged, with every default-library diagnostic included, before
the unchanged node oracle runs it. Existing closure and capture
proof cases remain separate; this family isolates typed capture
routes with direct-read counterparts and full binding histories.

The `iterator-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-iterator-route-*` tag and existing
syntax and carrier tags. Empty, one-element and longer inputs exercise
the same protocol; payloads include signed zero, NaN, strings, undefined
and object identities, with other representations where the route admits
them. Exact logs record protocol arguments, delivered values and cleanup;
assertions check completion values, result identity and final state.
The `-control` counterpart under `iterator-routes-controls/` spells out
acquisition and `next()` loops, with `return()` and `throw()` at the same
stopping or forwarding points. Stored builtin-iterator cases already step
by hand; their controls call the same native iterator local directly.
Builtin tracing adapters retain the actual native source and iterator.
Direct builtin `yield*` cases log caller calls and delivered/completed
values while their controls expand the native delegation protocol.
Strict admission checks each program as a script unless module-flagged,
including every default-library diagnostic, before the unchanged node
oracle runs it. Existing implicit-call, collection-content and capture
cases remain separate from these complete protocol histories.

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
The `map-set-contents/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. Each case writes or reads through a declared collection
type, widened or readonly view, generic parameter or typed holder. Several
inputs exercise the same route; exact payloads, runtime types, identities,
order and sizes make representation mistakes observable. Its counterpart in
`map-set-contents-controls/` adds `-control` to the name and unifies the
collection's declared type across writes and reads, keeping executable
operations, input data and assertions unchanged. Both members of each pair
must pass strict TypeScript and the suite's unchanged node oracle. Existing
soundness and typed-paths cases remain in place; this family adds distinct
mutation histories, typed storage and observation routes. The maintainers
record compiler outcomes separately; a refusal does not change the case.

The `array-contents/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. Each case crosses a declared element type, widened or
readonly view, generic parameter, typed holder or tuple-to-array route.
Several inputs exercise the same code, with exact values, runtime types,
lengths, order and slot presence; `Object.hasOwn` and `in` distinguish a hole
from a stored `undefined`. Its counterpart in `array-contents-controls/`
adds `-control` to the name and unifies the element type across writes and
reads, keeping executable code, inputs and assertions unchanged.

Each member is checked independently under strict TypeScript as a script
unless its front matter says `flags: [module]`. A script shares top-level
names with the library declarations. The node oracle still assembles an
`.mts` module, so its module goal is not the type-checking goal for an
unflagged case. Both members must pass that oracle. The maintainers record
compiler outcomes separately; a refusal does not change the case.
The `typed-array-contents/` family uses `<area>-<route>-<detail>.ts` instead
of combination cases. A view crosses a typed parameter, union, generic,
interface or class field, or subclass-to-base boundary. Several boundary
inputs exercise each route. Every observed element uses `Object.is`, with
exact lengths, byte offsets and byte lengths; shared-buffer cases also
check the other view's bytes. Its counterpart in
`typed-array-contents-controls/` appends `-control` and holds the view in
one local variable of its exact type, with the same writes and assertions.
Removing the route may inline a view parameter's operation or replace a
holder access; input data and the observed behavior remain identical.

Each member is checked independently under strict TypeScript as a script
unless its front matter says `flags: [module]`, with library diagnostics
included. Script names share the library's global scope. The suite's node
oracle still runs the harness and case as an `.mts` module; that does not
replace the script check. The maintainers record compiler results; a
refusal remains a finding and does not change the case.
The `json-routes/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. Parsed results have explicit annotations, never casts.
Text entering a declared shape matches it; data whose shape varies enters
`unknown` and is narrowed before use. Several inputs exercise each route,
with exact leaf values and runtime types, signed zero and key order.
Every stringify result is exact, and callbacks have complete ordered key,
value and holder observations. Its counterpart in `json-routes-controls/`
appends `-control` and uses unknown narrowing or a plain literal value,
keeping the same text, operations relevant to the route and assertions.

Each member is checked independently under strict TypeScript as a script
unless its front matter says `flags: [module]`, with library diagnostics
included. The suite's node oracle still runs an `.mts` module; that does not
replace the script check. The maintainers record compiler results; a refusal
remains a finding and does not change the case.
The `record-routes/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. Several objects cross each typed route, with array-index,
non-index numeric-looking and ordinary keys, and primitive/reference values.
Computed and constant-key reads, plus dotted reads for valid identifiers,
observe exact values with `Object.is` and `typeof`. Membership and complete
keys, values and entries distinguish absent fields and preserve key order.
Writes after crossing are observed through both the original and new views;
frozen objects instead reject the write and retain the original contents.

The counterpart in `record-routes-controls/` appends `-control` and declares
the object at its eventual read type from the start, preserving values,
operations and assertions. A class control may add an erased index-signature
declaration so the same constructor can initialize that read type. Strict
TypeScript checks each file independently as a script unless its front matter
says `flags: [module]`, with library diagnostics included. The unchanged node
oracle uses an `.mts` module separately. Rejected direct forms and their
diagnostics are listed in the pull request; no cast forces them through.
Maintainers record compiler outcomes, and a refusal never changes a case.
The `generic-routes/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. Each case exercises the same generic at at least three
distinct type arguments, with repeated inputs and exact stored, read,
compared or returned payloads. Constrained cases use qualifying structural
types. `Object.is` and `typeof` preserve negative zero, NaN, undefined and
reference identity as observable distinctions. Container cases also observe
order, lengths, sizes and presence; callback cases check their full logs.

The counterpart in `generic-routes-controls/` appends `-control` and writes
out every used specialization as a separate non-generic declaration, with
the same computation, values and assertions. Shared static state and
receiver state stay shared in the controls. The existing `ts-generics` and
related syntax tags are present only where the corresponding own type
parameters remain; the family and area tags identify both sides of a pair.

Strict TypeScript checks every file independently as a script unless front
matter says `flags: [module]`, with library diagnostics included. The
unchanged node oracle assembles a separate `.mts` module. Rejected requested
forms and their actual diagnostics are listed in the pull request; no cast,
non-null assertion or suppression forces them through. Maintainers record
compiler outcomes, and a refusal never changes a case.

The `union-routes/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. Declared unions pass through reused fields, arrays, Maps,
Sets, tuple slots and closures; guards, discriminants and truthful predicates
select their members. Other cases cross object layouts, wider unions,
unknown, generics and union-producing calls or array operations. Repeated
inputs check every member with `Object.is`, `typeof`, object identity and
complete branch logs. Storage and hard-value cases also assert their exact
string forms before printing them.

The counterpart in `union-routes-controls/` appends `-control` and replaces
the payload union with one record containing `kind: string` and a separate
concrete field for each member. Records are built directly from concrete
fixture fields; branches on `kind` replace union narrowing while preserving
the carrier, computation and observations. Numeric zero inserted directly
into a Set is observed as positive zero in both programs; a negative-zero
payload inside an object or tuple remains negative. The hard-value area
crosses all six carriers with all seven narrowing forms.

Every file is checked independently under strict TypeScript as a script
unless front matter says `flags: [module]`, with library diagnostics
included. The unchanged node oracle assembles its separate `.mts` module.
Requested forms rejected by strict TypeScript are omitted with their actual
diagnostics in the pull request. Maintainers record compiler outcomes; a
refusal never changes a case.

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

### Typed call routes

| source | concepts |
| --- | --- |
| [Functions](../../docs/language/functions.md) and [Functions as values](../../docs/foundations/objects.md#functions-as-values) | declared signatures, argument adaptation, receivers and closure calls |
| [Errors](../../docs/language/errors.md) | throws through indirect calls, caller catches, rethrow identity and ordered finally blocks |
| [Async](../../docs/language/async.md) | promise rejection, generator resumption, async generators and delegation through stored values |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| parameter-shape | `shape-*` | 26 | 26 | Six parameter forms across four storage routes, plus omitted optional and default arguments |
| receivers | `receiver-*` | 11 | 11 | Object and class call/apply/bind, captured arrows, handler fields, array thisArg, static values and returned functions |
| throws | `throw-*` | 14 | 14 | Fields, arrays, Maps, returned and passed functions, conditional and union calls, captures, array callbacks and accessors |
| async-generators | `async-*`, `generator-*` | 10 | 10 | Async functions, generators and async generators as values, async generator methods, field for-await and stored yield delegation |
| many-callbacks | `many-*` | 6 | 6 | 16 and 64 independent targets, with ordinary, generic-method and async-generator variants |

Every control preserves the case's instrumentation. Unsupported syntax
or a current compiler refusal remains a finding; it does not change the
program or its node answer. Backend results belong in the maintainers'
records, not in the case or the feature tags.
### Typed throw routes

| source | concepts |
| --- | --- |
| [Errors](../../docs/language/errors.md) | thrown identity, class and message, partial effects, catches, rethrows and finally replacement |
| [Functions](../../docs/language/functions.md) and [Objects, Calls](../../docs/foundations/objects.md#calls) | typed dispatch, callback and parameter shapes, accessors, construction and call boundaries |
| [Async](../../docs/language/async.md) | promise rejection, awaited callbacks, combinators, generator resumption and cleanup |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| calls | `call-*` | 14 | 14 | Interface class/literal layouts, abstract and virtual calls, generic callbacks, four storage routes, optional/default/rest parameters, this and overloads |
| implicit | `implicit-*` | 18 | 18 | Accessors, conversion hooks and hints, JSON hooks, nine collection callback routes, arguments and partial effects |
| construction | `construction-*` | 5 | 5 | Constructor bodies, field initializers, parameter-property arguments, base super calls and subclass work after super |
| iteration | `iteration-*` | 12 | 12 | Four next consumers, loop-body and close throws, generator throw/body paths, delegated inner/outer throws and injection during suspended yield* |
| async | `async-*` | 12 | 12 | Async interface calls, promise handlers, finally preservation/replacement, four combinators and rejecting async iterator next |
| unwinding | `unwind-*` | 8 | 8 | Two/three-route cleanup, finally return/throw, rethrow, Error subclasses and cause, primitive and object throws |

Throw-route controls retain the throwing inputs and exact observations.
A compiler refusal remains a finding. Maintainers compile each case
and control on the backends and record actual outcomes; the programs
keep node's answer. Strict-rejected requested forms, if any, belong in
the pull request's diagnostic list rather than a weakened case.
### Implicit call contracts

| source | concepts |
| --- | --- |
| [Objects](../../docs/foundations/objects.md) | typed object and class layouts, member dispatch, interface views and user-code effects |
| [Language](../../docs/language/README.md) | accessor, conversion, iterator, JSON and async semantics held to node through typed routes |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| accessors | `accessor-*` | 69 | 69 | Class and literal getters/setters across interface, generic and union views; reads, writes, assignments, updates, destructuring, optional reads and own-getter spread |
| conversions | `conversion-*` | 57 | 57 | valueOf, toString, all Symbol.toPrimitive hints, fallbacks, comparisons, string/number conversion, join, default sort and Object.fromEntries keys across three typed views |
| iteration | `iteration-*` | 30 | 30 | Acquisition, next and return through interface, generic and union views; seven consumers, exhaustion, break, body throw and early destructuring |
| json-thenables | `json-*`, `thenable-*` | 18 | 18 | toJSON root/property/index keys and replacer order; await and Promise.resolve with class then methods, resolve/reject and queued effects, across three typed views |
| order | `order-*` | 9 | 9 | Getter/conversion/setter order, computed keys via Object.fromEntries, iterator/getter closing, JSON/replacer order, then getter timing, spread and short circuiting |

Implicit-call controls preserve each case's instrumentation and exact
node answer. A current nts refusal remains a finding; it does not
change the case or its expected result. Backend outcomes belong in
the maintainers' records, not in these tags.

Strict TypeScript 7.0.2 rejects object-valued numeric binary `+`, `-`
and `*` operands, and object-valued computed/indexed property keys.
Those literal forms cannot satisfy this family's no-casts/no-`any`
admission rule. The conversion cases cover accepted numeric coercion
with unary operators and `Number`, string `+`, all relational operators
on compatible typed operands, and key coercion by `Object.fromEntries`.
These are distinct routes, not claims to cover the rejected syntax.

### Numeric route contracts

| source | concepts |
| --- | --- |
| [Language, Numbers](../../docs/language/numbers.md#number) and [Integers proved from doubles](../../docs/language/numbers.md#integers-proved-from-doubles) | IEEE doubles, exact arithmetic, boundaries, NaN and observable signed zero across typed carriers |
| [Foundations, Numbers](../../docs/foundations/numbers.md#integers-proved-from-doubles) | ranges, whole-number and zero-sign facts, field/element/signature summaries and their widening obligations |
| [Numbers as text](../../docs/language/numbers.md#numbers-as-text-and-text-as-numbers) and [Number and text](../../docs/foundations/numbers.md#number-and-text) | node-exact formatting and parsing, decimal and radix fractions, whole-string versus prefix grammars |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| integers | `integer-*` | 24 | 24 | Integer sources across division, fractional multiplication and boundary sums; bitwise results reused in ordinary arithmetic; four Math rounding results |
| zero-nan | `special-*` | 11 | 11 | Five signed-zero producers, explicit ToInt32, comparisons, min/max, numeric sort and includes versus indexOf |
| division | `division-*` | 8 | 8 | Fractional and wide quotients, signed-zero and infinite divisors, signed and fractional remainders, readonly operands and fractional array indices |
| strings | `string-*` | 20 | 20 | String/templates/fixed/precision/radix formatting after numeric carriers, and Number/unary-plus/parseInt/parseFloat followed by carriers and arithmetic |
| types | `types-*` | 7 | 7 | Numeric versus string addition and ordering, widened enums and literal types, constrained numeric generics, and nullish versus truthy defaults |

Number-route cases retain node's exact result even if nts currently
refuses a form. Maintainers run and record each backend separately.
Strict-rejected requested forms, if any, are listed with diagnostics
in the pull request; a case is never weakened to fit a backend.

### Capture route contracts

| source | concepts |
| --- | --- |
| [Language, Closures](../../docs/language/functions.md#closures) | captures retain bindings; writes remain visible to every reader; let iterations have separate bindings |
| [Language, this](../../docs/language/functions.md#this) | arrows retain lexical receivers through later calls and receiver-field changes |
| [Foundations, Functions as values](../../docs/foundations/objects.md#functions-as-values) | captured fields and shared cells, typed function values and escaped readers |
| [Language, Async](../../docs/language/async.md) | suspension and resumption of async functions and generators, including async iteration |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| writes | `writes-*` | 12 | 12 | Representation changes, assignments and restoration, inside and outside compound/nullish writers, shared siblings, generic bindings, object and array identity |
| loops | `loops-*` | 12 | 12 | Separate let and shared var bindings in for, for-of and for-in; update-created readers; break, continue and labelled exits; later array mutations |
| receivers | `receivers-*` | 8 | 8 | Arrows in methods, derived constructors, static blocks, getters and fields; nested arrows; foreign call receivers and map thisArg |
| suspension | `suspension-*` | 9 | 9 | Numeric, union, generic and array writes across await; readers retained after generator completion or closing; async iteration bindings |
| storage | `storage-*` | 11 | 11 | Readers stored in fields, arrays, Maps and interfaces; three nested closures; recursive activations; destructured, catch and default-parameter bindings |

Capture-route cases retain node's exact answer even if nts currently
refuses a form. Maintainers run and record each backend separately.
Strict-rejected requested forms, if any, are listed with diagnostics
in the pull request; cases are never weakened to fit a backend.

### Iterator route contracts

| source | concepts |
| --- | --- |
| ECMAScript [iterator operations](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-iterator-operations), including [IteratorClose](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-iteratorclose) | acquisition, next arguments, result completion, closing and abrupt-completion precedence |
| ECMAScript [generator evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-generator-function-definitions-runtime-semantics-evaluation) | yield and yield-star sends, delegated return and throw, completion values and finally suspension |
| ECMAScript [Map iterators](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-map-iterator-objects) and [Set iterators](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-set-iterator-objects) | live traversal, deletion, insertion, reinsertion and shared iterator position |
| [Language, Generators](../../docs/language/async.md#generators) and [Foundations, Arrays](../../docs/foundations/objects.md#arrays) | typed generator and collection routes whose complete node behavior is held by the cases |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| user-iterables | `user-*` | 11 | 11 | Fresh and reused typed result objects under for-of, spread, Array.from, rest and early destructuring; empty destructuring without next |
| early-exit | `exit-*` | 9 | 9 | Break, continue, labelled exits, function return, body throws, throwing close methods and finally order |
| generators | `generator-*` | 9 | 9 | Sent values, return and throw forwarding, delegate completion values, native and user delegation, abandoned and suspended finally |
| builtins | `builtin-*` | 21 | 21 | Map, Set, Array and string consumers; mapped Array.from; stored entries, keys and values iterators; code points and permanent exhaustion |
| mutation | `mutation-*` | 9 | 9 | Array push, splice and shortening; Map and Set live deletion, insertion and reinsertion; two consumers sharing one cursor |

Iterator-route cases retain node's exact answer even if nts currently
refuses a form. Maintainers run and record each backend separately.
Strict-rejected requested forms, if any, are listed with diagnostics
in the pull request; cases are never weakened to fit a backend.

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
### Map and Set contents contracts

| source | concepts |
| --- | --- |
| [Language, Types, A type is a layout](../../docs/language/types.md#a-type-is-a-layout) and [Decisions](../../docs/language/types.md#decisions) | narrow collection storage requires proof over every writer; a read preserves the stored runtime type across aliases and declared views |
| [Hashing, The design](../../docs/foundations/hashing.md#the-design) and [Decisions](../../docs/foundations/hashing.md#decisions) | SameValueZero, separate key kinds, reference identity, full bigint values, insertion order and live iteration across deleted entries |
| [ECMAScript, Keyed Collections](https://tc39.es/ecma262/multipage/keyed-collections.html) | Map and Set operations, iterator and callback order, Map.groupBy, Set algebra and the size/has/keys set-like protocol |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `widening` | 22 | 22 | Union and unknown writers, readonly live views, generic instantiations, class and interface fields, array elements, narrowing and conditional views |
| `keys` | 12 | 12 | NaN, signed zero, reference identity, number/string separation, bigint widths and symbol identity through typed Map and Set writers |
| `enumeration` | 30 | 30 | Map and Set iterators and callbacks under live mutation and reinsertion, spread and copy snapshots, and Map.groupBy with typed keys |
| `set-methods` | 14 | 14 | Seven Set operations through narrow receivers with widened contents, using typed Set and set-like class arguments |
| `representations` | 22 | 22 | Concrete writes and wider readers for numbers, strings, booleans, references, closures, undefined, nested Maps, bigint, symbols and null |

### Array contents contracts

| source | concepts |
| --- | --- |
| [Language, Types, A type is a layout](../../docs/language/types.md#a-type-is-a-layout) and [Decisions](../../docs/language/types.md#decisions) | narrow array storage requires proof over every writer; aliases, generic instantiations and declared views preserve actual runtime values |
| [Objects, Arrays](../../docs/foundations/objects.md#arrays) | element representations, tuple layouts, indexed access, length-changing effects, holes and covariant aliases |
| [ECMAScript, Array objects](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array-objects) | indexed and method writes, copies, reads, iteration, callback visitation and sparse-slot behavior |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `widening` | 17 | 17 | Union and unknown writers, readonly aliases, generic instantiations, class/interface/Map/array holders, tuple widening and narrowing |
| `writes` | 20 | 20 | Indexed and method writes, length changes, mixed sorting and reversal, sparse copying and six array construction routes |
| `reads` | 18 | 18 | Indexing, membership, predicates, iterators, callbacks, destructuring, rest-argument spread and string/JSON conversions |
| `representations` | 12 | 12 | Concrete writes and wider readers for every primitive kind, object instances and literals, closures, nested arrays, holes and stored undefined |
| `iteration` | 4 | 4 | Push and truncation during for-of, and insertion and deletion by splice inside forEach, through widened writers |
### Typed-array contents contracts

| source | concepts |
| --- | --- |
| [Objects, Typed arrays](../../docs/foundations/objects.md#typed-arrays) | views are windows over shared bytes; element widths, offsets, aliasing, tracking lengths, detachment and typed-array subclasses |
| [ECMAScript, TypedArray objects](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-typedarray-objects) | constructors, methods, factories, conversion on writes, numeric sorting, copied results and iteration |
| [ECMAScript, NumericToRawBytes](https://tc39.es/ecma262/multipage/structured-data.html#sec-numerictorawbytes) and [ToUint8Clamp](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-touint8clamp) | integer wrapping, clamped half-to-even ties, floating-point rounding and bigint widths |
| [ECMAScript, ArrayBuffer objects](https://tc39.es/ecma262/multipage/structured-data.html#sec-arraybuffer-objects) and [DataView objects](https://tc39.es/ecma262/multipage/structured-data.html#sec-dataview-objects) | shared buffers, explicit byte orders, resizing, zeroed regrowth and transfer |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `conversion` | 15 | 15 | All twelve element types through union and constrained-generic writers, boundary wrapping, clamping, rounding and nonfinite inputs |
| `views` | 8 | 8 | Differently typed aliases, offsets, subarray and slice, DataView byte orders, interface and generic routes |
| `buffers` | 6 | 6 | Fixed and tracking views through resize histories, zeroed regrowth, ignored writes and transfer detachment |
| `methods` | 24 | 24 | Mutation, numeric sorting, membership, copied results, factories, reductions and complete iterator observations |
| `subclasses` | 48 | 48 | Twelve element types by length, array, iterable and buffer constructors; converted writes through base parameters and own subclass state |
### JSON route contracts

| source | concepts |
| --- | --- |
| [Language, Types, Decisions](../../docs/language/types.md#decisions) | JSON entering a declared type must match its shape; the mismatch TypeError policy is outside these node-oracle cases |
| [ECMAScript, JSON.parse](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.parse) and [InternalizeJSONProperty](https://tc39.es/ecma262/multipage/structured-data.html#sec-internalizejsonproperty) | number and string grammar, escapes, duplicate keys, reviver order, holders, deletion and replacement |
| [ECMAScript, JSON.stringify](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify) and [SerializeJSONProperty](https://tc39.es/ecma262/multipage/structured-data.html#sec-serializejsonproperty) | own enumerable data, omission versus null substitution, toJSON, replacers, spacing, cycles and bigint errors |
| [ECMAScript, OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryownpropertykeys) and [QuoteJSONString](https://tc39.es/ecma262/multipage/structured-data.html#sec-quotejsonstring) | integer-index ordering, insertion order and well-formed escaping of lone surrogates |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `shapes` | 15 | 15 | Matching objects, arrays, tuples, class field types, generics and unions; number forms, escapes, booleans and null |
| `unknown` | 6 | 6 | Duplicate-name replacement, integer-like key order, ordinary __proto__ keys, deep records and JSON whitespace |
| `revivers` | 8 | 8 | Complete postorder key/value/holder observations, deletion and replacement through declared function types |
| `stringify` | 16 | 16 | Class/interface/union values, omitted and null-substituted values, numbers, Date, Map/Set, strings, cycles and bigint |
| `replacers` | 10 | 10 | Complete callback observations, replacer lists, class toJSON results and numeric/string indentation |
### Record route contracts

| source | concepts |
| --- | --- |
| [Objects, Classes](../../docs/foundations/objects.md#classes), [Interfaces](../../docs/foundations/objects.md#interfaces-satisfied-by-shape) and [Dynamic values](../../docs/foundations/objects.md#dynamic-values) | fixed field layouts, table/name reads and crossings through erased or structural types |
| [ECMAScript, OrdinaryGet](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryget) and [OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryownpropertykeys) | exact field values, membership, array-index sorting and string-key insertion order |
| [ECMAScript, Object.assign](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.assign), [Object.fromEntries](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.fromentries) and [CopyDataProperties](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-copydataproperties) | copying values, target identity, shallow child aliases and entry construction |
| [HTML, Structured cloning](https://html.spec.whatwg.org/multipage/structured-data.html#structured-cloning) | copied outer objects and independent cloned children |
| TypeScript library utility types and [Objects, Decisions](../../docs/foundations/objects.md#decisions) | mapped/generic views and deferred object integrity; static readonly does not freeze a value |
| [ECMAScript, OrdinaryDelete](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinarydelete), [Object.freeze](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.freeze) and [Object.seal](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.seal) | deletion/reinsertion, integrity restrictions and strict write failures through every alias |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `unknown` | 8 | 8 | Literals, classes and Array subclasses through unknown and checked Record/interface views |
| `parameters` | 11 | 11 | Record, string-index and numeric-index parameter views, with callee writes and caller observations |
| `copies` | 8 | 8 | Spread, assign, fromEntries, entries round trips and structuredClone in both typed directions |
| `mapped` | 7 | 7 | Partial, Required, Pick, Omit, Readonly, generic keyof access and optional-field presence |
| `mutations` | 10 | 10 | Deletion, additions, reinsertion order and object integrity before and after Record crossings |
### Generic route contracts

| source | concepts |
| --- | --- |
| [Language, Types, A type is a layout](../../docs/language/types.md#a-type-is-a-layout) and [Objects, Calls](../../docs/foundations/objects.md#calls) | written or inferred type arguments select generic copies with their own layouts; exact runtime payloads survive nested and recursive calls |
| [TypeScript Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html), including Generic Constraints and Generic Parameter Defaults | inference, explicit arguments, constraints, defaults and relationships between type-parameter positions |
| [TypeScript Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html), including Generic Classes, Type Parameters in Static Members and Initialization Order | instance fields, inherited members, shared static state and initialization from a T-valued base field |
| [TypeScript Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) and [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html) | guards within generic bodies, unknown and object/null constraints, and conditional shapes resolved at call sites |
| [ECMAScript Array Objects](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array-objects) and [Keyed Collections](https://tc39.es/ecma262/multipage/keyed-collections.html) | typed container writes and reads, array callbacks, insertion order, presence and Set zero normalization |
| [TypeScript Function Type Expressions](https://www.typescriptlang.org/docs/handbook/2/functions.html#function-type-expressions) and Generic Types | interface implementations, deferred typed callbacks, generic methods and receiver state |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `functions` | 10 | 10 | Identity, homogeneous and heterogeneous pairs/swaps, inference, explicit arguments, defaults, constraints, nested calls and changing-type recursion |
| `classes` | 14 | 14 | Box, Cell and Stack representations, shared Cell aliases, fixed subclasses, shared static state, static factories and T-valued field initialization |
| `containers` | 9 | 9 | Array, Map and Set writers/readers across instantiations, plus filter, map and reduce specializations |
| `narrowing` | 5 | 5 | typeof and in over union instantiations, unknown/object-null constraints and call-site conditional shapes |
| `callbacks` | 4 | 4 | Comparer and Mapper implementations, deferred callback fields and generic methods on a shared non-generic receiver |

### Union route contracts

| source | concepts |
| --- | --- |
| [TypeScript Union Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types) | declared primitive and object unions carried by fields, parameters, returns, arrays, Maps, Sets, tuples and closures |
| [TypeScript Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | typeof, instanceof, in, equality, assignments, control-flow analysis, truthful type predicates, discriminated unions and never exhaustiveness |
| [TypeScript Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#assignments) and [Union Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types) | narrower values stored through wider declarations, unknown refinement, generic union arguments, overload and conditional results, and arrays built with union elements |
| [ECMAScript Set.prototype.add](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-set.prototype.add) | SameValueZero membership and positive-zero canonicalization for raw numeric elements, with object payload identity retained |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `storage` | 30 | 30 | Five primitive unions across fields, arrays, Maps, Sets, tuple slots and closures, with exact branch and printed-value histories |
| `narrowing` | 10 | 10 | typeof, instanceof, in, exhaustive switches, literal equality, Array.isArray, truthful predicates and closure or assignment refinements |

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
| `ts-abstract` | an `abstract` class and its abstract members | conformance/classes/classDeclarations/classAbstractKeyword; ts-eslint TSAbstractMethodDefinition, TSAbstractPropertyDefinition | 9 | 1 |
| `ts-accessor-fields` | an `accessor` field (auto-accessor), static, private or abstract | conformance/classes/propertyMemberDeclarations/autoAccessor; ts-eslint AccessorProperty, TSAbstractAccessorProperty | 0 | 7 |
| `ts-accessors` | `get`/`set` accessors on a class or an object literal | conformance/classes/propertyMemberDeclarations; typed paths | 268 | 4 |
| `ts-ambient` | an ambient declaration (`declare var/function/class/namespace/global`), which emits nothing | conformance/ambient; ts-eslint TSDeclareFunction, `declare` modifiers | 6 | 1 |
| `ts-any` | an explicitly `any`-typed value, the dynamic escape hatch | conformance/types/any; ts-eslint TSAnyKeyword | 4 | 0 |
| `ts-array-contents` | array elements retain values, runtime kinds, order and slot presence across typed writes and reads | Array contents contracts; typed paths | 142 | 0 |
| `ts-array-iteration` | writes through typed aliases during iteration preserve live traversal and callback semantics | Objects, Arrays; ECMAScript, CreateArrayIterator and Array.prototype.forEach | 8 | 0 |
| `ts-array-reads` | indexed, method, iterator and conversion reads observe actual values through differing declared types | Array contents contracts; typed paths | 36 | 0 |
| `ts-array-representation` | concrete element storage crosses a wider reader with exact payloads, identities and slot presence | Language, Types, A type is a layout; Objects, Arrays | 24 | 0 |
| `ts-array-widening` | one array crosses wider, readonly, generic, holder or tuple views without changing stored values | Language, Types, Decisions; Array contents contracts | 34 | 0 |
| `ts-array-writes` | writes and array construction through widened routes preserve values, length, order and holes | Objects, Arrays; ECMAScript, Array prototype methods | 40 | 0 |
| `ts-arrays` | typed arrays of values (`T[]`, `Array<T>`) and their methods | conformance/types/primitives; ts-eslint TSArrayType | 2529 | 0 |
| `ts-arrow-functions` | an arrow function, generic or typed | conformance/es6/arrowFunction | 419 | 0 |
| `ts-as-const` | a const assertion (`as const`), which is not a freeze | conformance/expressions/typeAssertions/constAssertions | 4 | 0 |
| `ts-assertion-functions` | an assertion function (`asserts value is T`, `asserts condition`) | conformance/controlFlow/assertionTypePredicates; ts-eslint TSTypePredicate.asserts | 101 | 0 |
| `ts-async-generators` | an async generator, `for await`, and `Symbol.asyncIterator` | conformance/es2018 (asyncGenerators, forAwait); conformance/types/forAwait | 31 | 0 |
| `ts-async` | async functions, methods and arrows, and the promises they return | conformance/async; conformance/es2017 | 168 | 1 |
| `ts-bigint` | `bigint` values, literals and literal types in typed code | conformance/es2020 (bigint); ts-eslint TSBigIntKeyword | 198 | 0 |
| `ts-builtin-subclass` | a class extending a built-in (Array, Error, Map) | conformance/es6/classDeclaration; typed paths | 69 | 0 |
| `ts-call-route-population` | independent callback targets coexist in one typed registry | typed call routes: Language, Functions; Errors; Async | 12 | 0 |
| `ts-call-route-receiver` | receiver identity and arguments through extracted or stored methods | typed call routes: Language, Functions; Errors; Async | 22 | 0 |
| `ts-call-route-shape` | parameter adaptation across typed variables, fields, arrays and Maps | typed call routes: Language, Functions; Errors; Async | 52 | 0 |
| `ts-call-route-suspension` | async and generator functions called through typed values and fields | typed call routes: Language, Functions; Errors; Async | 20 | 0 |
| `ts-call-route-throw` | exception propagation, rethrow identity and cleanup through typed call routes | typed call routes: Language, Functions; Errors; Async | 28 | 0 |
| `ts-call-signatures` | a call signature in an interface or type literal: a callable object with properties | conformance/types/members; ts-eslint TSCallSignatureDeclaration | 22 | 0 |
| `ts-capture-route-loops` | loops across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 24 | 0 |
| `ts-capture-route-receivers` | this and receivers across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 16 | 0 |
| `ts-capture-route-storage` | storage and nesting across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 22 | 0 |
| `ts-capture-route-suspension` | across await and yield across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 18 | 0 |
| `ts-capture-route-writes` | writes after capture across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 24 | 0 |
| `ts-class-expression` | a class expression, named or anonymous | conformance/classes/classExpressions; conformance/es6/classExpressions | 13 | 0 |
| `ts-class-fields` | instance and static field declarations, with define semantics (`useDefineForClassFields`) | conformance/classes/propertyMemberDeclarations; ts-eslint PropertyDefinition | 871 | 4 |
| `ts-class-static-block` | a `static { }` block | conformance/classes/classStaticBlock; ts-eslint StaticBlock | 4 | 0 |
| `ts-class` | a class declaration or expression | conformance/classes | 1456 | 29 |
| `ts-closures` | a function or class capturing typed locals | conformance/functions; typed paths | 574 | 1 |
| `ts-builtin-cast` | an own value asserted to a builtin constructor or object type keeps its runtime identity | builtin identity contracts; ts-eslint TSAsExpression | 76 | 0 |
| `ts-builtin-identity` | the declaration or runtime value selects a builtin operation; spelling and asserted types do not establish identity | builtin identity contracts: Builtins, Feature identity; typed paths | 544 | 0 |
| `ts-builtin-invocation` | call and construction preserve argument semantics through typed targets | builtin identity contracts; conformance/expressions/newOperator, callExpressions; typed paths | 60 | 0 |
| `ts-builtin-name` | a typed class, function, object or parameter shadows a builtin name in lexical scope | builtin identity contracts; conformance/classes, functions, internalModules | 300 | 0 |
| `ts-builtin-reflection` | typed values reach builtin identity through Reflect, globalThis or direct-prototype inspection | builtin identity contracts; Language, Boundaries; typed paths | 16 | 0 |
| `ts-builtin-value` | a builtin is called or constructed through typed storage, a parameter, a return, a condition or destructuring | builtin identity contracts; conformance/types/members; typed paths | 32 | 0 |
| `ts-commonjs` | a CommonJS-format TypeScript module | conformance/externalModules | 0 | 5 |
| `ts-computed-keys` | a computed property key in a literal, a class or a type | conformance/es6/computedProperties | 23 | 0 |
| `ts-conditional-types` | a conditional type (`T extends U ? X : Y`), distributive over unions | conformance/types/conditional; ts-eslint TSConditionalType | 5 | 0 |
| `ts-const-enum` | a `const enum` | conformance/constEnums; ts-eslint TSEnumDeclaration (const) | 3 | 1 |
| `ts-const-type-parameters` | a `const` type parameter | conformance/types/typeParameters/typeParameterLists; ts-eslint TSTypeParameter.const | 1 | 0 |
| `ts-construct-signatures` | a construct signature or constructor type (`new () => T`) | conformance/types/members; ts-eslint TSConstructorType, TSConstructSignatureDeclaration | 79 | 0 |
| `ts-contents-enumeration` | typed collection enumeration preserves kinds, order, live mutations, snapshots and grouping | Hashing, Decisions; Map and Set contents contracts | 60 | 0 |
| `ts-contents-keys` | typed collection keys preserve SameValueZero, kind separation and reference identity | Hashing, The design; Map and Set contents contracts | 24 | 0 |
| `ts-contents-representation` | concrete stored values retain their payloads, identities and live contents through wider readers | Language, Types, A type is a layout; typed paths | 44 | 0 |
| `ts-contents-set-methods` | typed Set algebra and predicates observe widened contents and the set-like protocol | Map and Set contents contracts; typed paths | 28 | 0 |
| `ts-contents-widening` | one collection is written and read through different declared, generic or readonly views | Language, Types, Decisions; typed paths | 44 | 0 |
| `ts-conversions` | implicit and explicit conversions of typed values: ToPrimitive, ToNumber, ToString, ToBoolean | conformance/expressions/binaryOperators; conformance/expressions/unaryOperators; typed paths | 806 | 0 |
| `ts-declaration-merging` | two declarations of one name merged into one entity | conformance/internalModules/DeclarationMerging; conformance/interfaces/declarationMerging | 11 | 5 |
| `ts-declare-field` | a `declare` class field, which emits nothing | conformance/classes/propertyMemberDeclarations; ts-eslint PropertyDefinition.declare | 1 | 0 |
| `ts-decorators` | standard (TC39) decorators on classes, methods, fields, accessors; context, addInitializer, metadata | conformance/esDecorators; ts-eslint Decorator | 0 | 12 |
| `ts-default-parameters` | a parameter with a default value | conformance/es6/defaultParameters | 43 | 0 |
| `ts-definite-assignment` | a definite assignment assertion (`x!: T`, `let x!: T`) | conformance/controlFlow/definiteAssignmentAssertions; ts-eslint PropertyDefinition.definite | 2 | 0 |
| `ts-destructuring` | a typed destructuring declaration, parameter or assignment | conformance/es6/destructuring | 248 | 0 |
| `ts-discriminated-unions` | a union of object types told apart by a literal-typed property | conformance/types/union/discriminatedUnionTypes | 69 | 0 |
| `ts-dynamic-import` | a dynamic `import()` of a typed module | conformance/dynamicImport | 0 | 1 |
| `ts-enum-computed` | an enum member whose initialiser is an expression, constant or not | conformance/enums | 6 | 0 |
| `ts-enum-reverse-mapping` | a numeric enum member's value mapped back to its name | conformance/enums | 5 | 0 |
| `ts-enum-string` | a string-valued enum member | conformance/enums | 6 | 0 |
| `ts-enum` | an `enum` declaration and its object | conformance/enums; ts-eslint TSEnumDeclaration | 34 | 3 |
| `ts-errors` | exceptions in typed code: `catch` bindings typed `unknown`, Error subclasses, finally | conformance/statements/tryStatements; typed paths | 519 | 0 |
| `ts-expando` | properties assigned to a function declaration (an expando) | conformance/functions (expando assignments, TypeScript 3.1) | 1 | 0 |
| `ts-exponent` | the `**` operator and `**=` | conformance/es7/exponentiationOperator | 2 | 0 |
| `ts-export-equals` | `export =` | conformance/externalModules; ts-eslint TSExportAssignment | 0 | 4 |
| `ts-exports` | export declarations, lists, renames and defaults, read back within the module | conformance/externalModules; conformance/es6/modules; ts-eslint ExportNamedDeclaration | 10 | 3 |
| `ts-expressions` | ordinary operators in typed code: increments, comma, void, delete, in | conformance/expressions | 160 | 0 |
| `ts-function-types` | a function type (`(x: T) => U`) for a parameter, field or type argument | conformance/types/members; ts-eslint TSFunctionType | 551 | 0 |
| `ts-functions` | function declarations, expressions and calls in typed code | conformance/functions; conformance/es6/functionDeclarations | 3244 | 4 |
| `ts-generators` | a generator function or method, typed `Generator<T, TReturn, TNext>` | conformance/generators; conformance/es6/yieldExpressions | 133 | 0 |
| `ts-generic-constraints` | a type parameter's constraint (`<T extends C>`) | conformance/types/typeParameters/typeArgumentLists; ts-eslint TSTypeParameter.constraint | 192 | 0 |
| `ts-generic-defaults` | a type parameter's default (`<T = number>`) | conformance/types/typeParameters/typeParameterLists | 10 | 0 |
| `ts-generics` | type parameters on a function, class, method or interface | conformance/types/typeParameters; ts-eslint TSTypeParameter | 558 | 0 |
| `ts-implicit-accessor` | implicit getter and setter calls through typed views, with exact order and visible effects | implicit call contracts: Objects; Language; typed paths | 138 | 0 |
| `ts-implicit-conversion` | implicit valueOf, toString and Symbol.toPrimitive calls through typed views, with exact order and visible effects | implicit call contracts: Objects; Language; typed paths | 114 | 0 |
| `ts-implicit-iteration` | implicit iterator acquisition, stepping and closing through typed views, with exact order and visible effects | implicit call contracts: Objects; Language; typed paths | 60 | 0 |
| `ts-implicit-json` | implicit toJSON calls through typed views, including key arguments and replacer order | implicit call contracts: Objects; Language; typed paths | 24 | 0 |
| `ts-implicit-order` | ordered effects across several implicit calls in one typed expression or protocol operation | implicit call contracts: Objects; Language; typed paths | 18 | 0 |
| `ts-implicit-thenable` | implicit class then calls through typed views, including queued resolution and rejection effects | implicit call contracts: Objects; Language; typed paths | 12 | 0 |
| `ts-generic-route-callbacks` | generic interfaces, stored callbacks and generic methods preserve call arguments, results, identities and receiver state | TypeScript Generic Types; Function Type Expressions | 8 | 0 |
| `ts-generic-route-classes` | generic class fields and methods preserve values across instantiations, aliases, inheritance, initialization and shared static state | TypeScript Generic Classes; Objects, Classes | 28 | 0 |
| `ts-generic-route-containers` | array, Map and Set contents and callbacks preserve values across generic writer and reader instantiations | TypeScript Generics; Array, Map and Set objects | 18 | 0 |
| `ts-generic-route-functions` | multiple generic function instantiations preserve payloads through arguments, tuples, defaults, constraints, nested calls and recursion | TypeScript Generics; Language, Types | 20 | 0 |
| `ts-generic-route-narrowing` | union, unknown, constrained and conditional instantiations preserve runtime payloads through guards and resolved shapes | TypeScript Narrowing; Generic Constraints; Conditional Types | 10 | 0 |
| `ts-generic-routes` | stored, returned and compared values preserve their runtime representation across generic instantiations and handwritten concrete controls | Generic route contracts; typed paths | 84 | 0 |
| `ts-import-alias` | `import X = N.Y`, an alias for a namespace or a value it exports (`export import` too) | conformance/internalModules/importDeclarations; ts-eslint TSImportEqualsDeclaration | 3 | 0 |
| `ts-import-require` | `import x = require("...")` | conformance/externalModules; ts-eslint TSImportEqualsDeclaration, TSExternalModuleReference | 0 | 5 |
| `ts-import-type` | `import type` and TypeScript's elision of imports used only as types | conformance/externalModules/typeOnly; ts-eslint ImportDeclaration.importKind | 0 | 2 |
| `ts-imports` | import declarations between modules: named, default, namespace, side-effect, cycles | conformance/externalModules; conformance/es6/modules | 0 | 9 |
| `ts-index-signatures` | an index signature (`[key: string]: T`) on a type, interface or class | conformance/classes/indexMemberDeclarations; ts-eslint TSIndexSignature | 106 | 0 |
| `ts-indexed-access` | an indexed access type (`T[K]`) | conformance/types/keyof; ts-eslint TSIndexedAccessType | 9 | 0 |
| `ts-infer` | `infer` in a conditional type | conformance/types/conditional; ts-eslint TSInferType | 1 | 0 |
| `ts-inheritance` | `extends` between classes: super calls, super property access, the prototype chain | conformance/classes/classDeclarations/classHeritageSpecification; conformance/expressions/superCalls | 308 | 3 |
| `ts-instanceof` | `instanceof`, and narrowing by it | conformance/expressions/typeGuards/typeGuardsWithInstanceOf | 298 | 0 |
| `ts-instantiation-expression` | an instantiation expression (`f<number>`), erased | conformance/types/typeParameters/typeArgumentLists/instantiationExpressions; ts-eslint TSInstantiationExpression | 1 | 0 |
| `ts-interface-extends` | an interface extending interfaces or a class | conformance/interfaces/interfaceDeclarations; conformance/interfaces/interfacesExtendingClasses; ts-eslint TSInterfaceHeritage | 6 | 0 |
| `ts-interfaces` | an interface, implemented by a class or satisfied by a literal | conformance/interfaces; ts-eslint TSInterfaceDeclaration | 826 | 0 |
| `ts-intersections` | an intersection type (`A & B`) and values of it | conformance/types/intersection; ts-eslint TSIntersectionType | 14 | 0 |
| `ts-iteration` | the iteration protocols in typed code: Iterable, Iterator, for-of, spread, destructuring | conformance/es6/for-ofStatements; conformance/types/forAwait; lib.es2015.iterable.d.ts | 3064 | 0 |
| `ts-json-replacers` | typed replacers, toJSON methods and space arguments preserve callback observations, selected keys and exact formatting | JSON.stringify; SerializeJSONProperty; SerializeJSONObject; SerializeJSONArray | 20 | 0 |
| `ts-json-revivers` | declared reviver function routes preserve complete ordered key, value and holder observations through deletion and replacement | JSON.parse; InternalizeJSONProperty | 16 | 0 |
| `ts-json-routes` | JSON values preserve exact parsed contents, serialization and callback observations across typed routes | JSON route contracts; typed paths | 110 | 0 |
| `ts-json-shapes` | matching JSON enters an annotated interface, field type, tuple, generic or union with exact leaf values and key order | Language, Types, Decisions; JSON.parse | 30 | 0 |
| `ts-json-stringify` | declared classes, interfaces and unions serialize with exact conversion, omission, escaping and error behavior | JSON.stringify; SerializeJSONProperty; QuoteJSONString | 32 | 0 |
| `ts-json-unknown` | unknown JSON results are truthfully narrowed before duplicate-key, ordering, nesting and whitespace observations | JSON route contracts; ParseJSON; OrdinaryOwnPropertyKeys | 12 | 0 |
| `ts-iterator-route-builtins` | builtin iterables through typed routes with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 42 | 0 |
| `ts-iterator-route-early-exit` | early exit with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 18 | 0 |
| `ts-iterator-route-generators` | generators with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 18 | 0 |
| `ts-iterator-route-mutation` | iterating while changing with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 18 | 0 |
| `ts-iterator-route-user-iterables` | user iterables with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 22 | 0 |
| `ts-jsx` | JSX in a `.tsx` file, compiled to factory calls | conformance/jsx; ts-eslint JSX nodes | 0 | 6 |
| `ts-keyof` | `keyof T`, and values of that type | conformance/types/keyof; ts-eslint TSTypeOperator | 47 | 0 |
| `ts-legacy-decorators` | `experimentalDecorators`: class, method, property, accessor and parameter decorators | conformance/decorators | 0 | 8 |
| `ts-lifetime-acyclic` | a construction route closes a cycle that an acyclicity proof must include | lifetime contracts: Memory, How small the dynamic part can get; Cycles through foreign objects | 24 | 0 |
| `ts-lifetime-borrow` | a borrowed reference remains live after its original anchor or read-only call ends | lifetime contracts: Memory, Where nts stands; The ladder of homes; record 0024 | 24 | 0 |
| `ts-lifetime-frame` | an object or bounded string must outlive a frame after a retention route acts | lifetime contracts: Memory, The ladder of homes; Where nts stands | 28 | 0 |
| `ts-lifetime-in-place` | a retained old value remains observable during or after a string append or immutable update | lifetime contracts: Memory, The design, Principles and What it unlocks; record 0029 | 24 | 0 |
| `ts-lifetime-move` | a last-use transfer must preserve a reference still reachable through another route | lifetime contracts: Memory, Where nts stands; The ladder of homes; record 0024 | 25 | 0 |
| `ts-lifetime-region` | a reference remains reachable after the original call result reaches its last use | lifetime contracts: Memory, The ladder of homes; Resetting a region is safe only if nothing can still walk into it; A region needs two proofs | 25 | 0 |
| `ts-lifetime-scalar` | an object initially used through fields gains an observable identity or shared mutation | lifetime contracts: Memory, Where nts stands; The ladder of homes | 20 | 0 |
| `ts-lifetime-slot` | successive loop allocations remain distinct when their live instances overlap | lifetime contracts: Memory, Where nts stands; The one memory analysis | 18 | 0 |
| `ts-literal-types` | string, number and boolean literal types and the values they admit | conformance/types/literal; conformance/types/stringLiteral; ts-eslint TSLiteralType | 27 | 0 |
| `ts-map-set` | `Map<K, V>` and `Set<T>` in typed code | typed paths | 674 | 0 |
| `ts-map-set-contents` | Map and Set contents keep their values, runtime kinds and order across typed writes and reads | Map and Set contents contracts; typed paths | 200 | 0 |
| `ts-mapped-types` | a mapped type (`{ [K in keyof T]: U }`), with modifiers and `as` remapping | conformance/types/mapped; ts-eslint TSMappedType | 20 | 0 |
| `ts-mixins` | a function returning a subclass of the class it is given | conformance/classes/mixinClassesAndInterfaces | 4 | 0 |
| `ts-modules` | an ES module (the `module` flag): module scope, strictness, top-level await | conformance/externalModules; conformance/es6/modules | 324 | 10 |
| `ts-namespace` | a namespace (internal module) and its object | conformance/internalModules; ts-eslint TSModuleDeclaration | 88 | 6 |
| `ts-narrowing` | control-flow narrowing of a union or `unknown` | conformance/controlFlow; conformance/expressions/typeGuards | 457 | 0 |
| `ts-never` | the `never` type: an unreachable value or a function that does not return | conformance/types/never | 4 | 0 |
| `ts-new-target` | `new.target` | conformance/es6/newTarget | 7 | 0 |
| `ts-non-null` | a non-null assertion (`x!`), erased, never a check | conformance/expressions (non-null assertions); ts-eslint TSNonNullExpression | 5 | 0 |
| `ts-null-undefined` | `null`, `undefined` and `T | undefined` under strictNullChecks | conformance/types/primitives; typed paths | 630 | 0 |
| `ts-numbers` | IEEE doubles in typed code: fractions, -0, NaN, int32 operators, formatting | conformance/types/primitives/number; typed paths | 1733 | 0 |
| `ts-object-type` | the non-primitive `object` type | conformance/types/nonPrimitive; ts-eslint TSObjectKeyword | 11 | 0 |
| `ts-objects` | object literals and object types: properties, methods, keys, copies | conformance/expressions/objectLiterals; conformance/types/objectTypeLiteral; ts-eslint TSTypeLiteral | 1368 | 0 |
| `ts-number-route-division` | division and remainder across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 16 | 0 |
| `ts-number-route-integers` | integers that stop being integers across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 48 | 0 |
| `ts-number-route-strings` | conversions to and from strings across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 40 | 0 |
| `ts-number-route-types` | numbers in unions, enums and generics across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 14 | 0 |
| `ts-number-route-zero-nan` | signed zero and nan across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 22 | 0 |
| `ts-optional-chaining` | `?.` on properties, calls and elements, in typed code | conformance/expressions/optionalChaining | 20 | 0 |
| `ts-optional-parameters` | a parameter marked `?` | conformance/functions; conformance/types/members | 35 | 0 |
| `ts-optional-properties` | a property marked `?` in a type, a class or an interface | conformance/types/members; conformance/types/objectTypeLiteral | 46 | 0 |
| `ts-overloads` | overload signatures on a function, method or constructor | conformance/functions/functionOverloads; ts-eslint TSDeclareFunction, TSEmptyBodyFunctionExpression | 17 | 0 |
| `ts-override` | the `override` modifier on a method, accessor or field | conformance/override; ts-eslint MethodDefinition.override | 96 | 0 |
| `ts-parameter-properties` | a constructor parameter with a modifier, which declares and assigns a field | conformance/classes/constructorDeclarations; ts-eslint TSParameterProperty | 11 | 0 |
| `ts-private-fields` | ECMAScript `#private` fields, methods and accessors | conformance/classes/members/privateNames | 10 | 2 |
| `ts-private-keyword` | the `private` modifier, a compile-time check over an ordinary property | conformance/classes/members/accessibility; ts-eslint TSPrivateKeyword | 7 | 0 |
| `ts-proof-bounds` | an index proved in range before a route changes the index or the container | proof contracts: Objects, Arrays; Numbers, Integers proved from doubles | 166 | 0 |
| `ts-proof-call-target` | a known receiver or closure target changes before a dispatch or specialized call | proof contracts: Objects, Calls and Functions as values; Language, Functions | 89 | 0 |
| `ts-proof-capture` | a write invalidates copying a captured binding instead of sharing its cell | proof contracts: Objects, Functions as values; Language, Functions | 65 | 0 |
| `ts-proof-element-kind` | a non-integer store invalidates a whole-program integer element kind | proof contracts: Objects, Arrays; Numbers, Integers proved from doubles | 151 | 0 |
| `ts-proof-length` | an allocation or guard proves a length before a route changes it | proof contracts: Objects, Arrays | 82 | 0 |
| `ts-proof-negative-zero` | a zero sign becomes observable after a route invalidates its omission | proof contracts: Numbers, Integers proved from doubles; Language, Numbers | 63 | 0 |
| `ts-proof-whole-number` | a whole finite value in range loses its integer representation proof | proof contracts: Numbers, Integers proved from doubles; Language, Numbers | 89 | 0 |
| `ts-protected` | the `protected` modifier | conformance/classes/members/accessibility; ts-eslint TSProtectedKeyword | 1 | 0 |
| `ts-readonly` | `readonly` properties, arrays and tuples, which are not frozen | conformance/types/tuple/readonlyArraysAndTuples; ts-eslint TSReadonlyKeyword | 191 | 0 |
| `ts-record` | `Record<K, V>` | conformance/types/mapped; lib | 128 | 0 |
| `ts-rest-parameters` | a rest parameter, typed as an array or a tuple | conformance/es6/restParameters | 41 | 0 |
| `ts-record-copies` | spread, assign, entry construction and cloning preserve values, ordering and specified copy or alias relationships across views | CopyDataProperties; Object.assign; Object.fromEntries; HTML structured cloning | 16 | 0 |
| `ts-record-mapped` | utility types and generic keyof routes preserve actual field presence, values, ordering and alias mutation | TypeScript utility types; Objects, Interfaces; typed paths | 14 | 0 |
| `ts-record-mutations` | deletion, additions, reinsertion and object integrity preserve exact shapes and values through Record views | OrdinaryDelete; OrdinaryOwnPropertyKeys; Object.freeze; Object.seal | 20 | 0 |
| `ts-record-parameters` | Record and index-signature parameters preserve computed reads, complete enumeration and caller-visible writes | Objects, Interfaces; typed paths | 22 | 0 |
| `ts-record-routes` | objects preserve exact values, membership, enumeration order and alias writes across fixed-field and table views | Record route contracts; typed paths | 88 | 0 |
| `ts-record-unknown` | unknown-held objects reach checked Record or interface views with exact contents and aliases | Objects, Dynamic values; TypeScript narrowing | 16 | 0 |
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
| `ts-spread` | spread and rest of objects and arrays in typed code | conformance/types/spread; conformance/es6/spread | 273 | 1 |
| `ts-static` | static fields, methods and accessors | conformance/classes/propertyMemberDeclarations; ts-eslint TSStaticKeyword | 92 | 4 |
| `ts-strings` | strings in typed code: UTF-16 length and indexing against code points | conformance/types/primitives/string; typed paths | 1081 | 0 |
| `ts-structural-typing` | a value accepted for its shape, not its declared name: literals and classes that never say `implements` | conformance/types/typeRelationships; typed paths | 62 | 0 |
| `ts-symbols` | symbols as keys, well-known symbols, `unique symbol` | conformance/Symbols; conformance/es6/Symbols; conformance/types/uniqueSymbol | 210 | 2 |
| `ts-tagged-templates` | a tagged template with a typed tag function | conformance/es6/templates | 1 | 0 |
| `ts-template-literal-types` | a template literal type, and the intrinsic string types (Uppercase, Capitalize, ...) | conformance/types/literal/templateLiteralTypes; ts-eslint TSTemplateLiteralType | 8 | 0 |
| `ts-template-literals` | template literal expressions and their substitutions | conformance/es6/templates | 94 | 0 |
| `ts-this-parameter` | a `this` parameter, which is erased | conformance/types/thisType; conformance/functions | 152 | 0 |
| `ts-this-type` | the polymorphic `this` type | conformance/types/thisType | 2 | 0 |
| `ts-this` | `this` in methods, arrow fields and detached calls | conformance/expressions/thisKeyword | 138 | 1 |
| `ts-to-primitive` | an object converted to a primitive: `valueOf`, `toString`, `Symbol.toPrimitive` | typed paths | 215 | 0 |
| `ts-to-string` | an object converted to a string by its `toString` | typed paths | 114 | 0 |
| `ts-throw-route-async` | exception identity and ordered effects across awaited typed calls and promise routes | typed throw routes: Errors; Functions; Async; Objects, Calls | 24 | 0 |
| `ts-throw-route-call` | exception identity, arguments and cleanup across typed calls | typed throw routes: Errors; Functions; Async; Objects, Calls | 28 | 0 |
| `ts-throw-route-construction` | exceptions crossing typed construction and initialization without a completed instance escaping | typed throw routes: Errors; Functions; Async; Objects, Calls | 10 | 0 |
| `ts-throw-route-implicit` | exception identity and cleanup across typed implicit hooks and collection callbacks | typed throw routes: Errors; Functions; Async; Objects, Calls | 36 | 0 |
| `ts-throw-route-iteration` | exception identity, precedence and cleanup across typed iteration and generator routes | typed throw routes: Errors; Functions; Async; Objects, Calls | 24 | 0 |
| `ts-throw-route-unwind` | exception replacement, rethrow identity and ordered cleanup across typed routes | typed throw routes: Errors; Functions; Async; Objects, Calls | 16 | 0 |
| `ts-tuple-labels` | a labelled tuple element (`[start: number]`) | conformance/types/tuple/named; ts-eslint TSNamedTupleMember | 2 | 0 |
| `ts-tuple-optional` | an optional tuple element (`[a, b?]`) | conformance/types/tuple; ts-eslint TSOptionalType | 2 | 0 |
| `ts-tuple-rest` | a rest element in a tuple, leading, middle or trailing | conformance/types/tuple; ts-eslint TSRestType | 2 | 0 |
| `ts-tuples` | a tuple type and the array that carries it | conformance/types/tuple; ts-eslint TSTupleType | 657 | 0 |
| `ts-type-aliases` | a `type` alias, generic or recursive | conformance/types/typeAliases; ts-eslint TSTypeAliasDeclaration | 248 | 0 |
| `ts-type-assertions` | a type assertion (`x as T`, `<T>x`), erased, never a conversion | conformance/expressions/asOperator; conformance/expressions/typeAssertions; ts-eslint TSAsExpression, TSTypeAssertion | 81 | 0 |
| `ts-type-guards` | a user-defined type predicate (`value is T`) | conformance/expressions/typeGuards; ts-eslint TSTypePredicate | 137 | 0 |
| `ts-type-operators` | values flowing through type-level operators: keyof, typeof, indexed access, mapped and conditional types | conformance/types (keyof, typeQueries, mapped, conditional) | 33 | 0 |
| `ts-typeof-operator` | the run-time `typeof` operator over typed values | conformance/expressions/typeGuards/typeGuardsWithTypeOf | 1200 | 0 |
| `ts-typed-array-buffers` | fixed and tracking views retain the specified contents and metadata through buffer resize and transfer | Typed-array contents contracts; ArrayBuffer resize and ArrayBufferCopyAndDetach | 12 | 0 |
| `ts-typed-array-contents` | typed-array elements and bytes preserve their exact contents and view metadata across typed routes | Typed-array contents contracts; typed paths | 202 | 0 |
| `ts-typed-array-conversion` | writes through union and generic view parameters obey each element type's wrapping, clamping or rounding | Typed-array contents contracts; NumericToRawBytes; ToUint8Clamp | 30 | 0 |
| `ts-typed-array-methods` | typed receivers, sources and factories preserve exact mutation, conversion, copying, searching and iteration results | ECMAScript, TypedArray objects and CompareTypedArrayElements | 48 | 0 |
| `ts-typed-array-subclasses` | subclass contents cross base-typed parameters while preserving conversion, view geometry, identity and own state | Objects, Typed arrays; ECMAScript, TypedArray constructors and TypedArraySetElement | 96 | 0 |
| `ts-typed-array-views` | typed view aliases observe shared bytes, offsets, subarray aliasing, slice copies and explicit DataView byte orders | Objects, Typed arrays; ECMAScript, TypedArray and DataView objects | 16 | 0 |
| `ts-typeof-type` | `typeof x` in a type position | conformance/types/typeQueries; ts-eslint TSTypeQuery | 96 | 0 |
| `ts-unicode-case-mapping` | default lower/uppercase mappings, expansions, Final_Sigma, surrogate handling and newly assigned letters | Unicode contracts; UCD SpecialCasing, DerivedAge and UnicodeData | 207 | 0 |
| `ts-unicode-exhaustive` | every code point, including lone surrogates, checked by a Node-generated FNV-1a UTF-16 hash per 4096-point block | Unicode contracts: Staying identical to node, exhaustive layer | 34 | 0 |
| `ts-unicode-sequences` | exact contextual strings or API observations that a per-code-point sweep cannot establish | Unicode contracts: Staying identical to node, sequence and behaviour layers | 173 | 0 |
| `ts-union-route-narrowing` | typed guards, discriminants, equality, arrays and predicates select the correct member across returns, closures and assignments | TypeScript Narrowing; control-flow analysis | 20 | 0 |
| `ts-union-route-storage` | five primitive unions cross fields, arrays, Maps, Sets, tuple slots and closures with exact read and printed-value histories | TypeScript Union Types; typed paths; Set semantics | 60 | 0 |
| `ts-union-routes` | declared unions preserve exact payloads, runtime kinds, identities and branch histories across typed routes beside concrete-record controls | Union route contracts; typed paths | 80 | 0 |
| `ts-unions` | a union type and the values that flow through it | conformance/types/union; ts-eslint TSUnionType | 992 | 0 |
| `ts-unique-symbol` | a `unique symbol` constant as a member key | conformance/types/uniqueSymbol | 1 | 0 |
| `ts-unknown` | the `unknown` type, narrowed before use | conformance/types/unknown; ts-eslint TSUnknownKeyword | 992 | 0 |
| `ts-unsound-arity` | a shorter function signature hides an optional parameter from a wider caller | conformance/types/typeRelationships; typed paths | 3 | 0 |
| `ts-unsound-assertion` | an assertion function claims a type without establishing it at runtime | conformance/controlFlow/assertionTypePredicates; typed paths | 89 | 0 |
| `ts-unsound-bivariance` | method parameter bivariance permits a wider writer to violate a narrow value type | conformance/types/typeRelationships; typed paths | 203 | 0 |
| `ts-unsound-covariant-array` | array covariance permits a wider writer to violate the original element type | conformance/types/typeRelationships; typed paths | 134 | 0 |
| `ts-unsound-covariant-view` | a readonly or covariant view retains a narrow claim after a mutable wider alias writes | conformance/types/typeRelationships; typed paths | 92 | 0 |
| `ts-unsound-generic-widening` | a wider generic instantiation writes an incompatible value or retains an invalid property claim | conformance/types/typeParameters; typed paths | 101 | 0 |
| `ts-unsound-object-assign` | Object.assign overwrites a property while the original target retains its narrow type | conformance/types/typeRelationships; typed paths | 1 | 0 |
| `ts-unsound-overload` | an overload return type can disagree with its accepted implementation | conformance/functions/overloads; typed paths | 1 | 0 |
| `ts-unsound-predicate` | a user-written type predicate claims a type the runtime value does not have | conformance/controlFlow/typePredicate; typed paths | 89 | 0 |
| `ts-unsound-private` | compile-time privacy allows literal-key access that can participate in a false type claim | conformance/classes/propertyMemberDeclarations; typed paths | 5 | 0 |
| `ts-unsound-refinement` | control-flow narrowing survives a call that mutates the narrowed value | conformance/controlFlow; typed paths | 9 | 0 |
| `ts-using` | `using` and `await using` declarations, Disposable and DisposableStack | conformance/statements/VariableStatements/usingDeclarations | 10 | 0 |
| `ts-utility-types` | the lib's utility types (Partial, Pick, Omit, ReturnType, Parameters, Awaited, ...) through values | lib.es5.d.ts; conformance/types/mapped | 24 | 0 |
| `ts-variadic-tuples` | a variadic tuple type (`[...A, ...B]`) | conformance/types/tuple/variadicTuples | 2 | 0 |
| `ts-void` | the `void` return type, which does not discard a returned value | conformance/types/primitives/void; ts-eslint TSVoidKeyword | 1 | 0 |
<!-- tags:end -->
