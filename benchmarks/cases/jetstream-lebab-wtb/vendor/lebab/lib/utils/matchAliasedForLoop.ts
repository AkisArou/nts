import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/utils/matchAliasedForLoop.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "./isEqualAst.ts";
import {load as load1} from "../../../f-matches/index.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/utils/matchAliasedForLoop.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof _default; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = _default;
var _isEqualAst = _interopRequireDefault(load0());
var _fMatches = load1();
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
// Matches <ident>++ or ++<ident>
var matchPlusPlus = (0, _fMatches.matches)({
  type: 'UpdateExpression',
  operator: '++',
  argument: (0, _fMatches.extract)('indexIncrement', {
    type: 'Identifier'
  })
});

// Matches <ident>+=1
var matchPlusOne = (0, _fMatches.matches)({
  type: 'AssignmentExpression',
  operator: '+=',
  left: (0, _fMatches.extract)('indexIncrement', {
    type: 'Identifier'
  }),
  right: {
    type: 'Literal',
    value: 1
  }
});

// Matches the first element in array pattern
// The default matches() tries to match against any array element.
var matchesFirst = function matchesFirst(patterns: unknown[]) {
  return function (array: unknown) {
    return (0, _fMatches.matches)(patterns[0], readProperty(array, 0));
  };
};

// Matches for-loop
// without checking the consistency of index and array variables:
//
// for (let index = 0; indexComparison < array.length; indexIncrement++) {
//     let item = arrayReference[indexReference];
//     ...
// }
var matchLooseForLoop = (0, _fMatches.matches)({
  type: 'ForStatement',
  init: {
    type: 'VariableDeclaration',
    declarations: (0, _fMatches.matchesLength)([{
      type: 'VariableDeclarator',
      id: (0, _fMatches.extract)('index', {
        type: 'Identifier'
      }),
      init: {
        type: 'Literal',
        value: 0
      }
    }]),
    kind: (0, _fMatches.extractAny)('indexKind')
  },
  test: {
    type: 'BinaryExpression',
    operator: '<',
    left: (0, _fMatches.extract)('indexComparison', {
      type: 'Identifier'
    }),
    right: {
      type: 'MemberExpression',
      computed: false,
      object: (0, _fMatches.extractAny)('array'),
      property: {
        type: 'Identifier',
        name: 'length'
      }
    }
  },
  update: function update(node: AstNode) {
    return matchPlusPlus(node) || matchPlusOne(node);
  },
  body: (0, _fMatches.extract)('body', {
    type: 'BlockStatement',
    body: matchesFirst([{
      type: 'VariableDeclaration',
      declarations: [{
        type: 'VariableDeclarator',
        id: (0, _fMatches.extract)('item', {
          type: 'Identifier'
        }),
        init: {
          type: 'MemberExpression',
          computed: true,
          object: (0, _fMatches.extractAny)('arrayReference'),
          property: (0, _fMatches.extract)('indexReference', {
            type: 'Identifier'
          })
        }
      }],
      kind: (0, _fMatches.extractAny)('itemKind')
    }])
  })
});
function isConsistentIndexVar(_ref: Record<string, unknown>) {
  var index = _ref.index,
    indexComparison = _ref.indexComparison,
    indexIncrement = _ref.indexIncrement,
    indexReference = _ref.indexReference;
  return (0, _isEqualAst["default"])(index, indexComparison) && (0, _isEqualAst["default"])(index, indexIncrement) && (0, _isEqualAst["default"])(index, indexReference);
}
function isConsistentArrayVar(_ref2: Record<string, unknown>) {
  var array = _ref2.array,
    arrayReference = _ref2.arrayReference;
  return (0, _isEqualAst["default"])(array, arrayReference);
}

/**
 * Matches for-loop that aliases current array element
 * in the first line of the loop body:
 *
 *     for (let index = 0; index < array.length; index++) {
 *         let item = array[index];
 *         ...
 *     }
 *
 * Extracts the following fields:
 *
 * - index - loop index identifier
 * - indexKind - the kind of <index>
 * - array - array identifier or expression
 * - item - identifier used to alias current array element
 * - itemKind - the kind of <item>
 * - body - the whole BlockStatement of for-loop body
 *
 * @param  {Object} node
 * @return {Object}
 */
function _default(ast: AstNode) {
  var match = matchLooseForLoop(ast);
  if (match && isConsistentIndexVar(match) && isConsistentArrayVar(match)) {
    return match;
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
