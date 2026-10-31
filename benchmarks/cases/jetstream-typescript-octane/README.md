# JetStream 3: TypeScript Octane

This row runs the complete historical TypeScript compiler over its own complete
source recording, as the released Octane workload does. It is a real-code row
compared with Node and Bun, with no C++ reference.

## Source and licence

JetStream 3.0 is pinned to
`3967678fa8ab98d847ab33cf3728dba726fa854b`. The source files are:

- [Octane/typescript.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/Octane/typescript.js): driver, BSD-3-Clause.
- [Octane/typescript-compiler.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/Octane/typescript-compiler.js): compiler, Apache-2.0.
- [Octane/typescript-input.js](https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/Octane/typescript-input.js): complete compiler-source input, Apache-2.0.

The driver identifies the compiler's historical CodePlex source revision as
`258e00903a9e`, documents how its input was built, and reproduces its original
Apache notice. Those instructions and notices remain in `case.ts`; the compiler,
input and retained JSON2 helper each carry the notice, and `../LICENSE-jetstream`
contains both applicable notices and the complete Apache terms.

The complete source string is **1,243,591 UTF-16 code units**. Its original
JavaScript file is 1,275,283 bytes. `input.ts` changes only the binding to an
exported, typed constant and adds a licence/provenance header. Its string literal
is byte-for-byte unchanged, including escape spelling and trailing newlines.

## Compiler transcription

The original input contains the compiler's full historical typed source. The
port restores those types to the emitted compiler's algorithms, including both
Firefox token-rescan fixes that the Octane driver added to the emitted file.
It does not substitute a current compiler or parse a reduced input.

The fixed layouts are **151 classes with 795 explicitly typed fields**. Historical
constructor functions become classes; parameter properties become declared
fields and same-order constructor assignments; field initializers retain their
original initialization order. One class with an implicit derived constructor
receives the equivalent `super()` call. The two constructor parameters named
`arguments` become `args`, while the `this.arguments` fields retain their names.
This alpha-renaming permits strict class bodies without changing their operands.

Historical namespaces are linked through distinct local bindings, and their
initialization order follows the released compiler. The old `bool` and `new T[]`
syntax becomes `boolean` and `new Array<T>()`. The **32 enum objects**, including
historical `_map` arrays and string-valued enumeration keys, keep their values
and iteration order. They are ordinary typed objects so Node's native type
stripping needs no enum or namespace transform. Three path helpers that called
`this.getPathComponents` through the TypeScript namespace resolve the same
function through the corresponding local binding.

The historical checker did not enforce strict nullability or validate downcasts.
The port supplies concrete AST, symbol, scope, collection and callback types;
models missing fields and error-recovery values as optional/nullish; and checks
unknown values before reading a narrower layout. These checks remain in the
measured program. There are **4,250 `present` call sites**, **600 `classValue`
call sites**, two checked array views, and a small number of scalar, callback
and recovery readers. `source-audit.json` records every reader's call-site count.
There are no `any` annotations, casts, non-null assertions, ignored diagnostics,
untyped JavaScript imports, runtime source evaluation, or checker suppressions.
The original source string naturally retains those historical source spellings
as inert benchmark input.

Several old annotations described narrower layouts than the objects actually
passed through them. The typed contracts preserve those actual objects: argument
and variable declarations share `BoundDecl`; class/interface operations use
their shared declaration fields; recovery expressions remain base AST nodes;
keyword tokens may lack `hasEscapeSequence`; and an aggregate scope may lack
`valueMembers`. The absent fields stay absent because their declarations emit
no assignments. Boolean-or-count and boolean-or-AST expressions retain their
original operand-returning `&&`/`||` behavior. Keyword table entries remain the
original numeric strings, with explicit numeric conversion only at comparison.

Two expression spellings need special explanation. The unused result of a
recovery-node `arrayCount++` is written as
`arrayCount = Number(arrayCount) + 1`, preserving the original `undefined` to
`NaN` conversion. An identity comparison with a fresh `[]` is written with
`new Array<Signature>()` because the current checker diagnoses the original
always-unequal reference expression; allocation and comparison both remain.
Dynamic AST callbacks validate their callable value and boolean result while
preserving the receiver and argument order.

