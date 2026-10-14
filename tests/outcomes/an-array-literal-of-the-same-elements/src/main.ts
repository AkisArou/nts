// The control for an-array-constructed-from-its-elements: the same elements
// as a literal. Agrees with node.
const numbers = [0, 1, 2, 3];
observe("length", String(numbers.length));
observe("join", numbers.join(","));
done();
