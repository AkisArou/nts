# Reader contexts and module-text scanner removal — part of #728

Final source `9307db1c39003ae7a81c2413c3e64964a648f532`; complete matched removal census and supported source `c2401276d7ac49103c0bb900584530cd77ac1b30` against `1609caa6b55b71cf785b4b4fa3bd16e0e8fbcb5b`.

The selector now follows declared module, file, data, project, module-member and fixture-context inputs. JS/TypeScript path-shaped text never becomes a read. Shell and Python entry parsing remains: a launched JS entry contributes its parsed module closure, preserving its fixture context. Runtime and copier descriptors have the same owner.

`fixtureInput` supplies only canonical, declared private data namespaces. It cannot substitute module bytes or borrow another reader's grant. Module visits are context-local, so either traversal order retains a later production read. The staging manifest records the reader and fixture owner. `moduleMembers` selects one literal basename and follows those modules' imports; its data option retains the same directory's separately owned metadata. `projectConfig` describes an explicitly compiled project through the shared pinned parser, alongside the existing nearest-project descriptor.

The generic benchmark-record reader accepts its actual run store and validates immutable Git history at that same location; production dataset declarations belong to records.ts, while the test supplies private datasets. The custom-store rewrite/deletion control and default corruption controls remain. The unrouted fixture likewise supplies its private populations, while the production reader retains the real ones.

## Complete matched inventory

Switch-off pairs: 83,648 → 0; first-loss sites/readers: 334/133 → 0/0. All four censuses retain 142 unplaced + 33 policy paths. A zero switch-off count alone is not the retirement proof.

Raw graph reach retires 84,344 pairs and adds four records readers (C/JVM/LLVM outcome tables and count-bands.json). Every retired pair has a classification in the retained full index:

| Classification | Pairs |
| --- | ---: |
| caller-project-not-library-adjacency | 84 |
| private-records-population | 507 |
| private-unrouted-population | 40 |
| producer-freshness-still-owed | 3 |
| retained-by-other-routing-owner | 228 |
| reviewed-data-text | 83482 |

The old graph's raw reach and final routing are distinct. 32,290 raw retirements still run through other routing owners, and 624 never reached final routing. Actual routing retires 51,497 pairs, including 67 derived decisions: 53 program-oracle preparations, four TypeScript-oracle preparations, one RC compile-time companion and nine build/Clippy/tests obligations where three results-only tables return to the existing records-only policy. Each dependent decision and its retired primary inputs are listed in removal-dependent-routes.tsv. No expectation was widened to preserve invented reach.

The 84 adjacent-config pairs are caller-project contexts, not reads of four libraries' own tsconfig files. removal-project-contexts.tsv records all 32 readers, source digests and observed expressions: supplied source/reference paths, private or generated directories, and caller corpus roots. The actual compiled projects and metadata populations retain their declarations. The refused first experiment's 3,217 config losses are restored, rather than classified away.

The full raw and actual-routing classifications, before/after indexes, complete routes and digests are in removal.json. Multi-megabyte indexes stay off tree under the existing full-check keep row until #728 closes. The frozen historical replay remains byte-equal: `0c409f453dee0c913ef9dcebadc2968a7361f295469f47f10c49dd37d64a5475` (6,754,577 bytes).

## Present freshness gap

This slice does **not** close #728. The three old `url-hosts.ts` → TypeScript backend edges only named the generator in output provenance. Its TypeScript-oracle preparation companion follows them. They are retired as execution reach, but the generator currently remains standalone with no gate freshness step. Offline hash-pinned IdnaTestV2 provisioning and the existing generator `--check` still need wiring and controls before #728 closes. No completed freshness coverage is claimed here.

## Proof

Final cache follow-up consumers/timing: 214/214 at `9307db1c39003ae7a81c2413c3e64964a648f532`. The pre-cache supported source had 213/213 focused controls. Host: 1,880 sources / 258 closures / 413 reads. Strict: 821 modules / 5,707 recorded diagnostics / 15 improved, no new diagnostics.

