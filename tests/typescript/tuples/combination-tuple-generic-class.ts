/*---
description: A generic class over a labelled tuple with an optional element, read through an interface and destructured.
features: [ts-tuples, ts-tuple-labels, ts-tuple-optional, ts-generics, ts-class, ts-interfaces]
---*/
interface Table<Row extends unknown[]> {
  rows(): Row[];
  add(...row: Row): this;
}
class MemoryTable<Row extends unknown[]> implements Table<Row> {
  private data: Row[] = [];
  rows(): Row[] {
    return this.data;
  }
  add(...row: Row): this {
    this.data.push(row);
    return this;
  }
}
type Person = [name: string, age: number, email?: string];
const people: Table<Person> = new MemoryTable<Person>().add("ann", 30).add("bo", 41, "bo@x");
const summary = people.rows().map(([who, age, email]) => `${who}${age}${email ? "+" : ""}`);
assert.sameValue(summary.join(","), "ann30,bo41+");
assert.sameValue(people.rows()[0].length, 2);
