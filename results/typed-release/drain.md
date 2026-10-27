# Destruction-drain instruction attribution

Flat user-cycle samples, no call graph; zero lost samples. Percentages below name sampled instruction addresses, not causal cache-miss counts or removable-cost ceilings. Load consumers are included with their loads because sampled cycles skid onto dependent tests. The reserved-link load is assigned to the list bucket, even though it can also be an object touch.

| Category | C, % of drain | C, % of whole run | LLVM, % of drain | LLVM, % of whole run |
|---|---:|---:|---:|---:|
| Object header/descriptor/prefix loads and dependent tests | 34.79 | 13.17 | 30.97 | 11.71 |
| Dying-list head/link pushes, pops and draining checks | 15.17 | 5.74 | 15.92 | 6.02 |
| Shared TLS environment load at entry | 6.31 | 2.39 | 6.35 | 2.40 |
| Shared function entry/return register saves | 13.76 | 5.21 | 13.74 | 5.19 |
| Other: accounting, allocator pool return, descriptor dispatch and branches | 29.97 | 11.35 | 33.02 | 12.48 |

The dying worklist is intrusive in the already-dead header: it allocates no vector and has no capacity check, growth or per-pop bounds check. Candidate-buffer index/bounds code is present on a separate cold path and has no samples here. TLS and call-frame costs are shared; a recursive implementation still needs an environment, a call and object/allocator bookkeeping. Assigning every shared TLS and frame sample to list overhead would be a deliberately generous upper bound, not a likely saving.

The explicit list traffic is smaller than the object-load/dependency bucket on both backends. These cycle samples alone do not establish a wall-time ceiling. Keep the drain unchanged and use release-acyclic to test bulk lifetime allocation and reclamation with per-site regions. The earlier Node ratio is withdrawn pending the median-and-spread protocol described in node-protocol.md. This profile does not establish which loads missed L1/L2; that would need load-latency/cache-event evidence.
