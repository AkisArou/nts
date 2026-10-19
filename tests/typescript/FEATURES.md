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
| `ts-abstract` | an `abstract` class and its abstract members | conformance/classes/classDeclarations/classAbstractKeyword; ts-eslint TSAbstractMethodDefinition, TSAbstractPropertyDefinition | 7 | 1 |
| `ts-accessor-fields` | an `accessor` field (auto-accessor), static, private or abstract | conformance/classes/propertyMemberDeclarations/autoAccessor; ts-eslint AccessorProperty, TSAbstractAccessorProperty | 0 | 7 |
| `ts-accessors` | `get`/`set` accessors on a class or an object literal | conformance/classes/propertyMemberDeclarations; typed paths | 11 | 4 |
| `ts-ambient` | an ambient declaration (`declare var/function/class/namespace/global`), which emits nothing | conformance/ambient; ts-eslint TSDeclareFunction, `declare` modifiers | 6 | 1 |
| `ts-any` | an explicitly `any`-typed value, the dynamic escape hatch | conformance/types/any; ts-eslint TSAnyKeyword | 4 | 0 |
| `ts-arrays` | typed arrays of values (`T[]`, `Array<T>`) and their methods | conformance/types/primitives; ts-eslint TSArrayType | 9 | 0 |
| `ts-arrow-functions` | an arrow function, generic or typed | conformance/es6/arrowFunction | 5 | 0 |
| `ts-as-const` | a const assertion (`as const`), which is not a freeze | conformance/expressions/typeAssertions/constAssertions | 4 | 0 |
| `ts-assertion-functions` | an assertion function (`asserts value is T`, `asserts condition`) | conformance/controlFlow/assertionTypePredicates; ts-eslint TSTypePredicate.asserts | 2 | 0 |
| `ts-async` | async functions, methods and arrows, and the promises they return | conformance/async; conformance/es2017 | 20 | 1 |
| `ts-async-generators` | an async generator, `for await`, and `Symbol.asyncIterator` | conformance/es2018 (asyncGenerators, forAwait); conformance/types/forAwait | 3 | 0 |
| `ts-bigint` | `bigint` values, literals and literal types in typed code | conformance/es2020 (bigint); ts-eslint TSBigIntKeyword | 10 | 0 |
| `ts-builtin-subclass` | a class extending a built-in (Array, Error, Map) | conformance/es6/classDeclaration; typed paths | 3 | 0 |
| `ts-call-signatures` | a call signature in an interface or type literal: a callable object with properties | conformance/types/members; ts-eslint TSCallSignatureDeclaration | 2 | 0 |
| `ts-class` | a class declaration or expression | conformance/classes | 158 | 29 |
| `ts-class-expression` | a class expression, named or anonymous | conformance/classes/classExpressions; conformance/es6/classExpressions | 2 | 0 |
| `ts-class-fields` | instance and static field declarations, with define semantics (`useDefineForClassFields`) | conformance/classes/propertyMemberDeclarations; ts-eslint PropertyDefinition | 15 | 4 |
| `ts-class-static-block` | a `static { }` block | conformance/classes/classStaticBlock; ts-eslint StaticBlock | 2 | 0 |
| `ts-closures` | a function or class capturing typed locals | conformance/functions; typed paths | 11 | 1 |
| `ts-commonjs` | a CommonJS-format TypeScript module | conformance/externalModules | 0 | 5 |
| `ts-computed-keys` | a computed property key in a literal, a class or a type | conformance/es6/computedProperties | 5 | 0 |
| `ts-conditional-types` | a conditional type (`T extends U ? X : Y`), distributive over unions | conformance/types/conditional; ts-eslint TSConditionalType | 4 | 0 |
| `ts-const-enum` | a `const enum` | conformance/constEnums; ts-eslint TSEnumDeclaration (const) | 3 | 1 |
| `ts-const-type-parameters` | a `const` type parameter | conformance/types/typeParameters/typeParameterLists; ts-eslint TSTypeParameter.const | 1 | 0 |
| `ts-construct-signatures` | a construct signature or constructor type (`new () => T`) | conformance/types/members; ts-eslint TSConstructorType, TSConstructSignatureDeclaration | 3 | 0 |
| `ts-conversions` | implicit and explicit conversions of typed values: ToPrimitive, ToNumber, ToString, ToBoolean | conformance/expressions/binaryOperators; conformance/expressions/unaryOperators; typed paths | 18 | 0 |
| `ts-declaration-merging` | two declarations of one name merged into one entity | conformance/internalModules/DeclarationMerging; conformance/interfaces/declarationMerging | 11 | 5 |
| `ts-declare-field` | a `declare` class field, which emits nothing | conformance/classes/propertyMemberDeclarations; ts-eslint PropertyDefinition.declare | 1 | 0 |
| `ts-decorators` | standard (TC39) decorators on classes, methods, fields, accessors; context, addInitializer, metadata | conformance/esDecorators; ts-eslint Decorator | 0 | 12 |
| `ts-default-parameters` | a parameter with a default value | conformance/es6/defaultParameters | 4 | 0 |
| `ts-definite-assignment` | a definite assignment assertion (`x!: T`, `let x!: T`) | conformance/controlFlow/definiteAssignmentAssertions; ts-eslint PropertyDefinition.definite | 2 | 0 |
| `ts-destructuring` | a typed destructuring declaration, parameter or assignment | conformance/es6/destructuring | 7 | 0 |
| `ts-discriminated-unions` | a union of object types told apart by a literal-typed property | conformance/types/union/discriminatedUnionTypes | 7 | 0 |
| `ts-dynamic-import` | a dynamic `import()` of a typed module | conformance/dynamicImport | 0 | 1 |
| `ts-enum` | an `enum` declaration and its object | conformance/enums; ts-eslint TSEnumDeclaration | 32 | 3 |
| `ts-enum-computed` | an enum member whose initialiser is an expression, constant or not | conformance/enums | 6 | 0 |
| `ts-enum-reverse-mapping` | a numeric enum member's value mapped back to its name | conformance/enums | 5 | 0 |
| `ts-enum-string` | a string-valued enum member | conformance/enums | 6 | 0 |
| `ts-errors` | exceptions in typed code: `catch` bindings typed `unknown`, Error subclasses, finally | conformance/statements/tryStatements; typed paths | 21 | 0 |
| `ts-expando` | properties assigned to a function declaration (an expando) | conformance/functions (expando assignments, TypeScript 3.1) | 1 | 0 |
| `ts-exponent` | the `**` operator and `**=` | conformance/es7/exponentiationOperator | 1 | 0 |
| `ts-export-equals` | `export =` | conformance/externalModules; ts-eslint TSExportAssignment | 0 | 4 |
| `ts-exports` | export declarations, lists, renames and defaults, read back within the module | conformance/externalModules; conformance/es6/modules; ts-eslint ExportNamedDeclaration | 10 | 3 |
| `ts-expressions` | ordinary operators in typed code: increments, comma, void, delete, in | conformance/expressions | 3 | 0 |
| `ts-function-types` | a function type (`(x: T) => U`) for a parameter, field or type argument | conformance/types/members; ts-eslint TSFunctionType | 13 | 0 |
| `ts-functions` | function declarations, expressions and calls in typed code | conformance/functions; conformance/es6/functionDeclarations | 28 | 4 |
| `ts-generators` | a generator function or method, typed `Generator<T, TReturn, TNext>` | conformance/generators; conformance/es6/yieldExpressions | 11 | 0 |
| `ts-generic-constraints` | a type parameter's constraint (`<T extends C>`) | conformance/types/typeParameters/typeArgumentLists; ts-eslint TSTypeParameter.constraint | 12 | 0 |
| `ts-generic-defaults` | a type parameter's default (`<T = number>`) | conformance/types/typeParameters/typeParameterLists | 9 | 0 |
| `ts-generics` | type parameters on a function, class, method or interface | conformance/types/typeParameters; ts-eslint TSTypeParameter | 93 | 0 |
| `ts-import-alias` | `import X = N.Y`, an alias for a namespace or a value it exports (`export import` too) | conformance/internalModules/importDeclarations; ts-eslint TSImportEqualsDeclaration | 3 | 0 |
| `ts-import-require` | `import x = require("...")` | conformance/externalModules; ts-eslint TSImportEqualsDeclaration, TSExternalModuleReference | 0 | 5 |
| `ts-import-type` | `import type` and TypeScript's elision of imports used only as types | conformance/externalModules/typeOnly; ts-eslint ImportDeclaration.importKind | 0 | 2 |
| `ts-imports` | import declarations between modules: named, default, namespace, side-effect, cycles | conformance/externalModules; conformance/es6/modules | 0 | 9 |
| `ts-index-signatures` | an index signature (`[key: string]: T`) on a type, interface or class | conformance/classes/indexMemberDeclarations; ts-eslint TSIndexSignature | 8 | 0 |
| `ts-indexed-access` | an indexed access type (`T[K]`) | conformance/types/keyof; ts-eslint TSIndexedAccessType | 6 | 0 |
| `ts-infer` | `infer` in a conditional type | conformance/types/conditional; ts-eslint TSInferType | 1 | 0 |
| `ts-inheritance` | `extends` between classes: super calls, super property access, the prototype chain | conformance/classes/classDeclarations/classHeritageSpecification; conformance/expressions/superCalls | 24 | 3 |
| `ts-instanceof` | `instanceof`, and narrowing by it | conformance/expressions/typeGuards/typeGuardsWithInstanceOf | 3 | 0 |
| `ts-instantiation-expression` | an instantiation expression (`f<number>`), erased | conformance/types/typeParameters/typeArgumentLists/instantiationExpressions; ts-eslint TSInstantiationExpression | 1 | 0 |
| `ts-interface-extends` | an interface extending interfaces or a class | conformance/interfaces/interfaceDeclarations; conformance/interfaces/interfacesExtendingClasses; ts-eslint TSInterfaceHeritage | 4 | 0 |
| `ts-interfaces` | an interface, implemented by a class or satisfied by a literal | conformance/interfaces; ts-eslint TSInterfaceDeclaration | 46 | 0 |
| `ts-intersections` | an intersection type (`A & B`) and values of it | conformance/types/intersection; ts-eslint TSIntersectionType | 1 | 0 |
| `ts-iteration` | the iteration protocols in typed code: Iterable, Iterator, for-of, spread, destructuring | conformance/es6/for-ofStatements; conformance/types/forAwait; lib.es2015.iterable.d.ts | 17 | 0 |
| `ts-jsx` | JSX in a `.tsx` file, compiled to factory calls | conformance/jsx; ts-eslint JSX nodes | 0 | 6 |
| `ts-keyof` | `keyof T`, and values of that type | conformance/types/keyof; ts-eslint TSTypeOperator | 8 | 0 |
| `ts-legacy-decorators` | `experimentalDecorators`: class, method, property, accessor and parameter decorators | conformance/decorators | 0 | 8 |
| `ts-literal-types` | string, number and boolean literal types and the values they admit | conformance/types/literal; conformance/types/stringLiteral; ts-eslint TSLiteralType | 21 | 0 |
| `ts-map-set` | `Map<K, V>` and `Set<T>` in typed code | typed paths | 7 | 0 |
| `ts-mapped-types` | a mapped type (`{ [K in keyof T]: U }`), with modifiers and `as` remapping | conformance/types/mapped; ts-eslint TSMappedType | 6 | 0 |
| `ts-mixins` | a function returning a subclass of the class it is given | conformance/classes/mixinClassesAndInterfaces | 1 | 0 |
| `ts-modules` | an ES module (the `module` flag): module scope, strictness, top-level await | conformance/externalModules; conformance/es6/modules | 14 | 10 |
| `ts-namespace` | a namespace (internal module) and its object | conformance/internalModules; ts-eslint TSModuleDeclaration | 28 | 6 |
| `ts-narrowing` | control-flow narrowing of a union or `unknown` | conformance/controlFlow; conformance/expressions/typeGuards | 36 | 0 |
| `ts-never` | the `never` type: an unreachable value or a function that does not return | conformance/types/never | 3 | 0 |
| `ts-new-target` | `new.target` | conformance/es6/newTarget | 1 | 0 |
| `ts-non-null` | a non-null assertion (`x!`), erased, never a check | conformance/expressions (non-null assertions); ts-eslint TSNonNullExpression | 5 | 0 |
| `ts-null-undefined` | `null`, `undefined` and `T | undefined` under strictNullChecks | conformance/types/primitives; typed paths | 14 | 0 |
| `ts-numbers` | IEEE doubles in typed code: fractions, -0, NaN, int32 operators, formatting | conformance/types/primitives/number; typed paths | 13 | 0 |
| `ts-object-type` | the non-primitive `object` type | conformance/types/nonPrimitive; ts-eslint TSObjectKeyword | 1 | 0 |
| `ts-objects` | object literals and object types: properties, methods, keys, copies | conformance/expressions/objectLiterals; conformance/types/objectTypeLiteral; ts-eslint TSTypeLiteral | 29 | 0 |
| `ts-optional-chaining` | `?.` on properties, calls and elements, in typed code | conformance/expressions/optionalChaining | 8 | 0 |
| `ts-optional-parameters` | a parameter marked `?` | conformance/functions; conformance/types/members | 4 | 0 |
| `ts-optional-properties` | a property marked `?` in a type, a class or an interface | conformance/types/members; conformance/types/objectTypeLiteral | 8 | 0 |
| `ts-overloads` | overload signatures on a function, method or constructor | conformance/functions/functionOverloads; ts-eslint TSDeclareFunction, TSEmptyBodyFunctionExpression | 6 | 0 |
| `ts-override` | the `override` modifier on a method, accessor or field | conformance/override; ts-eslint MethodDefinition.override | 3 | 0 |
| `ts-parameter-properties` | a constructor parameter with a modifier, which declares and assigns a field | conformance/classes/constructorDeclarations; ts-eslint TSParameterProperty | 9 | 0 |
| `ts-private-fields` | ECMAScript `#private` fields, methods and accessors | conformance/classes/members/privateNames | 8 | 2 |
| `ts-private-keyword` | the `private` modifier, a compile-time check over an ordinary property | conformance/classes/members/accessibility; ts-eslint TSPrivateKeyword | 2 | 0 |
| `ts-protected` | the `protected` modifier | conformance/classes/members/accessibility; ts-eslint TSProtectedKeyword | 1 | 0 |
| `ts-readonly` | `readonly` properties, arrays and tuples, which are not frozen | conformance/types/tuple/readonlyArraysAndTuples; ts-eslint TSReadonlyKeyword | 8 | 0 |
| `ts-record` | `Record<K, V>` | conformance/types/mapped; lib | 8 | 0 |
| `ts-rest-parameters` | a rest parameter, typed as an array or a tuple | conformance/es6/restParameters | 3 | 0 |
| `ts-satisfies` | the `satisfies` operator, which leaves its value and the value's type alone | conformance/expressions/typeSatisfaction; ts-eslint TSSatisfiesExpression | 3 | 0 |
| `ts-spread` | spread and rest of objects and arrays in typed code | conformance/types/spread; conformance/es6/spread | 8 | 1 |
| `ts-static` | static fields, methods and accessors | conformance/classes/propertyMemberDeclarations; ts-eslint TSStaticKeyword | 14 | 4 |
| `ts-strings` | strings in typed code: UTF-16 length and indexing against code points | conformance/types/primitives/string; typed paths | 1 | 0 |
| `ts-structural-typing` | a value accepted for its shape, not its declared name: literals and classes that never say `implements` | conformance/types/typeRelationships; typed paths | 7 | 0 |
| `ts-symbols` | symbols as keys, well-known symbols, `unique symbol` | conformance/Symbols; conformance/es6/Symbols; conformance/types/uniqueSymbol | 14 | 2 |
| `ts-tagged-templates` | a tagged template with a typed tag function | conformance/es6/templates | 1 | 0 |
| `ts-template-literal-types` | a template literal type, and the intrinsic string types (Uppercase, Capitalize, ...) | conformance/types/literal/templateLiteralTypes; ts-eslint TSTemplateLiteralType | 8 | 0 |
| `ts-template-literals` | template literal expressions and their substitutions | conformance/es6/templates | 1 | 0 |
| `ts-this` | `this` in methods, arrow fields and detached calls | conformance/expressions/thisKeyword | 8 | 1 |
| `ts-this-parameter` | a `this` parameter, which is erased | conformance/types/thisType; conformance/functions | 2 | 0 |
| `ts-this-type` | the polymorphic `this` type | conformance/types/thisType | 2 | 0 |
| `ts-to-primitive` | an object converted to a primitive: `valueOf`, `toString`, `Symbol.toPrimitive` | typed paths | 11 | 0 |
| `ts-to-string` | an object converted to a string by its `toString` | typed paths | 3 | 0 |
| `ts-tuple-labels` | a labelled tuple element (`[start: number]`) | conformance/types/tuple/named; ts-eslint TSNamedTupleMember | 2 | 0 |
| `ts-tuple-optional` | an optional tuple element (`[a, b?]`) | conformance/types/tuple; ts-eslint TSOptionalType | 2 | 0 |
| `ts-tuple-rest` | a rest element in a tuple, leading, middle or trailing | conformance/types/tuple; ts-eslint TSRestType | 2 | 0 |
| `ts-tuples` | a tuple type and the array that carries it | conformance/types/tuple; ts-eslint TSTupleType | 21 | 0 |
| `ts-type-aliases` | a `type` alias, generic or recursive | conformance/types/typeAliases; ts-eslint TSTypeAliasDeclaration | 1 | 0 |
| `ts-type-assertions` | a type assertion (`x as T`, `<T>x`), erased, never a conversion | conformance/expressions/asOperator; conformance/expressions/typeAssertions; ts-eslint TSAsExpression, TSTypeAssertion | 5 | 0 |
| `ts-type-guards` | a user-defined type predicate (`value is T`) | conformance/expressions/typeGuards; ts-eslint TSTypePredicate | 7 | 0 |
| `ts-type-operators` | values flowing through type-level operators: keyof, typeof, indexed access, mapped and conditional types | conformance/types (keyof, typeQueries, mapped, conditional) | 18 | 0 |
| `ts-typeof-operator` | the run-time `typeof` operator over typed values | conformance/expressions/typeGuards/typeGuardsWithTypeOf | 1 | 0 |
| `ts-typeof-type` | `typeof x` in a type position | conformance/types/typeQueries; ts-eslint TSTypeQuery | 5 | 0 |
| `ts-unions` | a union type and the values that flow through it | conformance/types/union; ts-eslint TSUnionType | 42 | 0 |
| `ts-unique-symbol` | a `unique symbol` constant as a member key | conformance/types/uniqueSymbol | 1 | 0 |
| `ts-unknown` | the `unknown` type, narrowed before use | conformance/types/unknown; ts-eslint TSUnknownKeyword | 8 | 0 |
| `ts-using` | `using` and `await using` declarations, Disposable and DisposableStack | conformance/statements/VariableStatements/usingDeclarations | 10 | 0 |
| `ts-utility-types` | the lib's utility types (Partial, Pick, Omit, ReturnType, Parameters, Awaited, ...) through values | lib.es5.d.ts; conformance/types/mapped | 10 | 0 |
| `ts-variadic-tuples` | a variadic tuple type (`[...A, ...B]`) | conformance/types/tuple/variadicTuples | 2 | 0 |
| `ts-void` | the `void` return type, which does not discard a returned value | conformance/types/primitives/void; ts-eslint TSVoidKeyword | 1 | 0 |
<!-- tags:end -->
