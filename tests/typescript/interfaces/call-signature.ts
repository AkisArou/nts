/*---
description: An interface with a call signature and properties types a function object that carries state.
features: [ts-interfaces, ts-call-signatures]
---*/
interface Counter {
  (): number;
  count: number;
  reset(): void;
}
function makeCounter(): Counter {
  const counter = (() => ++counter.count) as Counter;
  counter.count = 0;
  counter.reset = () => {
    counter.count = 0;
  };
  return counter;
}
const next = makeCounter();
next();
next();
assert.sameValue(next(), 3);
next.reset();
assert.sameValue(next(), 1);
assert.sameValue(typeof next, "function");
