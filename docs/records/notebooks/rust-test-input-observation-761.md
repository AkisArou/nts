# Rust test input observation (#761, machinery slice)

The opt-in observer now completes the workspace census through the supported
landing route, without ptrace or a sanitizer-policy change. At source
`a3eb0cc82af1b7944654d31d56dc8a7baacc36da`, all 55 Cargo executable targets have
complete raw/index pairs, alongside the original Cargo/rustdoc pair. Both the
ordinary and observed supported runs are green, as is the actual contributor
`inner.ts --no-agree` route.

This is **Part of #761**. It adds observation, attribution and bounded
publication. Runtime reader declarations and removing `clippy`/`tests` from
`ALWAYS` are still owed and require their own coverage/selector review. No
retirement of a Rust obligation is claimed here.

The [companion JSON](rust-test-input-observation-761.json) contains source
fences, actual identities, all executable owners and index terminal counts,
retained artifact sizes/digests, the complete component table and excluded
attempts. Off-tree evidence lives under `~/.cache/nts-scratch/761/`, retained by
`tooling/full-check/keep.json`. Large raw streams and derived path tables stay
there rather than growing the repository.

## Invocation and identity

The accepted ordinary command was:

```sh
node tooling/landing/check.ts a3eb0cc82af1b7944654d31d56dc8a7baacc36da --here
```

The accepted observation used the same owner and source:

```sh
node tooling/landing/check.ts a3eb0cc82af1b7944654d31d56dc8a7baacc36da --here --trace-rust-inputs
```

Each ran in its own named collected agent unit and used the route's own
admission. There was no outer gate reservation, handcrafted oracle environment
or `NTS_BIN`. Source stayed frozen during execution. The trace flag is local to
`--here`; queue, status and dry-run reject it. Ordinary landing and full-check
selection are unchanged.

Cargo's actual artifact report supplies executable-to-target/source identity.
The optional `test-profile.ts --artifacts <absolute path>` output also retains
actual Cargo status and build-finished evidence. Temporary doctest programs
execute during the first Cargo/rustdoc lifetime; only binaries below the
selected profile directory enter the workspace replay. Identity-bound command
records use PID/birth and expected image, and actual image/argv observations
select phases. A proposed exec path does not establish entry.

## Observation and publication boundary

The native Linux observer uses seccomp user notifications and continuation,
with one syscall table shared by its filter and decoder. It records raw path
bytes, descriptor candidates, cwd, actual image, PID/birth and ancestry. These
facts are read fresh at each notification. Path and argument capacities are
bounded, and unreadable or truncated filesystem facts refuse census
completeness. Null-path descriptor operations retain valid file candidates;
non-filesystem dirfds remain explicit probes.

Every outcome is **unknown**. Neither raw/index records nor derived tables say
that an attempted open, lookup or directory enumeration succeeded. Eighteen
input-free canceled lifetime facts remain explicitly unattributed; they grant
no source, image or filesystem input. Setup/runtime phases are kept separate.

The child preserves product argv, input/output, signal mask and non-private
file descriptors. The observer distinguishes an initial exec error from a real
exit 127, and joins descendants/filter drain before final status. Supplied
elapsed observations test the existing five-minute wedged startup/drain
backstop; ordinary execution retains the existing product/step bounds. A real
ready descendant control covers drain. Clean/leaking sanitizer controls detect
the same deliberate 91-byte leak with observation off and on.

Raw records are version 2; attributed indexes are version 3 gzip line records.
Native output checks buffered compression and final close before atomic
publication. The shared durable publication owner streams indexes, preserving
the previous final file when a producer/output fails. The consumer streams the
same format, bounds each decoded row at 256 KiB and validates version,
attribution, terminal counts, native completion and gzip CRC/EOF. The 64 KiB
publication threshold is a flush target, not a hard batch-size ceiling. The
paired scale control exceeds Node's maximum single-string length without
building the whole index as one string.

An incomplete trace is a typed `tooling-setup` INSTRUMENT. It does not erase a
completed failed Rust assertion or Cargo's actual compile/doctest failure. Real
small-Cargo mutants cover a broken binary trace with a Rust panic and a broken
Cargo trace with an actual failing doctest.

## Accepted cohort

| Route | Native | Tooling | Completion |
| --- | --- | --- | --- |
| Ordinary supported | 3,047 passed, 0 failed, 8 ignored | 2,272 passed, 0 failed, 2 TODO | All 12 requested steps PASS; canonical; cleanup complete |
| Observed supported | 3,047 passed, 0 failed, 8 ignored | 2,272 passed, 0 failed, 2 TODO | All 12 requested steps PASS; canonical; cleanup complete |
| Actual contributor inner | fmt 3 s; Clippy 1 s; build 0 s; tests 310 s | Covered by supported runs | All four phases PASS; normal unit end |

Ordinary run: `here-a3eb0cc82af1-1794575634050`.
Observed run: `here-a3eb0cc82af1-1794576312293`.
The observed test step took 546.670 wall seconds and 5,096.788162 cgroup CPU-s;
the existing 900-second bound is unchanged. These sequential routes are product
and completeness evidence, not a matched whole-step overhead experiment.

The accepted inventory has 56 complete indexes and no pending pair:

| Phase | Observation rows | Probe rows | Actual image contexts |
| --- | ---: | ---: | ---: |
| Test runtime | 17,758,557 | 75,804 | 53,179 |
| Cargo setup | 138,907 | 738 | 363 |
| Rustdoc setup | 57,581 | 62 | 34 |

The runtime path tables contain 61,253 repository and 402,189 external
source/path rows. These are sums over source owners, not globally unique
paths. They retain operations, syscall names and explicit `outcome: unknown`.
The final summary is `inventory-v5/final-summary.json`.

