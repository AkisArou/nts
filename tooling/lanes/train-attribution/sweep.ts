// Prefix PASS is attribution evidence only. The caller must gate the complete
// survivor composition before it can publish a landing proof.
export type Member = { id: string; sha: string };
export type Identity = { base: string; tip: string; members: Member[]; steps: string[]; original_run: string; red_decided_at: string };
export type Measurement = { verdict: "green" | "red" | "held"; run: string; failed: string[]; reason: string };
type Started = { kind: "start"; members: string[]; tip: string; at: string };
type Completed = { kind: "complete"; result: Measurement; at: string };
export type Omission = { member: Member; reason: string; disposition?: "withdrawn" };
type Omitted = { kind: "omit"; omissions: Omission[]; at: string };
export type Journal = { version: 1; identity: Identity; events: (Started | Completed | Omitted)[] };
type Refusal = { member: Member; result: Measurement };
type State = { active: Member[]; cursor: number; pending?: Started; held?: Measurement; refusals: Refusal[]; omissions: Omission[] };
export type SweepResult = { journal: Journal } & (
  { state: "ready"; members: Member[]; tip: string; refusals: Refusal[]; omissions: Omission[] }
  | { state: "held"; run: string; reason: string }
);

const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: string[]) => JSON.stringify(Object.keys(x).sort()) === JSON.stringify([...keys].sort());
const hash = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{40}$/.test(x);
const nonempty = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const names = (x: unknown): x is string[] => Array.isArray(x) && x.every(nonempty) && new Set(x).size === x.length;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const time = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const member = (x: unknown): x is Member => object(x) && exact(x, ["id", "sha"]) && nonempty(x.id) && hash(x.sha);

function identity(value: unknown): asserts value is Identity {
  if (!object(value) || !exact(value, ["base", "tip", "members", "steps", "original_run", "red_decided_at"])
      || !hash(value.base) || !hash(value.tip) || !Array.isArray(value.members) || value.members.length < 2
      || value.members.some(m => !member(m))
      || new Set(value.members.map(m => (m as Member).id)).size !== value.members.length
      || !names(value.steps) || !value.steps.length || !nonempty(value.original_run) || !time(value.red_decided_at)) throw new Error("invalid attribution identity");
}

function measurement(value: unknown, steps: string[]): asserts value is Measurement {
  if (!object(value) || !exact(value, ["verdict", "run", "failed", "reason"])
      || !["green", "red", "held"].includes(String(value.verdict)) || !nonempty(value.run) || typeof value.reason !== "string"
      || !names(value.failed) || value.failed.some(name => !steps.includes(name))
      || (value.verdict === "red" ? !value.failed.length : value.failed.length !== 0)) throw new Error("invalid attribution measurement");
}

/** Derive progress from closed events; never trust a saved cursor or active set. */
function replay(journal: Journal): State {
  const state: State = { active: [...journal.identity.members], cursor: 0, refusals: [], omissions: [] };
  let last = journal.identity.red_decided_at;
  for (const event of journal.events) {
    if (!object(event) || !time(event.at) || event.at < last || state.held) throw new Error("invalid attribution event order");
    last = event.at;
    if (event.kind === "start") {
      if (!exact(event, ["kind", "members", "tip", "at"]) || state.pending || state.cursor >= state.active.length
          || !hash(event.tip) || !names(event.members)
          || !same(event.members, state.active.slice(0, state.cursor + 1).map(m => m.id))) throw new Error("invalid attribution prefix");
      state.pending = event;
    } else if (event.kind === "complete") {
      if (!exact(event, ["kind", "result", "at"]) || !state.pending) throw new Error("attribution completion has no pending prefix");
      measurement(event.result, journal.identity.steps);
      state.pending = undefined;
      if (event.result.verdict === "held") state.held = event.result;
      else if (event.result.verdict === "green") state.cursor++;
      else {
        const member = state.active[state.cursor]!;
        state.refusals.push({ member, result: event.result });
        state.active = state.active.filter(m => m.id !== member.id);
        // Earlier prefixes have exactly the same members and base. Only the
        // culprit and later prefixes need a new composition/measurement.
      }
    } else if (event.kind === "omit") {
      const prefix = state.active.slice(0, state.cursor + 1);
      if (!exact(event, ["kind", "omissions", "at"]) || state.pending || !Array.isArray(event.omissions) || !event.omissions.length
          || event.omissions.some(row => !object(row) || !exact(row, row.disposition === undefined ? ["member", "reason"] : ["member", "reason", "disposition"])
            || row.disposition !== undefined && row.disposition !== "withdrawn" || !member(row.member) || !nonempty(row.reason)
            || !prefix.some(own => same(own, row.member)))
          || new Set(event.omissions.map(row => row.member.id)).size !== event.omissions.length) throw new Error("invalid attribution conflict omission");
      state.omissions.push(...event.omissions);
      const firstChanged = Math.min(...event.omissions.map(row => state.active.findIndex(own => own.id === row.member.id)));
      state.active = state.active.filter(own => !event.omissions.some(row => row.member.id === own.id));
      state.cursor = Math.min(state.cursor, firstChanged);
    } else throw new Error("unknown attribution event");
  }
  return state;
}

