# Pinned preparation owns only Cargo — #774

The pinned wrapper ran its initial release Cargo build before the gate runner,
without the ledger. A whole-wrapper admission is not a substitute: canonical
entry discards that reservation marker, leaving the wrapper's owner alive
while the runner independently reserves memory. The interrupted #681 attempt
is retained as incomplete and is not proof.

The fix invokes the existing `admit.ts` around that Cargo command alone. Its
stable `pinned-build` key has whole-job meaning, and `CARGO_TARGET_DIR` is set
before sizing. GNU time runs inside admission. The timed command exits before
the shell enters the gate; the runner's next decision retires its exited owner.
No new size, cap, reservation protocol or build command was introduced.

Source: `f35afa5e4813ec8c0f9ffe037f6b7f3e292ac40f`; the actual launcher
`4c635792ae764ff4f6fd58f416b92c36a4aea7d2` adds only contract/retention text.
The current controls pass both status arms; exact baseline
`9b3d95c5d900d3f989bee8a4dcd2c482557dd0af` fails both for missing admission.
The barrier proves a live build owner, no gate entry before release, and no
live build owner or handle at gate entry. Cargo status 23 skips the gate.
The original owner is supplied only to the private fixture, with no source
checkout or mutation.

The focused pinned/canonical/sampler/timing/owed/selection/report-consumer batch
passed 170 tests. Host ownership and strict tooling checks passed. The first
private barrier attempt and the subsequent missing-affinity-export attempt
are retained and excluded; neither is represented as green.

The actual canonical pinned route drove the #681 tip
`4ed677760685a98b374ddc7877ade7d4ddbcd9b9`. Its build and both preparation
tripwires passed; cleanup completed. The ledger checkpoint during the gate
contains only its independent runner reservation and no preparation owner.
The [companion record](pinned-preparation-774.json) retains the precise checks,
checkpoint, route identities, rusage basis and artifact digests. No speedup is
claimed. The Cargo rusage excludes its admission wait; run-unit CPU excludes
work executed in separate owned scopes, so those figures are not substituted.

The first landing was refused on three fixture failures: the full-check pinned
fixture had not staged the new admission entry, and both new controls inherited
the canonical parent's step marker. The corrections stage the executed closure,
retain the private affinity module's exports, supply complete owned observations,
and construct then explicitly isolate a canonical tooling parent. The production
nested-entry guard and `pinned.sh` bytes are unchanged.

At corrected source `12a21f72ce2dd706af9db70c72824cf13ecd38bc`, the focused batch
runs with the real test-host preload and passes 180 controls. The supported
`check.ts --here` passes every requested step, with 2,260 tooling passes and two
existing TODOs, and 3,047 native passes with eight ignored. Its summary is canonical,
contains no experiments, and reports completed scope cleanup. The old owner still
refuses both corrected admission controls. The intervening private Git identity
setup refusal is retained and excluded. The earlier canonical tripwire proof
remains pinned to its original launcher and candidate; it is not relabelled as
this later run. The companion JSON records both cohorts and the refused landing.
