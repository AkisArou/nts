/*---
description: "reduceRight with an initial value visits the last element first and never calls back for empty input through an interface with two array implementations."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-interfaces, ts-arrow-functions]
---*/
// reduceRight with an initial value visits the last element first and never calls back for empty input; route: an interface with two array implementations.
// Node prints: callbacks-reduceright-initial-interface:ok
interface RightSource { values(): string[] }
class RightLetters implements RightSource { values(): string[] { return ["a", "b", "c"]; } }
class RightEmpty implements RightSource { values(): string[] { return []; } }
class RightSingle implements RightSource { values(): string[] { return ["q"]; } }
function run(source: RightSource, expected: string, visits: string[]): void {
  const items = source.values(), log: string[] = [];
  const callback = (text: string, value: string, index: number, owner: string[]): string => {
    log[log.length] = index + ":" + text + ":" + value + ":" + (owner === items);
    return text + value;
  };
  const result = items.reduceRight(callback, "!");
  assert.sameValue(result, expected); assert.compareArray(log, visits);
}
run(new RightLetters(), "!cba", ["2:!:c:true", "1:!c:b:true", "0:!cb:a:true"]);
run(new RightEmpty(), "!", []);
run(new RightSingle(), "!q", ["0:!:q:true"]);
console.log("callbacks-reduceright-initial-interface:ok");
