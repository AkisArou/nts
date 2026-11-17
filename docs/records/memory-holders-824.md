# Who held the memory a landing waited for

Issue: #824. Date: 2026-11-17. Base: main `06b28dbb8d`.

## The wait

#823's BEFORE batch, a landing-priority tooling step, waited 1775 s to grow
by 19 GiB to 20 GiB. The run started at 07:47:27Z and the tooling step at
08:17:14Z. The wait line said: 14.3 GiB available, 3.1 GiB of it promised to
running jobs, 2.0 GiB kept for the system. Evidence:

- `~/.cache/nts-scratch/823/batch-before/landing/gate.log`, lines 99–100
  (sha256 `330f1dacc89d1f77725208aac1c666dc8712a0cfc3869beee789e61aa1a8e0fe`)
- `summary.json` (sha256
  `75be5d0208a1bffd951365172532bbd0721941f6cf1e9adb7697b8effc9d7491`)

"Promised" counts only what admitted jobs have reserved and not yet used.
Their live use is already missing from MemAvailable, and the line did not
print it. So the line could not separate ledgered use from memory nobody
reserved. Reading it as "about 17 GiB outside the ledger" was wrong.

## What held it

The logs and the user journal (`journalctl --user`, 07:30–09:00Z) show two
ledgered lower-rank runs beside the landing:

| Holder | Rank | Ledgered | What it held | Evidence |
|---|---|---|---|---|
| #822's `check.ts --here` (`nts-rqv3ya54j.slice`, run `here-804bfdae9fac`) | agent | yes | its `tests` step held 8.9 GiB of 11.6 GiB for 1367 s, until its 1363 s step bound | that run's `gate.log` l.178–188: "starts no new steps" for exactly 1775 s |
| the full check's core run (`nts-rbgi15ztd.slice`, `core-3e4ffaf4759a`) | full-check | yes | 9–10 GiB reserved, test262 steps running; slice peak 12.7 GiB | its `full-check.log` l.420; journal |
| agent sessions, controllers, signalbox | — | no | about 3.5 GiB (by the live census below) | census |

Both ledgered runs yielded to the landing, so neither started new steps.
Steps already running keep their memory, by the ledger's contract ("nothing
running is ever stopped"). Whether a landing may stop or cap lower-rank work
that is already running is a separate, design-first question.

## The kills during the batch

`journalctl -k`, 09:40–10:45 EET (07:40–08:45Z), recorded 50 OOM events and
125 "Killed process" lines across 43 cgroups. Every event is
`CONSTRAINT_MEMCG`: a per-case cgroup cap inside the case or fixture slices
of a tooling step's tests. The caps were 96, 128, 256, 512 and 768 MiB, and
1 and 1.125 GiB. One example is `oracle-batch.test.ts`'s pressure mode at
128 MiB. The same set recurs in four independent tooling runs
(`nts-rftq9n157`, `nts-rqv3ya54j`, `nts-rtj2zu4te`, `nts-rof1scfwn`).

- No event was machine-wide, and none fell inside the wait. The first kill is
  at 08:17:17Z, three seconds after the tooling step started.
- No reservation was exceeded, and the ledger never admitted beyond capacity.
- Raw kernel log: `~/.cache/nts-scratch/824/oom-kernel.log` (sha256
  `c300c8bf6faafcecdd4e3253fbb8754aba6a8be19c41f1a212af3650e6abd01a`).

## Live census of a contended period

A sampler ran from 12:30 to 13:00Z, every 30 s, 59 samples. It read every
process's RssAnon+RssShmem and attributed each process to an admitted
ledger entry (by its cgroup or its owner's tree) or to none, grouped by unit.
It ran beside a full-check core run, a landing, agents' inner loops and
`761-decide`.

- Raw samples: `~/.cache/nts-scratch/824/census.jsonl` (sha256
  `fd3f72073d87838923eb27543709791fba92745bb0d7398d7563880b2573eae3`).
- Sampler: `census.ts` (sha256
  `f451452b7113c33c2d2bf3d608fae4928fd1145354b946d29c0a9ff213fc9d2c`).

Over the period: 2.0–24.5 GiB available, ledgered use 0–13.9 GiB, unledgered
2.7–10.4 GiB.

| Holder (peak in a sample) | Ledgered | Unledgered | Kind | Outcome |
|---|---|---|---|---|
| gate run roots `nts.slice/nts-r*.slice` | 13.9 GiB | 0.8 GiB | landing and full-check runs | ledgered; the remainder is steps' unmeasured kernel memory |
| #761's agent session scope (`tmux-spawn-bdeb0f24…`), 12:38–12:40Z | 0 | 8.1 GiB | a 12.7 GB file in `/tmp`: tmpfs pages charged to the writer's cgroup | named; handled at its cause (sessions started after 12:47Z get an on-disk `CLAUDE_CODE_TMPDIR`) |
| `app.slice/nts-761-dryrun.service`, 12:52–12:56Z | 0 | 2.3 GiB (journal peak 3.1 GiB) | an agent's `check.ts --dry-run`: the landing selector | named; #829 |
| `nts.slice/nts-landing-check.service`, 12:48–12:50Z | 0 | 2.05 GiB | the landing's own candidate selection before its gate run reserved, plus its runner | runner: fixed here (`OwnerSpec.tree`); selector: #829 |
| `app.slice/nts-<task>-*.service` | 2.4 GiB | 2.3 GiB | agents' admitted jobs and their unadmitted neighbours | ledgered part named with its rank |
| other agent session scopes | 0 | 0.3–0.9 GiB each | Claude sessions | named; standing processes that cannot yield |
| `app.slice/app-signalbox.slice` | 0 | 0.77 GiB | signalbox | named |
| `app.slice/nts-full-check.service` | 0 | 0.71 GiB | the full check's controller | named |
| `app.slice/nts-full-check-count.service` | 0 | 0.41 GiB | the hourly count | named |
| a gate runner outside its run's measure | 0 | 0.3–0.6 GiB | `run.mjs` in its launcher's unit | fixed here: the run's measure includes its runner tree |

Standing processes (sessions, controllers, signalbox) are not ledgered. They
cannot yield, and MemAvailable already excludes them, so a reservation would
change no decision. The census names them in every wait.

## The status call's cost

`node tooling/gate/admit.ts --status` on the live machine, at 12:59Z, with
load 36 and one landing running:

- 177 ms cold, then 39 ms and 39 ms;
- the module import alone takes 36 ms, so the census costs about 3 ms;
- it printed 14 holder rows and 4.2 GiB outside those cgroups.

Output: `~/.cache/nts-scratch/824/status-3.txt` (sha256
`a62e451d3d3971918ef96383fb8348a787c69bd638df2453564394ac3fd8042a`).

## The runner measure's counterfactual

The kernel-wiring control (`memory-ledger.test.ts`, "kernel wiring: …") runs
in a unit of its own. It reserves with `owner: {cgroup, tree: true}`, once
for the unit's own cgroup and once for a real transient scope holding
64 MiB.

- With the fix (this change), the control passes:
  - the scope's live charge is 75.6 MiB, and the live listing names the scope;
  - in the "inside" case, the owner counts once, in its cgroup's charge, and
    its tree's process in the scope counts there;
  - in the "outside" case, the scope's charge counts once and the owner
    counts beside it.
- With `measureFor` sabotaged to drop `tree` (the file copied back
  afterwards), the control fails: "its tree's process outside the cgroup is
  counted where it lives".

