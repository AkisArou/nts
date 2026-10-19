/*---
description: Routes as a const tuple, a template literal type over them, a Record of handlers and a guard narrowing input.
features: [ts-literal-types, ts-as-const, ts-template-literal-types, ts-record, ts-type-guards, ts-indexed-access]
---*/
const ROUTES = ["home", "about", "contact"] as const;
type Route = (typeof ROUTES)[number];
type Path = `/${Route}`;
const titles: Record<Route, string> = { home: "Home", about: "About us", contact: "Write" };
function isPath(value: string): value is Path {
  return (ROUTES as readonly string[]).includes(value.slice(1)) && value.startsWith("/");
}
function title(path: string): string {
  return isPath(path) ? titles[path.slice(1) as Route] : "404";
}
assert.sameValue(title("/about"), "About us");
assert.sameValue(title("/missing"), "404");
assert.sameValue(title("home"), "404");
