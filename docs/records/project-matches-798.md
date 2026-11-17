# Compiler-matched Program directory selection

Issue #798 compares the real selector with pinned module bytes in one private
repository, `~/.cache/nts-scratch/798/paired-fixture`. The before revision is
`8b26e53ad017b2539b8492005829a27214123678`; the after revision is
`46b4d5ca09fba079c711de9eb9acbf9f01fa45b5`. Both arms use the same installed
TypeScript and the same fixture bytes. Each invokes production `owed()` from
its pinned module archive. Neither arm uses full fallback.

The fixture's `tooling-types` and `tooling` readers declare the same type-check
Program. A separate audit reader owns the TSV's exact bytes. The table lists
the two Program consumers, excluding unconditional policy and the audit reader.

| Change | Before: consumers owed through the Program | After: consumers owed through the Program |
| --- | --- | --- |
| Add `tooling/sources/notes.tsv` | `tooling-types`, `tooling` | none |
| Add `tooling/sources/added.ts` | `tooling-types`, `tooling` | `tooling-types`, `tooling` |
| Change the config's include from `sources/main.ts` to `sources/**/*.ts` | `tooling-types`, `tooling` | `tooling-types`, `tooling` |

The aggregate TSV checklist loses `tooling` and retains its audit reader.
`tooling-types` remains in the aggregate checklist because the before and after
policy runs it for every ordinary change. This experiment does not change that
policy. The first attempt incorrectly asserted its removal from the aggregate
list; the corrected assertions check the actual Program-derived rules and
retain the complete aggregate rows beside them.

The refreshed canonical focused run passed all 266 tests across the eight
selected owners, including matching, Program capture, compact records,
include-change selection, ordinary-reader promotion, unavailable installed
packages, and the source and records-run fences. An earlier run's three
records-run failures stopped at a stale installation catalog before assertions;
the production linker refreshed it before the successful run. The source fence
compares native matches at fresh committed and working sources, retaining exact
bytes, aliases, typed metadata, memberships, Cargo names and the run's own-write
ledger independently.

After rebasing onto main's plan-only successor, `inner.ts --no-agree` passed
formatting, Clippy, the fresh compiler build and backend tests. The measured
after revision remains reachable at its `refs/cited/` ref.

Raw output and scripts stay in `~/.cache/nts-scratch/798/`:

| File | SHA-256 |
| --- | --- |
| `selector-rows.json` | `a85aaf63d62e405e5e1a46cd2a09362be3c92a045cf72e7ec8df473314af1b40` |
| `nts-798-selector-proof2.log` | `63ec5c39b5f22bcdc6c055b978236bd34bb8d4213b8409e21d20db7ad6765a43` |
| `selector-row.mjs` | `2eec5b27444f022291e713dd40b5f52b9b25207cdf9a29a002d5a0cf02d8f87e` |
| `selector-proof.py` | `8a4618c16e3532cde6d9d480b1933e210de8a15264281c89bc0af2603a12180e` |
| `before.tar` | `d6358a784bc45f300c650b20f510d2d68d0c0ea53fe8746f446f26840e0297f1` |
| `after.tar` | `0601b70b666da382583d8f04602c24fa8a09c235ad77db387fc2aa10dfeef48e` |
| `focused2.log` | `47f1aef75cbc7eafcc0e37537234dcdedc60b2c46907a61ebf10a3ab5f8b4b3f` |
| `nts-798-focused3.log` | `8a0f280d459966ac03e4836dcf96debca689d596c451a34508604687e2776d57` |
| `nts-798-inner.log` | `e1a4fd9c5a99614c99f04e0a5f3f1767c515ac6835fde1802508da2ab0b176f3` |

The paired experiment ran through `admit.ts` in `nts-798-selector-proof2`, with
`taskset -c 0-3,6-31`, `Nice=19` and `CPUWeight=20`. Source changes were
committed and checked with `git log -1` before either arm ran.
