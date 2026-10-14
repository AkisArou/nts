// `await 1`, where the operand is not a promise.
//
// Legal TypeScript, and it means `Promise.resolve(1)` -- **a suspension of one
// tick rather than none**. The lowering refused it, and refusing was right for
// exactly that reason: treating it as the identity would have made a program
// that awaits a plain value and one that does not into the same program, and
// they are not.
//
// The tick is what `Promise.resolve` already builds, so the value is wrapped in
// a settled promise and awaited -- the spelling the specification gives it.
// Nothing here restates the ordering rule; the runtime's microtask queue does,
// as it does for every other resolved promise.
//
// `ordering` is the arm that makes that claim checkable. It runs a helper whose
// continuation is scheduled one tick out, then awaits a plain number, and the
// order the two land in is the whole question. An `await` lowered as the
// identity agrees with node on every other export here and fails this one.

async function later(log: string[]): Promise<void> {
  await Promise.resolve(0);
  log.push("later");
}

export async function aNumber(n: number): Promise<number> {
  const v = await n;
  return v + 1;
}

export async function aString(n: number): Promise<string> {
  const v = await ("x" + n.toString());
  return v + "!";
}

export async function aBoolean(n: number): Promise<number> {
  const v = await (n > 2);
  return v ? n : -n;
}

export async function anObject(n: number): Promise<number> {
  const v = await { a: n, b: n * 2 };
  return v.a + v.b;
}

/** In a loop, so the frame carries the value across several suspensions. */
export async function inALoop(n: number): Promise<number> {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    s += await (i + n);
  }
  return s;
}

/** Mixed with a real promise, so both kinds of suspension happen in one frame. */
export async function mixed(n: number): Promise<number> {
  const a = await n;
  const b = await Promise.resolve(n * 2);
  const c = await (a + b);
  return c;
}

/** The tick is observable, and this is where. */
export async function ordering(n: number): Promise<string> {
  const log: string[] = [];
  const p = later(log);
  log.push("before");
  await n;
  log.push("after");
  await p;
  return log.join(",") + n.toString();
}
