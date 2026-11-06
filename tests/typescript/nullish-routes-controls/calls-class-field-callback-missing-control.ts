/*---
description: "A nullable class field suppresses optional invocation when null. Route: class function-valued field (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A nullable class field suppresses optional invocation when null. Route: class function-valued field. Node prints calls-class-field-callback-missing:ok.
class Subscriber {
  handler: ((number: number) => number) | null;
  constructor(handler: ((number: number) => number) | null) { this.handler = handler; }
  send(value: number): number | undefined {
    const fn = this.handler; const result = fn === null || fn === undefined ? undefined : fn.call(this, value);
    return result;
  }
}
assert.sameValue(new Subscriber(null).send(2), undefined);
assert.sameValue(new Subscriber(n => n * 3).send(2), 6);
console.log("calls-class-field-callback-missing:ok");
