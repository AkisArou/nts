# Memory harness executable roots (#960)

The memory harness linked an executable while asking `emit-c` for open library roots. It now requests `--main --entry work --rc`: the existing `product_roots` selects closed `Roots::Entry` for `work` and `module#init`. The harness still owns its two calls, counter reset and runtime drains. It excludes the CLI launcher and libuv host sources in one selection shared by both compile paths; an unknown host source or missing exported numeric `work` fails its row by name.

## Fixed compiler comparison

Both arms use main pin `e6e47b4a9b115a24cd9c2d66245f9d4e69bc1cab`, binary SHA-256 `bccc5abb63fd6e2b88eef039814f4ce89f1a3f3e37847f868b59ecc8c6d9ed6b`. The fix was committed as `330957f6ea` and `git log -1` checked in a separate command before measuring. The before script is the original script with only its repository and recursive script paths redirected to this tree and scratch. The after script is the committed harness. Both full runs use runtime object reuse. Counters below come from executing the generated binaries for both arms after each suite completes.

Each cell is **before -> after**. Operation columns count retains plus releases. Allocation, leak and answer cells report naive/elided, in that order.

| Case | Naive ops | Elided ops | Allocations (naive/elided) | Leaks (naive/elided) | Answer (naive/elided) |
|---|---:|---:|---:|---:|---:|
| a-borrow-ends-at-its-last-read | 91 -> 91 | 49 -> 49 | 27/27 -> 27/27 | 0/0 -> 0/0 | 3106/3106 -> 3106/3106 |
| a-chain-that-outgrows-its-first-room | 64 -> 64 | 8 -> 8 | 12/12 -> 12/12 | 0/0 -> 0/0 | 4122306680960/4122306680960 -> 4122306680960/4122306680960 |
| a-field-behind-an-assertion | 262 -> 262 | 2 -> 2 | 2/2 -> 2/2 | 0/0 -> 0/0 | 65/65 -> 65/65 |
| a-string-a-helper-appends-to-around-a-throw | 47 -> 47 | 47 -> 47 | 27/27 -> 27/27 | 0/0 -> 0/0 | 101006/101006 -> 101006/101006 |
| a-string-taken-over-by-a-call-that-throws | 47 -> 47 | 47 -> 47 | 27/27 -> 27/27 | 0/0 -> 0/0 | 101006/101006 -> 101006/101006 |
| abstract-dispatch | 68 -> 68 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 5984/5984 -> 5984/5984 |
| array-buffer | 17 -> 17 | 17 -> 17 | 34/34 -> 34/34 | 0/0 -> 0/0 | 1088/1088 -> 1088/1088 |
| array-from | 36 -> 36 | 2 -> 2 | 5/5 -> 5/5 | 0/0 -> 0/0 | 17/17 -> 17/17 |
| array-methods | 2 -> 2 | 2 -> 2 | 6/6 -> 6/6 | 0/0 -> 0/0 | 19/19 -> 19/19 |
| array-mutations | 5 -> 5 | 5 -> 5 | 9/9 -> 9/9 | 0/0 -> 0/0 | 49/49 -> 49/49 |
| array-of-objects | 52 -> 52 | 18 -> 18 | 22/22 -> 22/22 | 0/0 -> 0/0 | 136/136 -> 136/136 |
| array-with-holes | 57 -> 57 | 15 -> 15 | 15/15 -> 15/15 | 0/0 -> 0/0 | 90/90 -> 90/90 |
| async-method | 39 -> 39 | 35 -> 35 | 7/7 -> 7/7 | 0/0 -> 0/0 | 1/1 -> 1/1 |
| bigint-arithmetic | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 59728/59728 -> 59728/59728 |
| boolean-flags | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 7/7 -> 7/7 |
| borrowed-call | 68 -> 68 | 1 -> 1 | 34/34 -> 34/34 | 0/0 -> 0/0 | 561/561 -> 561/561 |
| callback-field | 51 -> 51 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 136/136 -> 136/136 |
| callback-index | 1 -> 1 | 1 -> 1 | 1/1 -> 1/1 | 0/0 -> 0/0 | 168/168 -> 168/168 |
| case-convert | 52 -> 52 | 18 -> 18 | 17/17 -> 17/17 | 0/0 -> 0/0 | 340/340 -> 340/340 |
| case-convert-unchanged | 70 -> 70 | 36 -> 36 | 1/1 -> 1/1 | 0/0 -> 0/0 | 360/360 -> 360/360 |
| caught-message | 85 -> 85 | 34 -> 34 | 34/34 -> 34/34 | 0/0 -> 0/0 | 449/449 -> 449/449 |
| class-value | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 51/51 -> 51/51 |
| closure-capture | 34 -> 34 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 136/136 -> 136/136 |
| code-point-guard | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 17/17 -> 17/17 |
| constant-field | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 36/36 -> 36/36 |
| cycle | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 45/45 -> 45/45 |
| cyclic-array | 4 -> 4 | 4 -> 4 | 2/2 -> 2/2 | 0/0 -> 0/0 | 7/7 -> 7/7 |
| dates | 51 -> 51 | 17 -> 17 | 17/17 -> 17/17 | 0/0 -> 0/0 | 136000/136000 -> 136000/136000 |
| deleted-field | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 289/289 -> 289/289 |
| duck-typed | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 9/9 -> 9/9 |
| early-return | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 91/91 -> 91/91 |
| enum-members | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 63/63 -> 63/63 |
| erased-array-cycle | 30 -> 30 | 20 -> 20 | 15/15 -> 15/15 | 0/0 -> 0/0 | 5/5 -> 5/5 |
| erased-cycle | 20 -> 20 | 10 -> 10 | 5/5 -> 5/5 | 0/0 -> 0/0 | 5/5 -> 5/5 |
| erased-slot | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 136/136 -> 136/136 |
| field-array-mutation | 129 -> 129 | 77 -> 77 | 30/30 -> 30/30 | 0/0 -> 0/0 | 9/9 -> 9/9 |
| frame-array-fields | 16 -> 16 | 12 -> 12 | 6/6 -> 6/6 | 0/0 -> 0/0 | 1/1 -> 1/1 |
| generator-walk | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 272/272 -> 272/272 |
| generic-copies | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 145/145 -> 145/145 |
| global-array | 34 -> 34 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 31/31 -> 31/31 |
| guarded-push | 91 -> 91 | 18 -> 18 | 18/18 -> 18/18 | 0/0 -> 0/0 | 153/153 -> 153/153 |
| imported-instanceof | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 43/43 -> 43/43 |
| in-narrowing | 17 -> 17 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 208/208 -> 208/208 |
| instanceof-class | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 13/13 -> 13/13 |
| interned-symbol | 18 -> 18 | 18 -> 18 | 18/18 -> 18/18 | 0/0 -> 0/0 | 0/0 -> 0/0 |
| iterator-protocol | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 36/36 -> 36/36 |
| kept-not-rewritten | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 81/81 -> 81/81 |
| local-anchor | 35 -> 35 | 1 -> 1 | 18/18 -> 18/18 | 0/0 -> 0/0 | 136/136 -> 136/136 |
| loop-break | 70 -> 70 | 16 -> 16 | 16/16 -> 16/16 | 0/0 -> 0/0 | 36/36 -> 36/36 |
| map-and-set | 104 -> 104 | 2 -> 2 | 8/8 -> 8/8 | 0/0 -> 0/0 | 459/459 -> 459/459 |
| map-entries | 72 -> 72 | 36 -> 36 | 22/22 -> 22/22 | 0/0 -> 0/0 | 33/33 -> 33/33 |
| module-closures | 68 -> 68 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 272/272 -> 272/272 |
| module-counter | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 272/272 -> 272/272 |
| no-escape | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 4096/4096 -> 4096/4096 |
| nulled-field | 17 -> 17 | 17 -> 17 | 17/17 -> 17/17 | 0/0 -> 0/0 | 136/136 -> 136/136 |
| number-to-string | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 72/72 -> 72/72 |
| optional-unassigned | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 187/187 -> 187/187 |
| overloaded-call | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 986/986 -> 986/986 |
| param-returned | 34 -> 34 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 144/144 -> 144/144 |
| parameter-defaults | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 272/272 -> 272/272 |
| parameter-properties | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 45/45 -> 45/45 |
| pile-shuffle | 1337 -> 1337 | 17 -> 17 | 11/11 -> 11/11 | 0/0 -> 0/0 | 128/128 -> 128/128 |
| readonly-anchor | 74 -> 74 | 40 -> 40 | 2/2 -> 2/2 | 0/0 -> 0/0 | 51/51 -> 51/51 |
| readonly-names | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 153/153 -> 153/153 |
| repeat-guard | 17 -> 17 | 17 -> 17 | 17/17 -> 17/17 | 0/0 -> 0/0 | 102/102 -> 102/102 |
| returned-find | 16 -> 16 | 8 -> 8 | 3/3 -> 3/3 | 0/0 -> 0/0 | 5/5 -> 5/5 |
| shared-tail | 127 -> 127 | 19 -> 19 | 17/17 -> 17/17 | 0/0 -> 0/0 | 572/572 -> 572/572 |
| store-elsewhere | 166 -> 166 | 33 -> 33 | 33/33 -> 33/33 | 0/0 -> 0/0 | 561/561 -> 561/561 |
| string-append | 1 -> 1 | 1 -> 1 | 2/2 -> 2/2 | 0/0 -> 0/0 | 17/17 -> 17/17 |
| string-build | 1 -> 1 | 1 -> 1 | 2/2 -> 2/2 | 0/0 -> 0/0 | 17/17 -> 17/17 |
| string-enum | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 9/9 -> 9/9 |
| structural-cycle | 30 -> 30 | 10 -> 10 | 15/15 -> 15/15 | 0/0 -> 0/0 | 5/5 -> 5/5 |
| subclass-field | 17 -> 17 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 272/272 -> 272/272 |
| swap | 34 -> 34 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 26/26 -> 26/26 |
| symbol-keys | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 343/343 -> 343/343 |
| throw-and-catch | 0 -> 0 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 14/14 -> 14/14 |
| traversal | 68 -> 68 | 1 -> 1 | 34/34 -> 34/34 | 0/0 -> 0/0 | 528/528 -> 528/528 |
| tuple-cycle | 50 -> 50 | 20 -> 20 | 25/25 -> 25/25 | 0/0 -> 0/0 | 10/10 -> 10/10 |
| typed-array-view | 170 -> 170 | 170 -> 170 | 85/85 -> 85/85 | 0/0 -> 0/0 | 408/408 -> 408/408 |
| upcast | 17 -> 17 | 0 -> 0 | 0/0 -> 0/0 | 0/0 -> 0/0 | 1888/1888 -> 1888/1888 |

