// Preserve completed evidence while retrying instruments on the frozen tip.
export type StepResult = { name: string; verdict: string; reason?: string; [key: string]: unknown };
export type Attempt = { summary: { requested: string[]; steps: StepResult[]; identities: any; environment: any; [key: string]: any }; run: string; status: number | null; signal?: string | null; error?: unknown };
export function needsOperatorHold(row: StepResult): boolean {
  const instrument=row.instrument as {kind?:string;verdict?:string}|undefined;
  return row.verdict==="INSTRUMENT" && instrument?.kind!=="memory-pressure"
    || row.verdict==="NOT RUN" && instrument?.kind==="hung";
}
export function retryInstruments(first: Attempt, invoke: (steps: string[], attempt: number) => Attempt, hold: (rows: StepResult[]) => void): Attempt {
  let current = first;
  const requested = first.summary.requested;
  const rows = new Map(first.summary.steps.map(row => [row.name, row]));
  let wall = Number(first.summary.wall_s ?? 0);
  const attempts = [{ run: first.run, steps: requested }];
  for (;;) {
    // A hung/broken instrument or a contradictory retry needs an operator.
    // Memory admission cannot repair those, and unrelated trains may proceed.
    if([...rows.values()].some(needsOperatorHold))break;
    const instruments = [...rows.values()].filter(row => row.verdict === "INSTRUMENT");
    if (!instruments.length) break;
    hold(instruments);
    const retry = requested.filter(name => ["INSTRUMENT", "NOT RUN"].includes(rows.get(name)?.verdict ?? "NOT RUN"));
    const next = invoke(retry, attempts.length + 1);
    if (!next.summary || next.summary.identities?.commit !== first.summary.identities?.commit
        || next.summary.identities?.nts?.sha256 !== first.summary.identities?.nts?.sha256
        || next.summary.environment?.canonical !== true
        || JSON.stringify(next.summary.environment?.host) !== JSON.stringify(first.summary.environment?.host)) {
      for (const name of retry) rows.set(name, { name, verdict: "INSTRUMENT", reason: "retry lacks the frozen compiler, commit or canonical host identity" });
      attempts.push({ run: next.run, steps: retry });
      continue;
    }
    for (const name of retry) if (!next.summary.steps.some(row => row.name === name)) rows.set(name, { name, verdict: "INSTRUMENT", reason: "instrument retry omitted its requested step" });
    for (const row of next.summary.steps) if (retry.includes(row.name)) rows.set(row.name, { ...row, evidence_run: next.run });
    attempts.push({ run: next.run, steps: retry });
    wall += Number(next.summary.wall_s ?? 0);
    current = next;
  }
  if (attempts.length === 1) return first;
  const steps = requested.map(name => rows.get(name)!);
  const green = steps.every(row => row.verdict === "PASS" || (row.verdict === "SKIPPED" && row.accepted === true));
  return { ...current, run: first.run, summary: { ...first.summary, steps, verdict: green ? "green" : "red", attempts,
    wall_s: wall } };
}
