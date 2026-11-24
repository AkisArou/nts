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

The controls are in `tooling/gate/step-bound.test.ts`. The runner's controls
run a real runner in a named unit with its own ledger. Where they test the
lost-CPU excuse and the CPU bound, they own their observations: a clock that
stands until the step moves it, and the step slice's own counters, advanced
together in one write of the fixture's capability file. A CPU sample is one
observation, `HostObservations.cgroupCpuSample`, so the runner never sees such
a write half done. One kernel control reads live counters.

| control | with the change | on main d9941ea0f4's runner |
|---|---|---|
| (A) owned: 30 s pass, the slice runs 0.3 s and is `full` 29.7 s; bound 3 s | PASS: execution 0.300 s, lost 29.700 s | execution 30 s |
| (A′) the same 30 s with no loss, in the same test | INSTRUMENT: "step exceeded its bound of 3 s" | — |
| (B) sleeping; bound 3 s | stopped: "step exceeded its bound of 3 s" | stopped, same |
| (C) owned: 5 s pass, the slice runs 25 cpu-s; bound 20 s at width 1 | stopped: "step exceeded its CPU bound of 20 cpu-s", execution 5 s | no CPU bound: held to its 300 s runaway limit |
| (D) four threads of bounded work on one CPU; bound 600 s | PASS: execution ≥ 0.9 × its CPU | — |
| (E) kernel: a loop alone in its cgroup on one CPU, at full-check weight, beside a landing-weight spinner; counters bracket a 2 s interval | usage + `full` ≥ 0.95 × the interval: 0.020 + 1.991 s of 2.011 s | — |

## The launch is not excused (#1014)

#889 first landed with a live outranked control: the step's loop and a
landing-weight spinner shared one CPU, the run's root at full-check weight,
bound 3 s. In loaded landings (load 112–137) it was stopped at its bound with
0 cpu-s, which refused #857 three times, and #1014 reverted and re-landed the
change.

`full` was read from the right cgroup, and the loop's phase is excused
exactly. The clock starts at spawn, however, and the step's launch comes first.
`systemd-run --scope` runs in the runner's cgroup while the user manager makes
the scope, and the step's slice is empty. Then the entry check, `/usr/bin/time`,
the shell and the node payload start, spread over all gate CPUs, where `full`
is diluted. All of it runs at full-check weight, which a landing outranks
100:1 on every CPU, not only the spinner's:

| run | load | step start → loop | execution s | cpu s | lost s |
|---|---:|---:|---:|---:|---:|
| re-applied, idle machine, 3 runs | 9–13 | — | 0.40–0.51 | 0.31–0.41 | 22.3–23.8 |
| confined to CPUs 28–31 beside agent-weight spinners (10:1) | — | 2.74 s | 1.09 | 0.36 | 25.3 |
| #857's landing, control (c): 8 spinning threads | 137 | — | 7.78 | 20.76 | 13.6 |

In the confined run, 0.75 s of the launch was charged as execution with no
CPU run. In #857's landing, control (c) charged about 5 s more than its eight
threads' 2.6 s of run per CPU. That launch cost alone exceeds a 3 s bound.

Production keeps this. A full-check step's launch costs it seconds against
bounds of at least twice the command CPU budget, in the safe direction. The
controls that decide the excuse now own their observations. The one live
kernel control holds at any load: its premise is a task alone in its cgroup
and always runnable on one CPU, so every moment is either run or `full`.

Under the same 10:1 confinement the new controls passed 3 of 3 runs, with the
kernel control's sum at 99.9–100.7% of its interval.

Raw output is in kept scratch (SHA-256).

`~/.cache/nts-scratch/889/`:

- `samples-1.jsonl`: 26369ef2fa3bc82b6111b51303a243e3a0eb4d23f60be328b95d724a3de2e903
- `samples-1.some-full.tsv`: f71388265e90060a349150e65ff948cc9cb452a4aa5e52f9b7c17b6028ca0011
- `pressure-exp/results.txt`: 6ceff4822e053737f198f22078d21867e950dff4ed2c17579c09011eecc1e279
- `pressure-exp/run.sh`: 948ab34756d53465c281f28e22d96b62498a766b785de79a09b1ffedcf416d2c
- `pressure-exp/out1-schedstat.sh`: 6a5262c5463402bd78f2584de5b5b11c37256858e7c0754ba1e5d77d5208f1c3
- `pressure-exp/out1-schedstat.txt`: 22b22d166ea12422d17b6c3753b279d173610b13ed2ec49aa1543cfca4ddaa02
- `test-2.log`, #889's controls: 9847ea153d19997b9f43b89dd1ddb5dc48c4b7802522ec969eacd1e518d9ba24
- `cf-main.log`, on main's runner: eedddb2f95144d3041984ef729cdeaef124587b3c05c15d08b8bfbfa49da87a2
- `cf-some.log`, with `some`: 13668d6e2594cc6ffe9d4110682501ef6d397570a23722a4f338335a3522bb30

In `out1-schedstat.txt`, each line's `cpus=` field is mislabelled; the first
line is the spread placement and the second the pinned one.

`~/.cache/nts-scratch/857/refused-adb5d644-tooling-tests.raw.log`, #857's
refused tooling step: 5d402d5d2c03fca047feca4da7c7daec7a9ee4e7ef8b537c69d1fefc968a46f3

`~/.cache/nts-scratch/1014/`:

- `old-control-reapplied.log`, #889's controls re-applied: c959ebdab9c98eb199a778f5fe22e1da8b414c81d4ddfdca2517219db77e65e5
- `repro-confined.log`, the confined launch: 2be120b4e23f45f65fb502b4c1cb669c978cf9a9f67308586368e09d5e930d99
- `step-bound-repro1014.test.ts.txt`, its control: 75d1f0b68ddf2e97949f5b84d77debf5ea7750552ce7b6580e57f2009ad4b28c
- `focused-1.log`, the new controls: 40dfa5532c4e0339773b532043be2cc8a83b1eebde402d023b47a1337699d308
- `cf-main-runner.log`, on main's runner: 7991b04cb1c769e3b7b4d115c8003315427b76570df66e47c4cb6f383bc20d55
- `confined-new.log`, three confined runs: a091258aef045c1718e711935770e9a479c214fc63e9c58db08391201ea8e847
