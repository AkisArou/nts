/*---
description: A legacy parameter decorator receives the target, the method's key and the parameter's index.
features: [ts-legacy-decorators, ts-class]
---*/
const marks: string[] = [];
function trace(target: object, key: string | symbol | undefined, index: number): void {
  const owner = typeof target === "function" ? `static ${target.name}` : target.constructor.name;
  marks.push(`${owner}.${String(key)}[${index}]`);
}
class Mailer {
  constructor(@trace readonly host: string) {}
  send(@trace to: string, body: string, @trace retries: number): string {
    return `${to}:${body}:${retries}`;
  }
}
assert.compareArray(marks, ["Mailer.send[2]", "Mailer.send[0]", "static Mailer.undefined[0]"]);
assert.sameValue(new Mailer("h").send("a", "b", 1), "a:b:1");
