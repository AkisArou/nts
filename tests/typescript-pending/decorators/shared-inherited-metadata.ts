/*---
description: A subclass's metadata object inherits its base's, so mutating an inherited value without copying it changes the base's too.
features: [ts-decorators, ts-class, ts-symbols, ts-inheritance]
---*/
(Symbol as { metadata?: symbol }).metadata ??= Symbol("Symbol.metadata");
function tag(_target: undefined, context: ClassFieldDecoratorContext) {
  const tags = (context.metadata.tags ??= []) as string[];
  tags.push(String(context.name));
}
class Base {
  @tag a = 0;
}
class Derived extends Base {
  @tag b = 0;
}
const baseTags = (Base[Symbol.metadata!] as { tags: string[] }).tags;
const derivedMetadata = Derived[Symbol.metadata!] as { tags: string[] };
assert.sameValue(Object.hasOwn(derivedMetadata, "tags"), false);
assert.sameValue(derivedMetadata.tags, baseTags);
assert.compareArray(baseTags, ["a", "b"]);
