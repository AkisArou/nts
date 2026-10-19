/*---
description: A method returning `this is T` narrows the receiver it was called on.
features: [ts-unions, ts-narrowing, ts-type-guards, ts-this-type, ts-class]
---*/
class FileEntry {
  isFolder(): this is Folder {
    return this instanceof Folder;
  }
  constructor(readonly label: string) {}
}
class Folder extends FileEntry {
  children: FileEntry[] = [];
}
function count(entry: FileEntry): number {
  if (entry.isFolder()) return entry.children.reduce((n, child) => n + count(child), 1);
  return 1;
}
const root = new Folder("root");
root.children.push(new FileEntry("a"), new Folder("sub"));
assert.sameValue(count(root), 3);
