# Shared source facts: #747

The verdict is **improvement**. On one fixed pool-3 tree, sharing structural
facts reduces instructions by 18.8% and cgroup CPU by 17.6%. The 12.7% higher
peak, from about 367 to 414 MB, is the accepted cost of bounded parser batches
at this size. Wall time supports the result; host load makes it a secondary
measure.

The measured new source is `444603c0dc18d9f3b3bd3017ba0e3b68ab703c4e`.
The old engine was staged from main at
`5399e30e99e66f93772c06386d8a186bc636536a`. Both engines inspected the same
fixed pool-3 source. Node was v26.13.0. Four fresh engine processes ran in
old/new/new/old order under `with-lock.sh --wait --key perf-count`, with each
subject pinned to CPU 4 and its sibling quiet. The instruction event was
`cpu_core/instructions/u`; the monitor remained off CPUs 4–5. CPU comes from
the subject unit's hierarchical cgroup counter, and peak from its resettable
scope meter. Instructions, CPU and wall are means of each engine's two arms;
peak is the larger observed peak.

| Engine | Instructions | Cgroup CPU | Peak bytes | Wall | One-minute load beside wall |
| --- | ---: | ---: | ---: | ---: | --- |
| Old | 54,204,898,172.5 | 4.081685 s | 367,390,720 | 4.613436 s | 35.88, 32.62 |
| Shared facts | 44,001,601,475.5 | 3.364151 s | 414,216,192 | 3.377984 s | 33.89, 32.62 |
| New / old | 0.811764 | 0.824206 | 1.127454 | 0.732206 | Overall range 32.62–35.88 |

The counted runs cover 1,852 sources, 245 entry closures and 412 host reads.
After rebasing onto main, the final inventory confirmation covers 1,853
sources, 246 entry closures and the same 412 host reads. Canonically sorted
findings are equal, including every
closure member, read, publication and problem; there are no problems. The
retained JSON contains the raw four counted arms, engine/source identities,
inventory digests and the final confirmation. The findings file retains the
complete compared inventory once because both canonical inventories match.

`source-facts.ts` does one structural pass per parsed source. Inspectors reuse
indexed kind rows, lexical scopes, parents, calls, imports and source ranges.
Generated JavaScript selected by actual sinks gets one shared index too.
Batches stop at sixteen parser leases or two MiB of source. A larger source
is processed alone; leases are disposed as their module finishes. Those are
source and lease bounds, not a promise of a fixed memory ceiling for an
arbitrarily large individual module.

The first shared-index prototype regressed: fixture-copy value propagation
repeatedly queried ancestors. CPU profiles identified that work. Memoizing
the propagation over immediate-child rows removed it, and releasing leases
immediately reduced their lifetime. Profiles and raw ABBA output remain in
pool 3's `target/747-investigation/`; the retained record below carries the
matched result and the complete inventory independently of that target.

Evidence: [raw measurements and equality proof](shared-source-facts-747.json),
[complete findings](shared-source-facts-747.findings.json).
