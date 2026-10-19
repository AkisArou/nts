/*---
description: An abstract constructor type accepts both an abstract class and its concrete subclasses as values.
features: [ts-class, ts-abstract, ts-construct-signatures]
---*/
abstract class Extension {
  static registry: string[] = [];
  abstract run(): string;
}
class Echo extends Extension {
  run(): string {
    return "echo";
  }
}
function describe(ctor: abstract new () => Extension): string {
  return `${ctor.name}:${ctor === Extension ? "abstract" : "concrete"}`;
}
function build(ctor: new () => Extension): string {
  return new ctor().run();
}
assert.sameValue(describe(Extension), "Extension:abstract");
assert.sameValue(describe(Echo), "Echo:concrete");
assert.sameValue(build(Echo), "echo");