The local JSON2 serializer is retained in `json2.ts`, including its escaping,
replacer, array and indentation behavior. Its dormant `eval`-based parse entry
point and the obsolete Date/String/Number/Boolean prototype bootstrap are left
out, as inventoried. The uncalled Windows Script Host/Node filesystem and batch
compiler adapters are also omitted; the benchmark's in-memory host and all
compiler stages remain. The upstream teardown that discards the input is replaced
by the module's retained input binding, so subsequent `work` calls can run it.

A literal-preserving structural audit compares **1,437 original functions,
constructors, methods and initializers** after the declared class/module syntax
restoration. **1,428 match** after normalizing only checked readers,
receiver-preserving calls and child-walker parameter alpha-renaming. The other
nine are the two released Firefox fixes, the three path-helper bindings, the
callback validation, the two numeric conversions and the fresh-array expression
explained above. None of those retained compiler definitions is missing. The audit is evidence of
the stated adaptations, rather than a claim that the runtime checks erase.

## Complete operation and validation

Each `work` iteration creates the compiler, performs the original initial type
check, adds the complete input as `compiler_input.ts`, resets diagnostics,
rechecks, and emits through the original checksumming writer. Every output
character contributes to the original rolling checksum; `Close` still requires
**-412589664** and resets its accumulator. The original acceptance of either
**192 or 193 diagnostics** remains. This Node version produces 192.

`work(n)` repeats complete operations and folds the resulting diagnostic count
into an unsigned polynomial checksum. Its adapter returns 192 at `seed = 1`;
this observation does not replace the original emitted-code checksum. The
untimed `inspect()` export additionally records all emitted output and ordered
diagnostics for the correctness tests. The measured call uses the original
writer directly, without allocating that recording.

Untouched upstream and the final typed port agree on every output character and
every ordered diagnostic under Node **24.20.0**:

| Observation | Value |
| --- | ---: |
| Complete input characters | 1,243,591 |
| Complete output characters | 1,189,939 |
| Ordered diagnostics | 192 |
| Original writer checksum | -412589664 |
| `seed` / `work(0)` / `work(1)` / `work(2)` | 1 / 0 / 192 / 6144 |
| Float64 checksum bits at `seed` | `4068000000000000` |

Input SHA-256:

```text
965e543a9b984769b10942ea6b81db3950437c3963c2186b8c3d6b0e98e5346d
```

Complete emitted-output SHA-256:

```text
e74fd3bd69a5723ddaf5cb2c7b7e67ee7cabc89f8feeff8535574f1820edb95c
```

Ordered diagnostic-recording SHA-256 (`JSON.stringify`):

```text
0c73751da13d0608ed561f6cb631f7610b8f2651e79f8dbb5d1b2232d11efbec
```

The shared tests assert the original input-file hash, full output length/hash,
diagnostic count/hash, original validations, repeated calls and opaque counts.
A separate comparison of the retained JSON2 helper against untouched upstream
also passes **52 cases**, including escaping, undefined array elements,
replacers, `toJSON` receivers and indentation. Tests contain no timers.

Validation with the repository's pinned tools:

```sh
pnpm install
node --test benchmarks/jetstream.test.ts
pnpm exec tsc --strict --noEmit --target esnext --module esnext \
  --skipLibCheck --allowImportingTsExtensions --ignoreConfig \
  benchmarks/cases/jetstream-typescript-octane/case.ts
```

The shared suite passes **7/7 tests** with this row and the #44 base installed.
Strict TypeScript **7.0.2** reports zero diagnostics. `source-audit.json` records
source-file hashes, complete oracle results and the structural/syntax audit.

## Timing constraint

The best complete `work(1)` takes **250.195342 ms** on this cloud machine under
Node **24.20.0**, measured by the unchanged `benchmarks/common/bench.mjs` harness
in five sequential fresh processes. Their results are **288.466361,
250.195342, 265.908541, 283.442811 and 267.797706 ms**, each with checksum bits
`4068000000000000`.

Timing exception (approved): **250.195342 ms at `seed = 1`**. One is already the
smallest positive count of complete original operations. The complete compiler
and complete input remain intact under the accepted exception policy. This is
local scale evidence; maintainers run their own measurements.

No nts compilation, gate result, input-domain assignment or oracle-count
recording is claimed. Those steps belong to the maintainers.
