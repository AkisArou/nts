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

An alias probe found that native matching can return a logical name such as
`alias/gone.ts` while Git reports deletion of `physical/gone.ts`. The prior
attribution compared only logical names and lost `profile` and `addons`.
Committed identity resolution now reads a single Git tree and its symlink
blobs at the base revision, retaining logical, physical and intermediate alias
ownership names. It never resolves those identities through live links or
the host. Retargeting can retain the logical match list while replacing a
physical input, so unchanged logical aliases are checked too. Matching remains
entirely native; directory listings gain no selection authority.

| Alias-chain control | Owner without physical attribution | Fixed owner |
| --- | --- | --- |
| Delete a physical matched `.ts` | misses consumers | retains `profile`, `addons` |
| Rename a physical matched `.ts` | misses the old path | retains both consumers under both paths |
| Delete a physical ignored `.tsv` | no Program consumers | no Program consumers |
| Delete a physical matched directory | misses consumers | retains both consumers |

Both counterfactual arms use the same complete
`adbc4a3896141f0930cb3ab166d0c433756f096d` archive and identical tests. Only
`project-discovery.ts` is replaced with its `3a7fe97e21` bytes in the old arm.
All four outcomes execute independently. Thirteen Git/native controls and nine
real-selector assertions pass, including chain and parent-relative targets,
staged link independence, distinct base/tip revisions, alias addition and
retargeting with deletion, and named outside/cycle refusal. One owner reads
each Git tree and shared link blob once. Strict types pass all 1,170 modules;
the host audit passes, and the owning tool regenerates the projection.

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
These measurements predate the later alias-identity attribution; they compare
the pinned revisions above and make no additional timing claim for that change.

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
| `alias-counterfactual.py` | `9a370a9b00964e597b8a3fc199ccdcc2daf46ab1f88ed640019c78c06eeeb4d6` |
| `alias-counterfactual.json` | `5c46ede35b608a703e14efc4d9f649610464487b5a7302e62ce8ce323961516b` |
| `alias-before-owner.log` | `17775d5dcec0f3cdda9fac504646982cec129d7d3d4d7eea27753108a818ca1a` |
| `alias-after-owner.log` | `f791d61ae06091ba11a8be0fda64d42a364bbabf32550736bc7368853d59f5ed` |
| `nts-798-alias-target.log` | `dd2cadda651f945e72b65aab877af016cafb05d511847309ac7796caf5902cdd` |
| `nts-798-alias-prepare.log` | `7ac60bfce8709ee5099e73009ce4f996422726d1d52d5b3c1b617a0ea66eb3d4` |

The paired experiment ran through `admit.ts` in `nts-798-selector-proof2`, with
`taskset -c 0-3,6-31`, `Nice=19` and `CPUWeight=20`. Source changes were
committed and checked with `git log -1` before either arm ran.

## Census adapter integration

After rebasing onto `ae4898abff477e6ddc33ca5af86a66f032c5ce88`, the census
adapter imports its request type from the discovery owner, carries detached
native matches with the reader context, and supplies the source root to batch
validation. A mismatched captured native file list is refused by the pinned
parser. The census and pending owners passed all 22 assertions, with none
skipped. Strict checking covered six projects and 1173 modules; the host audit
checked 2104 sources, 340 entry closures and 420 reads. The selector projection
was regenerated with `rust-selector-write.ts --write`.

Literal `memory-census.ts --check` runs on main and adapter commit
`4d6445e1b20b9b0f38231d2837a8e8ec2ddcc6a4` produced identical pending lists
and no refresh requests. The current memory group contains 15 programs, so the
comparison covers all 15: array-copying-methods, awfy-towers, cyclic-churn,
event-state, immutable-update, json-build-append, json-stringify-doc,
map-entries-top-k, module-loop-retained, objects, pipeline, record-word-counts,
release-acyclic, sort-objects and tree-teardown. Every source and producer
identity is unchanged, as are both schema versions; no census record changed.
The recipe identity changes from
`5665bf7674da1a07e96f4a501ad3d53320443665310300136f5b067884c0f58b` to
`ca36beaf6f9f960b2bed13e81c193c95d34c3ff84a8e503dfe9f0f5f9e7cd60b`:
`CENSUS_RECIPE_INPUTS` explicitly hashes the edited adapter file's entire
contents. This conservatively requests fresh observations for changed recipe
bytes; all rows are already pending on main. The coordinator accepted this
expected identity change. An initial scratch guard asserted the obsolete six
program count; the completed guard compares the full canonical group.

