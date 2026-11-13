# Prepared contributor test invocations — #753

The shared Cargo invocation owner refuses executing inner tests without the complete oracle seal and freshly selected compiler before Cargo or disk admission. It prints the exact runnable command `node tooling/gate/inner.ts --no-agree`. Compile-only `--no-run` is recognized only before the test-argument separator.

The full seal verifier is a Node builtin leaf with a one-file project. The canonical wrapper adds instrument classification, and `test-profile.ts` imports the leaf without the launchers. The selected original verifier block is byte-equal; its byte count and digest are in the adjacent tool-written JSON.

## Runtime publication correction

Both old runtime publishers kept a fixed module list. The extracted nested seal exposed that list in completed readers, and ordinary children still asked Node to strip its raw source. Both publishers now use one producer transform over stripped imports/re-exports. It consumes OracleWorker’s captured API/AST, retains detached primitives and one source lease at a time, and refuses an over-limit graph before publication. The result publisher closes and removes its private owner after success or transform failure.

The SDK-free result reader imports no preparation/parser code. Canonical relative module maps and their hashes remain bound through the existing snapshot or root handoff, with fixed required entries and exact loaded-byte hooks. Typed bootstrap source is erased into the pinned data URL. JavaScript and Rust authenticate the raw writer/compiler/bootstrap inventories. Controls cover nested reach, real no-strip execution, per-module tampering, missing/unlisted/aliased files, bounded traversal, owner lifecycle and copied source with an explicit toolchain.

## Identity and placement

Matched source pins and complete coverage/routes are retained with digests. The 1231 normalized oracle rows are byte-equal; both pending sets are empty, and no budget becomes newly stale. No common-path coverage or actual-route obligation is lost or added. Fallback remains 142 and full-policy paths 36. The recipe change is accepted; the only current budget row was already stale. Temporary source copies and their Git metadata were removed together.

## Verification

Expanded final-source focused/consumer/timing proof: 295/295. The targeted correction batch is separately retained. Rebase timing, host and strict logs are included; the rebase changed no reviewed implementation/test bytes.

Supported source `f9e99c769fdfb2dda2ab3305530526fb5b4e799c`: 2256 tooling passed, 0 failed, 2 existing TODOs; 3047 Rust passed, 0 failed, 8 ignored. All gate steps pass and scope cleanup completes. Wall 1502.221 s and admission wait 1087.5800000000002 s are separate observations that can overlap.

The actual documented inner route is green: fmt, clippy, build, tests. Its exact output is retained. Neither route received a hand-built NTS_BIN or oracle environment.

## Retained unsuccessful attempts

The first supported attempt omitted native source inventory entries; its completed native failures and stopped remainder remain explicit. The second exposed the fixed-three publishers. The third caught a portable SDK lookup, a canonical-key diagnostic mismatch and a suffix lint. It passed the native suite but failed Clippy and two tooling leaf controls (including their failed parent in Node’s count). None is presented as green, and none ran the later inner command. The JSON records each source, result and retained raw transcript.

The evidence writer, scripts, complete maps, summaries and transcripts are retained under `~/.cache/nts-scratch/753` until coordinator review; the adjacent JSON names their exact paths, sizes and digests.
