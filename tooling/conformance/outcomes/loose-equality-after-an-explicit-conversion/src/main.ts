// The control for the three loose-equality blockers (blockers/loose-equality-of-a-*): the same comparisons
// with the conversion IsLooselyEqual would make written out, so each side is
// one representation. Agrees with node -- the equality is fine; the implicit
// conversion across representations is what is missing.
observe("Number(true) == 1", String(Number(true) == 1));
observe("Number(\"1\") == 1", String(Number("1") == 1));
observe("1n == BigInt(1)", String(1n == BigInt(1)));
done();
