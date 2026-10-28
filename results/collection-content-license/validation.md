# Collection content-licence validation

Tool-written from the completed value-only API checks.

1965 Rust tests passed in 264 groups, with 4 existing ignores. All five C/LLVM/JVM/native-RC comparisons report 843 unchanged projects, zero regressions and zero unmeasured projects. All five C test262 records have zero regressions. Existing partial and refused cases remain visible in validation.json.

All 97 benchmark rows have identical C and LLVM emissions and diagnostics. No runtime speedup is claimed. The native ownership guard passes both emitters, NoGC and RC/POISON/ASan/UBSan, with the restored-cleanup and managed-release controls. The initial CLI --lib setup error was corrected with --bin nts; the full CLI suite also passed in the broad run.

| Compile mode | Modules | Instruction change range | Summed change | Largest A-repeat drift |
|---|---:|---:|---:|---:|
| nogc | 29 | -0.0382% to 0.8632% | 0.0364% | 0.0568% |
| rc | 29 | -1.1886% to 0.1228% | 0.0352% | 0.0810% |

All 174 compile commands passed with matching function populations; no module reaches the 1.10 tripwire. One bracket per module is a census, not a repeat distribution. Ten RC function-wide content budget fallbacks retain every cleanup operation. NoGC remains a separate control.

The current content record has 941/942 prepared inputs, 121 partial modules and the expected invalid-TypeScript input. Precise string proofs raise program Map eligibility from 138 to 139 of 215; Records stay 35 of 115. Key proofs remain explicitly unavailable. No Semantic/View transfer or typed storage is part of this checkpoint.
