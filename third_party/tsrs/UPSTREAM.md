# tsrs, vendored

The production dependency closure of tsrs_compiler from
[oxc-project/tsrs](https://github.com/oxc-project/tsrs) at
`86de03ae428a956686af29177b50f0fdf4aee059` (version 0.24.0), with the explicit local patches below, LICENSE and NOTICE.
The generated root Cargo.toml retains upstream package metadata, dependencies
and lints, over these crates only. nts excludes this standalone workspace
and consumes its crates by path. UPSTREAM.json records the exact closure.

Re-pin in one command:

    node compiler/frontend-tsrs/vendor.ts --source <checkout> --rev <commit>

The tool reads immutable git objects; it does not change the source checkout.
Before replacing an existing copy it verifies MANIFEST and refuses local edits.

    node compiler/frontend-tsrs/vendor.ts --check

The gate checks the SHA-256 manifest, including file inventory, without an
upstream checkout. --source <checkout> --rev <commit> --check additionally
compares the copy with the exact upstream objects plus these reviewed patches.
A new revision is refused until patch applicability or removal is reviewed.

Local patches (base revision and exact SHA-256 are in UPSTREAM.json):

- [yield-thenable-diagnostics-and-check-state](patches/yield-thenable-diagnostics-and-check-state.patch): 31522736dd21d79d6c655aee82fdeeef2c35b00f0564cad1718615c8d1917840. Retain reported TS1321 while recovering valid yield constituents; expose a computation-free completed-file observation for the scoped-diagnostics work guard. Remove when: Drop the semantic hunk independently when an official upstream equivalent passes the permanent controls and completes the raw checker audit with zero unmeasured cases. Retain the read-only observation hunk only until an intended upstream completed-file query exists. Review and re-hash the remaining patch at each change.
- [merge-compiler-options-visible](patches/merge-compiler-options-visible.patch): fbb196a40bbcd454d124bc9d6291e2fdb7634aba0f5f666816a2605e2419e40e. Restore merge_compiler_options' public visibility (crate-private since the move into parsinghelpers): nts's ExtendedConfigCache observer merges extended config sources under per-option provenance, on upstream's own merge semantics. Remove when: Upstream exposes the merge, or an extended-config observer API that subsumes it, publicly again. Review and re-hash at each change.
