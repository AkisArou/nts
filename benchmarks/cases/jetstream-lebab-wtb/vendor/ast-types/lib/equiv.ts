import type {Fork} from "../../../types/ast-types/types.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/equiv.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "./shared.ts";
import {load as load2} from "./types.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/equiv.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","default"]);
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof default_1; } = {};
let module = {exports};
cache = module;


"use strict";
/* module decorator */ module = webpack.nmd(module);

Object.defineProperty(exports, "__esModule", ({ value: true }));
var tslib_1 = load0();
var shared_1 = load1();
var types_1 = tslib_1.__importDefault(load2());
function default_1(fork: Fork) {
    var types = fork.use(types_1.default!);
    var getFieldNames = types.getFieldNames;
    var getFieldValue = types.getFieldValue;
    var isArray = types.builtInTypes.array;
    var isObject = types.builtInTypes.object;
    var isDate = types.builtInTypes.Date;
    var isRegExp = types.builtInTypes.RegExp;
    var hasOwn = Object.prototype.hasOwnProperty;
    function astNodesAreEquivalent(a: unknown, b: unknown, problemPath?: unknown) {
        if (isArray.check(problemPath)) {
            problemPath.length = 0;
        }
        else {
            problemPath = null;
        }
        return areEquivalent(a, b, equivalencePath(problemPath));
    }
    astNodesAreEquivalent.assert = function (a: unknown, b: unknown) {
        var problemPath: unknown[] = [];
        if (!astNodesAreEquivalent(a, b, problemPath)) {
            if (problemPath.length === 0) {
                if (a !== b) {
                    throw new Error("Nodes must be equal");
                }
            }
            else {
                throw new Error("Nodes differ in the following path: " +
                    problemPath.map(subscriptForProperty).join(""));
            }
        }
    };
    function subscriptForProperty(property: unknown) {
        if (/[_$a-z][_$a-z0-9]*/i.test(equivalenceString(property))) {
            return "." + property;
        }
        return "[" + JSON.stringify(property) + "]";
    }
    function areEquivalent(a: unknown, b: unknown, problemPath: unknown[] | null): boolean {
        if (a === b) {
            return true;
        }
        if (isArray.check(a)) {
            return arraysAreEquivalent(a, b, problemPath);
        }
        if (isObject.check(a)) {
            return objectsAreEquivalent(a, b, problemPath);
        }
        if (isDate.check(a)) {
            return isDate.check(b) && (+a === +b);
        }
        if (isRegExp.check(a)) {
            return isRegExp.check(b) && (a.source === b.source &&
                a.global === b.global &&
                a.multiline === b.multiline &&
                a.ignoreCase === b.ignoreCase);
        }
        return a == b;
    }
    function arraysAreEquivalent(a: unknown[], b: unknown, problemPath: unknown[] | null): boolean {
        isArray.assert(a);
        var aLength = a.length;
        if (!isArray.check(b) || b.length !== aLength) {
            if (problemPath) {
                problemPath.push("length");
            }
            return false;
        }
        for (var i = 0; i < aLength; ++i) {
            if (problemPath) {
                problemPath.push(i);
            }
            if (i in a !== i in b) {
                return false;
            }
            if (!areEquivalent(a[i], b[i], problemPath)) {
                return false;
            }
            if (problemPath) {
                var problemPathTail = problemPath.pop();
                if (problemPathTail !== i) {
                    throw new Error("" + problemPathTail);
                }
            }
        }
        return true;
    }
    function objectsAreEquivalent(a: Record<PropertyKey, unknown>, b: unknown, problemPath: unknown[] | null): boolean {
        isObject.assert(a);
        if (!isObject.check(b)) {
            return false;
        }
        // Fast path for a common property of AST nodes.
        if (a.type !== b.type) {
            if (problemPath) {
                problemPath.push("type");
            }
            return false;
        }
        var aNames = getFieldNames(a);
        var aNameCount = aNames.length;
        var bNames = getFieldNames(b);
        var bNameCount = bNames.length;
        if (aNameCount === bNameCount) {
            for (var i = 0; i < aNameCount; ++i) {
                var name = aNames[i];
                var aChild = getFieldValue(a, name);
                var bChild = getFieldValue(b, name);
                if (problemPath) {
                    problemPath.push(name);
                }
                if (!areEquivalent(aChild, bChild, problemPath)) {
                    return false;
                }
                if (problemPath) {
                    var problemPathTail = problemPath.pop();
                    if (problemPathTail !== name) {
                        throw new Error("" + problemPathTail);
                    }
                }
            }
            return true;
        }
        if (!problemPath) {
            return false;
        }
        // Since aNameCount !== bNameCount, we need to find some name that's
        // missing in aNames but present in bNames, or vice-versa.
        var seenNames = record(Object.create(null));
        for (i = 0; i < aNameCount; ++i) {
            seenNames[aNames[i]] = true;
        }
        for (i = 0; i < bNameCount; ++i) {
            name = bNames[i];
            if (!hasOwn.call(seenNames, name)) {
                problemPath.push(name);
                return false;
            }
            delete seenNames[name];
        }
        for (name in seenNames) {
            problemPath.push(name);
            break;
        }
        return false;
    }
    function equivalencePath(value: unknown): unknown[] | null {
        if (value === null || Array.isArray(value)) return value;
        throw new TypeError("Expected equivalence problem path");
    }
    function equivalenceString(value: unknown): string {
        if (typeof value === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
        return String(value);
    }
    return astNodesAreEquivalent;
}
exports["default"] = default_1;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=equiv.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
