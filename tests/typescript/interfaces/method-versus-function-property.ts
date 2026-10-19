/*---
description: A method member and a function-valued property member are both called the same way; only the method may use `this` from a literal's shorthand.
features: [ts-interfaces, ts-this]
---*/
interface Greeter {
  prefix: string;
  greet(who: string): string;
  shout: (who: string) => string;
}
const greeter: Greeter = {
  prefix: "hi",
  greet(who) {
    return `${this.prefix} ${who}`;
  },
  shout: (who) => who.toUpperCase(),
};
assert.sameValue(greeter.greet("ann"), "hi ann");
assert.sameValue(greeter.shout("ann"), "ANN");
const other = { prefix: "yo", greet: greeter.greet };
assert.sameValue(other.greet("bo"), "yo bo");
