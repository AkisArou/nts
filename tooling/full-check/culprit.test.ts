// node --test tooling/full-check/culprit.test.ts
//
// The culprit search over synthetic histories: bisection finds the first red
// commit wherever it is, a known culprit is taken out of the commits before
// its revert, and a red that does not repeat reverts nothing.
import {censusReport, recordedCensus} from "./census-log-fixture.ts";
import {censusFailureIdentity} from "./measure.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { bisect, search as searchAtMain, takenOut, type Main, type Measure, type Probe, type SearchInput } from "./culprit.ts";

/** Existing histories keep main at their tip unless a control moves it. */
function search(input: SearchInput, measure: Measure, main: Omit<Main, "range"> & Partial<Pick<Main, "range">> = {
  commit: () => input.candidates.at(-1) ?? input.good,
  reaches: () => true,
}) {
  return searchAtMain(input, measure, {
    range: (_good, tip) => ({ candidates: input.candidates.includes(tip) ? input.candidates.slice(0, input.candidates.indexOf(tip) + 1) : [...input.candidates, tip], reverted: input.reverted }),
    ...main,
  });
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
  const candidates = Array.from({ length: n }, (_, i) => `c${i}`.padEnd(40, "f"));
  assert.equal(new Set(candidates).size, n, "every synthetic commit has a distinct identity");
  const index = (sha: string) => candidates.indexOf(sha);
  const calls: { base: number; reverts: number[]; fresh: boolean }[] = [];
  let flaky = options.flakyOnce;
  const measure: Measure = (base, reverts, steps, fresh): Probe => {
    const i = index(base), out = reverts.map(index);
    calls.push({ base: i, reverts: out, fresh });
    const failed = steps.filter(step => Object.entries(breakers).some(([at, broken]) => Number(at) <= i && !out.includes(Number(at)) && broken.includes(step)));
    if (flaky && fresh && failed.includes(flaky)) { failed.splice(failed.indexOf(flaky), 1); flaky = undefined; }
    if (options.unrepeatable === i && fresh) failed.length = 0;
    return { base, reverts, steps, verdict: failed.length ? "red" : "green", failed, failures: Object.fromEntries(failed.map(step => [step, [`${step}: case-a`]])), run: `run-${calls.length}` };
  };
  const input = (steps: string[], pending: number[] = [], reverted: [number, number][] = []): SearchInput => ({
    good: "g".repeat(40), candidates, steps, failures: Object.fromEntries(steps.map(step => [step, [`${step}: case-a`]])),
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

test("unknown reach holds closed after completing the historical decision", () => {
  const m = model(4, { 1: ["tests"] });
  let tip = m.candidates.at(-1)!;
  const result = search(m.input(["tests"]), (...args) => {
    const p = m.measure(...args); tip = "latest"; return p;
  }, { commit: () => tip, reaches: () => { throw Error("selector unavailable"); } });
  assert.equal(result.kind, "held");
  assert.match(result.kind === "held" ? result.reason : "", /could not establish owed reach.*selector unavailable/);
  assert.ok(m.calls.some(call => call.base === 1 && call.fresh));
});


test("a changed-input main probe reuses the complete immutable history for the same steps", () => {
  const m = model(8, { 2: ["tests"] }), latest = "f".repeat(40);
  let tip = m.candidates.at(-1)!, historyAtChange = -1, mainProbes = 0;
  const result = search(m.input(["tests"]), (base, reverts, steps, fresh) => {
    if (base === latest) {
      mainProbes++;
      return { base, reverts, steps, verdict: "red", failed: steps, failures: { tests: ["tests: case-a"] }, run: "main-again" };
    }
    const p = m.measure(base, reverts, steps, fresh);
    if (base === m.candidates[2] && fresh) { tip = latest; historyAtChange = m.calls.length; }
    return p;
  }, { commit: () => tip, reaches: () => true });
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[2]);
  assert.equal(mainProbes, 1);
  assert.ok(historyAtChange > 0);
  assert.equal(m.calls.length, historyAtChange, "the second pass makes no history probes");
});

test("a partial fix during bisection searches the remaining unchanged failure", () => {
  const m = model(8, { 2: ["A"], 5: ["B"] }), latest = "f".repeat(40);
  let tip = m.candidates.at(-1)!, changedAt = -1;
  const requests: { base: string; steps: string[] }[] = [];
  const result = search(m.input(["A","B"]), (base, reverts, steps, fresh) => {
    requests.push({ base, steps });
    if (base === latest) return { base, reverts, steps, verdict: "red", failed: ["B"], failures: { B: ["B: case-a"] }, run: "fix-A" };
    const p = m.measure(base, reverts, steps, fresh);
    if (base === m.candidates[2] && fresh) { tip = latest; changedAt = requests.length; }
    return p;
  }, { commit: () => tip, reaches: () => true });
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[5]);
  assert.deepEqual(result.kind === "culprit" && result.failed, ["B"]);
  assert.ok(changedAt > 0);
  assert.ok(requests.slice(changedAt).filter(p => p.base !== latest).every(p => p.steps.join() === "B"));
  assert.equal(requests.filter(p => p.base === m.input([]).good).length, 1, "the per-step green control is reused");
});


test("three main moves during history extend the range without discarding observations", () => {
  const m = model(32, { 9: ["tests"] });
  const initial = m.input(["tests"]); initial.candidates = m.candidates.slice(0, 16);
  let tip = initial.candidates.at(-1)!, moves = 0;
  const requests: string[] = [], ranges: string[] = [];
  const result = search(initial, (base, reverts, steps, fresh) => {
    requests.push(base);
    const p = m.measure(base, reverts, steps, fresh);
    if (base !== initial.candidates.at(-1) && moves < 3) tip = m.candidates[16 + moves++]!;
    return p;
  }, { commit: () => tip, reaches: () => true, range: (_good, tip) => {
    ranges.push(tip); return { candidates: m.candidates.slice(0, m.candidates.indexOf(tip) + 1), reverted: new Map() };
  } });
  assert.equal(moves, 3);
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[9]);
  assert.deepEqual(ranges, [m.candidates[18]]);
  assert.equal(requests.filter(base => base === initial.good).length, 1, "one fresh green control survives all moves");
  assert.equal(requests.filter(base => base === m.candidates[9]).length, 2, "one ordinary observation and one fresh confirmation");
  assert.equal(requests.at(-1), m.candidates[18], "only the newest decision tip is probed");
  assert.ok(requests.length <= Math.ceil(Math.log2(16)) + 4);
  assert.equal(result.main?.through, tip);
});

