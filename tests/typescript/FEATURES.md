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

20. **Method selection across typed routes:** class and interface receivers,
    lexical super, construction, accessors, statics and stored methods.
    [Dispatch route contracts](#dispatch-route-contracts) name the sources;
    `ts-dispatch-route-*` identifies the area.

21. **Absence through typed routes:** optional properties and parameters,
   past-end reads, short-circuit chains and unsuccessful lookups.
   [Absent route contracts](#absent-route-contracts) name the sources;
   `ts-absent-route-*` identifies each area and its explicit-presence controls.

22. **Async values and ordering across typed routes:** dispatched and generic
    async functions, stored promises, thenables, rejection cleanup and
    microtask histories. [Async route contracts](#async-route-contracts)
    name their sources; `ts-async-route-*` identifies each area.

23. **Union values across typed routes:** primitive storage, narrowing,
   object layouts, widening and the values whose kind or identity is easy to
   lose. [Union route contracts](#union-route-contracts) name the sources;
   `ts-union-route-*` identifies each area and its concrete-record controls.

24. **Module bindings across typed readers and writers:** declaration kinds,
    class and builtin readers, initialization order, top-level control flow
    and generic or union views. [Scope route contracts](#scope-route-contracts)
    name their sources; `ts-scope-route-*` identifies each area.

25. **Tuples across typed routes:** heterogeneous storage, optional, rest
   and labeled slots, calls, widening writes, iteration and conversion.
   [Tuple route contracts](#tuple-route-contracts) name the sources;
   `ts-tuple-route-*` identifies each area and its named-slot record controls.

26. **Classes used as values across typed routes:** stored constructors,
    construct signatures, returned class expressions and mixins, constructor
    metadata and runtime selection. [Class value route contracts](#class-value-route-contracts)
    name their sources; `ts-class-value-route-*` identifies each area.
27. **Class data across typed layouts:** subclass storage, field presence
   and order, structural views, private and static state, and builtin
   subclasses. [Layout route contracts](#layout-route-contracts) name the
   sources; `ts-layout-route-*` identifies each area and its plain controls.

28. **Equality and ordering across typed routes:** mixed operands in typed
    carriers, explicit conversion histories, collection key matching and
    stable sorting. [Equality route contracts](#equality-route-contracts)
    name their sources; `ts-equality-route-*` identifies each area.
29. **Destructuring across typed routes:** array and object patterns,
   parameters, assignments and loops, and lazy defaults or failing nested
   patterns. [Destructuring route contracts](#destructuring-route-contracts)
   name the sources; `ts-destructuring-route-*` identifies each area and its
   explicit-read controls.
30. **Bigints across typed routes:** exact stored values, signed arithmetic,
    width wrapping, conversions, narrowed number unions and collection
    boundaries. [Bigint route contracts](#bigint-route-contracts)
    name their sources; `ts-bigint-route-*` identifies each area.
31. **Control-flow paths through typed values:** switch selection, labeled exits,
    cleanup precedence, short-circuit evaluation and narrowing at joins.
    [Control-flow route contracts](#control-flow-route-contracts) name their
    sources; `ts-control-flow-route-*` identifies each area.
32. **Array lengths across typed mutation routes:** cached and live bounds,
    callback visitation, shared mutable views, resizable buffers and indices
    after a change. [Length route contracts](#length-route-contracts)
    name their sources; `ts-length-route-*` identifies each area.
33. **Object operations across typed views:** own-key order, copies, statics,
    property presence and shared aliases. [Object route contracts](#object-route-contracts)
    name their sources; `ts-object-route-*` identifies each area.
34. **Integer-looking values across changing typed routes:** counters and
    accumulators, bitwise and rounding results, typed-array storage, and
    later widening to fractions, signed zero, NaN or larger doubles.
    [Integer route contracts](#integer-route-contracts) name their sources;
    `ts-integer-route-*` identifies each area.
35. **Sorting across typed routes:** default string order, comparator
   dispatch, stable keys, typed-array numeric order and error state.
   [Sort route contracts](#sort-route-contracts) name their sources;
   `ts-sort-route-*` identifies each area and its insertion-sort controls.
36. **Regular expressions across typed routes:** nullable match results,
    shared cursor state, string operations, Unicode matching and runtime
    construction. [RegExp route contracts](#regexp-route-contracts) name
    their sources; `ts-regexp-route-*` identifies each area.
37. **Structured cloning across typed routes:** deep values, graph identity,
   class instances becoming plain objects, collections, shared buffers,
   transfer detachment and clone errors. [Structured clone route contracts](#structured-clone-route-contracts)
   name their sources; `ts-structuredclone-route-*` identifies each area
   and its memoized recursive controls.
38. **Dates across typed routes:** fixed UTC construction, setters, text,
    numeric time values and shared identity. [Date route contracts](#date-route-contracts)
    name their sources; `ts-date-route-*` identifies the area.

39. **Property descriptors across typed routes:** data and accessor attributes,
    exact reflection, write and deletion failures, enumeration and object
    integrity levels. [Descriptor route contracts](#descriptor-route-contracts)
    name their sources; `ts-descriptor-route-*` identifies each area and its
    explicit property-state controls.

40. **Math and integer conversions across typed routes:** exact rounding, extrema,
    power special cases, wrapping and prescribed transcendental values.
    [Math route contracts](#math-route-contracts) name the sources;
    `ts-math-route-*` identifies each area.

41. **String values across typed routes:** width changes, UTF-16 units,
    construction, slices, searches, ordering and normalization.
    [String route contracts](#string-route-contracts) name the sources;
    `ts-string-route-*` identifies the area.

42. **Symbols across typed routes:** identity-bearing keys, complete key order,
    enumerable copies, symbol values and well-known builtin dispatch.
    [Symbol route contracts](#symbol-route-contracts) name their sources;
    `ts-symbol-route-*` identifies each area and its explicit string-record
    controls.

43. **Number formatting and parsing across typed routes:** binary-value rounding,
    shortest text, radix conversion, complete numeric strings and partial parsers.
    [Number-format route contracts](#number-format-route-contracts) name the sources;
    `ts-number-format-route-*` identifies each area.

44. **Function objects and parameters across typed routes:** exact names and
    arities, explicit receivers, bound arguments, default and rest parameters,
    and strict arguments objects. [Function object route contracts](#function-object-route-contracts)
    name their sources; `ts-function-object-route-*` identifies each area
    and its explicit metadata and parameter controls.

45. **Templates across typed routes:** ordered substitutions, tag calls,
    cooked/raw arrays, cached site identities, escapes and nested composition.
    [Template route contracts](#template-route-contracts) name the sources;
    `ts-template-route-*` identifies each area.

46. **Enums across typed routes:** numeric and string members, reverse
    mappings, literal-member narrowing, enum objects, flags and declaration
    merging. [Enum route contracts](#enum-route-contracts) name the sources;
    `ts-enum-route-*` identifies each area.

A concept with no run-time effect (a type alias, an interface's existence, a
variance annotation) has no case of its own: it appears only where a value
flows through it.

## The families

| family | what it holds |
| --- | --- |
| `absent-routes/` | optional, omitted, out-of-range and deleted values through typed routes, with exact presence and node as the oracle |
| `absent-routes-controls/` | the same computations with presence flags, required payloads, recorded keys and guarded index reads |
| `ambient/` | `declare` forms, which emit nothing and resolve to what the program provides |
| `array-contents/` | typed array writes and reads, exact values, order and slot presence, with node as the oracle |
| `array-contents-controls/` | counterparts using one declared element type across writes and reads, with node as the oracle |
| `async/` | async functions, methods and generators, promises, `for await` (`flags: [async]`) |
| `async-routes/` | exact values, rejection identities, cleanup and microtask order across typed async routes, held to node |
| `async-routes-controls/` | concrete calls or local promise carriers with the same awaits, reaction jobs, inputs, logs and assertions |
| `bigint/` | bigint arithmetic, conversions, widths, literal types |
| `bigint-routes/` | exact bigint values, signs, widths, conversions, runtime kinds and errors across typed routes, held to node |
| `bigint-routes-controls/` | direct operations on local literal constants, with explicit collection observations and the same expected results |
| `builtin-identity/` | builtin declarations and runtime targets through TypeScript routes, with node as the oracle |
| `builtin-identity-controls/` | single-route counterparts using the builtin or direct operation, with node as the oracle |
| `call-routes/` | typed routes from a function value to its call, holding arguments, receivers, results and throws to node |
| `call-routes-controls/` | single-change direct-call or nonthrowing counterparts for call-route cases |
| `capture-routes/` | current binding values, identities, read/write order and final state across typed captures, held to node |
| `capture-routes-controls/` | matching observations with the tested closures removed and their bindings or retained live state read directly |
| `class-value-routes/` | exact construction, static observations, class identity and ancestry across typed constructor-value routes, held to node |
| `class-value-routes-controls/` | plain factory records, ordered object literals and class tags with the same inputs, logs and assertions |
| `classes/` | fields under define semantics, parameter properties, inheritance, abstract, private, static, accessors |
| `control-flow-routes/` | exact branch, loop-exit, cleanup and evaluation histories through typed values, held to node |
| `control-flow-routes-controls/` | explicit if chains, exit flags, per-path cleanup, ordered temporaries and concrete kind records with matching observations |
| `conversions/` | ToPrimitive under each operator, number and string conversions |
| `destructuring-routes/` | array, object, parameter, assignment and failing patterns across declared types with exact bound values, rest contents and observable effect/protocol order |
| `destructuring-routes-controls/` | pattern-free explicit reads, undefined tests, copy loops and iterator calls preserving the same inputs, logs and assertions |
| `date-routes/` | exact UTC times, fields, text, setter results and shared identity across typed Date routes, held to node |
| `date-routes-controls/` | independent numeric Gregorian arithmetic and plain state with the same inputs, logs and assertions, without Date operations |
| `descriptor-routes/` | data and accessor flags, reflection, enumeration and integrity levels across typed object routes, held to node |
| `descriptor-routes-controls/` | plain value-and-flag records with explicit read, write, list, delete and integrity checks producing the same observations |
| `dispatch-routes/` | method targets, receiver identities, entry order and state across typed class/interface routes, held to node |
| `dispatch-routes-controls/` | stored class tags select plain function bodies with matching receivers, effects and assertions |
| `enum-routes/` | numeric, string, computed and const members, reverse mappings, literal narrowing, object listings, flags and merged enums through typed routes, held to node and TypeScript emit |
| `enum-routes-controls/` | the same values, routes and observations using frozen member objects, explicit reverse maps and literal union types without enum declarations |
| `enums/` | numeric, string, const, heterogeneous, computed, merged enums and their objects |
| `equality-routes/` | full mixed-kind comparison tables, conversion-hook histories, collection counts and stable orders across typed routes, held to node |
| `equality-routes-controls/` | explicit kind records and comparison algorithms, loop-based searches and collections, and stable ordering with the same observations |
| `errors/` | exceptions typed `unknown`, Error subclasses, finally |
| `expressions/` | assertions, `satisfies`, non-null, tagged templates and operators, all erased or evaluated as written |
| `function-object-routes/` | function metadata, receiver and bound-call behavior, default/rest parameters and strict arguments objects across typed routes, held to node |
| `function-object-routes-controls/` | explicit metadata records, self parameters, binding closures and supplied argument arrays with the same observations |
| `functions/` | parameters, overloads, closures, `this` parameters, `length` and names |
| `generic-routes/` | simultaneous generic instantiations and crossings that preserve exact runtime values, with node as the oracle |
| `generic-routes-controls/` | separate non-generic declarations for every used type argument, retaining computations, input values and assertions |
| `generics/` | a matrix of six positions by eight kinds of type argument, then the facets of type parameters |
| `implicit-calls/` | implicit calls through interfaces, constrained generics, unions and declared class shapes, with exact call logs, state and results |
| `implicit-calls-controls/` | explicit-call counterparts for implicit-call cases, preserving their instrumentation and observations |
| `integer-routes/` | exact numeric stages when integer-looking values cross ranges, widen, wrap or clamp through typed routes, held to node |
| `integer-routes-controls/` | matching computations unrolled into direct local number constants, with explicit scalar typed-array conversion |
| `interfaces/` | dispatch through interfaces over classes and literals of different layouts, and the interface forms |
| `iteration/` | the iteration protocols, generators, iterator helpers |
| `json-routes/` | typed JSON parsing, narrowing, serialization and hooks with exact values, key order, outputs and callback logs |
| `json-routes-controls/` | counterparts using unknown narrowing or plain literal values with the same text and assertions |
| `iterator-routes/` | complete protocol histories, delivered values, cleanup and final state through typed iterator routes, held to node |
| `iterator-routes-controls/` | the same protocol advanced and closed explicitly, with matching inputs, effects and observations |
| `layout-routes/` | exact class fields, presence, order, identity and state across base, structural, private, static and builtin-subclass routes |
| `layout-routes-controls/` | plain field-by-field literals, explicit kinds and private sidecars or builtin holders preserving the same observations |
| `length-routes/` | current indexed values, lengths and visit histories while arrays through typed routes grow, shrink, recover or detach, held to node |
| `length-routes-controls/` | the same computation with local arrays, stable copies or immediate fresh bounds before indexed accesses |
| `lifetimes/` | lifetime facts followed by a retention or observation route, allocation churn and exact checks, with node as the oracle |
| `lifetimes-controls/` | single-change counterparts and measured findings for lifetime cases, with node as the oracle |
| `literal-types/` | literal types and the values they admit, `as const`, template literal types |
| `map-set-contents/` | typed Map and Set writes and reads, exact contents and enumeration, with node as the oracle |
| `map-set-contents-controls/` | counterparts using one declared collection type across writes and reads, with node as the oracle |
| `math-routes/` | specification-fixed Math and integer-conversion results, signed zeros and NaN across typed operands and returns, held to node |
| `math-routes-controls/` | identical typed carriers and observations with position-indexed result tables replacing Math calls and bitwise operations |
| `modules-and-exports/` | module code in one file (`flags: [module]`) |
| `namespaces/` | namespaces, their objects, merging and aliases |
| `number-format-routes/` | specification-fixed numeric text, parsing values, signed zeros and range failures across typed inputs, held to node |
| `number-format-routes-controls/` | identical typed routes, input observations and assertions with position-indexed result or error tables replacing formatting and parsing |
| `number-routes/` | exact numeric values, zero signs, NaN, results and text across typed carriers, held to node |
| `number-routes-controls/` | the same inputs and computations with plain local number carriers and the same observations |
| `object-routes/` | exact key order, getter/setter histories, copies, integrity and presence through typed objects, held to node |
| `object-routes-controls/` | explicit ordered names, field copies, presence flags and direct operations with matching inputs and observations |
| `objects/` | object literals and types, structural assignment, keys, spread, Record |
| `proofs/` | facts proved from code, followed by a route that can invalidate them, with node as the oracle |
| `proofs-controls/` | counterparts that remove one invalidating effect or callback throw from a proofs finding, with node as the oracle |
| `record-routes/` | exact object values, enumeration and alias writes across laid-out, table, narrowed, mapped and generic views |
| `record-routes-controls/` | counterparts declared at their final read type from construction, with the same values, operations and assertions |
| `regexp-routes/` | exact match results, state, string operations, Unicode and construction through typed RegExp routes, held to node |
| `regexp-routes-controls/` | direct literals with independent starting state, direct constructor errors and matching inputs, logs and assertions |
| `resource-management/` | `using`, `await using`, DisposableStack |
| `scope-routes/` | exact values, identities, read/write logs and initialization order across typed routes to module bindings, held to node |
| `scope-routes-controls/` | explicit state parameters and initialization flags with the same inputs, calls, logs and assertions |
| `sort-routes/` | exact order, stable ties, slot presence, identity and error state across typed arrays and comparator routes, held to node |
| `sort-routes-controls/` | the same inputs and assertions with stable insertion sort over a copy, retaining typed comparisons and explicit writeback |
| `soundness/` | checker-accepted false type claims from variance, aliases and guards, with node as the oracle |
| `structuredclone-routes/` | exact deep values, own keys, prototypes, graph identity, mutation independence and clone errors across TypeScript routes, held to node |
| `structuredclone-routes-controls/` | the same inputs and assertions with specialized manual recursive copies and original-to-copy Maps, including explicit buffers and collections |
| `string-routes/` | exact string contents, lengths, edge units and search results across typed carriers, held to node |
| `string-routes-controls/` | the same input values, computations and observations with plain local string carriers |
| `symbol-routes/` | symbol identity, keyed members, mixed listings, enumerable copies and well-known dispatch across typed routes, held to node |
| `symbol-routes-controls/` | distinct string IDs, separate key lists and explicit record operations producing the same observations without symbols |
| `symbols/` | symbols as keys, unique symbols, well-known symbols |
| `template-routes/` | exact substitutions, tag arguments, frozen cooked/raw arrays and per-site identities across typed inputs and calls, held to node |
| `template-routes-controls/` | the same typed routes and assertions using ordered String conversion, concatenation, explicit tag calls and reusable per-site frozen arrays |
| `throw-routes/` | exception identity, ordered cleanup and retained effects across typed routes, held to node |
| `throw-routes-controls/` | direct calls to the same throwing bodies inside the caller try, with the same observations |
| `tuple-routes/` | exact tuple slots, runtime lengths, array shape and identity through typed storage, elements, calls, widening and conversion |
| `tuple-routes-controls/` | the same computations with named-slot records, explicit counts and logical array or presence metadata |
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

The `control-flow-routes/` matrix uses `<area>-<route>.ts`, with `short-*`
for the short-circuit area, in place of combination cases. One
`ts-control-flow-route-*` tag names the area beside the family and existing
syntax tags. Every pair repeats a typed route over several inputs, asserts
the complete ordered log, and checks final values with Object.is and typeof.
Controls append `-control` to the same name and expand the tested structure:
switches to if chains with explicit fallthrough state, labels to flags
tested by surrounding loops, finally to cleanup on each exit, expressions
to ordered temporaries and ifs, and narrowing to kind records with separate
concrete fields. Strict checking uses independent scripts with library
diagnostics included; node uses the unchanged suite oracle. Backend
outcomes are measured and recorded by maintainers.
The `object-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. One `ts-object-route-*` tag names the area beside the
family and existing syntax tags. Cases send several actual object shapes
through one typed consumer, checking ordered Object.keys and for-in
observations, exact values with Object.is, and complete accessor logs.
Controls append `-control` and replace the selected operation with
explicit ordered key arrays, individual field copies or presence flags;
integrity controls spell out the allowed writes and TypeError exits.
Strict checking treats each unflagged file as an independent script and
includes library diagnostics. Node uses the unchanged suite oracle;
maintainers measure and record backend outcomes.
The `regexp-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case names the family, one `ts-regexp-route-*`
area and existing syntax tags. Several strings cross the same typed
consumer; each valid pattern runs as a literal and as
`new RegExp(literal.source, literal.flags)`. Construction cases also
observe their typed source and flag inputs beside valid witnesses.
Complete logs and Object.is/typeof checks retain every result, capture,
named group, callback argument and relevant lastIndex transition.
Controls append `-control` and remove the selected typed carrier.
Matching operations use fresh direct literals and independent planned
starting positions; invalid constructors use direct source and flag
arguments because an invalid literal cannot execute. Inputs, outputs
and assertions stay aligned across the pair.
Strict checking treats each unflagged file as an independent script
and retains library diagnostics. Node uses the unchanged suite oracle;
maintainers measure and record backend outcomes. Existing Unicode data
sweeps remain separate from these typed state and result routes.

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

The `dispatch-routes/` matrix uses `<area>-<route>.ts` and one
`ts-dispatch-route-*` tag with existing syntax and carrier tags. Each route
receives at least three classes in a loop; static routes use class
constructor receivers. Exact logs retain implementation labels, actual
receiver identities, arguments, effects and order, with result and final
state assertions. Matching `-control` files select plain functions by
stored class tag. Super calls name their ancestor functions; saved method
tags remain separate from later invocation receivers. Strict checks run
as scripts unless module-flagged, including library diagnostics, before
the unchanged node oracle. Existing soundness, call, implicit-call and
capture families remain separate from these target-selection cases.

The `async-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-async-route-*` tag and existing
syntax and carrier tags, `flags: [async]`, and guarded `$DONE` completion.
Several inputs exercise fulfillment and rejection, settled and pending
promises, signed zero, strings, undefined and object identity as applicable.
Exact logs record entry, resumption, settlement, catch and cleanup;
`Object.is` and `typeof` checks retain payload kinds and identities.
Only microtasks schedule work. Matching `-control` files remove the tested
typed route while retaining awaits, reaction operators and job order.
Thenable controls keep the real hook and its protocol callback generics;
capture controls retain explicit state for each iteration. All files are
checked as scripts under strict TypeScript with default-library diagnostics
included, and run through the unchanged node oracle. Existing async,
throw, call, iterator and proof cases remain separate from these routes.

The `scope-routes/` matrix uses `<area>-<route>.ts` in place of combination
cases. Each case has one `ts-scope-route-*` tag and existing syntax tags.
Files use `flags: [module]` because the tested bindings belong to a module;
the promise reader also has `async` and guarded `$DONE` completion.
Typed functions, retained readers, class bodies and builtin callbacks read
or write bindings across several values, including negative zero, NaN,
strings, undefined and object identities where the route admits them.
Complete logs record reader names, values and write order; `Object.is`
and `typeof` check results and final state. Controls move state into one
explicit object passed to every reader and writer, with no case-defined
module value referenced inside functions or initializers. Explicit flags
reproduce hoisting and dead-zone observations at the same read points.
Each file is checked in its declared script/module mode under strict
TypeScript with all library diagnostics retained, then run through the
unchanged node oracle. Export-only module cases and local capture cases
remain separate from these observed routes to module bindings.

The `class-value-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-class-value-route-*` tag and
existing syntax tags, with at least three runtime classes crossing a
constructor type, generic factory, stored value or class-value union.
Repeated inputs include negative zero, NaN, strings, undefined and object
identities where the signature admits them. Whole logs record construction
arguments, final `new.target` names and static observations. Fresh and
returned instance identities, all relevant classes and ancestors, and
fields checked with `Object.is` and `typeof` distinguish the results.

Its counterpart in `class-value-routes-controls/` appends `-control` and
replaces every tested class value with a plain record holding a factory,
a tag and its static data. Ordinary calls build plain object literals in
the same field order; class and ancestor tags replace `instanceof`.
Inputs, construction logs and assertions remain the same. A control has
no user class declaration, class expression or construction through a
stored constructor. Direct builtin storage and missing-entry guards are
not the class-value route under test.

Each file is checked independently as a script unless its front matter
says `flags: [module]`, with strict TypeScript and all library diagnostics
retained. The unchanged node oracle separately assembles an `.mts` module.
Existing basic class metadata and method-dispatch cases remain separate
from these constructor-storage, factory and class-selection histories.

The `equality-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-equality-route-*` tag and
existing syntax tags. Every ordered pair from at least eight mixed inputs
crosses a declared union, field, element, parameter, return or generic
route, including literal and enum widening. Literal answer tables distinguish
signed zeros, NaN, numeric strings, bigints and object identity. Conversion
logs retain the actual hint, receiver and call order; searches and collections
also check returned values and counts, while sorting checks the full order
and stability. Operands excluded by strict TypeScript remain documented in
their pull request rather than asserted into the accepted cases.

Its counterpart in `equality-routes-controls/` appends `-control` and
replaces each mixed operand with a record whose explicit kind selects a
payload of one declared type. Comparison algorithms narrow both operands
and convert or call logged hooks explicitly before comparing same-kind
payloads. Bigint comparisons retain precision. Loops replace tested searches
and Map/Set key matching; default sorting is written as an explicit stable
sort by string conversion with undefined last. Comparator sorts keep their
comparator over records. Inputs, answer tables, identities and hook logs
remain the same.
The `bigint-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-bigint-route-*` tag and
existing syntax tags. At least eight inputs cross a declared bigint field,
element, parameter, return, capture or generic route, or a narrowed union.
Repeated values include both bigint zero spellings, small odd and even
values of both signs, and the signed 64-bit and 128-bit edges. Fixed literal
expectations and `typeof` distinguish exact values and runtime kinds;
successful and throwing paths check every specified exception. Arithmetic
that crosses 128 bits retains node's exact result.

Its counterpart in `bigint-routes-controls/` appends `-control` and
replaces operand carriers with local constants initialized from literals.
Numeric selectors retain repeated inputs without carrying bigint operands
through an input array. Expected arrays feed only assertions. Conversions
under test operate directly on a local bigint, number or string constant;
increment and decrement use concrete local mutable operands. Direct
comparisons and presence flags replace tested collection matching, sorting
orders numeric indices with local bigint comparison operands, and direct
reads replace spread and destructuring. Values and observations stay paired.

Each file is checked independently as a script unless its front matter
says `flags: [module]`, with strict TypeScript and all library diagnostics
retained. The unchanged node oracle separately assembles an `.mts` module.
Existing individual conversion, numeric and collection checks remain separate
from these complete mixed-kind tables and typed operand routes.
Strict-rejected forms are omitted with their actual diagnostics in the pull
request. Existing small bigint examples, widened collection views and mixed
equality tables remain separate from these full-width typed operand routes.
The `length-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-length-route-*` tag alongside
existing syntax and container tags. Empty, singleton and longer shapes
exercise one typed route while array length changes. Whole fixed logs retain
every observed index, value and current length, with exact final contents,
lengths and any method result. Hole presence, zeroed regrowth and ignored
typed-array writes are checked where they distinguish the behavior.

Its counterpart in `length-routes-controls/` appends `-control` and
removes the invalidation route at the read: one local array, an independent
stable copy, or a fresh bound immediately before access. Mutating callbacks
become explicit loops, called writers are inlined, and retained readers become
direct reads. Cached visit schedules stay schedules; they do not authorize
unchecked reads after a mutation. Every counterpart keeps the same inputs,
log and assertions. Sort uses the pinned node's observed comparison schedule
over an immutable ascending copy, with source mutations recorded separately.

Strict TypeScript checks each file as a script unless module-flagged, with
all library diagnostics retained; the unchanged node oracle separately runs
its `.mts` assembly. Existing bounds/length proofs and element-kind cases
remain separate from these complete length-changing traversal histories.
The `integer-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-integer-route-*` tag alongside
existing syntax and carrier tags. At least eight inputs exercise the same
route, including signed zeros, small integers, range boundaries, fractions,
NaN and infinities where applicable. Fixed expectations check every numeric
stage with `Object.is` and `typeof`, preserving signed zero and NaN as well
as exact finite results. Array-index cases also retain absent reads.

Its counterpart in `integer-routes-controls/` appends `-control` and
writes each operand as a local `number` constant where it is used. Sequential
computations become explicit constant stages in the same evaluation order,
without loop-carried arithmetic state, stored operands, union narrowing,
generic carriers or intervening helper calls. Typed-array controls compute
the element conversion directly with scalar truncation, modulo or clamping.
Input-selector loops and expectation tables organize the assertions; those
tables never supply the computed operands. Inputs and assertions remain paired.

Strict TypeScript checks each file as a script unless module-flagged, with
all library diagnostics retained; the unchanged node oracle separately runs
its `.mts` assembly. Existing number-route snapshots and typed-array element
kind cases remain distinct from these successive integer-proof histories.

The `string-routes/` matrix uses `<area>-<route>.ts` in place of
combination cases. Each case has one `ts-string-route-*` tag plus
existing syntax and carrier tags. Several empty, ASCII, Latin-1,
wide BMP, astral and lone-surrogate inputs take the same route,
including mixtures whose first wide unit occurs at different places.
Fixed expectations observe exact strings, lengths, endpoint code
units and search positions; traversal and split results check their
individual strings too. The `-control` counterpart under
`string-routes-controls/` replaces the active string carrier with
plain local `string` variables and keeps the input values, operations
and assertions. Enum and literal fixtures use identical plain string
values in controls. Strict admission checks each program as a script
unless module-flagged, including every default-library diagnostic,
before the unchanged node oracle runs it. Existing Unicode data and
ToString cases remain separate from these typed-carrier contracts.

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

The `absent-routes/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. Optional properties and parameters, generic optional
values, index signatures, typed fields and optional tuple elements carry
absent, explicitly undefined and present values through the operation.
Repeated inputs include null, signed zero, NaN, empty strings, false and
reference identities where the declared type admits them. `Object.is` and
`typeof` check payloads; presence, own keys, exact JSON and complete effect
logs distinguish the routes that return the same value.

The counterpart in `absent-routes-controls/` appends `-control` and makes
absence explicit using required payloads with presence flags, recorded key
lists or bounds checks before index reads. Plain branches and bounded loops
replace short-circuit or unsuccessful-lookup routes, preserving effects,
receivers and expected results. Logical JSON objects are projected from
explicit presence state; existing scalar serialization is retained. Syntax
tags describe only constructs that remain in each member of the pair.

Every file is checked independently under strict TypeScript as a script
unless front matter says `flags: [module]`, with library diagnostics
included. The unchanged node oracle assembles its separate `.mts` module.
Requested forms rejected by strict TypeScript are omitted with their actual
diagnostics in the pull request. Compiler outcomes belong to the
maintainers; a refusal never changes a case.

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

The `tuple-routes/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. Declared tuple types carry heterogeneous slots through
fields, arrays, Maps, closures, sorting, filtering, typed calls and returns.
Optional, rest, labeled, readonly and variadic forms preserve their runtime
array behavior. Widened array writers may change a tuple's kinds and length;
its original view must observe those writes, holes and removed elements.
Repeated inputs use `Object.is`, `typeof`, exact lengths, `Array.isArray`
and identity checks for every relevant slot. Copies, ordered callbacks,
optional presence and complete JSON strings distinguish their routes.

The counterpart in `tuple-routes-controls/` appends `-control` and replaces
each tuple with a record containing one named field per slot. An explicit
`count` records logical length and an `array` field records the logical
array observation; presence metadata distinguishes absent optional slots
and holes from stored undefined. Ordered field reads and writes replace
tuple spreads, slicing and destructuring. Ordinary outer and result arrays
remain arrays, with their real length and `Array.isArray` checks. JSON
controls compose the logical tuple structure from the actual named fields
without reconstructing a tuple. Payloads and expected observations remain.

Every file is checked independently under strict TypeScript as a script
unless front matter says `flags: [module]`, with library diagnostics
included. The unchanged node oracle assembles its separate `.mts` module.
Requested forms rejected by strict TypeScript are omitted with their actual
diagnostics in the pull request. Maintainers record compiler outcomes; a
refusal never changes a case.

The `layout-routes/` family uses `<area>-<route>-<detail>.ts` instead of
combination cases. At least three classes with different field sets reach
each typed route. Base-class fields, arrays, Maps and closures preserve
added, shared and redeclared data, and writes remain visible through both
the base and concrete views. Smaller structural types and class-shaped
literals retain their actual values and identities. Exact `Object.is` and
`typeof` checks distinguish signed zero, NaN, bigint, empty text, undefined,
null and original reference payloads.

Presence cases check complete key and JSON order, for-in enumeration and
spread, including constructor assignments and field initializers. Under
define semantics, `declare` emits no field; an unassigned optional or
definite-assignment field is an own undefined slot. The requested `field!: T`
syntax is a property declaration assertion, not a non-null expression.
Private slots and brands remain distinct between classes, while static
cases distinguish shared references from independently owned fields.
Builtin subclasses retain both builtin contents and their own fields,
including constructor-write histories and Array or Promise species results.

The counterpart in `layout-routes-controls/` appends `-control` and uses
plain literals built field by field in the same data order, with explicit
kind metadata for class and ancestor membership. Enumeration controls keep
kind beside the data so it adds no observed key. Private fields become
separate sidecar records; inherited and shadowed static state is explicit.
A builtin-subclass control holds the native builtin in a plain record,
forwards its operations and constructs the corresponding result record.
Inputs, expected values, alias writes and complete observations remain.

Every file is checked independently under strict TypeScript as a script
unless front matter says `flags: [module]`, with define semantics and all
library diagnostics included. The unchanged node oracle assembles its
separate `.mts` module; async Promise cases must report completion through
the harness. Requested forms rejected by strict TypeScript are omitted with
their diagnostics in the pull request. Maintainers record compiler outcomes;
a refusal never changes a case.

The `destructuring-routes/` family uses `<area>-<route>-<detail>.ts`
instead of combination cases. A declared tuple, array, class, interface,
Record, union or parameter type carries each value into a binding or
assignment pattern. Repeated input lists distinguish signed zero, NaN,
bigint zero, empty text, undefined, null, false and original object identity
where the declared shape admits them. Every bound value is checked with
`Object.is` and `typeof`; rest arrays and objects retain their exact length
or keys, order, contents and copy identity.

Every user-observable getter, default and iterator hook has its complete
ordered log, including values returned by reads and protocol calls. Array
patterns distinguish elisions, nested stepping, exhaustion and early
closing; object patterns distinguish selected keys, inherited accessors,
undefined-only defaults and remaining own enumerable string and symbol
keys. Parameter and assignment cases preserve earlier-binding dependencies,
receiver data, target evaluation and partial writes. Failure cases retain
the original error and the required inner-before-outer iterator cleanup.

The counterpart in `destructuring-routes-controls/` appends `-control` and
contains no binding or assignment pattern, including fixtures and loop
heads. Property reads, explicit `=== undefined` tests and ordered copy loops
replace object patterns. Observable iterators are acquired, stepped and
closed explicitly; untouched native arrays may use index reads. A parameter
pattern becomes a plain parameter with the same ordered reads in its body.
Inputs, effectful hooks, expected logs and value/rest assertions remain.
Syntax tags describe the constructs actually retained on each side.

The requested class own-getter case uses minimal `Object.defineProperty`
setup on a declared instance field, identically in its case and control.
That setup makes the own accessor observable; no assertion tests descriptor
flags, and no intrinsic or prototype is patched.

Every file is checked independently under strict TypeScript as a script
unless front matter says `flags: [module]`, with define semantics and all
library diagnostics included. The unchanged node oracle assembles its
separate `.mts` module. Requested forms rejected by strict TypeScript are
omitted with their exact diagnostics and disposition in the pull request;
accepted typed routes remain without casts or suppressions. Maintainers
record compiler outcomes; a refusal never changes a case.
The `sort-routes/` family uses `<area>-<route>.ts` instead of combination
cases. One `ts-sort-route-*` tag names the area alongside existing syntax
and carrier tags. Declared arrays, unions, tuples, readonly views and typed
arrays reach sorting through variables, fields, parameters, returns and
Maps; comparators also cross captures, methods and generic key factories.
Empty, singleton, ordered, reversed, equal-key and duplicate-heavy inputs
exercise the same code, with lengths on both sides of 10, 32 and 64.

Whole-array assertions check exact results. Objects additionally retain
identifying fields and original positions, making stability observable.
Presence assertions distinguish holes from undefined; SameValue checks
retain signed zero and NaN. Mutating sorts return their source, copying
sorts return a new array and preserve their source, and throwing comparators
leave the original array unchanged. No assertion constrains comparator
call counts or call order.

Each counterpart under `sort-routes-controls/` appends `-control` and
performs plain stable insertion sort over a copy in the control itself,
using the same comparison. Mutating controls copy back only after all
comparisons succeed; copying controls return the fresh result. Sparse
controls retain the distinction between skipped holes in sort and the
dense undefined slots produced by toSorted. Inputs, typed comparator
routes and assertions stay paired.

Every file is checked independently under strict TypeScript as a script
unless module-flagged, with default-library diagnostics included, before
the unchanged pinned-node oracle runs it. Requested forms rejected by
strict TypeScript are omitted with their diagnostics in the pull request.
Maintainers measure and record nts outcomes; a refusal never weakens a case.
The `structuredclone-routes/` family uses `<area>-<route>.ts` with one
`ts-structuredclone-route-*` area tag and existing syntax and carrier tags.
Interfaces, Records, tuples, unions, generics, classes and typed collections
or views carry values through variables, fields, parameters, returns and
elements. Lists exercise the empty, nested, shared, cyclic, sparse and
special primitive values appropriate to each route. Assertions check
SameValue payloads, complete enumerable own key order, specified prototypes,
fresh nested identities, retained graph relationships and writes in both
directions. Class tests distinguish own fields and accessors from inherited
behavior and private slots. Buffer tests check bytes, view windows and
detachment; Error tests avoid implementation-defined stack contents.

Each counterpart in `structuredclone-routes-controls/` appends `-control`
and contains a specialized recursive copy with an original-to-copy Map.
It rebuilds plain data and ordered collections and copies buffer bytes
explicitly; atomic leaves terminate recursion. Controls never call
structuredClone. Transfer controls use ArrayBuffer.prototype.transfer
solely to detach after manual copying. Inputs and assertions stay paired.
Each file passes strict independent script checking, including library
diagnostics, and the unchanged pinned-node oracle. The handoff explicitly
requires prototype and getter observations. Strict-rejected forms are
listed with diagnostics in the pull request; maintainers record nts results.
`date-routes/` uses fixed inputs through declared parameters, returns, fields,
interfaces, generics and collections. Its controls contain no Date APIs, types
or objects: numeric Gregorian arithmetic, TimeClip, explicit parsing and
formatting, and plain alias state compute the same observations. Expected
fixture columns are used only in assertions. Each case and control is checked
as a strict script, including library diagnostics, and runs through the
unchanged TypeScript-suite oracle with the pinned Node version.

The `descriptor-routes/` family uses `<area>-<route>.ts`, with `writable-*`,
`enumerable-*` and `accessor-*` identifying those areas. One
`ts-descriptor-route-*` tag names the area beside existing syntax and
carrier tags. Several values cross each declared interface, class, Record,
generic, union or array route. Assertions read all six descriptor fields,
compare complete key lists in order and check every refused operation with
TypeError followed by unchanged-state observations. The cases distinguish
new-property defaults from retained attributes on redefinition, static
readonly views from runtime writability and shallow from recursive freezing.

Each counterpart in `descriptor-routes-controls/` appends `-control` and
stores values and attribute flags as ordinary data. Explicit functions
compute permitted reads, writes, listings, copies, deletions and integrity
transitions; accessor callbacks are data invoked with the explicit receiver.
Controls use no defineProperty, defineProperties, preventExtensions, seal,
freeze or actual accessor declarations. Inputs and assertions stay paired.
Existing object-routes key/copy/integrity cases and implicit-calls accessor
histories remain separate: these pairs observe the defined attributes,
their transitions and reflection through the typed route.

Every file is an independent strict TypeScript script, with library
diagnostics included, and passes the unchanged pinned-node oracle.
Requested forms rejected by strict TypeScript are omitted and documented
with their diagnostics in the pull request. Maintainers run and record nts
results; compiler refusals do not weaken the cases.


`math-routes/` checks specification-fixed outputs through declared numeric
fields, parameters, returns, arrays, tuples, interfaces, generics and unions.
Its controls preserve those routes and all input/output observations, replacing
each Math call or bitwise operation with a literal result table indexed by the
input position. Controls contain no Math calls or bitwise operations. Every
numeric result is checked with Object.is, so NaN and zero signs remain visible.
Each file is checked as a strict script with library diagnostics included, and
runs through the unchanged TypeScript-suite oracle with the pinned Node.

The `symbol-routes/` family uses `<area>-<route>.ts`; `wellknown-*`
identifies the well-known-symbol area. One `ts-symbol-route-*` tag names
the area beside existing syntax and carrier tags. Several inputs cross each
declared interface, class, Record, union, generic, tuple or array route.
Assertions compare complete key lists in order, distinguish symbols with
the same description by identity, inspect copied values and independent
later writes, and observe exact conversion results and hook receivers.

Each counterpart in `symbol-routes-controls/` appends `-control` and uses
distinct string IDs held in a separate ordered list. Plain records and
explicit functions compute listings, copies, conversions, registry lookup
and builtin dispatch. Controls use no Symbol values or well-known symbols;
inputs and observable assertions stay paired. Existing `symbols/` basics,
`iterator-routes` iterator protocols and `implicit-calls` conversion histories
remain separate: these pairs exercise the additional typed storage,
identity, key-order, copy-filtering and inherited dispatch routes.

Every file is an independent strict TypeScript script, with library
diagnostics included, and passes the unchanged pinned-node oracle.
Requested forms rejected by strict TypeScript are omitted and documented
with their diagnostics in the pull request. Maintainers run and record nts
results; compiler refusals do not weaken the cases.


`number-format-routes/` carries numbers and strings through declared fields,
parameters, returns, elements, tuples, generics, interfaces and narrowed unions
before formatting or parsing. Exact string checks and Object.is numeric checks
retain signs, NaN, padding, exponents and ordered observations. Range failures
use assert.throws(RangeError). Controls preserve each route and replace only
the operation with a position-indexed result table or explicit error sentinel;
they perform no formatting or parsing on the inputs. Every file is checked as
an independent strict script with library diagnostics and run by the unchanged
TypeScript-suite oracle at the repository's pinned Node version.

The `function-object-routes/` family names each observation and typed route
in its filename; `metadata-*` identifies length and name, while one
`ts-function-object-route-*` feature tag identifies each matrix area.
Several function forms cross declared function signatures, interfaces,
classes, generic helpers, narrowed unions, tuples and function arrays.
Assertions retain exact names and arities, receiver identities, complete
ordered argument lists, default evaluation histories, rest contents and
strict arguments-object state. Accepted error paths assert their exception
class alongside successful inputs through the same route.

Each counterpart in `function-object-routes-controls/` appends `-control`
and makes the selected behavior explicit. Plain records carry function
labels and arities, self parameters replace call and apply, closures prepend
bound arguments, undefined checks select defaults, and supplied arrays and
parameter lists replace rest and arguments objects. Controls read no length,
name or arguments and invoke no call, apply or bind. They retain the input
values, typed carriers and observable assertions. Existing `functions/`
basics, `call-routes` invocation paths, `capture-routes` closure histories
and `class-value-routes` construction cases remain separate from these
function-object and parameter observations.

Strict TypeScript checks every file independently as a script unless its
front matter specifies module mode, with all default-library diagnostics
included. The unchanged pinned-node oracle runs each case and control.
Requested forms rejected by strict TypeScript are omitted with the exact
diagnostics in the pull request. Maintainers measure and record nts results;
compiler refusals never weaken these assertions.


The `template-routes/` matrix carries substitutions and tags through declared
fields, parameters, returns, elements, tuples, generic helpers, callable
interfaces and narrowed unions. Exact strings, whole cooked/raw arrays,
frozen states, object identities and complete hook histories observe the
template operation. Every site is evaluated repeatedly where its identity
is observed; equal text at distinct sites must retain distinct objects.

Controls under `template-routes-controls/` keep the same values, routes,
logs and assertions. They contain no runtime template literal or tagged
template: ordered `String(...)` and `+` build strings, ordinary calls pass
explicit cooked/raw arrays and values, and one frozen array created once
models each site. String.raw controls interleave raw segments and values
explicitly. Array construction does not claim descriptor-reflection coverage.

Each file is checked independently as a strict script with full library
diagnostics and runs through the unchanged TypeScript-suite oracle using
the repository's pinned Node version. TypeScript-rejected forms are omitted
with their actual diagnostics in the PR; observations disagreeing with the
normative specification are left unasserted with their reproducers.

The `enum-routes/` matrix carries enum values and objects through declared
fields, parameters, returns, elements, tuples, generics, interfaces and narrowed
unions. Exact member values and reverse names, complete ordered key/value/entry
lists, identity and branch or initializer logs observe each route. Named
members, equal-valued aliases and out-of-enum numeric values are exercised
where the declared route admits them.

Controls under `enum-routes-controls/` keep the same inputs, typed carriers,
logs and assertions without an enum declaration. Frozen forward member
objects and explicit reverse maps model the data; constant member types
become literal unions. Runtime computed members retain their number-valued
initializers. Enumeration controls assemble actual enum-shaped objects in
declaration order, and merging controls preserve the timing of additions.

Each file is checked independently as a strict script with full library
diagnostics and runs through the unchanged suite oracle on the pinned Node.
The repository's TypeScript also emits the same checked program for an
independent execution of its assertions. TypeScript-rejected forms are omitted
with their actual diagnostics in the PR; a Node-versus-TypeScript-emit
disagreement is left unasserted and documented with its reproducer.

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

### Dispatch route contracts

| source | concepts |
| --- | --- |
| [Objects, Classes](../../docs/foundations/objects.md#classes), [Interfaces](../../docs/foundations/objects.md#interfaces-satisfied-by-shape) and [Calls](../../docs/foundations/objects.md#calls) | class layouts and method selection across typed receiver views |
| [Language, Methods](../../docs/language/functions.md#methods) and [this](../../docs/language/functions.md#this) | overrides, super, extracted methods and supplied/captured receivers |
| TypeScript [Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html) and [Mixins](https://www.typescriptlang.org/docs/handbook/mixins.html) | abstract, implements, override, parameter properties and typed class factories |
| ECMAScript [class definition evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-runtime-semantics-classdefinitionevaluation) | inheritance, accessors, fields and static blocks |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| hierarchies | `hierarchy-*` | 8 | 8 | Declared hierarchy levels, passive levels, super chains, abstract members and concrete entries |
| interfaces | `interface-*` | 9 | 9 | Unrelated layouts through locals, arrays, Maps, parameters, returns, generics and unions; dual interfaces and optional methods |
| construction | `construct-*` | 5 | 5 | Base-constructor calls before fields and parameter properties, field-initializer calls and static blocks |
| accessors-statics | `members-*` | 9 | 9 | Accessor pairs and one-half overrides; inherited/overridden statics, this, super and field shadows |
| method-values | `method-*` | 12 | 12 | Stored targets, plain/call/apply/bind/callback calls, arrows, extracted super and twice-applied mixins |

Dispatch-route cases retain node's answer even where nts refuses a form.
Maintainers record backend results separately. Strict-rejected matrix
forms are listed with their diagnostics in the pull request.

### Async route contracts

| source | concepts |
| --- | --- |
| [Language, Async](../../docs/language/async.md) | async suspension, promise settlement, cleanup and the microtask checkpoint |
| ECMAScript [Promise objects](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise-objects) | stored promises, combinators, chaining and once-only settlement |
| ECMAScript [reaction jobs](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-newpromisereactionjob) and [thenable jobs](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-newpromiseresolvethenablejob) | callback results, thrown reasons, adoption and callback order |
| ECMAScript [Await](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#await) | fulfillment and rejection resuming an async context |
| Node [queueMicrotask](https://nodejs.org/api/globals.html#queuemicrotaskcallback) | deterministic interleaving with promise reaction jobs |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| methods | `method-*` | 7 | 7 | Interface, abstract, base and union dispatch across three classes; awaited super, arrow fields, prototype methods and receiver reads after await |
| promises | `promise-*` | 14 | 14 | Generic functions and classes, repeated awaits through fields/arrays/Maps/tuples, and all/allSettled/race/any over typed arrays and tuples |
| values-thenables | `value-*` | 11 | 11 | Plain-or-promise awaits, first-settlement and repeated thenable hooks, native-promise identity and Promise.resolve adoption |
| rejections | `reject-*` | 8 | 8 | Stored fulfillment/rejection callbacks, suspended cleanup, native finally replacement, adopted Promise.finally completion and delayed handling |
| ordering | `order-*` | 5 | 5 | Complete microtask histories across async functions, await, then, Promise.resolve and queueMicrotask, with independent loop captures |

Async-route cases retain node's answer even where nts refuses a form.

### Scope route contracts

| source | concepts |
| --- | --- |
| ECMAScript [module environment records](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-module-environment-records) | module binding identity, later values and uninitialized reads |
| ECMAScript [module environment initialization](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-source-text-module-record-initialize-environment) | declaration setup, initialized var and function bindings, and lexical initialization |
| TypeScript [modules](https://www.typescriptlang.org/docs/handbook/2/modules.html) | declared module scope and erased typed routes to its values |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| bindings | `binding-*` | 12 | 12 | Module let, const, var, function and class bindings through plain functions and nested readers, including const-object mutation |
| readers | `reader-*` | 10 | 10 | Instance and static methods, static blocks, field initializers, getters, setters, map, forEach, sort and Promise.then accessing all five binding kinds |
| initialization | `init-*` | 8 | 8 | Hoisted function selection, var before assignment, let/const/class temporal dead zones, initializer reentry and ordered reads and writes of earlier bindings |
| control-flow | `flow-*` | 8 | 8 | Top-level for-let, for-var, for-of and while loops, retained if/switch block bindings, and array/object destructuring with defaults |
| typed | `typed-*` | 7 | 7 | Generic function and class exchanges, retained generic readers, union narrowing, and reassigned function, function-union and optional-function bindings |

Scope-route cases retain node's answer even where nts refuses a form.
Maintainers record backend results separately. Strict-rejected matrix
forms are listed with their diagnostics in the pull request.

### Class value route contracts

| source | concepts |
| --- | --- |
| ECMAScript [class definition evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-runtime-semantics-classdefinitionevaluation) | fresh constructors, prototypes, static inheritance and construction targets |
| TypeScript [classes](https://www.typescriptlang.org/docs/handbook/2/classes.html) and [construct signatures](https://www.typescriptlang.org/docs/handbook/2/functions.html#construct-signatures) | constructor values, abstract views and typed factory parameters |
| TypeScript [mixins](https://www.typescriptlang.org/docs/handbook/mixins.html) | class-expression factories constrained by constructor types |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| storage | `storage-*` | 8 | 8 | Constructor variables, fields, arrays, Map values and retained closures; static methods, later static writes and the full stored-class instanceof matrix |
| signatures | `signature-*` | 8 | 8 | Fixed, rest-tuple, generic variadic and zero-argument construction; numeric generic factories, InstanceType, ConstructorParameters and abstract constructor views |
| factories | `factory-*` | 6 | 6 | Returned class expressions, generic captured payloads, fresh class identities, generic argument-tuple mixins, opposite composition orders and inherited static receivers |
| exposure | `expose-*` | 9 | 9 | Instance constructor identity including Error subclasses; declared, anonymous, named-expression and mixin names; constructor length, prototype method receivers and base new.target |
| selection | `select-*` | 7 | 7 | Class-value unions selected by inputs, typed parameters and returns, equality branches, string-keyed Map replacement, retained selectors and all union-instanceof combinations |

Class-value-route cases retain node's answer even where nts refuses a form.
Maintainers record backend results separately. Strict-rejected matrix
forms are listed with their diagnostics in the pull request.

### Equality route contracts

| source | concepts |
| --- | --- |
| ECMAScript [testing and comparison operations](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-testing-and-comparison-operations) and [ToPrimitive](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-toprimitive) | strict, SameValue, SameValueZero, loose and relational results, exact primitive conversions and hook order |
| ECMAScript [indexed collections](https://tc39.es/ecma262/multipage/indexed-collections.html) and [keyed collections](https://tc39.es/ecma262/multipage/keyed-collections.html) | array searches, stable sorting, Map/Set key equality and signed-zero canonicalization |
| TypeScript [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | union operands, kind-discriminated controls and typed storage/call routes |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| strict | `strict-*` | 8 | 8 | Strict equality, inequality, Object.is and switch through fields, arrays, Maps, parameters, returns, generics, literals and enums |
| loose | `loose-*` | 8 | 8 | Equality and inequality across eight typed carriers, with primitive coercion, bigint precision, object identity and complete conversion-hook histories |
| relational | `relational-*` | 8 | 8 | All four relational operators across typed carriers, literal/enum widening and in-narrowed fields; UTF-16 strings, precise bigint comparisons and left-first hooks |
| searching | `search-*` | 9 | 9 | Includes, indexOf, lastIndexOf, find and findIndex; typed Map and Set membership, get, replacement, deletion and exact entry counts |
| sorting | `sort-*` | 7 | 7 | Default sort and toSorted, comparator results of NaN, negative zero, fractions and large magnitudes, stable equal keys and logged comparator conversions |

Equality-route cases retain node's answer even where nts refuses a form.
### Bigint route contracts

| source | concepts |
| --- | --- |
| ECMAScript [BigInt type](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-bigint-type) and [BigInt objects](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-bigint-objects) | exact signed arithmetic, shifts, two's-complement bitwise operations, conversion errors and width wrapping |
| [Language, BigInt](../../docs/language/numbers.md#bigint) and [Foundations, BigInt](../../docs/foundations/numbers.md#bigint) | plain and boxed bigint routes, exact value equality, 64-bit and 128-bit boundaries held to node |
| ECMAScript [indexed collections](https://tc39.es/ecma262/multipage/indexed-collections.html), [keyed collections](https://tc39.es/ecma262/multipage/keyed-collections.html) and [JSON.stringify](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify) | numeric sorting, value-based lookup, iteration and the bigint JSON error |
| TypeScript [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | number-or-bigint operands, concrete branches and generic carriers |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| storage | `storage-*` | 8 | 8 | Exact field, array, Map value, Map key, Set member and captured-binding reads, including boxed number-or-bigint keys and value-based deletion |
| arithmetic | `arithmetic-*` | 13 | 13 | Signed arithmetic, division and remainder, powers, negative and large shifts, bitwise operations, wrapping at 8/32/64/65/128 bits and RangeError paths |
| conversions | `conversion-*` | 8 | 8 | Number and decimal/prefixed string parsing, RangeError and SyntaxError paths, rounded Number results, decimal strings, templates and every radix from 2 through 36 |
| unions | `union-*` | 8 | 8 | Typeof-narrowed parameters, returns, fields and generic code, prefix/postfix increment and decrement, unary minus, exact values and runtime kinds |
| boundaries | `boundary-*` | 7 | 7 | JSON TypeError, numeric sorting, includes and indexOf, spread, destructuring, and widened literal arithmetic crossing 64-bit and 128-bit edges |

Bigint-route cases retain node's answer even where nts refuses a form.
### Length route contracts

| source | concepts |
| --- | --- |
| [Objects, Arrays](../../docs/foundations/objects.md#arrays) and [Typed arrays](../../docs/foundations/objects.md#typed-arrays) | same-array bounds, aliases and effects that end length facts, views over changing buffers |
| ECMAScript [Array objects and methods](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array-objects) and [TypedArray objects](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-typedarray-objects) | mutation, live iteration, callback snapshots, hole visitation, index normalization and current view lengths |
| ECMAScript [ArrayBuffer objects](https://tc39.es/ecma262/multipage/structured-data.html#sec-arraybuffer-objects) | resize, zeroed regrowth, offset recovery and transfer detachment |
| TypeScript [Object types](https://www.typescriptlang.org/docs/handbook/2/objects.html), including readonly arrays and tuples | mutable aliases, declared element routes and claims that do not freeze a runtime array |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| loops | `loops-*` | 12 | 12 | Cached and live for bounds, for-of, while and do-while with push, pop, shift, unshift, splice and length assignment, including direct and typed-parameter mutations |
| callbacks | `callbacks-*` | 10 | 10 | forEach, map, filter, reduce, find, findIndex, some, every, sort and flatMap under replacement, shrink-to-zero and doubling, with exact visitation and method results |
| shared | `shared-*` | 8 | 8 | Length-changing writes through fields, closures, parameters and Map values observed through readonly, generic, tuple and narrowed union readers inside and across traversals |
| typed-arrays | `typed-*` | 8 | 8 | Live and cached traversals across tracking growth, shrink, fixed-view invalidation and revival, fixed and tracking subarrays, ignored writes, offset recovery and transfer detachment |
| indices | `indices-*` | 8 | 8 | Cached arithmetic indices including NaN and fractions, negative at offsets, saved and current countdowns, rebound and per-iteration captures, tuple tails and narrowed replacement arrays |

Length-route cases retain node's answer even where nts refuses a form.
### Integer route contracts

| source | concepts |
| --- | --- |
| [Language, Numbers](../../docs/language/numbers.md#number) and [Integers proved from doubles](../../docs/language/numbers.md#integers-proved-from-doubles) | exact doubles when an integer range, whole-number or zero-sign fact stops holding |
| [Foundations, Numbers](../../docs/foundations/numbers.md#integers-proved-from-doubles) | widening obligations for numeric fields, elements, signatures and loop-carried values |
| ECMAScript [Number operations](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number) and [Math object](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math-object) | double arithmetic, signed zero, integer coercion, masked shifts, rounding and low-word multiplication |
| ECMAScript [Type conversion](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-type-conversion) and [TypedArray objects](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-typedarray-objects) | signed and unsigned wrapping, truncation, clamp ties and number values read from integer elements |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| counters | `counters-*` | 7 | 7 | Loop-carried fields, captures, generic and ordinary returns, update-clause indices and array accumulators cross 32-bit and 53-bit edges, go negative or gain half steps. |
| bitwise | `bitwise-*` | 10 | 10 | All bitwise operators, signed and unsigned shifts, ToInt32, Math.imul and Math.clz32 rewrite a number field before and after wide fractional arithmetic; shift counts include negative and oversized values. |
| rounding | `rounding-*` | 9 | 9 | Four rounding functions, signed and zero-divisor division and remainder, quotient truncation with bitwise-or or Math.trunc, and captured zero products retain subsequent numeric stages. |
| typed-arrays | `typed-*` | 5 | 5 | Int32Array, Uint32Array, Int16Array, Uint8Array and Uint8ClampedArray conversion is followed by ordinary number arithmetic that becomes fractional, exceeds the stored width or produces negative zero. |
| mixed | `mixed-*` | 6 | 6 | A narrowed number-or-string step introduces a fraction, a field gains and recovers from NaN, literals and enums widen, and field or captured indices become wide or fractional before array reads. |

Integer-route cases retain node's answer even where nts refuses a form.
Maintainers record backend results separately. Strict-rejected matrix
forms are listed with their diagnostics in the pull request.

### String route contracts

| source | concepts |
| --- | --- |
| [Foundations, Strings](../../docs/foundations/strings.md#what-a-string-is) | one-byte Latin-1 and two-byte UTF-16 storage; observable lengths, units and surrogate boundaries across typed carriers |
| [String header and operations](../../docs/foundations/strings.md#stage-d-the-header-carries-what-the-hot-operations-ask) | width and well-formedness facts, retained slices, append growth, exact construction, search and split results |
| [Foundations, Unicode](../../docs/foundations/unicode.md#staying-identical-to-node) | node-exact normalization, code-point traversal and preservation of lone surrogate units |

| area | case prefix | cases | controls | coverage |
| --- | --- | ---: | ---: | --- |
| building | `building-*` | 16 | 16 | Loop appends through fields, captures and generics; templates, join, repeat and padding; final-append widening and wide-to-Latin-1 slices |
| slicing | `slicing-*` | 10 | 10 | Slice, substring and substr bounds; at, charAt, charCodeAt and codePointAt; code-point traversal against code-unit indexing |
| searching | `searching-*` | 14 | 14 | Positioned searches, both width directions, split separators and limits, string-pattern replace and replaceAll with replacement tokens |
| comparing | `comparing-*` | 14 | 14 | Equality after different constructions, UTF-16 ordering and sort, all normalization forms, Map and Set identity, Unicode trims |
| types | `types-*` | 7 | 7 | Narrowed literal and string-number unions, widened string enums, template-typed fields, constrained generics and optional defaults |

String-route cases retain node's exact answer even if nts currently
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

### Object route contracts

| source | concepts |
| --- | --- |
| [TypeScript Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html) and [Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html) | interfaces, optional and readonly properties, index signatures, mapped types and generic object views |
| [ECMAScript OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryownpropertykeys) and [EnumerateObjectProperties](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html#sec-enumerate-object-properties) | array-index order, string insertion order, own versus inherited keys and for-in traversal |
| [ECMAScript CopyDataProperties](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-copydataproperties) | own enumerable string and symbol copying, exclusions, getter reads and plain data creation |
| [ECMAScript Object constructor statics](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-properties-of-the-object-constructor) | keys, values, entries, fromEntries, assign, freeze, isFrozen, seal, hasOwn and getOwnPropertyNames |
| [ECMAScript delete](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-delete-operator) and [TypeScript in narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#the-in-operator-narrowing) | optional and index-property deletion, exact membership and subsequent narrowed reads |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `key-order` | 7 | 7 | Integer boundaries and numeric aliases, constructor and reinsertion histories, getter-driven entry changes, readonly values and symbol exclusion |
| `spread-rest` | 9 | 9 | Ordered own enumerable copies, getter effects, overwrite positions, symbol keys, plain data results and class/nonenumerable exclusions |
| `statics` | 10 | 10 | Assignment setters, entry construction, frozen writes and accessors, shallow integrity, sealed keys and own nonenumerable names |
| `presence` | 8 | 8 | Optional absence versus undefined, own and inherited membership, deletion effects, strict failures and post-delete narrowing |
| `views` | 8 | 8 | Shared state and ordered shape through interface, class, index-signature, readonly, generic and structural accessor views |
### RegExp route contracts

| source | concepts |
| --- | --- |
| [TypeScript Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) and [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) | nullable match results, declared result containers, constrained calls and shared typed carriers |
| [ECMAScript RegExpBuiltinExec](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexpbuiltinexec) and [AdvanceStringIndex](https://tc39.es/ecma262/multipage/text-processing.html#sec-advancestringindex) | captures, named groups, match indices, lastIndex, global and sticky state, empty matches and UTF-16 advancement |
| [ECMAScript RegExp patterns](https://tc39.es/ecma262/multipage/text-processing.html#sec-patterns) | Unicode modes, case folding, property escapes, UnicodeSets operations, captures and lookaround |
| [ECMAScript String prototype methods](https://tc39.es/ecma262/multipage/text-processing.html#sec-properties-of-the-string-prototype-object) and [GetSubstitution](https://tc39.es/ecma262/multipage/text-processing.html#sec-getsubstitution) | match, matchAll, replace, replaceAll, search, split, callbacks, replacement tokens and capture insertion |
| [ECMAScript RegExp prototype methods](https://tc39.es/ecma262/multipage/text-processing.html#sec-properties-of-the-regexp-prototype-object) | exec and test, matching protocol state, cloned matchAll iterators and split behavior |
| [ECMAScript RegExp constructor](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp-constructor) and [RegExpInitialize](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexpinitialize) | runtime source and flags, independent expression copies, canonical metadata and invalid-pattern SyntaxErrors |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `match-results` | 9 | 9 | Nullable results, numbered and named captures, retained arrays and fields, boolean results and capture-index spans |
| `stateful` | 10 | 10 | Global and sticky exec/test histories, empty matches, explicit cursor writes, shared aliases and mixed-method state |
| `string-operations` | 12 | 12 | Replacement tokens and callbacks, split captures and limits, search state, matchAll snapshots and global-flag errors |
| `unicode` | 8 | 8 | Unicode and UnicodeSets cursor widths, case-folded captures, properties, set operations and surrogate lookbehind through typed carriers |
| `runtime-patterns` | 9 | 9 | Typed source and flag construction, escaped user text, canonical metadata, expression copies and exact constructor failures |

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

### Absent route contracts

| source | concepts |
| --- | --- |
| [TypeScript Optional Properties](https://www.typescriptlang.org/docs/handbook/2/objects.html#optional-properties), [Partial and Required](https://www.typescriptlang.org/docs/handbook/utility-types.html#requiredtype), and [Tuple Types](https://www.typescriptlang.org/docs/handbook/2/objects.html#tuple-types) | optional storage, required views where admitted, class fields, optional tuple tails and generic optional payloads |
| [TypeScript Optional Parameters](https://www.typescriptlang.org/docs/handbook/2/functions.html#optional-parameters) and [ECMAScript Binding Initialization](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html#sec-destructuring-binding-patterns-runtime-semantics-bindinginitialization) | argument omission, explicit undefined, defaults, rest parameters, destructuring and callbacks with fewer arguments |
| [Object.hasOwn](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.hasown), [Object.keys](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.keys), and [JSON.stringify](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify) | key presence, enumerable own keys, object copies and exact serialization of absent or undefined values |
| [Array.prototype.at](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.at), [TypedArray indexed access](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-typedarraygetelement), and [String prototype methods](https://tc39.es/ecma262/multipage/text-processing.html#sec-properties-of-the-string-prototype-object) | index normalization, negative and fractional properties, out-of-range sentinels, UTF-16 units and code points |
| [Optional Chains](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-optional-chains), [Binary Logical Operators](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-binary-logical-operators), and [Assignment Operators](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-assignment-operators) | skipped effects, optional receivers and calls, nullish versus truthy values, logical assignments and key creation |
| [Map.prototype.get](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-map.prototype.get), [FindViaPredicate](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-findviapredicate), and [delete](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-delete-operator) | missing entries, matched undefined, unsuccessful search results, callback order and deleted versus retained keys |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `properties` | 8 | 8 | Optional interfaces and class fields, Partial and Required views, destructuring defaults, generic slots and spread over existing defaults |
| `parameters` | 7 | 7 | Omitted and undefined arguments, value and destructured defaults, rest parameters, optional callback arguments and generic optional returns |
| `bounds` | 10 | 10 | Array and typed-array indices and at, string indexing/charAt/codePointAt/at, optional tuples and holes created by length growth |
| `chains` | 8 | 8 | Skipped property/index/call effects, optional method receivers, nullish versus truthy selection and all three logical assignments |
| `lookups` | 6 | 6 | Map get/has reports, find/findLast/indexOf/findIndex results and callback order, and deletion against stored undefined |

### Control-flow route contracts

| source | concepts |
| --- | --- |
| [TypeScript Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | control-flow analysis, assignments, guards, discriminants, assertion functions and never exhaustiveness |
| [TypeScript Enums](https://www.typescriptlang.org/docs/handbook/enums.html) and [TypeScript 5.3 switch true narrowing](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-3.html#switch-true-narrowing) | numeric and string enum selection, literal unions and narrowing cases |
| [ECMAScript Statements](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html) | switch case evaluation, labeled break and continue, iteration and try/finally completion precedence |
| [ECMAScript Expressions](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html) | short-circuit operators, logical assignment, optional chains and left-to-right operand, argument and key evaluation |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `switch` | 7 | 7 | Literal and enum dispatch, fallthrough, middle-default search, cached discriminants, ordered narrowing guards and exhaustive returns |
| `labels` | 9 | 9 | Labeled break and continue through nested loops and blocks, update/test order and retained iteration or shared bindings |
| `finally` | 9 | 9 | Saved return and throw values, cleanup on every exit, cleanup overrides, nested order and post-cleanup reads |
| `short-circuit` | 13 | 13 | Skipped and selected operands, cached logical-assignment references, optional boundaries, conditional narrowing and evaluation order |
| `narrowing` | 13 | 13 | Branch and loop joins, closure mutations followed by guards, early exits, assertion branches and post-loop member reads |

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
| `objects` | 5 | 5 | Discriminated object replacement, shared and differing class fields, optional member fields and shared reference writes |
| `widening` | 8 | 8 | Wider fields, unknown, generic storage, overload and conditional results, and map/filter/concat-built union arrays |
| `values` | 42 | 42 | All six storage routes crossed with all seven narrowing routes, carrying signed zero, NaN, zero bigint, empty text, false, both absences and object identity |

### Tuple route contracts

| source | concepts |
| --- | --- |
| [TypeScript Tuple Types](https://www.typescriptlang.org/docs/handbook/2/objects.html#tuple-types) | fixed positions with differing kinds, optional and rest elements, tuple storage, parameters and results |
| [Readonly Tuple Types](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-tuple-types) and [Labeled Tuple Elements](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#labeled-tuple-elements) | readonly tuple annotations, readonly array views and named element types |
| [Variadic Tuple Types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types) and [Rest Parameters and Arguments](https://www.typescriptlang.org/docs/handbook/2/functions.html#rest-parameters-and-arguments) | generic tuple spreads, argument lists, destructured and rest parameters, exact argument order and optional arity |
| [Array prototype methods](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-properties-of-the-array-prototype-object) and [ArraySetLength](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-arraysetlength) | sorting, filtering, iteration, copying, widened writes, runtime length, holes, truncation and regrowth |
| [SerializeJSONArray](https://tc39.es/ecma262/multipage/structured-data.html#sec-serializejsonarray) | exact JSON for optional tuples and tuples nested in objects or other tuples |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `storage` | 18 | 18 | Three tuple shapes across fields, arrays, Maps, closures, sorting and filtering, with every slot and original identity checked |
| `elements` | 18 | 18 | Optional, rest and labeled forms across all six storage routes, including exact presence, rest counts and sorted inner identities |
| `calls` | 8 | 8 | Typed parameters and returns, spread calls, destructuring, tuple rest parameters, optional arity, variadic append and generic argument forwarding |
| `widening` | 8 | 8 | Array aliases that push, replace, extend, truncate and regrow tuples, plus readonly array parameters and live captured views |
| `conversion` | 10 | 10 | for-of, entries, map, slice, concat, array and tuple spreads, and exact JSON for standalone and nested tuples |

### Layout route contracts

| source | concepts |
| --- | --- |
| [Type-only Field Declarations](https://www.typescriptlang.org/docs/handbook/2/classes.html#type-only-field-declarations), [Initialization Order](https://www.typescriptlang.org/docs/handbook/2/classes.html#initialization-order) and [InitializeInstanceElements](https://tc39.es/ecma262/#sec-initializeinstanceelements) | added and redeclared fields, constructor assignments, declaration-only fields and define semantics |
| [Relationships Between Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html#relationships-between-classes) and [in-operator Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#the-in-operator-narrowing) | structural views, class-shaped literals, constrained generics and truthful field narrowing |
| [OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/#sec-ordinaryownpropertykeys) and [SerializeJSONObject](https://tc39.es/ecma262/#sec-serializejsonobject) | complete own-key order and exact JSON across different field sets |
| [TypeScript Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html), [Static Members](https://www.typescriptlang.org/docs/handbook/2/classes.html#static-members) and [PrivateGet](https://tc39.es/ecma262/#sec-privateget) | independent private slots and brands, wrong receivers, inherited static references and shadowed state |
| [Error constructor](https://tc39.es/ecma262/#sec-error-message-options), [Map constructor](https://tc39.es/ecma262/#sec-map-iterable) and [Set constructor](https://tc39.es/ecma262/#sec-set-iterable) | builtin payloads and iterable writes before derived-field initialization |
| [ArraySpeciesCreate](https://tc39.es/ecma262/#sec-arrayspeciescreate) and [Promise.prototype.then](https://tc39.es/ecma262/#sec-promise.prototype.then) | returned subclass instances and newly initialized own fields beside builtin result contents |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `storage` | 4 | 4 | Added, shared and redeclared fields through base-typed fields, arrays, Maps and closures, with every field and bidirectional alias write checked |
| `presence` | 8 | 8 | Own keys, for-in, spread and exact JSON across layouts, constructor assignments, initializers, declare fields, definite-assignment fields and optional fields |
| `structural` | 8 | 8 | Class instances through smaller interface and object views, constrained generics, class-shaped literals and object/in narrowing |
| `state` | 8 | 8 | Independent private slots and brands, private methods/accessors, wrong receivers, inherited static references, shadowed static slots and captured constructor readers |
| `builtins` | 7 | 7 | Error payloads and cause, Map/Set constructor writes, Array contents and species results, and Promise fulfillment and then species |

### Destructuring route contracts

| source | concepts |
| --- | --- |
| [TypeScript variable declarations and destructuring](https://www.typescriptlang.org/docs/handbook/variable-declarations.html#destructuring) | declared tuple, object and parameter patterns, optional/rest inputs, renaming, defaults and typed argument routes |
| [BindingInitialization](https://tc39.es/ecma262/#sec-destructuring-binding-patterns-runtime-semantics-bindinginitialization) and [IteratorBindingInitialization](https://tc39.es/ecma262/#sec-destructuring-binding-patterns-runtime-semantics-iteratorbindinginitialization) | ordered bound reads, elisions, undefined-only defaults, nested bindings and rest exhaustion |
| [DestructuringAssignmentEvaluation](https://tc39.es/ecma262/#sec-runtime-semantics-destructuringassignmentevaluation) | existing bindings, target references, assignment-expression identity, partial writes and loop-head patterns |
| [CopyDataProperties](https://tc39.es/ecma262/#sec-copydataproperties) | own enumerable rest keys, string and symbol exclusions, getter reads and complete copy order |
| [IteratorClose](https://tc39.es/ecma262/#sec-iteratorclose) | closing short or abruptly failing patterns, nested cleanup order and original-error precedence |
| [useUnknownInCatchVariables](https://www.typescriptlang.org/tsconfig/useUnknownInCatchVariables.html) | strict catch variables remain unknown; rejected catch-head property patterns are reported with their diagnostics |

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `arrays` | 9 | 9 | Tuple, sparse-array, string, Set, Map-entry, generator and user-iterable patterns with elisions, defaults, nesting, rest and exact iterator histories |
| `objects` | 8 | 8 | Class fields and getters, literals, Records, array indices and symbol keys with renaming, computed keys, defaults, nesting and ordered rest exclusion |
| `parameters` | 10 | 10 | Earlier-parameter and earlier-binding defaults, optional and rest inputs, callback patterns, methods, constructors and arrows with exact effect order |
| `assignment` | 8 | 8 | Existing bindings, fields, computed elements, swaps, nested targets and typed for-of heads with exact target/read/write/close order |
| `order` | 9 | 9 | Dependent defaults, repeated getters, past-end values, noniterables and throwing nested patterns with exact iterator closing and original-error precedence |
### Sort route contracts

| source | concepts |
| --- | --- |
| ECMAScript [Array.prototype.sort](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.sort), [SortIndexedProperties](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-sortindexedproperties) and [CompareArrayElements](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-comparearrayelements) | stable ordering, UTF-16 string comparison by default, undefined before holes, comparator number results and mutation after successful comparison |
| ECMAScript [Array.prototype.toSorted](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.tosorted) | a fresh ordered result, unchanged source and dense reads of sparse arrays |
| ECMAScript [TypedArray.prototype.sort](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-%typedarray%.prototype.sort), [CompareTypedArrayElements](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-comparetypedarrayelements), [TypedArray.prototype.toSorted](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-%typedarray%.prototype.tosorted) and [TypedArray.prototype.subarray](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-%typedarray%.prototype.subarray) | numeric default order, negative zero before positive zero, NaN last, stable custom comparisons, independent copies and shared view windows |
| TypeScript [Array types](https://www.typescriptlang.org/docs/handbook/2/objects.html#the-array-type), [ReadonlyArray](https://www.typescriptlang.org/docs/handbook/2/objects.html#the-readonlyarray-type), [function types](https://www.typescriptlang.org/docs/handbook/2/functions.html#function-type-expressions) and [generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) | declared element types and readonly views, stored comparator signatures and typed key-function factories |
| ECMAScript [Object.freeze](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.freeze) | non-writable elements reject sorting writeback with TypeError |

| area | files | cases | controls | typed routes |
| --- | --- | ---: | ---: | --- |
| default | `default-*` | 6 | 6 | String, number and union elements, UTF-16 and mixed case, equal string forms, undefined and holes, sort beside toSorted |
| comparators | `comparator-*` | 9 | 9 | Captured state, detached and bound methods, generic key factories, stored and runtime-selected functions, fractional and infinite signs, NaN equality |
| stability | `stability-*` | 4 | 4 | Successive keys, interface-held records, tuple elements and getter-derived class keys with complete identity and position order |
| typed-arrays | `typed-*` | 22 | 22 | Five element kinds with default and custom sort and toSorted, signed zero and NaN, observable equal-key groups and subarray writeback |
| edges | `edges-*` | 5 | 5 | Throwing comparators and unchanged arrays, alias-visible mutation, frozen arrays of length at least two and readonly copies |
### Structured clone route contracts

| source | concepts |
| --- | --- |
| HTML [StructuredSerializeInternal](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal) and [StructuredDeserialize](https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize) | primitive values, own enumerable string keys, graph memory, aliases and cycles; arrays, Maps, Sets, Dates, Error names/messages and plain objects replacing class prototypes |
| HTML [StructuredSerializeWithTransfer](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer) and [Structured cloning API](https://html.spec.whatwg.org/multipage/structured-data.html#dom-structuredclone) | buffer bytes, shared view storage, transfer detachment and DataCloneError DOMExceptions |
| ECMAScript [ArrayBuffer.prototype.transfer](https://tc39.es/ecma262/multipage/structured-data.html#sec-arraybuffer.prototype.transfer) | the independent detachment primitive after explicit copying in transfer controls |
| TypeScript [Object types](https://www.typescriptlang.org/docs/handbook/2/objects.html), [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html), [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) and [Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html) | declared storage, union refinements, generic callbacks, private members and base-class routes |

| area | files | cases | controls | typed routes |
| --- | --- | ---: | ---: | --- |
| plain-data | `plain-*` | 7 | 7 | Interfaces, recursive Records, optional tuples, sparse arrays, narrowed unions and generic factories with exact graph topology |
| collections | `collections-*` | 7 | 7 | Object Map keys, shared and cyclic Maps/Sets, valid and invalid Dates, tuple aliases and nested typed collections |
| classes | `classes-*` | 7 | 7 | Own data, ECMAScript private slots versus TypeScript private data, own and inherited getters, missing methods and base-typed subclasses |
| buffers | `buffers-*` | 16 | 16 | All twelve typed-array kinds, whole buffer bytes, offsets, DataViews, shared cyclic view graphs and transfer detachment |
| errors | `errors-*` | 9 | 9 | Functions, symbols and typed holders, success arms, ignored symbol keys, builtin errors and custom subclass fallback |

### Descriptor route contracts

| source | concepts |
| --- | --- |
| ECMAScript [Object.defineProperty](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.defineproperty), [Object.defineProperties](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.defineproperties), [ToPropertyDescriptor](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-topropertydescriptor) and [ValidateAndApplyPropertyDescriptor](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-validateandapplypropertydescriptor) | new-property attribute defaults, data/accessor alternatives, retained omitted attributes, SameValue redefinitions and incompatible changes |
| ECMAScript [Object.getOwnPropertyDescriptor](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.getownpropertydescriptor), [Object.getOwnPropertyDescriptors](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.getownpropertydescriptors) and [OrdinarySetWithOwnDescriptor](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinarysetwithowndescriptor) | independent descriptor records, complete field observations, receiver-bound accessors and inherited non-writable data |
| ECMAScript [EnumerableOwnProperties](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-enumerableownproperties), [CopyDataProperties](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-copydataproperties), [Object.assign](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.assign) and [JSON.stringify](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify) | ordered enumerable keys, values and entries; own enumerable object copying and object serialization; array serialization reads indexed values |
| ECMAScript [SetIntegrityLevel](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-setintegritylevel), [TestIntegrityLevel](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-testintegritylevel), [OrdinaryPreventExtensions](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinarypreventextensions) and [ArraySetLength](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-arraysetlength) | exact extensible/sealed/frozen predicates, shallow flag changes, refused additions and deletions, retained setters and array index/length behavior |
| TypeScript [Object types](https://www.typescriptlang.org/docs/handbook/2/objects.html), [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html), [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) and [Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html) | declared carriers, readonly aliases, optional deletion, receiver annotations and subclass routes |

| area | files | cases | controls | typed routes |
| --- | --- | ---: | ---: | --- |
| defining | `defining-*` | 8 | 8 | Descriptor construction and reflection through interfaces, Records, generics, narrowed unions, class fields and array elements |
| writability | `writable-*` | 7 | 7 | Interface writes, readonly aliases, inherited data, Record fields, narrowed recreation, frozen data and locked array indices |
| enumerability | `enumerable-*` | 7 | 7 | Ordered listings, JSON, generic spread, returned assign sources, inherited shadowing, class members and hidden array indices |
| integrity | `integrity-*` | 10 | 10 | Interface, class, Record, generic, union and array routes across extensibility, sealing, freezing, shallow contents and accessors |
| accessors | `accessor-*` | 7 | 7 | Interface, class-field, prototype, subclass, generic, returned and array-element routes with exact receiver state |

Pinned Node 24.20.0 reports isFrozen true for nonextensible arrays whose only
own property is length, including sealed empty and all-hole arrays, although
their length descriptor is writable and length writes succeed. The integrity
pairs retain those inputs, length descriptors, permitted operations and the
other predicates, but leave that one isFrozen result unasserted. Arrays with
own elements and arrays actually passed to freeze retain full predicate
assertions. The integrity pull request records the reproducer and the
TestIntegrityLevel rule requiring non-writable own data for a frozen object.

### Symbol route contracts

| source | concepts |
| --- | --- |
| ECMAScript [Symbols](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-symbol-objects), [Symbol.for](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-symbol.for) and [Symbol.keyFor](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-symbol.keyfor) | fresh identities, descriptions, descriptive strings, registry identity and reverse lookup |
| ECMAScript [OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryownpropertykeys), [EnumerableOwnProperties](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-enumerableownproperties), [Object.getOwnPropertySymbols](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.getownpropertysymbols) and [Reflect.ownKeys](https://tc39.es/ecma262/multipage/reflection.html#sec-reflect.ownkeys) | ordered integer, string and symbol keys, enumerable string listings, hidden own symbols and inherited exclusions |
| ECMAScript [CopyDataProperties](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-copydataproperties), [Object.assign](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.assign) and [JSON.stringify](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify) | own enumerable symbol copying, overwrite positions, independent copied properties and symbol exclusion from JSON |
| ECMAScript [Object.prototype.toString](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.prototype.tostring), [InstanceofOperator](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-instanceofoperator), [IsConcatSpreadable](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-isconcatspreadable) and [ToPrimitive](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-toprimitive) | well-known-symbol dispatch, tag fallback, concat flags, inherited hooks, exact receiver and conversion hints |
| ECMAScript [ToString](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tostring), [ToNumber](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber), [Map](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-map-objects), [Set](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-set-objects) and [WeakMap](https://tc39.es/ecma262/multipage/keyed-collections.html#sec-weakmap-objects) | conversion refusals, identity-keyed collections and registered-symbol exclusion from weak keys |
| TypeScript [Symbols](https://www.typescriptlang.org/docs/handbook/symbols.html), [Object types](https://www.typescriptlang.org/docs/handbook/2/objects.html), [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html), [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) and [Classes](https://www.typescriptlang.org/docs/handbook/2/classes.html) | unique symbols, declared carriers, computed members, narrowed routes and inherited class dispatch |

| area | files | cases | controls | typed routes |
| --- | --- | ---: | ---: | --- |
| keys | `keys-*` | 8 | 8 | Unique-symbol interfaces, Record fields, computed methods, instance and static class members, narrowed unions, tuple keys and inherited accessors |
| listing | `listing-*` | 8 | 8 | Returned records, class fields and statics, inherited interfaces, union elements, generic hidden properties, arrays and tuple deletion/reinsertion |
| copying | `copying-*` | 7 | 7 | Generic sources, interface targets, class and array fields, Record source parameters, narrowed unions and tuple source elements |
| values | `values-*` | 10 | 10 | Interface and class fields, generic parameters, typed returns, tuple and array elements, Map, Set and WeakMap carriers |
| well-known | `wellknown-*` | 12 | 12 | Stored interfaces and callbacks, tuple elements, array returns, class constructors, base returns and inherited subclass hooks |

### Function object route contracts

| source | concepts |
| --- | --- |
| ECMAScript [SetFunctionName](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-setfunctionname), [SetFunctionLength](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-setfunctionlength) and [ExpectedArgumentCount](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-static-semantics-expectedargumentcount) | declared and inferred function names, computed and symbol keys, getter/setter prefixes and arity before the first initializer or rest parameter |
| ECMAScript [Function.prototype.call](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-function.prototype.call), [Function.prototype.apply](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-function.prototype.apply) and [Function.prototype.bind](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-function.prototype.bind) | exact receiver values, ordered argument delivery, bound argument prefixes, clamped bound arity and bound name prefixes |
| ECMAScript [Bound function calls](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-bound-function-exotic-objects-call-thisargument-argumentslist), [Bound construction](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-bound-function-exotic-objects-construct-argumentslist-newtarget) and [BoundFunctionCreate](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-boundfunctioncreate) | first-bound receiver retention, repeated prepending, constructor forwarding and construction independent of bound this |
| ECMAScript [FunctionDeclarationInstantiation](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-functiondeclarationinstantiation) and [ArgumentListEvaluation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-argumentlistevaluation) | parameter initialization, lazy dependent defaults, rest collection and ordered spread argument evaluation |
| ECMAScript [CreateUnmappedArgumentsObject](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-createunmappedargumentsobject) | actual argument count and elements, strict parameter independence, retained argument objects and iteration for forwarding |
| TypeScript [More on Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html), [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) and [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | function types, call and construct signatures, explicit this parameters, generic constraints, optional and rest inputs, tuple spreads and typeof-refined function unions |

| area | files | cases | controls | typed routes |
| --- | --- | ---: | ---: | --- |
| length-name | `metadata-*` | 11 | 11 | Function arrays, typed fields and parameters, generic returns, interface methods, tuple elements, computed and symbol keys, accessors, constructors and narrowed unions |
| call-apply | `apply-*`, `call-*` | 9 | 9 | Typed call signatures, explicit receivers, detached methods, generic helpers and complete ordered argument lists |
| bind | `bind-*` | 8 | 8 | Stored and returned bound functions, prepended argument lists, repeated binding, exact metadata and bound class construction |
| defaults-rest | `parameters-*` | 10 | 10 | Default evaluation order, undefined-only initialization, dependent parameters, rest slices and typed spread lists |
| arguments | `arguments-*` | 9 | 9 | Function and method carriers, differing declared signatures, strict parameter independence, retained argument objects and spread or apply forwarding |

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

### Date route contracts

| source | concepts |
| --- | --- |
| [Date objects](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date-objects), [TimeClip](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-timeclip), [Date.UTC](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date.utc) and [UTC setters](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-properties-of-the-date-prototype-object) | fixed time values, Gregorian normalization, optional components, clipping and mutation |
| [Date time string format](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date-time-string-format), [toISOString](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date.prototype.toisostring), [toJSON](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date.prototype.tojson) and [JSON serialization](https://tc39.es/ecma262/multipage/structured-data.html#sec-serializejsonproperty) | exact UTC and extended-year text, explicit offsets, invalid dates and ordered JSON conversion |
| [Object types](https://www.typescriptlang.org/docs/handbook/2/objects.html), [generics](https://www.typescriptlang.org/docs/handbook/2/generics.html), [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) and [stable Array sorting](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.sort) | typed carriers, aliases, independent copies, union branches and stable equal-time identities |

Only UTC operations and fixed inputs are used. The local-time multiargument
Date constructor is omitted under that constraint; Date.UTC followed by
numeric Date construction covers component normalization. This is not a
TypeScript rejection. For invalid dates, toISOString throws RangeError and
toJSON returns null. setUTCFullYear can recover invalid time using epoch
defaults and keeps astronomical years 0–99; the other UTC setters preserve
invalidity. No compiler or backend outcome is predicted.

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `construction` | 7 | 7 | typed numeric inputs, Date.UTC components, clipping, astronomical years and optional-argument presence |
| `setters` | 11 | 11 | all seven UTC setters, optional components, invalid-state recovery, returned times and retained getter views |
| `text` | 7 | 7 | exact ISO and JSON text, explicit-offset parsing, extended years and shared JSON traversal effects |
| `time-values` | 8 | 8 | numeric reads, clipping, fractions, signed zero, comparisons, arithmetic and stable equal-time ordering |
| `shared` | 8 | 8 | identity, alias writes, independent copies, generic returns, closures and retained carrier populations |

### Math route contracts

| source | concepts |
| --- | --- |
| ECMAScript [Math functions](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-function-properties-of-the-math-object), [round](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.round) and [fround](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.fround) | ties toward positive infinity, signed zero, NaN, extrema and binary32 roundTiesToEven |
| [Number operations](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number) and [type conversion](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-type-conversion) | exponentiation special cases, ToInt32/ToUint32 wrapping, bitwise operations and masked shifts |
| [sqrt](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.sqrt), [hypot](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.hypot), [cbrt](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.cbrt) and [atan2](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.atan2) | correctly rounded square roots and explicitly prescribed exceptional results, separate from implementation-approximated outputs |
| TypeScript [object types](https://www.typescriptlang.org/docs/handbook/2/objects.html), [functions](https://www.typescriptlang.org/docs/handbook/2/functions.html), [generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) and [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | declared numeric carriers, interface calls, tuples, constrained generics and narrowed union operands |

Only specification-fixed numeric outputs receive exact assertions. Nonzero
finite cbrt and hypot results, including finite single-argument hypot, are
implementation-approximated. The nonzero angle branches of atan2, including
infinite quadrants, and the corresponding inverse-trigonometric pi boundaries
are also implementation-approximated; the handoff's fixed-result constraint
therefore excludes their exact numeric assertions. Signed-zero, infinity, NaN
and domain branches are included wherever the specification prescribes their
result. These scope choices are not TypeScript rejections. Controls replace
only the operation with a table and keep the case's typed routes. Maintainers
record backend outcomes separately; no compiler result is predicted.

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `rounding` | 8 | 8 | halves, signed zero, binary64 integer boundaries and binary32 ties, underflow and overflow through numeric inputs and returns |
| `extremes` | 8 | 8 | signed-zero orders, NaN positions, empty and spread extrema, absolute magnitude and prescribed hypot special values |
| `powers-roots` | 10 | 10 | pow and exponentiation special cases, correctly rounded square roots and prescribed root, exponential and logarithmic values |
| `integer-conversions` | 10 | 10 | wrapped integer operands, masked shift counts, low-word products and comparisons with truncation across typed carriers |
| `trigonometry` | 13 | 13 | prescribed signed zeros, infinities, NaN and domain errors through unary trigonometric functions and exact atan2 branches |

### Number-format route contracts

| source | concepts |
| --- | --- |
| ECMAScript [toFixed](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.prototype.tofixed), [toPrecision](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.prototype.toprecision) and [toExponential](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.prototype.toexponential) | exact binary-value rounding, ties, padding, notation changes, omitted digits and range-check ordering |
| [Number::toString](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-tostring) and [Number.prototype.toString](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.prototype.tostring) | shortest round-trip representations, decimal thresholds, integer radices and radix validation |
| [StringToNumber](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-stringtonumber), [StringNumericValue](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-runtime-semantics-stringnumericvalue) and [RoundMVResult](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-roundmvresult) | complete numeric-string grammar, Unicode whitespace, prefix/sign rules and rounded binary64 values |
| [parseInt](https://tc39.es/ecma262/multipage/global-object.html#sec-parseint-string-radix) and [parseFloat](https://tc39.es/ecma262/multipage/global-object.html#sec-parsefloat-string) | longest usable prefixes, optional radix inference, ToInt32 radix conversion and signed zero |
| TypeScript [functions](https://www.typescriptlang.org/docs/handbook/2/functions.html), [generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) and [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | typed operands and returns, callable interfaces, stored text, tuples and narrowed unions |

Only uniquely specification-fixed outputs receive exact assertions. Shortest
decimal text and omitted-digit exponential text can permit multiple final
digits; those ambiguous observations are excluded. Nondecimal fractional
formatting is excluded. Exact successful parseInt results use radices 2, 4,
8, 10, 16 and 32; the other radices permit implementation-approximated integer
results and are covered at their fixed rejection paths. Decimal inputs beyond
20 significant digits are excluded where permitted rounding choices differ.

Direct non-string parser arguments and binary arithmetic on typed strings
are omitted with their strict TypeScript diagnostics in the pull requests.
Explicit String(number) parser pipelines and legal unary arithmetic conversion
remain covered. A pinned-node observation that conflicts with the normative
algorithm is left unasserted and documented with its reproducer in the PR.
The existing number-routes, integer-routes and math-routes files are unchanged;
maintainers measure and record every backend outcome.

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `fixed-notation` | 9 | 9 | binary-value rounding and ties, exact fixed digits, signed zero, exponent fallback and digit-count validation through typed numbers |
| `precision-exponent` | 10 | 10 | significant digits, exponent carries, padding, omitted arguments and range precedence through generic and interface routes |
| `radix` | 9 | 9 | uniquely specified shortest text, notation thresholds, every integer radix and radix validation through tuple, union and generic operands |
| `string-to-number` | 8 | 8 | complete numeric-string grammars, Unicode whitespace, signed zeros and rounded limits through string, union and arithmetic routes |
| `partial-parsing` | 10 | 10 | longest valid prefixes, optional and wrapped radices, signed zero and explicit number-to-text pipelines through typed parser inputs |

### Template route contracts

| source | concepts |
| --- | --- |
| ECMAScript [template evaluation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-template-literals-runtime-semantics-evaluation), [ToString](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tostring) and [ToPrimitive](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-toprimitive) | each untagged substitution converts with the string hint in source order; abrupt conversion skips later substitutions |
| [GetTemplateObject](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-gettemplateobject) and [tagged templates](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-tagged-templates) | cooked/raw arrays, lengths, frozen states, per-site identity, unconverted arguments and receiver-preserving calls |
| [TemplateStrings](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-static-semantics-templatestrings), [TV and TRV](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-static-semantics-tv-and-trv) and [String.raw](https://tc39.es/ecma262/multipage/text-processing.html#sec-string.raw) | cooked versus raw escapes, invalid cooked entries, line-continuation normalization and exact raw/argument interleaving |
| TypeScript [functions](https://www.typescriptlang.org/docs/handbook/2/functions.html), [generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) and [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | typed fields and returns, tuples, callable interfaces, methods, constrained helpers and narrowed substitutions |

Only exact specification-fixed strings and identities are asserted. Numeric
substitutions use uniquely determined shortest decimal spellings. A direct
symbol substitution rejected by strict TypeScript is documented rather than
forced through a cast; an ordinary tag can accept the symbol unconverted.
Controls retain the typed routes and model only the template operation,
including its per-site allocation and order. Existing expressions,
string-routes, implicit-calls and recorded families remain unchanged.
Maintainers measure and record all nts backend outcomes.

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `substitutions` | 9 | 9 | primitive and array substitutions, conversion hints, ordinary fallback and abrupt conversion through fields, returns, unions and generics |
| `tag-functions` | 8 | 8 | typed tags preserve frozen cooked/raw arrays, unconverted substitutions, call order and method receivers |
| `identity` | 8 | 8 | one frozen template object per site across callers, iterations, closures and instances, with Map and WeakMap retention |
| `escapes-raw` | 10 | 10 | exact cooked/raw escapes, invalid cooked entries and String.raw interleaving through typed tags and raw-array views |
| `nesting-composition` | 8 | 8 | nested templates and typed tags returning objects, numbers, functions or tags preserve values and side-effect order |

### Enum route contracts

| source | concepts |
| --- | --- |
| TypeScript [numeric enums](https://www.typescriptlang.org/docs/handbook/enums.html#numeric-enums), [computed and constant members](https://www.typescriptlang.org/docs/handbook/enums.html#computed-and-constant-members) and [reverse mappings](https://www.typescriptlang.org/docs/handbook/enums.html#reverse-mappings) | zero-based and restarted sequences, constant expressions, run-time initializer order and numeric value-to-name writes |
| [String enums](https://www.typescriptlang.org/docs/handbook/enums.html#string-enums), [heterogeneous enums](https://www.typescriptlang.org/docs/handbook/enums.html#heterogeneous-enums), [union enums and member types](https://www.typescriptlang.org/docs/handbook/enums.html#union-enums-and-enum-member-types) and [const enums](https://www.typescriptlang.org/docs/handbook/enums.html#const-enums) | exact string or numeric members, absent string reverse entries, literal-member unions, discriminants and inlined constants |
| [Enums at runtime](https://www.typescriptlang.org/docs/handbook/enums.html#enums-at-runtime), [enums at compile time](https://www.typescriptlang.org/docs/handbook/enums.html#enums-at-compile-time), [Object.keys](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.keys) and [OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryownpropertykeys) | enum object identity, keyof typeof, numeric reverse entries and exact ordered listings across typed object views |
| [Declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#merging-namespaces-with-classes-functions-and-enums), [generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) and [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | repeated declarations, namespace functions, typed carriers and observed branch selection |

Every numeric result is checked with Object.is and its runtime kind; strings
and complete ordered lists are exact. Controls preserve the computation and
carrier while replacing enum lowering with explicit data. Freezing belongs
to that control model; the enum case does not assume its runtime object is
frozen. A literal -0 member whose sign differs between Node transformation
and TypeScript emit is documented rather than asserted. Runtime initializers
returning -0 agree in both executions and remain covered. Existing enums,
literal-types, union-routes and all recorded families remain unchanged.
Maintainers compile and record every nts backend outcome.

| area | cases | controls | typed routes |
| --- | ---: | ---: | --- |
| `numeric` | 9 | 9 | implicit, explicit and computed numeric members, alias reverse mappings and initialization timing across fields, returns, tuples and generics |
| `string-heterogeneous` | 8 | 8 | string and mixed member values, absent string reverse mappings, comparison branches and enum-valued Record and Map keys |
| `literal-members` | 8 | 8 | member unions and discriminants, exhaustive switches, comparison narrowing and const-enum values through interfaces and generic helpers |

## Tags

<!-- tags:begin -->
| tag | meaning | source | cases | pending |
| --- | --- | --- | ---: | ---: |
| `ts-abstract` | an `abstract` class and its abstract members | conformance/classes/classDeclarations/classAbstractKeyword; ts-eslint TSAbstractMethodDefinition, TSAbstractPropertyDefinition | 27 | 1 |
| `ts-absent-route-bounds` | typed array, view, string and tuple reads preserve missing-result sentinels, valid payloads, index normalization and hole presence | Array and String prototype methods; TypedArray indexed access; TypeScript Tuple Types | 20 | 0 |
| `ts-absent-route-chains` | optional chains and nullish or logical operators preserve short-circuit effects, receivers, results and property presence | ECMAScript Optional Chains; Binary Logical and Assignment Operators | 16 | 0 |
| `ts-absent-route-lookups` | typed lookup reports and deleted properties distinguish no result from a matched or stored undefined, with exact search order and key presence | Map get and has; Array search methods; delete | 12 | 0 |
| `ts-absent-route-parameters` | optional, default, destructured, rest and callback parameters preserve omitted versus supplied arguments and exact default effects | TypeScript Optional Parameters; ECMAScript Binding Initialization | 14 | 0 |
| `ts-absent-route-properties` | optional properties and mapped or class views distinguish absent keys, own undefined and stored payloads through reads, copies and defaults | TypeScript Optional Properties; Partial and Required; Object and JSON operations | 16 | 0 |
| `ts-absent-routes` | typed missing-value routes preserve exact undefined results, presence, defaults, skipped effects and serialization beside explicit-presence controls | Absent route contracts; typed paths | 78 | 0 |
| `ts-accessor-fields` | an `accessor` field (auto-accessor), static, private or abstract | conformance/classes/propertyMemberDeclarations/autoAccessor; ts-eslint AccessorProperty, TSAbstractAccessorProperty | 0 | 7 |
| `ts-accessors` | `get`/`set` accessors on a class or an object literal | conformance/classes/propertyMemberDeclarations; typed paths | 405 | 4 |
| `ts-ambient` | an ambient declaration (`declare var/function/class/namespace/global`), which emits nothing | conformance/ambient; ts-eslint TSDeclareFunction, `declare` modifiers | 6 | 1 |
| `ts-any` | an explicitly `any`-typed value, the dynamic escape hatch | conformance/types/any; ts-eslint TSAnyKeyword | 4 | 0 |
| `ts-array-contents` | array elements retain values, runtime kinds, order and slot presence across typed writes and reads | Array contents contracts; typed paths | 142 | 0 |
| `ts-array-iteration` | writes through typed aliases during iteration preserve live traversal and callback semantics | Objects, Arrays; ECMAScript, CreateArrayIterator and Array.prototype.forEach | 8 | 0 |
| `ts-array-reads` | indexed, method, iterator and conversion reads observe actual values through differing declared types | Array contents contracts; typed paths | 36 | 0 |
| `ts-array-representation` | concrete element storage crosses a wider reader with exact payloads, identities and slot presence | Language, Types, A type is a layout; Objects, Arrays | 24 | 0 |
| `ts-array-widening` | one array crosses wider, readonly, generic, holder or tuple views without changing stored values | Language, Types, Decisions; Array contents contracts | 34 | 0 |
| `ts-array-writes` | writes and array construction through widened routes preserve values, length, order and holes | Objects, Arrays; ECMAScript, Array prototype methods | 40 | 0 |
| `ts-arrays` | typed arrays of values (`T[]`, `Array<T>`) and their methods | conformance/types/primitives; ts-eslint TSArrayType | 4651 | 0 |
| `ts-arrow-functions` | an arrow function, generic or typed | conformance/es6/arrowFunction | 809 | 0 |
| `ts-as-const` | a const assertion (`as const`), which is not a freeze | conformance/expressions/typeAssertions/constAssertions | 4 | 0 |
| `ts-assertion-functions` | an assertion function (`asserts value is T`, `asserts condition`) | conformance/controlFlow/assertionTypePredicates; ts-eslint TSTypePredicate.asserts | 102 | 0 |
| `ts-async-generators` | an async generator, `for await`, and `Symbol.asyncIterator` | conformance/es2018 (asyncGenerators, forAwait); conformance/types/forAwait | 31 | 0 |
| `ts-async` | async functions, methods and arrows, and the promises they return | conformance/async; conformance/es2017 | 262 | 1 |
| `ts-bigint` | `bigint` values, literals and literal types in typed code | conformance/es2020 (bigint); ts-eslint TSBigIntKeyword | 670 | 0 |
| `ts-async-route-methods` | async methods and dispatch with exact values, identities, cleanup and microtask order | Async route contracts; typed paths | 14 | 0 |
| `ts-async-route-ordering` | ordering and captures with exact values, identities, cleanup and microtask order | Async route contracts; typed paths | 10 | 0 |
| `ts-async-route-promises` | generic and stored promises with exact values, identities, cleanup and microtask order | Async route contracts; typed paths | 28 | 0 |
| `ts-async-route-rejections` | rejections and cleanup with exact values, identities, cleanup and microtask order | Async route contracts; typed paths | 16 | 0 |
| `ts-async-route-values-thenables` | awaiting values and thenables with exact values, identities, cleanup and microtask order | Async route contracts; typed paths | 22 | 0 |
| `ts-bigint-route-arithmetic` | arithmetic and wrapping with exact wide values, runtime kinds and exception checks | Bigint route contracts; typed paths | 26 | 0 |
| `ts-bigint-route-boundaries` | bigints at the boundaries with exact wide values, runtime kinds and exception checks | Bigint route contracts; typed paths | 14 | 0 |
| `ts-bigint-route-conversions` | conversions with exact wide values, runtime kinds and exception checks | Bigint route contracts; typed paths | 16 | 0 |
| `ts-bigint-route-storage` | bigints in storage with exact wide values, runtime kinds and exception checks | Bigint route contracts; typed paths | 16 | 0 |
| `ts-bigint-route-unions` | unions with number with exact wide values, runtime kinds and exception checks | Bigint route contracts; typed paths | 16 | 0 |
| `ts-builtin-subclass` | a class extending a built-in (Array, Error, Map) | conformance/es6/classDeclaration; typed paths | 76 | 0 |
| `ts-call-route-population` | independent callback targets coexist in one typed registry | typed call routes: Language, Functions; Errors; Async | 12 | 0 |
| `ts-call-route-receiver` | receiver identity and arguments through extracted or stored methods | typed call routes: Language, Functions; Errors; Async | 22 | 0 |
| `ts-call-route-shape` | parameter adaptation across typed variables, fields, arrays and Maps | typed call routes: Language, Functions; Errors; Async | 52 | 0 |
| `ts-call-route-suspension` | async and generator functions called through typed values and fields | typed call routes: Language, Functions; Errors; Async | 20 | 0 |
| `ts-call-route-throw` | exception propagation, rethrow identity and cleanup through typed call routes | typed call routes: Language, Functions; Errors; Async | 28 | 0 |
| `ts-call-signatures` | a call signature in an interface or type literal: a callable object with properties | conformance/types/members; ts-eslint TSCallSignatureDeclaration | 26 | 0 |
| `ts-capture-route-loops` | loops across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 24 | 0 |
| `ts-capture-route-receivers` | this and receivers across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 16 | 0 |
| `ts-capture-route-storage` | storage and nesting across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 22 | 0 |
| `ts-capture-route-suspension` | across await and yield across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 18 | 0 |
| `ts-capture-route-writes` | writes after capture across typed captures with exact node values, order and state | Capture route contracts: Functions, Objects and Async | 24 | 0 |
| `ts-class` | a class declaration or expression | conformance/classes | 1993 | 29 |
| `ts-class-expression` | a class expression, named or anonymous | conformance/classes/classExpressions; conformance/es6/classExpressions | 33 | 0 |
| `ts-class-fields` | instance and static field declarations, with define semantics (`useDefineForClassFields`) | conformance/classes/propertyMemberDeclarations; ts-eslint PropertyDefinition | 1287 | 4 |
| `ts-class-static-block` | a `static { }` block | conformance/classes/classStaticBlock; ts-eslint StaticBlock | 8 | 0 |
| `ts-class-value-route-exposure` | constructor metadata and new.target with exact construction, static observations and identities | Class value route contracts; typed paths | 18 | 0 |
| `ts-class-value-route-factories` | class factories and mixins with exact construction, static observations and identities | Class value route contracts; typed paths | 12 | 0 |
| `ts-class-value-route-selection` | classes selected at runtime with exact construction, static observations and identities | Class value route contracts; typed paths | 14 | 0 |
| `ts-class-value-route-signatures` | construct signatures and generic factories with exact construction, static observations and identities | Class value route contracts; typed paths | 16 | 0 |
| `ts-class-value-route-storage` | class values in storage with exact construction, static observations and identities | Class value route contracts; typed paths | 16 | 0 |
| `ts-closures` | a function or class capturing typed locals | conformance/functions; typed paths | 929 | 1 |
| `ts-builtin-cast` | an own value asserted to a builtin constructor or object type keeps its runtime identity | builtin identity contracts; ts-eslint TSAsExpression | 76 | 0 |
| `ts-builtin-identity` | the declaration or runtime value selects a builtin operation; spelling and asserted types do not establish identity | builtin identity contracts: Builtins, Feature identity; typed paths | 544 | 0 |
| `ts-builtin-invocation` | call and construction preserve argument semantics through typed targets | builtin identity contracts; conformance/expressions/newOperator, callExpressions; typed paths | 60 | 0 |
| `ts-builtin-name` | a typed class, function, object or parameter shadows a builtin name in lexical scope | builtin identity contracts; conformance/classes, functions, internalModules | 300 | 0 |
| `ts-builtin-reflection` | typed values reach builtin identity through Reflect, globalThis or direct-prototype inspection | builtin identity contracts; Language, Boundaries; typed paths | 16 | 0 |
| `ts-builtin-value` | a builtin is called or constructed through typed storage, a parameter, a return, a condition or destructuring | builtin identity contracts; conformance/types/members; typed paths | 32 | 0 |
| `ts-commonjs` | a CommonJS-format TypeScript module | conformance/externalModules | 0 | 5 |
| `ts-computed-keys` | a computed property key in a literal, a class or a type | conformance/es6/computedProperties | 96 | 0 |
| `ts-conditional-types` | a conditional type (`T extends U ? X : Y`), distributive over unions | conformance/types/conditional; ts-eslint TSConditionalType | 5 | 0 |
| `ts-const-enum` | a `const enum` | conformance/constEnums; ts-eslint TSEnumDeclaration (const) | 5 | 1 |
| `ts-const-type-parameters` | a `const` type parameter | conformance/types/typeParameters/typeParameterLists; ts-eslint TSTypeParameter.const | 1 | 0 |
| `ts-construct-signatures` | a construct signature or constructor type (`new () => T`) | conformance/types/members; ts-eslint TSConstructorType, TSConstructSignatureDeclaration | 152 | 0 |
| `ts-contents-enumeration` | typed collection enumeration preserves kinds, order, live mutations, snapshots and grouping | Hashing, Decisions; Map and Set contents contracts | 60 | 0 |
| `ts-contents-keys` | typed collection keys preserve SameValueZero, kind separation and reference identity | Hashing, The design; Map and Set contents contracts | 24 | 0 |
| `ts-contents-representation` | concrete stored values retain their payloads, identities and live contents through wider readers | Language, Types, A type is a layout; typed paths | 44 | 0 |
| `ts-contents-set-methods` | typed Set algebra and predicates observe widened contents and the set-like protocol | Map and Set contents contracts; typed paths | 28 | 0 |
| `ts-contents-widening` | one collection is written and read through different declared, generic or readonly views | Language, Types, Decisions; typed paths | 44 | 0 |
| `ts-conversions` | implicit and explicit conversions of typed values: ToPrimitive, ToNumber, ToString, ToBoolean | conformance/expressions/binaryOperators; conformance/expressions/unaryOperators; typed paths | 1005 | 0 |
| `ts-control-flow-route-finally` | typed completions preserve cleanup order, saved values, overrides and writes observed afterwards | Control-flow route contracts; typed paths | 18 | 0 |
| `ts-control-flow-route-labels` | typed labeled exits preserve loop updates, tests, tails and captured bindings | Control-flow route contracts; typed paths | 18 | 0 |
| `ts-control-flow-route-narrowing` | typed control-flow joins and exits preserve current member kinds, payloads and identities after guards and mutations | Control-flow route contracts; typed paths | 26 | 0 |
| `ts-control-flow-route-short-circuit` | typed short-circuit and evaluation routes preserve skipped effects, references, operands, arguments and computed keys | Control-flow route contracts; typed paths | 26 | 0 |
| `ts-control-flow-route-switch` | typed switches preserve selection, case-search order, fallthrough, exhaustive defaults and exits | Control-flow route contracts; typed paths | 14 | 0 |
| `ts-control-flow-routes` | typed control structures preserve exact values, kinds, identities and complete execution histories beside explicit controls | Control-flow route contracts; typed paths | 102 | 0 |
| `ts-date-route-construction` | typed numeric inputs, Date.UTC components, clipping, astronomical years and optional-argument presence through TypeScript carriers with exact values and observations | Date route contracts; typed paths | 14 | 0 |
| `ts-date-route-setters` | all seven UTC setters, optional components, invalid-state recovery, returned times and retained getter views through TypeScript carriers with exact values and observations | Date route contracts; typed paths | 22 | 0 |
| `ts-date-route-shared` | identity, alias writes, independent copies, generic returns, closures and retained carrier populations through TypeScript carriers with exact values and observations | Date route contracts; typed paths | 16 | 0 |
| `ts-date-route-text` | exact ISO and JSON text, explicit-offset parsing, extended years and shared JSON traversal effects through TypeScript carriers with exact values and observations | Date route contracts; typed paths | 14 | 0 |
| `ts-date-route-time-values` | numeric reads, clipping, fractions, signed zero, comparisons, arithmetic and stable equal-time ordering through TypeScript carriers with exact values and observations | Date route contracts; typed paths | 16 | 0 |
| `ts-date-routes` | fixed UTC Date values, mutation, text and identity across typed routes beside independent numeric controls | Date route contracts; typed paths | 82 | 0 |
| `ts-declaration-merging` | two declarations of one name merged into one entity | conformance/internalModules/DeclarationMerging; conformance/interfaces/declarationMerging | 11 | 5 |
| `ts-declare-field` | a `declare` class field, which emits nothing | conformance/classes/propertyMemberDeclarations; ts-eslint PropertyDefinition.declare | 25 | 0 |
| `ts-decorators` | standard (TC39) decorators on classes, methods, fields, accessors; context, addInitializer, metadata | conformance/esDecorators; ts-eslint Decorator | 0 | 12 |
| `ts-default-parameters` | a parameter with a default value | conformance/es6/defaultParameters | 85 | 0 |
| `ts-definite-assignment` | a definite assignment assertion (`x!: T`, `let x!: T`) | conformance/controlFlow/definiteAssignmentAssertions; ts-eslint PropertyDefinition.definite | 3 | 0 |
| `ts-destructuring` | a typed destructuring declaration, parameter or assignment | conformance/es6/destructuring | 356 | 0 |
| `ts-destructuring-route-arrays` | tuples, arrays, strings and typed iterables retain elision, default, nesting, rest and close behavior through array patterns | BindingInitialization; IteratorBindingInitialization; IteratorClose | 18 | 0 |
| `ts-destructuring-route-assignment` | typed assignment and loop-head patterns retain source identity, target evaluation, writes, rest contents and iterator closing | DestructuringAssignmentEvaluation; IteratorClose | 16 | 0 |
| `ts-destructuring-route-objects` | class, literal, Record and array views retain selected reads, undefined-only defaults, key order and rest exclusions through object patterns | BindingInitialization; CopyDataProperties | 16 | 0 |
| `ts-destructuring-route-order` | defaults, repeated getters and failing typed patterns preserve lazy left-to-right effects, partial writes, cleanup order and original errors | BindingInitialization; IteratorBindingInitialization; IteratorClose | 18 | 0 |
| `ts-destructuring-route-parameters` | typed parameter and callback patterns retain earlier-binding dependencies, receiver data, optional and rest inputs and exact effects | TypeScript Destructuring; BindingInitialization; IteratorBindingInitialization | 20 | 0 |
| `ts-destructuring-routes` | typed binding and assignment patterns retain exact values, rest contents and observable getter, default and iterator histories beside explicit-read controls | Destructuring route contracts; typed paths | 88 | 0 |
| `ts-discriminated-unions` | a union of object types told apart by a literal-typed property | conformance/types/union/discriminatedUnionTypes | 86 | 0 |
| `ts-descriptor-route-accessors` | defined accessors preserve receiver binding, getter-only refusal, setter-only reads and conversion to data properties | Descriptor route contracts; typed paths | 14 | 0 |
| `ts-descriptor-route-defining` | typed definitions preserve data and accessor defaults, descriptor snapshots, permitted redefinitions and exact refusal state | Descriptor route contracts; typed paths | 16 | 0 |
| `ts-descriptor-route-enumerability` | typed hidden properties remain directly readable while enumeration, object copies and object JSON honor enumerable flags | Descriptor route contracts; typed paths | 14 | 0 |
| `ts-descriptor-route-integrity` | typed integrity levels preserve exact predicates, descriptor transitions, permitted writes and TypeError state | Descriptor route contracts; typed paths | 20 | 0 |
| `ts-descriptor-route-writability` | typed writes distinguish compile-time readonly from runtime data flags, inherited restrictions and frozen writable fields | Descriptor route contracts; typed paths | 14 | 0 |
| `ts-dispatch-route-accessors-statics` | accessors and statics with exact targets, receivers, order and state | Dispatch route contracts; typed paths | 18 | 0 |
| `ts-dispatch-route-construction` | construction order with exact targets, receivers, order and state | Dispatch route contracts; typed paths | 10 | 0 |
| `ts-dispatch-route-hierarchies` | class hierarchies with exact targets, receivers, order and state | Dispatch route contracts; typed paths | 16 | 0 |
| `ts-dispatch-route-interfaces` | interfaces with exact targets, receivers, order and state | Dispatch route contracts; typed paths | 18 | 0 |
| `ts-dispatch-route-method-values` | method values and mixins with exact targets, receivers, order and state | Dispatch route contracts; typed paths | 24 | 0 |
| `ts-dynamic-import` | a dynamic `import()` of a typed module | conformance/dynamicImport | 0 | 1 |
| `ts-enum-computed` | an enum member whose initialiser is an expression, constant or not | conformance/enums | 26 | 0 |
| `ts-enum-reverse-mapping` | a numeric enum member's value mapped back to its name | conformance/enums | 15 | 0 |
| `ts-enum` | an `enum` declaration and its object | conformance/enums; ts-eslint TSEnumDeclaration | 73 | 3 |
| `ts-enum-route-literal-members` | member unions and discriminants, exhaustive switches, comparison narrowing and const-enum values through interfaces and generic helpers with exact values and observations | Enum route contracts; typed paths | 16 | 0 |
| `ts-enum-route-numeric` | implicit, explicit and computed numeric members, alias reverse mappings and initialization timing across fields, returns, tuples and generics with exact values and observations | Enum route contracts; typed paths | 18 | 0 |
| `ts-enum-route-string-heterogeneous` | string and mixed member values, absent string reverse mappings, comparison branches and enum-valued Record and Map keys with exact values and observations | Enum route contracts; typed paths | 16 | 0 |
| `ts-enum-routes` | enum values, reverse mappings, object data and merged declarations through typed routes beside explicit member and reverse-map controls | Enum route contracts; typed paths | 50 | 0 |
| `ts-enum-string` | a string-valued enum member | conformance/enums | 28 | 0 |
| `ts-equality-route-loose` | loose equality with complete mixed-kind tables, hook histories and exact results | Equality route contracts; typed paths | 16 | 0 |
| `ts-equality-route-relational` | relational comparisons with complete mixed-kind tables, hook histories and exact results | Equality route contracts; typed paths | 16 | 0 |
| `ts-equality-route-searching` | SameValueZero and searching with complete mixed-kind tables, hook histories and exact results | Equality route contracts; typed paths | 18 | 0 |
| `ts-equality-route-sorting` | sorting and ordering with complete mixed-kind tables, hook histories and exact results | Equality route contracts; typed paths | 14 | 0 |
| `ts-equality-route-strict` | strict equality and SameValue with complete mixed-kind tables, hook histories and exact results | Equality route contracts; typed paths | 16 | 0 |
| `ts-errors` | exceptions in typed code: `catch` bindings typed `unknown`, Error subclasses, finally | conformance/statements/tryStatements; typed paths | 859 | 0 |
| `ts-expando` | properties assigned to a function declaration (an expando) | conformance/functions (expando assignments, TypeScript 3.1) | 1 | 0 |
| `ts-exponent` | the `**` operator and `**=` | conformance/es7/exponentiationOperator | 3 | 0 |
| `ts-export-equals` | `export =` | conformance/externalModules; ts-eslint TSExportAssignment | 0 | 4 |
| `ts-exports` | export declarations, lists, renames and defaults, read back within the module | conformance/externalModules; conformance/es6/modules; ts-eslint ExportNamedDeclaration | 10 | 3 |
| `ts-expressions` | ordinary operators in typed code: increments, comma, void, delete, in | conformance/expressions | 415 | 0 |
| `ts-function-object-route-arguments` | typed non-arrow functions preserve argument counts and values, independent parameter writes, retained objects and forwarded argument lists | Function object route contracts; typed paths | 18 | 0 |
| `ts-function-object-route-bind` | typed bound functions retain the first receiver, prepend arguments in order, reduce arity to zero and preserve bound names and constructor behavior | Function object route contracts; typed paths | 16 | 0 |
| `ts-function-object-route-call-apply` | typed call and apply routes preserve receiver identity, complete argument order, return values and caught errors | Function object route contracts; typed paths | 18 | 0 |
| `ts-function-object-route-defaults-rest` | typed parameter routes preserve lazy per-call defaults, earlier parameter dependencies, exact rest arrays and spread argument order | Function object route contracts; typed paths | 20 | 0 |
| `ts-function-object-route-length-name` | typed function values preserve exact declared and inferred names, accessor prefixes and parameter counts before defaults or rest | Function object route contracts; typed paths | 22 | 0 |
| `ts-function-types` | a function type (`(x: T) => U`) for a parameter, field or type argument | conformance/types/members; ts-eslint TSFunctionType | 1016 | 0 |
| `ts-functions` | function declarations, expressions and calls in typed code | conformance/functions; conformance/es6/functionDeclarations | 5280 | 4 |
| `ts-generators` | a generator function or method, typed `Generator<T, TReturn, TNext>` | conformance/generators; conformance/es6/yieldExpressions | 135 | 0 |
| `ts-generic-constraints` | a type parameter's constraint (`<T extends C>`) | conformance/types/typeParameters/typeArgumentLists; ts-eslint TSTypeParameter.constraint | 348 | 0 |
| `ts-generic-defaults` | a type parameter's default (`<T = number>`) | conformance/types/typeParameters/typeParameterLists | 10 | 0 |
| `ts-generic-route-callbacks` | generic interfaces, stored callbacks and generic methods preserve call arguments, results, identities and receiver state | TypeScript Generic Types; Function Type Expressions | 8 | 0 |
| `ts-generic-route-classes` | generic class fields and methods preserve values across instantiations, aliases, inheritance, initialization and shared static state | TypeScript Generic Classes; Objects, Classes | 28 | 0 |
| `ts-generic-route-containers` | array, Map and Set contents and callbacks preserve values across generic writer and reader instantiations | TypeScript Generics; Array, Map and Set objects | 18 | 0 |
| `ts-generic-route-functions` | multiple generic function instantiations preserve payloads through arguments, tuples, defaults, constraints, nested calls and recursion | TypeScript Generics; Language, Types | 20 | 0 |
| `ts-generic-route-narrowing` | union, unknown, constrained and conditional instantiations preserve runtime payloads through guards and resolved shapes | TypeScript Narrowing; Generic Constraints; Conditional Types | 10 | 0 |
| `ts-generic-routes` | stored, returned and compared values preserve their runtime representation across generic instantiations and handwritten concrete controls | Generic route contracts; typed paths | 84 | 0 |
| `ts-generics` | type parameters on a function, class, method or interface | conformance/types/typeParameters; ts-eslint TSTypeParameter | 838 | 0 |
| `ts-implicit-accessor` | implicit getter and setter calls through typed views, with exact order and visible effects | implicit call contracts: Objects; Language; typed paths | 138 | 0 |
| `ts-implicit-conversion` | implicit valueOf, toString and Symbol.toPrimitive calls through typed views, with exact order and visible effects | implicit call contracts: Objects; Language; typed paths | 114 | 0 |
| `ts-implicit-iteration` | implicit iterator acquisition, stepping and closing through typed views, with exact order and visible effects | implicit call contracts: Objects; Language; typed paths | 60 | 0 |
| `ts-implicit-json` | implicit toJSON calls through typed views, including key arguments and replacer order | implicit call contracts: Objects; Language; typed paths | 24 | 0 |
| `ts-implicit-order` | ordered effects across several implicit calls in one typed expression or protocol operation | implicit call contracts: Objects; Language; typed paths | 18 | 0 |
| `ts-implicit-thenable` | implicit class then calls through typed views, including queued resolution and rejection effects | implicit call contracts: Objects; Language; typed paths | 12 | 0 |
| `ts-import-alias` | `import X = N.Y`, an alias for a namespace or a value it exports (`export import` too) | conformance/internalModules/importDeclarations; ts-eslint TSImportEqualsDeclaration | 3 | 0 |
| `ts-import-require` | `import x = require("...")` | conformance/externalModules; ts-eslint TSImportEqualsDeclaration, TSExternalModuleReference | 0 | 5 |
| `ts-import-type` | `import type` and TypeScript's elision of imports used only as types | conformance/externalModules/typeOnly; ts-eslint ImportDeclaration.importKind | 0 | 2 |
| `ts-imports` | import declarations between modules: named, default, namespace, side-effect, cycles | conformance/externalModules; conformance/es6/modules | 0 | 9 |
| `ts-index-signatures` | an index signature (`[key: string]: T`) on a type, interface or class | conformance/classes/indexMemberDeclarations; ts-eslint TSIndexSignature | 168 | 0 |
| `ts-indexed-access` | an indexed access type (`T[K]`) | conformance/types/keyof; ts-eslint TSIndexedAccessType | 21 | 0 |
| `ts-infer` | `infer` in a conditional type | conformance/types/conditional; ts-eslint TSInferType | 1 | 0 |
| `ts-inheritance` | `extends` between classes: super calls, super property access, the prototype chain | conformance/classes/classDeclarations/classHeritageSpecification; conformance/expressions/superCalls | 439 | 3 |
| `ts-instanceof` | `instanceof`, and narrowing by it | conformance/expressions/typeGuards/typeGuardsWithInstanceOf | 476 | 0 |
| `ts-instantiation-expression` | an instantiation expression (`f<number>`), erased | conformance/types/typeParameters/typeArgumentLists/instantiationExpressions; ts-eslint TSInstantiationExpression | 1 | 0 |
| `ts-integer-route-bitwise` | bitwise operators with exact numeric stages and representations | Integer route contracts; typed paths | 20 | 0 |
| `ts-integer-route-counters` | counters and sums with exact numeric stages and representations | Integer route contracts; typed paths | 14 | 0 |
| `ts-integer-route-mixed` | mixed integer routes with exact numeric stages and representations | Integer route contracts; typed paths | 12 | 0 |
| `ts-integer-route-rounding` | rounding and division with exact numeric stages and representations | Integer route contracts; typed paths | 18 | 0 |
| `ts-integer-route-typed-arrays` | typed-array storage with exact numeric stages and representations | Integer route contracts; typed paths | 10 | 0 |
| `ts-interface-extends` | an interface extending interfaces or a class | conformance/interfaces/interfaceDeclarations; conformance/interfaces/interfacesExtendingClasses; ts-eslint TSInterfaceHeritage | 16 | 0 |
| `ts-interfaces` | an interface, implemented by a class or satisfied by a literal | conformance/interfaces; ts-eslint TSInterfaceDeclaration | 1783 | 0 |
| `ts-intersections` | an intersection type (`A & B`) and values of it | conformance/types/intersection; ts-eslint TSIntersectionType | 18 | 0 |
| `ts-iteration` | the iteration protocols in typed code: Iterable, Iterator, for-of, spread, destructuring | conformance/es6/for-ofStatements; conformance/types/forAwait; lib.es2015.iterable.d.ts | 4896 | 0 |
| `ts-iterator-route-builtins` | builtin iterables through typed routes with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 42 | 0 |
| `ts-iterator-route-early-exit` | early exit with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 18 | 0 |
| `ts-iterator-route-generators` | generators with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 18 | 0 |
| `ts-iterator-route-mutation` | iterating while changing with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 18 | 0 |
| `ts-iterator-route-user-iterables` | user iterables with exact protocol order, arguments, values and state | Iterator route contracts: ECMAScript iteration and generators; typed paths | 22 | 0 |
| `ts-json-replacers` | typed replacers, toJSON methods and space arguments preserve callback observations, selected keys and exact formatting | JSON.stringify; SerializeJSONProperty; SerializeJSONObject; SerializeJSONArray | 20 | 0 |
| `ts-json-revivers` | declared reviver function routes preserve complete ordered key, value and holder observations through deletion and replacement | JSON.parse; InternalizeJSONProperty | 16 | 0 |
| `ts-json-routes` | JSON values preserve exact parsed contents, serialization and callback observations across typed routes | JSON route contracts; typed paths | 110 | 0 |
| `ts-json-shapes` | matching JSON enters an annotated interface, field type, tuple, generic or union with exact leaf values and key order | Language, Types, Decisions; JSON.parse | 30 | 0 |
| `ts-json-stringify` | declared classes, interfaces and unions serialize with exact conversion, omission, escaping and error behavior | JSON.stringify; SerializeJSONProperty; QuoteJSONString | 74 | 0 |
| `ts-json-unknown` | unknown JSON results are truthfully narrowed before duplicate-key, ordering, nesting and whitespace observations | JSON route contracts; ParseJSON; OrdinaryOwnPropertyKeys | 12 | 0 |
| `ts-jsx` | JSX in a `.tsx` file, compiled to factory calls | conformance/jsx; ts-eslint JSX nodes | 0 | 6 |
| `ts-keyof` | `keyof T`, and values of that type | conformance/types/keyof; ts-eslint TSTypeOperator | 56 | 0 |
| `ts-layout-route-builtins` | Error, Map, Set, Array and Promise subclasses preserve own payloads, constructor-write histories and returned species through builtin views | Error, Map and Set constructors; ArraySpeciesCreate; Promise.prototype.then | 14 | 0 |
| `ts-layout-route-presence` | three class layouts retain exact own-field presence and order across declaration forms, enumeration, spread and JSON | Type-only Field Declarations; Initialization Order; OrdinaryOwnPropertyKeys | 16 | 0 |
| `ts-layout-route-state` | private slots and brands, methods and accessors, inherited references and shadowed static fields preserve exact state across typed routes | TypeScript Classes; Static Members; PrivateGet | 16 | 0 |
| `ts-layout-route-storage` | added, shared and redeclared subclass fields cross base-typed fields, arrays, Maps and closures with bidirectional alias writes | TypeScript Classes; InitializeInstanceElements | 8 | 0 |
| `ts-layout-route-structural` | class instances and class-shaped literals retain exact data and identities across smaller structural views, generics and object narrowing | TypeScript Relationships Between Classes; in-operator Narrowing | 16 | 0 |
| `ts-layout-routes` | class data retains exact fields, presence, order, identity and alias writes across typed layout routes beside explicit plain-object controls | Layout route contracts; typed paths | 70 | 0 |
| `ts-legacy-decorators` | `experimentalDecorators`: class, method, property, accessor and parameter decorators | conformance/decorators | 0 | 8 |
| `ts-length-route-callbacks` | callbacks that change the array with complete indexed histories and final contents | Length route contracts; typed paths | 20 | 0 |
| `ts-length-route-indices` | indices at the edges with complete indexed histories and final contents | Length route contracts; typed paths | 16 | 0 |
| `ts-length-route-loops` | loops that change their own array with complete indexed histories and final contents | Length route contracts; typed paths | 24 | 0 |
| `ts-length-route-shared` | shared arrays with complete indexed histories and final contents | Length route contracts; typed paths | 16 | 0 |
| `ts-length-route-typed-arrays` | typed arrays and resizable buffers with complete indexed histories and final contents | Length route contracts; typed paths | 16 | 0 |
| `ts-lifetime-acyclic` | a construction route closes a cycle that an acyclicity proof must include | lifetime contracts: Memory, How small the dynamic part can get; Cycles through foreign objects | 24 | 0 |
| `ts-lifetime-borrow` | a borrowed reference remains live after its original anchor or read-only call ends | lifetime contracts: Memory, Where nts stands; The ladder of homes; record 0024 | 24 | 0 |
| `ts-lifetime-frame` | an object or bounded string must outlive a frame after a retention route acts | lifetime contracts: Memory, The ladder of homes; Where nts stands | 28 | 0 |
| `ts-lifetime-in-place` | a retained old value remains observable during or after a string append or immutable update | lifetime contracts: Memory, The design, Principles and What it unlocks; record 0029 | 24 | 0 |
| `ts-lifetime-move` | a last-use transfer must preserve a reference still reachable through another route | lifetime contracts: Memory, Where nts stands; The ladder of homes; record 0024 | 25 | 0 |
| `ts-lifetime-region` | a reference remains reachable after the original call result reaches its last use | lifetime contracts: Memory, The ladder of homes; Resetting a region is safe only if nothing can still walk into it; A region needs two proofs | 25 | 0 |
| `ts-lifetime-scalar` | an object initially used through fields gains an observable identity or shared mutation | lifetime contracts: Memory, Where nts stands; The ladder of homes | 20 | 0 |
| `ts-lifetime-slot` | successive loop allocations remain distinct when their live instances overlap | lifetime contracts: Memory, Where nts stands; The one memory analysis | 18 | 0 |
| `ts-literal-types` | string, number and boolean literal types and the values they admit | conformance/types/literal; conformance/types/stringLiteral; ts-eslint TSLiteralType | 187 | 0 |
| `ts-map-set` | `Map<K, V>` and `Set<T>` in typed code | typed paths | 888 | 0 |
| `ts-map-set-contents` | Map and Set contents keep their values, runtime kinds and order across typed writes and reads | Map and Set contents contracts; typed paths | 200 | 0 |
| `ts-mapped-types` | a mapped type (`{ [K in keyof T]: U }`), with modifiers and `as` remapping | conformance/types/mapped; ts-eslint TSMappedType | 24 | 0 |
| `ts-math-route-extremes` | signed-zero orders, NaN positions, empty and spread extrema, absolute magnitude and prescribed hypot special values with exact values and observations | Math route contracts; typed paths | 16 | 0 |
| `ts-math-route-integer-conversions` | wrapped integer operands, masked shift counts, low-word products and comparisons with truncation across typed carriers with exact values and observations | Math route contracts; typed paths | 20 | 0 |
| `ts-math-route-powers-roots` | pow and exponentiation special cases, correctly rounded square roots and prescribed root, exponential and logarithmic values with exact values and observations | Math route contracts; typed paths | 20 | 0 |
| `ts-math-route-rounding` | halves, signed zero, binary64 integer boundaries and binary32 ties, underflow and overflow through numeric inputs and returns with exact values and observations | Math route contracts; typed paths | 16 | 0 |
| `ts-math-route-trigonometry` | prescribed signed zeros, infinities, NaN and domain errors through unary trigonometric functions and exact atan2 branches with exact values and observations | Math route contracts; typed paths | 26 | 0 |
| `ts-math-routes` | specification-fixed Math and integer-conversion results across typed routes beside operation-free table controls | Math route contracts; typed paths | 98 | 0 |
| `ts-mixins` | a function returning a subclass of the class it is given | conformance/classes/mixinClassesAndInterfaces | 14 | 0 |
| `ts-modules` | an ES module (the `module` flag): module scope, strictness, top-level await | conformance/externalModules; conformance/es6/modules | 414 | 10 |
| `ts-namespace` | a namespace (internal module) and its object | conformance/internalModules; ts-eslint TSModuleDeclaration | 88 | 6 |
| `ts-narrowing` | control-flow narrowing of a union or `unknown` | conformance/controlFlow; conformance/expressions/typeGuards | 727 | 0 |
| `ts-never` | the `never` type: an unreachable value or a function that does not return | conformance/types/never | 19 | 0 |
| `ts-new-target` | `new.target` | conformance/es6/newTarget | 83 | 0 |
| `ts-non-null` | a non-null assertion (`x!`), erased, never a check | conformance/expressions (non-null assertions); ts-eslint TSNonNullExpression | 5 | 0 |
| `ts-null-undefined` | `null`, `undefined` and `T | undefined` under strictNullChecks | conformance/types/primitives; typed paths | 1691 | 0 |
| `ts-number-format-route-fixed-notation` | binary-value rounding and ties, exact fixed digits, signed zero, exponent fallback and digit-count validation through typed numbers with exact values and observations | Number-format route contracts; typed paths | 18 | 0 |
| `ts-number-format-route-partial-parsing` | longest valid prefixes, optional and wrapped radices, signed zero and explicit number-to-text pipelines through typed parser inputs with exact values and observations | Number-format route contracts; typed paths | 20 | 0 |
| `ts-number-format-route-precision-exponent` | significant digits, exponent carries, padding, omitted arguments and range precedence through generic and interface routes with exact values and observations | Number-format route contracts; typed paths | 20 | 0 |
| `ts-number-format-route-radix` | uniquely specified shortest text, notation thresholds, every integer radix and radix validation through tuple, union and generic operands with exact values and observations | Number-format route contracts; typed paths | 18 | 0 |
| `ts-number-format-route-string-to-number` | complete numeric-string grammars, Unicode whitespace, signed zeros and rounded limits through string, union and arithmetic routes with exact values and observations | Number-format route contracts; typed paths | 16 | 0 |
| `ts-number-format-routes` | specification-fixed formatting and parsing across typed inputs beside operation-free table controls | Number-format route contracts; typed paths | 92 | 0 |
| `ts-number-route-division` | division and remainder across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 16 | 0 |
| `ts-number-route-integers` | integers that stop being integers across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 48 | 0 |
| `ts-number-route-strings` | conversions to and from strings across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 40 | 0 |
| `ts-number-route-types` | numbers in unions, enums and generics across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 14 | 0 |
| `ts-number-route-zero-nan` | signed zero and nan across typed numeric carriers with exact node values | Numeric route contracts: Language and Foundations, Numbers | 22 | 0 |
| `ts-numbers` | IEEE doubles in typed code: fractions, -0, NaN, int32 operators, formatting | conformance/types/primitives/number; typed paths | 3572 | 0 |
| `ts-object-route-key-order` | typed object enumeration preserves numeric ordering, string insertion histories, getter effects and symbol omission | Object route contracts; typed paths | 14 | 0 |
| `ts-object-route-presence` | typed optional and index properties preserve absent-versus-undefined membership, deletion and narrowing | Object route contracts; typed paths | 16 | 0 |
| `ts-object-route-spread-rest` | typed spread and rest copy own enumerable string and symbol values once in order into plain data properties | Object route contracts; typed paths | 18 | 0 |
| `ts-object-route-statics` | typed object statics preserve setters, entry construction, integrity failures and own-key observations | Object route contracts; typed paths | 20 | 0 |
| `ts-object-route-views` | one object preserves identity, writes, accessors and ordered shape across simultaneous typed views | Object route contracts; typed paths | 16 | 0 |
| `ts-object-routes` | typed object operations preserve ordered shapes, exact values, presence, identity and accessor histories beside explicit controls | Object route contracts; typed paths | 84 | 0 |
| `ts-object-type` | the non-primitive `object` type | conformance/types/nonPrimitive; ts-eslint TSObjectKeyword | 20 | 0 |
| `ts-objects` | object literals and object types: properties, methods, keys, copies | conformance/expressions/objectLiterals; conformance/types/objectTypeLiteral; ts-eslint TSTypeLiteral | 2933 | 0 |
| `ts-optional-chaining` | `?.` on properties, calls and elements, in typed code | conformance/expressions/optionalChaining | 44 | 0 |
| `ts-optional-parameters` | a parameter marked `?` | conformance/functions; conformance/types/members | 67 | 0 |
| `ts-optional-properties` | a property marked `?` in a type, a class or an interface | conformance/types/members; conformance/types/objectTypeLiteral | 251 | 0 |
| `ts-overloads` | overload signatures on a function, method or constructor | conformance/functions/functionOverloads; ts-eslint TSDeclareFunction, TSEmptyBodyFunctionExpression | 35 | 0 |
| `ts-override` | the `override` modifier on a method, accessor or field | conformance/override; ts-eslint MethodDefinition.override | 167 | 0 |
| `ts-parameter-properties` | a constructor parameter with a modifier, which declares and assigns a field | conformance/classes/constructorDeclarations; ts-eslint TSParameterProperty | 15 | 0 |
| `ts-private-fields` | ECMAScript `#private` fields, methods and accessors | conformance/classes/members/privateNames | 19 | 2 |
| `ts-private-keyword` | the `private` modifier, a compile-time check over an ordinary property | conformance/classes/members/accessibility; ts-eslint TSPrivateKeyword | 9 | 0 |
| `ts-proof-bounds` | an index proved in range before a route changes the index or the container | proof contracts: Objects, Arrays; Numbers, Integers proved from doubles | 166 | 0 |
| `ts-proof-call-target` | a known receiver or closure target changes before a dispatch or specialized call | proof contracts: Objects, Calls and Functions as values; Language, Functions | 89 | 0 |
| `ts-proof-capture` | a write invalidates copying a captured binding instead of sharing its cell | proof contracts: Objects, Functions as values; Language, Functions | 65 | 0 |
| `ts-proof-element-kind` | a non-integer store invalidates a whole-program integer element kind | proof contracts: Objects, Arrays; Numbers, Integers proved from doubles | 151 | 0 |
| `ts-proof-length` | an allocation or guard proves a length before a route changes it | proof contracts: Objects, Arrays | 82 | 0 |
| `ts-proof-negative-zero` | a zero sign becomes observable after a route invalidates its omission | proof contracts: Numbers, Integers proved from doubles; Language, Numbers | 63 | 0 |
| `ts-proof-whole-number` | a whole finite value in range loses its integer representation proof | proof contracts: Numbers, Integers proved from doubles; Language, Numbers | 89 | 0 |
| `ts-protected` | the `protected` modifier | conformance/classes/members/accessibility; ts-eslint TSProtectedKeyword | 1 | 0 |
| `ts-readonly` | `readonly` properties, arrays and tuples, which are not frozen | conformance/types/tuple/readonlyArraysAndTuples; ts-eslint TSReadonlyKeyword | 376 | 0 |
| `ts-record` | `Record<K, V>` | conformance/types/mapped; lib | 291 | 0 |
| `ts-record-copies` | spread, assign, entry construction and cloning preserve values, ordering and specified copy or alias relationships across views | CopyDataProperties; Object.assign; Object.fromEntries; HTML structured cloning | 16 | 0 |
| `ts-record-mapped` | utility types and generic keyof routes preserve actual field presence, values, ordering and alias mutation | TypeScript utility types; Objects, Interfaces; typed paths | 14 | 0 |
| `ts-record-mutations` | deletion, additions, reinsertion and object integrity preserve exact shapes and values through Record views | OrdinaryDelete; OrdinaryOwnPropertyKeys; Object.freeze; Object.seal | 20 | 0 |
| `ts-record-parameters` | Record and index-signature parameters preserve computed reads, complete enumeration and caller-visible writes | Objects, Interfaces; typed paths | 22 | 0 |
| `ts-record-routes` | objects preserve exact values, membership, enumeration order and alias writes across fixed-field and table views | Record route contracts; typed paths | 88 | 0 |
| `ts-record-unknown` | unknown-held objects reach checked Record or interface views with exact contents and aliases | Objects, Dynamic values; TypeScript narrowing | 16 | 0 |
| `ts-regexp-route-match-results` | typed nullable match results preserve exact captures, named groups, indices, metadata and retained values | RegExp route contracts; typed paths | 18 | 0 |
| `ts-regexp-route-runtime-patterns` | typed runtime pattern and flag inputs preserve construction, escaping, source metadata, independent copies and SyntaxError exits | RegExp route contracts; typed paths | 18 | 0 |
| `ts-regexp-route-stateful` | typed RegExp aliases preserve global and sticky cursor histories, empty matches, resets and mixed-method state | RegExp route contracts; typed paths | 20 | 0 |
| `ts-regexp-route-string-operations` | typed string and RegExp routes preserve replacements, callback arguments, split captures, search state and matchAll iterators | RegExp route contracts; typed paths | 24 | 0 |
| `ts-regexp-route-unicode` | typed Unicode RegExp routes preserve code-point matching, UTF-16 positions, folding, property sets and lookbehind captures | RegExp route contracts; typed paths | 16 | 0 |
| `ts-regexp-routes` | typed RegExp operations preserve exact results, state, string effects, Unicode behavior and construction beside direct controls | RegExp route contracts; typed paths | 96 | 0 |
| `ts-rest-parameters` | a rest parameter, typed as an array or a tuple | conformance/es6/restParameters | 99 | 0 |
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
| `ts-route-loop` | a back edge, nested loop or loop exit carries a change to a later use | proof contracts: Numbers, Integers proved from doubles; conformance/statements | 112 | 0 |
| `ts-route-merge` | paths with different facts join before the value is used | proof contracts: Numbers, Integers proved from doubles; conformance/controlFlow | 85 | 0 |
| `ts-route-re-entry` | a callback re-enters a function while an earlier activation still uses a value | lifetime contracts: Memory, The one memory analysis | 15 | 0 |
| `ts-route-return-chain` | a value is retained after returning through many distinct functions | lifetime contracts: Memory, The one memory analysis | 16 | 0 |
| `ts-route-suspension` | yield or await lets other code change a proved value before resumption | proof contracts: Objects, Functions as values; conformance/generators; conformance/async | 44 | 0 |
| `ts-route-throw` | a thrown value or finally block carries a reference past unwinding | lifetime contracts: Memory, The one memory analysis | 16 | 0 |
| `ts-route-yield` | a suspended generator keeps a local reference until resumption | lifetime contracts: Memory, The one memory analysis | 12 | 0 |
| `ts-satisfies` | the `satisfies` operator, which leaves its value and the value's type alone | conformance/expressions/typeSatisfaction; ts-eslint TSSatisfiesExpression | 5 | 0 |
| `ts-scope-route-bindings` | reads and writes by binding kind with exact values, identities and read/write order | Scope route contracts; typed paths | 24 | 0 |
| `ts-scope-route-control-flow` | top-level control flow with exact values, identities and read/write order | Scope route contracts; typed paths | 16 | 0 |
| `ts-scope-route-initialization` | initialization order with exact values, identities and read/write order | Scope route contracts; typed paths | 16 | 0 |
| `ts-scope-route-readers` | class and builtin readers with exact values, identities and read/write order | Scope route contracts; typed paths | 20 | 0 |
| `ts-scope-route-typed` | generic and typed bindings with exact values, identities and read/write order | Scope route contracts; typed paths | 14 | 0 |
| `ts-sort-route-comparators` | typed comparator routes preserve sign, NaN equality and stable order through captures, methods, generic factories and stored functions | Sort route contracts; typed paths | 18 | 0 |
| `ts-sort-route-default` | typed arrays of values preserve UTF-16 default order, stable equal string forms, undefined, holes and copy identity | Sort route contracts; typed paths | 12 | 0 |
| `ts-sort-route-edges` | typed sort routes preserve exception identity, unchanged sources on comparator throws, aliases, frozen write failures and readonly copies | Sort route contracts; typed paths | 10 | 0 |
| `ts-sort-route-stability` | typed records, tuples and class instances preserve original positions for equal keys and across successive key sorts | Sort route contracts; typed paths | 8 | 0 |
| `ts-sort-route-typed-arrays` | typed-array sorts preserve numeric defaults, signed zero, NaN, stable custom keys, independent copies and shared subarray writes | Sort route contracts; typed paths | 44 | 0 |
| `ts-spread` | spread and rest of objects and arrays in typed code | conformance/types/spread; conformance/es6/spread | 471 | 1 |
| `ts-static` | static fields, methods and accessors | conformance/classes/propertyMemberDeclarations; ts-eslint TSStaticKeyword | 198 | 4 |
| `ts-string-route-building` | building strings across typed string carriers with exact node values | String route contracts: Foundations, Strings and Unicode | 32 | 0 |
| `ts-string-route-comparing` | comparing and normalizing across typed string carriers with exact node values | String route contracts: Foundations, Strings and Unicode | 28 | 0 |
| `ts-string-route-searching` | searching and splitting across typed string carriers with exact node values | String route contracts: Foundations, Strings and Unicode | 28 | 0 |
| `ts-string-route-slicing` | slicing and indexing across typed string carriers with exact node values | String route contracts: Foundations, Strings and Unicode | 20 | 0 |
| `ts-string-route-types` | strings in unions, literals and generics across typed string carriers with exact node values | String route contracts: Foundations, Strings and Unicode | 14 | 0 |
| `ts-strings` | strings in typed code: UTF-16 length and indexing against code points | conformance/types/primitives/string; typed paths | 2689 | 0 |
| `ts-structural-typing` | a value accepted for its shape, not its declared name: literals and classes that never say `implements` | conformance/types/typeRelationships; typed paths | 80 | 0 |
| `ts-structuredclone-route-buffers` | typed buffer clones preserve bytes, values, view windows, shared storage and transfer detachment | Structured clone route contracts; typed paths | 32 | 0 |
| `ts-structuredclone-route-classes` | class clones yield plain own data with private slots and inherited behavior omitted and own getters read once | Structured clone route contracts; typed paths | 14 | 0 |
| `ts-structuredclone-route-collections` | typed collection clones preserve order, times, deep identities, shared parts and cycles | Structured clone route contracts; typed paths | 10 | 0 |
| `ts-structuredclone-route-errors` | typed unsupported values throw DataCloneError while supported values and errors preserve specified clone state | Structured clone route contracts; typed paths | 18 | 0 |
| `ts-structuredclone-route-plain-data` | typed plain clones preserve SameValue payloads, key order, holes, fresh nodes, shared references and cycles | Structured clone route contracts; typed paths | 14 | 0 |
| `ts-symbol-route-copying` | typed spread and assign copy own enumerable symbol identities, retain overwrite positions and keep later writes independent | Symbol route contracts; typed paths | 14 | 0 |
| `ts-symbol-route-keys` | typed symbol keys preserve identity, independent reads and writes, presence and own versus inherited membership | Symbol route contracts; typed paths | 16 | 0 |
| `ts-symbol-route-listing` | typed mixed-key listings preserve order, exclude symbols from string enumeration and JSON, and include hidden own symbols | Symbol route contracts; typed paths | 16 | 0 |
| `ts-symbol-route-values` | typed symbol values preserve descriptions, explicit strings, registry identity and collection membership, with admitted conversion errors | Symbol route contracts; typed paths | 20 | 0 |
| `ts-symbol-route-well-known` | typed well-known symbols dispatch tags, instanceof, concat spreading and primitive conversion with exact hints and receivers | Symbol route contracts; typed paths | 24 | 0 |
| `ts-symbols` | symbols as keys, well-known symbols, `unique symbol` | conformance/Symbols; conformance/es6/Symbols; conformance/types/uniqueSymbol | 403 | 2 |
| `ts-tagged-templates` | a tagged template with a typed tag function | conformance/es6/templates | 28 | 0 |
| `ts-template-literal-types` | a template literal type, and the intrinsic string types (Uppercase, Capitalize, ...) | conformance/types/literal/templateLiteralTypes; ts-eslint TSTemplateLiteralType | 12 | 0 |
| `ts-template-literals` | template literal expressions and their substitutions | conformance/es6/templates | 138 | 0 |
| `ts-template-route-escapes-raw` | exact cooked/raw escapes, invalid cooked entries and String.raw interleaving through typed tags and raw-array views with exact values and observations | Template route contracts; typed paths | 20 | 0 |
| `ts-template-route-identity` | one frozen template object per site across callers, iterations, closures and instances, with Map and WeakMap retention with exact values and observations | Template route contracts; typed paths | 16 | 0 |
| `ts-template-route-nesting-composition` | nested templates and typed tags returning objects, numbers, functions or tags preserve values and side-effect order with exact values and observations | Template route contracts; typed paths | 16 | 0 |
| `ts-template-route-substitutions` | primitive and array substitutions, conversion hints, ordinary fallback and abrupt conversion through fields, returns, unions and generics with exact values and observations | Template route contracts; typed paths | 18 | 0 |
| `ts-template-route-tag-functions` | typed tags preserve frozen cooked/raw arrays, unconverted substitutions, call order and method receivers with exact values and observations | Template route contracts; typed paths | 16 | 0 |
| `ts-template-routes` | template substitutions, tag calls, site identity and raw text through typed routes beside explicit string and array controls | Template route contracts; typed paths | 86 | 0 |
| `ts-this` | `this` in methods, arrow fields and detached calls | conformance/expressions/thisKeyword | 300 | 1 |
| `ts-this-parameter` | a `this` parameter, which is erased | conformance/types/thisType; conformance/functions | 242 | 0 |
| `ts-this-type` | the polymorphic `this` type | conformance/types/thisType | 4 | 0 |
| `ts-throw-route-async` | exception identity and ordered effects across awaited typed calls and promise routes | typed throw routes: Errors; Functions; Async; Objects, Calls | 24 | 0 |
| `ts-throw-route-call` | exception identity, arguments and cleanup across typed calls | typed throw routes: Errors; Functions; Async; Objects, Calls | 28 | 0 |
| `ts-throw-route-construction` | exceptions crossing typed construction and initialization without a completed instance escaping | typed throw routes: Errors; Functions; Async; Objects, Calls | 10 | 0 |
| `ts-throw-route-implicit` | exception identity and cleanup across typed implicit hooks and collection callbacks | typed throw routes: Errors; Functions; Async; Objects, Calls | 36 | 0 |
| `ts-throw-route-iteration` | exception identity, precedence and cleanup across typed iteration and generator routes | typed throw routes: Errors; Functions; Async; Objects, Calls | 24 | 0 |
| `ts-throw-route-unwind` | exception replacement, rethrow identity and ordered cleanup across typed routes | typed throw routes: Errors; Functions; Async; Objects, Calls | 16 | 0 |
| `ts-to-primitive` | an object converted to a primitive: `valueOf`, `toString`, `Symbol.toPrimitive` | typed paths | 298 | 0 |
| `ts-to-string` | an object converted to a string by its `toString` | typed paths | 126 | 0 |
| `ts-tuple-labels` | a labelled tuple element (`[start: number]`) | conformance/types/tuple/named; ts-eslint TSNamedTupleMember | 14 | 0 |
| `ts-tuple-optional` | an optional tuple element (`[a, b?]`) | conformance/types/tuple; ts-eslint TSOptionalType | 21 | 0 |
| `ts-tuple-rest` | a rest element in a tuple, leading, middle or trailing | conformance/types/tuple; ts-eslint TSRestType | 12 | 0 |
| `ts-tuples` | a tuple type and the array that carries it | conformance/types/tuple; ts-eslint TSTupleType | 1343 | 0 |
| `ts-type-aliases` | a `type` alias, generic or recursive | conformance/types/typeAliases; ts-eslint TSTypeAliasDeclaration | 1143 | 0 |
| `ts-type-assertions` | a type assertion (`x as T`, `<T>x`), erased, never a conversion | conformance/expressions/asOperator; conformance/expressions/typeAssertions; ts-eslint TSAsExpression, TSTypeAssertion | 81 | 0 |
| `ts-type-guards` | a user-defined type predicate (`value is T`) | conformance/expressions/typeGuards; ts-eslint TSTypePredicate | 146 | 0 |
| `ts-type-operators` | values flowing through type-level operators: keyof, typeof, indexed access, mapped and conditional types | conformance/types (keyof, typeQueries, mapped, conditional) | 35 | 0 |
| `ts-typeof-operator` | the run-time `typeof` operator over typed values | conformance/expressions/typeGuards/typeGuardsWithTypeOf | 2427 | 0 |
| `ts-tuple-route-calls` | tuple parameters, results, argument lists, destructuring and variadic instantiations preserve every argument and returned slot | TypeScript Tuple Types; Variadic Tuple Types; rest arguments | 16 | 0 |
| `ts-tuple-route-conversion` | tuple iteration, copying, spreads and serialization preserve slot order, reference identity, independent copies and exact JSON | TypeScript Tuple Types; Array prototype methods; SerializeJSONArray | 20 | 0 |
| `ts-tuple-route-elements` | optional, rest and labeled tuples retain every slot, exact count, presence and inner identity through six storage routes | TypeScript Tuple Types; Labeled Tuple Elements | 36 | 0 |
| `ts-tuple-route-storage` | heterogeneous primitive and object tuples cross fields, arrays, Maps, closures, sorting and filtering with complete slot and identity checks | TypeScript Tuple Types; Array sort and filter | 36 | 0 |
| `ts-tuple-route-widening` | widened array writes and readonly views remain visible through fixed tuple readers, including holes, truncation and regrowth | TypeScript Tuple Types; Readonly Tuple Types; ArraySetLength | 16 | 0 |
| `ts-tuple-routes` | tuples retain exact slots, runtime length, array shape and identities across typed routes beside named-slot record controls | Tuple route contracts; typed paths | 124 | 0 |
| `ts-typed-array-buffers` | fixed and tracking views retain the specified contents and metadata through buffer resize and transfer | Typed-array contents contracts; ArrayBuffer resize and ArrayBufferCopyAndDetach | 28 | 0 |
| `ts-typed-array-contents` | typed-array elements and bytes preserve their exact contents and view metadata across typed routes | Typed-array contents contracts; typed paths | 202 | 0 |
| `ts-typed-array-conversion` | writes through union and generic view parameters obey each element type's wrapping, clamping or rounding | Typed-array contents contracts; NumericToRawBytes; ToUint8Clamp | 30 | 0 |
| `ts-typed-array-methods` | typed receivers, sources and factories preserve exact mutation, conversion, copying, searching and iteration results | ECMAScript, TypedArray objects and CompareTypedArrayElements | 48 | 0 |
| `ts-typed-array-subclasses` | subclass contents cross base-typed parameters while preserving conversion, view geometry, identity and own state | Objects, Typed arrays; ECMAScript, TypedArray constructors and TypedArraySetElement | 96 | 0 |
| `ts-typed-array-views` | typed view aliases observe shared bytes, offsets, subarray aliasing, slice copies and explicit DataView byte orders | Objects, Typed arrays; ECMAScript, TypedArray and DataView objects | 18 | 0 |
| `ts-typeof-type` | `typeof x` in a type position | conformance/types/typeQueries; ts-eslint TSTypeQuery | 99 | 0 |
| `ts-unicode-case-mapping` | default lower/uppercase mappings, expansions, Final_Sigma, surrogate handling and newly assigned letters | Unicode contracts; UCD SpecialCasing, DerivedAge and UnicodeData | 207 | 0 |
| `ts-unicode-exhaustive` | every code point, including lone surrogates, checked by a Node-generated FNV-1a UTF-16 hash per 4096-point block | Unicode contracts: Staying identical to node, exhaustive layer | 34 | 0 |
| `ts-unicode-sequences` | exact contextual strings or API observations that a per-code-point sweep cannot establish | Unicode contracts: Staying identical to node, sequence and behaviour layers | 173 | 0 |
| `ts-union-route-narrowing` | typed guards, discriminants, equality, arrays and predicates select the correct member across returns, closures and assignments | TypeScript Narrowing; control-flow analysis | 20 | 0 |
| `ts-union-route-objects` | object and class unions retain their layouts, shared fields, optional member presence and reference writes | TypeScript Union Types; discriminated unions; in narrowing | 10 | 0 |
| `ts-union-route-storage` | five primitive unions cross fields, arrays, Maps, Sets, tuple slots and closures with exact read and printed-value histories | TypeScript Union Types; typed paths; Set semantics | 60 | 0 |
| `ts-union-route-values` | all six carriers crossed with all seven narrowing forms retain signed zero, NaN, zero bigint, empty text, false, both absences and identity | Union route contracts; TypeScript Narrowing; Set semantics | 84 | 0 |
| `ts-union-route-widening` | union widening, unknown and generic storage, overload and conditional results, and built arrays preserve every member | TypeScript Union Types; assignments and control-flow analysis | 16 | 0 |
| `ts-union-routes` | declared unions preserve exact payloads, runtime kinds, identities and branch histories across typed routes beside concrete-record controls | Union route contracts; typed paths | 190 | 0 |
| `ts-unions` | a union type and the values that flow through it | conformance/types/union; ts-eslint TSUnionType | 2115 | 0 |
| `ts-unique-symbol` | a `unique symbol` constant as a member key | conformance/types/uniqueSymbol | 16 | 0 |
| `ts-unknown` | the `unknown` type, narrowed before use | conformance/types/unknown; ts-eslint TSUnknownKeyword | 2322 | 0 |
| `ts-unsound-arity` | a shorter function signature hides an optional parameter from a wider caller | conformance/types/typeRelationships; typed paths | 3 | 0 |
| `ts-unsound-assertion` | an assertion function claims a type without establishing it at runtime | conformance/controlFlow/assertionTypePredicates; typed paths | 89 | 0 |
| `ts-unsound-bivariance` | method parameter bivariance permits a wider writer to violate a narrow value type | conformance/types/typeRelationships; typed paths | 203 | 0 |
| `ts-unsound-covariant-array` | array covariance permits a wider writer to violate the original element type | conformance/types/typeRelationships; typed paths | 142 | 0 |
| `ts-unsound-covariant-view` | a readonly or covariant view retains a narrow claim after a mutable wider alias writes | conformance/types/typeRelationships; typed paths | 92 | 0 |
| `ts-unsound-generic-widening` | a wider generic instantiation writes an incompatible value or retains an invalid property claim | conformance/types/typeParameters; typed paths | 101 | 0 |
| `ts-unsound-object-assign` | Object.assign overwrites a property while the original target retains its narrow type | conformance/types/typeRelationships; typed paths | 1 | 0 |
| `ts-unsound-overload` | an overload return type can disagree with its accepted implementation | conformance/functions/overloads; typed paths | 1 | 0 |
| `ts-unsound-predicate` | a user-written type predicate claims a type the runtime value does not have | conformance/controlFlow/typePredicate; typed paths | 89 | 0 |
| `ts-unsound-private` | compile-time privacy allows literal-key access that can participate in a false type claim | conformance/classes/propertyMemberDeclarations; typed paths | 5 | 0 |
| `ts-unsound-refinement` | control-flow narrowing survives a call that mutates the narrowed value | conformance/controlFlow; typed paths | 9 | 0 |
| `ts-using` | `using` and `await using` declarations, Disposable and DisposableStack | conformance/statements/VariableStatements/usingDeclarations | 10 | 0 |
| `ts-utility-types` | the lib's utility types (Partial, Pick, Omit, ReturnType, Parameters, Awaited, ...) through values | lib.es5.d.ts; conformance/types/mapped | 31 | 0 |
| `ts-variadic-tuples` | a variadic tuple type (`[...A, ...B]`) | conformance/types/tuple/variadicTuples | 3 | 0 |
| `ts-void` | the `void` return type, which does not discard a returned value | conformance/types/primitives/void; ts-eslint TSVoidKeyword | 1 | 0 |
<!-- tags:end -->
