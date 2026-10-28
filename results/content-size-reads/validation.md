# Intrinsic size-read validation

Tool-written from completed checks.

The focused suite, workspace Clippy, both native emitters under NoGC and RC with POISON/ASan/UBSan, restored-cleanup control and zero-live checks passed. The fresh Rust suite passed 1,961 tests in 264 groups, with 4 existing ignores.

All five whole-corpus comparisons report 843 unchanged projects with zero regressed or unmeasured. All five C test262 records have zero regressions. The initial comparison launch refused before workload for missing pin provenance; the unchanged corpus was then compared without new-project exemptions.

| Compile mode | Modules | Instruction change range | Summed change | Largest A-repeat drift |
|---|---:|---:|---:|---:|
| nogc | 29 | -2.1660% to 0.0453% | -0.0018% | 4.3713% |
| rc | 29 | -4.0176% to 0.0650% | 0.0068% | 0.0370% |

Every function population matches across its A/B/A bracket and every module remains inside the 1.10 instruction tripwire. One bracket per module is a census, not a repeat distribution.

The coverage record gains 56 candidate Maps, from 82 to 138 of the same 215 program identities. Benchmark candidates rise from 8 to 12 of 14. Only map-and-set and map-entries-top-k change emitted code among the 97 benchmark rows; the other 95 rows have identical C and LLVM emissions. Instruction means improve by 2.2–3.7%; all wall differences remain inside the loaded sitting’s floors, and individual LLVM layout losses remain in the paired report.
