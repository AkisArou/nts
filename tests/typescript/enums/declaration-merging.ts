/*---
description: Two declarations of one enum merge into one object.
features: [ts-enum, ts-declaration-merging]
---*/
enum Tone { Low }
enum Tone { High = 1 }
assert.sameValue(Tone.Low, 0);
assert.sameValue(Tone.High, 1);
assert.sameValue(Tone[1], "High");