All 80 cases were measured in both arms. No counters, allocations, leaks or answers moved; no floor changes are needed.

## Resumability guard control

`#900` candidate binary `/home/akisarou/.cache/nts-scratch/900/resume/candidate/nts`, SHA-256 `bc3215356bb99c80b45f3a7111d1de18faeddda348c0e6b2b81534de51dd4ff9`, is the retained candidate from its resume proof. The production source-identity owner confirms its embedded source digest matches final `874974f08fee3c6a9a69db1c421cc29a871456e0`; it also confirms the main pin matches `e6e47b4a9b11`.

| Compiler | Roots | Naive ops | Elided ops | Allocations (naive/elided) | Leaks (naive/elided) | Answer (naive/elided) |
|---|---|---:|---:|---:|---:|---:|
| main pin | open | 39 | 35 | 7/7 | 0/0 | 1/1 |
| main pin | closed | 39 | 35 | 7/7 | 0/0 | 1/1 |
| #900 | open | 41 | 37 | 7/7 | 0/0 | 1/1 |
| #900 | closed | 39 | 35 | 7/7 | 0/0 | 1/1 |

The closed-root correction removes the spurious host reentry assumption from the instrument. The #900 guard stays unchanged.

## Controls and retained output

Uncached `async-method`, `global-array`, `string-append` and Unicode `case-convert` checks passed, exercising asynchronous draining, module initialization and the alternate compile path. Both cached and uncached missing-work and injected `nts_future_host.c` controls failed with the case and cause named. Every emitted source was either compiled or knowingly excluded in both paths.

