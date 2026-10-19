/*---
description: A return inside finally replaces the try block's return value and swallows its exception.
features: [ts-errors]
---*/
function override(): string {
  try {
    return "try";
  } finally {
    return "finally";
  }
}
function swallow(): string {
  try {
    throw new Error("lost");
  } finally {
    return "swallowed";
  }
}
assert.sameValue(override(), "finally");
assert.sameValue(swallow(), "swallowed");
