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

The next review identified the committed CLI forms as a third deletion route.
Their changes already carry a base other than HEAD, but native replay still
defaulted to HEAD. A shared non-range base now drives both `changedPaths` and
CLI replay: the parent for `--commit`, the named revision for `--since`, and
HEAD for working questions. Deleted-path questions prepare that resolved base
through the existing committed-source owner and forward it with the CLI's
accepted selector trust. Questions without deletions acquire no extra source.
Range endpoint selection is unchanged.

The CLI fixture commits its deletion and remains clean, then invokes each
actual command. Its private loader isolates only the unrelated full-catalogue
self-test in the three-step fixture; argument handling, Git path discovery,
native queries and printed obligations all run production code. Every outcome
is a separate subtest, with no skips.

| Committed deletion | Command | Reviewed `eb7c5b95ef` | Fixed `04e533eee1` |
| --- | --- | --- | --- |
| Matched `.ts` | `--commit HEAD` | misses consumers | retains `profile`, `addons` |
| Matched `.ts` | `--since HEAD~1` | misses consumers | retains `profile`, `addons` |
| Ignored `.tsv` | `--commit HEAD` | no Program consumers | no Program consumers |
| Ignored `.tsv` | `--since HEAD~1` | no Program consumers | no Program consumers |

Both arms use the fixed archive and identical test bytes, replacing only
`owed.mjs` with the reviewed bytes in the before arm. The initial targeted run
stopped before selection assertions because the new options omitted accepted
trust; forwarding the existing trust corrected that wiring. The unchanged
controls then passed. Strict types passed all six projects and 1,155 modules;
the host audit passed; the owning projection writer completed without a diff.

After rebasing onto main's plan-only successor, `inner.ts --no-agree` passed
formatting, Clippy, the fresh compiler build and backend tests. The measured
after revision remains reachable at its `refs/cited/` ref.

The later rebase onto `531d75a7e43c35907f596e090ed31067ceed835c`
preserves the pooled `acceptedSourceSelfTest()` export and the CLI's call to
it. One shared `acceptedSourceTrust()` supplies both that preflight and the
deleted-path branch; main retains no separate copy of the accepted binding.
The owning writer refreshed the derived selector record after this integration.
Strict types passed all six projects and 1,168 modules, and the host audit
passed 2,097 sources, 338 entry closures and 420 reads.

The committed CLI counterfactual was repeated with the rebased
`b9e0c480ac530392d96c191921e949625be5bd0c` archive. The reviewed `eb7` owner
again fails both matched deletions and passes both ignored deletions; the
rebased owner passes all four, with identical test bytes and no skips. An
initial scratch-only attempt stopped before assertions because its older
tooling-only archive omitted the root toolchain input now consumed by the
canonical Cargo owner. The successful comparison archives the complete pinned
commit, with no separate dependency list or production relaxation. Both
attempts' raw output is retained separately.

The selection-cost comparison uses private Git fixture clones at main
`39f4978a723067b4f99b6639aa8967551a4827bc`, reviewed
`977cb63af5791ce18b5285a626083c66d5f2e61b`, and fixed
`8fc50d67abf1e45ba8916b97b4f571c3eabdf505`. Each arm owns its endpoint code;
pinning only the launcher would not compare the selectors. The tooling probe
deletes `tooling/windows/vm.md`; the compiler probe edits
`compiler/core/src/lib.rs`. Each probe changes exactly one path, with identical
input bytes across the three arms. Installation catalogs are refreshed before
measurement, and every invocation uses the same scheduling-cost snapshot and
canonical environment.

For each probe the order is main, reviewed, main, fixed, main. Main's values
below are medians of its three samples; the other arms have one sample each.
Every real `check.ts <probe> --dry-run` completed successfully. The
`perf-count` owner admits memory and the CPU lock together, then runs `perf
stat` on CPU 4. GNU time inside that payload measures wall and user-plus-system
CPU seconds, excluding the outer admission and CPU-lock waits. The production
instruction-count parser validates the pinned PMU's counters. Orchestration
stays off CPUs 4–5.

