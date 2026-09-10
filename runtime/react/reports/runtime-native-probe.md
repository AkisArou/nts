# Full React runtime NTS probe

NTS at `a21cb72ae52e5e6d01523a73826ada6b7f9b4dbe` parsed the strict linked production profile but
did not produce a usable React runtime. The command exited with status
0, while HIR reported 385
refused functions and 941 refused constructs. This
probe therefore treats the compiler process status as transport status, not as
evidence that React compiled.

## Acceptance state

- Native TypeScript input: clean (0 diagnostics)
- Prepared HIR verifies: no
- Required reconciler exports present: no
- Usable native runtime: no

## Refusal categories

| Category | Count | Classification |
| --- | ---: | --- |
| react-key-representation | 528 | representation |
| intersection-representation | 138 | claimed-supported-conformance-defect |
| module-value-representation | 36 | representation |
| null-and-undefined-representation | 29 | representation |
| module-function-storage | 26 | documented-gap |
| react-node-representation | 24 | representation |
| object-literal-and-structural-layout | 18 | documented-gap |
| module-evaluation-cascade | 15 | secondary-refusal |
| closure-and-name-lowering | 12 | supported-language-defect |
| abort-controller-and-signal | 10 | host-or-library-interface |
| generic-and-broad-function-representation | 10 | representation-or-object-model |
| native-host-capabilities | 10 | native-host-interface |
| remaining-union-and-erased-representation | 10 | representation |
| standard-library-wiring | 9 | library-gap-or-import-linking |
| function-object-and-prototype-semantics | 8 | explicit-non-goal |
| thenable-representation-and-lowering | 8 | representation-or-frontend-defect |
| array-and-collection-layout | 7 | library-or-representation |
| module-cycle-tdz | 7 | semantic-integration-check |
| dynamic-method-and-call-dispatch | 6 | lowering-or-object-model |
| structural-method-dispatch | 6 | claimed-supported-conformance-defect |
| iteration-and-loop-lowering | 5 | documented-gap |
| rest-parameter-lowering | 5 | supported-language-defect |
| frontend-internal-refusals | 3 | frontend-defect |
| function-expression-this | 3 | documented-gap |
| property-presence-and-metaobject-semantics | 3 | explicit-non-goal |
| regular-expressions | 3 | documented-runtime-gap |
| string-conversion | 2 | documented-semantic-gap |

The categories are exhaustive over all 941
diagnostics. `secondary-refusal` entries are consequences of an earlier module
initializer refusal and must not be counted as independent React requirements.

## Required React exports

| Export | HIR |
| --- | --- |
| `createContainer` | absent |
| `createHydrationContainer` | absent |
| `updateContainer` | absent |
| `updateContainerSync` | absent |
| `flushSyncFromReconciler` | absent |
| `injectIntoDevTools` | absent |
| `createPortal` | absent |

The recording HostConfig kernel is present in HIR, including
`RecordingMutationHost#createContainer`. That does not substitute for the
public reconciler entry points above.

## Verifier failures

- `checkAttributeStringCoercion`: FellThrough in block 0
- `checkKeyStringCoercion`: FellThrough in block 0
- `checkPropStringCoercion`: FellThrough in block 0
- `checkOptionStringCoercion`: FellThrough in block 0
- `checkCSSPropertyStringCoercion`: FellThrough in block 0
- `checkHtmlStringCoercion`: FellThrough in block 0
- `checkFormFieldValueStringCoercion`: FellThrough in block 0
- `getIsRendering`: FellThrough in block 0
- `getLabelForLane`: FellThrough in block 0

The complete machine-readable diagnostic distribution, top source files,
examples and input fingerprint are in `runtime-native-probe.json`.
