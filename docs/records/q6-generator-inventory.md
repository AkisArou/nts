# Q-6 generator inventory

Issue #1040, under #550; source audit and small runs on 2026-11-25 at
`02d1e31861b6dadd11e0b293eb04ee615b7d5155`. This is evidence for the
[current Q-6 contract](../conformance/README.md#decisions) and input to #1041,
not a conformance rate or a claim that the sampled seeds exhaust a grammar.
No generator, compiler or gate behavior was changed.

Q-6 is **`fuzz-expressions.mjs` plus `fuzz-statements.mjs`, sharing
`fuzz-runtime.mjs`**. Both generate TypeScript source, obtain node's scalar
answers, insert value assertions, emit C, compile it with `cc`, and execute it.
They therefore test compiled program semantics. The runtime fuzzers execute
TypeScript implementations on node; `differential-*` generates arguments for
handwritten module API specifications. Neither substitutes for Q-6.

The neighboring `tooling/sweep/sweep.mjs` is also a production **program
generator compared with node**, on C and the JVM. It deterministically
enumerates a fixed cross-product rather than drawing seeded random source.
It complements the seeded fuzzers named Q-6. Its broader backend routes
already exist, although the seeded fuzzer drivers are C only. This is part
of #1041's starting inventory. The table also distinguishes the differential
harness's per-function argument pools from either source generator.

## Decision table

Unqualified filenames in the first column are under `tooling/conformance/`;
other rows give their repository-relative owners. The lane column names
actual execution, not a backend inferred from a filename. A support
module is included even though running it alone generates no cases. Small-run
IDs refer to the commands and raw evidence below.

| Instrument | Generated population / semantic coverage | Oracle and observation | Actual execution lane / backends | Gate caller and arguments | Exclusions / verdict blind spots | Small-run command and observation |
|---|---|---|---|---|---|---|
| [`fuzz-expressions.mjs`](../../tooling/conformance/fuzz-expressions.mjs) | Depth-bounded number, string and boolean expressions; arithmetic, bitwise operations, exact Math, conversions, comparisons, short-circuit/conditional/nullish forms, string methods, object properties/getters, numeric arrays and callbacks | Node evaluates expressions; scalar literals become compiled value assertions; executable exit status carries assertion success, stderr identifies a failure | C executable only, through `emit-c --main` and `cc -O2`; node supplies the oracle | `all.sh` → `divergence.sh`: `120 1`; CLI default `400 1` | No general statement grammar or module graph; no approximate Math; out-of-range literal reads and empty array literals deliberately avoided. Unrenderable or throwing oracle answers have no assertion. Summary agreement is not an assertion count | E1/E2: `12 1`, `12 2`; reported results below |
| [`fuzz-statements.mjs`](../../tooling/conformance/fuzz-statements.mjs) | Parameterized statement templates, each placed at module scope and inside a function: declarations/writes, arrays, loops, objects/destructuring, closures, exceptions, classes/inheritance/accessors, collections and interfaces | Node computes a scalar read for both placements; compiled assertions compare each usable read. Unequal oracle placement results are dropped | C executable only, through the same helper; node supplies the oracle | `all.sh` → `divergence.sh`: `40 1`; CLI default `200 1` | Finite templates rather than arbitrary recursive program composition; no generated imports, async programs or arbitrary type combinations. Missing oracle values/placement pairs can produce no assertions while a batch still reports agreement | S1/S2: `12 1`, `12 2`; reported results below |
| [`fuzz-runtime.mjs`](../../tooling/conformance/fuzz-runtime.mjs) | Shared seeded RNG, private fixture config, scalar printer/assertion builder, node oracle preparation and C compile/run verdict; **no independent generator** | `runOracle` parses node stdout as a JSON array; `compileAndRun` observes compiler diagnostics, C build and executable status/stderr | Supports the C lane above; no LLVM/JVM/Wasm dispatch | Imported by both Q-6 generators; its focused test checks oracle project construction | Printer supports numbers/strings/booleans, not structural objects, undefined or observable side effects. It does not return an executed-assertion count | Exercised by E1/E2 and S1/S2, not counted again as generated coverage |
| [`fuzz-deep-equal.mjs`](../../tooling/conformance/fuzz-deep-equal.mjs) | Paired nested structures, usually structurally equal, sometimes perturbed: primitives, symbol keys, arrays, objects, maps/sets, dates, regexps, typed arrays, errors, boxed and opaque values | Node `util.isDeepStrictEqual` and `assert.deepEqual` versus the runtime's two comparison functions; boolean or thrown constructor name | TypeScript runtime loaded under node with `bindings.node.mjs`; **no compiled backend** | `all.sh` → `divergence.sh`, default `30000 1` | Not program syntax; no generated cycles or general prototype graph; throw messages/codes not compared; stops after ten differences. Header says three relations, actual `RELATIONS` contains two | D1/D2: `100 1`, `100 2`; each completed 200 relation comparisons, zero differences |
| [`fuzz-timer-order.mjs`](../../tooling/conformance/fuzz-timer-order.mjs) | Depth-two callback trees: timeouts, immediates, intervals/rearming/cancellation, nextTick and promise microtasks, with selected blocking callback work | Complete event traces from node's captured scheduling API and runtime timer API; repeated stability checks, mismatch confirmations and slower-node race filter | TypeScript timer runtime under node; nextTick and Promise callbacks use the host; **no compiled backend** | `all.sh` → `divergence.sh`: `150` (seed 1); CLI default `300 1` | Nondeterministic traces and matches to slower-node order excluded; counts vary with scheduling. Two-second trace cap can truncate. No arbitrary I/O or generated source | T1: `8 1`, six compared, two skipped; T2: `8 2`, seven compared, one skipped; zero differences/races |
| [`differential-ts.mjs`](../../tooling/conformance/differential-ts.mjs) | Fixed inputs plus module-specific generated API arguments, with handwritten `CORPORA` call specifications | Substituted runtime module in a child versus real `node:*` in the parent; awaited results, rendered values/null prototypes, thrown name/message/code | TypeScript runtime under node through `run-one.mjs` and the probe; native binding stand-ins may delegate to node; **no compiled backend** | No production `all.sh` route found; separate `conformance/sweep.mjs` calls `--all --iterations 200`; standalone default 4000 generated inputs | Skips `addonOnly` corpus (`os`), reports absent functions separately; comparisons cover declared calls, not arbitrary programs; no CLI seed argument | A: `punycode --iterations 4`; 252 comparisons over 32 fixed + four generated inputs, zero divergences; probe executed through this driver |
| [`differential-addon.mjs`](../../tooling/conformance/differential-addon.mjs) | Same API-input corpora against a supplied compiled module; optional corpus property checks and export-perturbing control | Addon answers versus real `node:*`; JSON values and thrown name/message/code; absent dotted export chains excluded, zero comparisons fail | Supplied Node-API addon loaded by node; audited `build.sh` uses C (`emit-c --napi`, C linking). This is not LLVM/JVM/Wasm program fuzzing | No production `all.sh` route found; separate `conformance/sweep.mjs` calls built/publishing addons at 200 iterations; `counted-lane.sh` calls at 20000, conditional on its build/test checks; CLI default 20000 | Caller must build an addon. Synchronous `invoke` does not await async results; JSON rendering lacks the TS lane's null-prototype marker. Corpus/export presence limits coverage | B: fresh C punycode addon, `--iterations 4`; 252 comparisons over 32 fixed + four generated inputs, zero divergences/property failures |
| [`differential-corpora.mjs`](../../tooling/conformance/differential-corpora.mjs) | Shared fixed cases, seeded input generators, call specifications, optional preconditions/properties and result renderer for the module families listed below | Supplies questions and rendering; **no comparison loop of its own** | Inherits the TS/addon caller's lane; no backend selection | Imported by both differential drivers and the probe; no independent gate run | Generates inputs to handwritten API programs, not source grammar. Drivers use its default seed; source exposes `makeRandom(seed)` | C: two generated inputs at each of seeds 1 and 2 for every corpus; generation only, **no executed API coverage claimed** |
| [`differential-probe.cjs`](../../tooling/conformance/differential-probe.cjs) | Sequentially evaluates each supplied input against each corpus call; no random generator of its own | Returns the substituted module's rendered rows as `NTSDIFF` stdout; does not reach the real node oracle | Child half of the TypeScript lane; `run-one.mjs` substitutes the selected module | Owned by `differential-ts.mjs`; no independent gate run | Not meaningful standalone; parent owns comparisons. Guards against top-level/one-level nested unresolved promises, not arbitrary deep result graphs | Exercised by A; its rows are already included in A's comparisons |
| [`tooling/sweep/sweep.mjs`](../../tooling/sweep/sweep.mjs), driven by [`run.sh`](../../tooling/sweep/run.sh) | Deterministic cross-products of value kinds × asks, local/parameter placements, erased equality pairs/self-identity, indexed writes, fields, array methods, typed/erased addition, numeric text/arithmetic, bigint and relational operations; no seed | Generated exported functions are driven through agree/check's per-function input pools; node and compiled returned values use the shared string/bit comparison, not a bare exit-status oracle | Production routes on **C and JVM**; `run.sh` calls `check-report/main.ts consume program`; JVM can consume an authenticated producer-generated project | C `sweep`: `all.sh:309`, default `target/sweep`; JVM `jvm`: `all.sh:1678`, `NTS_BACKEND=jvm`, `target/sweep-jvm`; producer `program-oracles.ts::sweepOracleTask` owns subject `gate/jvm-sweep` | Fixed products, not random source composition; no generated module graph/async programs; nullable-object kind held out, checker-invalid asks absent. Most observations are string results, so numeric distinctions lost by conversion are not independently checked. No automatic reducer; function names identify cells. Refused cells remain in the generated population; the consumer accepts nonzero partial coverage. Production LLVM/Wasm route absent | W-C/W-J: run the complete deterministic generator through `run.sh` on C and JVM; results below |
| nts-differential argument pools: [`src/lib.rs`](../../tooling/differential/src/lib.rs) (`inputs`, `tuples_from_pools`), [`src/domains.rs`](../../tooling/differential/src/domains.rs) | Fixed typed scalar candidates plus representable declaration endpoints; boolean/string pools; sweep one parameter while others stay at quiet anchors. Optional workload domains project numeric pools | Shared node/compiled differential comparison: numeric bit patterns (NaNs handled by its comparison), strings and other supported results; the source program is supplied, not generated here | Existing `tests/programs` routes through agree/check on C, LLVM and JVM; sweep uses the same mechanism on C/JVM | C `examples`: `all.sh:2751` → `gate/gate.sh` → `check-consumers.ts programs`; LLVM/JVM `backend_examples` → `agree.mjs`; sweep uses `check-report/main.ts` | Finite pools and supported signatures; no random source or exhaustive multi-parameter Cartesian product. Reviewed tuple exclusions and explicit domains narrow the input population; unavailable/declined/unreached calls are not completed comparisons | Default pools exercised by W-C/W-J; domain projection and the LLVM route source-audited, not newly executed in this inventory |

The `CORPORA` population is: os, punycode, path, fs, assert, buffer, events,
util, zlib, string_decoder, url, querystring, dgram, timers, http, net, stream,
process, async_hooks, readline, diagnostics_channel and console. Its generators
produce Unicode words/encoding inputs, path/URL/query tokens, invalid arguments,
and compact operation strings for API scenarios. `corpora-audit.txt` records
each generator's function body, call labels, fixed population and seed samples.
These are generated-input observations, not executions of every API family.
For example, the `os` generator branches on `rnd() % 5` even though the RNG
returns fractional values: the small seed samples all produced `/` triples.

`divergence.sh` also runs skip-audit, stale-exclusions, fixture-configs and
self-oracle. Those are audits, not additional program generators. The gate's
`sweep` step calls `tooling/sweep/run.sh`, which writes the generated
`tooling/sweep/sweep.mjs` program to `src/main.ts` and passes it through the
shared differential consumer. The JVM step calls that same runner with its
own work directory and backend. Its oracle producer generates the identical
source under subject `gate/jvm-sweep`; when `NTS_PROGRAM_ORACLE` is present,
`run.sh` consumes that authenticated project instead of generating it again.
Neither route calls `tooling/conformance/sweep.mjs`, the separate API sweep.
Header descriptions of old costs were not treated as current measurements.

## Oracle, counting and reduction gaps for #1041

- **Backends and grammar.** Q-6's seeded expression/statement fuzzers have a
  C route only; LLVM, JVM and Wasm have no route in those two fuzzers. This
  does not describe all generated-program coverage: the deterministic sweep
  already runs on C and JVM through the shared differential harness. Its
  per-function input pools also drive supplied `tests/programs` on C/LLVM/JVM.
  Missing seeded source routes are distinct from these existing backend and
  input-generation mechanisms. Expressions are recursive
  but type-directed toward scalar results; statements select one predefined template per case,
  not arbitrary combinations of statements. The templates cover mutation,
  scope and object/class behavior that expressions alone cannot exercise.
  Neither builds random multi-module programs or async source programs.
  Classes and interface-method literals are templates, not generated type
  hierarchies. Statement `labelledBreak` actually emits a labelled continue;
  `strings` is a selectable name without an explicit switch arm, so takes
  the fallback string-length body. A template name is not proof of that
  construct's coverage.
- **Value comparison, carried by exit status.** Q-6 checks values, not just
  whether compilation or execution exits successfully: node's stdout becomes
  literal expected values in compiled assertions. Compiled stdout is not
  compared. Node throws become missing answers; objects, undefined and other
  non-scalars render as null and get no assertion. Observed exception content,
  stdout, arbitrary object identity and whole side-effect traces are outside
  this oracle. NaN and expected negative zero have special assertions;
  ordinary `sameValue` uses `!==`, so expected positive zero does not reject
  negative zero. Approximate Math functions are deliberately excluded.
- **Agreement counters overstate measured values.** Both generators increment
  `agree` by group size after exit 0, even if null answers omitted assertions.
  The statement generator can omit both placements of a case; mismatching
  node placement pairs are explicitly dropped. The expression generator
  credits every other member of a differing batch as agreeing even though
  execution can stop at the first failed assertion. Therefore this record
  labels their outputs as *reported* agreement, not completed value checks.
  Refused, rejected, skipped, dropped and unused oracle values contribute no
  claim of executed coverage. The recorded runs do not expose a trustworthy
  completed-assertion denominator.
- **Isolation is not syntax reduction.** Expressions bisect groups for
  refusal/type/C-build/HIR/panic outcomes. For a value difference they use the
  assertion index to print one expression; despite the header's description,
  `measure` does not re-run that expression alone on the difference path.
  It can leave later failures hidden. Statements bisect groups, including
  differences, to one template instance, and print its prelude plus both
  reads. Neither recursively shrinks the expression, statement body, types
  or placements. Deep-equal prints the pair, timer-order prints the callback
  tree, and the API drivers print inputs/labels; none implements a reducer.
- **Verdicts and routing.** Refusals and TypeScript rejections are counted
  separately and normally do not fail Q-6. All-refused or all-unused runs can
  exit successfully. Compiler panics/invalid HIR/C build failures are findings
  when classified as such; unclassified unusable results can remain nonfatal.
  The shared helper lacks per-command execution bounds; the gate/unit bounds
  the run. Timer stability filtering measures a subset of generated trees.
  API-input fuzzing tests an existing program's API, with stand-in, absent
  export and asynchronous-rendering gaps of its own. Production divergence
  covers neither API differential driver. These distinctions, together with
  the table's per-instrument gaps, are the input to #1041; this inventory
  makes no implementation choice for that task.

## Small runs and provenance

The compiler was rebuilt from the audited revision with the shared build owner
in `nts-dev`. `NTS_BIN` explicitly selected this tree's executable for every
compiled sample; the punycode addon was freshly built with that executable.
`identity.json` records Node v26.13.0 and compiler SHA-256
`82f2271bedba2164d1d04f0188def968a0bb3e4067845086b29ab1305ad99467`.
Comparison commands ran serially in named low-priority systemd units with core
dumps disabled, `taskset -c 0-3,6-31`, admission through `admit.ts`, and
temporary output under `~/.cache/nts-scratch/1040/tmp/`. The lightweight
corpus-input audit C ran directly on the same permitted CPUs. No before/after
or sabotage experiment was run.

The review extension at `bbc23a51043d77bdab8192f5c3db3889ffd5caa7` audited
`tooling/sweep/sweep.mjs`, its C/JVM callers,
`program-oracles.ts::sweepOracleTask`, the shared check consumer and the
`nts-differential` pool/domain owners. W-C/W-J use the same unchanged compiler
binary and the entire fixed sweep population, since the generator has no seed
or small-population option. They run serially in `nts-1040-review-sweep` through
admission, on the same permitted CPUs. Raw logs and generated source are in
`~/.cache/nts-scratch/1040/review2/`.
Both runs generated 445 exported cells across 18 kinds with identical source
SHA-256 `75b54211a49081fa20a4f69865a5f47ba5a47592722e6b3d8e4654230ab8d684`.
Each oracle completed all 12,905 calls; each compiled backend compared 10,556,
with 2,349 unavailable. Neither run reported differences, aborts, runtime
declines, approximated matches or timeouts. The shared consumer's successful
`partial` verdict is evidence for those 10,556 comparisons, not execution of
every generated cell. `review2/sweep-counts.json` extracts these report fields;
the full reports and diagnostics remain in the per-backend logs.

The first compiler build was refused by disk admission before compilation;
the retry succeeded after removing this tree's rebuildable Clippy incremental
cache. An initial sample launcher incorrectly passed `NTS_ADDON_OUT` to Q-6;
the canonical environment rejected those four invocations before generation.
Their logs remain as setup failures. E1/E2 and S1/S2 use the corrected launcher
without that variable; these are the measured samples. Runtime/API samples
were not repeated merely to replace their successful results.

E/S/D/T/A/B commands below omit the shared `node tooling/conformance/`
prefix; W-C/W-J give full shell commands. E/S output is a harness report,
subject to the counting gaps above.

| ID | Command | Observation |
|---|---|---|
| E1 | `fuzz-expressions.mjs 12 1` | Exit 0; reported 12 agree, zero differences/refusals/rejections/unusable |
| E2 | `fuzz-expressions.mjs 12 2` | Exit 0; reported 12 agree, zero differences/refusals/rejections/unusable |
| S1 | `fuzz-statements.mjs 12 1` | Exit 0; reported 11 agree, one `pushThenIndex` refusal, zero differences/rejections/unusable |
| S2 | `fuzz-statements.mjs 12 2` | Exit 0; reported 12 agree, zero differences/refusals/rejections/unusable |
| D1 / D2 | `fuzz-deep-equal.mjs 100 1` / `100 2` | Exit 0 each; 200 relation comparisons each, zero differences |
| T1 | `fuzz-timer-order.mjs 8 1` | Exit 0; six programs compared, two skipped, zero differences/races |
| T2 | `fuzz-timer-order.mjs 8 2` | Exit 0; seven programs compared, one skipped, zero differences/races |
| A | `differential-ts.mjs punycode --iterations 4` | Exit 0; 252 comparisons, zero divergences |
| B | `differential-addon.mjs punycode <scratch>/addons/punycode.node --iterations 4` | Exit 0; 252 comparisons, zero divergences/property failures |
| C | For every corpus and seed 1/2, create `rnd = makeRandom(seed)` and call `input(rnd)` twice | All generated; no API comparisons |
| W-C | `NTS_BACKEND=c bash tooling/sweep/run.sh <scratch>/review2/sweep-c` | Exit 0, `partial`: 10,556 compared / 12,905 expected; 2,349 unavailable; zero differences/aborts/timeouts |
| W-J | `NTS_BACKEND=jvm bash tooling/sweep/run.sh <scratch>/review2/sweep-jvm` | Exit 0, `partial`: 10,556 compared / 12,905 expected; 2,349 unavailable; zero differences/aborts/timeouts |

## Raw evidence

All raw output is retained in `~/.cache/nts-scratch/1040/`. The scripts
`sample.mjs` and `program-samples.mjs` record exact argument vectors and child
exit statuses. `sources.sha256` identifies the audited source population and
routes. The manifest below binds the raw evidence files, including setup
failures; it is not an assertion that every file represents a completed run.

| File under scratch | SHA-256 |
|---|---|
| `identity.json` | `1616098933ed8608728510ef0d3adbcc6bda242eeef59e76418d3409e3cdb474` |
| `sources.sha256` | `cd1d04f81445a78e406850bdc0e8e202422ed90acafc63f28787070d3ee8393a` |
| `routing-audit.txt` | `f279fc7de95703b473ad2611a1fb9b692dbb0212a2296b02e28ab83fee3f43e0` |
| `corpora-audit.txt` | `360cf71eaee3455621006edb322ae7408e9ebbabab0b023ef79689e9899442c2` |
| `samples.log` | `aa4d391296f0b3d3880ff54b815897535f7620266f29cd3fbc7ec5ae2d3f20e5` |
| `program-samples.log` | `47474a311dd75c859867fef79d8cdd9886ce1196f2ccb8b51ca9750d3268448a` |
| `divergence.log` | `2b7aeb114e11386a817dacdbf40638407982839b8304c42f1793eb912693f425` |
| `SHA256SUMS` | `ac4bf1b9f2a55bd47c8b8b81c894171df85dfe2a33fe607a32872d0e20e58b3b` |
| `review2/sweep-c.log` | `198bcbd4f1370854b597f6929aa9f0c7799d05e31d56539eb083f8e3bc7ccbde` |
| `review2/sweep-jvm.log` | `12a7b81cce0247dc355f0f2499308910ca1a2a3a05211d80428b7ec97e5cf94e` |
| `review2/sweep-counts.json` | `847d95c8b25a05f845ef5c0a4212f2cec80e4a1f45aa21ea03b848bb04ae95be` |
| `review2/sweep-c/src/main.ts` | `75b54211a49081fa20a4f69865a5f47ba5a47592722e6b3d8e4654230ab8d684` |
| `review2/sweep-jvm/src/main.ts` | `75b54211a49081fa20a4f69865a5f47ba5a47592722e6b3d8e4654230ab8d684` |

`SHA256SUMS` additionally binds the individual child logs, build logs,
replay scripts, sweep projects and preserved pre-review audit manifests. The initial production `divergence` invocation was not
measured: oracle setup exhausted its wait on the shared pool lock held by
`nts-full-check-measure-24d7aaf3-ff54-46d6-9157-23b7ab636d67.scope`, before
any requested step ran. This is an instrument failure, not a generator
difference or green coverage. `divergence.log` retains that diagnostic.

