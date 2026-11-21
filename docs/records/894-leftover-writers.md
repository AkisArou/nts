# Leftover writers in the hourly count (#894)

The hourly count was red on four tool-caused lines. Each line's cause and its
fix:

| Line | Cause | Fix |
|---|---|---|
| `~/.cache/nts-owed-range`: range folders left by `owed-range.ts` | The selector removed its folder only in `finally`; a terminating signal ended the process first, and SIGKILL or a power cut never reaches `finally` | The command owner holds the signal until `finally` has run; folders are named by their owner's boot/PID/start identity, and the next selector collects a dead owner's folder and its recorded receipts |
| `~/.cache/nts/node-compile-cache`: stale writer | The row named `canonical-environment.ts`; `host-environment.ts` (`nodeCompileCacheRoot`) names the folder now | The row names `host-environment.ts` |
| `~/.cache/nts/benchmark-records`: no row | `build-records.ts` and `compile-record-family.ts` make their scratch there when `TMPDIR` is unset | A `scratch` row for `build-records.ts` |
| `~/.cache/nts-875`: no rule | #875's worker wrote its hand-run logs under `nts-<N>`, not `nts-scratch/<N>` | Briefs now name `~/.cache/nts-scratch/<N>/`; the folder stays for the owner |

The sweep for aged scratch had also never removed most leftovers. Its
`settled()` walk followed symbolic links, so a leftover's links to the shared
test262 corpus or to the package store looked freshly written every day. The
walk now stops at a link, as the removal walk already does. The count's run
over these folders fell from 49 s of CPU to about 9 s.

## What the next sweep removes

Before landing, a read-only count used the fixed walk to list what it would
remove. Besides the kinds the sweep already removes every hour
(`nts/worker-memory`, `nts-inner` logs), it adds 27 folders, all in scratch
roots and all past their roots' age:

```
~/.cache/nts/tests/canonical-environment-run-2Pkbaz
~/.cache/nts/tests/canonical-environment-run-Flbu8u
~/.cache/nts/tests/canonical-environment-run-RrC9DH
~/.cache/nts/tests/canonical-environment-run-so4xda
~/.cache/nts-owed-range/range-2LExTH
~/.cache/nts-owed-range/range-4sL7Dj
~/.cache/nts-owed-range/range-66A2nh
~/.cache/nts-owed-range/range-6949Yy
~/.cache/nts-owed-range/range-BIrwU2
~/.cache/nts-owed-range/range-DuKduh
~/.cache/nts-owed-range/range-EBBqtO
~/.cache/nts-owed-range/range-FXW5fq
~/.cache/nts-owed-range/range-GkJOJr
~/.cache/nts-owed-range/range-IN1NG5
~/.cache/nts-owed-range/range-JD1cC2
~/.cache/nts-owed-range/range-NGqlkk
~/.cache/nts-owed-range/range-TRnAyI
~/.cache/nts-owed-range/range-WStLAc
~/.cache/nts-owed-range/range-aIuZlH
~/.cache/nts-owed-range/range-gvoymC
~/.cache/nts-owed-range/range-lH9bRd
~/.cache/nts-owed-range/range-lOB6nf
~/.cache/nts-owed-range/range-lVcNwF
~/.cache/nts-owed-range/range-nuJe2b
~/.cache/nts-owed-range/range-p5JnVn
~/.cache/nts-owed-range/range-rXIrME
~/.cache/nts-owed-range/range-zkD3Fe
```

For each of the 27:

- No process had its working directory, root, executable or an open file
  inside it, and none named it in its command line.
- No loaded user unit named it in `WorkingDirectory`, `RootDirectory`,
  `ExecStartPre` or `ExecStart`.
- No owner recorded in an `owner.json` (22 of the 23 range folders have one)
  was alive.
- Neither main's `docs/` nor any open issue that mentions `nts-owed-range`
  (#694, #855, #857, #864, #894) names it.

These are the aged-scratch kind the owner approved for the sweep. Legacy
`range-XXXXXX` names never match the selector's dead-owner rule. Only the sweep
removes them.

Raw count output: `~/.cache/nts-scratch/894/removable-fixed.json`, SHA-256
`f1497b9a3d058663ef074848d09509f92f473695251002b5974502af1ed05438`.
The guard list is `~/.cache/nts-scratch/894/guard-targets.txt`, SHA-256
`7140ab1d933316c7fa315940f1deed6bb3f1f7844e64a22c690dbc21c467c752`.

#928 owns the exit status after a held signal. A signal that arrives in a
command's last synchronous phase is dispatched only if the loop polls again,
so such a run exits nonzero from its killed operation rather than 143.
