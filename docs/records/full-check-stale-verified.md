# Full-check stale-verified recovery bound (#929)

Measured on 2026-11-21 from the retained ordinary core runs, excluding culprit
probes. The controller takes the existing `culprit-search` rank when its
candidate strictly descends from `verified` and the oldest first-parent
outstanding commit has been unverified on main for more than two hours
since its landing. `queue.ts`'s `landedTimes()` supplies the landing result's
`at`, through `Effects`. A missing record or invalid landing time is named
and retains full-check rank. The choice is made immediately before launch
and ends with the run.

The frozen cohort has 26 ordinary cores with completed summary wall fields,
15 of them green. Their green gate walls are 1,029.375–6,514.157 seconds,
median 1,999.644. Two hours is just above the slowest measured green gate
cycle, allowing ordinary work a cycle before backlog recovery takes priority.
Preparation is outside that summary wall: launch-to-summary completion for
these same green runs is 1,174–7,565 seconds, median 2,623; one of 15 exceeds
two hours. The bound is a recovery policy, not a run deadline or a promise
that every controller cycle finishes within it. Admission, setup and other
controller work can make verification take longer.

Replay uses the most recent completed ordinary green core before each
launch as `verified`, and the oldest first-parent commit after it. The first
three measured launches have no earlier retained green, leaving 23 decisions.
Each oldest commit has a landing record in the captured queue results.
The corrected two-hour rule promotes **9/23 launches (39.1%)**: four green,
four red, one held. Fourteen retain full-check rank. This is a backlogged
cohort with searches and retries, not a steady-state frequency estimate.
The launch of `8f810b3da39c` in the motivating incident is included and
would promote. A single outstanding commit can qualify after two hours
unverified on main; a branch made hours ago and landing now remains fresh.

Committer time was an incorrect proxy: it included time on the agent's
branch. It would have promoted five additional launches in this cohort.
For example, `core-78265f88bace-20261119T042953Z` began at 04:29:53Z, only
54.764 seconds after `b46eb413a0f6` landed at 04:28:58.236Z. It now keeps
full-check rank. The old proxy's raw producer/projection are preserved for
audit; neither defines the current contract or the rate above.

| Measure | Green core cohort | Landing-time launch replay |
|---|---:|---:|
| Population | 15 | 23 |
| Minimum gate wall (s) | 1,029.375 | — |
| Median gate wall (s) | 1,999.644 | — |
| Maximum gate wall (s) | 6,514.157 | — |
| Gate wall above 7,200 s | 0 | — |
| Launch-to-completion above 7,200 s | 1 | — |
| Unverified on main above 7,200 s since landing | — | 9 |
| Promoted green / red / held | — | 4 / 4 / 1 |
| Missing landing evidence | — | 0 |

The per-launch replay includes repeated held attempts: each is a real rank
decision. Age is from the landing result's `at` for the oldest outstanding
commit to the launch timestamp in the run name; green completion is
`started + wall_s` from its summary. The result snapshot is read by the
production `landedTimes()` owner, including its per-commit result mapping.
There is no committer-time fallback. The raw projection retains each original
summary's path and SHA-256, its measured progress receipt when present,
the Git commit and inferred verified commit, and the oldest outstanding
commit and its landing time. No new benchmark or outcome record was written.

