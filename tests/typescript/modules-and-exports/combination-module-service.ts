/*---
description: A module exporting an interface, an abstract class, a default subclass and a namespace of helpers, used together.
features: [ts-modules, ts-exports, ts-interfaces, ts-abstract, ts-class, ts-namespace]
flags: [module]
---*/
export interface Logger {
  lines: string[];
}
export abstract class Service implements Logger {
  lines: string[] = [];
  abstract run(input: number): number;
  log(text: string): void {
    this.lines.push(text);
  }
}
export default class Doubler extends Service {
  run(input: number): number {
    this.log(`run ${input}`);
    return Helpers.twice(input);
  }
}
export namespace Helpers {
  export const twice = (n: number): number => n * 2;
}
const service: Service = new Doubler();
assert.sameValue(service.run(21), 42);
assert.compareArray(service.lines, ["run 21"]);
