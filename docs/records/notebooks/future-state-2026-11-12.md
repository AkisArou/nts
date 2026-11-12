# Future state replay, 2026-11-12

Task #725. The mixed-version writer erased step memory history after #720's
CPU-measure version change. The retained replay is
`~/.cache/nts-handover/codex-helper/cpu-accounting-2026-11-11-711/history-handoff/replay.json`.

The v4 view sized its measured step at 262,144,000 bytes. After old v3 code
published a job observation, the step map was empty and the same request was
sized at a 10,737,418,240-byte unmeasured machine share. The next v4 publication
could not recover a peak the old writer had deleted. No live history was edited
or reseeded during this change.

The replay control writes a v5 file through the v4 reader and both its step and
job publishers, checking that every byte survives. A supported v3 control keeps
its memory peak through v4 migration and still sizes admission from that peak.
Operational-state controls cover transitions and deletion as well as writes.
The [inventory](../future-state-2026-11-12.tsv) records each state family and the
exclusive-create or immutable-link owners already protected from replacement.

Ledger release takes the same directory flock as decisions. The held-lock
control uses an actual competing flock and a supplied nonblocking acquisition,
so its verdict does not depend on how long a machine takes. It verifies a named
report, unchanged bytes, then owner exit and reclamation by the next decision.

The guard protects the next format change, when this implementation becomes
the older reader. It cannot constrain older code already deployed; #740's
separate cases-v2/ namespace was still necessary for that mixed-version window.