| Probe | Selector | Instructions (trillion) | Wall seconds | CPU seconds | Instructions vs main | Wall vs main | CPU vs main |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tooling deletion | main | 3.170744 | 281.68 | 266.93 | baseline | baseline | baseline |
| Tooling deletion | reviewed | 1.077894 | 105.43 | 97.84 | −66.01% | −62.57% | −63.35% |
| Tooling deletion | fixed | 1.068212 | 102.79 | 101.20 | −66.31% | −63.51% | −62.09% |
| Compiler edit | main | 3.169843 | 291.94 | 282.51 | baseline | baseline | baseline |
| Compiler edit | reviewed | 2.337143 | 226.64 | 220.07 | −26.27% | −22.37% | −22.10% |
| Compiler edit | fixed | 2.337170 | 224.81 | 212.58 | −26.27% | −22.99% | −24.75% |

Neither probe increases any measured quantity against main. The deletion
repair's compiler instruction count differs from the reviewed owner by
+0.0011%; its tooling instruction count falls by 0.90%. These are selection
costs for the two probes, not gate execution times. Earlier partial two-arm
timings and fixture setup failures are excluded from this comparison.

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
| `selection-three-setup.py` | `da6df6b68ae3c2b0f697ec8b41491eda16e69dfe2263650e057f6128637acc56` |
| `selection-three-count.py` | `71b2b2041a2a3de82f7115a4b4499eea0cb401b3e204722934663ef26b606b7a` |
| `selection-three-e4yjvv6w/manifest.json` | `1ea08190e1705cf4254fa34f5ecbe4f757b4b46fe2d0439f952b38bf36165661` |
| `selection-three-e4yjvv6w/count-results.json` | `8ce743d3cc32080c9ab7b7cc2fd91783c016d4ae4a5b0087c2454e279d9ae1e5` |
| `nts-798-three-count.log` | `7a0bd6e1382247622827cb44d9ced14a7e71e1d643ddc5d180bcb87a01ced971` |
| `cli-counterfactual.py` | `573e767159e496bc8d6a586799ccdf3076bca474ca597b7a8fe82526d70def0e` |
| `cli-counterfactual.json` | `9990990ac5c7c7c933ae0a56f14334e92203a154cf6e95f29fe53c5f44d66105` |
| `cli-before-owner.log` | `4ccefc0ecf5fd271032199847e327d99cb9270151aa2a25b672085857a04052a` |
| `cli-after-owner.log` | `87ad1e07dcfb6ecdbeb952373e95301c9d574f1605d2bc9f8de01e68b7c2e6e6` |
| `nts-798-cli-proof.log` | `d2728c3ef99245b4ee72008f26a56f7a77ea80ec61b0e5d7b9cb1e4679e0a8b9` |
| `rebase2-cli-counterfactual.py` | `6c8d1bf7b57fd26dd815e1788e908c241579b9c11e1c4cc06d91c29177dd7eed` |
| `rebase2-cli-counterfactual.json` | `c7ff263393d219855a2fe1f8d58564e97c5ce3838f8a4b02ada6d73488a48724` |
| `rebase2-cli-before-owner.log` | `c6bd91acf14f72c94104c9babbba3842e1053f75db466a69db38030f1f860430` |
| `rebase2-cli-after-owner.log` | `1de80dd11ca235acf75fe075b31831abe82611bf74d4cfd1c417ef33a7e6cef6` |
| `nts-798-rebase-prepare2.log` | `7239393fc1f86e54f8c908d182f4fb15063b54ed29398b6b14d3d3f82033a3a0` |

The paired experiment ran through `admit.ts` in `nts-798-selector-proof2`, with
`taskset -c 0-3,6-31`, `Nice=19` and `CPUWeight=20`. Source changes were
committed and checked with `git log -1` before either arm ran.
