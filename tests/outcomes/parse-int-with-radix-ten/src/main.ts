// The control for parse-int-with-an-infinite-radix: radix 10 written out.
// Agrees with node.
observe("parseInt(11, 10)", String(parseInt("11", 10)));
done();
