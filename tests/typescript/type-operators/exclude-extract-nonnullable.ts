/*---
description: Exclude, Extract and NonNullable type the results of run-time filters over a union.
features: [ts-type-operators, ts-conditional-types, ts-utility-types, ts-type-guards]
---*/
type Value = string | number | null | undefined;
const values: Value[] = ["a", 1, null, "b", undefined, 2];
const present: NonNullable<Value>[] = values.filter((v): v is NonNullable<Value> => v != null);
const texts: Extract<Value, string>[] = values.filter((v): v is string => typeof v === "string");
const others: Exclude<Value, string>[] = values.filter((v): v is Exclude<Value, string> => typeof v !== "string");
assert.sameValue(present.length, 4);
assert.sameValue(texts.join(""), "ab");
assert.sameValue(others.length, 4);
