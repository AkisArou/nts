# Command lifetime migration — #758

Production source ef6098041308387dd823389f9bdec15a0e1eb805; corrected consumer source 0cf9e89537fcd224f98350c95cc443b57e0751b8.
One entry owns process signals and terminal cleanup. Cancellation stops acquisition while retirement transports remain available; destruction then joins named resource completion. The old gate/exit.ts name is removed. Explicit exits use the same terminal drain, with catches preserving the transfer before classifying errors.

SIGINT remains 130. SIGTERM is now conventionally 143 (several old handlers always used130), and SIGHUP is129. Early resource-free immediate exits remain immediate. Ordinary command return statuses survive cleanup errors; cleanup-only failure is nonzero.

## Migration inventory

Each prior callback and current registration is retained by file and source line in command-lifetime-758.json. The explicit host-exit migration used parsed calls and preserved generated child text.

| Module | Named resource registration(s) |
| --- | --- |
| tooling/census/census-scratch.ts | const unregister=registerCommandCloser('census scratch '+path,{close:cleanup}); |
| tooling/census/erased-calls.ts | registerCommandCloser('scratch census/erased-calls.ts',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/census/messages.ts | registerCommandCloser('scratch census/messages.ts',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/census/rerun.ts | registerCommandCloser('scratch census/rerun.ts',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/census/semantic-codes.ts | registerCommandCloser('scratch census/semantic-codes.ts',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/census/worker-memory.ts | const unregister=registerCommandCloser(`memory run ${run.prefix}`,{close:()=>run.close(),closed:()=>run.closed}); |
| tooling/chromium/browser.ts | const unregister=registerCommandCloser(`Chromium launch ${unit}`,{cancel:stop,close:async()=>{await drain();}}); |
| tooling/conformance/agreement.mjs | registerCommandCloser('scratch conformance/agreement.mjs',{close:()=>{ |
| tooling/conformance/assembles.ts | registerCommandCloser('scratch conformance/assembles.ts',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/conformance/blockers-check.mjs | registerCommandCloser('scratch conformance/blockers-check.mjs',{close:()=>{ |
| tooling/conformance/blockers.mjs | registerCommandCloser('scratch conformance/blockers.mjs',{close:()=>{ |
| tooling/conformance/c-compiles.mjs | registerCommandCloser('scratch conformance/c-compiles.mjs',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/conformance/cascade-reach.mjs | registerCommandCloser('scratch conformance/cascade-reach.mjs',{close:()=>{ |
| tooling/conformance/differential-ts.mjs | registerCommandCloser('scratch conformance/differential-ts.mjs',{close:()=>{ |
| tooling/conformance/ecmascript/test262.ts | if(intlProvider)registerCommandCloser('ICU provider',{close:()=>intlProvider.close()}); |
| tooling/conformance/emitted-diff.ts | registerCommandCloser('scratch conformance/emitted-diff.ts',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/conformance/expect-ir.ts | registerCommandCloser('scratch conformance/expect-ir.ts',{close:()=>rmSync(SCRATCH,{recursive:true,force:true})}); |
| tooling/conformance/fuzz-runtime.mjs | registerCommandCloser('fuzz oracle worker',{close:()=>oracleWorker.close(),closed:async()=>{await Promise.allSettled([...oraclePreparations]);}}); |
| tooling/conformance/integrity.ts | registerCommandCloser('scratch conformance/integrity.ts',{close:()=>rmSync(scratchDir,{recursive:true,force:true})}); |
| tooling/conformance/jvm-verifies.ts | registerCommandCloser('scratch conformance/jvm-verifies.ts',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/conformance/last-mile.mjs | registerCommandCloser('scratch conformance/last-mile.mjs',{close:()=>{ |
| tooling/conformance/native-half.mjs | registerCommandCloser('scratch conformance/native-half.mjs',{close:()=>{ |
| tooling/conformance/node-environment.ts | if(!keep)registerCommandCloser('scratch conformance/node-environment.ts',{close:()=>rmSync(dir,{recursive:true,force:true})}); |
| tooling/conformance/run.mjs | registerCommandCloser('Node job temporary',{close:({code})=>{ |
| tooling/conformance/types-check.mjs | registerCommandCloser('scratch conformance/types-check.mjs',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/conformance/unconditional-expectations.mjs | registerCommandCloser('scratch conformance/unconditional-expectations.mjs',{close:()=>{ |
| tooling/differential/agree.mjs | registerCommandCloser('agreement oracle root',{close:()=>oracleRoot.dispose()});<br>registerCommandCloser('scratch differential/agree.mjs',{close:()=>rmSync(scratch,{recursive:true,force:true})}); |
| tooling/differential/command-entry/main.ts | export function registerCommandCloser(name:string,closer:CommandCloser):()=>void{return processOwner().lifetime.register(name,closer);} |
| tooling/differential/oracle-dependencies.ts | const unregister=registerCommandCloser('oracle dependency operation',{cancel:()=>controller.abort(),close:()=>controller.abort(),closed:async()=>{await operation;}}); |
| tooling/full-check/service.ts | registerCommandCloser(`full-check controller lock ${lock}`,{close:()=>{ |
| tooling/gate/admit.ts | const unregister=registerCommandCloser('admission '+options.what,{ |
| tooling/gate/memory-ledger.ts | const unregister=registerCommandCloser(`memory reservation ${request.key}`,{close:release,closed:()=>closed}); |
| tooling/gate/memory-watch.ts | const unregister=registerCommandCloser('memory watcher '+key,{cancel:()=>ending.abort(),close:()=>ending.abort(),closed:async()=>{await watch;}}); |
| tooling/gate/run.mjs | registerCommandCloser('gate run report '+RUN_DIR,{<br>registerCommandCloser('gate run resources '+RUN_DIR,{ |
| tooling/gate/test-environment.ts | registerCommandCloser('test environment roots',{close:()=>{ |
| tooling/gate/tests.mjs | registerCommandCloser('scratch gate/tests.mjs',{close:()=>rmSync(work,{recursive:true,force:true})}); |
| tooling/gate/tooling-runner.ts | const unregister=registerCommandCloser(`tooling workers ${slice}`,{cancel:stop,close:stop,closed:async()=>{await closed;}}); |

## Proof

The supported --here run at the production pin completed RED: 2224 tooling passed, 6 failed and 2 existing TODOs. Every other step passed; 3044 Rust tests passed with 8 ignored, across 55 binaries and 18 doctest crates. This record does not call that combined run green.

Its six failures were the intended SIGTERM status and four private wrappers that imported the old runner for side effects. The final test-only correction launches run.mjs as the command and supplies its private clock instrumentation through Node --import. All six corrected consumers pass; 29 entry/signal/timing controls pass, followed by host and strict checks. Empty-ledger, actual clock/verdict and startup assertions remain. Production bytes are unchanged from the supported pin.

The run wall is 505.833 s and admission waits total 310.974 s, which may overlap execution. CPU values in the JSON remain named by measure; no performance ratio is claimed. Raw logs, digests, the red run and excluded development controls are retained.

The real signal control retires a worker before closing its broker. A paused private browser copy proves cancellation after profile acquisition removes the profile without launching a child. Late broker/ledger cleanup failures make the runner summary non-green with scope_cleanup and leave its ledger empty. Explicit exits cover nested catch/finally, standalone top-level await and runAsCommand, preserving status and output while draining.

## Record identity

The oracle producer changes from 14cf179cdcad28eafcfb9d2460cf66ce31155a835792f2fa7c1675d8f7e651fe to 0ff152138020c53d0663c26544392bb11f8192dcfa4e9085817405db5f3f277e. Both sides retain 1231 rows and have empty pending populations. Their same lazy-collections budget was already stale; this task introduces no new population or budget refresh. Compile-producer.ts remains byte-identical.

Final proof metadata and the collector digest are in command-lifetime-758.json. Peer review accepted the canonical native evidence across the test-only correction; the landing check supplies the next complete tooling run.
