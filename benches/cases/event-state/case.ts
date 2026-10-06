// Long-lived state changed a little per event: the shape of a UI, or of a
// server between requests.
//
// Every other case here is one call that runs to completion. This one keeps a
// thousand rows alive across calls, and each call is one event -- remove a
// row, add one, relabel one, read a total. The native driver checkpoints after
// every event, as a host does after a callback, because that is where this
// shape's cost was found.
//
// **What it measures that nothing else here does:** cost proportional to the
// state rather than to the event. The compiler retained `t.rows` around the
// runtime `splice` and released it after; the release left the array a cycle
// candidate, and the checkpoint's trial deletion then walked every row. In the
// Chromium lane's table app that made removing one row of a thousand cost
// 16.7us against 0.16us -- a hundred times the event's own work, and growing
// with the table. A suite of run-to-completion cases has one checkpoint per
// call and could not see it.
//
// The table's size never changes, so a calibrated run of millions of events
// stays the same size, and labels are drawn afresh rather than appended to.

const adjectives = [
  "pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint",
  "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable",
  "important", "inexpensive", "cheap", "expensive", "fancy",
];
const nouns = [
  "table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza",
  "mouse", "keyboard",
];

class Row {
  id: number;
  label: string;
  constructor(id: number, label: string) {
    this.id = id;
    this.label = label;
  }
}

class Table {
  rows: Row[] = [];
  nextId = 1;
  random = 1;
}

const table = new Table();

// Park-Miller: exact in a double, so every lane draws the same sequence.
function draw(t: Table, max: number): number {
  t.random = t.random * 16807 % 2147483647;
  return t.random % max;
}

function label(t: Table): string {
  return adjectives[draw(t, adjectives.length)] + " " + nouns[draw(t, nouns.length)];
}

function add(t: Table): void {
  const id = t.nextId;
  t.nextId = id + 1;
  t.rows.push(new Row(id, label(t)));
}

function remove(t: Table, index: number): void {
  t.rows.splice(index, 1);
}

function relabel(t: Table, index: number): void {
  t.rows[index].label = label(t);
}

export function event(seed: number): number {
  const t = table;
  if (t.rows.length === 0) {
    for (let i = 0; i < 1000; i++) {
      add(t);
    }
  }
  remove(t, draw(t, t.rows.length));
  add(t);
  // `seed >>> 0`, not `seed`: the benchmark runs with `seed` (3, below), but
  // `nts check` drives every export with a pool of arguments, and a NaN or
  // negative seed made this index NaN or negative -- node threw where nts
  // declined the case, and since a declined case restarts the program, the
  // module state the two sides carried apart from there. The same index for
  // 3, so the reference implementations and the checksum are unchanged.
  relabel(t, (draw(t, t.rows.length) + (seed >>> 0)) % t.rows.length);
  return t.rows.length + t.rows[0].id + t.rows[t.rows.length - 1].label.length;
}

/**
 * The input the harness calls `event` with. See `array-mutations` for why it
 * is declared here.
 */
export const seed = 3;
