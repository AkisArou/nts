/*---
description: A bare attribute is true, a hyphenated name is a string key, and string attributes keep their text undecoded of JavaScript escapes.
features: [ts-jsx]
---*/
type VNode = { props: Record<string, unknown> };
declare namespace JSX {
  type Element = VNode;
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
function h(_tag: string, props: Record<string, unknown> | null): VNode {
  return { props: props ?? {} };
}
const node = <input disabled data-id="7" aria-label="a\nb" value={"a\nb"} />;
assert.sameValue(node.props.disabled, true);
assert.sameValue(node.props["data-id"], "7");
assert.sameValue(node.props["aria-label"], "a\\nb");
assert.sameValue(node.props.value, "a\nb");
