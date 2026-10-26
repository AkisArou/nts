# First full TypeScript corpus census

This is a survey of newly selected upstream inputs, not an allowance or landing ratchet. The stable 316-path/184-case manifest remains the zero-failure gate population.

Input: TypeScript `3e9236361fa97a9e6c685f4833ac457ae2d8c50a`; production compiler/suite source `af0ed0b18beb703fc3184f5968df0650408a200c`. Two isolated workers completed all 10,918 single-file inputs; 10,734 are outside the stable population. Raw rows and worker logs are retained under `scratch/tsrs-lane/corpus-comparison/`.

| Outcome | Cases |
| --- | ---: |
| Refused | 1625 |
| Rejected | 7060 |
| Lowered | 2217 |
| Invalid | 13 |
| Crashed | 3 |

There are 10 C verification failures and 30 JVM verification failures. These overlap other categories: 55 distinct inputs have a crash, invalid HIR, or invalid output. All 55 are outside the stable population. Some C failures identify a verification-harness defect (missing `nts_unicode.h`), rather than invalid generated C; they remain explicitly named below.

## Named failures

The worker restarts after a panic. Three crash rows map to two sites: divergent accessor types reaches `lower.rs:57026` (dispatch table index 8 with length 8); both Unicode identifier inputs reach `codegen/common/src/symbols.rs:633` (identifier validation rejects combining marks). Each is backlog requiring a reduced fixture and control, not an upstream checker patch.

The Unicode crash is introduced by the switch's new emission assertion at
`compiler/codegen/common/src/symbols.rs:633` (atomic switch e5708d1f0); the
previous Go compiler path did not have that guard. The reduction is
`export function क्(): number { return 1; }`. Removing only U+094D, the virama
after the initial letter, makes `emit-c` succeed. This guard uses Rust's
`is_alphanumeric`, which excludes the combining mark. Clang accepts the name:
`clang -std=c11 -fsyntax-only scratch/tsrs-lane/corpus-comparison/crash-controls/combining-mark.c`
exits 0 for `double क्(void) { return 1; }`. Exact argv, statuses and stderr
for the TypeScript reduction/control are in that directory's `results.json`;
`combining-mark-clang.json` preserves the C control. This is a separate
post-switch fixture-and-control correction, not a checker divergence.

