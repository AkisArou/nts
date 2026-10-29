import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runScopedTooling } from "../../gate/tooling-runner.ts";
import { readStepInstrument } from "../../gate/step-result.ts";
import { readWptHungResults } from "../../../runtime/web-platform/test/wpt/hung.ts";
import { UpstreamWptExecution } from "./upstream-liveness.ts";
import { finishWebHost } from "./host-tests.ts";

const runner = new URL("../../../runtime/web-platform/test/wpt/runner.ts", import.meta.url).href;

test("completed WPT failures survive a later hang through the real structured host stream", async t => {
  const directory = mkdtempSync(join(homedir(), ".cache/nts-wpt-failure-priority-"));
  const previous = process.env.NTS_WPT_HUNG_RESULTS;
  t.after(() => { if (previous === undefined) delete process.env.NTS_WPT_HUNG_RESULTS; else process.env.NTS_WPT_HUNG_RESULTS = previous; rmSync(directory, { recursive: true, force: true }); });
  for (const route of ["fail", "pass", "body-cleanup", "harness", "cleanup", "close"] as const) {
    const file = join(directory, route + ".test.mjs"), local = join(directory, route + ".jsonl"), frame = join(directory, route + ".frame.json");
    writeFileSync(local, ""); process.env.NTS_WPT_HUNG_RESULTS = local;
    const source = route === "body-cleanup"
      ? 'promise_test(t=>{t.add_cleanup(()=>new Promise(()=>{}));throw Error("definite body failure")},"body");'
      : route === "cleanup"
        ? 'promise_test(t=>{t.add_cleanup(()=>{throw Error("definite cleanup failure")});t.add_cleanup(()=>new Promise(()=>{}));return Promise.resolve()},"body");'
        : `test(()=>{${route === "fail" ? 'throw Error("definite subtest failure")' : ""}},"completed");${route === "harness" ? 'recordFailure();' : ""}async_test(()=>{},"unfinished");expire();`;
    writeFileSync(file, `
import {test} from 'node:test';
import {observeWptFixture,reportWptFixture} from ${JSON.stringify(runner)};
const prepared={context:{fixture:{path:'control.js',blockedTests:{}},timeoutMilliseconds:10000},scripts:[{path:'control.js',source:${JSON.stringify(source)},lineOffset:0}],imports:[]};
let expire;
test('file',async file=>{
  const observation=await observeWptFixture(prepared,reportError=>({globals:{expire(){expire()},recordFailure(){reportError(Error('definite harness failure'))}},close(){${route === "close" ? "throw Error('definite provider close failure')" : ""}}}),{
    deadlineScheduler(callback,_milliseconds,activity){expire=callback;if(activity?.phase==='cleanup'&&${JSON.stringify(route === "body-cleanup" || route === "cleanup")})queueMicrotask(callback);return()=>{};}
  });
  await reportWptFixture(file,'control.js',observation);
});
`);
    const output = new PassThrough(); let transcript = ""; output.on("data", part => { transcript += part; });
    const result = await runScopedTooling([file], { fixture: true, output });
    const definite = route === "pass" ? 0 : 1;
    assert.equal(result.completedFailures, definite, `${route}: ${transcript}`);
    assert.equal(finishWebHost(result, readWptHungResults(local), { NTS_GATE_STEP_RESULT: frame, NTS_GATE_STEP: "web-platform", NTS_GATE_STEP_ATTEMPT: route }), definite ? 1 : 124);
    const instrument = readStepInstrument(frame, "web-platform", route)!;
    assert.equal(instrument.verdict, definite ? "FAIL" : "NOT RUN");
    assert.equal(instrument.completedFailures ?? 0, definite);
    assert.match(transcript, /NOT RUN \(hung\)/);
    if (definite) assert.match(transcript, /definite .* failure/);
    if (route === "fail" || route === "pass") assert.match(transcript, /unfinished/);
  }
});

test("legacy settlement retains a failed body and cleanup errors beside hung cleanup", async () => {
  for (const bodyFailed of [false, true]) {
    let expire: (() => void) | undefined;
    const execution = new UpstreamWptExecution("legacy.js", { deadlineScheduler(callback, _milliseconds, activity) {
      if (activity?.phase === "cleanup") expire = callback;
      return () => {};
    } });
    const bodyError = Error("definite legacy body failure"), cleanupError = Error("definite legacy cleanup failure");
    try {
      const ready = Promise.withResolvers<void>();
      const result = execution.observeSettlement("body", bodyFailed ? Promise.reject(bodyError) : Promise.resolve(), [
        () => { ready.resolve(); return new Promise(() => {}); },
        () => { throw cleanupError; },
      ]);
      await ready.promise;
      assert.ok(expire); expire();
      const observation = await result;
      assert.equal(observation.body?.status, bodyFailed ? "fail" : "pass");
      if (bodyFailed) assert.equal(observation.body?.error, bodyError);
      assert.deepEqual(observation.cleanupErrors, [cleanupError]);
      assert.equal(observation.hung?.observation.kind, "hung");
    } finally { execution.close(); }
  }
});
