# Vanished cache entries during the hourly count — #784

Base `8fdadc8816fe8a5908ffdc181c39525f80c641b8`; frozen proof `ecfe6b5a57f848b4098ab4d3677039482a122732`.
Raw evidence: `/home/akisarou/.cache/nts-scratch/784/raw-evidence-v1.json`; SHA-256 `77a1b4bc7082620cbb9add3130a04143a16d0e2f6f4e33dc58375948c0a9f68a`.
The kept scratch manifest authenticates 63 artifacts and 9 Git source receipts.

The existing folder walker treats only ENOENT from a listing or a listed
entry's stat as absence. The node-test-root contents query likewise skips a
departed candidate. Other errors retain their exact identity and reach the
existing not-counted boundary. Cache policy and deletion authority are unchanged.

| Control | Current | Guard disabled |
|---|---|---|
| Listed child removed before stat | Other red line retained | Named ENOENT failure |
| Node root removed before contents query | PASS, no fabricated leftover | Named ENOENT failure |
| EACCES and EIO at stat | Exact named error retained | — |

Actual canonical build and sealed focused proof passed 128/128, including
count, full-check service/schedule/state and report consumers. Timing, rooted
records, JVM members, diff, host audit and strict checking pass.
The two guard mutants each fail only their targeted case; the unchanged arm
passes both. They use authenticated committed source loaded in memory, with
only one ENOENT guard removed, rather than an old-commit replay.

Mandatory actual inner --no-agree is green: fmt 3 s, Clippy 2 s,
build 1 s, tests 407 s. No prequeue full --here,
historical kernel-race reproduction, or performance claim is inferred.
