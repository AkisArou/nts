/*---
description: A class implementing two interfaces is used through each of them.
features: [ts-class, ts-interfaces]
---*/
interface Named {
  label(): string;
}
interface Sized {
  size(): number;
}
class Folder implements Named, Sized {
  constructor(private files: string[]) {}
  label(): string {
    return `folder(${this.size()})`;
  }
  size(): number {
    return this.files.length;
  }
}
const folder = new Folder(["a", "b"]);
const named: Named = folder;
const sized: Sized = folder;
assert.sameValue(named.label(), "folder(2)");
assert.sameValue(sized.size(), 2);
