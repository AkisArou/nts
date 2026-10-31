/*---
description: Control for unwind-nested-3-routes; the throwing body is called directly inside the caller try with the same unwind observations.
features: [ts-throw-route-unwind, ts-errors, ts-unknown, ts-functions, ts-interfaces, ts-function-types, ts-generics]
---*/
// Control: ../throw-routes/unwind-nested-3-routes.ts; the caller directly invokes the throwing body and preserves the same cleanup.
for (const input of [-2, 0, 3]) {
  const original = new RangeError(`unwind:${input}`);
  const log: string[] = []; let state = 0;
  function note(label: string, amount: number): void { state += amount; log.push(`${label}:${state}`); }
  function action(value: number): number {
    note(`target:${value}`, 1);
    try {
      if (value < 0) { note("throw", 2); throw original; }
      note("return", 3); return value * 2;
    } finally { note("target:finally", 10); }
  }
  interface UnwindField { invoke: (value: number) => number; }
  interface UnwindPort { run(value: number): number; }
  const field: UnwindField = { invoke: action };
  const port: UnwindPort = { run(value: number): number {
    note("port:enter", 20); try { return field.invoke(value); } finally { note("port:finally", 30); }
  } };
  function through<T, U>(callback: (value: T) => U, value: T): U {
    note("generic:enter", 40); try { return callback(value); } finally { note("generic:finally", 50); }
  }
  const invokePort: (value: number) => number = value => port.run(value);
  let result: number | undefined; let caught: unknown;
  try {
    note("caller:enter", 0); note("generic:enter", 40);
    try {
      note("port:enter", 20);
      try { result = action(input); } finally { note("port:finally", 30); }
    } finally { note("generic:finally", 50); }
    note("caller:return", 0);
  }
  catch (error: unknown) {
    caught = error; note("caller:catch", 0);
    assert.sameValue(error, original); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, `unwind:${input}`);
  } finally { note("caller:finally", 100); }
  assert.sameValue(caught, input < 0 ? original : undefined); assert.sameValue(result, input < 0 ? undefined : input * 2);
  const afterTarget = 60 + (input < 0 ? 13 : 14), completed = afterTarget + 80;
  assert.sameValue(state, completed + 100);
  assert.compareArray(log, ["caller:enter:0", "generic:enter:40", "port:enter:60",
    `target:${input}:61`, input < 0 ? "throw:63" : "return:64", `target:finally:${afterTarget}`,
    `port:finally:${afterTarget + 30}`, `generic:finally:${completed}`, input < 0 ? `caller:catch:${completed}` : `caller:return:${completed}`, `caller:finally:${completed + 100}`]);
}
