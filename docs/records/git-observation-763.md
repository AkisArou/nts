# Git index observations

Issue #763, 2026-11-12. Git 2.56.0.

Two transient index.lock collisions in pool 6 prompted the investigation.
Their exact creator was not traced. The source path was present:
`Pool.trees()` ran status on every tree through a launcher environment, with
optional index refresh enabled whenever that launcher had not disabled it.

The initial parsed call/shell inventory found 230 sites in 110 modules:
179 calls, three probe command objects and 48 shell launches. Seventeen calls
used forwarding helpers. The simple command-position rule covered 227 sites
and all 17 forwarders; a command-property check covered the three probes.
Python's own AST found two argv declarations in the legacy Chromium tools.
No intermodule parameter-flow machinery was needed.

The complete syntactic inventory also includes argv vector declarations.
Its tool-written starting ceiling held 239 uncertified positions. The first
slice protects 77 positions in 34 production/shared-owner modules across the
landing, pool, full check, gate and census; the ceiling falls to 162.
Each row names its exact source expression and command-position kind.
Deleting an old expression never permits a different expression. The writer
checks the current ceiling under its owner lock and refuses increases or a
future format. Fixtures/tests and the other reader groups follow separately.

The canonical fixture ambient already sets GIT_OPTIONAL_LOCKS=0, which made
the first control unable to force a refresh. The corrected control explicitly
sets it to 1 in its child, changes a tracked file's stat with unchanged bytes,
and observes the pool through two private staged owners. The before owner
omits the flag and rewrites the index; the protected owner preserves every
index byte and its device, inode, mode, size, mtime and ctime. Atime is excluded
because the test's own byte reads may update it. Add and commit still work.

The audit uses the shared structural facts, selected generated JavaScript and
shell source, and shared shell argument words. The legacy Python files are
parsed together through Python's AST without importing or executing them.
Ordinary string data is not inspected as source.

Commands:

```sh
node --test tooling/gate/git-observations.test.ts tooling/gate/test-timing.test.ts
node tooling/gate/git-observations.ts --record
node tooling/gate/test-host-audit.ts
```

## Counted audit cost

The new rule has a small real cost. The first paired ABBA measured +3.6%
instructions and +4.5% cgroup CPU. A shared command-index prototype did not
produce a win beyond the arms' roughly 2% spread against the landed inspector,
and added caches and another owner API. It was discarded; the landed inspector
is retained. The prototype's lower figure against pre-Git is not claimed as a
proved saving in the kept implementation.

All arms inspect the same fixed source,
`a068e285cae7602cfe26804515e9c7a22ff8ab56`, using Node v26.13.0. Subjects run
on CPU 4 under `with-lock.sh --wait --key perf-count`; the controller stays off
CPUs 4–5. Instructions use `cpu_core/instructions/u`. CPU is hierarchical
cgroup CPU; peak uses the resettable cgroup meter. Each pair is ABBA in fresh
processes. Instructions, CPU and wall are means; peak is the larger reading.
The controller loads full findings only after every measured arm ends. An
earlier run that grew the controller between arms was discarded.

The pre-Git engine is `caf74c3bd0083170c12fce11022cf5b57af01333`. The first
Git engine is the submitted slice at
`a068e285cae7602cfe26804515e9c7a22ff8ab56`; the second comparison uses its
actual landed engine, `a206a10d8d9f7c7ba7d4df57ae7cac0242438ce6`. The discarded
index prototype is `2095df6737f58c55ae0829e04dabe139b7e582f3`.

New rule against pre-Git:

| Engine | Instructions | Cgroup CPU | Peak bytes | Wall | One-minute load beside wall |
| --- | ---: | ---: | ---: | ---: | --- |
| Pre-Git | 50,520,804,033.0 | 4.327153 s | 406,028,288 | 4.460082 s | 24.97, 28.25 |
| Git inspector | 52,346,049,460.0 | 4.520766 s | 406,769,664 | 4.555381 s | 26.9, 27.14 |
| New / old | 1.036129 | 1.044744 | 1.001826 | 1.021367 | |

