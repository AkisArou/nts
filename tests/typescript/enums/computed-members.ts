/*---
description: Members computed from earlier members, as flags.
features: [ts-enum, ts-enum-computed]
---*/
enum Flags { None = 0, Read = 1 << 0, Write = 1 << 1, ReadWrite = Read | Write }
assert.sameValue(Flags.ReadWrite, 3);
assert.sameValue(Flags.Write & Flags.ReadWrite, 2);