The first derived tables omitted that label although raw/index outcomes were
already unknown. They remain as superseded evidence. The corrected derivation
verifies exact canonical row preservation after removing only the new field.
Corrected compressed table digests are:

- Repository attempts: `83a03ed6922c958470bf9480fe5b8c6456dd36df8cce918f058a0b43a5054696`.
- External attempts: `ffcf57e19bbee02b5c4202a093ac3f23ce1ae1ea2476c14d6f029861e7366231`.

### Doctest coverage

The same owner listed the same workspace/default-feature/host-target selection:

```sh
node tooling/gate/test-profile.ts --artifacts /home/akisarou/.cache/nts-scratch/761/doctest-list-artifacts-v1.json workspace --doc -- --list
```

Its 18 crates list eight cases, all `compile_fail`, and zero executable cases
for this invocation. The eight literal fences are authenticated against the
pinned source in `inventory-v5/doctest-cases.json`. The accepted call/trace
inventory contains 26 rustdoc `--test` image contexts, zero doctest call-record
attempts and zero doctest-runtime frames. Image contexts are not counted as
distinct exec invocations.

The separate real small-Cargo control executes a successful doctest and
requires its runtime attribution. This positive mechanism proof is distinct
from the workspace's compile-fail population.

## Profile and contained buffer change

The earlier compressed observer reached the unchanged test-step bound. A
fixed native component isolated supervisor work: fresh proc observations were
retained, and a userspace clock profile located 32.51% of samples in resolved
`memcpy` PCs and 19.88% in `memset` PCs. Caller disassembly showed repeated
64 KiB value copies/zeroing, rather than a need to cache kernel facts. The
unresolved libc bucket alone was not used to assign all its samples to
zeroing. Refused perf sampling and the failed callgrind attempt stay excluded.

The change replaces by-value byte storage with views into independent caller
buffers. Cwd, image, argv, both pathnames and descriptor facts remain live
through serialization. Short, exact-limit, over-limit, error, two-path and
poisoned-unused-tail controls check initialization and aliasing. No task fact
is reused. Nine decoded boundary fact outputs are byte-equal without
normalization: 139,807 bytes,
`c385045015122d4fa92f708c5272b0988a311c6663c5ff20db5afbf83ce5c490`.

A fixed 100,000-loop component ran old/new/new/old under
`with-lock.sh --wait --key perf-count taskset -c 4`, using the existing
`PERF_ARGS`/`parseMeasurement` owner and inherited user instruction counters.
The old source is `8ee3ea60fc08165f230b48f574b8134b9a4d0907`; new is the accepted
source above. Each arm has 400,010 complete notifications, zero observer
errors, identical stdout `12000000` and product status 0. Validation and full
record decoding follow the measured interval. `result.json` is final;
`rows.json` is the intentionally incomplete checkpoint.

| Engine | Instructions | Cgroup CPU-s | Retained scope peak bytes | Wall-s (1-minute load per arm) |
| --- | ---: | ---: | ---: | --- |
| Old | 31,259,761,312 | 12.106389 | 70,793,216 | 12.146106 (26.21, 27.61) |
| New | 30,979,985,370.5 | 5.888131 | 72,030,208 | 5.914496 (25.96, 26.36) |
| New/old | 0.991050 | 0.486366 | 1.017473 | 0.486946 |

This is a component CPU improvement beyond arm spread: every new CPU arm is
below every old arm. Instruction movement is smaller and reported separately.
The reset scope peak includes the driver; it establishes no native memory win.
This does not claim a matched whole-step speedup. Source/binary hashes, actual
wrappers, raw counters and all arm facts are retained in the companion.

## Excluded attempts

- The ptrace census at `ebbef6787a69dd46fef5ee226889b1a4c0701d03` had 19 native
  failures from LeakSanitizer incompatibility. It is not accepted coverage.
  Sanitizer settings were kept; the observer mechanism changed.
- The uncompressed native attempt at `636057b060ded1dc059c9560a496339c59b0c3ba`
  was stopped by its own unit before output threatened disk headroom. Its raw
  bytes were compressed after drain and verified before redundant raw removal.
  It remains incomplete. Its separate removed-slice cleanup diagnostic is #775.
- The compressed attempt at `e7d96add8399e6fb8bac9a9b69bafa15cd3c6932` passed
  native product assertions but failed census acceptance on canceled input-free
  exits and the monolithic index string limit. Those are distinct results.
- The attempt at `8ee3ea60fc08165f230b48f574b8134b9a4d0907` retained 55 complete
  pairs and one incomplete differential trace when the existing bound ended
  its scope. It supplied no complete native-census claim and was not rerun
  unchanged. Actual profiling led to the reviewed buffer representation.
- Targeted development failures remain retained: a joined-stream error,
  private C indentation/fd typing, an incomplete private fs mock and an overly
  narrow poisoned-tail assertion. The companion names their cohorts and fixes.

No partial terminal index, forced stop, failed profiler or product-only green
is counted as complete observation evidence.

## Derivation and remaining work

Exact retained derivation commands and tool digests are in the companion.
The original inventory reader consumes every typed index with completion
checks. `explicit-attempt-inventory-v1.ts` adds the unknown-outcome label while
checking prior rows; `annotate-doctests-v1.ts` binds listing positions to the
actual compile-fail fences. These are pinned investigation tools, not a second
production declaration mechanism.

The next slice must classify these attempts into the existing reader language,
cover runtime reads with those declarations, validate undeclared candidates,
and prove the selector/census delta before changing `ALWAYS`. Unknown syscall
outcomes, probes and setup/runtime attribution remain explicit inputs to that
review. This machinery slice makes none of those policy decisions.
