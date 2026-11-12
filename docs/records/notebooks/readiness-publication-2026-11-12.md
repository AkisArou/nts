# Whole child records (#730)

The [inventory](../readiness-publications-2026-11-12.tsv) contains 19 publication
calls in 14 modules. Sixteen use durableRecord; three terminal outcomes in the
sealed output-oracle driver use its one inline publishOracleTerminal writer.
Two former manual write/rename sequences were consolidated into durableRecord.
The census scratch readiness path is now a JSON object. A generated suffix in
the full-check service and two in measure are explicit branded source too.

The parser follows script-file and Node eval sinks, local source helpers,
lexical aliases, concrete concatenation fragments and branded exported source
factories. Synchronous parent setup, ordinary returned strings, read-only opens
and append-only event streams are outside the publication rule. The sealed
exception is parsed: its body must create a unique sibling temporary with
randomUUID, write its record there, then rename that same path to its target.
Removing rename, writing directly to the target, sharing the temporary or
renaming elsewhere is rejected. The TypeScript owner and Rust publication work
(#727) are crosslinked on both cards.

The real half-write control pauses durableRecord after half its temporary is
written. The target is absent, the temporary is incomplete JSON, and after
release the target is whole and the temporary is gone. A non-atomic generated
publisher is rejected by the source controls.

An fd-3 alternative was rejected: Node's corpus has 1,052 child_process files
and 497 worker_threads files. A subject spawning an inheriting grandchild left
fd 3 open after subject exit, so the channel did not end even though its complete
record had arrived. The final file control instead receives the terminal record
while its grandchild remains behind a release barrier. Builtins-only publication
preserves the sealed loader's closure.

The converted-fixture run passed 217 of 218 tests; the failure was the service
suffix relying on the source factory's former writeFileSync import. Explicit
suffix imports and publication ownership fixed it. The final three suffix
consumer controls pass, as do seven publication and ten host-audit controls.
The matching nts/nts-suite/oracle-plan build passed. The final host audit checks
1,809 sources, 225 closures and 420 host reads, with no findings. Strict types
check 751 modules with no diagnostic increase.

A standalone profile measured 2.61 s before traversal consolidation: 292 ms
of self time in the new checker, with additional remote AST child traversal.
The binding walk now also collects calls and the one special publisher;
resolution caches lexical bindings. Final standalone audit wall was 1.969 s
against the prior 1.900 s, with the final strict check at 1.656 s. The 7.43 s
audit inside the loaded suite is not a standalone comparison.

Detailed logs and the native-parser reduction remain in
~/.cache/nts-handover/codex-helper/readiness-730/. No upstream report was sent.

The first landing ran 1,948 tests (1,945 pass, one failure, two standing
Unicode todos). Its one failure was the timing audit catching this change's
polling sleep in the half-write control. The control now blocks on stdin and
the parent releases it with a byte. All 14 publication/timing controls pass,
and strict checking passes after that change. Test-focused proof includes the
timing audit from here on.
