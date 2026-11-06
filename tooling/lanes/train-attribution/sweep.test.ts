import assert from "node:assert/strict";
import { test } from "node:test";
import { prefixTimings, readAttribution, sweep, type Identity, type Journal, type Measurement, type Member, type Omission } from "./sweep.ts";

const members: Member[] = ["a", "b", "c", "d"].map((id, index) => ({ id, sha: String(index + 1).repeat(40) }));
const context: Identity = { base: "0".repeat(40), tip: "9".repeat(40), members, steps: ["tooling"], original_run: "/run/original", red_decided_at: "2026-11-05T22:00:00.000Z" };
const copy = <T>(value: T): T => structuredClone(value);
function fixture(verdict: (ids: string[]) => Measurement["verdict"]) {
  let saved: Journal | undefined, tick = 0;
  const measured: string[][] = [], refused: string[] = [], omitted: string[] = [];
  return { measured, refused, omitted, saved: () => copy(saved), effects: {
    persist: (journal: Journal) => { saved = copy(journal); },
    compose: (parts: Member[]): { members: Member[]; tip: string; omissions?: Omission[] } => ({ members: parts, tip: parts.at(-1)?.sha ?? context.base }),
    measure: (parts: Member[], _tip: string, steps: string[]): Measurement => {
      const ids = parts.map(m => m.id); measured.push(ids);
      const disposition = verdict(ids);
      return { verdict: disposition, run: `/run/${measured.length}`, failed: disposition === "red" ? steps : [], reason: disposition === "held" ? "instrument stopped" : "" };
    },
    refuse: (member: Member) => { if (!refused.includes(member.id)) refused.push(member.id); },
    omit: (row: Omission) => { if (!omitted.includes(row.member.id)) omitted.push(row.member.id); },
    now: () => `2026-11-05T22:00:${String(++tick).padStart(2, "0")}.000Z`,
  } };
}

test("two culprits in the same step are isolated by restarted immutable prefixes", () => {
  const f = fixture(ids => ids.some(id => id === "b" || id === "d") ? "red" : "green");
  const result = sweep(context, undefined, f.effects);
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.deepEqual(result.members.map(m => m.id), ["a", "c"]);
  assert.deepEqual(f.refused, ["b", "d"]);
  assert.deepEqual(f.measured, [["a"], ["a", "b"], ["a", "c"], ["a", "c", "d"]]);
  assert.equal(prefixTimings(result.journal).length, 4);
  assert.ok(prefixTimings(result.journal).every(row => row.finished && row.run));
});

test("a later test that only fails beside the culprit is retained after recomposition", () => {
  const f = fixture(ids => ids.includes("b") ? "red" : "green");
  const result = sweep(context, undefined, f.effects);
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.deepEqual(result.members.map(m => m.id), ["a", "c", "d"]);
  assert.deepEqual(f.refused, ["b"]);
  assert.deepEqual(f.measured.at(-1), ["a", "c", "d"]);
});

test("withdrawing an earlier member invalidates only prefixes that contained it", () => {
  const f = fixture(() => "green");
  const compose = f.effects.compose;
  let withdrawn = false;
  f.effects.compose = parts => {
    if (!withdrawn && parts.length === 3) {
      withdrawn = true;
      return { members: parts.slice(1), tip: parts.at(-1)!.sha,
        omissions: [{ member: parts[0]!, reason: "explicit withdrawal", disposition: "withdrawn" }] };
    }
    return compose(parts);
  };
  const result = sweep(context, undefined, f.effects);
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.deepEqual(result.members.map(member => member.id), ["b", "c", "d"]);
  assert.deepEqual(f.measured, [["a"], ["a", "b"], ["b"], ["b", "c"], ["b", "c", "d"]]);
  assert.equal(result.omissions[0]!.disposition, "withdrawn");
});

