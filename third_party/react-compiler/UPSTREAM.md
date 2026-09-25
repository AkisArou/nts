# The React Compiler, vendored

The Rust crates of [facebook/react](https://github.com/facebook/react)'s
compiler, at `1d34f91dfde6bba84d08b683aaba164c7194dacb`, unmodified: each crate's `Cargo.toml` and `src/`,
and the licence (MIT). `Cargo.toml` here is generated: upstream's workspace
fields over these crates alone.

To move the pin, check facebook/react out at the new revision and run, from
`runtime/react`:

    node tools/vendor-react-compiler.ts <react-checkout>

`--check` compares this copy with a checkout instead of writing it; with
no checkout, with MANIFEST, which is what the gate runs.