Supported command: `node tooling/landing/check.ts c2401276d7ac49103c0bb900584530cd77ac1b30 --here`. GREEN: 2,210 tooling passed, 0 failed, 2 TODO; 3,044 Rust passed, 0 failed, 8 ignored across 55 binaries and 18 doctest crates. Gate wall 823.015 s; admission wait 555.790 s is recorded separately and may overlap execution. CLI wall 903 s includes preparation. The canonical gate-inputs step used 6.806190 cgroup CPU-s and 5.632 wall-s. Failed/narrowing experiments are retained and excluded in removal.json.

The later graph-local membership cache has a separate final proof, not a claimed rerun of the full canonical suite. Its complete coverage and routing maps are identical to the supported source, its 214 semantic/consumer/timing controls pass, and the original frozen digest replays byte-for-byte again. Returned directory arrays are independent; a fresh graph observes newly tracked members.

## Matched standalone cost

All completed comparisons use fixed source `1609caa6b55b71cf785b4b4fa3bd16e0e8fbcb5b`. Engine pins are baseline `1609caa6b55b71cf785b4b4fa3bd16e0e8fbcb5b`, uncached `c2401276d7ac49103c0bb900584530cd77ac1b30`, cached `9307db1c39003ae7a81c2413c3e64964a648f532`. Current-source canonical gate-inputs cost is reported separately above.

ABBA under `with-lock.sh --wait --key perf-count`, user instructions on CPU 4, fresh process per arm and in-process caches only. The controller excludes CPUs 4–5. Peak is the resettable own-unit cgroup peak and includes the same controller, descendants and source-preparation charge within each cohort. No deliberate background load was added; private source copies and .git were removed together. Absolute numbers are not compared between cohorts.

The first successful pair found a real increase, not noise:

| Engine | Instructions | Cgroup CPU s | Peak bytes | Wall s | Load (1/5/15) |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline | 47085253921.5 | 3.970974 | 1456936960 | 3.995153 | 9.51/17.47/28.38; 9.3/17.16/28.17 |
| uncached | 54637379049.0 | 4.209421 | 1444282368 | 4.226757 | 9.51/17.47/28.38; 9.15/17.26/28.26 |
| New/old | 1.160393 | 1.060047 | 0.991314 | 1.057971 | — |

One profile identified repeated directory membership scans. The graph already owned one tracked inventory; directory and basename selections now reuse it for that graph only, with copied reported lists. Against baseline after that correction:

| Engine | Instructions | Cgroup CPU s | Peak bytes | Wall s | Load (1/5/15) |
| --- | ---: | ---: | ---: | ---: | --- |
| baseline | 46614023988.0 | 3.892833 | 1425098752 | 3.914905 | 6.41/9.67/20.67; 6.57/9.6/20.53 |
| cached | 43686972343.5 | 3.683463 | 1409613824 | 3.698523 | 6.41/9.67/20.67; 6.7/9.68/20.62 |
| New/old | 0.937207 | 0.946217 | 0.989134 | 0.944729 | — |

A direct uncached/cached pair proves the optimization within one cohort:

| Engine | Instructions | Cgroup CPU s | Peak bytes | Wall s | Load (1/5/15) |
| --- | ---: | ---: | ---: | ---: | --- |
| uncached | 54804502835.5 | 4.187166 | 2005270528 | 4.208511 | 6.87/9.07/19.34; 7.34/9.06/19.17 |
| cached | 44088534570.0 | 3.719856 | 2003712000 | 3.735119 | 6.96/9.05/19.28; 7.28/9.08/19.23 |
| New/old | 0.804469 | 0.888395 | 0.999223 | 0.887516 | — |

Verdict: improvement beyond the arms' spread. The direct pair reduces instructions by 19.6% and CPU by 11.2%; the final selector is also below baseline in its separately matched pair. The failed initial attempt, uncached regression, profile, full raw arms, load, commands and all engine/source pins remain in removal.json and its digested off-tree artifacts. No cross-run cache or namespace semantic change was introduced.
