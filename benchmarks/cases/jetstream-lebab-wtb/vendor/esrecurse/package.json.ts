// Exact module body from JetStream 3.0 ./node_modules/esrecurse/package.json.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for esrecurse/package.json.js");
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
module.exports = /*#__PURE__*/JSON.parse('{"name":"esrecurse","description":"ECMAScript AST recursive visitor","homepage":"https://github.com/estools/esrecurse","main":"esrecurse.js","version":"4.3.0","engines":{"node":">=4.0"},"maintainers":[{"name":"Yusuke Suzuki","email":"utatane.tea@gmail.com","web":"https://github.com/Constellation"}],"repository":{"type":"git","url":"https://github.com/estools/esrecurse.git"},"dependencies":{"estraverse":"^5.2.0"},"devDependencies":{"babel-cli":"^6.24.1","babel-eslint":"^7.2.3","babel-preset-es2015":"^6.24.1","babel-register":"^6.24.1","chai":"^4.0.2","esprima":"^4.0.0","gulp":"^3.9.0","gulp-bump":"^2.7.0","gulp-eslint":"^4.0.0","gulp-filter":"^5.0.0","gulp-git":"^2.4.1","gulp-mocha":"^4.3.1","gulp-tag-version":"^1.2.1","jsdoc":"^3.3.0-alpha10","minimist":"^1.1.0"},"license":"BSD-2-Clause","scripts":{"test":"gulp travis","unit-test":"gulp test","lint":"gulp lint"},"babel":{"presets":["es2015"]}}');

/***/ 
return module.exports;
}
