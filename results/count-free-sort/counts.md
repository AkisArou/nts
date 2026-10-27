# Count-free sort operation census

Separate instrumented C and LLVM binaries, with the same source, RC provider and shipping optimization flags. Each row measures exactly two hot work calls after initialization, check and warmup calls. The final cycle collection checks live count and bytes against the warmed baseline; it is outside the counted interval. Values below are per call. C and LLVM agree exactly in every cell. The persistent map inputs account for its warmed live baseline; the sort row returns to zero.

| Row | Backend | Arm | Retains/call | Releases/call | Allocations/call | Warm live objects | Warm live bytes |
|---|---|---|---:|---:|---:|---:|---:|
| sort-objects | c | base | 45056 | 45345 | 296 | 0 | 0 |
| sort-objects | llvm | base | 45056 | 45345 | 296 | 0 | 0 |
| map-entries-top-k | c | base | 3666 | 4075 | 213 | 258 | 14400 |
| map-entries-top-k | llvm | base | 3666 | 4075 | 213 | 258 | 14400 |
| sort-objects | c | indices | 8192 | 8497 | 312 | 0 | 0 |
| sort-objects | llvm | indices | 8192 | 8497 | 312 | 0 | 0 |
| map-entries-top-k | c | indices | 1848 | 2258 | 214 | 258 | 14400 |
| map-entries-top-k | llvm | indices | 1848 | 2258 | 214 | 258 | 14400 |

The managed snapshot plus two uint32 buffers replaces two managed merge buffers. This costs one additional array allocation per sort. On a 64-bit target, element payload is 8N + 4N + 4N bytes instead of 8N + 8N; the extra array header is additional. Merge stores carry no managed edges, while snapshot creation and final write-back keep normal ownership.
