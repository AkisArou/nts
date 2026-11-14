# Written records and bounded decision tables — #786

Base `b0a4a3720303f3746080b9af00c905e5cd93fc7d`; frozen proof `1eae18f04e8a259b4f2a40b9518caa106ade3750`.
Raw evidence: `/home/akisarou/.cache/nts-scratch/786/raw-evidence-v1.json`; SHA-256 `768bf7c9e78ef849e0d5f84a16d81e74efd1ca65f9fabd46b7036be32a1db88e`.
The kept manifest authenticates 124 artifacts and 21 Git receipts.

The existing records audit permits Markdown and bounded decision tables. Raw
output stays in kept scratch, cited by path and SHA-256. Only --record publishes
the ratchet, refusing growth before durable publication. New tables, lower sizes
and removed rows must be retained in the same commit. All 53 legacy
non-Markdown size rows match base Git blobs. No production record was deleted.

| Actual staged CLI control | Result |
|---|---|
| New raw JSON, 16,385 bytes | Named refusal: file, bytes, extension bound and rule |
| New TSV, 16,385 bytes | Refused against 16,384-byte table bound |
| Large Markdown and a small table | Pass; table retained through --record |
| Legacy JSON growth | Check and --record refuse; ratchet bytes unchanged |
| Legacy lower size, then regrowth | Lower size must be recorded; regrowth refuses |
| Private legacy file disappears | Refuses; --record removes stale row, exact tree passes |

Canonical focused controls pass 191/191, with timing, host and strict green.
Full/unplaced/policy placement arrays equal the base. Supported `here-1eae18f04e8a-1794685040314` has
16 PASS summary rows, canonical environment, experiments [], cleanup and
diagnostics complete. Tooling: 2356 pass, zero failures/cancellations,
2 TODO; native: 3047 pass, zero failures, 8 ignored.
Actual inner is green: fmt 4 s, Clippy 1 s, build 1 s,
tests 458 s.

The initial focused 190/192 RED is retained: importing the CLI directly enrolled
its benchmark data as ordinary test input. Staging the real CLI repaired that
ownership boundary without changing production selection or the existing reach
assertions. Table relevance remains editorial; these controls prove formats,
byte limits, exact state and publication.
