import type * as K from "../../../../types/ast-types/gen/kinds.js";
import {classNode, classExpression, classText, programNode} from "./runtime-transforms.ts";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/template.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../traverser.ts";
import {load as load1} from "../syntax/TemplateLiteral.ts";
import {load as load2} from "../syntax/TemplateElement.ts";
import {load as load3} from "../utils/isString.ts";
import {load as load4} from "../../../lodash/fp.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/template.js");
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
var _TemplateLiteral = _interopRequireDefault(load1());
var _TemplateElement = _interopRequireDefault(load2());
var _isString = _interopRequireDefault(load3());
var _fp = load4();
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode) {
      if (isPlusExpression(node)) {
        var plusExpr = flattenPlusExpression(node);
        if (plusExpr.isString && !plusExpr.operands.every((_isString["default"]!))) {
          var literal = new (_TemplateLiteral["default"]!)(splitQuasisAndExpressions(plusExpr.operands));
          // Ensure correct order of comments by sorting them by their position in source
          literal.comments = (0, _fp.sortBy)('start', plusExpr.comments);
          return literal;
        }
      }
    }
  });
}

// Returns object of three fields:
// - operands: flat array of all the plus operation sub-expressions
// - comments: array of comments
// - isString: true when the result of the whole plus operation is a string
function flattenPlusExpression(node: AstNode): {operands: AstNode[]; comments: (K.CommentKind & {start?: number})[]; isString: boolean} {
  if (isPlusExpression(node)) {
    var left = flattenPlusExpression(node.left);
    var right = flattenPlusExpression(node.right);
    if (left.isString || right.isString) {
      return {
        operands: (0, _fp.flatten)([left.operands, right.operands]),
        comments: (0, _fp.flatten)([node.comments || [], left.comments, right.comments]),
        isString: true
      };
    } else {
      return {
        operands: [node],
        comments: node.comments || [],
        isString: false
      };
    }
  } else {
    return {
      operands: [node],
      comments: node.comments || [],
      isString: (0, _isString["default"])(node)
    };
  }
}
function isPlusExpression(node: AstNode): node is K.BinaryExpressionKind {
  return node.type === 'BinaryExpression' && node.operator === '+';
}
function splitQuasisAndExpressions(operands: AstNode[]) {
  var quasis: K.TemplateElementKind[] = [];
  var expressions: K.ExpressionKind[] = [];
  for (var i = 0; i < operands.length; i++) {
    var curr = operands[i];
    if ((0, _isString["default"])(curr)) {
      var currVal = curr.value;
      var currRaw = escapeForTemplate(classText(readProperty(curr, "raw")));
      while ((0, _isString["default"])(operands[i + 1] || {})) {
        i++;
        currVal += classText(readProperty(operands[i], "value"));
        currRaw += escapeForTemplate(classText(readProperty(operands[i], "raw")));
      }
      quasis.push(new (_TemplateElement["default"]!)({
        raw: currRaw,
        cooked: currVal
      }));
    } else {
      if (i === 0) {
        quasis.push(new (_TemplateElement["default"]!)({}));
      }
      if (!(0, _isString["default"])(operands[i + 1] || {})) {
        quasis.push(new (_TemplateElement["default"]!)({
          tail: operands[i + 1] === undefined
        }));
      }
      expressions.push(classExpression(curr));
    }
  }
  return {
    quasis: quasis,
    expressions: expressions
  };
}

// Strip surrounding quotes, escape backticks and unescape escaped quotes
function escapeForTemplate(raw: string) {
  return raw.replace(/^['"]|['"]$/g, '').replace(/`/g, '\\`').replace(/\\(['"])/g, '$1');
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
