# Typed project and host reader observations — #761

Part of #761. The canonical graph retains actual project callback facts and explicitly selected Node 26 scope facts, with fixture context and alias provenance. This slice does not add the Rust runtime declaration table, certify traced coverage, or remove Rust checks from ALWAYS.

The portable declaration parser/binder is included as an inert Node-only boundary; Cargo source/name/kind inventory checks name missing or ambiguous owners. Its actual table and downstream validator remain separate work.

## Cost

Both engines run on the same frozen source tree at 017159e94e8bc7efbf9dbf643ec3f6c22548362a. The engine pins are separate from that source pin. CPU 4 is held through `with-lock.sh --wait --key perf-count`; the sibling is quiet before measurement. Counters use the existing PERF_ARGS/parseMeasurement owner, raw inherited user instructions, and include target descendants. CPU is the owning cgroup delta across perf launch through waited exit. Peak is a retained resettable own-scope descriptor and includes the controller. Post-arm array verification is outside the measured interval.

### Cohort V1

Current engine `7cfa7da5d32bcbfe84b7160817cd97262870c1bd`; baseline engine `017159e94e8bc7efbf9dbf643ec3f6c22548362a`.

| Arm | Engine | Instructions | CPU s | Peak MiB | Wall s | Load 1/5/15 |
|---|---|---:|---:|---:|---:|---|
| arm-0 | old | 44,379,623,713 | 3.299582 | 442.54 | 3.337800 | 0.78 / 0.96 / 2 |
| arm-1 | current | 48,192,637,873 | 3.608998 | 460.22 | 3.622546 | 1.04 / 1.01 / 2.01 |
| arm-2 | current | 48,399,410,076 | 3.607328 | 422.18 | 3.635673 | 1.43 / 1.1 / 2.04 |
| arm-3 | old | 44,364,398,245 | 3.287089 | 424.64 | 3.299389 | 1.64 / 1.14 / 2.05 |

| Current / baseline means | Instructions | CPU | Peak | Wall |
|---|---:|---:|---:|---:|
| V1 | 1.088434 | 1.095595 | 1.017554 | 1.093568 |

### Cohort V2

Current engine `d32ad9bdfab88dfa0d0d49b3ef4c7d87379528c8`; baseline engine `017159e94e8bc7efbf9dbf643ec3f6c22548362a`.

| Arm | Engine | Instructions | CPU s | Peak MiB | Wall s | Load 1/5/15 |
|---|---|---:|---:|---:|---:|---|
| arm-0 | old | 44,749,065,638 | 3.414119 | 434.77 | 3.432432 | 1.11 / 1.06 / 1.74 |
| arm-1 | current | 45,876,330,103 | 3.320309 | 416.02 | 3.332241 | 1.18 / 1.08 / 1.74 |
| arm-2 | current | 45,886,516,324 | 3.343302 | 417.54 | 3.355768 | 1.18 / 1.08 / 1.74 |
| arm-3 | old | 44,624,404,456 | 3.333094 | 444.85 | 3.345749 | 1.24 / 1.09 / 1.75 |

| Current / baseline means | Instructions | CPU | Peak | Wall |
|---|---:|---:|---:|---:|
| V2 | 1.026735 | 0.987609 | 0.947651 | 0.986697 |

V1 retains the initial real instruction/CPU regression. One current-owner CPU profile identified repeated source-file ownership checks through visit/realpath. Successful ownership checks now share only the graph's existing parsed-source lifetime; actual protocol observations are freshly read. V2 leaves a real +2.67% instruction cost. Its CPU arms overlap, so it establishes no CPU speed win. No native-runtime or memory-performance claim follows from this standalone graph measurement. The four measured outputs and raw counters are retained per cohort. The original driver validated warm outputs and then replaced their filenames with warm-row metadata; warm stdout is not offered as retained raw evidence. `rows.json` is the incomplete checkpoint; `result.json` is the completed table.

## Preservation and controls

Project callbacks preserve actual file/existence/directory/realpath/stat answers rather than substituting declaration roles. Stat mode, safe integer size and Date time have the same shared JS/native wire domain. Existing fakeStat adapters remain unchanged. Parser parity controls include symlinked files/directories and a cycle against the previous OS adapter.

Context-local host promotion excludes compiled-only roots and erased type imports, including nested fixtures, while preserving both traversal orders. The Node recipe is explicitly selected by its invocation owner and grants no Bun authority. Original callback values remain intact; additional actual lstat/readlink/target observations retain their causes outside the shared HostObservation wire fields. Entries-only controls select child-link retarget/target deletion while ignoring ordinary and followed-target content edits. File/stat facts retain physical byte sensitivity. Missing, dangling, multi-link, ENOTDIR and ELOOP cases keep their operation semantics. Real owed/gateSteps controls exercise structural selection, byte precision, fallback and parsed runner handover.

The copier validates original source facts, stages only genuine immutable inputs and declared private data, and replays destination facts. Exact stat mismatches retain both answers and context; a private namespace prefix grants no substitution authority for typed facts. Non-portable file/directory stats, ordinary projectInput/projectConfig staging, repeated staging and promotion orders are controlled.

## Original native failure and correction

The first supported source 3b3a8946d4e10af8c2d35c5abfb0ea62d0a519f6 is RED: native stat validation disagreed and Clippy reported intentional casts, a checked mode conversion and raw-string syntax. Tooling passed. The assertion logged only the changed stat path; its RAII scratch was removed, so the original numeric answers are unavailable. They are not reconstructed or claimed below.

The exact pinned Node executable's embedded internal/fs/utils implements Stats Date fields with Math.round. The original Rust adapter truncated fractional milliseconds. A separately retained actual Node/stat reproduction has 12 rows and five disagreements with the source-derived old-cast model; those are new controlled observations, not original failure values. The corrected native conversion separates integer and fraction, preserving negative half ties and representable neighbors without first adding 0.5, and checks Date range before the documented intentional conversion. Real Node/native tests include fractional and pre-epoch file/directory/link/missing/ENOTDIR answers; supplied cases cover half-tie neighbors and large exact integers.

## Excluded development evidence

V5's new physical-byte control used a file symlink refused by the unchanged ownership rule; it was corrected to an allowed in-root aliased ancestor. V6's strict check found an untyped detached-clone callback, corrected before V7. Earlier role/projection controls and rejected peer reductions remain retained. They do not replace the final integrated proof. The original red supported run and its skipped inner half remain separate from the corrected chain.

## Accepted integration

Source `0b07f526eef07fc3f7b26273fc825c5bfa1f48f9` passed the prepared actual inner route and the supported canonical run `here-0b07f526eef0-1794603927912`. All 19 summary steps pass; cleanup is complete and experiments are empty. The compiler build preceding the gate is separate from its summary rows.

Inner summary:

```text
inner loop summary
  PASS  fmt              3s
  PASS  clippy           2s
  PASS  build            3s
  PASS  tests          406s
green: queue it with node tooling/landing/check.ts <commit>
```

Runner wall is 470.26 s. The separately reported summed memory-admission wait is 270.30199999999996 s; intervals may overlap and are not a serial subtraction. Source/engine pins, all measured arms, source receipts and artifact digests are in the companion JSON.
