/*---
description: An optional method call `obj.method?.()` keeps `obj` as `this`.
features: [ts-optional-chaining, ts-this]
---*/
class Speaker {
  constructor(private word: string) {}
  say?(): string {
    return this.word;
  }
}
const speaker = new Speaker("hi");
assert.sameValue(speaker.say?.(), "hi");
const silent: { say?: () => string } = {};
assert.sameValue(silent.say?.(), undefined);
