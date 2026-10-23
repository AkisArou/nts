# tsrs, vendored

The production dependency closure of tsrs_project from
[oxc-project/tsrs](https://github.com/oxc-project/tsrs) at
`bb5c6037ad04decdd7c5832997e810000e85943d` (version 0.19.0), unmodified, with LICENSE and NOTICE.
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
compares the copy with the exact upstream objects. Upstream source is never
formatted or edited as part of an nts change.
