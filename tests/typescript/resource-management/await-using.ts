/*---
description: An `await using` declaration awaits its resource's asynchronous disposal when the block ends.
features: [ts-using, ts-async]
flags: [async]
---*/
const log: string[] = [];
class Connection implements AsyncDisposable {
  async [Symbol.asyncDispose](): Promise<void> {
    await null;
    log.push("closed");
  }
}
async function main(): Promise<void> {
  {
    await using connection = new Connection();
    log.push("query");
  }
  log.push("after");
  assert.compareArray(log, ["query", "closed", "after"]);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