Discarded index against pre-Git:

| Engine | Instructions | Cgroup CPU | Peak bytes | Wall | One-minute load beside wall |
| --- | ---: | ---: | ---: | ---: | --- |
| Pre-Git | 50,797,223,799.5 | 3.692705 s | 383,053,824 | 3.706224 s | 8.27, 7.99 |
| Command-index prototype | 51,793,413,236.0 | 3.759493 s | 365,170,688 | 3.773681 s | 8.27, 8.25 |
| New / old | 1.019611 | 1.018086 | 0.953314 | 1.018201 | |

Discarded index against the landed inspector:

| Engine | Instructions | Cgroup CPU | Peak bytes | Wall | One-minute load beside wall |
| --- | ---: | ---: | ---: | ---: | --- |
| Landed Git inspector | 52,353,074,564.0 | 3.791551 s | 377,655,296 | 3.805690 s | 7.99, 8.52 |
| Command-index prototype | 52,045,806,860.5 | 3.765883 s | 367,902,720 | 3.781829 s | 8.39, 8.39 |
| New / old | 0.994131 | 0.993230 | 0.974176 | 0.993730 | |

All common findings match exactly: 1,866 sources, 251 closures and 412 host
reads, including every closure member, publication and problem. Git findings
also match exactly between the landed inspector and prototype. The retained
JSON holds the raw arms and canonical inventory digests.

The initial CPU profile attributes 106.8 ms inclusive to the JavaScript Git
inspector, including repeated literal resolution, and 55.4 ms to the single
synchronous Python AST batch. In the prototype those costs move to
`stringCommands` (79.6 ms inclusive), the Git inspector (83.6 ms inclusive),
and the unchanged Python probe (60.3 ms). These inclusive figures overlap;
they are attribution, not an additive timing breakdown. The Python batch
remains synchronous: an asynchronous owner and audit API would add more
mechanism than this wait is worth.

Metrics, controllers and profiles are retained under
`~/.cache/nts-scratch/763/counted-audit/`. All five independent source/Git
copies were removed after the comparison. No shared Git configuration changed.

Evidence: [raw counted arms, summaries and equality digests](git-observation-763-cost.json),
[discarded prototype patch against its landed base](git-observation-763-index.patch).

## Other production owners

The second slice protects 91 command positions in 40 remaining owner modules,
including the shell routes and the two Python argv declarations. The
tool-written ceiling falls from 162 to 71; the remaining entries are in
39 test/fixture modules.

The new oracle-dependencies import exposed a project boundary: the Git leaf
was assigned to the aggregate gate project, whose rootDir excludes imported
differential and inputs modules. The outcomes-recording control failed with
TS6059. The leaf now lives at `tooling/gate/git-arguments/main.ts` with its own
one-file project, following command-entry's layout. The real outcomes
recorder passes, and a new control uses OracleFilesystem.projectFor and the
pinned parser to check that exactly the leaf is compiled without diagnostics.
The aggregate project and fixture options are unchanged.

The final placement census has 28,507 tracked paths, 149 unplaced paths and
33 full-policy paths, with no problems. The named owner/selection proof passes
125 tests; the leaf/outcomes/timing proof passes 18 tests. Host ownership checks
1,868 sources, 252 closures and 412 reads. Strict coverage checks 809 modules
with no new diagnostics.

## Fixtures and generated subjects

The final slice protects the remaining 71 positions in 39 test/fixture modules:
67 root positions and four generated JavaScript positions in the range and
legacy-oracle fixtures. The writer reports 239 protected sites and zero debt.
The record remains present and rejects a new unprotected source expression.

Universal argv protection initially defeated canonical-environment's positive
control for GIT_OPTIONAL_LOCKS=1. That test now disables only a private staged
copy of the argv leaf, so its two environment arms still prove the ambient
rule. The ordinary argv owner's index-protection control remains unchanged.
The corrected ambient/Git/timing proof passes 47 tests, followed by the host
and strict audits. Compiler-backed proof uses the supported
landing check's --here route, which builds the compiler and seals its environment.
