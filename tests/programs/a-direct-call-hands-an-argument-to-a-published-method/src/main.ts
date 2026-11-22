// Direct transfers versus borrowed publication, dispatch and kept arguments.
// The loops keep the consuming bodies visible instead of inlining the stores.
export class Cell {
  value: number;
  constructor(value: number) { this.value = value; }
}

export class Sink {
  slot: Cell | null = null;

  keep(cell: Cell, mode: number): number {
    if (mode < 0) throw new Error("before store");
    const value = cell.value;
    this.slot = cell;
    if (mode === 13) throw new Error("after store");
    let answer = value;
    for (let i = 0; i < (mode & 7); i++) answer += i;
    return answer;
  }
}

export class OtherSink extends Sink {
  override keep(cell: Cell, mode: number): number {
    const value = cell.value;
    this.slot = cell;
    let answer = value + 1;
    for (let i = 0; i < (mode & 7); i++) answer += i;
    return answer;
  }
}

let saved: Cell | null = null;

export function publish(cell: Cell, mode: boolean): number {
  const value = cell.value;
  saved = cell;
  let answer = value;
  for (let i = 0; i < (mode ? 3 : 5); i++) answer += i;
  return answer;
}

export function direct(n: number): number {
  const answer = publish(new Cell(n), n < 0);
  const observed = saved!.value;
  saved = null;
  return answer + observed;
}

export function stillUsed(n: number): number {
  const cell = new Cell(n);
  const answer = publish(cell, n < 0);
  saved = null;
  return answer + cell.value;
}

export function recurse(cell: Cell, again: boolean): number {
  let answer = cell.value;
  if (again) answer += recurse(new Cell(answer + 1), false);
  for (let i = 0; i < (again ? 2 : 3); i++) answer += i;
  saved = cell;
  return answer;
}

export function recursive(n: number): number {
  const answer = recurse(new Cell(n), true);
  saved = null;
  return answer;
}

function dispatch(sink: Sink, n: number): number {
  return sink.keep(new Cell(n), n & 7);
}

export function virtual(n: number): number {
  const sink: Sink = (n & 1) === 0 ? new Sink() : new OtherSink();
  return dispatch(sink, n) + sink.slot!.value;
}

export function throwing(n: number): number {
  const sink = new Sink();
  let result = 0;
  try {
    result = sink.keep(new Cell(n), n < 0 ? -1 : 13);
  } catch {
    result = sink.slot === null ? 7 : sink.slot.value;
  }
  return result;
}

export function callback(n: number): number {
  const call = publish;
  const result = [n, n + 1].map(value => call(new Cell(value), value < 0));
  const answer = result[0]! + result[1]! + saved!.value;
  saved = null;
  return answer;
}

export function identity(n: number): string {
  const cell = new Cell(n);
  publish(cell, n < 0);
  saved = null;
  const text = String(publish);
  return publish.name + "|" + text.slice(0, text.indexOf("("));
}

let defaults = 0;
function defaultValue(): string {
  defaults++;
  return String(defaults);
}

export function binding(cell: Cell, text: string = defaultValue(), ...tail: string[]): number {
  const value = cell.value;
  saved = cell;
  let answer = value + text.length;
  for (let i = 0; i < tail.length; i++) answer += tail[i]!.length;
  return answer;
}

export function defaultsOnce(n: number): number {
  defaults = 0;
  const a = binding(new Cell(n));
  const b = binding(new Cell(n), "seven", "two", "three");
  saved = null;
  return a + b + defaults * 100;
}

export function returnedAlias(cell: Cell): Cell {
  saved = cell;
  return cell;
}

export function alias(n: number): number {
  const cell = returnedAlias(new Cell(n));
  saved = null;
  return cell.value;
}

// This published function has no direct caller and must acquire no adapter.
export function onlyPublished(cell: Cell): number {
  saved = cell;
  return cell.value;
}

export interface Envelope { slot: Cell | null; }
class OffsetEnvelope {
  prefix = 5;
  slot: Cell | null = null;
}

export function replaceSlot(envelope: Envelope, cell: Cell): number {
  let answer = cell.value;
  envelope.slot = cell;
  for (let i = 0; i < 3; i++) answer += i;
  return answer;
}

function storeEnvelope(envelope: Envelope, n: number): number {
  const answer = replaceSlot(envelope, new Cell(n));
  return answer + envelope.slot!.value;
}

export function interfaceStore(n: number): number {
  if (n < 0) return storeEnvelope({slot: null}, n);
  return storeEnvelope(new OffsetEnvelope(), n);
}
