# Train-free controls: five A/B/A rounds

Same pins, binaries and hot counts as the complete matrix. CPU4 under with-lock; Train activity is recorded at entry and exit of each cell. Floor is the maximum absolute baseline-repeat change (nearest-rank P90 of five).

| Row | Backend | Wall Δ | Instructions Δ | Cycles Δ | Floor | Verdict |
|---|---|---:|---:|---:|---:|---|
| tree-teardown | c | 5.00% | -0.10% | 4.85% | 4.62% | REGRESSES: profile before proceeding |
| tree-teardown | llvm | 0.67% | -0.10% | 0.41% | 39.92% | inside floor |
| sort-objects | c | -0.32% | -0.51% | -0.59% | 1.73% | inside floor |

| Row | Backend | Round | Wall Δ | Instructions Δ | Cycles Δ | A-repeat floor | Load A/B/A |
|---|---|---:|---:|---:|---:|---:|---|
| tree-teardown | c | 1 | 5.00% | -0.10% | 4.85% | 0.49% | 1.63/1.63/1.63 |
| tree-teardown | c | 2 | 9.44% | -0.10% | 9.40% | 2.01% | 1.66/1.66/1.66 |
| tree-teardown | c | 3 | 2.37% | -0.10% | 3.13% | 0.66% | 1.66/1.66/1.66 |
| tree-teardown | c | 4 | -5.16% | -0.10% | -4.05% | 4.62% | 1.66/1.66/1.66 |
| tree-teardown | c | 5 | 13.81% | -0.10% | 12.66% | 3.31% | 1.66/1.66/1.66 |
| tree-teardown | llvm | 1 | -3.90% | -0.10% | -2.87% | 39.92% | 1.63/1.63/1.66 |
| tree-teardown | llvm | 2 | 0.67% | -0.10% | 0.41% | 24.75% | 1.66/1.66/1.66 |
| tree-teardown | llvm | 3 | 0.34% | -0.10% | 0.45% | 7.10% | 1.66/1.66/1.66 |
| tree-teardown | llvm | 4 | 1.70% | -0.10% | 0.12% | 20.77% | 1.66/1.66/1.66 |
| tree-teardown | llvm | 5 | 7.80% | -0.10% | 7.91% | 17.90% | 1.66/1.66/1.66 |
| sort-objects | c | 1 | -1.51% | -0.51% | -1.48% | 0.13% | 1.66/1.66/1.66 |
| sort-objects | c | 2 | -1.35% | -0.51% | -0.59% | 1.73% | 1.66/1.66/1.66 |
| sort-objects | c | 3 | 2.77% | -0.51% | 2.77% | 0.16% | 1.66/1.66/1.66 |
| sort-objects | c | 4 | 2.51% | -0.51% | 1.55% | 1.02% | 1.66/1.66/1.66 |
| sort-objects | c | 5 | -0.32% | -0.51% | -2.48% | 1.00% | 1.66/1.66/1.66 |
