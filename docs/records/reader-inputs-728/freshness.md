# Offline generator freshness — finishes #728

Source `9d0f2fee79912284f73dbf87cd20ca159b51402e` against `4320cc9c2b4125934257a8d55ed560996745ae76`. The final scanner-removal record remains removal.md; this closes its explicitly retained generator gap.

One catalog owns URL, hash and Unicode source version. The explicit input owner acquires and publishes through the existing lock and durable-record owners. Every offline consumer verifies actual bytes again; missing, corrupt or future-version content refuses by name without fetching or overwriting it. The cache is an explicit canonical/fixture content capability. Bootstrap provisions it; an existing machine uses `node tooling/inputs/pinned-inputs.ts --acquire unicode-idna-17`.

The generator declares its exact Node pin and generated-data directory. `unicode-freshness` runs its existing --check with one tree-only slot and no compiler capability. The --data-dir override still validates the same SHA and source-version header. The gate and test fixtures never need a network request.

## Identity and failure controls

Previous/current generators ran on the same 775,973-byte official input, SHA-256 `beb5d0be20e896189b03209a82fdc34f06351502bbd4b8e2523583fc2954d9cf`. All 27 generated files and 6,391 source rows are byte-equal; summaries are equal. File inventory digest: `90426e98fae651e18953729adce1e4c0300897ccec28ab8104dd8468bc135b87`. No product fixture or outcome row changed. The complete file hashes, source/engine pins and exact commands are retained in the digested identity result. Temporary source/archive/output copies were removed together.

The real staged shell step passes on matching output and refuses changed, missing and extra outputs without rewriting them. It publishes a named setup instrument failure for missing offline input. Controls also preserve the explicit data-dir route, reject bad hashes, keep future cache rows byte-for-byte, require a fixture cache capability, and sequence overlapping acquisition by entry/release events rather than elapsed time.

## Final placement

Existing raw graph and actual route losses: zero. The generator now owes tooling and freshness, with none of the three TypeScript backend execution steps or their oracle-preparation companion. Both switch-off censuses remain zero.

Fallback stays 142. Full-policy inventory is 33 → 36: the three new pinned-input owner/catalog/test files deliberately inherit the existing full gate input-provisioning rule. They are listed in freshness.json; the policy cost is distinct from unknown reach. The tool-written full-gate inventory records those additions.

Raw graph additions: 1,073: 1,058 freshness pairs, one tooling reader for the tested generator, and 14 conservative shell bootstrap-continuation pairs (eight test262, six addons). The latter are listed separately; shell inference remains additive and receives no authority to place unknown paths. Full pairs, pins and digests are retained in freshness.json's census artifact.

## Proof

Focused owner/route/consumer/timing: 177/177, no failures. Host: 1,883 sources / 260 closures / 413 reads. Strict: 824 modules, 5,707 recorded diagnostics, 15 improved, no new diagnostics.

Supported command: `node tooling/landing/check.ts 9d0f2fee79912284f73dbf87cd20ca159b51402e --here`. GREEN: 2,221 tooling passed, 0 failed, 2 TODO; 3,044 Rust passed, 0 failed, 8 ignored. Gate wall 1000.512 s; admission wait 971.788 s is separate and can overlap execution.

The actual freshness step used 0.214428 cgroup CPU-s, 0.254 wall-s and 76,558,336 peak bytes. This is a cost observation, not a cross-run speed claim. Excluded early failures and all reproduction commands are in freshness.json.
