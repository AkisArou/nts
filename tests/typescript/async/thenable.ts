/*---
description: Await adopts the state of an object with a typed then method.
features: [ts-async, ts-interfaces]
flags: [async]
---*/
class Deferred implements PromiseLike<string> {
  constructor(private value: string) {}
  then<R1 = string, R2 = never>(
    onFulfilled?: ((value: string) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.value).then(onFulfilled, onRejected);
  }
}
async function main(): Promise<void> {
  const text: string = await new Deferred("ready");
  assert.sameValue(text, "ready");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
