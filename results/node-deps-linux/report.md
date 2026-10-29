# Bundled dependency target build costs

Release compiler; clang version 23.1.3, Zig 0.17.0, Node v24.20.0. Native worker limit 4, nice 19, CPU affinity 0-3,6-31. Priority and affinity observed in the recorder at startup, before any measured command. Retained one-minute load: 32.95–110.14; these are loaded-machine costs, with warm spread shown. Queue state was not sampled per launch.

Each target starts with a fresh private XDG cache. Cold C includes source extraction, dependency compilation, program compilation and linking; Windows totals also include the cold Zig linker/CRT cache. The source calls OPENSSL_version_major, reaching OpenSSL, Brotli, zlib, zstd and libuv. Native build sums the executor’s compile/archive/input-observation phases over that complete closure. Musl binaries run on the host or under qemu-aarch64; GNU arm64 is build-and-inspect only. Five warm C launches and the subsequent LLVM build leave every dependency archive and command mtime unchanged. Raw records retain complete argv, user instructions across all threads/descendants, CPU, RSS, imports and load per launch.

| Target | Cold C wall s | Cold CPU s | Native build s | Warm C median [range] s | LLVM with warm deps s | Archive bytes | C program bytes | LLVM program bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| aarch64-unknown-linux-gnu | 85.679 | 228.425 | 62.213 | 1.001 [0.972, 1.050] | 6.333 | 21184384 | 1797832 | 1797712 |
| aarch64-unknown-linux-musl | 89.770 | 282.618 | 53.147 | 0.950 [0.893, 0.998] | 5.859 | 21047906 | 3068080 | 3067992 |
| x86_64-unknown-linux-musl | 92.514 | 280.319 | 53.154 | 0.978 [0.893, 0.989] | 6.795 | 20911522 | 2684008 | 2683968 |

Compiler bytes: 47892432 before, 57578144 after (+9685712). All plans share the same 2477 verified source files; aarch64-unknown-linux-gnu: 1241 native translation units; aarch64-unknown-linux-musl: 1241 native translation units; x86_64-unknown-linux-musl: 1252 native translation units.
