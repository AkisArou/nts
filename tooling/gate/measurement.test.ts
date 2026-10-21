// The reserved pair's quiet test, driven second by second from scripted
// counters: a program in any second restarts the wait, and kernel bursts are
// judged by their average.
//
//   node --test tooling/gate/measurement.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { coreTicks, programRan, waitForQuiet } from "./measurement.ts";

/** One second of the pair: how many of its 100 ticks were a program's and how many the kernel's. */
type Second = { program: number; kernel: number };

/** `/proc/stat` lines for CPUs 4 and 5 after these seconds, cumulative from zero. */
function statAfter(seconds: Second[]): string {
  const sum = seconds.reduce((a, s) => ({ program: a.program + s.program, kernel: a.kernel + s.kernel }), { program: 0, kernel: 0 });
  const idle = seconds.length * 100 - sum.program - sum.kernel;
  // user nice system idle iowait irq softirq steal
  const line = (cpu: number) => `cpu${cpu} ${sum.program} 0 ${sum.kernel} ${idle} 0 0 0 0`;
  return `${line(4)}\n${line(5)}\n`;
}

/** Run the wait over a script of seconds, one sample a second, and say when it admitted. */
async function admitted(script: Second[], timeoutSeconds = 180): Promise<number | null> {
  let clock = 0;
  const seen: Second[] = [];
  const result = await waitForQuiet({
    read: () => coreTicks(statAfter(seen)),
    now: () => clock,
    sleep: async (ms) => {
      seen.push(script[seen.length] ?? { program: 0, kernel: 0 });
      clock += ms;
    },
    quietMs: 45000,
    timeoutMs: timeoutSeconds * 1000,
    sampleMs: 1000,
  });
  return result ? clock / 1000 : null;
}

const quiet = { program: 0, kernel: 2 };

test("a quiet pair is admitted after 45 seconds", async () => {
  assert.equal(await admitted(Array(60).fill(quiet)), 45);
});

test("a program in any second restarts the wait", async () => {
  const script = [...Array(30).fill(quiet), { program: 40, kernel: 0 }, ...Array(60).fill(quiet)];
  assert.equal(await admitted(script), 31 + 45);
});

test("kernel bursts are judged by their average, not by their worst second", async () => {
  // A 30% burst every ten seconds averages under 10%: the old test, asking
  // every second to be 90% idle, restarted on each burst and never admitted.
  const script = Array.from({ length: 120 }, (_, at) => (at % 10 === 5 ? { program: 0, kernel: 30 } : quiet));
  assert.equal(await admitted(script), 45);
});

test("sustained kernel load over 10% on average is not admitted", async () => {
  assert.equal(await admitted(Array(200).fill({ program: 0, kernel: 15 }), 180), null);
});

test("a program at a trace share is not a program, and above it is", () => {
  const before = coreTicks(statAfter([]));
  assert.equal(programRan(before, coreTicks(statAfter([{ program: 1, kernel: 5 }]))), false);
  assert.equal(programRan(before, coreTicks(statAfter([{ program: 5, kernel: 0 }]))), true);
});

test("a counter that went backwards is not known to be quiet", () => {
  const later = coreTicks(statAfter(Array(10).fill(quiet)));
  assert.equal(programRan(later, coreTicks(statAfter([]))), true);
});
