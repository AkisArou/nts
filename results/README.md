# Results

What nts's own tools measured, checked in so a change that moves a number shows
it in its diff. Each file is written by a tool, never by hand, and names the
commit it measured.

| Path | Written by | What it holds |
|---|---|---|
| `test262/<backend>/<slice>.tsv` | `tooling/census/conformance262.ts --record` | the test262 cases of one slice (`language`, `builtins`, `annexb`, `staging`, `harness`) that ran to a verdict on one backend (`c`, `llvm`, `jvm`, `wasm`), and what each did |
| `typescript/<backend>/cases.tsv` | `tooling/census/conformance262.ts --record` | the same for the TypeScript conformance cases (`tests/typescript`) |
| `benchmarks/runs/<date>-<commit>-<sitting>.json` | `tooling/bench/run-record.ts`, shared by `nts-bench` and comparator sittings | one immutable versioned run, its complete inventory, per-cell timings/spreads/checksums/status, each backend's verdicts, exact builds, harness and machine conditions |
| `benchmarks/full.md` | the shared run-record renderer | the newest complete run, with separate C and LLVM verdict counts and each backend's compatible own-best provenance |
| `suite/corpus.md` | `nts-suite` | TypeScript's own test cases compiled as ordinary programs: how many lower, refuse, or break the frontend, and the refusals that stop the most |
| `suite/test262-expressions.md` | `nts-suite test262` | closed numeric expressions from test262 compiled and compared with node |

A conformance record is re-checked by `--recorded`, which runs exactly the cases it names and
fails on any that regressed, changed or went missing. It cannot see a new pass;
a full run, re-recorded from a pin of a commit (`tooling/conformance/pin.ts`),
is what adds one. A record's header names its compiler, commit, backend and
harness, and `--recorded` refuses a record written on another backend.

Benchmark observations are create-only. A partial run never fills cells in another
run. The newest complete run supplies every row in `benchmarks/full.md`, including
refusals, aborts, comparator build failures and machine-load notes. Historical
imports explicitly retain unavailable checksums, spreads and executable identities;
a rendered report's digest is not an executable harness identity. Records lacking
the exact captured workload inventory cannot contribute to own-best comparisons.
The derived page is regenerated, while run records remain evidence.

Each run ends in a results-only commit. The publisher refuses an unrelated staged
path and commits only the new run and its rendered page. Landing remains a
separate operation through the normal lane train.