export function readAttribution(value: unknown, expected: Identity): Journal {
  identity(expected);
  if (!object(value) || !exact(value, ["version", "identity", "events"]) || value.version !== 1 || !Array.isArray(value.events)) throw new Error("invalid attribution journal");
  identity(value.identity);
  if (!same(value.identity, expected)) throw new Error("foreign attribution journal");
  const journal = value as Journal;
  replay(journal);
  return journal;
}

export function prefixTimings(journal: Journal): { members: string[]; tip: string; started: string; finished?: string; run?: string; verdict?: string }[] {
  replay(journal);
  const rows: ReturnType<typeof prefixTimings> = [];
  for (const event of journal.events) {
    if (event.kind === "start") rows.push({ members: event.members, tip: event.tip, started: event.at });
    else if (event.kind === "complete") Object.assign(rows.at(-1)!, { finished: event.at, run: event.result.run, verdict: event.result.verdict });
  }
  return rows;
}

export function sweep(identityValue: Identity, saved: unknown, effects: {
  persist: (journal: Journal) => void;
  compose: (members: Member[]) => { members: Member[]; tip: string; omissions?: Omission[] };
  measure: (members: Member[], tip: string, steps: string[]) => Measurement;
  refuse: (member: Member, result: Measurement) => void;
  omit?: (omission: Omission) => void;
  now: () => string;
}): SweepResult {
  identity(identityValue);
  let journal: Journal = saved === undefined ? { version: 1, identity: identityValue, events: [] } : readAttribution(saved, identityValue);
  if (saved === undefined) effects.persist(journal);
  const publish = (event: Started | Completed | Omitted) => {
    const next = { ...journal, events: [...journal.events, event] };
    replay(next);
    effects.persist(next); // Write ahead of refusal or a measuring command.
    journal = next;
  };
  const initial = replay(journal);
  for (const refusal of initial.refusals) effects.refuse(refusal.member, refusal.result);
  for (const omission of initial.omissions) {
    if (!effects.omit) throw new Error("attribution conflict omission has no disposition handler");
    effects.omit(omission);
  }
  if (initial.pending) return { state: "held", journal, run: identityValue.original_run, reason: `interrupted attribution prefix ${initial.pending.tip}; no complete measurement` };
  for (;;) {
    const state = replay(journal);
    if (state.held) return { state: "held", journal, run: state.held.run, reason: state.held.reason };
    const prefix = state.active.slice(0, state.cursor + 1);
    const composition = effects.compose(prefix);
    const omissions = composition.omissions ?? [];
    if (omissions.length) {
      if (!effects.omit || !hash(composition.tip) || !same(composition.members, prefix.filter(own => !omissions.some(row => row.member.id === own.id)))) throw new Error("attribution conflict changed unrelated members");
      publish({ kind: "omit", omissions, at: effects.now() });
      for (const omission of omissions) effects.omit(omission);
      continue;
    }
    if (!hash(composition.tip) || !same(composition.members, prefix)) throw new Error("attribution composition changed member identity or order");
    if (state.cursor >= state.active.length) return { state: "ready", journal, members: state.active, tip: composition.tip, refusals: state.refusals, omissions: state.omissions };
    publish({ kind: "start", members: prefix.map(m => m.id), tip: composition.tip, at: effects.now() });
    const result = effects.measure(prefix, composition.tip, identityValue.steps);
    measurement(result, identityValue.steps);
    publish({ kind: "complete", result, at: effects.now() });
    if (result.verdict === "red") effects.refuse(prefix.at(-1)!, result);
  }
}
