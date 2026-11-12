// node --test tooling/full-check/culprit.test.ts
//
// The culprit search over synthetic histories: bisection finds the first red
// commit wherever it is, a known culprit is taken out of the commits before
// its revert, and a red that does not repeat reverts nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bisect, search as searchAtMain, takenOut, type Main, type Measure, type Probe, type SearchInput } from "./culprit.ts";

/** Existing histories keep main at their tip unless a control moves it. */
function search(input: SearchInput, measure: Measure, main: Main = {
  commit: () => input.candidates.at(-1) ?? input.good,
  reaches: () => true,
}) {
  return searchAtMain(input, measure, main);
}

test("bisection finds the first red commit of every history, in logarithmic probes", () => {
  for (let n = 1; n <= 40; n++) {
    for (let first = 0; first < n; first++) {
      let probes = 0;
      const found = bisect(n, index => { probes++; assert.ok(index < n - 1, "the tip is known red"); return index >= first ? "red" : "green"; });
      assert.deepEqual(found, { culprit: first }, `n=${n} first=${first}`);
      assert.ok(probes <= Math.ceil(Math.log2(n)), `n=${n} first=${first}: ${probes} probes`);
    }
  }
});

test("a candidate that cannot be measured is skipped, and a culprit hidden among skips is a range", () => {
  // 0..9, first red at 6; 4 cannot be measured, and a neighbour is taken instead.
  assert.deepEqual(bisect(10, i => i === 4 ? "skip" : i >= 6 ? "red" : "green"), { culprit: 6 });
  // First red at 6 and 5 cannot be measured: 4 is green and 6 red, so it is 5 or 6.
  assert.deepEqual(bisect(10, i => i === 5 ? "skip" : i >= 6 ? "red" : "green"), { range: [5, 6] });
  // Nothing measurable: the whole range.
  assert.deepEqual(bisect(4, () => "skip"), { range: [0, 3] });
});

/**
 * A line of commits c0..c(n-1), some of which break a step. A composition is
 * red on a step when a breaker at or before its base is not taken out.
 */
function model(n: number, breakers: Record<number, string[]>, options: { flakyOnce?: string; unrepeatable?: number } = {}) {
  const candidates = Array.from({ length: n }, (_, i) => `c${i}`.padEnd(40, "0"));
  const index = (sha: string) => candidates.indexOf(sha);
  const calls: { base: number; reverts: number[]; fresh: boolean }[] = [];
  let flaky = options.flakyOnce;
  const measure: Measure = (base, reverts, steps, fresh): Probe => {
    const i = index(base), out = reverts.map(index);
    calls.push({ base: i, reverts: out, fresh });
    const failed = steps.filter(step => Object.entries(breakers).some(([at, broken]) => Number(at) <= i && !out.includes(Number(at)) && broken.includes(step)));
    if (flaky && fresh && failed.includes(flaky)) { failed.splice(failed.indexOf(flaky), 1); flaky = undefined; }
    if (options.unrepeatable === i && fresh) failed.length = 0;
    return { base, reverts, steps, verdict: failed.length ? "red" : "green", failed, run: `run-${calls.length}` };
  };
  const input = (steps: string[], pending: number[] = [], reverted: [number, number][] = []): SearchInput => ({
    good: "g".repeat(40), candidates, steps,
    pending: pending.map(i => candidates[i]!),
    reverted: new Map(reverted.map(([culprit, revert]) => [candidates[culprit]!, candidates[revert]!])),
  });
  return { candidates, measure, calls, input };
}

test("the search confirms the tip, finds the first red commit and confirms it", () => {
  const m = model(12, { 4: ["tests"] });
  const result = search(m.input(["tests"]), m.measure);
  assert.equal(result.kind, "culprit");
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[4]);
  assert.deepEqual(m.calls[0], { base: 11, reverts: [], fresh: true }, "the tip first, measured again");
  assert.deepEqual(m.calls[1], { base: -1, reverts: [], fresh: true }, "then the last green commit, as a control");
  assert.deepEqual(m.calls.at(-1), { base: 4, reverts: [], fresh: true }, "the culprit measured again");
  assert.ok(m.calls.length <= 3 + Math.ceil(Math.log2(12)), `${m.calls.length} probes`);
});

test("a known culprit is taken out, so the one it hid is found next", () => {
  const m = model(10, { 2: ["tests"], 6: ["tests"] });
  const first = search(m.input(["tests"]), m.measure);
  assert.equal(first.kind === "culprit" && first.commit, m.candidates[2]);
  // c2's revert is submitted and not landed: it is taken out from c2 on.
  const second = search(m.input(["tests"], [2]), m.measure);
  assert.equal(second.kind === "culprit" && second.commit, m.candidates[6]);
  // Both pending: the red is explained, nothing new to revert.
  assert.equal(search(m.input(["tests"], [2, 6]), m.measure).kind, "explained");
  // c2's revert landed at c4: from c4 on the history takes it out itself.
  const landed = model(10, { 2: ["tests"], 6: ["tests"] });
  const breakersAfterRevert = (base: string, reverts: string[], steps: string[], fresh: boolean) => {
    const i = landed.candidates.indexOf(base);
    // At and after the revert (c4), c2's change is gone from the tree.
    return landed.measure(base, i >= 4 ? [...reverts, landed.candidates[2]!] : reverts, steps, fresh);
  };
  const third = search(landed.input(["tests"], [], [[2, 4]]), breakersAfterRevert);
  assert.equal(third.kind === "culprit" && third.commit, landed.candidates[6]);
  assert.ok(landed.calls.every(call => call.base < 2 || call.base >= 4 || call.reverts.includes(2)), "c2..c3 are only measured with c2 taken out");
});

