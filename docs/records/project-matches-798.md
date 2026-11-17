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

The follow-up source-fence controls passed all 51 tests in their four owners.
They check that a staged matching TypeScript addition is refused, a staged TSV
addition is allowed, and excluding a previously matched source changes the
native digest while retaining the same config request. The decoded key inputs
carry that request and digest together.

The final canonical fence run passed all 54 tests across the selector, material,
record and unchanged records-run owners. It refuses a source root replaced by a
symlink or file before or during assessment, and a deleted or renamed source
directory. It separately allows a staged TSV addition and a TSV content edit,
and refuses a staged matching TypeScript addition. The root remains bound by
device, inode and physical path throughout assessment.

Review found a separate deletion gap in the TypeScript step-selection route:
the post-change graph retained `projectMatches` but never consumed them. A
removed matched root had no remaining callback naming it. The graph now keeps
the native queries with their readers, contexts and steps, including runner
handovers. Direct working-tree questions replay at committed HEAD; range
endpoints receive the already prepared committed base. Only deleted paths that
account for removed native matches owe the reader. Raw entries remain
acquisition-only, and unrelated or excluded deletions add no reach.

The first amended fixed-config control commits a global declaration, removes it from
the current tree, and asks both deletion and rename-to-Markdown questions. Both
retain `profile` and its `addons` handover. Nonmatching deletion and rename
controls retain neither consumer. The same control fails specifically at
`deletedMatch retains profile` with the reviewed `977cb63af5` owner, and passes
with `d2b74ecb00831f7dadd63da0ae366290be8504e3`. Both counterfactual arms use
identical test bytes and modules from the latter archive; only `owed.mjs` is
replaced with the reviewed owner's exact bytes in the before arm.

The initial three-owner review run passed 138 of 139 tests, including the new
native and endpoint controls. The other fixture had no commit to supply its
base and stopped before assertions. Its setup now commits the starting state;
its unchanged assertions and the fixed-config control then both passed. Three
new missing JSDoc annotations in the selector glue were corrected, and strict
types again passed all 1,155 modules without a diagnostic increase. The owning
writer regenerated the projection after those source commits.

The final seven-owner review run then passed all 193 tests with no skips or
cancellations. It includes the deleted-match and rename controls, committed-base
endpoint transport, native exclusions, and the unchanged source-root and
records-run fence assertions.

The strengthened guard fixture also physically renames a matched `.ts` to a new
`.ts` name, removes an ignored TSV, and removes a directory containing a matched
file. Each guard runs as an independent subtest in both counterfactual arms, so
one old-owner failure cannot prevent the other assertions from running. The
rename checks each path's obligations separately, and all cases check both the
`profile` consumer and its `addons` handover.

| Guard | Reviewed owner | Fixed owner |
| --- | --- | --- |
| Delete a matched `.ts` | misses consumers | retains both consumers |
| Rename a matched `.ts` | misses the old path's obligation | retains both consumers under both names |
| Delete an ignored `.tsv` | no Program consumers | no Program consumers |
| Delete a directory holding a match | misses consumers | retains both consumers |

These arms use the same `be414720eb6221a150ccb3e6c22f31f6b53c8edd` archive and
identical tests; the before arm replaces only `owed.mjs` with the reviewed
`977cb63af5` bytes. Every guard executed with no skips. Strict types passed, and
the owning projection writer reported no change after these test-only edits.

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
| `nts-798-exclude-controls.log` | `3c8364dc22b1321de4db1f4e4b90e999dbd4664ea2a41ceb6bfc0cc2adf95b14` |
| `nts-798-root-controls.log` | `91890dc6ded0eb51ff8700a425dd50896cf5711fa2cd6204c2f6bac40e551f57` |
| `nts-798-inner2.log` | `7f17412678d6c63eee4b0c11ed7f09081db28ec62a560162125c6803934378cd` |
| `review-counterfactual.json` | `52c47f4a31305f57273d377c8433c50b2b35ba153191a4233f26dec00f62f944` |
| `review-counterfactual.py` | `45cc6e38efbf90d6aa4fd1eaf5e31cf778eee16c30507aeacaa3a7b3fda51b4c` |
| `review-before-owner.log` | `9602dd7bb5850f400e4404c0971b11df1538ba3dd820873d150836c9608a4997` |
| `review-after-owner.log` | `88e7025b8eb2c230ed3275d592de0e0ea4b272c279dd06de7781813dbdb11387` |
| `nts-798-review-focused.log` | `a61437191ad4f637bd5f31a6988a477abb932e1d3d4a1b9c5674e0a191014d33` |
| `nts-798-review-pair.log` | `7da42888f37025a43c7fa0787e7d4662c05a3fedbe313d8caf8543bf8362dfd5` |
| `nts-798-review-projection.log` | `6d84ea9222ef7897dc024f4a337cf7895a671dd04afa8c69eff3305e4c6bec3f` |
| `nts-798-review-final-focused.log` | `af93b80cda62d4c4369eb5a34d7bd0a3828ac98d084d56b6b05dac963539d4c6` |
| `guards-counterfactual.json` | `a161b1403bdcb1d441608f07f52deaa57b8574033fc18a14bc6775f3a85fbb77` |
| `guards-counterfactual.py` | `cc6c95896070ba9d6258c82c461a38be2e00bffbf938af4ab674ec55932720d2` |
| `guards-before-owner.log` | `e258274adedb36e8d602f49e9f59834334a5fd6427c3c4593da7a7ca381ae57e` |
| `guards-after-owner.log` | `d08095835961a1ad7e14dbd8587c29b17255e801bfd98db11985b3c7803f023a` |
| `nts-798-guards-proof.log` | `cb5f1fe49f31e424832bc0f6521664a0412f51c86a962d30a48bbf19500c010a` |

The paired experiment ran through `admit.ts` in `nts-798-selector-proof2`, with
`taskset -c 0-3,6-31`, `Nice=19` and `CPUWeight=20`. Source changes were
committed and checked with `git log -1` before either arm ran.
