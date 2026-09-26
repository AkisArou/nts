// Render scenarios timed on one React arm, run from a directory whose
// node_modules names that arm's `react`, `react-noop-renderer` and
// `scheduler` (compare.mjs sets it up). Prints one JSON line: per scenario,
// the median milliseconds and a fingerprint of the host tree it left, which
// compare.mjs requires to be equal across arms: an arm that renders less is
// not faster.
//
// The scenarios are js-framework-benchmark's, on the noop renderer so the
// host costs nothing: keyed rows of a function component.

"use strict";
const React = require("react");
const ReactNoop = require("react-noop-renderer");

const { createElement: h, useState } = React;
const ROWS = Number(process.env.BENCH_ROWS ?? 1000);
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 25);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 5);

function Row(props) {
  return h("div", { id: props.id }, props.label);
}

function List(props) {
  return h("section", null, props.rows.map((row) => h(Row, { key: row.id, id: row.id, label: row.label })));
}

function rows(count, suffix) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({ id: i, label: "row " + i + suffix });
  return out;
}

function render(element) {
  ReactNoop.flushSync(() => ReactNoop.render(element));
}

// The host tree as text, cheap enough to compare but covering every node.
function fingerprint() {
  let hash = 0;
  const text = JSON.stringify(ReactNoop.getChildrenAsJSX());
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return text.length + ":" + hash;
}

let setCount = null;
function Counter() {
  const [count, set] = useState(0);
  setCount = set;
  return h("span", null, "count " + count);
}

// Each: `setup` runs untimed, `run` is timed.
const scenarios = {
  mount: { setup: () => render(null), run: () => render(h(List, { rows: rows(ROWS, "") })) },
  updateEvery10th: {
    setup: () => render(h(List, { rows: rows(ROWS, "") })),
    run: () => render(h(List, { rows: rows(ROWS, "").map((r, i) => (i % 10 === 0 ? { id: r.id, label: r.label + " !" } : r)) })),
  },
  reverse: {
    setup: () => render(h(List, { rows: rows(ROWS, "") })),
    run: () => render(h(List, { rows: rows(ROWS, "").reverse() })),
  },
  swap: {
    setup: () => render(h(List, { rows: rows(ROWS, "") })),
    run: () => {
      const r = rows(ROWS, "");
      const t = r[1];
      r[1] = r[ROWS - 2];
      r[ROWS - 2] = t;
      render(h(List, { rows: r }));
    },
  },
  removeOne: {
    setup: () => render(h(List, { rows: rows(ROWS, "") })),
    run: () => render(h(List, { rows: rows(ROWS, "").filter((r) => r.id !== ROWS / 2) })),
  },
  clear: { setup: () => render(h(List, { rows: rows(ROWS, "") })), run: () => render(null) },
  // The hook path: one state updated 2,000 times, each flushed.
  stateUpdates: {
    setup: () => render(h(Counter)),
    run: () => {
      for (let i = 1; i <= 2000; i++) ReactNoop.flushSync(() => setCount(i));
    },
  },
};

const only = process.env.BENCH_ONLY;
const results = {};
for (const [name, s] of Object.entries(scenarios)) {
  if (only !== undefined && only !== name) continue;
  const times = [];
  for (let i = 0; i < WARMUP + ITERATIONS; i++) {
    s.setup();
    const start = process.hrtime.bigint();
    s.run();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (i >= WARMUP) times.push(ms);
  }
  times.sort((a, b) => a - b);
  results[name] = { median: times[Math.floor(times.length / 2)], fingerprint: fingerprint() };
  render(null);
}
console.log(JSON.stringify(results));
