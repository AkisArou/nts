import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import type {MatchResult} from "../../../../f-matches/index.ts";
import {classNode, classIdentifier, classVariableDeclaration, objectPattern, literalArray} from "./runtime.ts";
import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/commonjs/importCommonjs.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../traverser.ts";
import {load as load1} from "./isVarWithRequireCalls.ts";
import {load as load2} from "./matchRequire.ts";
import {load as load3} from "../../utils/multiReplaceStatement.ts";
import {load as load4} from "../../syntax/ImportDeclaration.ts";
import {load as load5} from "../../syntax/ImportSpecifier.ts";
import {load as load6} from "../../syntax/ImportDefaultSpecifier.ts";
import {load as load7} from "../../syntax/VariableDeclaration.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/commonjs/importCommonjs.js");
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
var _traverser = _interopRequireDefault(load0());
var _isVarWithRequireCalls = _interopRequireDefault(load1());
var _matchRequire = load2();
var _multiReplaceStatement = _interopRequireDefault(load3());
var _ImportDeclaration = _interopRequireDefault(load4());
var _ImportSpecifier = _interopRequireDefault(load5());
var _ImportDefaultSpecifier = _interopRequireDefault(load6());
var _VariableDeclaration = _interopRequireDefault(load7());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode, logger: LoggerLike) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode, parent: AstNode | null) {
      if ((0, _isVarWithRequireCalls["default"])(node)) {
        if (parent!.type !== 'Program') {
          logger.warn(node, 'import can only be at root level', 'commonjs');
          return;
        }
        (0, _multiReplaceStatement["default"])({
          parent: parent,
          node: node,
          replacements: classVariableDeclaration(node).declarations.map(function (dec) {
            return varToImport(dec, classVariableDeclaration(node).kind)!;
          }),
          preserveComments: true
        });
      }
    }
  });
}

// Converts VariableDeclarator to ImportDeclaration when we recognize it
// as such, otherwise converts it to full VariableDeclaration (of original kind).
function varToImport(dec: K.VariableDeclaratorKind | K.IdentifierKind, kind: "var" | "let" | "const") {
  var m: MatchResult;
  if (m = (0, _matchRequire.matchRequire)(dec)) {
    if (classNode(m.id).type === 'ObjectPattern') {
      return patternToNamedImport(m);
    } else if (classNode(m.id).type === 'Identifier') {
      return identifierToDefaultImport(m);
    }
  } else if (m = (0, _matchRequire.matchRequireWithProperty)(dec)) {
    if (classIdentifier(m.property).name === 'default') {
      return identifierToDefaultImport(m);
    }
    return propertyToNamedImport(m);
  } else {
    return new (_VariableDeclaration["default"]!)(kind, [dec]);
  }
}
function patternToNamedImport(_ref: Record<string, unknown>) {
  var id = objectPattern(_ref.id),
    sources = literalArray(_ref.sources);
  return new (_ImportDeclaration["default"]!)({
    specifiers: id.properties.map(function (_ref2) {
      var key = classIdentifier(readProperty(_ref2, "key")),
        value = classIdentifier(readProperty(_ref2, "value"));
      return createImportSpecifier({
        local: value,
        imported: key
      });
    }),
    source: sources[0]
  });
}
function identifierToDefaultImport(_ref3: Record<string, unknown>) {
  var id = classIdentifier(_ref3.id),
    sources = literalArray(_ref3.sources);
  return new (_ImportDeclaration["default"]!)({
    specifiers: [new (_ImportDefaultSpecifier["default"]!)(id)],
    source: sources[0]
  });
}
function propertyToNamedImport(_ref4: Record<string, unknown>) {
  var id = classIdentifier(_ref4.id),
    property = classIdentifier(_ref4.property),
    sources = literalArray(_ref4.sources);
  return new (_ImportDeclaration["default"]!)({
    specifiers: [createImportSpecifier({
      local: id,
      imported: property
    })],
    source: sources[0]
  });
}
function createImportSpecifier(_ref5: {local: K.IdentifierKind; imported: K.IdentifierKind}) {
  var local = _ref5.local,
    imported = _ref5.imported;
  if (imported.name === 'default') {
    return new (_ImportDefaultSpecifier["default"]!)(local);
  }
  return new (_ImportSpecifier["default"]!)({
    local: local,
    imported: imported
  });
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
