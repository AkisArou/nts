# Benchmark and oracle reader inputs: #728

This slice declares the benchmark population, group metadata, harness files, comparison inputs, compile-counter populations, oracle metadata and portable runtime assets. Supplied roots and repository-relative case keys stay unchanged. The source pins and complete delta are in bench-oracle.json.

The generic run-record.ts validator stays byte-identical to main. It reads the root its caller supplies; claiming production result directories there would make synthetic fixture imports depend on production observations. Its production caller and project-context inputs stay for the remaining-reader slice.

## Ownership and identity

One URL inventory supplies oracle recipe hashing and the portable runtime bundle. The execution filenames retain their order and relative names. The dependency helper keeps the fixed capability-source namespace in canonical and flattened asset layouts, proved by evaluating the actual parsed production expression in both layouts.

Synthetic fixtures grant their own program, benchmark, runtime, compile-time and foundation data at the declared namespaces before staging, and assert the resulting inventories. The pending-outcome control starts with no production workspace sources or records, then adds its single case. Module-owned source bytes remain production bytes.

The measured population remains 1231 rows, with zero pending counts and no changed record bytes. Only emitterSha256 and runtimeSha256 change in the recipe identity. The sole budget row, benchmarks/cases/jetstream-lazy-collections/case.ts, was already stale and remains stale; zero fresh budgets become stale. The exact producer identities and budget signature are in the JSON record.

## Selection comparison

The fixed comparison is `bf6f9a20d25ce525523044596f167dbed88db07e` against `f95490693f142d58d5b55353ecd8b813cb1105f3`.

| Observation | Main | Reader tip |
| --- | ---: | ---: |
| Tracked paths | 28523 | 28523 |
| Switch-off lost edges | 109294 | 84571 |
| First-loss sites / readers | 477 / 150 | 415 / 141 |
| Unplaced / policy, scanner on or off | 142 / 33 | 142 / 33 |
| Edges without provenance | 0 | 0 |

The switch-off comparison closes 24,723 edges and adds 0, a net reduction of 24,723. On common paths, the live selector retires one classified text-inference obligation and adds 16. All sixteen additions follow actual metadata/module declarations. No real-reader obligation is lost and the fallback does not rise.

The retired pair is tooling/conformance/web-platform/compiled/tsconfig.json → test-host. The actual audit trace at `a73d2b1707af188e1e76c13ce5c9c5f1eed8123d` contains one open of check-consumers.ts and zero file calls naming that config. The trace's command, source, byte count and SHA-256, with its positive open, are in the JSON record; the complete trace remains in scratch. This audit parses host source and does not compile that project. Execution readers retain their declared inputs.

| Remaining reader group | Assigned preservation edges |
| --- | ---: |
| tooling | 2110 |
| benches-and-oracles | 115 |
| runtime-and-config | 52 |
| test262-and-typescript | 2 |

## Proof and reproduction

Focused reader, consumer and timing checks passed 208 tests, with zero failures. The host audit checked 1871 sources, 254 closures and 412 reads; strict checked 812 modules with zero new diagnostics. These counts are from the retained logs, and strict runs again last before queueing.

The supported canonical check is green: tooling 2157 passed, 0 failed and 2 existing TODOs (2159 total); Rust 3043 passed, 0 failed and 8 ignored across 55 binaries and 18 doctest crates. The gate summary records 1123.827 total wall seconds. Ledger waits total 888.319 seconds and can overlap running steps; they are reported separately, not subtracted as an exclusive execution interval. The compiler and sealed environment came from the supported route.

| Step | Cgroup CPU seconds | Wall seconds | Peak bytes |
| --- | ---: | ---: | ---: |
| tooling | 2312.890578 | 226.073 | 12662235136 |
| tests | 4356.805262 | 361.256 | 10755837952 |

The CPU basis is cgroup-v2-scope-v1. These are proof costs, not a performance comparison. The earlier completed red runs are retained in the record: the first found ten missing agreement-fixture grants and production workspace bytes in the pending-outcome fixture, both corrected here. A second run caught an undeclared extra namespace grant; the shared compiler-free staging control now guards the same setup, with 1 test passed. Both red runs remain excluded from proof.

The source copies and their private .git directories were removed after the census. The complete edge index stays off tree under the #728 keep entry. From an independent source repository at either pin, run:

```sh
node "$tool_tree/tooling/gate/reader-census.ts" inspect "$PWD" "$output" "$tool_tree/docs/records/reader-inputs-728/namespace-sites.tsv"
```

The final index has 84571 edges in 3200810 bytes, SHA-256 `9e29771f8d4afe82c9efbc1445c86ef3eb92dabc5e7df2c09817973ce8a77fba`. Its location and exact capture/analysis commands are in bench-oracle.json. No giant edge index or trace is committed.
