/*---
description: A decorator's context names the member and says whether it is static or private, with access to its value.
features: [ts-decorators, ts-class, ts-private-fields, ts-static]
---*/
const seen: string[] = [];
let readSecret: ((object: Vault) => number) | undefined;
function describe(_target: unknown, context: ClassMethodDecoratorContext | ClassFieldDecoratorContext) {
  seen.push(`${context.kind} ${String(context.name)} static=${context.static} private=${context.private}`);
  if (context.name === "#secret") readSecret = (object) => (context.access as { get(o: Vault): number }).get(object);
}
class Vault {
  @describe static open(): void {}
  @describe #secret = 7;
  @describe visible = 1;
}
assert.compareArray(seen, ["method open static=true private=false", "field #secret static=false private=true", "field visible static=false private=false"]);
assert.sameValue(readSecret!(new Vault()), 7);
