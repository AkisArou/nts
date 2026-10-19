/*---
description: finally runs after a return, a break and a throw, in that order of leaving.
features: [ts-errors]
---*/
const log: string[] = [];
function returns(): number {
  try {
    return 1;
  } finally {
    log.push("return");
  }
}
for (const n of [1, 2]) {
  try {
    if (n === 1) break;
  } finally {
    log.push(`break ${n}`);
  }
}
try {
  try {
    throw new TypeError("t");
  } finally {
    log.push("throw");
  }
} catch {
  log.push("caught");
}
assert.sameValue(returns(), 1);
assert.compareArray(log, ["break 1", "throw", "caught", "return"]);
