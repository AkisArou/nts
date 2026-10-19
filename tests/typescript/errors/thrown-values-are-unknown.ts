/*---
description: Any value can be thrown; a catch binding is unknown and is narrowed before use.
features: [ts-errors, ts-unknown, ts-narrowing]
---*/
function describe(thrower: () => void): string {
  try {
    thrower();
    return "nothing";
  } catch (error) {
    if (error instanceof Error) return `error ${error.message}`;
    if (typeof error === "string") return `string ${error}`;
    if (typeof error === "number") return `number ${error}`;
    return `other ${JSON.stringify(error)}`;
  }
}
assert.sameValue(describe(() => {}), "nothing");
assert.sameValue(describe(() => { throw new Error("e"); }), "error e");
assert.sameValue(describe(() => { throw "s"; }), "string s");
assert.sameValue(describe(() => { throw 42; }), "number 42");
assert.sameValue(describe(() => { throw { code: 1 }; }), 'other {"code":1}');
