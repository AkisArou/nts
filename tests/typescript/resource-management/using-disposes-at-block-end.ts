/*---
description: A `using` declaration disposes its resource when the block that declares it ends.
features: [ts-using]
---*/
const log: string[] = [];
class Handle implements Disposable {
  constructor(private label: string) {
    log.push(`open ${label}`);
  }
  [Symbol.dispose](): void {
    log.push(`close ${this.label}`);
  }
}
{
  using handle = new Handle("a");
  log.push("work");
}
log.push("after");
assert.compareArray(log, ["open a", "work", "close a", "after"]);
