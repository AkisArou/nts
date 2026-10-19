/*---
description: A namespace's statements run where it is declared, in order with the code around it.
features: [ts-namespace]
---*/
const log: string[] = [];
log.push("before");
namespace Effects {
  log.push("inside");
  export const ready = true;
}
log.push("after");
assert.sameValue(log.join(","), "before,inside,after");
assert.sameValue(Effects.ready, true);
