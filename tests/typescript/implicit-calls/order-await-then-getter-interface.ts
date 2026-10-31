/*---
description: Await reads an interface then getter synchronously and queues its returned function before settlement.
features: [ts-implicit-order, ts-accessors, ts-async, ts-class, ts-class-fields, ts-interfaces, ts-function-types, ts-functions, ts-errors, ts-unknown]
flags: [async]
---*/
// Route: await of a class getter typed as a then function; node preserves the complete hook order and state.
type Then = (resolve: (value: number) => void, reject: (error: RangeError) => void) => void;
interface Pending { readonly then: Then; readThen(): Then; }
const log: string[] = [];
let state = 0;
class Deferred implements Pending {
  value: number;
  constructor(value: number) { this.value = value; }
  get then(): Then { return this.readThen(); }
  readThen(): Then {
    state++; log.push(`getThen:${this.value}:${state}`);
    return (resolve, reject) => {
      state += 10; log.push(`then:${this.value}:${typeof resolve}:${typeof reject}:${state}`);
      if (this.value < 0) reject(new RangeError(`value:${this.value}`)); else resolve(this.value + 2);
      state += 100; log.push(`after:${state}`);
    };
  }
}
async function unwrap(item: Pending): Promise<number> { return await item; }
async function main(): Promise<void> {
  for (const n of [-2, 0, 3]) {
    log.length = 0; state = 0;
    const item: Pending = new Deferred(n), pending = unwrap(item); log.push(`pending:${state}`);
    assert.sameValue(state, 1);
    let result: number | undefined; let caught = false;
    try { result = await pending; log.push(`resolved:${result}:${state}`); }
    catch (error: unknown) {
      assert.sameValue(error instanceof RangeError, true);
      if (error instanceof RangeError) assert.sameValue(error.message, `value:${n}`);
      caught = true; log.push(`caught:${state}`);
    } finally { state += 1000; log.push(`finally:${state}`); }
    assert.sameValue(result, n < 0 ? undefined : n + 2); assert.sameValue(caught, n < 0);
    assert.sameValue(state, 1111);
    const settled = n < 0 ? "caught:111" : `resolved:${n + 2}:111`;
    assert.compareArray(log, [`getThen:${n}:1`, "pending:1", `then:${n}:function:function:11`, "after:111", settled, "finally:1111"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
