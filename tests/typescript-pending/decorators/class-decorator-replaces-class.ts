/*---
description: A class decorator receives the class and its context, and the class it returns replaces the declaration's binding.
features: [ts-decorators, ts-class]
---*/
const seen: string[] = [];
function stamped<T extends new (...args: any[]) => object>(target: T, context: ClassDecoratorContext<T>) {
  seen.push(`${context.kind}:${String(context.name)}`);
  return class extends target {
    stamp = "stamped";
  };
}
@stamped
class Report {
  title = "r";
}
const report = new Report() as Report & { stamp: string };
assert.compareArray(seen, ["class:Report"]);
assert.sameValue(report.stamp, "stamped");
assert.sameValue(report.title, "r");
assert.sameValue(Object.getPrototypeOf(Report.prototype).constructor.name, "Report");
