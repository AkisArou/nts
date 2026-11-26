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
remain, all of the last kind.

## The step at main with #828

#828 landed as `ab0de9642d`, and this slice was rebased onto `8b26e53ad017`.
The `rust-inputs` gate step itself, run through `runLanding` (`build`,
`rust-inputs`) at the rebased tip `0e784e616e`, is green: 1,663 s wall and
6,944 CPU-s, including the traced tests and the coverage decision. It saw 58
captures and 6,197 candidates a commit can change. Selection reaches all of
them and misses none. Outside every commit it saw 2 untracked (`.git`, from
the declared root walk-ups), 2,729 ignored, 5,139 absent inside ignored
namespaces and 19 absent directories crossed toward another lookup. The
capture was removed when the step ended.

## The step after review, at main with nine more days of landings

The step at `c7d69402ad` (the review fixes, root candidates included), through
`runLanding` (`build`, `rust-inputs`): red, as designed. It waited 1,153 s for
its disk claim, then took about 3,200 s, 10,512 CPU-s. The traced tests passed:
3,328 tests in 57 binaries. It saw 6,802 candidates, of which 6,793 were reached
and 9 missed. All 9 are reads main gained after the first green run:

| Missed | Count | Resolution |
|---|---:|---|
| `tests/memory/a-borrow-ends-at-its-last-read` (landed in `14e0538b87`, counted by `compiler/core/tests/counting_moves.rs`): its listings, files and `package.json` lookups | 6 | `project-config` of its reader, as for the fixtures beside it |
| `tests/memory/traversal/{.git,nts.config.ts,pnpm-workspace.yaml}`, looked up by the CLI that `tooling/cli/tests/memory_census.rs` runs | 3 | `optional-file` declarations on that reader |

Re-decided under these declarations, 2 remain: the new fixture's two
listings. For a fixture declared this way the validator claims its listings
and contents itself. Neither is a candidate for `pile-shuffle` or
`borrowed-call` in the same run, where only stats and readlinks remain, all
reached. The first wide run is the check of that.

## What the trace covers

- **Descendants.** The observer is the tests' child subreaper, and its seccomp
  filter is inherited across `fork` and `exec`, so every process a test starts
  is traced, orphans included, until it exits. The traced run saw a `node`
  child of a `tooling/bench` test `access()` `docs/primitives.md`.
- **Directory listings.** `getdents`/`getdents64` are directory operations.
  Selection is asked whether adding a child owes the tests. This caught
  `benchmarks/` above: it was listed, but adding to it owed nothing.
- **Failed lookups.** An `ENOENT` attempt is kept. Selection is asked whether
  adding the absent path owes the tests: 51 of 3,638 did not, before their
  declarations were added.
- **Listing removals.** A listing changes when an entry is removed as well as
  added, so removing one tracked file under each entry must owe the tests too.
  All 15 directories the main run listed pass under the current rules.
- **The repository root.** An operation on the root itself (a listing, a
  stat) is a candidate like any directory; crossing it toward another path is
  not. `tooling/bench/tests/integration.rs` lists it: `nts-bench` runs
  `host-columns.ts` with the root as its working directory, and the bun
  comparator lists that directory (46 `getdents64` calls in the main run, which
  the first decision dropped). Its membership of the root is declared, so a
  new or removed top-level entry owes those tests; an edit inside an existing
  entry does not. Re-deciding the first main run's reports with root
  candidates: 37 root candidates, none missed.
- **Content reads survive the least-owing edit.** A comment-only edit of a
  `.rs`, `.ts`, `.c` or `.h` file outside `tests/` and `third_party/` owes only
  its declared byte readers, so an undeclared content read is decided by that
  edit, not by an edit in place. Re-deciding the main run's 6,197 candidates this
  way leaves one content read missed: `tooling/inputs/corpus.ts`, imported by
  `tooling/bootstrap/awfy.ts`, which `nts-bench`'s tests run with `--resolve`.
  It is now declared as that target's module import. A stat is decided by an
  edit in place. The 20 crate-root `.rs` files a frontend-ts test's child Cargo
  stats for freshness would otherwise be missed, though no comment changes
  what they decide.
- **The ignored namespace** is the tracked `.gitignore` files' positive
  patterns alone. The shared repository's `info/exclude` holds 11 host rules
  (`/third_party/node-source/` and `.claude` state), and the user's excludes
  file is set too. Neither may widen what is reported rather than owed.
  Checked under only the committed rules, every one of the 5,139 absent-ignored
  candidates (1,115 distinct paths) is still ignored by a tracked `.gitignore`
  (path list `~/.cache/nts-scratch/761/absent-ignored-v1.txt`, SHA-256 `fe041c7dbbb11cabfed56c108c759f1d39522ab5582fc04d89895f6092e115b8`).
- **Conditional reads.** A trace sees only the reads its run makes. A read
  taken only under another environment, host, OS or toolchain is unseen until
  a wide run makes it, and is red at that first run.

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

The review's re-decisions of that run, `~/.cache/nts-scratch/761/`:

| File | SHA-256 |
|---|---|
| `least-edit-v1/result.json` (byte-sensitive reads by the least-owing edit, stat included; 21 missed) | `b3a0ef36b37010d712b5f422920b79c10816704325ca3c311292786df7696d9f` |
| `listing-removal-v1/result.json` (removal from the 15 listed directories; 0 missed) | `2e4f24845985ddeb1f1947c71e2a48aace9d3df2f5c0118af13f2fc8ab72abac` |
| `root-redecide-v1/result.json` (the first run's reports with root candidates: 37 reached; its other misses are the pre-#828 readlinks and `corpus.ts`, declared since) | `47baf4f253bee6a36add3201ecc6a487c2ff7d08c9197294521a61ad59379496` |

The step after review, `~/.cache/nts-scratch/761/`:

| File | SHA-256 |
|---|---|
| `step-main-v2/terminal.json` (the run, red) | `3c27da789c6f1d5613cc1d1ce1dd027b6ad75a06357dd038cfbe4ae4ff087a69` |
| `step-main-v2/run/rust-inputs.coverage.json` (9 missed) | `b525f589c92b49102ae3b0ba2464a10bfc3d2da9ed0644382fa9c5085384d6ec` |
| `v2-redecide/result.json` (under the new declarations: 2 missed, the listings) | `9a5fb9d89d75031c4aa3d7dea00e7412b08b1cdffe351828c069905b2c33a4f9` |

The step at the rebased tip, `~/.cache/nts-scratch/761/step-main-v1/`:

| File | SHA-256 |
|---|---|
| `terminal.json` (the run) | `e06c220de55542a38a2a0a670d21590c7e15ed448b3014bb89f30c0f6cbe5f12` |
| `run/rust-inputs.log` | `169672e25862294ae564367c01921afbe48aa49af2ec09e7411cd15cee7470e7` |
| `run/rust-inputs.coverage.json` (zero missed) | `0aef8571a8def63f8b4862ff69fb429b37736b1a43e52e9165c4e01cdbbfe398` |
