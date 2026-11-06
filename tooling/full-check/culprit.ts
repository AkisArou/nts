// The culprit search: the first red commit among those since a part's last
// green run, found by bisection over main's first parents.
//
// It is the prefix replay of tooling/lanes/train-attribution on a line instead
// of a train: a candidate is measured with every culprit already found taken
// out of it (reverted on top, in the object store), so one culprit cannot hide
// another behind it. A culprit is known from two places: a revert of it in the
// range (from then on the history itself takes it out), and the service's own
// record of the reverts it has submitted and that have not landed yet.
//
// Four probes guard the verdict, because a revert of a good commit costs more
// than a red that waits for the next run:
//   - the tip is measured again first, with the known culprits taken out:
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
};

export type Measure = (base: string, reverts: string[], steps: string[], fresh: boolean) => Probe;

export type SearchInput = {
  /** The last commit the part was green at. */
  good: string;
  /** The first-parent commits after `good`, oldest first; the last is the red tip. */
  candidates: string[];
  /** The steps the tip's run failed. */
  steps: string[];
  /** Culprits already found whose reverts have not landed (the service's record). */
  pending: string[];
  /** Culprits the range itself reverts: culprit -> its first revert in the range. */
  reverted: Map<string, string>;
};

export type SearchResult =
  | { kind: "culprit"; commit: string; index: number; failed: string[]; flaky: string[]; probes: Probe[] }
  | { kind: "ambiguous"; commits: string[]; failed: string[]; probes: Probe[] }
  | { kind: "explained"; probes: Probe[] }
  | { kind: "flaky"; probes: Probe[] }
  | { kind: "held"; reason: string; probes: Probe[] };

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

export function search(input: SearchInput, measure: Measure): SearchResult {
  const probes: Probe[] = [];
  const n = input.candidates.length;
  const tip = input.candidates[n - 1];
  if (!tip) return { kind: "held", reason: "no commit since the last green run: the red is not a commit's", probes };
  const outAtTip = takenOut(input, n - 1);
  const confirm = measure(tip, outAtTip, input.steps, true);
  probes.push(confirm);
  if (confirm.verdict === "skip") return { kind: "held", reason: `the tip could not be measured again: ${confirm.reason ?? "no verdict"}`, probes };
  if (confirm.verdict === "green") return { kind: outAtTip.length ? "explained" : "flaky", probes };
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
  if (found.culprit !== n - 1) {
    const again = measure(commit, takenOut(input, found.culprit), failed, true);
    probes.push(again);
    if (again.verdict !== "red") {
      return { kind: "held", reason: `${commit.slice(0, 12)} was red once and ${again.verdict === "green" ? "green" : "unmeasurable"} when measured again`, probes };
    }
  }
  return { kind: "culprit", commit, index: found.culprit, failed, flaky, probes };
}
