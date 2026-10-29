import {convertHelpers} from "./fp/convert-types.ts";
import {isLodashFP} from "../../lodash-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/lodash/fp.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../webpack.ts";
import {load as load0} from "./lodash.min.ts";
import {load as load1} from "./fp/_baseConvert.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lodash/fp.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isLodashFP(value);
}
function initialize() {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


var _ = (load0().runInContext)();
module.exports = load1()(convertHelpers(_), _);


/***/ 
const result: unknown = module.exports;
if (!isLodashFP(result)) throw new TypeError("Expected the bundled Lodash FP exports");
return result;
}