test("decision tips require the same complete per-step failure identity", () => {
  for (const identity of [["tests: case-a"], ["tests: case-b"], undefined]) {
    const m = model(8, { 2: ["tests"] }), latest = "latest";
    let tip = m.candidates.at(-1)!;
    const result = search(m.input(["tests"]), (base, reverts, steps, fresh) => {
      if (base === latest) return { base, reverts, steps, verdict: "red", failed: steps, failures: identity ? { tests: identity } : {}, run: "decision" };
      const p = m.measure(base, reverts, steps, fresh);
      if (base === m.candidates[2] && fresh) tip = latest;
      return p;
    }, { commit: () => tip, reaches: () => true });
    assert.equal(result.kind, identity?.[0] === "tests: case-a" ? "culprit" : "held");
    if (result.kind === "held") assert.match(result.reason, identity ? /changed the failure identity/ : /identity unavailable/);
  }
});

test("decision probe movement is finite and carries only proven unaffected inputs", () => {
  for (const movement of ["none", "unrelated", "affected", "unknown"] as const) {
    const m = model(16, { 4: ["tests"] });
    let tip = m.candidates.at(-1)!, probes = 0;
    const result = search(m.input(["tests"]), (base, reverts, steps, fresh) => {
      probes++;
      const p = base.startsWith("main-")
        ? { base, reverts, steps, verdict: "red" as const, failed: steps, failures: { tests: ["tests: case-a"] }, run: "decision" }
        : m.measure(base, reverts, steps, fresh);
      // Even an adversary moving main after EVERY probe cannot restart history.
      if (movement !== "none") tip = `main-${probes}`;
      return p;
    }, { commit: () => tip, reaches: (base) => {
      if (!base.startsWith("main-")) return true;
      if (movement === "unknown") throw Error("unknown reach");
      return movement === "affected";
    } });
    assert.equal(result.kind, movement === "affected" || movement === "unknown" ? "held" : "culprit");
    if (result.kind === "held") assert.match(result.reason, /main changed during decision probe; identity at current tip unmeasured/);
    assert.ok(probes <= Math.ceil(Math.log2(16)) + 4, `${movement}: ${probes}`);
    assert.equal(result.probes.length, probes, "all original measurement receipts survive");
  }
});

test("a non-extension of first-parent history holds instead of naming an old culprit", () => {
  const m = model(8, { 2: ["tests"] });
  const result = search(m.input(["tests"]), m.measure, {
    commit: () => m.candidates.at(-1)!, reaches: () => true,
    range: () => { throw Error("must not refresh an unchanged range"); },
  });
  assert.equal(result.kind, "culprit");
  let tip = m.candidates.at(-1)!;
  const held = search(m.input(["tests"]), (base, reverts, steps, fresh) => {
    const p = base === "rewrite" ? { base, reverts, steps, verdict: "red" as const, failed: steps, failures: { tests: ["tests: case-a"] }, run: "rewrite" } : m.measure(base, reverts, steps, fresh);
    tip = "rewrite"; return p;
  }, { commit: () => tip, reaches: () => true, range: () => ({ candidates: ["rewrite"], reverted: new Map() }) });
  assert.equal(held.kind, "held");
  assert.match(held.kind === "held" ? held.reason : "", /does not extend the first-parent/);
});


