/*---
description: A JSX element whose tag is a function passes the function itself to the factory, which calls it with the props.
features: [ts-jsx, ts-functions]
---*/
type VNode = { tag: string; text: string };
declare namespace JSX {
  type Element = VNode;
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
function h(tag: string | ((props: any) => VNode), props: Record<string, unknown> | null, ...children: unknown[]): VNode {
  if (typeof tag === "function") return tag({ ...props, children });
  return { tag, text: children.join("") };
}
function Greeting(props: { who: string; children?: unknown[] }): VNode {
  return { tag: "greeting", text: `hi ${props.who}${props.children?.length ?? 0}` };
}
const node = <Greeting who="kim">a{"b"}</Greeting>;
assert.sameValue(node.tag, "greeting");
assert.sameValue(node.text, "hi kim2");
