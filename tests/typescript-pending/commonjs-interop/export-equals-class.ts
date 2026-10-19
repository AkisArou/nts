/*---
description: A module whose `export =` is a class is imported as a constructor, with its statics.
features: [ts-commonjs, ts-export-equals, ts-import-require, ts-class]
---*/
import Shape = require("./shape_FIXTURE.js");
const triangle = new Shape(3);
const square: Shape = new Shape(4);
assert.sameValue(triangle.sides + square.sides, 7);
assert.sameValue(Shape.created, 2);
assert.sameValue(triangle instanceof Shape, true);
