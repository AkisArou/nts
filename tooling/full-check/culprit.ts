// The culprit search: the first red commit among those since a part's last
// green run, found by bisection over main's first parents.
//
// A candidate is measured with every culprit already found taken out of it
// (reverted on top, in the object store), so one culprit cannot hide another
// behind it. A culprit is known from two places: a revert of it in the
// range (from then on the history itself takes it out), and the service's own
// record of the reverts it has submitted and that have not landed yet.
//
// Observations guard the verdict, because a revert of a good commit costs more
// than a red that waits for the next run:
//   - newest main is measured as-is: a fixed-forward green reverts nothing,
//     and only steps still red enter the historical search. Its observations
//     are retained per step within this search, never across searches;
//   - the tip is measured again, with the known culprits taken out:
//     green means the red is explained (their reverts are on the way) or did
//     not repeat (flaky), and nothing is reverted;
//   - the last green commit is measured again: red there too is the machine
//     or the world (a full disk, an expired certificate), not a commit, and
//     the search holds;
//   - a culprit that is not the tip is measured again: a red that does not
//     repeat holds the search instead of reverting on one sample;
//   - a candidate that cannot be measured (a revert that does not apply, a
//     step that did not complete) is skipped, as `git bisect skip` does, and a
//     culprit hidden among skipped candidates is reported as a range.

export type ProbeVerdict = "red" | "green" | "skip";

/** One measurement: a base commit with culprits reverted on top, on some steps. */
export type Probe = {
  base: string;
  reverts: string[];
  steps: string[];
  verdict: ProbeVerdict;
  failed: string[];
  run: string;
  reason?: string;
  /** The step-owned canonical regression detail; absence is unknown. */
  failures?: Record<string, string[]>;
};

export type Measure = (base: string, reverts: string[], steps: string[], fresh: boolean) => Probe;

export type SearchInput = {
  /** The last commit the part was green at. */
  good: string;
  /** The first-parent commits after `good`, oldest first; the last is the red tip. */
  candidates: string[];
  /** The steps the tip's run failed. */
  steps: string[];
  /** The original red run's step-owned identities; absent detail cannot extend its range. */
  failures?: Record<string, string[]>;
  /** Culprits already found whose reverts have not landed (the service's record). */
  pending: string[];
  /** Culprits the range itself reverts: culprit -> its first revert in the range. */
  reverted: Map<string, string>;
};

export type MainProbe = { commit: string; through: string; run: string };
type HistoryResult =
  | { kind: "culprit"; commit: string; index: number; failed: string[]; flaky: string[]; probes: Probe[] }
  | { kind: "ambiguous"; commits: string[]; failed: string[]; probes: Probe[] }
  | { kind: "explained"; probes: Probe[] }
  | { kind: "flaky"; probes: Probe[] }
  | { kind: "held"; reason: string; probes: Probe[] };
export type SearchResult = (HistoryResult & { main?: MainProbe; range?: { tip: string; candidates: number }; note?: string })
  | { kind: "fixed-forward"; commit: string; through: string; probes: Probe[]; main: MainProbe };

/** Main is observed at each decision, not frozen when an older run began. */
export type Main = {
  commit(): string;
  /** The endpoint-union owed rules, including wide reach. Unknown reach throws. */
  reaches(base: string, tip: string, steps: string[]): boolean;
  /** The complete first-parent range and its reverted culprits at this immutable tip. */
  range(good: string, tip: string): Pick<SearchInput, "candidates" | "reverted">;
};

/**
 * The first red index of `n` candidates, where index -1 (the last green run)
 * is green and index n-1 (the tip) is red. Under the usual assumption that a
 * part stays red from the commit that broke it, that is the commit that broke
 * it. Skipped candidates between the last green and the first red leave a
 * range.
 */
export function bisect(n: number, probe: (index: number) => ProbeVerdict): { culprit: number } | { range: [number, number] } {
  let green = -1, red = n - 1;
  const skipped = new Set<number>();
  for (;;) {
    const open: number[] = [];
    for (let index = green + 1; index < red; index++) if (!skipped.has(index)) open.push(index);
    if (open.length === 0) break;
    const middle = (green + red) / 2;
    const next = open.reduce((best, index) => Math.abs(index - middle) < Math.abs(best - middle) ? index : best);
    const verdict = probe(next);
    if (verdict === "red") red = next;
    else if (verdict === "green") green = next;
    else skipped.add(next);
  }
  return red - green === 1 ? { culprit: red } : { range: [green + 1, red] };
}

/** The culprits to take out of candidate `index`: found at or before it, and not yet reverted by it. */
export function takenOut(input: SearchInput, index: number): string[] {
  const at = new Map(input.candidates.map((sha, i) => [sha, i]));
  const known = [...new Set([...input.pending, ...input.reverted.keys()])];
  return known
    .filter(culprit => {
      const found = at.get(culprit);
      if (found === undefined || found > index) return false;
      const revert = input.reverted.get(culprit);
      return revert === undefined || at.get(revert)! > index;
    })
    .sort((a, b) => at.get(a)! - at.get(b)!);
}

