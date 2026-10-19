/*---
description: A JSX fragment calls the factory with the fragment factory as its tag and its children.
features: [ts-jsx]
---*/
type VNode = { tag: unknown; children: unknown[] };
declare namespace JSX {
  type Element = VNode;
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
function Fragment(props: { children?: unknown[] }): VNode {
  return { tag: "fragment", children: props.children ?? [] };
}
function h(tag: unknown, _props: unknown, ...children: unknown[]): VNode {
  return { tag, children };
}
const group = (
  <>
    <b>one</b>
    two
  </>
);
assert.sameValue(group.tag, Fragment);
assert.sameValue(group.children.length, 2);
assert.sameValue((group.children[0] as VNode).tag, "b");
