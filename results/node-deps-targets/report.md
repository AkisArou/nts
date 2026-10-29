# Bundled dependency target build costs

Release compiler; clang version 23.1.3, Zig 0.17.0, Node v24.20.0. Native worker limit 4, nice 19, CPU affinity 0-3,6-31. Saved sitting: nice 19 is verified by the recorded systemd unit configuration; affinity was sampled by taskset in the recorder. Priority was not independently sampled at startup. Retained one-minute load: 31.00–54.93; these are loaded-machine costs, with warm spread shown. Queue state was not sampled per launch.

Each target starts with a fresh private XDG cache. Cold C includes source extraction, dependency compilation, program compilation and linking; Windows totals also include the cold Zig linker/CRT cache. UV build is the executor’s compile/archive/input-observation phase. Five warm C launches and the subsequent LLVM build leave every dependency archive and command mtime unchanged. Cross binaries are built and inspected, not executed on Linux. Raw records retain complete argv, user instructions across all threads/descendants, CPU, RSS, imports and load per launch.

| Target | Cold C wall s | Cold CPU s | UV build s | Warm C median [range] s | LLVM with warm deps s | Archive bytes | C program bytes | LLVM program bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| x86_64-pc-windows-gnu | 39.279 | 143.062 | 8.660 | 2.479 [0.684, 6.914] | 12.711 | 1966082 | 1704448 | 1704448 |
| aarch64-pc-windows-gnu | 61.413 | 132.480 | 3.197 | 1.047 [1.017, 1.310] | 7.181 | 1994382 | 1628160 | 1628160 |
| x86_64-apple-darwin | 7.606 | 11.700 | 1.686 | 0.614 [0.575, 0.862] | 6.675 | 1253608 | 124064 | 124064 |
| aarch64-apple-darwin | 7.237 | 11.417 | 1.613 | 0.731 [0.632, 0.890] | 6.194 | 1275288 | 145088 | 145088 |
| x86_64-apple-ios-simulator | 8.301 | 13.917 | 2.176 | 0.725 [0.701, 0.771] | 4.775 | 1185112 | 119824 | 119824 |

Compiler bytes: 47892432 before, 56527328 after (+8634896). All plans share the same 2402 verified source files; each added target compiles 37 libuv translation units.
