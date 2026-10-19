/*---
description: Decorators write to context.metadata, which becomes the class's Symbol.metadata object; a subclass's inherits from its base's by prototype.
features: [ts-decorators, ts-class, ts-symbols, ts-inheritance]
---*/
(Symbol as { metadata?: symbol }).metadata ??= Symbol("Symbol.metadata");
function column(_target: undefined, context: ClassFieldDecoratorContext) {
  const metadata = context.metadata;
  if (!Object.hasOwn(metadata, "columns")) metadata.columns = [...((metadata.columns as string[] | undefined) ?? [])];
  (metadata.columns as string[]).push(String(context.name));
}
class Row {
  @column id = 0;
  @column label = "";
}
class TaggedRow extends Row {
  @column tag = "";
}
const own = Row[Symbol.metadata!] as { columns: string[] };
const derived = TaggedRow[Symbol.metadata!] as { columns: string[] };
assert.compareArray(own.columns, ["id", "label"]);
assert.sameValue(Object.getPrototypeOf(derived), own);
assert.compareArray(derived.columns, ["id", "label", "tag"]);
