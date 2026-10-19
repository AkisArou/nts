/*---
description: An enum is a type a function takes and returns.
features: [ts-enum]
---*/
enum Level { Low = 1, Mid = 5, High = 9 }
function raise(level: Level): Level {
  return level === Level.Low ? Level.Mid : Level.High;
}
assert.sameValue(raise(Level.Low), Level.Mid);
assert.sameValue(raise(Level.Mid), Level.High);
