# Results

What nts's own tools measured, checked in so a change that moves a number shows
it in its diff. Each file is written by a tool, never by hand, and names the
commit it measured.

| Path | Written by | What it holds |
|---|---|---|
| `test262/<backend>/<slice>.tsv` | `tooling/census/conformance262.ts --record` | the test262 cases of one slice (`language`, `builtins`, `annexb`, `staging`, `harness`) that ran to a verdict on one backend (`c`, `llvm`, `jvm`, `wasm`), and what each did |
| `typescript/<backend>/cases.tsv` | `tooling/census/conformance262.ts --record` | the same for the TypeScript conformance cases (`tests/typescript`) |
| `benchmarks/<target>.md` | `nts-bench`, every run | each benchmark case's latest time on one target (`c`, `llvm`, `jvm`, `wasm`), against node and against that target's own reference (C++, Java, C++ compiled to Wasm), with the date and commit it was measured at |
| `benchmarks/cells.tsv` | `nts-bench`, every run | the data those tables are made from: the newest measurement of each case and column |

A record is re-checked by `--recorded`, which runs exactly the cases it names and
fails on any that regressed, changed or went missing. It cannot see a new pass;
a full run, re-recorded from a pin of a commit (`tooling/conformance/pin.ts`),
is what adds one. A record's header names its compiler, commit, backend and
harness, and `--recorded` refuses a record written on another backend.