Raw files under `~/.cache/nts-scratch/798/`:

| File | SHA-256 |
| --- | --- |
| `census-guard.json` | `9f920f1c8168e1e24058df17bada39d51d3a45acb2c747ffec609c144b405ffb` |
| `census-main-check.log` | `e39dfb9cb9180b7191c94de610444aefa51a60fa3ae754bbe9f19b78dd435340` |
| `census-tip-check.log` | `e39dfb9cb9180b7191c94de610444aefa51a60fa3ae754bbe9f19b78dd435340` |
| `nts-798-census-prepare2.log` | `44ac4af9bd62ad4d446945eb62a39894a3aa41fcaa134c00d859a7589aa73e75` |

## Compiled-owner retention control

The production file boundary introduced a decisive memory control: each of
four unrelated selector readers ran singly on main
`ae4898abff477e6ddc33ca5af86a66f032c5ce88` and on
`14969f2f3fe9ce7dec4d8a101b142f78a6b6740b`. Both used the canonical environment,
`runScopedTooling`, a 6144000000-byte scope and the same 2248146944-byte V8 heap
limit. Each ran through `admit.ts` with the stable `tooling-focused` key, under a
named unit excluding CPUs 4–5. Peak heap combines synchronous V8 GC object sizes,
100 ms samples and exit statistics; GNU time records maximum RSS.

| Owner | Main | Main peak heap MiB | Tip | Tip peak heap MiB |
| --- | --- | ---: | --- | ---: |
| owed.test.mjs | pass | 1977.09 | heap OOM | 2040.55 |
| oracle-record-owed.test.ts | pass | 1967.54 | heap OOM | 2036.66 |
| precise-changes.test.ts | pass | 1967.45 | heap OOM | 2039.22 |
| tooling/jvm/member-name.test.ts | pass | 1961.33 | heap OOM | 2035.37 |

The uncapped calibration is excluded: it let main's owed test pass with
2632300 KiB RSS but did not reproduce production's boundary. A first near-limit
snapshot exceeded that boundary during dump construction and produced no data.
The coordinator authorized a diagnostic-only 12 GiB reservation, with old space
pinned to 2048 MiB and the original heap limit verified before and after capture.

The paired dumps stop at the same first Rust-input batch, first package.json
fact and 57 snapshots. Main retains 1438046 observation rows; the tip retains
1877255, adding 439209. Strong-root retained size grows from 1856596467 to
2090778016 bytes: 223.33 MiB, larger than the OOM-censored peak difference.
Retainer paths run through `describeBatch` results, each snapshot's observations,
and reader contexts, answers and causes. Constructor shallow deltas include
126.86 MiB of Objects and 90.66 MiB of strings. A streaming analyzer computes
strong-edge dominators and passes a diamond/shared-child control. Its retained
constructor totals overlap and are not additive.

The added facts come from normalizing the compiled nearest-config walk separately
from its Program. Commit `3e0830fab2b2fe4703195c8f78dfdb3fa31d70aa` puts both
sets through one capture transaction, retaining every probe while merging equal
answers, refusing conflicts and unioning causes. Each completed owner-lookup
provenance descriptor is shared only inside its own detached project. The
unavailable-package refusal remains intact; the batch validator is unchanged.
This does not coalesce the pre-existing batch or change production limits.

The new union control compares the actual compiled snapshot with both old
captures: every answer and cause is retained, ordinary authority is preserved,
and conflicting answers refuse. Replacing only module-closure.ts with the old
14969 bytes makes this control fail. The distinct-Program-owner control passes
in both arms. Identical new test bytes run in both. All 20 Program-input tests
and strict checking of six projects/1173 modules pass; the host audit checks
2104 sources, 340 entry closures and 420 reads. The installation receipt and
selector projection are refreshed through their owning tools.

The baseline belongs to #857: the first owed question takes the stale-record
live-projection route through `buildRustSelectorMaterial`,
`rustRuntimeInputGraph.describeAll` and `moduleGraph.describeBatch`. Holding 57
full detached snapshots and their 1.438 million raw facts produces the large
shared baseline; this is not work done merely by importing the module. Its
baseline representation is unchanged here. Both diagnostic dumps and the empty
failed dump were deleted after the constructor/retainer summary was extracted,
as the coordinator requested.

Additional raw evidence under `~/.cache/nts-scratch/798/`:

