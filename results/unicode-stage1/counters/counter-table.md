# Matched native counter pass

| arm | µs/work | cycles/work | instructions/work | wall max/min |
|---|---:|---:|---:|---:|
| case-convert-fused-c | 1.137 | 6380 | 37023 | 1.010 |
| case-convert-fused-llvm | 1.124 | 6329 | 36889 | 1.034 |
| case-convert-greek-fused-c | 30.868 | 174558 | 814871 | 1.006 |
| case-convert-greek-fused-llvm | 31.847 | 178706 | 814737 | 1.042 |
| case-convert-greek-icu-integrated-c | 83.751 | 472780 | 2113426 | 1.019 |
| case-convert-greek-icu-integrated-llvm | 83.767 | 471699 | 2113420 | 1.012 |
| case-convert-greek-main-c | 78.140 | 440187 | 1858123 | 1.004 |
| case-convert-greek-main-llvm | 77.245 | 436955 | 1857926 | 1.000 |
| case-convert-greek-scalar-c | 31.172 | 175613 | 814871 | 1.038 |
| case-convert-greek-scalar-llvm | 31.212 | 175100 | 814737 | 1.008 |
| case-convert-main-c | 1.652 | 9323 | 52958 | 1.006 |
| case-convert-main-llvm | 1.638 | 9246 | 52761 | 1.003 |
| case-convert-scalar-c | 1.877 | 10557 | 60639 | 1.015 |
| case-convert-scalar-llvm | 1.866 | 10526 | 60505 | 1.001 |
| case-convert-unchanged-fused-c | 0.956 | 5337 | 30317 | 1.027 |
| case-convert-unchanged-fused-llvm | 0.960 | 5342 | 29864 | 1.016 |
| case-convert-unchanged-main-c | 1.884 | 10608 | 59370 | 1.017 |
| case-convert-unchanged-main-llvm | 1.864 | 10471 | 58791 | 1.015 |
| case-convert-unchanged-scalar-c | 2.754 | 15478 | 76973 | 1.030 |
| case-convert-unchanged-scalar-llvm | 2.769 | 15453 | 76520 | 1.015 |
| icu-native-context | 60.467 | 342397 | 1629641 | 1.010 |
| model-context | 30.774 | 172389 | 808444 | 1.027 |