| Case path | Kind and observed cause |
| --- | --- |
| `compiler/arrayConcat2.ts` | C: string passed to array parameter; JVM: bad operand-stack type |
| `compiler/asiContinue.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/assignToObjectTypeWithPrototypeProperty.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/capturedLetConstInLoop11.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/capturedLetConstInLoop11_ES6.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/continueInIterationStatement1.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/continueInIterationStatement2.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/continueInIterationStatement3.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/continueStatementInternalComments.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/continueTarget2.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/continueTarget4.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/destructureTupleWithVariableElement.ts` | C: harness missing nts_unicode.h |
| `compiler/divergentAccessorsTypes1.ts` | Crash: dispatch slot index bounds, lower.rs:57026 |
| `compiler/duplicateLabel3.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/duplicateLabel4.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/es6ModuleClassDeclaration.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/exportRedeclarationTypeAliases.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/exportedVariable1.ts` | C: harness missing nts_unicode.h |
| `compiler/functionOverloads26.ts` | C: pointer cast to double |
| `compiler/functionOverloads42.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/moduleMerge.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/privacyFunc.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/privacyFunctionParameterDeclFile.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/privacyGloFunc.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/privacyTypeParameterOfFunctionDeclFile.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/reachabilityChecks2.ts` | JVM: missing stackmap at branch target 0 |
| `compiler/staticInheritance.ts` | Invalid HIR; verifier detail to be reduced |
| `compiler/unicodeIdentifierNames.ts` | Crash: C identifier validation, common/symbols.rs:633 |
| `compiler/voidUndefinedReduction.ts` | C: harness missing nts_unicode.h |
| `compiler/whileStatementInnerComments.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/es6/templates/taggedTemplateStringsWithOverloadResolution2.ts` | C: pointer cast to double |
| `conformance/es6/templates/taggedTemplateStringsWithOverloadResolution2_ES6.ts` | C: pointer cast to double |
| `conformance/es6/templates/templateStringInIndexExpression.ts` | C: generated C rejected; see raw row |
| `conformance/es6/templates/templateStringInIndexExpressionES6.ts` | C: generated C rejected; see raw row |
| `conformance/expressions/optionalChaining/optionalChainingInference.ts` | C: generated C rejected; see raw row |
| `conformance/internalModules/DeclarationMerging/ClassAndModuleThatMergeWithStaticFunctionAndNonExportedFunctionThatShareAName.ts` | Invalid HIR; verifier detail to be reduced |
| `conformance/internalModules/DeclarationMerging/ClassAndModuleThatMergeWithStaticVariableAndNonExportedVarThatShareAName.ts` | Invalid HIR; verifier detail to be reduced |
| `conformance/internalModules/importDeclarations/exportImportAlias.ts` | Invalid HIR; verifier detail to be reduced |
| `conformance/parser/ecmascript5/Statements/ContinueStatements/parser_continueInIterationStatement1.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/parser/ecmascript5/Statements/ContinueStatements/parser_continueInIterationStatement2.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/parser/ecmascript5/Statements/ContinueStatements/parser_continueInIterationStatement3.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/parser/ecmascript5/Statements/ContinueStatements/parser_continueTarget2.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/parser/ecmascript5/Statements/ContinueStatements/parser_continueTarget4.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/parser/ecmascript5/Statements/LabeledStatements/parser_duplicateLabel3.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/parser/ecmascript5/Statements/LabeledStatements/parser_duplicateLabel4.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/parser/ecmascript5/Statements/parserES5ForOfStatement17.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/parser/ecmascript5/Statements/parserForStatement1.d.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/parser/ecmascript5/parserUnicode2.ts` | Crash: C identifier validation, common/symbols.rs:633 |
| `conformance/parser/ecmascript6/Iterators/parserForOfStatement17.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/statements/breakStatements/doWhileBreakStatements.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/statements/breakStatements/forBreakStatements.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/statements/breakStatements/whileBreakStatements.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/statements/continueStatements/doWhileContinueStatements.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/statements/continueStatements/forContinueStatements.ts` | JVM: missing stackmap at branch target 0 |
| `conformance/statements/continueStatements/whileContinueStatements.ts` | JVM: missing stackmap at branch target 0 |

## Refusal causes

Distinct cause counts are per file; one file can draw several. This table is a breadth census, not a count of files one fix will finish.

| Cause | Files |
| --- | ---: |
| a module declaration, which has code in it | 164 |
| a module-scope variable with no initializer, whose type has no representation for the `undefined` it starts as | 95 |
| a computed constructor | 55 |
| a module-scope variable whose initializer was refused above | 55 |
| a method without a body | 53 |
| a `using` declaration, whose scope-exit disposal | 49 |
| a module-scope name holding a function, whose closure layout its initializer does not fix | 46 |
| a class expression | 45 |
| a type assertion expression | 39 |
| an erased value where a concrete representation is wanted | 36 |
| a parameter of unrepresentable type (the type parameter `T`) | 32 |
| destructuring something with no fields | 31 |
| an object literal that is not an object | 22 |
| an exported generic function this program never instantiates, so there is no copy for the export to name | 22 |
| `Math.random` (es:Math) is not provided by this compiler | 21 |
| a member whose name the program computes | 20 |
| a `for...in` over something without named fields | 18 |
| a super keyword | 16 |
| the `arguments` object | 15 |
| `this` outside a method | 15 |
| `super` outside a derived class | 15 |
| a value asserted to be `never` | 14 |
| a tagged template whose tag is not a plain declared function | 14 |
| indexing an object type, which is not an array | 13 |
| a method `fn` with no declaration in the hierarchy | 13 |

A separate post-switch change will introduce exact per-case records and a shrinking path/kind/site ratchet. No aggregate failure allowance is introduced here.
