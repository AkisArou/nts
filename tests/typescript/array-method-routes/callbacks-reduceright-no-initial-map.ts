/*---
description: "reduceRight starts with the last value and folds remaining values from right to left through arrays read from a typed Map."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-map-set, ts-arrow-functions]
---*/
// reduceRight starts with the last value and folds remaining values from right to left; route: arrays read from a typed Map.
// Node prints: callbacks-reduceright-no-initial-map:ok
const sources: Map<string, string[]> = new Map([["letters", ["a", "b", "c"]], ["words", ["left", "right"]]]);
for (const key of ["letters", "words"]) {
  const items = sources.get(key); if (items === undefined) throw new Error("missing items");
  const log: string[] = [];
  const callback = (text: string, value: string, index: number, owner: string[]): string => {
    log[log.length] = index + ":" + text + ":" + value + ":" + (owner === items);
    return text + value;
  };
  const result = items.reduceRight(callback);
  assert.sameValue(result, key === "letters" ? "cba" : "rightleft");
  assert.compareArray(log, key === "letters" ? ["1:c:b:true", "0:cb:a:true"] : ["0:right:left:true"]);
}
console.log("callbacks-reduceright-no-initial-map:ok");
