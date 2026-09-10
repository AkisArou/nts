# External blocker ledger

| Area | Evidence | State | Required next interface |
| --- | --- | --- | --- |
| Strict React TypeScript | `../reports/runtime-typecheck.md` | normalized, specialized and linked trees all have zero TypeScript 7.0.2 diagnostics; escape audit is clean | preserve as the conversion and upgrade gate |
| Full React HIR | `../reports/runtime-native-probe.md` | 941 refused constructs, nine verifier failures and no required reconciler export | close the reduced roots below before backend claims |
| React key/node values | `react-value-representation/` | strict union fixtures reproduce key and recursive-node refusals | checked recursive tagged representation plus specialization facts |
| Object intersections | `intersection-representation/` | strict fixture contradicts the ledger's supported-intersection row | flatten compatible records into one static layout |
| Object literal methods/function fields | `object-literal-methods/` | both the documented method gap and a function-field regression reproduce | canonical structural shape naming and correct field/method distinction |
| Function constructors/prototypes | `function-object-semantics/` | own-`this` is a gap; dynamic prototype mutation is an explicit non-goal | proven class/descriptor adaptation preserving React class observables |
| Mutable module callbacks | `module-function-storage/` | documented gap; 26 full-profile refusals | uniform typed callable slot and native Scheduler profile |
| Production empty returns | `production-empty-return/` | zero refusals but invalid FellThrough HIR | synthesize the implicit undefined return |
| Module cycles/order | `module-cycle/` | primitive propagation removed 23 reports; seven React reports remain | compare value edges with upstream build; retain genuine TDZ refusal |
| Native scheduler/host APIs | `native-host-capabilities/` | browser globals and abort types lack native bindings | monotonic clock, work posting, priorities, errors and abort ABI |
| Remaining language/library tail | `language-surface/` | strict focused files cover nullish, rest, presence, regex, `for...in`, callable metadata, standard library and module-init cascades | follow the conformance status recorded for each construct; do not approximate non-goals |
| JSX HIR lowering | `jsx-lowering/` | reproducible `NTS1001` | typed configured JSX runtime calls with no mandatory dynamic prop map |
| LLVM exported functions | `backend-export-emission/` | successful empty implementation set | definitions or explicit per-function refusals |
| JVM exported methods | `backend-export-emission/` | constructors only | callable static methods or explicit per-function refusals |
| General heterogeneous values | `../reports/representation-probe.md` | `Erased` exists and is checked by tags | descriptor/token-checked projections and specialization facts exposed to HIR |
| React Compiler cache ABI | `react-compiler-cache-abi/` | HIR has six direct typed fields; C refuses external generic tuple return | descriptor-carrying trusted `_c<Slots>` intrinsic |
| Mutation HostConfig | `../reports/recording-host.md` | 47 bindings materialized; kernel passes Node/native C and exact-source JS oracle | connect reconciler after prop representation and HIR coverage |

This table names dependencies owned outside `runtime/react`; it does not imply
that the React experiment should wait. Each row has a local reproduction or
measured report so another workstream can implement the smallest interface and
re-run the same gate.
