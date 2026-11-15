# Build the config audit workspace in private (#790)

The config audit's forced TypeScript solution build wrote caches, declarations
and a package link into its source workspace. This made later discovery depend
on ignored outputs left by earlier checks.

One `workspaceInputs` declaration now serves discovery and staging: the tracked
workspace data namespace plus `runtime/native/libc.d.ts` and `scalars.d.ts`.
The latter declares the ambient `@nts/scalars` module. The private copy retains
repository-relative layout, current dirty tracked bytes and tracked siblings,
and excludes ignored output. The named project and `tsc -b --force` invocation
remain unchanged. A future external reference omitted from the declaration
fails the private build instead of silently escaping step selection.

The copy lives through diagnostic capture and compiler drain. Staging failures
cannot become clean diagnostics, and cleanup preserves both primary and cleanup
failures. The shared reader change only types the existing file entry variant.

| Real workspace control | Old audit | Fixed audit |
|---|---:|---:|
| Source outputs rewritten | 31 | 0 |
| Exit status | 0 | 0 |
| Findings/stdout | Same bytes | Same bytes |

The control loaded the exact audit from `af1570785d817d38875dfb8007103e835a0dfbca`
through a named hook in this owned pool tree. Its source SHA-256 is
`48cba9aff331e4bd216829dbaac90f4bc8fed48ec6d615624f4fac787edb928e`.
Existing source buildinfo remained present for both arms. Full workspace
snapshots include hashes and nanosecond modification times; the fixed audit
changed neither files nor directories. Raw stderr is retained; only Node's PID
prefix was normalized for the warning comparison, which also matched.

The three final focused controls prove dirty tracked value 43 is compiled,
an extra tracked sibling is copied, ignored buildinfo is initially absent and
then emitted only in private storage, external declarations retain their layout,
actual diagnostics match, and omitting an external staging input gives TS6053.
Actual external-file edits reach the config step's named reader obligation;
this assertion does not rely on config's independent tree check. Full-Program
discovery remains an independent input owner.

Proof source: `aa84a034e61a98c54b98be76973d8c6d431af339`. Focused V6 is 3/3,
with host audit and strict checking green. The required `inner.ts --no-agree` completed successfully in its named unit, including formatting, Clippy, the fresh compiler and all selected backend tests. Its complete retained journal supplies the actual terminal result.
No separate pre-landing whole-gate run was requested; the landing service runs
the complete selected gate.

Earlier results remain excluded: V1's extensionless synthetic import refused
before tsc; real audit V1 exposed non-portable source buildinfo facts, resolved
by staging the declared tracked namespace; real audit V2 exposed the missing
external inputs. Focused V4 rejected an abbreviated pin before tests. V5 passed
the controls and host audit, then strict named a missing input-list annotation.
The final source fixes that annotation. A proposed declaration-removal assertion
was replaced before acceptance because full-Program discovery can independently
retain selection reach.

Old ignored output cleanup follows landing so the old main audit cannot recreate
it immediately. Only idle free pool and gate trees are eligible after ownership
checks; shared main, held task trees and helper's deliberate warm-tree control
remain untouched. Cleanup results and every deferral are reported on #790.

Raw evidence: `/home/akisarou/.cache/nts-scratch/790/raw-evidence-v1.json`,
SHA-256 `f06f58029c1f1476229bcc72840332e33ce0dd4d378d1787fad432691a37898e`.
