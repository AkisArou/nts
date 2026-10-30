/*---
description: The 16th object link reaches the same shrunk array; read is undefined.
features: [ts-proof-bounds, ts-route-chain, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is below the literal length before sixteen distinct fields carry its alias.
// The 16th object link reaches the same shrunk array; read is undefined.
function read(change: number): number | undefined {
  const xs = [11, 22, 33, 44];
  const spare = [55, 66, 77, 88];
  const links = { p0: spare, p1: spare, p2: spare, p3: spare, p4: spare, p5: spare, p6: spare, p7: spare, p8: spare, p9: spare, p10: spare, p11: spare, p12: spare, p13: spare, p14: spare, p15: spare };
  const index = 3;
  links.p0 = xs;
  links.p1 = links.p0;
  links.p2 = links.p1;
  links.p3 = links.p2;
  links.p4 = links.p3;
  links.p5 = links.p4;
  links.p6 = links.p5;
  links.p7 = links.p6;
  links.p8 = links.p7;
  links.p9 = links.p8;
  links.p10 = links.p9;
  links.p11 = links.p10;
  links.p12 = links.p11;
  links.p13 = links.p12;
  links.p14 = links.p13;
  links.p15 = links.p14;
  if (change > 0) links.p15.pop();
  return xs[index];
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
