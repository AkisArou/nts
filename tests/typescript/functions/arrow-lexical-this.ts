/*---
description: An arrow function inside a method uses the method's `this`; a function expression does not.
features: [ts-functions, ts-arrow-functions, ts-this, ts-class]
---*/
class Team {
  members = ["a", "b"];
  prefix = "team-";
  labels(): string[] {
    return this.members.map((m) => this.prefix + m);
  }
  unbound(): (m: string) => string {
    return function (this: { prefix?: string } | undefined, m: string): string {
      return (this?.prefix ?? "none-") + m;
    };
  }
}
const team = new Team();
assert.compareArray(team.labels(), ["team-a", "team-b"]);
assert.sameValue(team.unbound()("c"), "none-c");
