// Exact module body from JetStream 3.0 ./node_modules/assert/build/internal/errors.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, readProperty, runtimeCallable, runtimeCall, runtimeConstructor, boundSetPrototypeOf, symbolValue} from "../../../../webpack.ts";
import type {Descriptor} from "../../../../webpack.ts";
import {load as load0} from "../assert.ts";
import {load as load1} from "../../../util/util.ts";

import {helperConstructor, constructRoutine, errorConstruction, propertyObject, stringValue, numericValue, concatValue, readyAssert, isAssertAPI, isErrorCodes, stderrValue, errorCodeInstance} from "../runtime.ts";
import type {HelperConstructor, ConstructRoutine, ErrorConstruction, ErrorCode, ErrorCodes, ErrorCodeConstructor, ErrorMessage, AssertionOptions, AssertAPI, DeepComparison} from "../runtime.ts";

function arrayStrings(value: unknown): string[] { if (!isStringArray(value)) throw new TypeError("Expected the mapped error strings"); return value; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item: unknown) => typeof item === "string"); }

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for assert/build/internal/errors.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is {codes: ErrorCodes} {
 return isRecord(value) && isErrorCodes(value.codes);
}
function initialize() {
const exports: {codes?: ErrorCodes} = {};
let module = {exports};
cache = module;


"use strict";
// Currently in sync with Node.js lib/internal/errors.js
// https://github.com/nodejs/node/commit/3b044962c48fe313905877a96b5d0894a5404f6f

/* eslint node-core/documented-errors: "error" */
/* eslint node-core/alphabetize-errors: "error" */
/* eslint node-core/prefer-util-format-errors: "error" */



// The whole point behind this internal module is to allow Node.js to no
// longer be forced to treat every error message change as a semver-major
// change. The NodeError classes here all expose a `code` property whose
// value statically and permanently identifies the error. While the error
// message may change, the code should not.
var _typeof: (o: unknown) => string = function (o: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o: unknown) { return typeof o; } : function (o: unknown) { return o && "function" == typeof Symbol && readProperty(o, "constructor") === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); };
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<C extends {prototype: object}>(Constructor: C, protoProps?: Descriptor[], staticProps?: Descriptor[]): C { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = readProperty(input, Symbol.toPrimitive); if (prim !== undefined) { var res = runtimeCallable(prim).call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
function _classCallCheck(instance: object, Constructor: HelperConstructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _inherits(subClass: HelperConstructor, superClass: HelperConstructor | null): void { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } /* The class has a non-writable prototype property; retain the original parent and constructor descriptor on that same prototype object. */ Object.setPrototypeOf(subClass.prototype, superClass && superClass.prototype); Object.defineProperty(subClass.prototype, "constructor", { value: subClass, writable: true, configurable: true }); Object.defineProperty(subClass, "prototype", { writable: false }); if (superClass) _setPrototypeOf(subClass, superClass); }
var _setPrototypeOf: (o: object, p: object | null) => object = function (o: object, p: object | null): object { _setPrototypeOf = Boolean(Object.setPrototypeOf) ? boundSetPrototypeOf(runtimeCall(Object.setPrototypeOf.bind, Object.setPrototypeOf, [])) : function _setPrototypeOf(o: object, p: object | null) { record(o).__proto__ = p; return o; }; return _setPrototypeOf(o, p); };
function _createSuper(Derived: HelperConstructor): (this: object, ...args: unknown[]) => object { var hasNativeReflectConstruct = _isNativeReflectConstruct(); return function _createSuperInternal(this: object) { var Super = helperConstructor(_getPrototypeOf(Derived)), result: unknown; if (hasNativeReflectConstruct) { var NewTarget = helperConstructor(readProperty(_getPrototypeOf(this), "constructor")); result = Reflect.construct(Super, arguments, NewTarget); } else { result = Super.apply(this, arguments); } return _possibleConstructorReturn(this, result); }; }
function _possibleConstructorReturn(self: object, call?: unknown): object { if (call && (_typeof(call) === "object" || typeof call === "function")) { return record(call); } else if (call !== void 0) { throw new TypeError("Derived constructors may only return object or undefined"); } return _assertThisInitialized(self); }
function _assertThisInitialized<T>(self: T): T { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }
function _isNativeReflectConstruct(): boolean { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (readProperty(Reflect.construct, "sham")) return false; if (typeof Proxy === "function") return true; try { Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); return true; } catch (e) { return false; } }
var _getPrototypeOf: (o: object) => unknown = function (o: object): unknown { _getPrototypeOf = Boolean(Object.setPrototypeOf) ? runtimeCallable(runtimeCall(Object.getPrototypeOf.bind, Object.getPrototypeOf, [])) : function _getPrototypeOf(o: object): unknown { return record(o).__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); };
var codes: Partial<ErrorCodes> = {};

// Lazy loaded
var assert: AssertAPI | undefined;
var util: ReturnType<typeof load1> | undefined;
function createErrorType(code: ErrorCode, message: unknown, Base?: ErrorConstructor, ...ignored: unknown[]): void;
function createErrorType(code: ErrorCode, message: unknown, Base?: ErrorConstructor): void {
  if (!Base) {
    Base = Error;
  }
  function getMessage(arg1?: unknown, arg2?: unknown, arg3?: unknown): string {
    if (typeof message === 'string') {
      return message;
    } else {
      return stringValue(runtimeCallable(message)(arg1, arg2, arg3));
    }
  }
  var NodeError = /*#__PURE__*/function (_Base: ErrorConstructor) {
    var _super: (this: object, ...args: unknown[]) => object;
    class NodeError {
      declare name: string;
      declare message: string;
      declare stack?: string;
      declare code: string;
    constructor(arg1?: unknown, arg2?: unknown, arg3?: unknown) {
      var _this: ErrorConstruction;
      _classCallCheck(this, helperConstructor(NodeError));
      _this = errorConstruction(_super.call(this, getMessage(arg1, arg2, arg3)));
      _this.code = code;
      return errorCodeInstance(_this);
    }
    }
    _inherits(helperConstructor(NodeError), helperConstructor(_Base));
    _super = _createSuper(helperConstructor(NodeError));
    return _createClass(NodeError);
  }(Base);
  codes[code] = NodeError;
}

// https://github.com/nodejs/node/blob/v10.8.0/lib/internal/errors.js
function oneOf(expected: unknown, thing: string) {
  if (Array.isArray(expected)) {
    var len = expected.length;
    expected = expected.map(function (i: unknown) {
      return String(i);
    });
    if (len > 2) {
      return "one of ".concat(thing, " ").concat(arrayStrings(expected).slice(0, len - 1).join(', '), ", or ") + arrayStrings(expected)[len - 1];
    } else if (len === 2) {
      return "one of ".concat(thing, " ").concat(arrayStrings(expected)[0], " or ").concat(arrayStrings(expected)[1]);
    } else {
      return "of ".concat(thing, " ").concat(arrayStrings(expected)[0]);
    }
  } else {
    return "of ".concat(thing, " ").concat(String(expected));
  }
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith
function startsWith(str: string, search: string, pos?: number) {
  return str.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/endsWith
function endsWith(str: string, search: string, this_len?: number) {
  if (this_len === undefined || this_len > str.length) {
    this_len = str.length;
  }
  return str.substring(this_len - search.length, this_len) === search;
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/includes
function includes(str: string, search: string, start?: number) {
  if (typeof start !== 'number') {
    start = 0;
  }
  if (start + search.length > str.length) {
    return false;
  } else {
    return str.indexOf(search, start) !== -1;
  }
}
createErrorType('ERR_AMBIGUOUS_ARGUMENT', 'The "%s" argument is ambiguous. %s', TypeError);
createErrorType('ERR_INVALID_ARG_TYPE', function (name: string, expected: unknown, actual: unknown) {
  if (assert === undefined) assert = load0();
  assert(typeof name === 'string', "'name' must be a string");

  // determiner: 'must be' or 'must not be'
  var determiner: string;
  if (typeof expected === 'string' && startsWith(expected, 'not ')) {
    determiner = 'must not be';
    expected = expected.replace(/^not /, '');
  } else {
    determiner = 'must be';
  }
  var msg: string;
  if (endsWith(name, ' argument')) {
    // For cases like 'first argument'
    msg = "The ".concat(name, " ").concat(determiner, " ").concat(oneOf(expected, 'type'));
  } else {
    var type = includes(name, '.') ? 'property' : 'argument';
    msg = "The \"".concat(name, "\" ").concat(type, " ").concat(determiner, " ").concat(oneOf(expected, 'type'));
  }

  // TODO(BridgeAR): Improve the output by showing `null` and similar.
  msg += ". Received type ".concat(_typeof(actual));
  return msg;
}, TypeError);
createErrorType('ERR_INVALID_ARG_VALUE', function (name: string, value: unknown) {
  var reason: unknown = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'is invalid';
  if (util === undefined) util = load1();
  var inspected = util.inspect(value);
  if (inspected.length > 128) {
    inspected = "".concat(inspected.slice(0, 128), "...");
  }
  return "The argument '".concat(name, "' ").concat(concatValue(reason), ". Received ").concat(inspected);
}, TypeError, RangeError);
createErrorType('ERR_INVALID_RETURN_VALUE', function (input: string, name: string, value: unknown) {
  var type: string;
  if (value && readProperty(value, "constructor") && readProperty(readProperty(value, "constructor"), "name")) {
    type = "instance of ".concat(concatValue(readProperty(readProperty(value, "constructor"), "name")));
  } else {
    type = "type ".concat(_typeof(value));
  }
  return "Expected ".concat(input, " to be returned from the \"").concat(name, "\"") + " function but got ".concat(type, ".");
}, TypeError);
createErrorType('ERR_MISSING_ARGS', function () {
  for (var _len = arguments.length, args = new Array<unknown>(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }
  if (assert === undefined) assert = load0();
  assert(args.length > 0, 'At least one arg needs to be specified');
  var msg = 'The ';
  var len = args.length;
  args = args.map(function (a: unknown) {
    return "\"".concat(concatValue(a), "\"");
  });
  switch (len) {
    case 1:
      msg += "".concat(concatValue(args[0]), " argument");
      break;
    case 2:
      msg += "".concat(concatValue(args[0]), " and ").concat(concatValue(args[1]), " arguments");
      break;
    default:
      msg += args.slice(0, len - 1).join(', ');
      msg += ", and ".concat(concatValue(args[len - 1]), " arguments");
      break;
  }
  return "".concat(msg, " must be specified");
}, TypeError);
if (!isErrorCodes(codes)) throw new TypeError("Incomplete NodeError registry");
module.exports.codes = codes;

/***/ 
if (!isExport(exports)) throw new TypeError("Incomplete NodeError export");
return exports;
}
