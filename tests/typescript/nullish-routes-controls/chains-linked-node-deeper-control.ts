/*---
description: "A skipped linked-node chain suppresses all remaining field reads. Route: optional next links and a required value (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// A skipped linked-node chain suppresses all remaining field reads. Route: optional next links and a required value. Node prints chains-linked-node-deeper:ok.
interface LinkNode { value: number; next?: LinkNode }
const third: LinkNode = { value: 9 };
const middle: LinkNode = { value: 4, next: third };
const head: LinkNode = { value: 1, next: middle };
function thirdValue(node: LinkNode): number | undefined {
  const first = node.next; const second = first === null || first === undefined ? undefined : first.next; const result = second === null || second === undefined ? undefined : second.value;
  return result;
}
assert.sameValue(thirdValue(head), 9);
assert.sameValue(thirdValue(middle), undefined);
console.log("chains-linked-node-deeper:ok");
