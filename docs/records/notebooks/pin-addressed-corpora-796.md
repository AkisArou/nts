# TypeScript and test262 inputs coexist by pin

[#796](https://github.com/AkisArou/nts/issues/796) reuses the pin-addressed corpus owner introduced by #795. `tooling/bootstrap/typescript.pin` and `test262.pin` retain the prior Rust constant values: `3e9236361fa97a9e6c685f4833ac457ae2d8c50a` and `14e8c908e54ae2e770e473bcacf536f8cb654929`. Rust includes those data files as true constants; the independent TypeScript/native-checker equality assertion remains. The TypeScript corpus definition also verifies the tracked native metadata before acquisition or reuse. Node’s authenticated release/identity owner is unchanged.

One CORPORA registry drives bootstrap, each candidate’s linker, and private fixture pre-acquisition. TypeScript retains its tests-only no-cone sparse population; test262 is acquired whole. Each tree links its own `third_party/<slot>.d/<pin>` checkout, so different pins coexist. Bootstrap fills fresh slots and reports nonempty legacy directories without moving them. The legacy shared checkouts and older tree links remain in place. There is one fetch per new pin during setup; reuse verifies the acquired checkout without fetching.

| Deciding control | Actual result |
| --- | --- |
| Two real linker candidates at different private pins | Both execute their selected TypeScript/test262 control bytes; old stores and legacy sentinels unchanged |
| Sparse/full populations and an unreachable upstream on a hit | TypeScript tests-only population retained; test262 harness and metadata retained; verified hit does not fetch |
| Wrong pin, dirty checkout, native metadata mismatch | Named refusal; checkout not moved or reset; native mismatch publishes tooling-setup |
| Separate family pin commands | test262 reads its own pin even with mismatched private TypeScript metadata |
| Real registry bootstrap command | All declared stores selected; existing legacy directory reported and retained |
| Pin edits, added and modified | Suite steps and tests owed; direct tooling/suite embedded ownership required for both pins |
| Fresh Cargo dep-info | nts-suite target prerequisites name both new include_str pin files |

The twelve original reader/reference files were inventoried before editing. Shell source decoders are gone, Rust consumers retain their constant names, and the conformance specifications name the data pins. The protocol-history record remains unchanged evidence. Registry and Node-upgrade fixtures stage LINKER_INPUTS and pre-acquire the same production registry from a tiny local Git upstream. Staged command source and production upstreams remain intact; only private pin/native metadata changes.

| Actual fresh acquisition | Wall | Allocated bytes | Apparent bytes | Present tracked files | Sparse-absent tracked paths |
| --- | ---: | ---: | ---: | ---: | ---: |
| typescript | 4.844 s | 75059200 | 25724819 | 13005 | 54915 |
| test262 | 16.904 s | 292696064 | 122002076 | 56976 | 0 |

For both stores, every tracked path and present file/link hash matches legacy exactly; the complete sparse inventory is identical. Both legacy checkouts were independently rechecked unchanged, and the real candidate linker selected the new stores. These are same-pin input parity results, not a speed comparison or a claim that two full upstream suite revisions were executed. Acquisition receipt: /home/akisarou/.cache/nts-scratch/796/acquire-v1/result.json, SHA-256 a39fd479fafd67ad0515e51e72c4cf7e4217bfcca1cec54c27a06d9ffda19fd5.

The old test262 checkout contains ignored `tools/packaging/__pycache__` output from `discover::tests::rust_metadata_matches_test262s_parser_for_the_whole_pin`, which imports the upstream monkeyYaml and parseTestRecord modules. Its one Python subprocess now uses `-B`. The explicitly enabled whole-pin Rust/Python metadata comparison passed 1/1; all 56976 tracked files stayed identical, and the new store had no ignored files or bytecode cache before or after. The subsequent full supported run also left both stores with identical tracked inventories and no untracked or ignored output. Existing legacy caches were left untouched.

| Final proof | Actual result |
| --- | --- |
| Corpus/linker/registry/Node consumers | 39/39, no skips or cancellations |
| Pin selectors and timing/host/strict audits | 2/2 and all audits green |
| Explicit whole-pin metadata parity | 1/1, not skipped; source inventory unchanged and no cache output |
| Required final inner | PASS  fmt              3s; PASS  clippy           1s; PASS  build            1s; PASS  tests          334s |
| Supported landing route | 19 summary rows PASS; canonical, no experiments; cleanup and diagnostics complete |

Inner V1 also passed before the approved test-only Python `-B` addition. Final inner and the explicit whole-pin check cover that addition. No failed or interrupted proof is presented as green. No recorded result rows changed. Raw evidence: /home/akisarou/.cache/nts-scratch/796/raw-evidence-v1.json, SHA-256 70481bca17bfbe33d9a680f06e8a7d3c87f66a79fd9ecf46e8f9bce786743697. The finite manifest binds source receipts, launchers, deciding logs, acquisition inventories and Cargo dep-info rows; regenerable run trees, caches and compiled outputs are excluded. Proof source: 8489d199f9fdbb2130f17b3beb6c954a77caa1f3.
