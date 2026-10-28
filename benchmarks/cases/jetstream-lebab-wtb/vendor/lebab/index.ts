import type {Warning} from "../../ast.ts";
import type {AstNode, LoggerLike} from "../../ast.ts";
import type {Constructor, Descriptor} from "../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../webpack.ts";
import {load as load0} from "./lib/createTransformer.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/index.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value["transform"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "transform"?: (code: string, transformNames: string[]) => {code: string; warnings: Warning[]}; } = {};
let module = {exports};
cache = module;


const createTransformer = ((load0()["default"]!));

/**
 * Exposes API similar to Babel:
 *
 *     import lebab from "lebab";
 *     const {code, warnings} = lebab.transform('Some JS', ['let', 'arrow']);
 *
 * @param  {String} code The code to transform
 * @param  {String[]} transformNames The transforms to apply
 * @return {Object} An object with code and warnings props
 */
exports.transform = function(code: string, transformNames) {
  return createTransformer(transformNames).run(code);
};


/***/ 
if (!exportsReady(exports, ["transform"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