`node tooling/gate/inner.ts --no-agree` passed formatting, workspace Clippy, a fresh compiler build and the C/LLVM/JVM backend tests. No guard, compiler, fixture or floor was changed.

- `/home/akisarou/.cache/nts-scratch/960/measurements.json`: SHA-256 `5cfb645f1b27e13c35a6c0c3a0f8a6d6a840307c1cb5b1e6129de33956cb7f15`.
- `/home/akisarou/.cache/nts-scratch/960/main-before.log`: SHA-256 `b45da490998919cdd6c66199904c19b92c46918846313fb83082d5688a5c1271`.
- `/home/akisarou/.cache/nts-scratch/960/main-after.log`: SHA-256 `b45da490998919cdd6c66199904c19b92c46918846313fb83082d5688a5c1271`.
- `/home/akisarou/.cache/nts-scratch/960/900-open.log`: SHA-256 `43fd37a65b93d877eae5576e119f0dac225d3a5b427d5c29117c397af0ac1c54`.
- `/home/akisarou/.cache/nts-scratch/960/900-closed.log`: SHA-256 `3ef911b5907eade80895213ace8872fb261aff3ed9d10ede2145147cf86c47ba`.
- `/home/akisarou/.cache/nts-scratch/960/controls.json`: SHA-256 `31abacbcb05a821058df08639285563f73d89c3dd70e58fe7349350ae36bf96c`.
- `/home/akisarou/.cache/nts-scratch/960/measure.py`: SHA-256 `2a91d793d65032284f9d417252ae5cf98d46269dc9829a12af03049925c40628`.
- `/home/akisarou/.cache/nts-scratch/960/controls.py`: SHA-256 `d9e17d4182e38a4cda2f9ad8621ff40ef67e3ec3c99278399c197ab2656473f3`.
- `/home/akisarou/.cache/nts-scratch/960/run-before.sh`: SHA-256 `1cdc27bd5bdd85624f7b6845f6ef682b0816be26b6089ff732c65402d4110766`.
- `/home/akisarou/.cache/nts-scratch/960/identity.json`: SHA-256 `c7ae680a10042ea400cc6447bbfb24d2d5820ea986b620c046f1b4c6764dac58`.
- `/home/akisarou/.cache/nts-scratch/960/inner.log`: SHA-256 `fc5e3ab7305b9293e1eb221d2addb2aa0182e9e453a87ca5971a55e6a7c32341`.

