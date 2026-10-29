import type {RuntimePath, PathConstructor, PathName} from "../../../types/ast-types/runtime-paths.ts";
import type {ASTNode, Fork} from "../../../types/ast-types/types.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/path.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, runtimeArrayLike} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "./shared.ts";
import {load as load2} from "./types.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/path.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","default"]);
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof pathPlugin; } = {};
let module = {exports};
cache = module;


"use strict";
/* module decorator */ module = webpack.nmd(module);

Object.defineProperty(exports, "__esModule", ({ value: true }));
var tslib_1 = load0();
var shared_1 = load1();
var types_1 = tslib_1.__importDefault(load2());
var Op = Object.prototype;
var hasOwn = Op.hasOwnProperty;
function pathPlugin(fork: Fork): PathConstructor {
    var types = fork.use(types_1.default!);
    var isArray = types.builtInTypes.array;
    var isNumber = types.builtInTypes.number;
    class Path {
declare value: unknown;
declare parentPath: RuntimePath | null;
declare name: PathName;
declare __childCache: Record<PropertyKey, RuntimePath> | null;
declare ["constructor"]: PathConstructor;
declare getValueProperty: RuntimePath["getValueProperty"];
declare get: RuntimePath["get"];
declare each: RuntimePath["each"];
declare map: RuntimePath["map"];
declare filter: RuntimePath["filter"];
declare shift: RuntimePath["shift"];
declare unshift: RuntimePath["unshift"];
declare push: RuntimePath["push"];
declare pop: RuntimePath["pop"];
declare insertAt: RuntimePath["insertAt"];
declare insertBefore: RuntimePath["insertBefore"];
declare insertAfter: RuntimePath["insertAfter"];
declare replace: RuntimePath["replace"];

constructor(value: unknown, parentPath?: RuntimePath | null, name?: PathName) {
        if (!(this instanceof Path)) {
            throw new Error("Path constructor cannot be invoked without 'new'");
        }
        if (parentPath) {
            if (!(parentPath instanceof Path)) {
                throw new Error("");
            }
        }
        else {
            parentPath = null;
            name = null;
        }
        // The value encapsulated by this Path, generally equal to
        // parentPath.value[name] if we have a parentPath.
        this.value = value;
        // The immediate parent Path of this Path.
        this.parentPath = parentPath;
        // The name of the property of parentPath.value through which this
        // Path's value was reached.
        this.name = name;
        // Calling path.get("child") multiple times always returns the same
        // child Path object, for both performance and consistency reasons.
        this.__childCache = null;
    }
}
    var Pp: Path = Path.prototype;
    function getChildCache(path: RuntimePath): Record<PropertyKey, RuntimePath> {
        // Lazily create the child cache. This also cheapens cache
        // invalidation, since you can just reset path.__childCache to null.
        return path.__childCache || (path.__childCache = checkedPathCache(Object.create(null)));
    }
    function getChildPath(path: RuntimePath, name: PropertyKey): RuntimePath {
        var cache = getChildCache(path);
        var actualChildValue = path.getValueProperty(name);
        var childPath = cache[name];
        if (!hasOwn.call(cache, name) ||
            // Ensure consistency between cache and reality.
            childPath.value !== actualChildValue) {
            childPath = cache[name] = new path.constructor(actualChildValue, path, name);
        }
        return childPath;
    }
    // This method is designed to be overridden by subclasses that need to
    // handle missing properties, etc.
    Pp.getValueProperty = function getValueProperty(name) {
        return readProperty(this.value, name);
    };
    Pp.get = function get() {
        var names: PropertyKey[] = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            names[_i] = pathPropertyKey(arguments[_i]);
        }
        var path: RuntimePath = this;
        var count = names.length;
        for (var i = 0; i < count; ++i) {
            path = getChildPath(path, names[i]);
        }
        return path;
    };
    Pp.each = function each(callback, context) {
        var childPaths: RuntimePath[] = [];
        var len = runtimeArrayLike(this.value).length;
        var i = 0;
        // Collect all the original child paths before invoking the callback.
        for (var i = 0; i < len; ++i) {
            if (hasOwn.call(this.value, i)) {
                childPaths[i] = this.get(i);
            }
        }
        // Invoke the callback on just the original child paths, regardless of
        // any modifications made to the array by the callback. I chose these
        // semantics over cleverly invoking the callback on new elements because
        // this way is much easier to reason about.
        context = context || this;
        for (i = 0; i < len; ++i) {
            if (hasOwn.call(childPaths, i)) {
                callback.call(context, childPaths[i]);
            }
        }
    };
    Pp.map = function map<T>(callback: (this: unknown, path: RuntimePath) => T, context?: unknown) {
        var result: T[] = [];
        this.each(function (childPath) {
            result.push(callback.call(this, childPath));
        }, context);
        return result;
    };
    Pp.filter = function filter(callback, context) {
        var result: RuntimePath[] = [];
        this.each(function (childPath) {
            if (callback.call(this, childPath)) {
                result.push(childPath);
            }
        }, context);
        return result;
    };
    function emptyMoves() { }
    function getMoves(path: RuntimePath, offset: number, start?: PathName, end?: PathName) {
        isArray.assert(path.value);
        if (offset === 0) {
            return emptyMoves;
        }
        var length = pathArray(path.value).length;
        if (length < 1) {
            return emptyMoves;
        }
        var argc = arguments.length;
        if (argc === 2) {
            start = 0;
            end = length;
        }
        else if (argc === 3) {
            start = Math.max(Number(start), 0);
            end = length;
        }
        else {
            start = Math.max(Number(start), 0);
            end = Math.min(Number(end), length);
        }
        isNumber.assert(start);
        isNumber.assert(end);
        var moves: Record<string, RuntimePath> = checkedPathCache(Object.create(null));
        var cache = getChildCache(path);
        for (var i = pathNumber(start); i < pathNumber(end); ++i) {
            if (hasOwn.call(path.value, i)) {
                var childPath = path.get(i);
                if (childPath.name !== i) {
                    throw new Error("");
                }
                var newIndex = i + offset;
                childPath.name = newIndex;
                moves[newIndex] = childPath;
                delete cache[i];
            }
        }
        delete cache.length;
        return function () {
            for (var newIndex in moves) {
                var childPath = moves[newIndex];
                if (childPath.name !== +newIndex) {
                    throw new Error("");
                }
                cache[newIndex] = childPath;
                record(path.value)[newIndex] = childPath.value;
            }
        };
    }
    Pp.shift = function shift() {
        var move = getMoves(this, -1);
        var result = pathArray(this.value).shift();
        move();
        return result;
    };
    Pp.unshift = function unshift() {
        var args: unknown[] = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        var move = getMoves(this, args.length);
        var result = pathArray(this.value).unshift.apply(this.value, args);
        move();
        return result;
    };
    Pp.push = function push() {
        var args: unknown[] = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        isArray.assert(this.value);
        delete getChildCache(this).length;
        return pathArray(this.value).push.apply(this.value, args);
    };
    Pp.pop = function pop() {
        isArray.assert(this.value);
        var cache = getChildCache(this);
        delete cache[pathArray(this.value).length - 1];
        delete cache.length;
        return pathArray(this.value).pop();
    };
    Pp.insertAt = function insertAt(index) {
        var argc = arguments.length;
        var move = getMoves(this, argc - 1, index);
        if (move === emptyMoves && argc <= 1) {
            return this;
        }
        index = Math.max(Number(index), 0);
        for (var i = 1; i < argc; ++i) {
            record(this.value)[pathNumber(index) + i - 1] = arguments[i];
        }
        move();
        return this;
    };
    Pp.insertBefore = function insertBefore() {
        var args: unknown[] = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        var pp = this.parentPath;
        var argc = args.length;
        var insertAtArgs: [PathName, ...unknown[]] = [this.name];
        for (var i = 0; i < argc; ++i) {
            insertAtArgs.push(args[i]);
        }
        return pp!.insertAt.apply(pp, insertAtArgs);
    };
    Pp.insertAfter = function insertAfter() {
        var args: unknown[] = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        var pp = this.parentPath;
        var argc = args.length;
        var insertAtArgs: [PathName, ...unknown[]] = [offsetPathName(this.name, 1)];
        for (var i = 0; i < argc; ++i) {
            insertAtArgs.push(args[i]);
        }
        return pp!.insertAt.apply(pp, insertAtArgs);
    };
    function repairRelationshipWithParent(path: unknown) {
        if (!(path instanceof Path)) {
            throw new Error("");
        }
        var pp = path.parentPath;
        if (!pp) {
            // Orphan paths have no relationship to repair.
            return path;
        }
        var parentValue = pp.value;
        var parentCache = getChildCache(pp);
        // Make sure parentCache[path.name!] is populated.
        if (record(parentValue)[path.name!] === path.value) {
            parentCache[path.name!] = path;
        }
        else if (isArray.check(parentValue)) {
            // Something caused path.name to become out of date, so attempt to
            // recover by searching for path.value in parentValue.
            var i = parentValue.indexOf(path.value);
            if (i >= 0) {
                parentCache[path.name = i] = path;
            }
        }
        else {
            // If path.value disagrees with record(parentValue)[path.name!], and
            // path.name is not an array index, let path.value become the new
            // record(parentValue)[path.name!] and update parentCache accordingly.
            record(parentValue)[path.name!] = path.value;
            parentCache[path.name!] = path;
        }
        if (record(parentValue)[path.name!] !== path.value) {
            throw new Error("");
        }
        if (path.parentPath!.get(path.name!) !== path) {
            throw new Error("");
        }
        return path;
    }
    Pp.replace = function replace(replacement) {
        var results: RuntimePath[] = [];
        var parentValue = this.parentPath!.value;
        var parentCache = getChildCache(this.parentPath!);
        var count = arguments.length;
        repairRelationshipWithParent(this);
        if (isArray.check(parentValue)) {
            var originalLength = parentValue.length;
            var move = getMoves(this.parentPath!, count - 1, offsetPathName(this.name, 1));
            var spliceArgs: [PathName, number, ...unknown[]] = [this.name, 1];
            for (var i = 0; i < count; ++i) {
                spliceArgs.push(arguments[i]);
            }
            var splicedOut = pathArray(parentValue).splice.apply(parentValue, spliceArgs);
            if (splicedOut[0] !== this.value) {
                throw new Error("");
            }
            if (parentValue.length !== (originalLength - 1 + count)) {
                throw new Error("");
            }
            move();
            if (count === 0) {
                delete this.value;
                delete parentCache[this.name!];
                this.__childCache = null;
            }
            else {
                if (record(parentValue)[this.name!] !== replacement) {
                    throw new Error("");
                }
                if (this.value !== replacement) {
                    this.value = replacement;
                    this.__childCache = null;
                }
                for (i = 0; i < count; ++i) {
                    results.push(this.parentPath!.get(offsetPathName(this.name, i)));
                }
                if (results[0] !== this) {
                    throw new Error("");
                }
            }
        }
        else if (count === 1) {
            if (this.value !== replacement) {
                this.__childCache = null;
            }
            this.value = record(parentValue)[this.name!] = replacement;
            results.push(this);
        }
        else if (count === 0) {
            delete record(parentValue)[this.name!];
            delete this.value;
            this.__childCache = null;
            // Leave this path cached as parentCache[this.name!], even though
            // it no longer has a value defined.
        }
        else {
            throw new Error("Could not replace path");
        }
        return results;
    };

    function checkedPathCache(value: unknown): Record<PropertyKey, RuntimePath> {
        if (isPathCache(value)) return value;
        throw new TypeError("Expected original Path cache");
    }
    function isPathCache(value: unknown): value is Record<PropertyKey, RuntimePath> {
        return isRecord(value) && Object.keys(value).every(key => value[key] instanceof Path);
    }
    return Path;
}
exports["default"] = pathPlugin;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=path.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}

interface MutablePathArray extends Array<unknown> {
    splice(start: PathName, deleteCount?: number, ...items: unknown[]): unknown[];
}
function isMutablePathArray(value: unknown): value is MutablePathArray { return Array.isArray(value); }
function pathArray(value: unknown): MutablePathArray {
    if (isMutablePathArray(value)) return value;
    throw new TypeError("Expected original path array");
}
function pathPropertyKey(value: unknown): PropertyKey {
    if (typeof value === "string" || typeof value === "number" || typeof value === "symbol") return value;
    throw new TypeError("Expected original path name");
}
function pathNumber(value: PathName): number {
    if (typeof value === "number") return value;
    throw new TypeError("Expected original numeric path phase");
}
function offsetPathName(value: PathName, offset: number): string | number {
    if (typeof value === "string") return value + offset;
    return Number(value) + offset;
}
