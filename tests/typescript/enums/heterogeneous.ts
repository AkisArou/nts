/*---
description: An enum may mix numeric and string members.
features: [ts-enum, ts-enum-string]
---*/
enum Answer { No = 0, Yes = "YES" }
assert.sameValue(Answer.No, 0);
assert.sameValue(Answer.Yes, "YES");
assert.sameValue(Answer[0], "No");
