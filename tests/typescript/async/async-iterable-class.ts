/*---
description: A class with a Symbol.asyncIterator method is read by for-await.
features: [ts-async, ts-async-generators, ts-class, ts-symbols]
flags: [async]
---*/
class Pages implements AsyncIterable<string[]> {
  constructor(private items: string[], private size: number) {}
  async *[Symbol.asyncIterator](): AsyncGenerator<string[]> {
    for (let i = 0; i < this.items.length; i += this.size) {
      await null;
      yield this.items.slice(i, i + this.size);
    }
  }
}
async function main(): Promise<void> {
  const pages: string[] = [];
  for await (const page of new Pages(["a", "b", "c", "d", "e"], 2)) pages.push(page.join(""));
  assert.compareArray(pages, ["ab", "cd", "e"]);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
