/*---
description: A namespace merged with an enum adds functions to the enum object.
features: [ts-enum, ts-namespace, ts-declaration-merging]
---*/
enum Weekday { Monday, Saturday = 5, Sunday }
namespace Weekday {
  export function isWeekend(day: Weekday): boolean {
    return day === Weekday.Saturday || day === Weekday.Sunday;
  }
}
assert.sameValue(Weekday.isWeekend(Weekday.Sunday), true);
assert.sameValue(Weekday.isWeekend(Weekday.Monday), false);