export function search(input: SearchInput, measure: Measure, main: Main): SearchResult {
  const probes: Probe[] = [];
  if (!input.candidates.length) return { kind: "held", reason: "no commit since the last green run: the red is not a commit's", probes };
  const observations = new Map<string, Map<string, { verdict: "red" | "green"; fresh: boolean; failure?: string[] }>>();
  const observationKey = (base: string, reverts: string[]) => JSON.stringify([base, [...reverts].sort()]);
  const remember = (p: Probe, fresh: boolean) => {
    const key = observationKey(p.base, p.reverts), entries = observations.get(key) ?? new Map();
    for (const step of p.steps) {
      // A red union may also contain held steps. Only an explicitly failed
      // step, or a wholly green probe, establishes an individual verdict.
      if (p.failed.includes(step)) entries.set(step, { verdict: "red", fresh, failure: p.failures?.[step] });
      else if (p.verdict === "green") entries.set(step, { verdict: "green", fresh });
    }
    observations.set(key, entries);
  };
  const historical: Measure = (base, reverts, steps, fresh) => {
    const known = steps.map(step => observations.get(observationKey(base, reverts))?.get(step));
    if (known.every(p => p && (!fresh || p.fresh))) {
      const failed = steps.filter((_, index) => known[index]!.verdict === "red");
      // The original measured probes below retain all provenance. This is an
      // in-process decision assembled from them, never a new run receipt.
      return { base, reverts, steps, verdict: failed.length ? "red" : "green", failed, run: "", failures: Object.fromEntries(steps.flatMap((step, index) => known[index]?.failure ? [[step, known[index]!.failure!]] : [])) };
    }
    const p = measure(base, reverts, steps, fresh);
    probes.push(p); remember(p, fresh);
    return p;
  };
  const held = (reason: string): SearchResult => ({ kind: "held", reason, probes });
  let range = input;
  const extend = (tip: string): string | undefined => {
    if (tip === range.candidates.at(-1)) return;
    try {
      const next = main.range(input.good, tip);
      if (next.candidates.at(-1) !== tip || next.candidates.length <= range.candidates.length ||
          !range.candidates.every((commit, index) => next.candidates[index] === commit)) {
        return `newest main ${tip.slice(0, 12)} does not extend the first-parent candidate range`;
      }
      range = { ...range, ...next };
    } catch (error) { return `could not extend the first-parent candidate range: ${String(error)}`; }
    return undefined;
  };
  const compare = (before: string[], failures: Record<string, string[]> | undefined, after: Probe): { kind: "missing" | "changed"; reason: string } | undefined => {
    const changed: string[] = [], missing: string[] = [];
    for (const step of [...new Set(after.failed)].sort()) {
      if (!before.includes(step)) { changed.push(`newest main added a failed step ${step}`); continue; }
      const was = failures?.[step], now = after.failures?.[step];
      if (!was?.length || !now?.length) { missing.push(step); continue; }
      const oldIdentity = JSON.stringify([...new Set(was)].sort()), currentIdentity = JSON.stringify([...new Set(now)].sort());
      if (oldIdentity !== currentIdentity) changed.push(`newest main changed the failure identity for ${step}: old ${oldIdentity}, current ${currentIdentity}`);
    }
    if (changed.length) return { kind: "changed", reason: changed.join("; ") };
    if (missing.length) return { kind: "missing", reason: `no failure identity for ${missing.join(", ")}: range not extended` };
    return undefined;
  };
  let note: string | undefined;
  let originalRangeOnly = false;
  const newest = main.commit();
  const current = measure(newest, [], input.steps, true);
  probes.push(current); remember(current, true);
  if (current.verdict === "skip") return held(`newest main ${newest.slice(0, 12)} could not be measured: ${current.reason ?? "no verdict"}`);
  const green = (p: Probe, through: string): SearchResult => p.base === input.candidates.at(-1)
    ? { kind: "flaky", probes, main: { commit: p.base, through, run: p.run } }
    : { kind: "fixed-forward", commit: p.base, through, probes, main: { commit: p.base, through, run: p.run } };
  let result: HistoryResult;
  if (current.verdict === "green") result = { kind: "flaky", probes: [] };
  else {
    const steps = input.steps.filter(step => current.failed.includes(step));
    if (!steps.length) return held(`newest main ${newest.slice(0, 12)} was red without naming a failed step`);
    const initialChange = newest === input.candidates.at(-1) ? undefined : compare(input.steps, input.failures, current);
    if (!initialChange) {
      const error = extend(newest);
      if (error) return held(error);
    } else {
      originalRangeOnly = true;
      if (initialChange.kind === "missing") note = initialChange.reason;
    }
    // A different or unknown initial identity cannot move the historical tip.
    // Confirm that original tip freshly: a flake must stay a flake.
    result = searchHistory({ ...range, steps }, historical, current, initialChange?.kind === "changed" ? initialChange.reason : undefined);
    if (initialChange?.kind === "changed" && result.kind === "held") return { ...result, probes };
    if (result.kind === "culprit") result.flaky = [...new Set([...result.flaky, ...input.steps.filter(step => !steps.includes(step))])];
  }
  let deciding = current;
  let through = main.commit();
  if (through !== newest) {
    let affected: boolean;
    try { affected = main.reaches(newest, through, input.steps); }
    catch (error) { return held(`could not establish owed reach after main probe ${newest.slice(0, 12)}: ${String(error)}`); }
    if (affected) {
      // One newest-tip measurement per historical decision. If affected main
      // moves during it, hold with all observations retained for the next cycle.
      deciding = measure(through, [], input.steps, true);
      probes.push(deciding); remember(deciding, true);
      if (deciding.verdict === "skip") return held(`newest main ${through.slice(0, 12)} could not be measured: ${deciding.reason ?? "no verdict"}`);
      if (deciding.verdict === "red") {
        const before = [...current.failed].sort(), after = [...deciding.failed].sort();
        if (!after.length) return held(`newest main ${deciding.base.slice(0, 12)} was red without naming a failed step`);
        if (current.verdict !== "red") return held("newest main added a failed step");
        const change = compare(before, current.failures, deciding);
        if (change && !(originalRangeOnly && change.kind === "missing")) return held(change.kind === "missing" ? `failure identity unavailable: ${change.reason}` : change.reason);
        if (change?.kind === "missing" && originalRangeOnly) note = change.reason;
        const previousReverts = JSON.stringify([...range.reverted].sort());
        const error = originalRangeOnly ? undefined : extend(deciding.base);
        if (error) return held(error);
        const changedCompositions = previousReverts !== JSON.stringify([...range.reverted].sort());
        if (changedCompositions || after.length < before.length) {
          if (!changedCompositions && result.kind === "culprit" && result.failed.some(step => after.includes(step))) {
            result = { ...result, failed: result.failed.filter(step => after.includes(step)) };
          } else result = searchHistory({ ...range, steps: after }, historical, deciding);
        }
      }
      through = main.commit();
      if (through !== deciding.base) {
        try {
          if (main.reaches(deciding.base, through, input.steps)) return held("main changed during decision probe; identity at current tip unmeasured");
        } catch (error) { return held(`main changed during decision probe; identity at current tip unmeasured: ${String(error)}`); }
      }
    }
  }
  if (deciding.verdict === "green") return green(deciding, through);
  return { ...result, probes, main: { commit: deciding.base, through, run: deciding.run },
    range: { tip: range.candidates.at(-1)!, candidates: range.candidates.length }, ...(note ? { note } : {}) };
}

