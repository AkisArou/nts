# Exiting-process links and readable ownership status — #787

Base `47d4d9a52589dc6d92d247fb34e849e62de60ff7`; frozen proof `46ef25b1ce30a73802b7a970a54be7615f06bc45`. The pre-rebase focused and observer
comparison pin `a8dbd49458b3d1976606cce43b66c160674b2db1` has byte-identical implementation and control sources
after the keeper-only rebase; the manifest authenticates that equality.
Raw evidence: `/home/akisarou/.cache/nts-scratch/787/raw-evidence-v2.json`; SHA-256 `9082e04d73f826c1bf229e69549a6863ec8ce43e3ec6e5de8232322cebba51a2`.
The kept manifest authenticates 203 artifacts and 48 Git receipts, including absent source files.

The shared process observer treats only ENOENT on cwd, executable or descriptor
links as absence and continues looking for other owners. Other failures keep the
existing provenance refusal. Read-only status names a failed observation on its
tree; reset, prune, reclamation and cold-build preparation retain strict ownership.
The import-safe status model preserves version 1; CLI entry, signals and timestamp
acquisition stay in the command owner.

| Control | Corrected observer | Exact previous observer |
|---|---|---|
| Missing cwd link | No owner at that link; other owners remain visible | Named ENOENT failure |
| Missing executable link | No owner at that link; descriptor owner still visible | Named ENOENT failure |
| Cold-build ownership guard | Missing links pass; unreadable/live owner refuses | Named ENOENT failure |
| Pool and landing status | Error named per tree, return 0; strict decisions still refuse | — |

Sealed focused controls pass 145/145, with timing, host and strict green.
Previous/current replay authenticates exact Git observer bytes: corrected 3 PASS,
previous 3 FAIL. The complete placement arrays equal their recorded baseline.
Supported `here-46ef25b1ce30-1794681938028` has 11 PASS summary rows, canonical environment,
experiments [], cleanup and diagnostics complete; tooling 2356/0/2 TODO,
native 3047/0/8 ignored. Actual inner is green: fmt 3 s,
Clippy 1 s, build 1 s, tests 372 s.

The initial 144/145 audit RED is retained separately: the control imported a CLI
with top-level await. Extraction repaired the owner boundary without an audit
allowance. The first supported chain was interrupted by the reported power cut:
only its preflight completed, the supported run has no terminal summary, and inner
was unrun. A short-pin replacement launcher refused before proof and is excluded;
`nts-agent-787-here-inner-v3.service` ran the accepted full-pin replacement.
Supplied proc facts prove the missing-link decisions; they do not
claim reproduction of the historical process-exit race or a performance result.
