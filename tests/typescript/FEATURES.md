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
   the rest), read for concepts only. The submodule is not checked out here;
   its baselines are, flattened, under
   `third_party/typescript-go/testdata/baselines/reference/submodule/conformance/`.
   Written `conformance/<dir>` below.
2. **typescript-eslint's AST**: the TypeScript-only node kinds
   (`TSEnumDeclaration`, `TSModuleDeclaration`, `TSParameterProperty`,
   `TSAsExpression`, ...). Written `ts-eslint <Kind>` below.
3. **The typed paths a compiler like nts depends on**, where a type steers a
   value's representation: generics at each kind of type argument, interfaces
   with several implementations, unions and narrowing, tuples, numbers that
   stop being integers. Written `typed paths` below.

A concept with no run-time effect (a type alias, an interface's existence, a
variance annotation) has no case of its own: it appears only where a value
flows through it.

## Tags

<!-- tags:begin -->
| tag | meaning | source | cases | pending |
| --- | --- | --- | ---: | ---: |
| `ts-accessors` | `get`/`set` accessors on a class or an object literal | conformance/classes/propertyMemberDeclarations; typed paths | 1 | 0 |
| `ts-class` | a class declaration or expression | conformance/classes | 15 | 0 |
| `ts-class-fields` | instance and static field declarations, with define semantics (`useDefineForClassFields`) | conformance/classes/propertyMemberDeclarations; ts-eslint PropertyDefinition | 2 | 0 |
| `ts-class-static-block` | a `static { }` block | conformance/classes/classStaticBlock; ts-eslint StaticBlock | 1 | 0 |
| `ts-computed-keys` | a computed property key in a literal, a class or a type | conformance/es6/computedProperties | 1 | 0 |
| `ts-const-enum` | a `const enum` | conformance/constEnums; ts-eslint TSEnumDeclaration (const) | 2 | 0 |
| `ts-declaration-merging` | two declarations of one name merged into one entity | conformance/internalModules/DeclarationMerging; conformance/interfaces/declarationMerging | 9 | 0 |
| `ts-destructuring` | a typed destructuring declaration, parameter or assignment | conformance/es6/destructuring | 1 | 0 |
| `ts-enum` | an `enum` declaration and its object | conformance/enums; ts-eslint TSEnumDeclaration | 30 | 0 |
| `ts-enum-computed` | an enum member whose initialiser is an expression, constant or not | conformance/enums | 6 | 0 |
| `ts-enum-reverse-mapping` | a numeric enum member's value mapped back to its name | conformance/enums | 5 | 0 |
| `ts-enum-string` | a string-valued enum member | conformance/enums | 6 | 0 |
| `ts-generators` | a generator function or method, typed `Generator<T, TReturn, TNext>` | conformance/generators; conformance/es6/yieldExpressions | 1 | 0 |
| `ts-generics` | type parameters on a function, class, method or interface | conformance/types/typeParameters; ts-eslint TSTypeParameter | 5 | 0 |
| `ts-import-alias` | `import X = N.Y`, an alias for a namespace or a value it exports (`export import` too) | conformance/internalModules/importDeclarations; ts-eslint TSImportEqualsDeclaration | 3 | 0 |
| `ts-interfaces` | an interface, implemented by a class or satisfied by a literal | conformance/interfaces; ts-eslint TSInterfaceDeclaration | 6 | 0 |
| `ts-keyof` | `keyof T`, and values of that type | conformance/types/keyof; ts-eslint TSTypeOperator | 1 | 0 |
| `ts-namespace` | a namespace (internal module) and its object | conformance/internalModules; ts-eslint TSModuleDeclaration | 25 | 0 |
| `ts-narrowing` | control-flow narrowing of a union or `unknown` | conformance/controlFlow; conformance/expressions/typeGuards | 3 | 0 |
| `ts-never` | the `never` type: an unreachable value or a function that does not return | conformance/types/never | 1 | 0 |
| `ts-parameter-properties` | a constructor parameter with a modifier, which declares and assigns a field | conformance/classes/constructorDeclarations; ts-eslint TSParameterProperty | 3 | 0 |
| `ts-private-fields` | ECMAScript `#private` fields, methods and accessors | conformance/classes/members/privateNames | 1 | 0 |
| `ts-record` | `Record<K, V>` | conformance/types/mapped; lib | 1 | 0 |
| `ts-to-primitive` | an object converted to a primitive: `valueOf`, `toString`, `Symbol.toPrimitive` | typed paths | 1 | 0 |
| `ts-to-string` | an object converted to a string by its `toString` | typed paths | 1 | 0 |
| `ts-typeof-type` | `typeof x` in a type position | conformance/types/typeQueries; ts-eslint TSTypeQuery | 1 | 0 |
| `ts-unions` | a union type and the values that flow through it | conformance/types/union; ts-eslint TSUnionType | 2 | 0 |
<!-- tags:end -->
