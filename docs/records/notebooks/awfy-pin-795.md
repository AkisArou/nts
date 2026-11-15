# AWFY references use a pin-addressed corpus

[#795](https://github.com/AkisArou/nts/issues/795) gives the AWFY C++ and Java reference corpus one data pin: `tooling/bootstrap/awfy.pin`, currently `74306fec151070fd07157cefeacf19e7e0bcdc89`. Existing provenance URLs already name that revision. Rust embeds the data, the TypeScript owner reads it directly, and the provenance audit refuses every AWFY URL at another revision. The compiled benchmark resolves the selected checkout once outside measured work.

The shared corpus owner takes a pin source, upstream, sparse set and slot. Tree setup acquires `third_party/are-we-fast-yet.d/<pin>` by staged depth-one, blobless, sparse fetch, verifies HEAD, own Git root and cleanliness, then publishes atomically. Existing checkouts are verified without fetching. Each candidate links only its own slot, so different pins coexist. A fetch failure names its cause and retry remedy in setup; it cannot become a later missing-column observation. The legacy directory and older links remain untouched.

| Deciding control | Actual result |
| --- | --- |
| Fresh acquisition after upstream default advances | Selected exact data pin; declared sparse paths present |
| Existing acquired pin with upstream unavailable | Verified reuse, no fetch |
| Wrong pin or dirty checkout | Named refusal; existing checkout not moved or reset |
| Two candidate pins and legacy sentinel | Independent pin-addressed directories and links; legacy unchanged |
| Real linker fetch failure | Cause and retry remedy retained; tooling-setup packet; no slot or checkout published |
| Missing acquired corpus | Both AWFY cells have one unavailable reason naming acquisition; actual native row starts no reference compiler stage |
| Present references and provenance | Existing supplied cell values preserved; wrong revision (main) refused |
| Pin edit selection | Benchmarks and declared tooling readers owed without fallback |

Registry and Node-upgrade controls stage the production LINKER_INPUTS list. A tiny private local Git upstream is pre-acquired through the same corpus owner into each fixture’s shared root. Only staged awfy.pin changes; the production AWFY command and upstream are untouched. Their real link invocation verifies that existing pin, and the positive controls assert its selected path. No AWFY step is skipped.

The actual fresh acquisition selected `/home/akisarou/Projects/nts/third_party/are-we-fast-yet.d/74306fec151070fd07157cefeacf19e7e0bcdc89` in 1640.881 ms. The subsequent candidate linker succeeded. The store occupies 1695744 allocated bytes and 1165176 apparent bytes. All 126 selected C++/Java/docs path facts and file hashes match the legacy checkout, whose HEAD, status and selected bytes are unchanged. This is source-byte parity, not a benchmark speed comparison.

Acquisition receipt: /home/akisarou/.cache/nts-scratch/795/acquire-v1/result.json, SHA-256 c25f13937592140225ad9fa92c6216b49e205ca0fa910e917ff365994891aa04.

| Production preparation route | Acquisition owner before use |
| --- | --- |
| Full-check core and wide tree | pinnedGate setup invokes the candidate linker before steps |
| Full-check nightly benchmark tree at verified | startMeasuring checkout uses prepareTree and linkTree before benchmarksUnit |
| Landing and record trees | Checkout and clean precede the tree’s linker; third_party survives clean |
| Pool tree used for a manual benchmark | Pool.take invokes that tree’s linker after branch selection |

There is one network acquisition per new pin during tree setup; subsequent setup verifies it. No controller changes were required. A pin bump needs no shared-checkout move or manual migration. TypeScript, test262 and Node follow separately in #796. Without a corpus, the known absence is handled before either reference compiler; with a corpus, the reference work retains its existing route and source bytes.

| Final proof | Actual result |
| --- | --- |
| Focused controls | 18/20 in V2; both affected fixture corrections passed 2/2 in V3 |
| Pin selector and timing/host/strict audits | 1/1 and all audits green |
| Corrected registry and Node fixture owners | Focused V4 19/19, no skips or cancellations; all audits green |
| Required inner V2 | PASS  fmt              3s; PASS  clippy           1s; PASS  build            3s; PASS  tests          301s |
| Supported landing route | 19 summary rows PASS; canonical, no experiments; cleanup and diagnostics complete |

The initial single shared-checkout proposal was replaced before proof because a pin bump would conflict with older trees. It supplies no proof for the pin-addressed design. Focused V1 stopped before tests at the new producer control’s strict type diagnostic. Focused V2 passed 18/20 controls; two linker fixtures supplied absolute closure entries and refused before executing the linker. The test-only relative-entry correction passed both affected controls in V3, together with the pin selector and all audits. The other 18 controls were unchanged. Inner V1 passed formatting and stopped at the variants function’s line limit. Main-approved extraction into Absences preserved every decision and introduced no lint allowance. Inner V2 is the complete green native proof; only the four fixture files listed in the manifest changed afterward, with all Rust and production source bytes retained. Supported V1 passed every step except tooling. Its 11 failures were eight registry leaves and the Node-upgrade parent/two leaves missing the new AWFY command in their private linker lists. Focused V4 repeats the corrected owners using production LINKER_INPUTS and a real privately acquired corpus. The production AWFY command is untouched; only staged pin data changes. Supported V2 is the final complete green route.

Raw evidence: /home/akisarou/.cache/nts-scratch/795/raw-evidence-v1.json, SHA-256 5d96269225f76ec5fd6fd0e48d774efad2a56b996f70064eefe41211a4a3a3c1. The finite manifest binds selected logs, launchers, the direct acquisition receipt and exact Git source receipts. Regenerable oracle/run trees and build outputs are excluded. Proof source: 03c75ff7ac040a6dce4cf5ce44bc424be5b5d0b6.
