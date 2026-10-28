import {convertHelpers, isBaseConvert, mappingEntry, type ConvertHelpers, type BaseConvert, type Arity} from "./convert-types.ts";
import {callableValue, numberValue, present, propertyKey, numericValue, numberArray, arrayValue, type LodashFunction, type LodashDynamicFunction} from "../runtime.ts";
// Exact module body from JetStream 3.0 ./node_modules/lodash/fp/_baseConvert.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, runtimeProperty, runtimeArrayLike} from "../../../webpack.ts";
import {load as load0} from "./_mapping.ts";
import {load as load1} from "./placeholder.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lodash/fp/_baseConvert.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isBaseConvert(value);
}
function initialize(): BaseConvert {
let module: { exports: unknown; paths?: string[]; children?: unknown[] } = {exports: {}};
const exports = module.exports;
cache = module;


var mapping = load0(),
    fallbackHolder = load1();

/** Built-in value reference. */
var push: (this: unknown[], ...items: unknown[]) => number = Array.prototype.push;

/**
 * Creates a function, with an arity of `n`, that invokes `func` with the
 * arguments it receives.
 *
 * @private
 * @param {Function} func The function to wrap.
 * @param {number} n The arity of the new function.
 * @returns {Function} Returns the new function.
 */
function baseArity(func: LodashFunction, n: Arity): LodashDynamicFunction {
  return n == 2
    ? function(a: unknown, b: unknown) { return callableValue(func).apply(undefined, arguments); }
    : function(a: unknown) { return callableValue(func).apply(undefined, arguments); };
}

/**
 * Creates a function that invokes `func`, with up to `n` arguments, ignoring
 * any additional arguments.
 *
 * @private
 * @param {Function} func The function to cap arguments for.
 * @param {number} n The arity cap.
 * @returns {Function} Returns the new function.
 */
function baseAry(func: LodashFunction, n: Arity): LodashDynamicFunction {
  return n == 2
    ? function(a: unknown, b: unknown) { return callableValue(func)(a, b); }
    : function(a: unknown) { return callableValue(func)(a); };
}

/**
 * Creates a clone of `array`.
 *
 * @private
 * @param {Array} array The array to clone.
 * @returns {Array} Returns the cloned array.
 */
function cloneArray<T>(array?: ArrayLike<T> | null): T[] {
  var length = array ? array.length : 0,
      result: T[] = Array(length);

  while (length--) {
    result[length] = present(array)[length];
  }
  return result;
}

/**
 * Creates a function that clones a given object using the assignment `func`.
 *
 * @private
 * @param {Function} func The assignment function.
 * @returns {Function} Returns the new cloner function.
 */
function createCloner(func: LodashFunction): (object: unknown) => unknown {
  return function(object: unknown) {
    return callableValue(func)({}, object);
  };
}

/**
 * A specialized version of `_.spread` which flattens the spread array into
 * the arguments of the invoked `func`.
 *
 * @private
 * @param {Function} func The function to spread arguments over.
 * @param {number} start The start position of the spread.
 * @returns {Function} Returns the new function.
 */
function flatSpread(func: LodashFunction, start: number): LodashDynamicFunction {
  return function(this: unknown) {
    var length = arguments.length,
        lastIndex = length - 1,
        args: unknown[] = Array(length);

    while (length--) {
      args[length] = arguments[length];
    }
    var array = args[start],
        otherArgs = args.slice(0, start);

    if (array) {
      callableValue(push).apply(otherArgs, runtimeArrayLike(array));
    }
    if (start != lastIndex) {
      push.apply(otherArgs, args.slice(start + 1));
    }
    return callableValue(func).apply(this, otherArgs);
  };
}

/**
 * Creates a function that wraps `func` and uses `cloner` to clone the first
 * argument it receives.
 *
 * @private
 * @param {Function} func The function to wrap.
 * @param {Function} cloner The function to clone arguments.
 * @returns {Function} Returns the new immutable function.
 */
function wrapImmutable(func: LodashFunction, cloner: LodashFunction): LodashDynamicFunction {
  return function(this: unknown) {
    var length = arguments.length;
    if (!length) {
      return;
    }
    var args: unknown[] = Array(length);
    while (length--) {
      args[length] = arguments[length];
    }
    var result = args[0] = callableValue(cloner).apply(undefined, args);
    callableValue(func).apply(undefined, args);
    return result;
  };
}

/**
 * The base implementation of `convert` which accepts a `util` object of methods
 * required to perform conversions.
 *
 * @param {Object} util The util object.
 * @param {string} name The name of the function to convert.
 * @param {Function} func The function to convert.
 * @param {Object} [options] The options object.
 * @param {boolean} [options.cap=true] Specify capping iteratee arguments.
 * @param {boolean} [options.curry=true] Specify currying.
 * @param {boolean} [options.fixed=true] Specify fixed arity.
 * @param {boolean} [options.immutable=true] Specify immutable operations.
 * @param {boolean} [options.rearg=true] Specify rearranging arguments.
 * @returns {Function|Object} Returns the converted function or object.
 */
function baseConvert(util: ConvertHelpers, name: unknown, func?: unknown, options?: unknown): unknown {
  var isLib = typeof name == 'function',
      isObj = name === Object(name);

  if (isObj) {
    options = func;
    func = name;
    name = undefined;
  }
  if (func == null) {
    throw new TypeError;
  }
  options || (options = {});
  if (!isRecord(options)) throw new TypeError("Expected Lodash conversion options");

  var config = {
    'cap': 'cap' in options ? options.cap : true,
    'curry': 'curry' in options ? options.curry : true,
    'fixed': 'fixed' in options ? options.fixed : true,
    'immutable': 'immutable' in options ? options.immutable : true,
    'rearg': 'rearg' in options ? options.rearg : true
  };

  var defaultHolder = isLib ? func : fallbackHolder,
      forceCurry = ('curry' in options) && options.curry,
      forceFixed = ('fixed' in options) && options.fixed,
      forceRearg = ('rearg' in options) && options.rearg,
      pristine = isLib ? callableValue(runtimeProperty(func, "runInContext")).call(func) : undefined;

  var helpers = isLib ? convertHelpers(func) : {
    'ary': util.ary,
    'assign': util.assign,
    'clone': util.clone,
    'curry': util.curry,
    'forEach': util.forEach,
    'isArray': util.isArray,
    'isError': util.isError,
    'isFunction': util.isFunction,
    'isWeakMap': util.isWeakMap,
    'iteratee': util.iteratee,
    'keys': util.keys,
    'rearg': util.rearg,
    'toInteger': util.toInteger,
    'toPath': util.toPath
  };

  var ary = helpers.ary,
      assign = helpers.assign,
      clone = helpers.clone,
      curry = helpers.curry,
      each = helpers.forEach,
      isArray = helpers.isArray,
      isError = helpers.isError,
      isFunction = helpers.isFunction,
      isWeakMap = helpers.isWeakMap,
      keys = helpers.keys,
      rearg = helpers.rearg,
      toInteger = helpers.toInteger,
      toPath = helpers.toPath;

  var aryMethodKeys = keys(mapping.aryMethod);

  var wrappers: Record<string, (func: LodashFunction) => LodashFunction> = {
    'castArray': function(castArray: LodashFunction) {
      return function(this: unknown) {
        var value: unknown = arguments[0];
        return isArray(value)
          ? callableValue(castArray)(cloneArray(value))
          : callableValue(castArray).apply(undefined, arguments);
      };
    },
    'iteratee': function(iteratee: LodashFunction) {
      return function(this: unknown) {
        var func: unknown = arguments[0],
            arity: unknown = arguments[1],
            result = callableValue(callableValue(iteratee)(func, arity)),
            length = result.length;

        if (config.cap && typeof arity == 'number') {
          arity = arity > 2 ? (arity - 2) : 1;
          return (length && length <= numberValue(arity)) ? result : baseAry(result, numberValue(arity));
        }
        return result;
      };
    },
    'mixin': function(mixin: LodashFunction) {
      return function(this: unknown, source: unknown) {
        var func = this;
        if (!isFunction(func)) {
          return callableValue(mixin)(func, Object(source));
        }
        var pairs: [PropertyKey, unknown][] = [];
        each(keys(source), function(key: string) {
          if (isFunction(runtimeProperty(source, key))) {
            pairs.push([key, record(runtimeProperty(func, "prototype"))[key]]);
          }
        });

        callableValue(mixin)(func, Object(source));

        each(pairs, function(pair: [PropertyKey, unknown]) {
          var value = pair[1];
          if (isFunction(value)) {
            record(runtimeProperty(func, "prototype"))[pair[0]] = value;
          } else {
            delete record(runtimeProperty(func, "prototype"))[pair[0]];
          }
        });
        return func;
      };
    },
    'nthArg': function(nthArg: LodashFunction) {
      return function(n: number) {
        var arity = n < 0 ? 1 : (toInteger(n) + 1);
        return curry(callableValue(callableValue(nthArg)(n)), arity);
      };
    },
    'rearg': function(rearg: LodashFunction) {
      return function(func: LodashFunction, indexes: number[]) {
        var arity = indexes ? indexes.length : 0;
        return curry(callableValue(callableValue(rearg)(func, indexes)), arity);
      };
    },
    'runInContext': function(runInContext: LodashFunction) {
      return function(context: unknown) {
        return baseConvert(util, callableValue(runInContext)(context), options);
      };
    }
  };

  /*--------------------------------------------------------------------------*/

  /**
   * Casts `func` to a function with an arity capped iteratee if needed.
   *
   * @private
   * @param {string} name The name of the function to inspect.
   * @param {Function} func The function to inspect.
   * @returns {Function} Returns the cast function.
   */
  function castCap(name: unknown, func: LodashFunction): LodashFunction {
    if (config.cap) {
      var indexes = mappingEntry(mapping.iterateeRearg, name);
      if (indexes) {
        return iterateeRearg(func, indexes);
      }
      var n = !isLib && mappingEntry(mapping.iterateeAry, name);
      if (n) {
        return iterateeAry(func, n);
      }
    }
    return func;
  }

  /**
   * Casts `func` to a curried function if needed.
   *
   * @private
   * @param {string} name The name of the function to inspect.
   * @param {Function} func The function to inspect.
   * @param {number} n The arity of `func`.
   * @returns {Function} Returns the cast function.
   */
  function castCurry(name: unknown, func: LodashFunction, n: Arity): LodashFunction {
    return (forceCurry || (config.curry && numericValue(n) > 1))
      ? curry(func, n)
      : func;
  }

  /**
   * Casts `func` to a fixed arity function if needed.
   *
   * @private
   * @param {string} name The name of the function to inspect.
   * @param {Function} func The function to inspect.
   * @param {number} n The arity cap.
   * @returns {Function} Returns the cast function.
   */
  function castFixed(name: unknown, func: LodashFunction, n: Arity): LodashFunction {
    if (config.fixed && (forceFixed || !mappingEntry(mapping.skipFixed, name))) {
      var data = mappingEntry(mapping.methodSpread, name),
          start = data && data.start;

      return start  === undefined ? ary(func, n) : flatSpread(func, start);
    }
    return func;
  }

  /**
   * Casts `func` to an rearged function if needed.
   *
   * @private
   * @param {string} name The name of the function to inspect.
   * @param {Function} func The function to inspect.
   * @param {number} n The arity of `func`.
   * @returns {Function} Returns the cast function.
   */
  function castRearg(name: unknown, func: LodashFunction, n: Arity): LodashFunction {
    return (config.rearg && numericValue(n) > 1 && (forceRearg || !mappingEntry(mapping.skipRearg, name)))
      ? rearg(func, mappingEntry(mapping.methodRearg, name) || mappingEntry(mapping.aryRearg, n))
      : func;
  }

  /**
   * Creates a clone of `object` by `path`.
   *
   * @private
   * @param {Object} object The object to clone.
   * @param {Array|string} path The path to clone by.
   * @returns {Object} Returns the cloned object.
   */
  function cloneByPath(object: unknown, path: unknown): unknown {
    path = toPath(path);

    var index = -1,
        length = runtimeArrayLike(path).length,
        lastIndex = length - 1,
        result = clone(Object(object)),
        nested = result;

    while (nested != null && ++index < length) {
      var key = propertyKey(runtimeArrayLike(path)[index]),
          value = record(nested)[key];

      if (value != null &&
          !(isFunction(value) || isError(value) || isWeakMap(value))) {
        record(nested)[key] = clone(index == lastIndex ? value : Object(value));
      }
      nested = record(nested)[key];
    }
    return result;
  }

  /**
   * Converts `lodash` to an immutable auto-curried iteratee-first data-last
   * version with conversion `options` applied.
   *
   * @param {Object} [options] The options object. See `baseConvert` for more details.
   * @returns {Function} Returns the converted `lodash`.
   */
  function convertLib(options?: unknown): unknown {
    var receiver = runtimeProperty(_, "runInContext");
    return callableValue(callableValue(runtimeProperty(receiver, "convert")).call(receiver, options))(undefined);
  }

  /**
   * Create a converter function for `func` of `name`.
   *
   * @param {string} name The name of the function to convert.
   * @param {Function} func The function to convert.
   * @returns {Function} Returns the new converter function.
   */
  function createConverter(name: unknown, func: LodashFunction): (options?: unknown) => unknown {
    var realName = mappingEntry(mapping.aliasToReal, name) || name,
        methodName = mappingEntry(mapping.remap, realName) || realName,
        oldOptions = options;

    return function(options?: unknown) {
      var newUtil = isLib ? pristine : helpers,
          newFunc = isLib ? runtimeProperty(pristine, propertyKey(methodName)) : func,
          newOptions = assign(assign({}, oldOptions), options);

      return baseConvert(convertHelpers(newUtil), realName, newFunc, newOptions);
    };
  }

  /**
   * Creates a function that wraps `func` to invoke its iteratee, with up to `n`
   * arguments, ignoring any additional arguments.
   *
   * @private
   * @param {Function} func The function to cap iteratee arguments for.
   * @param {number} n The arity cap.
   * @returns {Function} Returns the new function.
   */
  function iterateeAry(func: LodashFunction, n: Arity): LodashFunction {
    return overArg(func, function(func: unknown) {
      return typeof func == 'function' ? baseAry(callableValue(func), n) : func;
    });
  }

  /**
   * Creates a function that wraps `func` to invoke its iteratee with arguments
   * arranged according to the specified `indexes` where the argument value at
   * the first index is provided as the first argument, the argument value at
   * the second index is provided as the second argument, and so on.
   *
   * @private
   * @param {Function} func The function to rearrange iteratee arguments for.
   * @param {number[]} indexes The arranged argument indexes.
   * @returns {Function} Returns the new function.
   */
  function iterateeRearg(func: LodashFunction, indexes: number[]): LodashFunction {
    return overArg(func, function(func) {
      var n = indexes.length;
      return baseArity(rearg(baseAry(callableValue(func), n), indexes), n);
    });
  }

  /**
   * Creates a function that invokes `func` with its first argument transformed.
   *
   * @private
   * @param {Function} func The function to wrap.
   * @param {Function} transform The argument transform.
   * @returns {Function} Returns the new function.
   */
  function overArg(func: LodashFunction, transform: LodashFunction): LodashDynamicFunction {
    return function(this: unknown) {
      var length = arguments.length;
      if (!length) {
        return callableValue(func)();
      }
      var args: unknown[] = Array(length);
      while (length--) {
        args[length] = arguments[length];
      }
      var index = config.rearg ? 0 : (length - 1);
      args[index] = callableValue(transform)(args[index]);
      return callableValue(func).apply(undefined, args);
    };
  }

  /**
   * Creates a function that wraps `func` and applys the conversions
   * rules by `name`.
   *
   * @private
   * @param {string} name The name of the function to wrap.
   * @param {Function} func The function to wrap.
   * @returns {Function} Returns the converted function.
   */
  function wrap(name: unknown, func: LodashFunction, placeholder: unknown): LodashFunction {
    var result: LodashFunction | undefined,
        realName = mappingEntry(mapping.aliasToReal, name) || name,
        wrapped = func,
        wrapper = mappingEntry(wrappers, realName);

    if (wrapper) {
      wrapped = wrapper(func);
    }
    else if (config.immutable) {
      if (mappingEntry(mapping.mutate.array, realName)) {
        wrapped = wrapImmutable(func, cloneArray);
      }
      else if (mappingEntry(mapping.mutate.object, realName)) {
        wrapped = wrapImmutable(func, createCloner(func));
      }
      else if (mappingEntry(mapping.mutate.set, realName)) {
        wrapped = wrapImmutable(func, cloneByPath);
      }
    }
    each(aryMethodKeys, function(aryKey: string) {
      each(mappingEntry(mapping.aryMethod, aryKey), function(otherName: string) {
        if (realName == otherName) {
          var data = mappingEntry(mapping.methodSpread, realName),
              afterRearg = data && data.afterRearg;

          result = afterRearg
            ? castFixed(realName, castRearg(realName, wrapped, aryKey), aryKey)
            : castRearg(realName, castFixed(realName, wrapped, aryKey), aryKey);

          result = castCap(realName, result);
          result = castCurry(realName, result, aryKey);
          return false;
        }
      });
      return !result;
    });

    result || (result = wrapped);
    if (result == func) {
      result = forceCurry ? curry(result, 1) : function() {
        return callableValue(func).apply(this, arguments);
      };
    }
    record(present(result)).convert = createConverter(realName, func);
    record(present(result)).placeholder = record(func).placeholder = placeholder;

    return present(result);
  }

  /*--------------------------------------------------------------------------*/

  if (!isObj) {
    return wrap(name, callableValue(func), defaultHolder);
  }
  var _ = record(func);

  // Convert methods by ary cap.
  var pairs: [PropertyKey, unknown][] = [];
  each(aryMethodKeys, function(aryKey: string|number) {
    each(mappingEntry(mapping.aryMethod, aryKey), function(key: string|number) {
      var func = _[mappingEntry(mapping.remap, key) || key];
      if (func) {
        pairs.push([key, wrap(key, callableValue(func), _)]);
      }
    });
  });

  // Convert remaining methods.
  each(keys(_), function(key: string|number) {
    var func = _[key];
    if (typeof func == 'function') {
      var length = pairs.length;
      while (length--) {
        if (pairs[length][0] == key) {
          return;
        }
      }
      record(func).convert = createConverter(key, callableValue(func));
      pairs.push([key, func]);
    }
  });

  // Assign to `_` leaving `_.prototype` unchanged to allow chaining.
  each(pairs, function(pair: [PropertyKey, unknown]) {
    _[pair[0]] = pair[1];
  });

  _.convert = convertLib;
  _.placeholder = _;

  // Assign aliases.
  each(keys(_), function(key: string|number) {
    each(mappingEntry(mapping.realToAlias, key) || [], function(alias: string) {
      _[alias] = _[key];
    });
  });

  return _;
}

module.exports = baseConvert;


/***/ 
const result: unknown = module.exports;
if (!isBaseConvert(result)) throw new TypeError("Expected the original Lodash converter export");
return result;
}
