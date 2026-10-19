/*---
description: An async method keeps `this` across its awaits.
features: [ts-async, ts-class]
flags: [async]
---*/
class Loader {
  private loaded: string[] = [];
  async load(name: string): Promise<number> {
    await Promise.resolve();
    this.loaded.push(name);
    await Promise.resolve();
    return this.loaded.length;
  }
  names(): string {
    return this.loaded.join(",");
  }
}
async function main(): Promise<void> {
  const loader = new Loader();
  assert.sameValue(await loader.load("a"), 1);
  assert.sameValue(await loader.load("b"), 2);
  assert.sameValue(loader.names(), "a,b");
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
