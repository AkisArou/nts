/*---
description: JSX children are text, expressions and nested elements, passed in source order; whitespace-only lines are dropped.
features: [ts-jsx]
---*/
type VNode = { tag: string; children: unknown[] };
declare namespace JSX {
  type Element = VNode;
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
function h(tag: string, _props: unknown, ...children: unknown[]): VNode {
  return { tag, children };
}
const items = ["x", "y"];
const list = (
  <ul>
    first
    {items.length}
    <li>{items[0]}</li>
    {items.map((item) => <li>{item}</li>)}
  </ul>
);
assert.sameValue(list.children.length, 4);
assert.sameValue(list.children[0], "first");
assert.sameValue(list.children[1], 2);
assert.sameValue((list.children[2] as VNode).children[0], "x");
assert.sameValue((list.children[3] as VNode[]).length, 2);