## Runtime object reuse control

The reviewed harness `7de29129552cadb952e43e2e2b66bebbce82bcd0` still included the discarded CLI files in its runtime cache key. `main.c` differs when module initialization is present, so identical runtime sources received two keys. The key now excludes `main.c` and `nts_uv_host.*`, consistently with the accounted source set. The fix was committed as `c7ac451439778ce1d6e9137f55693b170230f38c` and verified with a separate `git log -1` before this comparison.

A clang wrapper counts real `-c .../nts_runtime.c` invocations while `module-counter` and `abstract-dispatch` share a fresh object directory. A control appends distinct comments to the discarded launcher, host C and host header after each emission.

| Cache key | Runtime compilations | Runtime objects | Rows |
|---|---:|---:|---|
| Reviewed key | 2 | 2 | unchanged |
| Corrected key | 1 | 1 | unchanged |
| Corrected key, varying excluded CLI bytes | 1 | 1 | unchanged |

The two corrected arms produce the same object key. The reviewed key fails the one-compilation assertion, so this control detects the mechanism defect. The full 80-row main-pin replay is byte-identical to the original table, including all naive/elided counters, allocations, leaks and answers. The #900 closed-root row remains 35 operations. Cached and uncached rejection controls and uncached Unicode compilation pass again. No floor changed.

- `/home/akisarou/.cache/nts-scratch/960/review/cache-proof.json`: SHA-256 `54a0cd19ef562474609f350f2d58f2e2e0c1a89b1edaba9ec51d168799cbcdcd`.
- `/home/akisarou/.cache/nts-scratch/960/review/cache-proof.py`: SHA-256 `61a8ac758538610e7d0bb036265aa1c61a5f7eaa83af9b350eae84adc2fa08ad`.
- `/home/akisarou/.cache/nts-scratch/960/review/full-proof.json`: SHA-256 `098973398894786237a440bceecb1771e3bc0b696fa8d635e6d3f1cb703dc912`.
- `/home/akisarou/.cache/nts-scratch/960/review/full-proof.py`: SHA-256 `21f20556276363f0793762ab2d9676c181c07f663dc37b92d8e0ffb3d89c05cb`.
- `/home/akisarou/.cache/nts-scratch/960/review/full-memory.log`: SHA-256 `b45da490998919cdd6c66199904c19b92c46918846313fb83082d5688a5c1271`.
- `/home/akisarou/.cache/nts-scratch/960/review/controls.json`: SHA-256 `31abacbcb05a821058df08639285563f73d89c3dd70e58fe7349350ae36bf96c`.
- `/home/akisarou/.cache/nts-scratch/960/review/controls.py`: SHA-256 `5290b376efa125e66b25ac40f4c9e5b6af0d199e4e69682fd306bdaa95adce2a`.
- `/home/akisarou/.cache/nts-scratch/960/review/before-clang.jsonl`: SHA-256 `ca1346eec9f22cc7429017aa91f334e0f09ad64e916711af28bc0c6bfa6d7478`.
- `/home/akisarou/.cache/nts-scratch/960/review/after-clang.jsonl`: SHA-256 `b8b1ae708485069bb427fa87e007954fbe60e40bc7bb3c3b83c253e2f017479d`.
- `/home/akisarou/.cache/nts-scratch/960/review/after-varied-cli-clang.jsonl`: SHA-256 `d997e71a74a518c4735aaf0152e3455e1af400a56cd1bacfd8ef788f36b190c4`.
- `/home/akisarou/.cache/nts-scratch/960/review/run-before.sh`: SHA-256 `54d0576f5b84651a6cc779ba986849509385804e3eb45ca8024d84b04108cb6a`.
