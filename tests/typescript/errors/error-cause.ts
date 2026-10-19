/*---
description: An error built with a cause keeps the original error as its cause property.
features: [ts-errors]
---*/
function parse(text: string): number {
  try {
    return JSON.parse(text) as number;
  } catch (cause) {
    throw new Error(`cannot parse ${text}`, { cause });
  }
}
try {
  parse("{");
  assert(false, "parse should throw");
} catch (error) {
  const outer = error as Error;
  assert.sameValue(outer.message, "cannot parse {");
  assert.sameValue(outer.cause instanceof SyntaxError, true);
}
