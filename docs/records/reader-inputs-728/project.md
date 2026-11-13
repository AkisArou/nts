# Declared compiled projects — part of #728

Source `6ffc4f27cf0b379e9f14c5b9dee7ff64ecfead81` against `c579927b87eae3ba33e6b5181b918b85b9755d2c`.

The compiling caller declares `projectInput`. The graph and fixture copier use the same fresh project snapshot: OracleFilesystem owns the nearest-project search, and the pinned parser reports its real inherited configuration reads, references and declared roots. Config bytes are immutable leaf inputs; roots enter the module graph. Ordinary byte, data and module ownership cannot suppress a later project request. Graphs without a project declaration do no project discovery. The old copier-only owningProject path is removed. OracleFilesystem remains unchanged.

The real node-preload fixture now carries its compiled project descriptor. Three remaining fixture launch paths are module-relative URL declarations. Missing and escaping projects refuse before copying; controls cover both promotion orders, references, inherited configs, changing roots and selector/copier equality.

## Matched census

- Existing live obligations retired: 0. Additions: 1287, the full pairs retained off tree with their digest in project.json.
- Switch-off edges: 82550 → 83646 (56 closed, 1152 added). First-loss sites/readers: 348/136 → 334/133.
- Fallback stays 142 unplaced + 33 policy paths in both engines at both pins.

The additions are conservative: 1,179 gate-inputs, 82 tooling and 26 individual obligations elsewhere. The selector now imports the shared project owner, whose OracleFilesystem import reaches existing reader declarations. The remaining module-text walk also follows the oracle execution reader's benchmark corpus and adjacent-config strings; its new project-inputs.ts adjacency is classified as project-context, not an invented fixed project input. This slice retires none of that inference. The final namespace/scanner slice must classify its removal separately.

## Proof

Focused consumers and timing: 242/242, zero failures. Host: 1,878 sources / 257 closures / 413 reads. Strict: 819 modules, 5,709 recorded diagnostics, 14 improved modules, no new diagnostics.

Supported canonical command: `node tooling/landing/check.ts 6ffc4f27cf0b379e9f14c5b9dee7ff64ecfead81 --here`.
Run: `/home/akisarou/.cache/nts-landing/runs/here-6ffc4f27cf0b-1794537801995`. GREEN: 2186 tooling passed, 0 failed, 2 TODO; 3044 Rust passed, 0 failed, 8 ignored. Gate wall 814.866 s, admission wait 445.923 s (not subtracted; waits can overlap execution). CLI output reports 961 s including preparation/admission. These are loaded proof observations, not a performance comparison.

The first unclassified capture and the parked record-store experiment are excluded as described in project.json. No fixture expectation was changed to accept the production-store reach.

## Reproduction

Use reader-census.ts inspect at each pinned, independently initialized source; the exact command, source requirements and retained matched scripts are in project.json. The index stays off tree:
`/home/akisarou/.cache/nts-scratch/728/project-census-v2/namespace/edges.json` (3112658 bytes), SHA-256 `62fba5524e80c9b16365119ee7bf07e6bd995d93f6d1a6d3cba9c343d2b2e616`.

The existing full-check keep row protects that evidence until #728 closes. No multi-megabyte edge index is committed.

## Standalone gate-inputs cost

The base and current selector owners ran against the same fixed current source under `with-lock.sh --wait --key perf-count`, perf user instructions on CPU 4, in ABBA order. Each arm is a fresh Node process, with in-process graph caches only. No intentional background load was added. Peak is the resettable own-unit cgroup peak and includes the same controller plus descendants. The two private source copies and their .git directories were removed together after the run.

| Engine | Instructions | Cgroup CPU s | Peak bytes | Wall s | Load (1/5/15) |
| --- | ---: | ---: | ---: | ---: | --- |
| base | 47668273855.5 | 4.080620 | 1482029056 | 4.114313 | 13.48/29.98/41.47; 13.2/29.12/41 |
| current | 47470084892.0 | 4.064072 | 1494716416 | 4.080584 | 13.52/29.72/41.32; 13.48/29.44/41.17 |
| New/base | 0.995842 | 0.995945 | 1.008561 | 0.991802 | — |

Verdict: noise. Counts and CPU do not regress beyond the arms' spread; the earlier loaded canonical wall observation is not a standalone cost increase. Raw rows, pins, counter, commands, CPU basis and file digest are in project.json and its retained result.
