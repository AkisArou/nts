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
