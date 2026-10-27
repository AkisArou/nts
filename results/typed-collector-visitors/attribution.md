# Collector field-discovery attribution

Four flat cpu_core/cycles/u profiles of the exact paired binaries, on CPU 4 under with-lock. All have zero lost samples and the unchanged whole-work checksum. Profiles include process startup and two pre-hot calls; the much longer loop dominates them. Hot-window instructions and cycles in paired.md remain the quantitative A/B. Ordinary cycle sampling can skid, so this instruction split locates work rather than proving exact dispatch latency.

| Portion, % of total samples | C | LLVM |
|---|---:|---:|
| Generated callback total | 4.24 | 4.01 |
| Direct fixed-field loads | 0.92 | 0.88 |
| Field null tests / branches | 1.16 | 1.13 |
| Per-edge indirect call / tail-jump sites | 0.22 | 0.20 |
| Callback register/frame bookkeeping and return | 1.94 | 1.80 |
| Descriptor callback indirect tail-jump site (in wrapper) | 0.48 | 0.54 |
| Generic edge wrapper / remaining fallback total | 14.13 | 12.29 |
| Collector pass, including trial deletion and reclamation | 42.41 | 46.39 |
| Gray-child phase body | 2.91 | 2.54 |
| Scan-child phase body | 1.84 | 1.59 |
| Gather-child phase body | 1.97 | 1.82 |

The callback subrows partition its total; wrapper and descriptor-jump rows overlap. Generic each_reference shrinks from 31.17% to 14.13% on C and 25.33% to 12.29% on LLVM. With the new callback added, field-walking machinery occupies 18.37% and 16.30% respectively. These are sample shares with different denominators, not an isolated causal speedup. The collector algorithm is unchanged; its main pass now occupies 42.41% / 46.39%. That pass includes inlined scan/worklist work and final reclamation, so this is an upper bound on trial-deletion bookkeeping, not an exclusive algorithm-cost measurement. M-3 remains separate from this field-discovery change.

Both callbacks load the two slots directly, skip nulls, and call the phase function pointer; the last edge can tail-jump to it. Static assembly confirms the phase cannot inline through that pointer. Dispatch-site samples are about 0.2% of the full run; callback register/frame work is larger, about 1.8–1.9%. The observed field-discovery win survives that cost. This evidence does not justify an edge buffer or per-phase visitor in this landing. Phase bodies retain their normal trial-count and worklist operations.

Descriptors grow eight bytes each (96 to 104 on these 64-bit targets). Across the twelve rows, linked descriptor totals grow 24–96 bytes and .text grows 0–352 bytes. Every release/value-release size comparison is unchanged across the 48 binaries. Unused or eliminated visitors report their actual zero callback bytes in paired.md. The tiny generic owned-walk instruction cost and the unreproduced control wall losses are recorded, with every repeat, in repeat.md.
