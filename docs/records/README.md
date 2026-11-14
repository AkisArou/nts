# Records

The evidence behind nts's decisions, and the notes the documentation was
distilled from. Unlike the pages outside this directory, a record keeps its
date, its history and the paths it was written with, and it may be as long as
it needs to be.

Committed records are written Markdown plus the table that decided the question.
Raw machine output stays in a kept scratch folder, cited by path and SHA-256.
Standalone `.tsv` and `.csv` decision tables are limited to 16 KiB. Existing
non-Markdown files remain under a size ratchet and may only shrink; removing an
existing record requires the user's approval. The `records` gate step checks the
rule. Its `--record` route is the only writer of `results/record-sizes.json`.

| what | where |
|---|---|
| **Decision records,** one decision each with its evidence | `NNNN-title.md`, numbered. Claim the next number with `tooling/gate/claim-record.sh "title"`, which creates the file atomically. |
| **The decisions log,** every user decision with its date and words | [`notebooks/decisions-log.md`](notebooks/decisions-log.md) |
| **Notebooks:** notebooks by area, conformance ledgers, the plan's history | [`notebooks/`](notebooks) |
| **Studies:** the research behind the foundations (memory, Unicode, builtins, JSON, the primitives, tsrs) | [`notebooks/studies/`](notebooks/studies) |
| **Ideas:** directions nobody has committed to | [`ideas/`](ideas) |

A page in `docs/` links a record where it helps a reader. A record is not
updated when the design moves on: a new record or a new log entry is written
instead.

## Decisions

- **Commit written evidence and its decision table.** Raw machine output stays
  in kept scratch and the record cites its path and SHA-256. The records step
  bounds standalone tables and ratchets legacy non-Markdown sizes
  ([log](notebooks/decisions-log.md#committed-records-are-written-evidence-11-14)).
