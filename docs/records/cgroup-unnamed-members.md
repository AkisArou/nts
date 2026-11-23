# Unnamed cgroup members (#979)

Admission rejected a cgroup membership observation while #933's inner run
waited for its tests. The retained error names another run's tooling worker
scope. Its process snapshot was not captured, and that scope has departed;
the particular task behind the historical zero cannot be identified.

The card's original explanation, a process outside the reader's PID namespace,
was a hypothesis. The reproduction establishes that a namespace boundary is
unnecessary: ordinary children exiting in the reader's own PID namespace
produce transient zero entries.

## Observed

A bounded named unit ran a reader and four workers. Each worker repeatedly
called `fork`, `_exit` and `waitpid`; none called `unshare` or `setns`. The reader
and all four workers reported PID namespace `pid:[4026531836]`. The reader
sampled its unit's `cgroup.procs` while the workers exited children.

| Observation | Result |
| --- | ---: |
| Raw membership reads | 2,605,303 |
| Children forked and reaped | 188,708 |
| Zero entries observed | 2 |
| Worker exit statuses | All 0 |

Each zero disappeared on the immediate next read. Reading `/proc/1/ns/pid`
was denied, and no observation of that namespace is claimed. The reproduction
identifies the zero-producing population as these ordinary exiting children;
a zero does not retain the individual child's PID.

The raw log is
`/home/akisarou/.cache/nts-scratch/979/exit-race2.log`; its SHA-256 is
`a014aa1a58bd8bc07337e58b57941b96afd2dea141cc2e0849e5a53b79042336`.
The source is `/home/akisarou/.cache/nts-scratch/979/exit-race.py`; its SHA-256 is
`52d4aa489346707a8bd413f026b77087068f3d9c1f92e98a0a79b6042f1b55c7`.

The earlier `cause.log` contains only an admission wait; the first direct
attempt, `exit-race.log`, failed the `/proc/1/ns/pid` query before forking.
Neither is a reproduction result.

## Inferred mechanism

The kernel's
[`cgroup_procs_show`](https://github.com/torvalds/linux/blob/master/kernel/cgroup/cgroup.c)
prints `task_pid_vnr`. Its
[PID lookup](https://github.com/torvalds/linux/blob/master/kernel/pid.c)
can return zero when a PID identity is unavailable. An exiting task whose PID
has detached explains the same-namespace observation. This internal sequence
was not traced; the raw membership zero and its disappearance were observed.

The fix preserves a zero as an unnamed member. Population and cgroup memory
charge remain observable, while a complete PID projection is unavailable by
name. No zero is converted into a PID, signalled, or used to certify process
ownership. Regression admission and census fixtures supply complete owned
observations and their own ledgers through `ownMemory`.
