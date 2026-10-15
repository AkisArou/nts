// An absent record entry is undefined, whether the key is a string or a
// symbol. The control changes only an existing string key to a missing one;
// the symbol sibling reaches the same absent-key contract. This slice leaves
// the pre-existing numeric-result narrowing defect recorded for a later fix.
function read(values: Record<string, number>, key: any): number { return values[key]; }
const values: Record<string, number> = { present: 7 };
observe("existing string control", String(read(values, "present")));
observe("missing string", String(read(values, "missing")));
observe("missing symbol", String(read(values, Symbol("missing"))));
done();
