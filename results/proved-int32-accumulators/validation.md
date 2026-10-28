# Proved-int32 validation

Tool-written from the retained completed runs.

The focused suite, both native emitters under NoGC and RC with POISON/ASan/UBSan, executed restore-arithmetic controls, dense 96-update guard, and zero-live checks passed. The fresh broad Rust run passed 1,951 tests. The oracle fixture completes 348 Node cases.

Five whole-corpus comparison arms each report 791 unchanged projects, zero regressed/changed/unmeasured, and 139,731 of 140,089 cases compared. The remaining 108 declined and 250 unreached cases are unchanged limitations. All five C test262 records have zero regressions.

| Compile mode | Modules | Instruction change range | Summed change | Largest A-repeat drift |
|---|---:|---:|---:|---:|
| nogc | 29 | -1.3861% to 0.0473% | -0.0009% | 1.6598% |
| rc | 29 | -0.0385% to 1.6785% | 0.0027% | 3.5624% |

Every function population matches across its A/B/A bracket, and every module is inside the 1.10 instruction tripwire. The interrupted census retains 33 complete readings; its successor runs only the missing 141. RC and NoGC are reported separately; one bracket is a census, not a repeat distribution.

The paired report retains all 22 rows on C and LLVM, every bracket, five launches of each host, comparator versions, branches, code sizes and RSS. Both selected rows improve in instructions and cycles; the 40 no-selection binaries are byte-identical. LLVM wall reductions are inside their conservative repeat floors. No native result is claimed for the unchanged utf8-encode refusal.
