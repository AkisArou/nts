/*---
description: Generic-returned functions allocate a new object default on each undefined call while preserving supplied objects and null.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-generics, ts-default-parameters, ts-objects, ts-null-undefined]
---*/
// A generic return carries defaulted functions; node creates serial 1 then 2 objects, but retains supplied identities and null.
interface ParamBox { serial: number; value: number; }
let counter = 0;
function allocate(): ParamBox { return { serial: ++counter, value: 17 }; }
type ParamReader = (input?: ParamBox | null) => ParamBox | null;
function retain<T>(value: T): T { return value; }
function declared(input: ParamBox | null = allocate()): ParamBox | null { return input; }
const expression = function (input: ParamBox | null = allocate()): ParamBox | null { return input; };
const readers: ParamReader[] = [retain(declared), retain(expression)];
const supplied: ParamBox = { serial: 80, value: 29 }; const inputs: (ParamBox | null | undefined)[] = [undefined, supplied, null];
for (const reader of readers) for (const input of inputs) {
  counter = 0; const first = reader(input), second = reader(input);
  if (input === undefined) {
    if (first === null || second === null) throw new Error("missing default");
    assert.sameValue(first === second, false); assert.sameValue(first.serial, 1); assert.sameValue(second.serial, 2);
    assert.compareArray([first.value, second.value], [17, 17]); first.value = 101;
    assert.sameValue(second.value, 17); second.value = 202; assert.sameValue(second.value, 202); assert.sameValue(first.value, 101);
  } else { assert.sameValue(first, input); assert.sameValue(second, input); }
  assert.sameValue(counter, input === undefined ? 2 : 0);
  assert.compareArray([supplied.serial, supplied.value], [80, 29]);
}
