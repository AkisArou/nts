/*---
description: A decorator factory takes arguments and returns the decorator; each use gets its own closure.
features: [ts-decorators, ts-class, ts-closures]
---*/
const routes: string[] = [];
function route(path: string) {
  return function <This, R>(target: (this: This) => R, context: ClassMethodDecoratorContext<This, (this: This) => R>) {
    routes.push(`${path} -> ${String(context.name)}`);
    return target;
  };
}
class Controller {
  @route("/")
  index(): string {
    return "home";
  }
  @route("/about")
  about(): string {
    return "about";
  }
}
assert.compareArray(routes, ["/ -> index", "/about -> about"]);
assert.sameValue(new Controller().about(), "about");
