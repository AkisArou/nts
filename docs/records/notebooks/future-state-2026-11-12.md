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

A landing exposed another allowed fallback: a unit-wide SIGTERM can interrupt
the flock helper during acquisition. The parent already owns the open file
description, so a held lock survives the helper; only acquisition is exposed.
The deterministic control blocks the helper before acquisition, proves the
directory lock is free, signals the unit, and observes the named acquisition
failure. The entry remains with a dead owner and the next decision reclaims it.
The runner wiring control accepts this only with the named report and that
reclamation; an unexplained leftover still fails. It waits for output pipes to
close and includes the complete runner output in its failure diagnostic.

The guard protects the next format change, when this implementation becomes
the older reader. It cannot constrain older code already deployed; #740's
separate cases-v2/ namespace was still necessary for that mixed-version window.
