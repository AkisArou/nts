# Oracle reservation fixture input closure (#761)

The fixture used by Rust's real reservation control copied all of tooling/
into its private tree before staging the runner and recipe. It now stages only
copyModuleClosure's executed runner closure and oracleWorkspaceFixture's
production recipe assets. The optional retained helper mutation runs after both
immutable stagers. There is no second dependency list or copier allowance.

Source f73b4a29975392cd203d7cca6bbdde5c99ccccee is based on 2f97e2913ed67b43fb2e38e991e4486eceb24f55. Its only implementation change is
tooling/differential/oracle-reservation-fixture.ts; it is byte-equal to the
reviewed pre-rebase correction. Runtime declarations and ALWAYS are unchanged.

Both the ordinary and traced supported check.ts --here runs pass all 19
requested steps, with canonical environments, empty experiment lists and
complete scope cleanup. Each passes 3,045 native tests (zero failed, eight
ignored; 55 binaries and 18 doctest crates) and 2,281 tooling tests (zero failed,
two TODOs). Actual inner.ts --no-agree passes fmt/Clippy/build/tests
(3/0/0/745 s), explicitly including
preparation_inside_the_tests_step_asks_the_host_for_no_memory. Focused
selector/copier/consumer/timing proof is 197/197; host and strict pass.

The ordinary and observed runner wall intervals are 1,233.748 s and 616.154 s;
their surrounding CLI reports are 1,240 s and 618 s. These are distinct
intervals, with admission waits overlapping other activity. They are not a
performance comparison. The first run waited at disk TemporaryAdmission before
builder entry. Retained snapshots show insufficient available bytes, followed
by admission with 44,342,534,144 free bytes against 44,023,414,784 required. Only
obsolete debug output and closed build scratch in our owned trees were cleaned.
Later registered cache upkeep removed nothing and gets no credit for admission.
No floor, queue, unit or verdict policy was adjusted.

The fresh inventory accepts 55 Cargo target identities and 56 complete typed
indices, preserving all 56 raw/index pairs off-tree. There are
17,381,958 runtime attempt rows,
75,597 explicit runtime probes and
22 input-free canceled lifetime facts,
retained without an attributed image. Every derived path row explicitly says
outcome: unknown: a pathname attempt or descriptor candidate does not prove a
successful access. Cargo/rustdoc setup stays separate from runtime. This
invocation has no doctest-runtime frames; the prior same-configuration listing
and compile-fail source fences, plus the separate real executable-doctest
positive control, retain that boundary.

Compared with accepted prior census a3eb0cc82af1b7944654d31d56dc8a7baacc36da, tracked-file losses occur only
in the two expected harnesses: 2,312 source/path pairs from JVM integration
after its scanner operation moved to jvm-members, and 1,092 from differential
lib after the whole-tooling copy was removed. Their tracked-directory losses
(378 and 64) remain separate. tooling/full-check/keep.json is absent from both
former readers. No tracked-file pair is added. The complete raw path delta
separately retains build/scratch-name churn, other probes, and 192 common-pair
operation/syscall changes. These observations do not retire an input claim.

Reproduce the derivation and comparison with the retained
input-inventory-v6.sh and compare-input-inventory-v6.sh, under the named
rust-input-inventory admission key. The companion records their exact bytes,
source receipts, complete target/terminal inventory, full deltas and
239 artifact sizes/digests. All prior incomplete machinery cohorts
remain in rust-test-input-observation-761; they are not relabelled here.