test("a newly failed step at the decision tip holds", () => {
  const m = model(8, { 2: ["A"] }); let tip = m.candidates.at(-1)!;
  const result = search(m.input(["A", "B"]), (base, reverts, steps, fresh) => {
    if (base === "latest") return { base, reverts, steps, verdict: "red", failed: steps, failures: { A: ["A: case-a"], B: ["B: case-a"] }, run: "decision" };
    const p = m.measure(base, reverts, steps, fresh); tip = "latest"; return p;
  }, { commit: () => tip, reaches: () => true });
  assert.equal(result.kind, "held");
  assert.match(result.kind === "held" ? result.reason : "", /added a failed step/);
});

test("an initial newer main extends only the original run's matching identities", () => {
  const m = model(16, { 2: ["tests"] }), input = m.input(["tests"]);
  input.candidates = m.candidates.slice(0, 8);
  const result = search(input, m.measure, { commit: () => m.candidates.at(-1)!, reaches: () => true,
    range: () => ({ candidates: m.candidates, reverted: new Map() }) });
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[2]);
  assert.deepEqual("range" in result && result.range, {tip: m.candidates[15], candidates: 16});
});

test("an initial newer main cannot turn an original flake into a later culprit", () => {
  const m = model(16, { 12: ["tests"] }), input = m.input(["tests"]);
  input.candidates = m.candidates.slice(0, 8); delete input.failures;
  const result = search(input, m.measure, {commit: () => m.candidates[15]!, reaches: () => true,
    range: () => { throw Error("an unknown identity cannot extend the range"); }});
  assert.equal(result.kind, "flaky");
  assert.ok(m.calls.some(p => p.base === 7 && p.fresh), "confirm the original tip, not the later defect's tip");
});

test("a known initial identity change confirms the original tip, preserves flakes and otherwise holds with both identities", () => {
  for (const originalRed of [false, true]) {
    const m = model(16, originalRed ? {2: ["tests"]} : {}), input = m.input(["tests"]);
    input.candidates = m.candidates.slice(0, 8);
    const result = search(input, (base, reverts, steps, fresh) => base === m.candidates[15]
      ? {base, reverts, steps, verdict: "red", failed: steps, failures: {tests: ["tests: case-y"]}, run: "newest-y"}
      : m.measure(base, reverts, steps, fresh),
    {commit: () => m.candidates[15]!, reaches: () => true, range: () => { throw Error("changed identity cannot extend"); }});
    assert.equal(result.kind, originalRed ? "held" : "flaky");
    assert.ok(m.calls.some(p => p.base === 7 && p.fresh));
    if (result.kind === "held") assert.match(result.reason, /old .*case-a.*current .*case-y/);
  }
});

test("missing original identity keeps an old-range finding and a named note even as main moves again", () => {
  const m = model(20, {2: ["tests"]}), input = m.input(["tests"]);
  input.candidates = m.candidates.slice(0, 8); delete input.failures;
  let tip = m.candidates[15]!;
  const result = search(input, (...args) => {
    const p = m.measure(...args); delete p.failures;
    if (p.base === m.candidates[2] && args[3]) tip = m.candidates[19]!;
    return p;
  }, {commit: () => tip, reaches: () => true, range: () => { throw Error("no identity means no extension"); }});
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[2]);
  assert.deepEqual("range" in result && result.range, {tip: m.candidates[7], candidates: 8});
  assert.equal("note" in result && result.note, "no failure identity for tests: range not extended");
});

test("an initial narrowed failed-step set extends when its remaining identity is unchanged", () => {
  const m = model(16, {2: ["A"], 5: ["B"]}), input = m.input(["A", "B"]);
  input.candidates = m.candidates.slice(0, 8);
  const requests: {base: string; steps: string[]}[] = [];
  const result = search(input, (base, reverts, steps, fresh) => {
    requests.push({base, steps});
    if (base === m.candidates[15]) return {base, reverts, steps, verdict: "red", failed: ["B"], failures: {B: ["B: case-a"]}, run: "narrowed"};
    return m.measure(base, reverts, steps, fresh);
  }, {commit: () => m.candidates[15]!, reaches: () => true, range: () => ({candidates: m.candidates, reverted: new Map()})});
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[5]);
  assert.deepEqual(result.kind === "culprit" && result.failed, ["B"]);
  assert.deepEqual("range" in result && result.range, {tip: m.candidates[15], candidates: 16});
  assert.ok(requests.slice(1).every(p => p.steps.join() === "B"));
});



