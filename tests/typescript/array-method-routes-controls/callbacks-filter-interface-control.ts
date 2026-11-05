/*---
description: "filter retains selected values in original order and passes the exact receiver through an interface with two array suppliers. (control)"
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-interfaces, ts-arrow-functions]
---*/
function localFilter<T>(items: T[], callback: (value: T, index: number, owner: T[]) => boolean): T[] {
  const result: T[] = [];
  for (let index = 0; index < items.length; index++) if (callback(items[index], index, items)) result[result.length] = items[index];
  return result;
}
// filter retains selected values in original order and passes the exact receiver; route: an interface with two array suppliers.
// Node prints: callbacks-filter-interface:ok
interface FilterSource { items(): number[] }
class MixedSource implements FilterSource { items(): number[] { return [9, 2, 7, 4]; } }
class SmallSource implements FilterSource { items(): number[] { return [1, 3]; } }
function select(source: FilterSource, expected: number[], visits: string[]): void {
  const items = source.items(), log: string[] = [];
  const callback = (value: number, index: number, owner: number[]): boolean => {
    log[log.length] = index + ":" + value + ":" + (owner === items);
    return value > 3;
  };
  const result = localFilter(items, callback);
  assert.compareArray(result, expected); assert.compareArray(log, visits);
  assert.sameValue(result === items, false);
}
select(new MixedSource(), [9, 7, 4], ["0:9:true", "1:2:true", "2:7:true", "3:4:true"]);
select(new SmallSource(), [], ["0:1:true", "1:3:true"]);
console.log("callbacks-filter-interface:ok");