| File | SHA-256 |
| --- | --- |
| `heap-production-table.json` | `cc75f548450e1ab19265aec0ca6f02954a16154a02755969340a5dc92df518bf` |
| `heap-pair/retention-summary.json` | `95e9ee4e6dc173fbd8ee5f6af5a206b774debfae36a901de480b7377414ae83d` |
| `merge-counterfactual.json` | `bc361951173ab10d4b9e288c1a0b9386177fb0135eedd5b31d7c226bc9d03e37` |
| `merge-before-owner.log` | `9485d0a1a284f2772604df872089e20f51d1c67a0841e47e99e51dde3ab5c389` |
| `merge-after-owner.log` | `30a766ab3884148ee2615e871f1856cd96990a63c562d436965fe84d0524b910` |
| `nts-798-merged-target.log` | `71c38e7bf914d0e08eb17d3c61c0b8fb273e25b03d2172e5795ff2239f6f6a8d` |
| `nts-798-merged-prepare.log` | `223444459952b64c8cf68d65c81342403b713fcaf6255a968438889286664479` |

## Reader-context capture boundary

The first paired repeat at `b476fd27c5ae890780c0c838d03fa06556ce7eae`
showed that joining one Program's captures was insufficient. Main's owed test
passed with a 2000.59 MiB peak heap and 2496832 KiB RSS; the tip still reached
2035.79 MiB and 2522784 KiB RSS before heap OOM. Both limits remained 2144 MiB.
The coordinator stopped the remaining batch after that decisive result; the
third arm was interrupted, and the remaining five were not run.

Paired diagnostic captures stopped at the same first 57-snapshot boundary,
before validation or any assertion. They classify 1438046 rows on main and
1673791 on that tip. These early exits are not passing test results. Comparing
snapshot, reader, context, protocol, kind and path finds 235745 added rows and
no removed rows. Of these, 176404 are additional repeated copies within the
same owner, and 59341 are distinct owner facts.

| Kind | Additional repeated copies | Distinct owner facts |
| --- | ---: | ---: |
| realpath | 107394 | 39447 |
| fileExists | 30555 | 10051 |
| runtimeKind | 29463 | 8548 |
| file | 8804 | 907 |
| selector-only file | 94 | 194 |
| selector-only runtimeKind | 94 | 194 |

The causes identify actual emitter operations: 146841 added realpath rows,
40606 config-existence probes, 28061 kind facts caused only by those probes,
9705 tsconfig byte reads, and shared config/entries/identity causes. The largest
reader is `compiler/frontend-ts/src/capture/tests.rs`, with 211438 added rows.
For example, one source realpath has 16 copies under the same owner in the first
snapshot. Main already has 912170 repeated owner rows, compared with 1088574 on
the intermediate tip. A raw-fact-only merge would also leave typed copies: the
first snapshot alone has 8642 repeated SDK facts.

The coordinator approved the complete reader/context boundary, including the
beneficial removal of existing copies. One capture now normalizes all that
owner's Programs in a snapshot; all native callbacks and nearest-config probes
still run. Typed SDK, dependency and pin answers coalesce only with identical
authority descriptors, shared once after detachment. Different authority or
Program provenance stays separate. The batch validator checks each distinct
authority even if another authority supplied the same answer. No persisted
schema changes. The separate retention of 57 snapshots remains with #857.

All 23 Program-input controls and strict checking of six projects/1173 modules
pass. The union control now covers two Programs; other controls retain distinct
readers, every native request, promotion in both orders and conflict refusal.
Equal-answer SDK facts with different descriptors stay separate: the authentic
descriptor passes, and the forged descriptor refuses in both source and batch
validation. Equal descriptors share one detached object. An initial separate-
reader fixture named one identical project request, which existing traversal
visits once; it was corrected to two configs reaching the same source. The
earlier queued target was stopped before editing to complete typed collection;
the successful target ran after those source edits.

Additional raw evidence under `~/.cache/nts-scratch/798/`:

| File | SHA-256 |
| --- | --- |
| `heap-fixed-first-pair.json` | `ef34e791dc14ee8f73b30ec4ff6f9a70ca37714dc6f57a926f1f2af4103ae152` |
| `fact-classification/classification.json` | `e8b6d0073dae2b09c9063021f527f0cb5c7e13e39475573aa2c6677dc82f6057` |
| `fact-classification/duplicates.json` | `61e7136abdab7ae839b0a8356fa413cc1a332658ed90024d546108939e06d230` |
| `nts-798-snapshot-target3.log` | `31241da34a592ea8b502b572cbd67b6e483a2f2c5cf294ea599f2a58e8da0aea` |
