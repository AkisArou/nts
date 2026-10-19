/*---
description: An `as const` object is deeply readonly in its type only; its values are literals and it is not frozen.
features: [ts-literal-types, ts-as-const, ts-readonly]
---*/
const theme = { colors: { primary: "#00f", accent: "#f0f" }, spacing: [4, 8] } as const;
const primary: "#00f" = theme.colors.primary;
assert.sameValue(primary, "#00f");
assert.sameValue(theme.spacing[1], 8);
assert.sameValue(Object.isFrozen(theme), false);
assert.sameValue(Object.isFrozen(theme.colors), false);
