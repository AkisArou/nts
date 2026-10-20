// An absent record entry is undefined, whether the key is a string or a
// symbol. The control changes only an existing string key to a missing one;
// the symbol sibling reaches the same absent-key contract. This slice leaves
// the pre-existing numeric-result narrowing defect recorded for a later fix.
//
// **Since 2026-10-21 it stops by name** where it read 0: an entry returned at
// a number is checked to be one first, and a missing key, string or symbol,
// ends the program with `refused at run time: an erased value read as a
// number, which it is not` on every backend (lower/entry_reads.rs). A
// consumer that only asks whether the entry is there answers from its tag
// instead: tests/programs/absent-record-keys-asked-whether-present.
function read(values: Record<string, number>, key: any): number { return values[key]; }
const values: Record<string, number> = { present: 7 };
observe("existing string control", String(read(values, "present")));
observe("missing string", String(read(values, "missing")));
observe("missing symbol", String(read(values, Symbol("missing"))));
done();
