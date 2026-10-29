# tsrs, vendored

The production dependency closure of tsrs_compiler from
[oxc-project/tsrs](https://github.com/oxc-project/tsrs) at
`a0db53eabe483062205717f067a49b6ccb3fc868` (version 0.19.0), with the explicit local patches below, LICENSE and NOTICE.
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
- [compiler-worker-budget](patches/compiler-worker-budget.patch): 0a03b5a5f974c5a1f238039c717304b76676902e0b841e2d6ac8ee1ce0467ad4. Expose one process-wide compiler worker budget configured once before first use. Parsing, binding, checker work and request execution slots use the same limit, independent of visible CPUs and pool-specific environment variables. Remove when: Remove when an official upstream revision provides an equivalent pre-initialization compiler worker budget with duplicate/late configuration errors and coverage of every compiler pool; re-pin and pass the permanent pool, diagnostic, listing and CPU-mask invariance controls before removing this patch.