| Core run | Verdict | First-parent distance | Oldest commit landed at (UTC) | Unverified on main (h) | Promotes |
|---|---|---:|---|---:|---|
| `core-96c3b7b4dad9-20261118T225713Z` | green | 1 | 2026-11-18T22:56:43.704Z | 0.008 | no |
| `core-ae4898abff47-20261118T235314Z` | green | 3 | 2026-11-18T23:26:11.343Z | 0.451 | no |
| `core-78265f88bace-20261119T042953Z` | green | 8 | 2026-11-19T04:28:58.236Z | 0.015 | no |
| `core-975aa8a70a52-20261119T055806Z` | green | 43 | 2026-11-19T05:57:57.502Z | 0.002 | no |
| `core-b4c20fbdb39b-20261119T065208Z` | held | 1 | 2026-11-19T06:46:05.218Z | 0.101 | no |
| `core-a33eacb74dc1-20261119T091014Z` | held | 4 | 2026-11-19T06:46:05.218Z | 2.402 | yes |
| `core-a33eacb74dc1-20261119T094101Z` | green | 4 | 2026-11-19T06:46:05.218Z | 2.915 | yes |
| `core-607af5ab3dd3-20261119T112010Z` | held | 3 | 2026-11-19T09:43:14.173Z | 1.616 | no |
| `core-20bae312e9f9-20261119T120151Z` | green | 4 | 2026-11-19T09:43:14.173Z | 2.310 | yes |
| `core-328f61d0d7ff-20261119T125942Z` | green | 2 | 2026-11-19T12:11:04.915Z | 0.810 | no |
| `core-fa42bf6a9587-20261119T142648Z` | green | 1 | 2026-11-19T14:26:32.027Z | 0.004 | no |
| `core-6083e7c35295-20261119T160051Z` | green | 1 | 2026-11-19T14:42:54.455Z | 1.299 | no |
| `core-7ef21c9cf8f9-20261119T181704Z` | green | 1 | 2026-11-19T17:01:46.492Z | 1.255 | no |
| `core-affc55106dc3-20261119T210046Z` | held | 7 | 2026-11-19T19:36:22.978Z | 1.406 | no |
| `core-bbfe086ea59e-20261119T213153Z` | red | 8 | 2026-11-19T19:36:22.978Z | 1.925 | no |
| `core-1d4fb556d0d9-20261119T230348Z` | green | 38 | 2026-11-19T19:36:22.978Z | 3.457 | yes |
| `core-1dccb9d1090c-20261120T073629Z` | green | 13 | 2026-11-20T00:11:31.039Z | 7.416 | yes |
| `core-4777afd697fb-20261120T090431Z` | green | 22 | 2026-11-20T09:01:51.070Z | 0.044 | no |
| `core-ca63c805525a-20261120T111253Z` | green | 3 | 2026-11-20T10:26:32.510Z | 0.772 | no |
| `core-e60a93b9b2ff-20261120T175826Z` | red | 48 | 2026-11-20T11:31:40.323Z | 6.446 | yes |
| `core-8f810b3da39c-20261121T040121Z` | red | 109 | 2026-11-20T11:31:40.323Z | 16.495 | yes |
| `core-b72afbf6db91-20261121T100606Z` | red | 118 | 2026-11-20T11:31:40.323Z | 22.574 | yes |
| `core-e68b5a93da12-20261121T130421Z` | red | 120 | 2026-11-20T11:31:40.323Z | 25.545 | yes |

Corrected replay: `/home/akisarou/.cache/nts-scratch/929/core-cycles-landings.json`,
SHA-256 `7e4dd2a9fc1570af5fbfc89ca09003b273a7734b1aaab1b1ca1807a9a8325ce4`.
Producer: `/home/akisarou/.cache/nts-scratch/929/core-cycles-landings.mjs`,
SHA-256 `86245a8cd93c697af2b8cf8163b9dbf9b09a8beecaef21db13d0bb273b965588`.
Console log: `/home/akisarou/.cache/nts-scratch/929/core-cycles-landings.log`,
SHA-256 `c979ae4183a36b45c663934d67cd4961adac08b0e110b0ed4ec09d888de375ee`.
The named, admitted replay unit was `nts-929-landing-replay`.

Landing results are retained in
`/home/akisarou/.cache/nts-scratch/929/landing-replay-inputs/results/`;
their filenames and SHA-256 values are in
`/home/akisarou/.cache/nts-scratch/929/landing-replay-inputs/manifest.json`,
SHA-256 `024e632b82ff0955442326b07c905984ec8d9f911af759b4ee90f72b701259ed`.
The unchanged cycle cohort is
`/home/akisarou/.cache/nts-scratch/929/core-cycles.json`,
SHA-256 `fe79c746350665c5ed0847ed7e1708c96a7633514ca99bb84a6314f5ba628a9e`.
Its old producer and console log remain at
`/home/akisarou/.cache/nts-scratch/929/core-cycles.py` and
`/home/akisarou/.cache/nts-scratch/929/core-cycles.log`, respectively,
SHA-256 `d8545a552ad29b2b4ffdefc906b223d7af4cf6030bb4d48cd72b3bf93ab91396` and
`1e274e3ea718b93421a2e5164f5cfc9a1bd30203ce0925034e6ae63b013b2304`. Their committer-age field is superseded
by the corrected landing-time replay.

The contract is in [the workflow](../workflow.md#the-machine). Controller
controls cover the exact landing-age boundary, stale backlog with a newer
candidate, current/missing/unrelated verified, fresh work after a quiet spell,
an old branch landing now, missing/invalid landing evidence, and a green
catch-up returning to full-check rank. The launched rank feeds the production
ledger decision beside earlier agent and later landing requests. Wide work,
records and benchmarks retain full-check rank. Like #924, this takes effect
only once `verified` contains it, because the controller runs `verified`'s code.
