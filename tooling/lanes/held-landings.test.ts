import {queuedLandings} from "./landing-state.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appliedHeldResolution, heldForEntry, heldActions, heldLandings, wasHeldGeneration, holdLandings, pendingHeldResolutions, prepareHeldResolution } from "./held-landings.ts";

const member = (id: string) => ({ id, sha: id.repeat(40), tree: `/owned/${id}`, durable: true, required: { steps: ["tooling"] } });
function fixture(t) {
  const state = mkdtempSync(join(tmpdir(), "held-landings-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const input = { tip: "f".repeat(40), generation: "first", run: join(state, "run"), reason: "tooling NOT RUN (hung)", entries: [member("a"), member("b")] };
  return { state, input, batch: holdLandings(state, input) };
}

test("one durable hold covers all frozen members without holding an unrelated entry", t => {
  const { state, input, batch } = fixture(t);
  assert.deepEqual(heldLandings(state).map(row => row.entry), input.entries);
  assert.equal(heldLandings(state).some(row => row.entry.id === "c"), false);
  assert.equal(readdirSync(join(state, "held-landings/batches")).length, 1);
  assert.deepEqual(holdLandings(state, input), batch);
  assert.throws(() => holdLandings(state, { ...input, reason: "changed" }), /held batch changed/);
});

test("an interrupted retry retains the hold until its queue effect is applied", t => {
  const { state, batch } = fixture(t);
  const decision = prepareHeldResolution(state, batch.id, "a", "retry", "operator requests a fresh measurement");
  assert.equal(heldLandings(state).length, 2);
  assert.deepEqual(pendingHeldResolutions(state), [{ resolution: decision, batch, entry: batch.entries[0] }]);
  assert.deepEqual(prepareHeldResolution(state, batch.id, "a", "retry", decision.note), decision);
  assert.throws(() => prepareHeldResolution(state, batch.id, "a", "refuse", "changed decision"), /different operator decision/);
  appliedHeldResolution(state, decision);
  appliedHeldResolution(state, decision);
  assert.deepEqual(heldLandings(state).map(row => row.entry.id), ["b"]);
  assert.deepEqual(pendingHeldResolutions(state), []);
});

test("a refusal resolves only its selected member and requires an operator note", t => {
  const { state, batch } = fixture(t);
  assert.throws(() => prepareHeldResolution(state, batch.id, "a", "refuse", ""), /invalid held resolution/);
  assert.throws(() => prepareHeldResolution(state, batch.id, "c", "refuse", "unknown"), /invalid held resolution/);
  const decision = prepareHeldResolution(state, batch.id, "b", "refuse", "operator abandons the held submission");
  appliedHeldResolution(state, decision);
  assert.deepEqual(heldLandings(state).map(row => row.entry.id), ["a"]);
});

test("a fresh hold after a resolved retry is a distinct generation", t => {
  const { state, input, batch } = fixture(t);
  for (const entry of input.entries) appliedHeldResolution(state, prepareHeldResolution(state, batch.id, entry.id, "retry", "retry"));
  const next = holdLandings(state, { ...input, run: join(state, "second-run") });
  assert.notEqual(next.id, batch.id);
  assert.equal(heldLandings(state).length, 2);
});

test("corrupt or duplicate hold records fail closed", t => {
  const { state, input, batch } = fixture(t);
  assert.throws(() => holdLandings(state, { ...input, run: join(state, "duplicate") }), /already belongs/);
  writeFileSync(join(state, "held-landings/batches", `${batch.id}.json`), "{broken");
  assert.throws(() => heldLandings(state));
});


test("only the completed held generation retires, including after an operator retry", t=>{
  const {state,batch}=fixture(t);
  assert.equal(wasHeldGeneration(state,"first"),true);
  assert.equal(wasHeldGeneration(state,"later-same-tip"),false);
  for(const entry of batch.entries)appliedHeldResolution(state,prepareHeldResolution(state,batch.id,entry.id,"retry","retry"));
  assert.equal(wasHeldGeneration(state,"first"),true);
  assert.equal(wasHeldGeneration(state,"later-same-tip"),false);
  assert.equal(heldForEntry(state,"a"),undefined);
});

test("a queued descendant reports the unresolved prerequisite and its qualified operator actions",t=>{
  const {state,batch}=fixture(t);
  const dependency=join(state,"held-dependencies");mkdirSync(dependency);
  writeFileSync(join(dependency,"descendant.json"),JSON.stringify({hold:batch.id,prerequisite:"a"}));
  const held=heldForEntry(state,"descendant")!;
  assert.equal(held.entry.id,"a");
  assert.match(heldActions(held).retry,new RegExp(`--retry-held ${batch.id}:a `));
  assert.match(heldActions(held).refuse,new RegExp(`--refuse-held ${batch.id}:a `));
  appliedHeldResolution(state,prepareHeldResolution(state,batch.id,"a","retry","retry"));
  assert.equal(heldForEntry(state,"descendant"),undefined);
});

test("status reports held members, dependencies and corrupt hold evidence without inventing a disposition",t=>{
  const {state,batch}=fixture(t);mkdirSync(join(state,"pending"));mkdirSync(join(state,"held-dependencies"));
  for(const entry of [...batch.entries,{...member("c"),id:"descendant"}])writeFileSync(join(state,"pending",entry.id+".json"),JSON.stringify({...entry,at:0}));
  writeFileSync(join(state,"held-dependencies/descendant.json"),JSON.stringify({hold:batch.id,prerequisite:"a"}));
  const rows=queuedLandings(state);
  assert.equal(rows.length,3);assert.equal(rows.filter(row=>row.hold.state==="held").length,3);
  assert.equal(rows.find(row=>row.id==="descendant").hold.prerequisite,"a");
  assert.match(rows[0].hold.actions.retry,/--retry-held/);
  writeFileSync(join(state,"held-landings/batches",batch.id+".json"),"{");
  assert.equal(queuedLandings(state).every(row=>row.hold.state==="unknown"),true);
});