test("a newly landed revert refreshes historical compositions before retaining a culprit", () => {
  const m = model(10, { 2: ["tests"], 6: ["tests"] }), input = m.input(["tests"]);
  input.candidates = m.candidates.slice(0, 8);
  let tip = input.candidates.at(-1)!, extendedAt = -1;
  const result = search(input, (base, reverts, steps, fresh) => {
    const index = m.candidates.indexOf(base);
    const p = m.measure(base, index >= 8 ? [...reverts, m.candidates[2]!] : reverts, steps, fresh);
    if (base === m.candidates[2] && fresh && tip === input.candidates.at(-1)) tip = m.candidates[9]!;
    return p;
  }, { commit: () => tip, reaches: () => true, range: () => {
    extendedAt = m.calls.length;
    return { candidates: m.candidates, reverted: new Map([[m.candidates[2]!, m.candidates[8]!]]) };
  } });
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[6]);
  assert.ok(extendedAt > 0);
  assert.ok(m.calls.slice(extendedAt).filter(call => call.base >= 2 && call.base < 8).every(call => call.reverts.includes(2)),
    "newly known culprit removal changes the composition key, so old red observations cannot be reused");
});


test("initial range extension uses identities carried by the real C census filter", t => {
  const step = "test262-cases", raw = censusReport(["test/split/separator-undef.js: pass -> no-verdict (crash)"]);
  const filtered = recordedCensus(t, raw); assert.equal(filtered.status, 1);
  const identity = censusFailureIdentity(filtered.stdout); assert.ok(identity, "C step output must retain its identity");
  const m = model(16, {2: [step]}), input = m.input([step]);
  input.candidates = m.candidates.slice(0, 8); input.failures = {[step]: identity};
  let extensions = 0;
  const result = search(input, (...args) => {
    const p = m.measure(...args);
    if (p.failed.length) p.failures = {[step]: identity};
    return p;
  }, {commit: () => m.candidates[15]!, reaches: () => true, range: () => {
    extensions++; return {candidates: m.candidates, reverted: new Map()};
  }});
  assert.equal(result.kind === "culprit" && result.commit, m.candidates[2]);
  assert.equal(extensions, 1, "the C record's preserved original identity authorizes the extension");
  assert.deepEqual("range" in result && result.range, {tip: m.candidates[15], candidates: 16});
});

test("a known initial identity change cannot be masked by another step's missing detail", () => {
  const reasons: string[] = [];
  for (const steps of [["A", "B"], ["B", "A"]]) {
    const m = model(16, {2: ["A"], 5: ["B"]}), input = m.input(steps);
    input.candidates = m.candidates.slice(0, 8); input.failures = {B: ["B: case-a"]};
    const result = search(input, (...args) => {
      const p = m.measure(...args);
      if (p.failed.includes("B")) p.failures = {B: [p.base === m.candidates[15] ? "B: case-y" : "B: case-a"]};
      else p.failures = {};
      return p;
  }, {commit: () => m.candidates[15]!, reaches: () => true, range: () => { throw Error("must not extend"); }});
  assert.equal(result.kind, "held");
  assert.match(result.kind === "held" ? result.reason : "", /identity for B: old .*case-a.*current .*case-y/);
  reasons.push(result.reason);
  }
  assert.equal(reasons[0], reasons[1], "step order does not change the verdict or explanation");
});

test("a known decision identity change cannot be masked by the original-range missing-detail fallback", () => {
  const reasons: string[] = [];
  for (const steps of [["A", "B"], ["B", "A"]]) {
    const m = model(20, {2: ["A"], 5: ["B"]}), input = m.input(steps);
    input.candidates = m.candidates.slice(0, 8); input.failures = {B: ["B: case-a"]};
    let tip = m.candidates[15]!;
    const result = search(input, (...args) => {
      const p = m.measure(...args);
      p.failures = p.failed.includes("B") ? {B: [p.base === m.candidates[19] ? "B: case-y" : "B: case-a"]} : {};
      if (p.base === m.candidates[2] && args[3]) tip = m.candidates[19]!;
      return p;
  }, {commit: () => tip, reaches: () => true, range: () => { throw Error("must keep the original range"); }});
  assert.equal(result.kind, "held");
  assert.match(result.kind === "held" ? result.reason : "", /identity for B: old .*case-a.*current .*case-y/);
  reasons.push(result.reason);
  }
  assert.equal(reasons[0], reasons[1], "step order does not change the verdict or explanation");
});
