// The control for a-pad-given-an-undefined-fill, differing in one thing: the
// fill argument is omitted rather than `undefined`. Agrees with node.
observe("padEnd", "abc".padEnd(5));
done();
