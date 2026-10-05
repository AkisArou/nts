# Parallel compiler development and validation

This describes Main's working process as of 2026-10-05. The implementation and
measured evidence determine completion; the RFC and older planning documents
are historical context. See [compiler-delivery-plan.md](compiler-delivery-plan.md)
for feature contracts and dated checkpoints. A private integration checkpoint
can contain unfinished work and is not a main-branch acceptance claim.

## Ownership and isolation

Main acts as integration owner. Three compiler workers can investigate, implement
and review concurrently; Main reviews their interfaces and integrates commits
serially. Runtime/platform peers retain their existing ownership. In particular,
coordinate JVM backend/runtime edits and runtime-JAR rebuilds with its owner.
An unavailable peer does not remove the corresponding validation obligation.

Before coding, each assignment records:

- Baseline commit and a genuine control compiler, plus the fixed frontend.
- Owned files/functions, the intended interface and explicit exclusions.
- The actual source/storage/effect facts the implementation consumes.
- A failing witness, expected tested roots, positive controls and must-fire
  counterexamples; any runtime or backend obligations.
- Compile-time, allocation, ownership and emitted-code growth expectations.

Choose independent architectural boundaries. Shared files such as `lower.rs`
need function-level coordination before edits. Workers reuse existing source
analysis, effect worklists, successful-entry recorders and publication boundaries.
Adding another analysis or authority requires an explicit architectural reason.
Source metadata and predicted copy eligibility are requirements; they do not
certify a successfully emitted body, a decoder or a physical layout.

Each worker uses a separate checkout or Git worktree, branch, Cargo target,
snapshot cache and temporary-output directory. Use an absolute manifest path
for the physical checkout. Workers deliver reviewable commits to Main rather
than independently advancing the shared branch. Preserve other lanes' working
changes and staging; never reset, clean or commit the whole shared tree.

## The iteration loop

1. Read the handoff and current code. Reproduce the concrete failure on a pinned
   control. Locate its first independent cause before choosing a fix.
2. Agree the small operation/interface contract. Separate source requirements,
   actual successful products and validation of the current consuming operation.
   Preserve source context, layouts, exception modes, identity and mutation.
3. Implement in isolation. Run the reduced witness and relevant units. Add
   adversarial controls for changed/missing bodies, operands, roles, storage,
   absences, exception tests and exhausted analysis budgets where applicable.
4. Freeze a physical candidate. Check behavior on affected backends, retained
   roots and ownership. Inspect actual HIR, layouts and emitted changes.
5. Deliver commits, receipts and remaining obligations. Main reviews the final
   implementation, integrates serially, resolves interactions and validates the
   combined compiler. Isolated success does not prove combined correctness.
6. Assign the next measured dependency after the packet is reviewable. Keep
   related incomplete contracts visible; do not call a primitive-only slice the
   completion of composite any/unknown specialization.

When a check fails, preserve its receipt and distinguish a compiler defect from
an instrument/setup failure. A corrected instrument needs a complete rerun.
Do not erase earlier failures or repeatedly run a broad suite while its known
first blocker remains. Edit and review other independent work while heavy checks
are queued.

## Validation budget

The full gate takes roughly an hour on this machine. Reserve it for a stable
combined checkpoint; use progressively wider, relevant checks during development.
Record deferred checks as obligations, including those tracked by `owed.mjs`.

| Stage | Checks | When to run |
| --- | --- | --- |
| Local iteration | Reduced control/candidate witness, affected units, lint | After a relevant implementation change |
| Worker acceptance | Affected whole programs, exact roots/counts, backend and ownership controls, emitted-code comparison | At a frozen candidate |
| Targeted conformance | Relevant census rows and affected recorded outcomes/blockers | After behavior changes; use judged outcomes |
| Combined checkpoint | Combined witnesses, affected recorded sets, required platform/integrity/interop checks and cost | After serial integration or a semantic interaction |
| Full gate | Complete required gate on the final combined pin | Once known blockers are resolved and the checkpoint is ready to land |

Select gate steps explicitly when only those obligations are relevant. For
example, the recorded test262 steps can run against an immutable compiler:

