/*---
description: An abstract class's concrete method calls an abstract one each subclass implements.
features: [ts-class, ts-abstract, ts-inheritance]
---*/
abstract class Summary {
  abstract body(): string;
  render(): string {
    return `[${this.body()}]`;
  }
}
class Short extends Summary {
  body(): string {
    return "s";
  }
}
class Long extends Summary {
  body(): string {
    return "long";
  }
}
const reports: Summary[] = [new Short(), new Long()];
assert.sameValue(reports.map((r) => r.render()).join(""), "[s][long]");
