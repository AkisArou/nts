/*---
description: Spread attributes merge into the props object in order, later attributes overriding earlier ones.
features: [ts-jsx, ts-spread]
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
const base: { id?: string; role: string } = { id: "a", role: "button" };
const node = <div {...base} id="b" tabIndex={0} />;
const before = <div id="b" {...base} />;
assert.sameValue(node.props.id, "b");
assert.sameValue(node.props.role, "button");
assert.sameValue(node.props.tabIndex, 0);
assert.sameValue(before.props.id, "a");
