# Rust test input coverage at main (#761, slice 1)

Part of #761. Before the landing check stops owing the Rust tests on every
change, a traced run must show that every path a test opens is one a change to
which owes the tests. This records that run at main `1e421fac882a`, the decision
rule it led to, and what is left.

## The run

`build` and `tests` at `1e421fac882aefa15cb5fc580dd95d5c7c65672c` through
`runLanding` with `NTS_RUST_INPUT_TRACE` set, in its own unit: green. Traced,
`tests` took 900.8 s wall and 6,526 CPU-s, against about 300 s untraced in
recent landings. The capture is 5.9 GB gzipped (58 captures: 57 test binaries
and Cargo's own lifetime); the validation reports are 90 MB.

## What the validator flags, and what selection reaches

The validator (`rust-input-validation.ts`) claims attempts operation by
operation: a readlink needs a link claim, a stat a metadata claim. Against the
declarations it leaves 3,950 tracked candidates: 2,666 readlinks (1,932 files,
734 directories, mostly path canonicalization), about 1,230 stats of
directories and 25 directory opens. Asked of selection as a path, without the
every-change policy, each of the 3,950 owes the tests: through declared
reader observations (`fileExists`, `runtimeKind`, `realpath`), the crate graph,
step inputs and 4 full-gate rules. The one exception is a listing: `benchmarks/`
is enumerated, and adding a child to it owed nothing. So the step decides by selection's reach
(`owingByReach` in `owed.mjs`), and the validator only proposes candidates.

| Candidate | Count | Decision |
|---|---:|---|
| tracked file or directory | 3,950 | 3,949 reached, 1 missed (a listing) |
| absent path a commit could add | 3,638 | 3,587 reached, 51 missed |
| present, ignored (installed `node_modules`) | 2,729 | reported, not owed |
| absent inside an ignored namespace | 5,139 | reported, not owed |
| present, untracked and not ignored | 2 | reported, not owed |

Nothing under `target/` reaches the decision: the validator attributes Cargo
artifacts and build-script outputs to their crate, whose compile inputs owe the
tests through the crate graph. Installed packages come from `pnpm-lock.yaml`,
which owes the full gate. `third_party/*` corpora are not commit inputs; the
full check owns them.

## The 52 missed, and what this slice does with them

| Missed | Count | Resolution |
|---|---:|---|
| absent fixture directory crossed toward its `tsconfig.json` (C `execute.rs` project choice) | 6 | discharged: its endpoint is claimed, and every lookup through it is its own candidate |
| `benchmarks/` listed by `nts-bench` (`tooling/bench/tests/count.rs`) | 1 | `directory-candidates` declaration |
| root and config walk-ups: `container-content-facts/{pnpm-workspace.yaml,.git,nts.config.ts}`, `tests/programs/{pnpm-workspace.yaml,.git}` (`contents_census.rs`); `runtime/chromium/{,dom/}package.json` (`foreign_window.rs`); `tsconfig.fixtures.json` above an oracle entry (`oracle_coverage.rs`) | 9 | `optional-file` declarations on their readers |
| `tooling/Cargo.toml`, read by the tests' scratch owner's workspace walk | 1 | owed.mjs rule: a new Cargo manifest outside the workspace's crates owes the full gate |
| extensionless module symbol names (`tests/{programs,refusals}/*/src/main`, `src/case`, `imports/vendor/helper`) canonicalized by `compiler/frontend-ts/src/capture/mod.rs` `canonical_source_path` | 35 | not declarable cleanly; #828 removes the lookup at its cause |

Decided again from the same reports with the declarations and rules above, 35
remain, all of the last kind. The `rust-inputs` step stays off `main` until #828
lands and the step is green on a commit containing both.

## The step's disk

The capture lives in the run's registered temporary under `~/.cache`, never
`/tmp`, under a 12 GiB DiskCapacity claim above the 40 GiB floor, and is removed
when the step ends whatever its verdict. Peak use is about 6 GB per wide run.
The step is wide, never owed by a landing, so this use never sits on a
landing's path.

## Evidence

Kept scratch, `~/.cache/nts-scratch/761/main-trace-v1/` (kept while #761 is open):

| File | SHA-256 |
|---|---|
| `terminal.json` (the traced run) | `a63288407e135f52535aabe5290e13802b692a0e15fbc7040f0d96eb8d9e0a23` |
| `reach/classified.json` (the 3,950 tracked candidates and their reaching rules) | `242c4b1cefbecc15efcc5cc9bb23da8afd6d6281c48ff39e91d6b5fc100fa8be` |
| `coverage/coverage.json` (the decision with this slice's declarations) | `5ca31686b32f5b61c12e503c5e7944f30809229f237906b1580d81845f561b9b` |