test("a hold during the sweep never attributes or runs another prefix", () => {
  const f = fixture(ids => ids.length === 2 ? "held" : "green");
  const result = sweep(context, undefined, f.effects);
  assert.equal(result.state, "held"); assert.deepEqual(f.refused, []);
  assert.deepEqual(f.measured, [["a"], ["a", "b"]]);
  const resumed = sweep(context, f.saved(), f.effects);
  assert.equal(resumed.state, "held"); assert.equal(f.measured.length, 2);
});

test("restart replays a journaled refusal and never resurrects that member", () => {
  const f = fixture(ids => ids.includes("b") ? "red" : "green");
  const original = f.effects.refuse;
  f.effects.refuse = () => { throw new Error("crashed after write-ahead refusal"); };
  assert.throws(() => sweep(context, undefined, f.effects), /crashed/);
  const first = f.measured.length;
  f.effects.refuse = original;
  const result = sweep(context, f.saved(), f.effects);
  assert.equal(result.state, "ready"); assert.deepEqual(f.refused, ["b"]);
  assert.ok(f.measured.slice(first).every(ids => !ids.includes("b")));
});

test("a started prefix without a completed measurement holds on recovery", () => {
  const f = fixture(() => "green");
  f.effects.measure = () => { throw new Error("daemon gone"); };
  assert.throws(() => sweep(context, undefined, f.effects), /daemon gone/);
  const result = sweep(context, f.saved(), f.effects);
  assert.equal(result.state, "held"); assert.deepEqual(f.refused, []); assert.deepEqual(f.measured, []);
});

test("foreign identity, malformed history and unselected failures hold rather than blame", () => {
  const f = fixture(() => "green"); sweep(context, undefined, f.effects);
  const saved = f.saved()!;
  assert.throws(() => readAttribution(saved, { ...context, base: "f".repeat(40) }), /foreign/);
  assert.throws(() => readAttribution({ ...saved, cursor: 2 }, context), /invalid/);
  const duplicate = copy(saved); duplicate.events.push(duplicate.events.at(-1)!);
  assert.throws(() => readAttribution(duplicate, context), /pending/);
  const bad = fixture(() => "red");
  bad.effects.measure = () => ({ verdict: "red", run: "/run/bad", failed: ["build"], reason: "" });
  assert.throws(() => sweep(context, undefined, bad.effects), /invalid/);
  assert.deepEqual(bad.refused, []);
});

test("prefix success cannot itself produce a full-gate or landing proof", () => {
  const f = fixture(() => "green"), result = sweep(context, undefined, f.effects);
  assert.equal(result.state, "ready");
  assert.equal("proof" in result, false); assert.equal("landed" in result, false);
  assert.deepEqual(f.measured, [["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"]]);
});

for (const crash of [false, true]) test(`a refused prerequisite's replay conflict is journaled before disposition (crash=${crash})`, () => {
  const f = fixture(ids => ids.includes("b") ? "red" : "green");
  f.effects.compose = parts => {
    const conflict = parts.find(m => m.id === "c" && !parts.some(other => other.id === "b"));
    const kept = parts.filter(m => m !== conflict);
    return { members: kept, tip: kept.at(-1)?.sha ?? context.base,
      omissions: conflict ? [{ member: conflict, reason: "the prerequisite was refused" }] : [] };
  };
  const apply = f.effects.omit;
  if (crash) {
    f.effects.omit = () => { throw new Error("crashed after conflict journal"); };
    assert.throws(() => sweep(context, undefined, f.effects), /crashed/);
    assert.equal(f.saved()!.events.at(-1)!.kind, "omit");
    f.effects.omit = apply;
  }
  const result = sweep(context, crash ? f.saved() : undefined, f.effects);
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.deepEqual(result.members.map(m => m.id), ["a", "d"]);
  assert.deepEqual(f.refused, ["b"]); assert.deepEqual(f.omitted, ["c"]);
  assert.equal(result.omissions[0]?.reason, "the prerequisite was refused");
  assert.ok(f.measured.every(ids => !ids.includes("c")), "a replay conflict is never measured or blamed as a regression");
});
