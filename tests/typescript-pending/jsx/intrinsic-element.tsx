/*---
description: An intrinsic JSX element calls the factory with its tag name, its attributes as an object, and its children.
features: [ts-jsx]
---*/
type VNode = { tag: string | Function; props: Record<string, unknown> | null; children: unknown[] };
declare namespace JSX {
  type Element = VNode;
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
function h(tag: string | Function, props: Record<string, unknown> | null, ...children: unknown[]): VNode {
  return { tag, props, children };
}
const node = <p id="intro" title={"t" + 1}>hello</p>;
assert.sameValue(node.tag, "p");
assert.sameValue(node.props?.id, "intro");
assert.sameValue(node.props?.title, "t1");
assert.compareArray(node.children, ["hello"]);
const empty = <br />;
assert.sameValue(empty.props, null);
assert.sameValue(empty.children.length, 0);
