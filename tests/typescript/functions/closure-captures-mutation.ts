/*---
description: A closure sees later assignments to the variable it captured, of each primitive and object type.
features: [ts-functions, ts-closures]
---*/
let count = 1;
let label = "a";
let flag = false;
let list: number[] = [1];
const read = (): string => `${count}${label}${flag}${list.length}`;
assert.sameValue(read(), "1afalse1");
count = 2.5;
label = "bc";
flag = true;
list = [1, 2, 3];
assert.sameValue(read(), "2.5bctrue3");
