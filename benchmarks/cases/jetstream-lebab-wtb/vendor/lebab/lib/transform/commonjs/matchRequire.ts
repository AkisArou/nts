import {matchedArray, classNode} from "./runtime.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/commonjs/matchRequire.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../utils/isString.ts";
import {load as load1} from "../../../../f-matches/index.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/commonjs/matchRequire.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["matchRequire"] !== undefined && value["matchRequireWithProperty"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "matchRequire"?: typeof matchRequire; "matchRequireWithProperty"?: typeof matchRequireWithProperty; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports.matchRequireWithProperty = exports.matchRequire = void 0;
var _isString = _interopRequireDefault(load0());
var _fMatches = load1();
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var isIdentifier = (0, _fMatches.matches)({
  type: 'Identifier'
});

// matches Property with Identifier key and value (possibly shorthand)
var isSimpleProperty = (0, _fMatches.matches)({
  type: 'Property',
  key: isIdentifier,
  computed: false,
  value: isIdentifier
});

// matches: {a, b: myB, c, ...}
var isObjectPattern = (0, _fMatches.matches)({
  type: 'ObjectPattern',
  properties: function properties(props: unknown) {
    return matchedArray(props).every(isSimpleProperty);
  }
});

// matches: require(<source>)
var matchRequireCall = (0, _fMatches.matches)({
  type: 'CallExpression',
  callee: {
    type: 'Identifier',
    name: 'require'
  },
  arguments: (0, _fMatches.extract)('sources', function (args: unknown) {
    return readProperty(args, "length") === 1 && (0, _isString["default"])(classNode(readProperty(args, 0)));
  })
});

/**
 * Matches: <id> = require(<source>);
 */
var matchRequire = (0, _fMatches.matches)({
  type: 'VariableDeclarator',
  id: (0, _fMatches.extract)('id', function (id: unknown) {
    return isIdentifier(id) || isObjectPattern(id);
  }),
  init: matchRequireCall
});

/**
 * Matches: <id> = require(<source>).<property>;
 */
exports.matchRequire = matchRequire;
var matchRequireWithProperty = (0, _fMatches.matches)({
  type: 'VariableDeclarator',
  id: (0, _fMatches.extract)('id', isIdentifier),
  init: {
    type: 'MemberExpression',
    computed: false,
    object: matchRequireCall,
    property: (0, _fMatches.extract)('property', {
      type: 'Identifier'
    })
  }
});
exports.matchRequireWithProperty = matchRequireWithProperty;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["matchRequire","matchRequireWithProperty"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
