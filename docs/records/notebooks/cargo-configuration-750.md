# Cargo configuration belongs to the gate

The [accepted #750 contract](https://github.com/AkisArou/nts/issues/750#issuecomment-6889702640) uses one Cargo invocation owner for gate and test builds. It refuses config or config.toml in the logical and physical cwd ancestry or the declared Cargo home before launch and after drain, plus applicable rustup directory overrides, incoming RUSTUP_TOOLCHAIN and caller configuration/cwd/toolchain overrides. Both complete shared homes retain their existing registries, downloads, locks and GC state. Rust test children stay inside checked tree or supplied scratch roots.

The paired real test-profile control uses exact old main 74f54551da0949e67482ceb3598b2d63c0f5a94c and guarded source ba324e1e32df299b4516913483b3fec1511c6e5a, private crates/homes/targets, and no probe in either launch environment. A poisoned [env] entry is the only difference from each clean arm. These are actual offline Cargo builds, not supplied compiler outcomes.

| Owner | Configuration arm | Exit | Compilation reached |
| --- | --- | --- | --- |
| Old owner | clean | 0 | Yes |
| Old owner | home | 101 | Yes |
| Old owner | parent | 101 | Yes |
| Guarded owner | clean | 0 | Yes |
| Guarded owner | home | 1 | No; named INSTRUMENT refusal |
| Guarded owner | parent | 1 | No; named INSTRUMENT refusal |

Current parents also guard historical code. The selector parent retains the same guard through the endpoint child's actual exit; a historical beforeExit write after its query is therefore refused. The pinned parent checks its known tree and run scratch before setup, again after checkout before historical code enters, and after execution/drain while holding the tree lock. A green child summary cannot bypass a post-drain refusal. Unrelated typed errors retain their existing selection classification. Historical source is never rewritten.

The command-entry owner now publishes typed instrumentation receipts for handled synchronous and rejected command failures as well as uncaught failures, retaining primary and publication/cleanup causes. The two sealed oracle inventories include the moved instrument leaf. This omission was found by source inspection; the new independent parsed-closure comparison fails against the exact old inventory and passes against the corrected inventory. The full native route also passes with the actual embedded materializer.

| Validation | Result |
| --- | --- |
| Final Cargo, historical endpoint and pinned-parent controls | 49/49; no failures, skips, cancellations or TODO |
| Timing lint, host audit, strict tooling | Pass |
| Final supported landing route | 19 summary steps PASS; canonical, no experiments; cleanup and diagnostics complete |
| Required inner route | Status 0; formatting, Clippy, fresh compiler and crate/backend tests passed |

Earlier focused and supported fixture failures, the refused hand-typed setup pin, and the interrupted V7 are retained separately in the raw manifest and support no acceptance claim. Supported V2 passed before the historical lifetime extension; final acceptance uses the later frozen source below. A configuration edit followed by an identical restoration between observations is outside this two-observation fence. No timing improvement or benchmark change is claimed.

Raw evidence: /home/akisarou/.cache/nts-scratch/750/raw-evidence-v1.json, SHA-256 6d570025b073341d668325d31274b4a83a16fa4915e350e9f8ad94160f39abf2. The finite manifest binds selected sources, paired outcomes, logs and immutable Git receipts. Proof source: b382daa5af438a5418f250150a2aec14e0e52dcf.
