# Native executable launch to exit

Issue #870 measures the executable shipped by `nts build`, from exec through
module evaluation and exit. The before compiler and products are from
`723a9ce9f90144ee5047790c35a88912394f7e49` in pool tree 8.

The launch timer uses CPU 4 with sibling 5 idle, one canonical environment,
three warmup rounds and 21 rotating timed rounds, including `/bin/true`.
Times below are medians; spread is the upper/lower quartile ratio. Loads went
from 24.44/29.86/39.28 to 28.93/30.50/39.29. Every timed sibling sample was zero.

| Before row | nts C µs / spread | nts LLVM µs / spread | ScriptC µs / spread | node µs / spread | floor µs / spread |
|---|---:|---:|---:|---:|---:|
| startup-empty | 332.8 / 1.033 | 301.2 / 1.054 | 286.6 / 1.136 | 40428.4 / 1.038 | 181.6 / 1.095 |
| startup-hello | 316.0 / 1.176 | 301.6 / 1.098 | 257.5 / 1.190 | 41619.6 / 1.111 | 179.8 / 1.107 |

Against ScriptC, empty is 1.161× LOSS on C and 1.051× TIE on LLVM; hello is
1.227× LOSS on C and 1.172× TIE on LLVM. Ties use the larger cell spread or
1.05. The empty C and LLVM products are byte-identical:
`363d9200a280721ce000f382927384508fa2dcc9675e1593412714597c7eb2e1`.
Their difference within this sitting cannot be attributed to backend code.

## Work before user code and at exit

51 repeated `perf stat` launches count user instructions and faults. The
unperturbed launch sitting above is separate from these instrumented launches.

| Before column | user instructions / launch | minor faults / launch | major faults | syscalls including exec and exit | loaded dependencies besides the interpreter |
|---|---:|---:|---:|---:|---|
| nts C | 192000 | 77 | 0 | 62 | libc, libm |
| nts LLVM | 191999 | 77 | 0 | 62 | libc, libm |
| ScriptC | 120685 | 68 | 0 | 31 | libc |
| /bin/true | 140228 | 53 | 0 | 31 | libc |

Libuv is already linked statically. Both nts runners eagerly call
`uv_default_loop`, install idle and async handles, run the loop and shut the
host down. The trace shows epoll, a 256-entry io_uring with two populated
mappings, two pipes and an eventfd, despite no scheduled work. Shutdown
performs io_uring and epoll turns; libuv's exit destructor closes its signal
pipe. ScriptC performs none of these operations.

The ELF link also retains unused libm. `LD_DEBUG` reports initial relocations
132 plus 17 relative relocations for nts and 101 plus 20 relative for ScriptC;
final relocation counts are 163 and 108 respectively. Its loader diagnostics
report 40087–41619 cycles for nts and 28152 for ScriptC. These are perturbed,
single-launch loader diagnostics, not the benchmark's wall-time cells.

User-only `perf record` uses `cpu_core/cycles/u`, period 10000, user callchains
and DWARF stacks over 300 execs per column. It retains launch-driver samples,
so it is not a kernel-time decomposition. It shows loader work and the CPU
feature constructor; syscall traces identify the unused loop resources and
exit work. The first recording attempt requested disallowed kernel callchains;
the user-only run succeeded without changing host profiling policy.

The change installs a standalone libuv host without acquiring its default
loop. Owner-only callbacks transition once when work needs it. The foreign
entry stays fixed; its mutex publishes a wakeup target after async-handle
initialization. Explicit loops and GUI adapters stay eager. ELF links scope
`--as-needed` to libm. Node addons install no nts host, and the JVM uses its
own `NtsEnv`, so neither acquires this C host. Promise and microtask runtime
paths are unchanged.

Raw evidence is retained under `~/.cache/nts-scratch/870/`: the before sitting
in `before/`, and ELF, loader, syscall and perf observations in `before-profile/`.
