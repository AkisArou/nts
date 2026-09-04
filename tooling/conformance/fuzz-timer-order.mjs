// Our scheduling order against node's, over random programs.
//
//   node tooling/conformance/fuzz-timer-order.mjs [programs] [seed]
//
// Node's own timer tests assert on specific sequences a person thought to
// write down. What they do not cover is the combinatorics: a `nextTick` queued
// by the second of three timers sharing a duration, an immediate scheduled
// from inside an immediate while a zero timer is pending, an interval that
// re-arms between two timeouts. Those are where an ordering bug lives, because
// each one is individually plausible and no single test names it.
//
// The oracle is node running the same program. Both are driven in this one
// process, sequentially, from the same generated tree -- so the comparison is
// between two schedulers and not between two programs.
//
// Run several seeds. Its power is not uniform: removing the checkpoint between
// two callbacks of one batch shows up on almost any seed, but re-arming a
// repeating timer from when its callback *finished* rather than from when it
// started was caught on two seeds out of six. That difference is only visible
// when a callback takes long enough to matter, and those are the same programs
// the determinism filter below is most likely to discard -- so the sensitivity
// and the noise rejection pull against each other, and neither can be turned
// up without the other coming down. Measured, both directions.
//
// Nondeterministic programs are discarded rather than reported. The order of
// `setImmediate` against `setTimeout(0)` at the top level is genuinely not
// specified in node -- it depends on how long the process took to start -- and
// a fuzzer that flagged it would be reporting node's nondeterminism as our
// bug. Every program is run twice per scheduler, and one that does not agree
// with itself is dropped.

import process from "node:process";

// Node's own, captured before our module can replace anything.
const nodeApi = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setImmediate: globalThis.setImmediate,
  clearImmediate: globalThis.clearImmediate,
};

const ROOT = new URL("../../", import.meta.url).pathname;
await import(`${ROOT}runtime/node/timers/bindings.node.mjs`);
const ours = await import(`${ROOT}runtime/node/timers/src/main.ts`);
const state = await import(`${ROOT}runtime/node/timers/src/timeout.ts`);

const ourApi = {
  setTimeout: ours.setTimeout,
  clearTimeout: ours.clearTimeout,
  setInterval: ours.setInterval,
  clearInterval: ours.clearInterval,
  setImmediate: ours.setImmediate,
  clearImmediate: ours.clearImmediate,
};

const PROGRAMS = Number(process.argv[2] ?? 300);
const SEED = Number(process.argv[3] ?? 1);

/** Deterministic, so a failing program can be replayed by seed. */
function makeRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

// Delays are drawn from a small set on purpose. Distinct durations are
// distinct lists, and the interesting cases are several timers sharing one
// list and several lists expiring together -- which a wide range of delays
// would make rare.
const DELAYS = [0, 1, 1, 2, 3];

const KINDS = ["timeout", "immediate", "tick", "microtask", "interval"];

/**
 * Blocking work inside a callback, in milliseconds.
 *
 * Mostly none, because a program of slow callbacks is a program whose order
 * depends on the machine. But some, because a callback that takes longer than
 * its own interval is what separates "re-arm from when the callback started"
 * from "re-arm from when it finished", and with instant callbacks those two
 * are the same rule. Without this the fuzzer could not tell them apart -- it
 * was checked, and it could not.
 */
const WORK_MS = [0, 0, 0, 0, 2];

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
function burn(ms) {
  if (ms > 0) Atomics.wait(sleepCell, 0, 0, ms);
}

let nextId = 0;

/**
 * One node of a program: something that runs once, records that it ran, and
 * then schedules its children.
 *
 * A tree rather than a flat list because scheduling *from inside a callback*
 * is where the phases interact. A flat list of top-level calls only ever
 * exercises the first pass of each queue.
 */
function build(random, depth) {
  const kind = KINDS[Math.floor(random() * KINDS.length)];
  const node = {
    id: nextId++,
    kind,
    delay: DELAYS[Math.floor(random() * DELAYS.length)],
    work: WORK_MS[Math.floor(random() * WORK_MS.length)],
    // An interval that runs more than once is the only way the reinsertion
    // path is reached at all. Clearing on the first tick -- which is what the
    // obvious generator does -- exercises cancellation and never re-arming.
    repeats: kind === "interval" ? 1 + Math.floor(random() * 3) : 1,
    children: [],
  };
  if (depth > 0) {
    const count = Math.floor(random() * 3);
    for (let i = 0; i < count; i++) node.children.push(build(random, depth - 1));
  }
  return node;
}

