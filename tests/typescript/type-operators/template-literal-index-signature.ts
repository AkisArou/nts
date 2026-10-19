/*---
description: An index signature keyed by a template literal type accepts matching keys added at run time.
features: [ts-type-operators, ts-template-literal-types, ts-index-signatures]
---*/
type DataAttributes = { [key: `data-${string}`]: string; id: string };
const attributes: DataAttributes = { id: "main", "data-role": "button" };
attributes["data-state"] = "on";
const dataKeys = Object.keys(attributes).filter((key) => key.startsWith("data-"));
assert.sameValue(dataKeys.join(","), "data-role,data-state");
assert.sameValue(attributes["data-state"], "on");
