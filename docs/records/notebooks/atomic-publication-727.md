# Rust publication owns each writer's staging

[#727](https://github.com/AkisArou/nts/issues/727) replaces the production Rust publication recipes with the std-only nts-publication leaf. The check-first inventory on main 29a6af1297e0 still found nine production filesystem renames, including all three PID-only sites from the card. Private scratch/trace namespaces and actual test mutations are distinct from publication and are not converted merely because a name contains a process ID.

| Production publication | Existing boundary retained |
| --- | --- |
| SwiftPM manifest | Best-effort cache; publication failures are now named on stderr |
| Native dependency archive, then completion manifest | Existing entry lock, archive hash/observations and archive-before-completion order |
| Component notice | Existing entry lock and bytes |
| Oracle improvement hint | Same hint body; no new count or verdict authority |
| Compiled object cache | Same source/flags/inputs and final key; only private output operand changes |
| Generated surface package directory | Valid target reuse, invalid quarantine/restore, identity-locked prune |
| Project package symlink | Atomic replacement; legacy directory conversion under the same locked committer |
| Executable JAR | Same operands/flags/content setup; private output operand changes |

The owner exclusively creates a sibling claim named by PID and one process-wide checked serial, retrying collisions without removing them. Payload creation belongs to the producer. File/link publication is one std rename, with no destructive remove/retry fallback if a host refuses replacement. std's Windows implementation supports file replacement; directory replacement uses locked quarantine. This is atomic visibility, not an fsync durability claim.

One persistent lock file per parent bounds metadata as target versions change. A process registry maps canonical parent to ThreadId: same-thread nesting refuses by name, competing threads wait on its Condvar, and File::lock coordinates processes. The synchronous Lock is not Send. Its File drops before its registry claim wakes another writer. The surface identity lock is in the cache root; the fingerprint commit lock is under identity/version, so those nested parents differ. Linking runs after ensure releases its guard. The control exercises actual nesting, same-parent refusal/reacquisition and a symlink alias.

Directory publication validates its complete staged payload and reuses a valid target under the lock. An invalid target moves into this claim's quarantine. Failed publication restores it; if restore also fails, the old bytes remain at the named recovery path and both errors stay visible. Cleanup can remove only the exclusively acquired claim. Surface staging, commit and pruning share their identity lock; committed-entry recognition and private namespaces prevent pruning live staging. The object pruner ignores claim directories.

The Rust token audit, invoked by test-layout, rejects production filesystem rename references outside the owner, including imported aliases. It ignores comments/literals and follows actual cfg(test) module ownership; a _test filename is no exception. The new crate has workspace membership, a declared integration harness and an owed directory rule.

| Deciding control | Actual result |
| --- | --- |
| Two threads publish one whole file, leaving foreign staging sentinel intact | passed |
| Two directory writers complete, one publishes and one reuses a complete target | passed |
| Actual claim collision is retried and only our claim is removed | passed |
| PID-only recipe with supplied process identity | Old recipe aliases and removes the first unfinished staging; component control, passed |
| Refused producer/rename keeps existing target; invalid directory repair | passed |
| Actual quarantine with supplied publish failure | Old directory restored; passed |
| Actual quarantine with supplied publish and restore failures | Both errors plus retained old-byte recovery path; passed |
| Concurrent links replace a legacy directory | passed |
| Parent lock count, actual nested flow and canonical alias | passed |
| Private claims cannot trigger object-cache pruning | passed |
| Tokenizer controls/full Rust layout/selector/audits | Focused V2: 10/10 and 1/1; layout 31 harnesses/331 cases; all audits 0 |
| Admitted Cargo check | All targets in publication, build, cli, differential and surfaces: green |
| Required inner | fmt 3 s, Clippy 2 s, build 3 s, tests 482 s, frontend-tsrs 25 s; all 13 publication and cache-prune controls passed |
| Supported route | 19 PASS rows; canonical/no experiments; complete cleanup and diagnostics |

Focused V1 stopped at strict checking on the new owed callback's missing string annotation, before controls. Inner V1 and V2 stopped at Clippy before runtime tests; inner V3 stopped at the standard PathBuf handoff type error. Compiler-directed API/style corrections introduced no allowances or policy changes. These REDs are retained and excluded from the final green chain. Proof source: 9a731e3ac902650f61490c7d91adf88825af6e86. Raw evidence: /home/akisarou/.cache/nts-scratch/727/raw-evidence-v1.json, SHA-256 07ce92c853478786c120d22a11224bdb9f8c8e331e9093ea911fc459f81a5792. The finite manifest binds all deciding logs, source receipts and excluded REDs; compiled artifacts and regenerable run trees are omitted. There is no performance claim.

Publication-parent listers were checked beyond pruning.

| Reader | Parent and disposition |
| --- | --- |
| tooling/surfaces/src/lib.rs | surfaces store identity/version/fingerprint: private_name plus regular directory and committed key/manifest evidence; identity lock covers staging and prune |
| tooling/differential/src/objects.rs | object-cache root: private_name and non-file exclusion now precede KEEP count; deterministic private-claim threshold control |
| tooling/cli/src/objc_bindings.rs | project/.nts/objc: separate direct-write store; surfaces Store users call ensure/link, do not enumerate types store |
| build/src/node_deps/source.rs | `node-deps/source/<hash>`: source subtree only; publications are sibling `archives/<key>/<target>` and `notices/<key>`, read by exact returned paths |
| build/src/node_deps/search.rs | compiler search roots: compiler configured search roots, separate from archive/notices publication parents |
| build/src/dependencies/swiftpm.rs | swiftpm-manifests: exact fnv-key .json paths; read_dir calls concern package products or tests, not cache selection |
| build/src/swift.rs | nts/swift: different cache from swiftpm-manifests; requires usr/bin/swift-frontend |
| tooling/differential/oracle-records.ts | oracle-record/improvements: fixture inventory -> exact SHA-keyed JSON path; never enumerates hint cache |
| tooling/records/record-pending.ts | oracle-record/improvements: delegates exact keyed hint reader; no raw directory count/selection |
| tooling/cli/src/main.rs;tooling/cli/src/jar_resources.rs | JAR inputs, resources, native/Java source trees, DEX scratch: JAR --file payload is outside -C built input tree; final artifact uses exact name; DEX lister selects regular classes*.dex in separate scratch |
| tooling/census/node-deps-cost.ts;tooling/census/node-deps-target-cost.ts | private experiment node-deps archives: XDG_CACHE_HOME is per experiment; inventory runs after awaited child drain, selectors require .a/.command.json or complete.json; file publication leaves no persistent lock |
| tooling/full-check/count.ts;tooling/full-check/keep.json | nts/types, differential-objects, node-deps, swiftpm-manifests: kind kept does not enumerate descendants as candidates; allocated-byte size accounting intentionally includes all actual metadata |
| tooling/differential/src/oracle_emit.rs | captured input directories: truthful directory observations, not cache entry selection or cleanup; no private-name filtering is appropriate |

The first complete inner kept all twelve new publication controls green. Its sole RED was the old surface test counting a private lock file as a second identity. The assertion now counts identity directories separately from exactly one private regular lock entry, retaining the one-identity guarantee. The lister audit additionally found object pruning counting live claims before its threshold; private/non-file exclusion moved before the count, with a deterministic private-cache regression control.
