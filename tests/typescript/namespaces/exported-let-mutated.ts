/*---
description: An exported let that the namespace's own function updates is read back updated through the namespace.
features: [ts-namespace]
---*/
namespace Clicks {
  export let count = 0;
  export function click(): void {
    count++;
  }
}
Clicks.click();
Clicks.click();
assert.sameValue(Clicks.count, 2);
Clicks.count = 10;
Clicks.click();
assert.sameValue(Clicks.count, 11);
