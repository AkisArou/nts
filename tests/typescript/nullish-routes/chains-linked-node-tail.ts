/*---
description: "A linked node walk stops when next is absent. Route: optional next field of linked nodes"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// A linked node walk stops when next is absent. Route: optional next field of linked nodes. Node prints chains-linked-node-tail:ok.
interface LinkNode { value: number; next?: LinkNode }
const tail: LinkNode = { value: 8 };
const head: LinkNode = { value: 1, next: tail };
function second(node: LinkNode): number | undefined {
  const result = node.next?.value;
  return result;
}
assert.sameValue(second(head), 8);
assert.sameValue(second(tail), undefined);
console.log("chains-linked-node-tail:ok");
