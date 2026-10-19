/*---
description: The class after `extends` may be the result of any expression, evaluated once.
features: [ts-class, ts-inheritance]
---*/
class Quiet {
  speak(): string {
    return "...";
  }
}
class Noisy {
  speak(): string {
    return "!!!";
  }
}
let calls = 0;
function pick(loud: boolean): typeof Quiet {
  calls++;
  return loud ? Noisy : Quiet;
}
class Speaker extends pick(true) {}
assert.sameValue(new Speaker().speak(), "!!!");
assert.sameValue(new Speaker() instanceof Noisy, true);
assert.sameValue(calls, 1);
