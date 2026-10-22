# test262 expressions against node


The table below measures the current **numeric expression harvester**, not
Test262 conformance. It takes closed expressions from Test262's `Math`, `Number`
and operator tests, compiles them, and compares their values with Node. Node is
a differential reference for this arithmetic instrument; it is not the oracle
for a future Test262 runner.

A standards-correct runner instead uses each test's source, harness, and YAML
metadata as the oracle, including strict/sloppy variants and exact negative
phase and exception type. At the pinned suite commit, NativeTS's ECMA-262 scope
is 50,221 standalone files and 96,204 required variants after excluding
ECMA-402. Running that suite requires the general frontend-only
`NeedsRepresentation` analysis for checker-accepted `any`, followed by a real
script initializer and typed test host; no `Any` may reach HIR or MIR. See
[`docs/conformance/test262.md`](docs/conformance/test262.md) for the full
protocol.

|                                           |        |
| ----------------------------------------- | -----: |
| files scanned                             |  11831 |
| expressions taken                         |    121 |
| expressions skipped (not yet expressible) |  18599 |
| cases compared                            | **90** |
| refused by lowering                       |     31 |
| **disagreements with node**               |  **0** |

Most of these are constant expressions, which means what runs on the native side is a value this compiler folded at compile time. That makes this a test of the abstract semantics in `hir::facts` against a real engine — which is where `Math.round` near 2^53 turned out to be wrong in the folder and the runtime both.
