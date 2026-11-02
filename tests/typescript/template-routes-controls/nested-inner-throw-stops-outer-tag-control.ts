/*---
description: "Explicit construction control: A throwing inner template substitution prevents later inner and outer operands and the enclosing typed tag call."
features: [ts-template-routes, ts-template-route-nesting-composition, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-strings, ts-unions, ts-null-undefined, ts-conversions, ts-to-string, ts-closures, ts-arrow-functions, ts-errors, ts-narrowing]
---*/
// The inner object conversion logs or throws its Error; Node runs both tails and the outer tag only on success, returning ALBI<payload>JTCRD. Control: use explicit strings and ordinary calls with frozen, reused arrays for each site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const seen: (TemplateStringsArray | undefined)[] = [];
function inspect(strings: TemplateStringsArray, site: number, parts: readonly string[]): void {
  assert.compareArray(strings, parts); assert.compareArray(strings.raw, parts); same(Object.isFrozen(strings), true); same(Object.isFrozen(strings.raw), true);
  if (seen[site] !== undefined) same(strings, seen[site]); seen[site] = strings;
}
function literal(parts: string[]): TemplateStringsArray { return Object.freeze(Object.assign(parts, { raw: Object.freeze(parts.slice()) })); }
const outerSite: TemplateStringsArray = literal(["A","B","C","D"]);
interface NestSource { value: string; fail: boolean; toString(): string }
const inputs: string[] = ["", "abc", "\n", "\ud83d\ude42", "\ud800"];
const log: unknown[] = [];
function read(label: string, text: string): string { log.push(label, text); return text; }
function object(source: NestSource): NestSource { log.push("object", source); return source; }
function outer(strings: TemplateStringsArray, left: string, inner: string, right: string): string {
  inspect(strings, 0, ["A", "B", "C", "D"]); log.push("outer", left, inner, right); return strings[0] + left + strings[1] + inner + strings[2] + right + strings[3];
}
function render(source: NestSource): string { const left = read("left", "L"); const inner = "I" + String(object(source)) + "J" + String(read("inner-tail", "T")); const right = read("outer-tail", "R"); return outer(outerSite, left, inner, right); }
for (const value of inputs) for (const fail of [false, true]) {
  log.length = 0; const problem = new Error("inner substitution");
  const source: NestSource = { value, fail, toString(): string { log.push("coerce", this.value); if (this.fail) { log.push("throw", problem); throw problem; } return this.value; } };
  let result: string | undefined = undefined;
  if (fail) {
    assert.throws(Error, () => { try { result = render(source); } catch (error: unknown) { same(error, problem); log.push("caught", error); throw error; } });
    same(result, undefined); exact(log, ["left", "L", "object", source, "coerce", value, "throw", problem, "caught", problem]);
  } else {
    result = render(source); same(result, "ALBI" + value + "JTCRD");
    exact(log, ["left", "L", "object", source, "coerce", value, "inner-tail", "T", "outer-tail", "R", "outer", "L", "I" + value + "JT", "R"]);
  }
  same(source.value, value); same(source.fail, fail);
}
