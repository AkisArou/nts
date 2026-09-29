// The control for parse-int-after-a-line-separator: a leading space, which
// every whitespace set includes. Agrees with node.
observe("parseInt( 1)", String(parseInt(" 1")));
done();
