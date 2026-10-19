/*---
description: Two declarations of one interface merge; a value must and does have the members of both.
features: [ts-interfaces, ts-declaration-merging]
---*/
interface Settings {
  theme: string;
}
interface Settings {
  fontSize: number;
}
const settings: Settings = { theme: "dark", fontSize: 14 };
function describe(s: Settings): string {
  return `${s.theme}/${s.fontSize}`;
}
assert.sameValue(describe(settings), "dark/14");
