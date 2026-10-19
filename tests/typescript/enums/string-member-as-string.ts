/*---
description: A string enum member is a string, with every string method.
features: [ts-enum, ts-enum-string]
---*/
enum Greeting { Hello = "hello", Bye = "bye" }
const text: string = Greeting.Hello;
assert.sameValue(text === "hello", true);
assert.sameValue(Greeting.Bye.toUpperCase(), "BYE");
assert.sameValue(Greeting.Hello.length, 5);