/** Bisection only sees steps that still fail on main with culprits left in. */
function searchHistory(input: SearchInput, measure: Measure, current: Probe, changedIdentity?: string): HistoryResult {
  const probes: Probe[] = [];
  const n = input.candidates.length;
  const tip = input.candidates[n - 1];
  if (!tip) return { kind: "held", reason: "no commit since the last green run: the red is not a commit's", probes };
  const outAtTip = takenOut(input, n - 1);
  const confirm = tip === current.base && !outAtTip.length ? current : measure(tip, outAtTip, input.steps, true);
  probes.push(confirm);
  if (confirm.verdict === "skip") return { kind: "held", reason: `the tip could not be measured again: ${confirm.reason ?? "no verdict"}`, probes };
  if (confirm.verdict === "green") return { kind: outAtTip.length ? "explained" : "flaky", probes };
  if (changedIdentity) return { kind: "held", reason: changedIdentity, probes };
  const failed = input.steps.filter(step => confirm.failed.includes(step));
  const flaky = input.steps.filter(step => !confirm.failed.includes(step));
  const control = measure(input.good, [], failed, true);
  probes.push(control);
  if (control.verdict !== "green") {
    return { kind: "held", reason: control.verdict === "red"
      ? `the last green commit ${input.good.slice(0, 12)} is red now too: not a commit's doing`
      : `the last green commit ${input.good.slice(0, 12)} could not be measured again: ${control.reason ?? "no verdict"}`, probes };
  }
  const found = bisect(n, index => {
    if (index === n - 1) return "red";
    const probe = measure(input.candidates[index]!, takenOut(input, index), failed, false);
    probes.push(probe);
    return probe.verdict;
  });
  if ("range" in found) {
    return { kind: "ambiguous", commits: input.candidates.slice(found.range[0], found.range[1] + 1), failed, probes };
  }
  const commit = input.candidates[found.culprit]!;
  let culpritFailed = failed;
  if (found.culprit !== n - 1) {
    const again = measure(commit, takenOut(input, found.culprit), failed, true);
    probes.push(again);
    culpritFailed = failed.filter(step => again.failed.includes(step));
    if (again.verdict !== "red" || !culpritFailed.length) {
      return { kind: "held", reason: `${commit.slice(0, 12)} was red once and ${again.verdict === "green" ? "green" : "unmeasurable"} when measured again`, probes };
    }
  }
  return { kind: "culprit", commit, index: found.culprit, failed: culpritFailed, flaky, probes };
}
