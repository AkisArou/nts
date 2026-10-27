# Node harness discrepancy

Both harnesses use Node 24.20.0, with no explicit Node flags. The inherited NODE_OPTIONS in the audit is `--max-old-space-size=8192 --disable-warning=ExperimentalWarning`; the original matrix did not record that variable. The observed Node threads all have CPU affinity 4. Both run work repeatedly inside one process, rather than starting a process for each call.

Normal nts-bench warms at most 20,000 calls/300 ms, probes a repetition count near 100 ms, takes the best of five hot batches, and repeats that in five processes, retaining the best process. Count mode warms a calibrated fixed count in the shared hot loop, then times one fixed-N batch. The paired run uses three launches and their median. Both include work and GC occurring inside that hot loop; neither includes forced final collection or process teardown. Different batch lengths and direct/shared warmup call sites did not explain the roughly 2× difference.

The exact original driver, unchanged imports, flags, fixed counts, perf FIFO protocol and parent affinity reproduced its fast state, then the same setup returned to its slow state. Driver path and moving the controller/perf parent off CPU 4 do not consistently select either state. Instruction counts remain almost unchanged. Values below are per call, with every launch listed.

| Replay | Row | µs per launch | Instructions per launch | Cycles per launch | Cycles/ns per launch |
|---|---|---|---|---|---|
| node-original-replay | release-acyclic | 48.96/37.84/38.58 | 1025412/1025424/1026294 | 273085/209305/214930 | 5.58/5.53/5.57 |
| node-original-replay | cyclic-churn | 10.08/10.16/10.18 | 178268/178275/178287 | 56758/56867/56925 | 5.63/5.60/5.59 |
| node-factor-on-original | release-acyclic | 72.91/69.99/74.67 | 1025462/1026315/1026335 | 369645/358687/379391 | 5.07/5.12/5.08 |
| node-factor-on-original | cyclic-churn | 22.13/24.07/24.51 | 178286/178289/178257 | 114297/123794/125549 | 5.17/5.14/5.12 |
| node-factor-on-record | release-acyclic | 64.71/62.19/67.31 | 1025426/1025464/1025457 | 333994/320395/346099 | 5.16/5.15/5.14 |
| node-factor-on-record | cyclic-churn | 13.07/19.53/21.15 | 178261/178252/178245 | 68856/102387/110108 | 5.27/5.24/5.21 |
| node-factor-off-original | release-acyclic | 67.38/64.30/67.81 | 1025417/1026418/1025430 | 348461/333010/350815 | 5.17/5.18/5.17 |
| node-factor-off-original | cyclic-churn | 21.63/19.42/18.09 | 178304/178292/178256 | 113547/101478/94907 | 5.25/5.22/5.25 |
| node-factor-off-record | release-acyclic | 65.78/66.81/69.02 | 1026254/1025419/1025375 | 338461/340018/352147 | 5.15/5.09/5.10 |
| node-factor-off-record | cyclic-churn | 20.62/19.70/20.90 | 178250/178268/178233 | 106101/100634/107077 | 5.15/5.11/5.12 |

The slow state executes substantially more cycles for the same instructions. Effective cycles/ns also fall about 8%, but that small frequency change cannot explain a roughly 2× wall difference. The dominant distinction is microarchitectural; its cause is unresolved. THP enabled/defrag are both madvise, and CPU 4 uses intel_pstate/powersave. No machine setting was changed. A follow-up should compare AnonHugePages and frequency in fast and slow launches.

Decision for future Node/Bun ratios: at least five separate launches, median and spread reported. This is a separate benchmark-tool change. Counting remains the primary within-native A/B evidence. The legacy best-process tables are preserved with their method warning and do not provide acceptance verdicts under the new policy.
