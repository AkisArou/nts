# Records

The evidence behind nts's decisions, and the notes the documentation was
distilled from. Unlike the pages outside this directory, a record keeps its
date, its history and the paths it was written with, and it may be as long as
it needs to be.

| what | where |
|---|---|
| **Decision records,** one decision each with its evidence | `NNNN-title.md`, numbered. Claim the next number with `tooling/gate/claim-record.sh "title"`, which creates the file atomically. |
| **The decisions log,** every user decision with its date and words | [`notebooks/decisions-log.md`](notebooks/decisions-log.md) |
| **Notebooks:** lane notebooks, conformance ledgers, the plan's history | [`notebooks/`](notebooks) |
| **Studies:** the research behind the foundations (memory, Unicode, builtins, JSON, the primitives, tsrs) | [`notebooks/studies/`](notebooks/studies) |
| **Ideas:** directions nobody has committed to | [`ideas/`](ideas) |

A page in `docs/` links a record where it helps a reader. A record is not
updated when the design moves on: a new record or a new log entry is written
instead.
