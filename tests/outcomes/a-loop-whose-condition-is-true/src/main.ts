// The control for a-loop-whose-condition-is-an-object, differing in the
// condition: `true` rather than `{}`. (The checker follows this flow, so the
// read needs no directive.) Agrees with node.
let seen = 0;
while (true) {
  var inner = 1;
  if (inner) break;
}
seen = inner;
observe("seen", String(seen));
done();
