// Exact module body from JetStream 3.0 ./node_modules/util/util.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty, runtimeMethod} from "../../webpack.ts";
import {load as load0} from "../process/browser.ts";
import {load as load1} from "./support/types.ts";
import {load as load2} from "./support/isBufferBrowser.ts";
import {load as load3} from "../inherits/inherits_browser.ts";

import type {ShimUtil, ShimUtilSupportTypes, ShimDescriptor, InspectOptions} from "../../shim-types.ts";
import {shimSloppyReceiver} from "../../shim-types.ts";
import {callableValue, present, stringValue, numberValue, numberArray, stringArray, arrayValue, numericValue, numericRelationalValue, concatenatedString} from "../lodash/runtime.ts";
import type {LodashCallable} from "../lodash/runtime.ts";
interface InspectContext { seen: unknown[]; stylize(value: string, style: string): string; showHidden?: unknown; depth?: unknown; colors?: unknown; customInspect?: unknown; }

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for util/util.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value) && ["format","deprecate","debuglog","inspect","isArray","isBoolean","isNull","isNullOrUndefined","isNumber","isString","isSymbol","isUndefined","isRegExp","isObject","isDate","isError","isFunction","isPrimitive","isBuffer","log","inherits","_extend","promisify","callbackify"].every(key => typeof value[key] === "function") && isRecord(value.types) && ["isRegExp", "isDate", "isNativeError"].every(key => typeof record(value.types)[key] === "function");
}
function initialize(): ShimUtil {
const exports: Partial<Omit<ShimUtil, "types">> & {types?: ShimUtilSupportTypes} = {};
let module = {exports};
cache = module;


/* provided dependency */ var process = load0();
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var getOwnPropertyDescriptors: (object: unknown) => Record<PropertyKey, ShimDescriptor> = Object.getOwnPropertyDescriptors ||
  function getOwnPropertyDescriptors(obj: unknown) {
    var keys = stringArray(callableValue(Object.keys)(obj));
    var descriptors: Record<PropertyKey, ShimDescriptor> = {};
    for (var i = 0; i < keys.length; i++) {
      descriptors[keys[i]] = present(Object.getOwnPropertyDescriptor(obj, keys[i]));
    }
    return descriptors;
  };

var formatRegExp = /%[sdj%]/g;
exports.format = function(f: unknown) {
  if (!isString(f)) {
    var objects: string[] = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = stringValue(runtimeMethod(String(f), "replace", [formatRegExp, function(x: string) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  }]));
  for (var x: unknown = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + concatenatedString(x);
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn: unknown, msg: string | undefined) {
  if (typeof process !== 'undefined' && process.noDeprecation === true) {
    return callableValue(fn);
  }

  // Allow for deprecating things in the process of starting up.
  if (typeof process === 'undefined') {
    return function(this: unknown) {
      var originalThis = shimSloppyReceiver(this);
      return callableValue(present(exports.deprecate)(fn, msg)).apply(originalThis, arguments);
    };
  }

  var warned = false;
  function deprecated(this: unknown) {
    var originalThis = shimSloppyReceiver(this);
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return callableValue(fn).apply(originalThis, arguments);
  }

  return deprecated;
};


var debugs: Record<string, ((...args: unknown[]) => unknown) | undefined> = {};
var debugEnvRegex = /^$/;

if (process.env.NODE_DEBUG) {
  var debugEnv = process.env.NODE_DEBUG;
  debugEnv = debugEnv.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/,/g, '$|^')
    .toUpperCase();
  debugEnvRegex = new RegExp('^' + debugEnv + '$', 'i');
}
exports.debuglog = function(set: string) {
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (debugEnvRegex.test(set)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = callableValue(exports.format).apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return callableValue(debugs[set]);
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj: unknown, opts?: InspectOptions | object | boolean): string {
  // default options
  var ctx: InspectContext = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    present(exports._extend)(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str: string, styleType: string) {
  var style = record(inspect.styles)[styleType];

  if (style) {
    return '\u001b[' + numberArray(record(inspect.colors)[stringValue(style)])[0] + 'm' + str +
           '\u001b[' + numberArray(record(inspect.colors)[stringValue(style)])[1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str: string, styleType: string) {
  return str;
}


function arrayToHash(array: string[]) {
  var hash: Record<string, boolean> = {};

  array.forEach(function(val: string, idx: number) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx: InspectContext, value: unknown, recurseTimes: unknown): string {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(runtimeProperty(value, "inspect")) &&
      // Filter out the util module, it's inspect function is special
      runtimeProperty(value, "inspect") !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(runtimeProperty(value, "constructor") && runtimeProperty(runtimeProperty(value, "constructor"), "prototype") === value)) {
    var ret: unknown = callableValue(runtimeProperty(value, "inspect")).call(value, recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return stringValue(ret);
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = stringArray(callableValue(Object.keys)(value));
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || runtimeProperty(value, "length") == 0)) {
    return braces[0] + base + braces[1];
  }

  if (numericRelationalValue(recurseTimes) < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output: string[];
  if (array) {
    output = formatArray(ctx, arrayValue(value), recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx: InspectContext, value: unknown): string | undefined {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value: unknown) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx: InspectContext, value: unknown[], recurseTimes: unknown, visibleKeys: Record<string, boolean>, keys: string[]) {
  var output: string[] = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key: string) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx: InspectContext, value: unknown, recurseTimes: unknown, visibleKeys: Record<string, boolean>, key: string, array: boolean): string {
  var name: string | undefined, str: string | undefined, desc: ShimDescriptor;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: runtimeProperty(value, key) };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, numericValue(recurseTimes) - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line: string) {
            return '  ' + line;
          }).join('\n').slice(2);
        } else {
          str = '\n' + str.split('\n').map(function(line: string) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.slice(1, -1);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output: string[], base: string, braces: string[]) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
exports.types = load1();

function isArray(ar: unknown): ar is unknown[] {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg: unknown): arg is boolean {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg: unknown): arg is null {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg: unknown): arg is null | undefined {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg: unknown): arg is number {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg: unknown): arg is string {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg: unknown): arg is symbol {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg: unknown): arg is undefined {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re: unknown): re is RegExp {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;
exports.types.isRegExp = isRegExp;

function isObject(arg: unknown): arg is object {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d: unknown): d is Date {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;
exports.types.isDate = isDate;

function isError(e: unknown): e is Error {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;
exports.types.isNativeError = isError;

function isFunction(arg: unknown): arg is LodashCallable {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg: unknown) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = load2();

function objectToString(o: unknown) {
  return Object.prototype.toString.call(o);
}


function pad(n: number) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), callableValue(exports.format).apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = load3();

exports._extend = function(origin: unknown, add: unknown) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    record(origin)[keys[i]] = record(add)[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj: unknown, prop: string) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

var kCustomPromisifiedSymbol = typeof Symbol !== 'undefined' ? Symbol('util.promisify.custom') : undefined;

exports.promisify = function promisify(original: unknown) {
  if (typeof original !== 'function')
    throw new TypeError('The "original" argument must be of type Function');

  if (kCustomPromisifiedSymbol && record(original)[kCustomPromisifiedSymbol]) {
    var customFn: unknown = record(original)[kCustomPromisifiedSymbol];
    if (typeof customFn !== 'function') {
      throw new TypeError('The "util.promisify.custom" argument must be of type Function');
    }
    Object.defineProperty(customFn, kCustomPromisifiedSymbol, {
      value: customFn, enumerable: false, writable: false, configurable: true
    });
    return callableValue(customFn);
  }

  function fn(this: unknown): unknown {
    var originalThis = shimSloppyReceiver(this);
    var promiseResolve: ((value: unknown) => void) | undefined, promiseReject: ((arg0: unknown) => void) | undefined;
    var promise = new Promise(function (resolve, reject) {
      promiseResolve = resolve;
      promiseReject = reject;
    });

    var args: unknown[] = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    args.push(function (err: unknown, value: unknown) {
      if (err) {
        present(promiseReject)(err);
      } else {
        present(promiseResolve)(value);
      }
    });

    try {
      callableValue(original).apply(originalThis, args);
    } catch (err) {
      present(promiseReject)(err);
    }

    return promise;
  }

  Object.setPrototypeOf(fn, Object.getPrototypeOf(original));

  if (kCustomPromisifiedSymbol) Object.defineProperty(fn, kCustomPromisifiedSymbol, {
    value: fn, enumerable: false, writable: false, configurable: true
  });
  return callableValue(Object.defineProperties(
    fn,
    getOwnPropertyDescriptors(original)
  ));
}

present(exports.promisify).custom = kCustomPromisifiedSymbol

function callbackifyOnRejected(reason: unknown, cb: (...args: unknown[]) => unknown) {
  // `!reason` guard inspired by bluebird (Ref: https://goo.gl/t5IS6M).
  // Because `null` is a special error value in callbacks which means "no error
  // occurred", we error-wrap so the callback consumer can distinguish between
  // "the promise rejected with null" or "the promise fulfilled with undefined".
  if (!reason) {
    var newReason = new Error('Promise was rejected with a falsy value');
    record(newReason).reason = reason;
    reason = newReason;
  }
  return cb(reason);
}

function callbackify(original: unknown) {
  if (typeof original !== 'function') {
    throw new TypeError('The "original" argument must be of type Function');
  }

  // We DO NOT return the promise as it gives the user a false sense that
  // the promise is actually somehow related to the callback's execution
  // and that the callback throwing will reject the promise.
  function callbackified(this: unknown) {
    var originalThis = shimSloppyReceiver(this);
    var args: unknown[] = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }

    var maybeCb = args.pop();
    if (typeof maybeCb !== 'function') {
      throw new TypeError('The last argument must be of type Function');
    }
    var self = originalThis;
    var cb = function() {
      return callableValue(maybeCb).apply(self, arguments);
    };
    // In true node style we process the callback on `nextTick` with all the
    // implications (stack, `uncaughtException`, `async_hooks`)
    runtimeMethod(callableValue(original).apply(originalThis, args), "then", [function(ret: unknown) { process.nextTick(callableValue(cb).bind(null, null, ret)) },
            function(rej: unknown) { process.nextTick(callbackifyOnRejected.bind(null, rej, cb)) }]);
  }

  Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original));
  Object.defineProperties(callbackified,
                          getOwnPropertyDescriptors(original));
  return callableValue(callbackified);
}
exports.callbackify = callbackify;


/***/ 
if (!isExport(exports)) throw new TypeError("Unexpected completed util exports");
return exports;
}
