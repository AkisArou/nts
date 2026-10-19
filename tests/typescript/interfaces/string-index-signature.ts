/*---
description: An interface with a string index signature types a dictionary whose keys are added at run time.
features: [ts-interfaces, ts-index-signatures]
---*/
interface Scores {
  [player: string]: number;
}
const scores: Scores = {};
scores["ann"] = 3;
scores.bo = 5;
scores["ann"] += 4;
let total = 0;
for (const player in scores) total += scores[player];
assert.sameValue(total, 12);
assert.sameValue(Object.keys(scores).join(","), "ann,bo");
assert.sameValue(scores["nobody"], undefined);