function count(node) {
  let total = node.repeats;
  for (const child of node.children) total += count(child);
  return total;
}

/**
 * Run one program under one scheduler and return the order things ran in.
 *
 * Resolves when every node has run. A program that hangs -- which would be a
 * real failure -- is caught by the cap rather than stalling the fuzzer, and
 * comes back short so the comparison reports it.
 */
function run(program, api, expected) {
  return new Promise((resolve) => {
    const trace = [];
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      nodeApi.clearTimeout(cap);
      resolve(trace);
    };

    const cap = nodeApi.setTimeout(finish, 2000);

    const schedule = (node) => {
      let ticks = 0;
      const fire = () => {
        burn(node.work);
        ticks++;
        trace.push(node.repeats > 1 ? `${node.kind}${node.id}#${ticks}` : `${node.kind}${node.id}`);
        // Children go once, on the last tick, so a repeating interval does not
        // multiply the rest of the program.
        if (ticks === node.repeats) {
          for (const child of node.children) schedule(child);
        }
        if (trace.length === expected) finish();
      };
      switch (node.kind) {
        case "timeout":
          api.setTimeout(fire, node.delay);
          break;
        case "immediate":
          api.setImmediate(fire);
          break;
        case "tick":
          process.nextTick(fire);
          break;
        case "microtask":
          Promise.resolve().then(fire);
          break;
        default: {
          // Runs `repeats` times and then clears itself. Both halves matter:
          // the repeats reach the reinsertion in the callback's `finally`, and
          // the final clear reaches cancellation from inside the callback
          // being cancelled, which is where reinsertion and removal race.
          const handle = api.setInterval(() => {
            if (ticks + 1 === node.repeats) api.clearInterval(handle);
            fire();
          }, node.delay);
        }
      }
    };

    for (const node of program) schedule(node);
    if (expected === 0) finish();
  });
}

/**
 * How many identical runs a scheduler must produce before its order counts as
 * this program's order.
 *
 * Two is not enough, which was measured rather than assumed: the same seed
 * reported zero differences on one invocation and three on the next. A
 * callback that blocks for two milliseconds while a three-millisecond timer is
 * pending is a genuine race, node lands on either side of it, and two runs
 * agree by chance often enough to let that through as a finding.
 */
const RUNS_FOR_STABILITY = 5;

/** One agreed order, or null when the scheduler is not deterministic here. */
async function stableTrace(program, api, expected) {
  const first = (await run(program, api, expected)).join(",");
  for (let i = 1; i < RUNS_FOR_STABILITY; i++) {
    const again = (await run(program, api, expected)).join(",");
    if (again !== first) return null;
  }
  return first;
}

const random = makeRandom(SEED);
let compared = 0;
let skipped = 0;
const differ = [];

for (let i = 0; i < PROGRAMS && differ.length < 5; i++) {
  nextId = 0;
  const program = [];
  const roots = 1 + Math.floor(random() * 4);
  for (let r = 0; r < roots; r++) program.push(build(random, 2));
  const expected = program.reduce((total, node) => total + count(node), 0);

  // Interleaved rather than all-node-then-all-ours, so that a slow moment on
  // the machine biases both schedulers alike instead of only the second one.
  const theirs = await stableTrace(program, nodeApi, expected);
  const mine = await stableTrace(program, ourApi, expected);
  const theirsAgain = await stableTrace(program, nodeApi, expected);
  if (theirs !== theirsAgain) {
    skipped++;
    continue;
  }

  // Both schedulers have to agree with themselves before they can be compared
  // with each other.
  if (theirs === null || mine === null) {
    skipped++;
    continue;
  }

  compared++;
  if (theirs !== mine) {
    differ.push({ program, theirs, mine });
  }

  // Nothing may be left over. A program that finished but left a list in the
  // map is a leak, and it would silently change the *next* program's order.
  if (state.timerListMap.size !== 0 || state.timerListQueue.size !== 0) {
    differ.push({
      program,
      theirs: "<clean>",
      mine: `<${state.timerListMap.size} lists, heap ${state.timerListQueue.size}>`,
    });
  }
}

console.log(
  `${compared} programs agree, ${differ.length} differ, ${skipped} skipped as ` +
    `nondeterministic (seed ${SEED})`,
);
for (const { program, theirs, mine } of differ) {
  console.log(`  program: ${JSON.stringify(program)}`);
  console.log(`    node: ${theirs.split(",").join(" ")}`);
  console.log(`    ours: ${mine.split(",").join(" ")}`);
}
process.exitCode = differ.length > 0 ? 1 : 0;
