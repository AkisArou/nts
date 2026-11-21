// The microtask path: `await` in a loop, and a `Promise.all` fan-out.
//
// No timer and no I/O, so every turn of this work is a promise job and none
// of it is time the loop spends idle. One call is a fixed amount of it: 2,000
// awaits of an async step in sequence, then 64 tasks fanned out through
// `Promise.all`, each awaiting 8 steps of its own -- 2,577 async functions run
// to completion, with their reactions. The checksum is the integer sum of the
// steps, which no ordering of the jobs can change.
//
// The call answers with a promise, so every column waits for it before the
// call counts as done (tooling/bench's promised workload): node and Bun by
// `await`, the native columns by joining it on the libuv host.

async function step(value: number): Promise<number> {
  return (value * 31 + 7) & 1023;
}

async function task(base: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += await step(base + i);
  }
  return sum;
}

export async function work(n: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    sum += await step(i + n);
  }
  const tasks: Promise<number>[] = [];
  for (let k = 0; k < 64; k++) {
    tasks.push(task(k * 8 + n));
  }
  const results = await Promise.all(tasks);
  for (const result of results) {
    sum += result;
  }
  return sum;
}

export const seed = 1;
