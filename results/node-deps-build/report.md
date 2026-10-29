# Bundled Node dependency build cost

Release compiler; four native workers, nice 19, excluding reserved CPUs 4–5. Wall readings retain load and queue conditions in the raw record. CPU and instructions include every thread and descendant from exec, plus GNU time.

| Build | Wall seconds | CPU seconds | User instructions | Peak RSS KiB |
|---|---:|---:|---:|---:|
| First C crypto program | 28.507 | 101.605 | 541130943417 | 334536 |
| Warm C, median [min, max], 5 launches | 1.210 [1.111, 1.417] | 3.456 [3.358, 3.791] | 23231376931.000 [23208718692.000, 23336789115.000] | 331908.000 [331432.000, 340696.000] |
| LLVM program with warm native dependencies | 2.298 | 4.581 | 31311469196 | 338208 |

Warm dependency source validation: 0.158 [0.152, 0.167] seconds; toolchain validation: 0.198 [0.183, 0.208]; archive validation: 0.284 [0.255, 0.347]. Five fresh validator processes. No dependency object/archiver command or archive mtime changed during warm builds or validation.

Compiler bytes: 47892432 before, 56492344 after (+8599912). Embedded source: 38758881 raw bytes, 7835861 compressed bytes.

Protocol correction: The original validator request reordered flags and created a second key. All original validator rows are rejected; original cold/warm C and LLVM program guards had already passed. Only five corrected validator launches are used here. Corrected validation was a later continuation; no wall ratio is drawn across the groups.

Both programs execute the linked OpenSSL API and print 3. Their ELF dependency lists contain none of the owned system libraries. Download and Rust compiler construction are excluded from the program-build figures.
