# A step's bound and the CPU other work takes

Issue #889. Approved by the coordinator. A gate step's execution bound
(`tooling/gate/step-bound.ts`, applied by `tooling/gate/run.mjs`) counted every
second outside the runner's declared admission waits. A full-check step runs at
CPU weight 10 beside agents at 100 and landings at 1000 (`ranks.ts`). Outranked
for the CPUs, it therefore spent its bound while it barely ran. In #823's
contended batch, the full-check slice ran 76.8 cpu-s in 982 s, and all 982 s
counted as execution.

## Change

- run.mjs samples the step slice on the bound's 500 ms tick and at the step's
  end: its `cpu.stat` usage and its `cpu.pressure` `full` total, read through
  `HostObservations`. A read that fails stops the run by name.
- `ProgressBound` divides the undeclared time between two samples at the second
  one. Time lost to other work is the pressure counter's delta, at most that
  undeclared time, and it spends nothing. The rest is used, and what of it the
  step did not run is stalled. An observation without a sample, made when a
  token is granted or returned, only marks where a declared wait begins or
  ends. Waits therefore stay exact while the counters are read at the tick's
  pace.
- A CPU bound backs the execution bound: the bound times the step's width,
  which is the slots it may hold (run.mjs's `width`, step-scheduling.ts's
  `usableWidth`). In the committed baseline it is at least 16 times each step's
  recorded CPU (bench-agree: 7168 s × 8 against 3488 cpu-s).
- The bound has no separate stall limit. Stalled time is part of used time, so
  a sleeping or hung step still stops at its bound at wall rate. Healthy steps
  of the live run below stalled between 0 and 87% of their wall time, so a
  shorter stall limit has no basis.

## `full`, not `some`

`some` counts time when any of the step's tasks waits for a CPU, even while its
other tasks run. A step that runs more threads than its CPUs, as a build with
more jobs than its width does, competes with itself, and `some` would excuse
most of its time. `full` counts time when it had runnable tasks and none of
them ran.

Live wide run at 2017bf23a3de beside a landing check, 1218 s, load 29–40 on 30
gate CPUs. Both counters stay small on an unsaturated machine. The few
differences come from steps with many threads:

| step | wall s | cpu s | Δsome s | Δfull s |
|---|---:|---:|---:|---:|
| integrity | 1218 | 3361 | 21.2 | 19.1 |
| tooling | 961 | 5879 | 49.0 | 14.6 |
| dex | 822 | 2989 | 20.5 | 5.9 |
| interop | 519 | 2194 | 21.7 | 15.7 |
| gate-inputs | 257 | 285 | 19.9 | 6.2 |
| profile | 621 | 1686 | 12.5 | 12.1 |

Controlled runs, 12 s each, on CPUs 28–31. The work runs at full-check weight
10; where outranked, it runs beside four agent-weight (100) spinners on the
same CPUs:

| case | ran cpu-s of 48 | some s | full s |
|---|---:|---:|---:|
| 8 threads, alone (self-oversubscribed) | 38.8 | 7.0 | 1.9 |
| 4 threads, alone | 32.5 | 3.7 | 2.6 |
| 4 threads, outranked | 7.3 | 6.9 | 6.0 |
| 8 threads, outranked | 12.7 | 8.4 | 5.8 |

## The excuse is a lower bound on the CPU taken

Against one outranked thread's own `/proc` schedstat run delay, over 10 s:

| placement | ran ms | run delay ms | some ms | full ms |
|---|---:|---:|---:|---:|
| free across CPUs 28–31 | 1186 | 8804 | 2476 | 2476 |
| pinned to CPU 31 | 2881 | 7115 | 7113 | 7113 |

The kernel averages a cgroup's stall over the CPUs it was non-idle on. A
cgroup on one CPU is measured exactly. One spread over N CPUs reports roughly
its real wait divided by N. The excuse is therefore a lower bound, in the safe
direction: more time counts as used than really was. An outranked multi-CPU
step still has roughly a third to a half of its loss counted against its bound
(the outranked 4- and 8-thread rows: about 85% and 74% of their CPU lost,
excused as 50% and 48% of wall). `full` is not scaled by a CPU count or any
estimate, because a correction that over-excuses would break that direction.
The full check's run bound (#825, `measure-command.ts`) reads `some`, and it
under-counts its slice's loss for the same reason. It is left as it is.

## Controls

The controls are in `tooling/gate/step-bound.test.ts`. Each runs a real runner
in a named unit with its own ledger and live CPU and pressure counters. The
landing-weight spinner runs in a unit of its own, stopped by name.

| control | with the change | on main 2017bf23a3's runner | with `some` in place of `full` |
|---|---|---|---|
| (a) outranked: the loop shares one CPU with a landing-weight spinner; full-check root; bound 3 s | PASS in 25.5 s: execution 0.49 s, lost 25.0 s, 0.36 cpu-s | INSTRUMENT: "step exceeded its bound of 3 s" | PASS |
| (b) sleeping; bound 3 s | stopped: "step exceeded its bound of 3 s" | stopped, same | — |
| (c) eight spinning threads, width 1; agent root; bound 20 s | stopped at 3.0 s: "step exceeded its CPU bound of 20 cpu-s", 22.9 cpu-s, execution 3.0 s | no CPU bound: the run took 21.8 s, to its 20 s bound | — |
| (d) four threads of bounded work on one CPU; bound 600 s | PASS: execution 1.13 s ≥ 1.08 cpu-s, lost 0.001 s | — | fails: execution 0.28 s, 0.86 s excused |

Main's runner ran in an independent repository of main's files (`git archive`).
The `some` arm ran after the commit and was restored from a copy.

Raw output is in kept scratch, `~/.cache/nts-scratch/889/` (SHA-256):

- `samples-1.jsonl`: 26369ef2fa3bc82b6111b51303a243e3a0eb4d23f60be328b95d724a3de2e903
- `samples-1.some-full.tsv`: f71388265e90060a349150e65ff948cc9cb452a4aa5e52f9b7c17b6028ca0011
- `pressure-exp/results.txt`: 6ceff4822e053737f198f22078d21867e950dff4ed2c17579c09011eecc1e279
- `pressure-exp/run.sh`: 948ab34756d53465c281f28e22d96b62498a766b785de79a09b1ffedcf416d2c
- `pressure-exp/out1-schedstat.sh`: 6a5262c5463402bd78f2584de5b5b11c37256858e7c0754ba1e5d77d5208f1c3
- `pressure-exp/out1-schedstat.txt`: 22b22d166ea12422d17b6c3753b279d173610b13ed2ec49aa1543cfca4ddaa02
- `test-2.log`, the controls at the commit: 9847ea153d19997b9f43b89dd1ddb5dc48c4b7802522ec969eacd1e518d9ba24
- `cf-main.log`, on main's runner: eedddb2f95144d3041984ef729cdeaef124587b3c05c15d08b8bfbfa49da87a2
- `cf-some.log`, with `some`: 13668d6e2594cc6ffe9d4110682501ef6d397570a23722a4f338335a3522bb30

In `out1-schedstat.txt`, each line's `cpus=` field is mislabelled; the first
line is the spread placement and the second the pinned one.
