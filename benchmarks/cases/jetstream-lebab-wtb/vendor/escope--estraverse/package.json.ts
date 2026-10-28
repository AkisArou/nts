// Exact module body from JetStream 3.0 ./node_modules/escope/node_modules/estraverse/package.json.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for escope--estraverse/package.json.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return value !== undefined;
}
function initialize() {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"name":"estraverse","description":"ECMAScript JS AST traversal functions","homepage":"https://github.com/estools/estraverse","main":"estraverse.js","version":"4.3.0","engines":{"node":">=4.0"},"maintainers":[{"name":"Yusuke Suzuki","email":"utatane.tea@gmail.com","web":"http://github.com/Constellation"}],"repository":{"type":"git","url":"http://github.com/estools/estraverse.git"},"devDependencies":{"babel-preset-env":"^1.6.1","babel-register":"^6.3.13","chai":"^2.1.1","espree":"^1.11.0","gulp":"^3.8.10","gulp-bump":"^0.2.2","gulp-filter":"^2.0.0","gulp-git":"^1.0.1","gulp-tag-version":"^1.3.0","jshint":"^2.5.6","mocha":"^2.1.0"},"license":"BSD-2-Clause","scripts":{"test":"npm run-script lint && npm run-script unit-test","lint":"jshint estraverse.js","unit-test":"mocha --compilers js:babel-register"}}');

/***/ 
return module.exports;
}
