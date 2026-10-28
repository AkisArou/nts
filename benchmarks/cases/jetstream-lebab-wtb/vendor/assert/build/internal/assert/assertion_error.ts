// Exact module body from JetStream 3.0 ./node_modules/assert/build/internal/assert/assertion_error.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, readProperty, runtimeCallable, runtimeCall, runtimeConstructor, boundSetPrototypeOf, symbolValue} from "../../../../../webpack.ts";
import type {Descriptor} from "../../../../../webpack.ts";
import {load as load0} from "../../../../process/browser.ts";
import {load as load1} from "../../../../util/util.ts";
import {load as load2} from "../errors.ts";

import {helperConstructor, constructRoutine, errorConstruction, propertyObject, stringValue, numericValue, concatValue, readyAssert, isAssertAPI, isErrorCodes, stderrValue, assertionInstance} from "../../runtime.ts";
import type {HelperConstructor, ConstructRoutine, ErrorConstruction, ErrorCode, ErrorCodes, ErrorCodeConstructor, ErrorMessage, AssertionOptions, AssertAPI, DeepComparison, AssertionInstance, AssertionConstructor} from "../../runtime.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for assert/build/internal/assert/assertion_error.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is AssertionConstructor {
 return typeof value === "function";
}
function initialize(): AssertionConstructor {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


"use strict";
/* provided dependency */ var process = load0();
// Currently in sync with Node.js lib/internal/assert/assertion_error.js
// https://github.com/nodejs/node/commit/0817840f775032169ddd70c85ac059f18ffcc81c



function ownKeys(e: object, r?: boolean): PropertyKey[] { var t: PropertyKey[] = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r)!.enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e: object, ...ignored: unknown[]): object; function _objectSpread(e: object): object { for (var r = 1; r < arguments.length; r++) { var t: unknown = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(propertyObject(t), !0).forEach(function (r) { _defineProperty(e, r, readProperty(t, r)); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(propertyObject(t))) : ownKeys(propertyObject(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(propertyObject(t), r)!); }); } return e; }
function _defineProperty(obj: object, key: PropertyKey, value: unknown): object { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { record(obj)[key] = value; } return obj; }
function _classCallCheck(instance: object, Constructor: HelperConstructor): void { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target: object, props: Descriptor[]): void { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass<C extends {prototype: object}>(Constructor: C, protoProps?: Descriptor[], staticProps?: Descriptor[]): C { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg: unknown): PropertyKey { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? symbolValue(key) : String(key); }
function _toPrimitive(input: unknown, hint: string): unknown { if (_typeof(input) !== "object" || input === null) return input; var prim = readProperty(input, Symbol.toPrimitive); if (prim !== undefined) { var res = runtimeCallable(prim).call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
function _inherits(subClass: HelperConstructor, superClass: HelperConstructor | null): void { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function"); } /* The class has a non-writable prototype property; retain the original parent and constructor descriptor on that same prototype object. */ Object.setPrototypeOf(subClass.prototype, superClass && superClass.prototype); Object.defineProperty(subClass.prototype, "constructor", { value: subClass, writable: true, configurable: true }); Object.defineProperty(subClass, "prototype", { writable: false }); if (superClass) _setPrototypeOf(subClass, superClass); }
function _createSuper(Derived: HelperConstructor): (this: object, ...args: unknown[]) => object { var hasNativeReflectConstruct = _isNativeReflectConstruct(); return function _createSuperInternal(this: object) { var Super = helperConstructor(_getPrototypeOf(Derived)), result: unknown; if (hasNativeReflectConstruct) { var NewTarget = helperConstructor(readProperty(_getPrototypeOf(this), "constructor")); result = Reflect.construct(Super, arguments, NewTarget); } else { result = Super.apply(this, arguments); } return _possibleConstructorReturn(this, result); }; }
function _possibleConstructorReturn(self: object, call?: unknown): object { if (call && (_typeof(call) === "object" || typeof call === "function")) { return record(call); } else if (call !== void 0) { throw new TypeError("Derived constructors may only return object or undefined"); } return _assertThisInitialized(self); }
function _assertThisInitialized<T>(self: T): T { if (self === void 0) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return self; }
var _wrapNativeSuper: (Class: unknown) => unknown = function (Class: unknown): unknown { var _cache = typeof Map === "function" ? new Map<unknown, unknown>() : undefined; _wrapNativeSuper = function _wrapNativeSuper(Class: unknown): unknown { if (Class === null || !_isNativeFunction(Class)) return Class; if (typeof Class !== "function") { throw new TypeError("Super expression must either be null or a function"); } if (typeof _cache !== "undefined") { if (_cache.has(Class)) return _cache.get(Class); _cache.set(Class, Wrapper); } function Wrapper(this: object): object { return _construct(Class, arguments, readProperty(_getPrototypeOf(this), "constructor")); } record(Wrapper).prototype = Object.create(helperConstructor(Class).prototype, { constructor: { value: Wrapper, enumerable: false, writable: true, configurable: true } }); return _setPrototypeOf(Wrapper, Class); }; return _wrapNativeSuper(Class); };
var _construct: ConstructRoutine = function (Parent: unknown, args: ArrayLike<unknown>, Class?: unknown): object { if (_isNativeReflectConstruct()) { _construct = constructRoutine(runtimeCall(Reflect.construct.bind, Reflect.construct, [])); } else { _construct = function _construct(Parent: unknown, args: ArrayLike<unknown>, Class?: unknown): object { var a: unknown[] = [null]; runtimeCall(a.push, a, args); var Constructor = runtimeConstructor(runtimeCall(Function.bind, Parent, a)); var instance = new Constructor(); if (Class) _setPrototypeOf(instance, record(readProperty(Class, "prototype"))); return instance; }; } return record(runtimeCall(_construct, null, arguments)); };
function _isNativeReflectConstruct(): boolean { if (typeof Reflect === "undefined" || !Reflect.construct) return false; if (readProperty(Reflect.construct, "sham")) return false; if (typeof Proxy === "function") return true; try { Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); return true; } catch (e) { return false; } }
function _isNativeFunction(fn: unknown): boolean { return Function.toString.call(fn).indexOf("[native code]") !== -1; }
var _setPrototypeOf: (o: object, p: object | null) => object = function (o: object, p: object | null): object { _setPrototypeOf = Boolean(Object.setPrototypeOf) ? boundSetPrototypeOf(runtimeCall(Object.setPrototypeOf.bind, Object.setPrototypeOf, [])) : function _setPrototypeOf(o: object, p: object | null) { record(o).__proto__ = p; return o; }; return _setPrototypeOf(o, p); };
var _getPrototypeOf: (o: object) => unknown = function (o: object): unknown { _getPrototypeOf = Boolean(Object.setPrototypeOf) ? runtimeCallable(runtimeCall(Object.getPrototypeOf.bind, Object.getPrototypeOf, [])) : function _getPrototypeOf(o: object): unknown { return record(o).__proto__ || Object.getPrototypeOf(o); }; return _getPrototypeOf(o); };
var _typeof: (o: unknown) => string = function (o: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o: unknown) { return typeof o; } : function (o: unknown) { return o && "function" == typeof Symbol && readProperty(o, "constructor") === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); };
var _require = load1(),
  inspect = _require.inspect;
var _require2 = load2(),
  ERR_INVALID_ARG_TYPE = _require2.codes.ERR_INVALID_ARG_TYPE;

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/endsWith
function endsWith(str: string, search: string, this_len?: number) {
  if (this_len === undefined || this_len > str.length) {
    this_len = str.length;
  }
  return str.substring(this_len - search.length, this_len) === search;
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/repeat
function repeat(str: string, count: number) {
  count = Math.floor(count);
  if (str.length == 0 || count == 0) return '';
  var maxCount = str.length * count;
  count = Math.floor(Math.log(count) / Math.log(2));
  while (count) {
    str += str;
    count--;
  }
  str += str.substring(0, maxCount - str.length);
  return str;
}
var blue = '';
var green = '';
var red = '';
var white = '';
var kReadableOperator: Record<PropertyKey, string> = {
  deepStrictEqual: 'Expected values to be strictly deep-equal:',
  strictEqual: 'Expected values to be strictly equal:',
  strictEqualObject: 'Expected "actual" to be reference-equal to "expected":',
  deepEqual: 'Expected values to be loosely deep-equal:',
  equal: 'Expected values to be loosely equal:',
  notDeepStrictEqual: 'Expected "actual" not to be strictly deep-equal to:',
  notStrictEqual: 'Expected "actual" to be strictly unequal to:',
  notStrictEqualObject: 'Expected "actual" not to be reference-equal to "expected":',
  notDeepEqual: 'Expected "actual" not to be loosely deep-equal to:',
  notEqual: 'Expected "actual" to be loosely unequal to:',
  notIdentical: 'Values identical but not reference-equal:'
};

// Comparing short primitives should just show === / !== instead of using the
// diff.
var kMaxShortLength = 10;
function copyError(source: Error) {
  var keys = Object.keys(source);
  var target: unknown = Object.create(Object.getPrototypeOf(source));
  keys.forEach(function (key) {
    record(target)[key] = readProperty(source, key);
  });
  Object.defineProperty(record(target), 'message', {
    value: source.message
  });
  return errorConstruction(target);
}
function inspectValue(val: unknown): string {
  // The util.inspect default values could be changed. This makes sure the
  // error messages contain the necessary information nevertheless.
  return inspect(val, {
    compact: false,
    customInspect: false,
    depth: 1000,
    maxArrayLength: Infinity,
    // Assert compares only enumerable properties (with a few exceptions).
    showHidden: false,
    // Having a long line as error is better than wrapping the line for
    // comparison for now.
    // TODO(BridgeAR): `breakLength` should be limited as soon as soon as we
    // have meta information about the inspected properties (i.e., know where
    // in what line the property starts and ends).
    breakLength: Infinity,
    // Assert does not detect proxies currently.
    showProxy: false,
    sorted: true,
    // Inspect getters as we also check them when comparing entries.
    getters: true
  });
}
function createErrDiff(actual: unknown, expected: unknown, operator: string) {
  var other = '';
  var res = '';
  var lastPos = 0;
  var end = '';
  var skipped = false;
  var actualInspected = inspectValue(actual);
  var actualLines = actualInspected.split('\n');
  var expectedLines = inspectValue(expected).split('\n');
  var i = 0;
  var indicator = '';

  // In case both values are objects explicitly mark them as not reference equal
  // for the `strictEqual` operator.
  if (operator === 'strictEqual' && _typeof(actual) === 'object' && _typeof(expected) === 'object' && actual !== null && expected !== null) {
    operator = 'strictEqualObject';
  }

  // If "actual" and "expected" fit on a single line and they are not strictly
  // equal, check further special handling.
  if (actualLines.length === 1 && expectedLines.length === 1 && actualLines[0] !== expectedLines[0]) {
    var inputLength = actualLines[0].length + expectedLines[0].length;
    // If the character length of "actual" and "expected" together is less than
    // kMaxShortLength and if neither is an object and at least one of them is
    // not `zero`, use the strict equal comparison to visualize the output.
    if (inputLength <= kMaxShortLength) {
      if ((_typeof(actual) !== 'object' || actual === null) && (_typeof(expected) !== 'object' || expected === null) && (actual !== 0 || expected !== 0)) {
        // -0 === +0
        return "".concat(kReadableOperator[_toPropertyKey(operator)], "\n\n") + "".concat(actualLines[0], " !== ").concat(expectedLines[0], "\n");
      }
    } else if (operator !== 'strictEqualObject') {
      // If the stderr is a tty and the input length is lower than the current
      // columns per line, add a mismatch indicator below the output. If it is
      // not a tty, use a default value of 80 characters.
      var maxLength = stderrValue(process.stderr) && stderrValue(process.stderr)!.isTTY ? stderrValue(process.stderr)!.columns : 80;
      if (inputLength < maxLength!) {
        while (actualLines[0][i] === expectedLines[0][i]) {
          i++;
        }
        // Ignore the first characters.
        if (i > 2) {
          // Add position indicator for the first mismatch in case it is a
          // single line and the input length is less than the column length.
          indicator = "\n  ".concat(repeat(' ', i), "^");
          i = 0;
        }
      }
    }
  }

  // Remove all ending lines that match (this optimizes the output for
  // readability by reducing the number of total changed lines).
  var a = actualLines[actualLines.length - 1];
  var b = expectedLines[expectedLines.length - 1];
  while (a === b) {
    if (i++ < 2) {
      end = "\n  ".concat(a).concat(end);
    } else {
      other = a;
    }
    actualLines.pop();
    expectedLines.pop();
    if (actualLines.length === 0 || expectedLines.length === 0) break;
    a = actualLines[actualLines.length - 1];
    b = expectedLines[expectedLines.length - 1];
  }
  var maxLines = Math.max(actualLines.length, expectedLines.length);
  // Strict equal with identical objects that are not identical by reference.
  // E.g., assert.deepStrictEqual({ a: Symbol() }, { a: Symbol() })
  if (maxLines === 0) {
    // We have to get the result again. The lines were all removed before.
    var _actualLines = actualInspected.split('\n');

    // Only remove lines in case it makes sense to collapse those.
    // TODO: Accept env to always show the full error.
    if (_actualLines.length > 30) {
      _actualLines[26] = "".concat(blue, "...").concat(white);
      while (_actualLines.length > 27) {
        _actualLines.pop();
      }
    }
    return "".concat(kReadableOperator.notIdentical, "\n\n").concat(_actualLines.join('\n'), "\n");
  }
  if (i > 3) {
    end = "\n".concat(blue, "...").concat(white).concat(end);
    skipped = true;
  }
  if (other !== '') {
    end = "\n  ".concat(other).concat(end);
    other = '';
  }
  var printedLines = 0;
  var msg = kReadableOperator[_toPropertyKey(operator)] + "\n".concat(green, "+ actual").concat(white, " ").concat(red, "- expected").concat(white);
  var skippedMsg = " ".concat(blue, "...").concat(white, " Lines skipped");
  for (i = 0; i < maxLines; i++) {
    // Only extra expected lines exist
    var cur = i - lastPos;
    if (actualLines.length < i + 1) {
      // If the last diverging line is more than one line above and the
      // current line is at least line three, add some of the former lines and
      // also add dots to indicate skipped entries.
      if (cur > 1 && i > 2) {
        if (cur > 4) {
          res += "\n".concat(blue, "...").concat(white);
          skipped = true;
        } else if (cur > 3) {
          res += "\n  ".concat(expectedLines[i - 2]);
          printedLines++;
        }
        res += "\n  ".concat(expectedLines[i - 1]);
        printedLines++;
      }
      // Mark the current line as the last diverging one.
      lastPos = i;
      // Add the expected line to the cache.
      other += "\n".concat(red, "-").concat(white, " ").concat(expectedLines[i]);
      printedLines++;
      // Only extra actual lines exist
    } else if (expectedLines.length < i + 1) {
      // If the last diverging line is more than one line above and the
      // current line is at least line three, add some of the former lines and
      // also add dots to indicate skipped entries.
      if (cur > 1 && i > 2) {
        if (cur > 4) {
          res += "\n".concat(blue, "...").concat(white);
          skipped = true;
        } else if (cur > 3) {
          res += "\n  ".concat(actualLines[i - 2]);
          printedLines++;
        }
        res += "\n  ".concat(actualLines[i - 1]);
        printedLines++;
      }
      // Mark the current line as the last diverging one.
      lastPos = i;
      // Add the actual line to the result.
      res += "\n".concat(green, "+").concat(white, " ").concat(actualLines[i]);
      printedLines++;
      // Lines diverge
    } else {
      var expectedLine = expectedLines[i];
      var actualLine = actualLines[i];
      // If the lines diverge, specifically check for lines that only diverge by
      // a trailing comma. In that case it is actually identical and we should
      // mark it as such.
      var divergingLines = actualLine !== expectedLine && (!endsWith(actualLine, ',') || actualLine.slice(0, -1) !== expectedLine);
      // If the expected line has a trailing comma but is otherwise identical,
      // add a comma at the end of the actual line. Otherwise the output could
      // look weird as in:
      //
      //   [
      //     1         // No comma at the end!
      // +   2
      //   ]
      //
      if (divergingLines && endsWith(expectedLine, ',') && expectedLine.slice(0, -1) === actualLine) {
        divergingLines = false;
        actualLine += ',';
      }
      if (divergingLines) {
        // If the last diverging line is more than one line above and the
        // current line is at least line three, add some of the former lines and
        // also add dots to indicate skipped entries.
        if (cur > 1 && i > 2) {
          if (cur > 4) {
            res += "\n".concat(blue, "...").concat(white);
            skipped = true;
          } else if (cur > 3) {
            res += "\n  ".concat(actualLines[i - 2]);
            printedLines++;
          }
          res += "\n  ".concat(actualLines[i - 1]);
          printedLines++;
        }
        // Mark the current line as the last diverging one.
        lastPos = i;
        // Add the actual line to the result and cache the expected diverging
        // line so consecutive diverging lines show up as +++--- and not +-+-+-.
        res += "\n".concat(green, "+").concat(white, " ").concat(actualLine);
        other += "\n".concat(red, "-").concat(white, " ").concat(expectedLine);
        printedLines += 2;
        // Lines are identical
      } else {
        // Add all cached information to the result before adding other things
        // and reset the cache.
        res += other;
        other = '';
        // If the last diverging line is exactly one line above or if it is the
        // very first line, add the line to the result.
        if (cur === 1 || i === 0) {
          res += "\n  ".concat(actualLine);
          printedLines++;
        }
      }
    }
    // Inspected object to big (Show ~20 rows max)
    if (printedLines > 20 && i < maxLines - 2) {
      return "".concat(msg).concat(skippedMsg, "\n").concat(res, "\n").concat(blue, "...").concat(white).concat(other, "\n") + "".concat(blue, "...").concat(white);
    }
  }
  return "".concat(msg).concat(skipped ? skippedMsg : '', "\n").concat(res).concat(other).concat(end).concat(indicator);
}
var AssertionError = /*#__PURE__*/function (_Error: unknown, _inspect$custom: unknown) {
  var _super: (this: object, ...args: unknown[]) => object;
  class AssertionError {
    declare name: string;
    declare message: string;
    declare stack?: string;
    declare code: string;
    declare generatedMessage: boolean;
    declare actual: unknown;
    declare expected: unknown;
    declare operator: unknown;
  constructor(options?: unknown) {
    var _this: ErrorConstruction;
    _classCallCheck(this, helperConstructor(AssertionError));
    if (_typeof(options) !== 'object' || options === null) {
      throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }
    var message = readProperty(options, "message"),
      operator = readProperty(options, "operator"),
      stackStartFn = readProperty(options, "stackStartFn");
    var actual = readProperty(options, "actual"),
      expected = readProperty(options, "expected");
    var limit: unknown = readProperty(Error, "stackTraceLimit");
    record(Error).stackTraceLimit = 0;
    if (message != null) {
      _this = errorConstruction(_super.call(this, String(message)));
    } else {
      if (stderrValue(process.stderr) && stderrValue(process.stderr)!.isTTY) {
        // Reset on each call to make sure we handle dynamically set environment
        // variables correct.
        if (stderrValue(process.stderr) && stderrValue(process.stderr)!.getColorDepth && stderrValue(process.stderr)!.getColorDepth!() !== 1) {
          blue = "\x1B[34m";
          green = "\x1B[32m";
          white = "\x1B[39m";
          red = "\x1B[31m";
        } else {
          blue = '';
          green = '';
          white = '';
          red = '';
        }
      }
      // Prevent the error stack from being visible by duplicating the error
      // in a very close way to the original in case both sides are actually
      // instances of Error.
      if (_typeof(actual) === 'object' && actual !== null && _typeof(expected) === 'object' && expected !== null && 'stack' in record(actual) && actual instanceof Error && 'stack' in record(expected) && expected instanceof Error) {
        actual = copyError(actual);
        expected = copyError(expected);
      }
      if (operator === 'deepStrictEqual' || operator === 'strictEqual') {
        _this = errorConstruction(_super.call(this, createErrDiff(actual, expected, operator)));
      } else if (operator === 'notDeepStrictEqual' || operator === 'notStrictEqual') {
        // In case the objects are equal but the operator requires unequal, show
        // the first object and say A equals B
        var base = kReadableOperator[_toPropertyKey(operator)];
        var res = inspectValue(actual).split('\n');

        // In case "actual" is an object, it should not be reference equal.
        if (operator === 'notStrictEqual' && _typeof(actual) === 'object' && actual !== null) {
          base = kReadableOperator.notStrictEqualObject;
        }

        // Only remove lines in case it makes sense to collapse those.
        // TODO: Accept env to always show the full error.
        if (res.length > 30) {
          res[26] = "".concat(blue, "...").concat(white);
          while (res.length > 27) {
            res.pop();
          }
        }

        // Only print a single input.
        if (res.length === 1) {
          _this = errorConstruction(_super.call(this, "".concat(base, " ").concat(res[0])));
        } else {
          _this = errorConstruction(_super.call(this, "".concat(base, "\n\n").concat(res.join('\n'), "\n")));
        }
      } else {
        var _res = inspectValue(actual);
        var other = '';
        var knownOperators = kReadableOperator[_toPropertyKey(operator)];
        if (operator === 'notDeepEqual' || operator === 'notEqual') {
          _res = "".concat(kReadableOperator[_toPropertyKey(operator)], "\n\n").concat(_res);
          if (_res.length > 1024) {
            _res = "".concat(_res.slice(0, 1021), "...");
          }
        } else {
          other = "".concat(inspectValue(expected));
          if (_res.length > 512) {
            _res = "".concat(_res.slice(0, 509), "...");
          }
          if (other.length > 512) {
            other = "".concat(other.slice(0, 509), "...");
          }
          if (operator === 'deepEqual' || operator === 'equal') {
            _res = "".concat(knownOperators, "\n\n").concat(_res, "\n\nshould equal\n\n");
          } else {
            other = " ".concat(concatValue(operator), " ").concat(other);
          }
        }
        _this = errorConstruction(_super.call(this, "".concat(_res).concat(other)));
      }
    }
    record(Error).stackTraceLimit = limit;
    _this.generatedMessage = !message;
    Object.defineProperty(_assertThisInitialized(_this), 'name', {
      value: 'AssertionError [ERR_ASSERTION]',
      enumerable: false,
      writable: true,
      configurable: true
    });
    _this.code = 'ERR_ASSERTION';
    _this.actual = actual;
    _this.expected = expected;
    _this.operator = operator;
    if (readProperty(Error, "captureStackTrace")) {
      // eslint-disable-next-line no-restricted-syntax
      runtimeCallable(readProperty(Error, "captureStackTrace")).call(Error, _assertThisInitialized(_this), stackStartFn);
    }
    // Create error message including the error code in the name.
    _this.stack;
    // Reset the name.
    _this.name = 'AssertionError';
    return assertionInstance(_possibleConstructorReturn(_this));
  }
  }
  _inherits(helperConstructor(AssertionError), helperConstructor(_Error));
  _super = _createSuper(helperConstructor(AssertionError));
  _createClass(AssertionError, [{
    key: "toString",
    value: function toString(this: AssertionInstance) {
      return "".concat(this.name, " [").concat(this.code, "]: ").concat(this.message);
    }
  }, {
    key: _inspect$custom,
    value: function value(this: AssertionInstance, recurseTimes: unknown, ctx: unknown): string {
      // This limits the `actual` and `expected` property default inspection to
      // the minimum depth. Otherwise those values would be too verbose compared
      // to the actual error message which contains a combined view of these two
      // input values.
      return inspect(this, _objectSpread(_objectSpread({}, ctx), {}, {
        customInspect: false,
        depth: 0
      }));
    }
  }]);
  return AssertionError;
}( /*#__PURE__*/_wrapNativeSuper(Error), inspect.custom);
module.exports = AssertionError;

/***/ 
if (!isExport(module.exports)) throw new TypeError("Unexpected AssertionError export");
return module.exports;
}