test("culprits are taken out from where they are found until their revert", () => {
  const m = model(8, {});
  const input = m.input(["tests"], [5], [[1, 3]]);
  assert.deepEqual(takenOut(input, 0), []);
  assert.deepEqual(takenOut(input, 1), [m.candidates[1]]);
  assert.deepEqual(takenOut(input, 2), [m.candidates[1]]);
  assert.deepEqual(takenOut(input, 3), [], "the revert itself takes c1 out");
  assert.deepEqual(takenOut(input, 5), [m.candidates[5]]);
  assert.deepEqual(takenOut(input, 7), [m.candidates[5]]);
});

test("a red that does not repeat reverts nothing", () => {
  const flaky = model(6, {}, { flakyOnce: "tests" });
  // Nothing breaks tests: the tip's re-measurement is green.
  assert.equal(search(flaky.input(["tests"]), flaky.measure).kind, "flaky");
  const once = model(9, { 3: ["tests"] }, { unrepeatable: 3 });
  const result = search(once.input(["tests"]), once.measure);
  assert.equal(result.kind, "held");
  assert.match(result.kind === "held" ? result.reason : "", /red once and green when measured again/);
});

test("a last green commit that is red now holds the search: the machine, not a commit", () => {
  const m = model(8, { 3: ["tests"] });
  const measure: Measure = (base, reverts, steps, fresh) =>
    base === "g".repeat(40) ? { base, reverts, steps, verdict: "red", failed: steps, run: "control" } : m.measure(base, reverts, steps, fresh);
  const result = search(m.input(["tests"]), measure);
  assert.equal(result.kind, "held");
  assert.match(result.kind === "held" ? result.reason : "", /is red now too: not a commit's doing/);
  assert.equal(m.calls.length, 1, "nothing is bisected");
});

test("only the steps that stayed red are searched; the others are reported flaky", () => {
  const m = model(6, { 2: ["tests"] }, {});
  const result = search(m.input(["tests", "clippy"]), m.measure);
  assert.equal(result.kind, "culprit");
  if (result.kind !== "culprit") return;
  assert.deepEqual(result.failed, ["tests"]);
  assert.deepEqual(result.flaky, ["clippy"]);
});

test("the tip itself can be the culprit, and an empty range holds", () => {
  const m = model(3, { 2: ["tests"] });
  const result = search(m.input(["tests"]), m.measure);
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[2]);
  assert.equal(search({ good: "g".repeat(40), candidates: [], steps: ["tests"], pending: [], reverted: new Map() }, m.measure).kind, "held");
});


test("newest main is probed with known culprits left in, and a fix ends the search", () => {
  const m = model(8, { 2: ["tests"] }), latest = "f".repeat(40);
  const calls: Probe[] = [];
  const result = search(m.input(["tests"], [2]), (base, reverts, steps, fresh) => {
    const p = base === latest
      ? { base, reverts, steps, verdict: "green" as const, failed: [], run: "fix-probe" }
      : m.measure(base, reverts, steps, fresh);
    calls.push(p); return p;
  }, { commit: () => latest, reaches: () => false });
  assert.equal(result.kind, "fixed-forward");
  assert.deepEqual(calls.map(p => [p.base, p.reverts]), [[latest, []]]);
  assert.deepEqual(result.main, { commit: latest, through: latest, run: "fix-probe" });
});

test("a partial fix searches only the steps still red on newest main", () => {
  const m = model(8, { 2: ["tests"], 5: ["clippy"] }), latest = "f".repeat(40);
  const result = search(m.input(["tests", "clippy"]), (base, reverts, steps, fresh) => base === latest
    ? { base, reverts, steps, verdict: "red", failed: ["clippy"], run: "partial-fix" }
    : m.measure(base, reverts, steps, fresh),
  { commit: () => latest, reaches: () => false });
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[5]);
  assert.deepEqual(result.kind === "culprit" && result.failed, ["clippy"]);
  assert.ok(result.probes.slice(1).every(p => p.steps.join() === "clippy"));
});

test("unrelated main changes carry the probe while affected changes require another", () => {
  for (const affected of [false, true]) {
    const m = model(8, { 2: ["tests"] }), latest = "f".repeat(40);
    let tip = m.candidates.at(-1)!;
    const reaches: string[][] = [];
    const result = search(m.input(["tests"]), (base, reverts, steps, fresh) => {
      if (base === latest) return { base, reverts, steps, verdict: "green", failed: [], run: "late-fix" };
      const p = m.measure(base, reverts, steps, fresh);
      if (base === m.candidates[2] && fresh) tip = latest;
      return p;
    }, { commit: () => tip, reaches: (base, next, steps) => { reaches.push([base, next, ...steps]); return affected; } });
    assert.equal(result.kind, affected ? "fixed-forward" : "culprit");
    assert.ok(reaches.length);
    assert.equal(result.probes.filter(p => p.base === latest).length, affected ? 1 : 0);
    assert.equal(result.main?.through, latest);
  }
});

test("two changed-input re-probes bound a busy history, and unknown reach holds closed", () => {
  for (const unknown of [false, true]) {
    const m = model(4, { 1: ["tests"] });
    let tip = "main-0", count = 0;
    const result = search(m.input(["tests"]), (base, reverts, steps) => {
      tip = "main-" + ++count;
      return { base, reverts, steps, verdict: "red", failed: steps, run: "probe-" + count };
    }, { commit: () => tip, reaches: () => { if (unknown) throw Error("selector unavailable"); return true; } });
    assert.equal(result.kind, "held");
    assert.equal(count, unknown ? 1 : 3);
    assert.match(result.kind === "held" ? result.reason : "", unknown ? /could not establish owed reach.*selector unavailable/ : /after 2 fix-forward re-probes; no revert/);
  }
});