```sh
NTS_BIN=/absolute/path/to/pinned/nts \
NTS_TSGO=/absolute/path/to/frozen/tsgo \
NTS_GATE_STEPS="test262-cases test262-rest-cases" sh tooling/gate/all.sh
```

The affected checks depend on the change. Representation and dispatch work owes
JVM verification and whole-program execution under `nts.rt.NtsMain` with
`-Xverify:all`. Public signatures owe interop/API capture. Lifetime changes owe
sanitized native execution, reference-count poison/live-balance checks and
ownership inspection. Test supported behavior across C, C/RC, LLVM, LLVM/RC and
JVM. JVM unresolved, shadowed or unfilled raising entries are hard failures.

Passing means the intended observable behavior ran with the expected subjects.
An empty exit-zero program, missing root, dropped caller, runtime refusal,
invalid HIR, interrupted run or OOM is not a pass. A crash repaired into an honest
refusal is a safety improvement, not a conformance gain. Keep such transitions
and still-wrong accepted negatives explicit. Do not weaken records, floors,
known lists or ABI guards to turn a candidate green. Coordinate conformance
record changes and post-landing banking with their owner.

## Evidence and reuse

Each acceptance packet records source commit and patch/manifest identity,
physical checkout and exclusive target, compiler and frontend hashes, corpus
selection, exact commands, configuration, attempted/completed counts, tested
roots, results and outstanding obligations. Retain raw outputs and before/after
artifacts. A dev checkpoint built from a verified physical tree is labelled as
such; it does not claim release `pin.ts` provenance.

Reuse a receipt only when the relevant compiler code, frontend, source inputs,
configuration and instrument are identical. Later documentation-only changes
need no compiler rerun. A semantic integration needs the affected checks again.
Reuse unaffected results with a stated basis, not an assumed clean gate. Compare
raw/prepared HIR, layouts and emitted artifacts on identical source paths when
claiming byte identity; path-normalized output is a different measurement.

Inspect allocation placement, boxing, reference-count operations, generated
copies and code size. Benchmark when the changed path introduces a plausible
runtime cost. Bound analysis depth and retained volume before cloning payloads;
reuse cached facts and keep unneeded paths allocation-free.

## Memory, scheduling and disk

After the system OOM, this team's policy is one heavy subprocess tree at a time.
Compilation, frontend/corpus probes, native runs and JVM suites share that token;
parallel editing and review continue. Cargo jobs are two, and test/NTS jobs one.
Heavy work waits for 12 GiB of host memory headroom and runs in a systemd user
scope with `MemoryHigh=6G`, `MemoryMax=8G` and `MemorySwapMax=2G`. These are current
machine limits, not portable project requirements. Reassess them when workloads
or hardware change; do not bypass them to avoid the queue.

The current local coordinator is
`~/.cache/nts-parallel-20261004/run.py`; lane environment files provide isolated
paths. A session command is, for example:

```sh
python3 ~/.cache/nts-parallel-20261004/run.py integration heavy \
  cargo test --manifest-path /absolute/integration/tree/Cargo.toml -p nts-core --lib
```

The scope accounts for descendants and preserves sanitizers' virtual-address
reservations. Resource-limit, preflight and partial runs remain incomplete until
fully rerun. User Chromium/Electron builds and unrelated processes are preserved.

Cache directories can contain source checkouts, SDKs, pins and evidence. Audit
ownership and active use before removing only confirmed inactive generated build
outputs. Do not delete an entire `~/.cache/nts*` root to recover space.

## Serial integration and landing

Main reviews the packet's actual diff, architectural rationale, control failure,
behavioral evidence, emitted changes and limitations. Cherry-pick the reviewed
commits onto the integration branch one at a time; resolve shared-function
conflicts by their contracts. Build a new immutable combined pin and discharge
the affected combined obligations before advancing main.

Land only the exact reviewed and validated scope. Keep independent documents or
safe prerequisites separate from held feature activation. Update the delivery
plan and handoff with the actual landed state, remaining blockers and applicable
receipt locations. This lets the next session continue without repeating prior
work or mistaking a held prototype for implemented support.
