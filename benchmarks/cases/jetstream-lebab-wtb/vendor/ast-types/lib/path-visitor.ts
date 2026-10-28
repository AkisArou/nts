import type {Fork, Omit} from "../../../types/ast-types/types.js";
import type {RuntimePath, RuntimeNodePath} from "../../../types/ast-types/runtime-paths.ts";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/path-visitor.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, runtimeCallable} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "./types.ts";
import {load as load2} from "./node-path.ts";
import {load as load3} from "./shared.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/path-visitor.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","default"]);
}
function initialize() {
interface PathVisitor {
  _reusableContextStack: Context[];
  _methodNameTable: Record<string, string>;
  _shouldVisitComments: boolean;
  Context: new(path: unknown) => Context;
  _visiting: boolean;
  _changeReported: boolean;
  _abortRequested: boolean;
  visit(...args: unknown[]): unknown;
  reset(path?: unknown, ...args: unknown[]): unknown;
  visitWithoutReset(path: unknown): unknown;
  AbortRequest: new() => {cancel?: () => void};
  abort(): void;
  acquireContext(path: unknown): Context;
  releaseContext(context: Context): void;
  reportChanged(): void;
  wasChangeReported(): boolean;
}
interface VisitorMethods {
  [visitorMethod: string]: (this: Context, path: RuntimeNodePath) => unknown;
}
interface SharedContextMethods {
  reset(this: Context, path: unknown): Context;
  invokeVisitorMethod(this: Context, methodName: string): unknown;
  traverse(this: Context, path: unknown, newVisitor?: VisitorMethods): unknown;
  visit(this: Context, path: unknown, newVisitor?: VisitorMethods): unknown;
  reportChanged(this: Context): void;
  abort(this: Context): void;
}
interface Context extends Omit<PathVisitor, "visit" | "reset" | "abort" | "reportChanged">, SharedContextMethods {
  currentPath: RuntimePath | null;
  needToCallTraverse: boolean;
  visitor: PathVisitor;
}

const exports: { __esModule?: true; "default"?: typeof pathVisitorPlugin; } = {};
let module = {exports};
cache = module;


"use strict";
/* module decorator */ module = webpack.nmd(module);

Object.defineProperty(exports, "__esModule", ({ value: true }));
var tslib_1 = load0();
var types_1 = tslib_1.__importDefault(load1());
var node_path_1 = tslib_1.__importDefault(load2());
var shared_1 = load3();
var hasOwn = Object.prototype.hasOwnProperty;
function pathVisitorPlugin(fork: Fork) {
    var types = fork.use(types_1.default!);
    var NodePath = fork.use(node_path_1.default);
    var isArray = types.builtInTypes.array;
    var isObject = types.builtInTypes.object;
    var isFunction = types.builtInTypes.function;
    var undefined: undefined;
    class PathVisitor {
declare _reusableContextStack: Context[];
declare _methodNameTable: Record<string, string>;
declare _shouldVisitComments: boolean;
declare Context: new(path: unknown) => Context;
declare _visiting: boolean;
declare _changeReported: boolean;
declare _abortRequested: boolean;
declare visit: (...args: unknown[]) => unknown;
declare reset: (path?: unknown, ...args: unknown[]) => unknown;
declare visitWithoutReset: (path: unknown) => unknown;
declare AbortRequest: new() => {cancel?: () => void};
declare abort: () => void;
declare acquireContext: (path: unknown) => Context;
declare releaseContext: (context: Context) => void;
declare reportChanged: () => void;
declare wasChangeReported: () => boolean;
declare static fromMethodsObject: (methods?: unknown) => PathVisitor;
declare static visit: (node: unknown, methods?: unknown) => unknown;
constructor() {
        if (!(this instanceof PathVisitor)) {
            throw new Error("PathVisitor constructor cannot be invoked without 'new'");
        }
        // Permanent state.
        this._reusableContextStack = [];
        this._methodNameTable = computeMethodNameTable(this);
        this._shouldVisitComments =
            hasOwn.call(this._methodNameTable, "Block") ||
                hasOwn.call(this._methodNameTable, "Line");
        this.Context = makeContextConstructor(this);
        // State reset every time PathVisitor.prototype.visit is called.
        this._visiting = false;
        this._changeReported = false;
    }
}
    function computeMethodNameTable(visitor: PathVisitor) {
        var typeNames = record(Object.create(null));
        for (var methodName in visitor) {
            if (/^visit[A-Z]/.test(methodName)) {
                typeNames[methodName.slice("visit".length)] = true;
            }
        }
        var supertypeTable = types.computeSupertypeLookupTable(typeNames);
        var methodNameTable = visitorStringTable(Object.create(null));
        var typeNameKeys = Object.keys(supertypeTable);
        var typeNameCount = typeNameKeys.length;
        for (var i = 0; i < typeNameCount; ++i) {
            var typeName = typeNameKeys[i];
            methodName = "visit" + supertypeTable[typeName];
            if (isFunction.check(readProperty(visitor, methodName))) {
                methodNameTable[typeName] = methodName;
            }
        }
        return methodNameTable;
    }
    PathVisitor.fromMethodsObject = function fromMethodsObject(methods) {
        if (methods instanceof PathVisitor) {
            return methods;
        }
        if (!isObject.check(methods)) {
            // An empty visitor?
            return new PathVisitor;
        }
        class Visitor extends PathVisitor {
        constructor() {
            super();
            if (!(this instanceof Visitor)) {
                throw new Error("Visitor constructor cannot be invoked without 'new'");
            }
        }
        }
        var Vp = Visitor.prototype;
        Object.defineProperty(Vp, "constructor", {value: Visitor, enumerable: true, writable: true, configurable: true});
        Vp.constructor = Visitor;
        extend(Vp, methods);
        extend(Visitor, PathVisitor);
        isFunction.assert(Visitor.fromMethodsObject);
        isFunction.assert(Visitor.visit);
        return new Visitor;
    };
    function extend<T extends object>(target: T, source: object) {
        for (var property in source) {
            if (hasOwn.call(source, property)) {
                record(target)[property] = readProperty(source, property);
            }
        }
        return target;
    }
    PathVisitor.visit = function visit(node, methods) {
        return PathVisitor.fromMethodsObject(methods).visit(node);
    };
    var PVp: PathVisitor = PathVisitor.prototype;
    PVp.visit = function () {
        if (this._visiting) {
            throw new Error("Recursively calling visitor.visit(path) resets visitor state. " +
                "Try this.visit(path) or this.traverse(path) instead.");
        }
        // Private state that needs to be reset before every traversal.
        this._visiting = true;
        this._changeReported = false;
        this._abortRequested = false;
        var argc = arguments.length;
        var args = new Array<unknown>(argc);
        for (var i = 0; i < argc; ++i) {
            args[i] = arguments[i];
        }
        if (!(args[0] instanceof NodePath)) {
            args[0] = new NodePath({ root: args[0] }).get("root");
        }
        // Called with the same arguments as .visit.
        this.reset.apply(this, args);
        var didNotThrow: boolean | undefined;
        try {
            var root = this.visitWithoutReset(args[0]);
            didNotThrow = true;
        }
        finally {
            this._visiting = false;
            if (!didNotThrow && this._abortRequested) {
                // If this.visitWithoutReset threw an exception and
                // this._abortRequested was set to true, return the root of
                // the AST instead of letting the exception propagate, so that
                // client code does not have to provide a try-catch block to
                // intercept the AbortRequest exception.  Other kinds of
                // exceptions will propagate without being intercepted and
                // rethrown by a catch block, so their stacks will accurately
                // reflect the original throwing context.
                return readProperty(args[0], "value");
            }
        }
        return root;
    };
    PVp.AbortRequest = class AbortRequest { declare cancel?: () => void; constructor() {} };
    PVp.abort = function () {
        var visitor = this;
        visitor._abortRequested = true;
        var request = new visitor.AbortRequest();
        // If you decide to catch this exception and stop it from propagating,
        // make sure to call its cancel method to avoid silencing other
        // exceptions that might be thrown later in the traversal.
        request.cancel = function () {
            visitor._abortRequested = false;
        };
        throw request;
    };
    PVp.reset = function (_path /*, additional arguments */) {
        // Empty stub; may be reassigned or overridden by subclasses.
    };
    PVp.visitWithoutReset = function (path) {
        if (this instanceof this.Context) {
            // Since this.Context.prototype === this, there's a chance we
            // might accidentally call context.visitWithoutReset. If that
            // happens, re-invoke the method against context.visitor.
            return this.visitor.visitWithoutReset(path);
        }
        if (!(path instanceof NodePath)) {
            throw new Error("");
        }
        var value = path.value;
        var methodName = value &&
            typeof value === "object" &&
            typeof readProperty(value, "type") === "string" &&
            this._methodNameTable[visitorString(readProperty(value, "type"))];
        if (methodName) {
            var context = this.acquireContext(path);
            try {
                return context.invokeVisitorMethod(visitorString(methodName));
            }
            finally {
                this.releaseContext(context);
            }
        }
        else {
            // If there was no visitor method to call, visit the children of
            // this node generically.
            return visitChildren(path, this);
        }
    };
    function visitChildren(path: unknown, visitor: unknown) {
        if (!(path instanceof NodePath)) {
            throw new Error("");
        }
        if (!(visitor instanceof PathVisitor)) {
            throw new Error("");
        }
        var value = path.value;
        if (isArray.check(value)) {
            path.each(visitor.visitWithoutReset, visitor);
        }
        else if (!isObject.check(value)) {
            // No children to visit.
        }
        else {
            var childNames = types.getFieldNames(value);
            // The .comments field of the Node type is hidden, so we only
            // visit it if the visitor defines visitBlock or visitLine, and
            // value.comments is defined.
            if (visitor._shouldVisitComments &&
                value.comments &&
                childNames.indexOf("comments") < 0) {
                childNames.push("comments");
            }
            var childCount = childNames.length;
            var childPaths: RuntimeNodePath[] = [];
            for (var i = 0; i < childCount; ++i) {
                var childName = childNames[i];
                if (!hasOwn.call(value, childName)) {
                    value[childName] = types.getFieldValue(value, childName);
                }
                childPaths.push(path.get(childName));
            }
            for (var i = 0; i < childCount; ++i) {
                visitor.visitWithoutReset(childPaths[i]);
            }
        }
        return path.value;
    }
    PVp.acquireContext = function (path) {
        if (this._reusableContextStack.length === 0) {
            return new this.Context(path);
        }
        return this._reusableContextStack.pop()!.reset(path);
    };
    PVp.releaseContext = function (context) {
        if (!(context instanceof this.Context)) {
            throw new Error("");
        }
        this._reusableContextStack.push(context);
        context.currentPath = null;
    };
    PVp.reportChanged = function () {
        this._changeReported = true;
    };
    PVp.wasChangeReported = function () {
        return this._changeReported;
    };
    function makeContextConstructor(visitor: PathVisitor) {
        class Context {
            declare visitor: PathVisitor;
            declare currentPath: RuntimePath | null;
            declare needToCallTraverse: boolean;
            declare Context: new(path: unknown) => Context;
            declare reset: (path: unknown) => Context;
            declare invokeVisitorMethod: (methodName: string) => unknown;
            declare traverse: (path: unknown, visitor?: VisitorMethods) => unknown;
            declare visit: (path: unknown, visitor?: VisitorMethods) => unknown;
            declare reportChanged: () => void;
            declare abort: () => void;
            declare _reusableContextStack: Context[];
            declare _methodNameTable: Record<string, string>;
            declare _shouldVisitComments: boolean;
            declare _visiting: boolean;
            declare _changeReported: boolean;
            declare _abortRequested: boolean;
            declare visitWithoutReset: (path: unknown) => unknown;
            declare AbortRequest: new() => {cancel?: () => void};
            declare acquireContext: (path: unknown) => Context;
            declare releaseContext: (context: Context) => void;
            declare wasChangeReported: () => boolean;
        constructor(path: unknown) {
            if (!(this instanceof Context)) {
                throw new Error("");
            }
            if (!(this instanceof PathVisitor)) {
                throw new Error("");
            }
            if (!(path instanceof NodePath)) {
                throw new Error("");
            }
            Object.defineProperty(this, "visitor", {
                value: visitor,
                writable: false,
                enumerable: true,
                configurable: false
            });
            this.currentPath = path;
            this.needToCallTraverse = true;
            Object.seal(this);
        }
        }
        if (!(visitor instanceof PathVisitor)) {
            throw new Error("");
        }
        // Note that the visitor object is the prototype of Context.prototype,
        // so all visitor methods are inherited by context objects.
        var Cp = Context.prototype;
        Object.setPrototypeOf(Cp, visitor);
        Object.defineProperty(Cp, "constructor", {value: Context, enumerable: true, writable: true, configurable: true});
        Cp.constructor = Context;
        extend(Cp, sharedContextProtoMethods);
        return Context;
    }
    // Every PathVisitor has a different this.Context constructor and
    // this.Context.prototype object, but those prototypes can all use the
    // same reset, invokeVisitorMethod, and traverse function objects.
    var sharedContextProtoMethods: Partial<SharedContextMethods> = visitorSharedMethods(Object.create(null));
    sharedContextProtoMethods.reset =
        function reset(path) {
            if (!(this instanceof this.Context)) {
                throw new Error("");
            }
            if (!(path instanceof NodePath)) {
                throw new Error("");
            }
            this.currentPath = path;
            this.needToCallTraverse = true;
            return this;
        };
    sharedContextProtoMethods.invokeVisitorMethod =
        function invokeVisitorMethod(methodName) {
            if (!(this instanceof this.Context)) {
                throw new Error("");
            }
            if (!(this.currentPath instanceof NodePath)) {
                throw new Error("");
            }
            var result = runtimeCallable(readProperty(this.visitor, methodName)).call(this, this.currentPath);
            if (result === false) {
                // Visitor methods return false to indicate that they have handled
                // their own traversal needs, and we should not complain if
                // this.needToCallTraverse is still true.
                this.needToCallTraverse = false;
            }
            else if (result !== undefined) {
                // Any other non-undefined value returned from the visitor method
                // is interpreted as a replacement value.
                this.currentPath = this.currentPath.replace(result)[0];
                if (this.needToCallTraverse) {
                    // If this.traverse still hasn't been called, visit the
                    // children of the replacement node.
                    this.traverse(this.currentPath);
                }
            }
            if (this.needToCallTraverse !== false) {
                throw new Error("Must either call this.traverse or return false in " + methodName);
            }
            var path = this.currentPath;
            return path && path.value;
        };
    sharedContextProtoMethods.traverse =
        function traverse(path, newVisitor) {
            if (!(this instanceof this.Context)) {
                throw new Error("");
            }
            if (!(path instanceof NodePath)) {
                throw new Error("");
            }
            if (!(this.currentPath instanceof NodePath)) {
                throw new Error("");
            }
            this.needToCallTraverse = false;
            return visitChildren(path, PathVisitor.fromMethodsObject(newVisitor || this.visitor));
        };
    sharedContextProtoMethods.visit =
        function visit(path, newVisitor) {
            if (!(this instanceof this.Context)) {
                throw new Error("");
            }
            if (!(path instanceof NodePath)) {
                throw new Error("");
            }
            if (!(this.currentPath instanceof NodePath)) {
                throw new Error("");
            }
            this.needToCallTraverse = false;
            return PathVisitor.fromMethodsObject(newVisitor || this.visitor).visitWithoutReset(path);
        };
    sharedContextProtoMethods.reportChanged = function reportChanged() {
        this.visitor.reportChanged();
    };
    sharedContextProtoMethods.abort = function abort() {
        this.needToCallTraverse = false;
        this.visitor.abort();
    };
    function visitorString(value: unknown): string {
        if (typeof value === "string") return value;
        throw new TypeError("Expected AST type name");
    }
    function visitorStringTable(value: unknown): Record<string, string> {
        if (isVisitorStringTable(value)) return value;
        throw new TypeError("Expected visitor method table");
    }
    function isVisitorStringTable(value: unknown): value is Record<string, string> {
        return isRecord(value) && Object.keys(value).every(key => typeof value[key] === "string");
    }
    function visitorSharedMethods(value: unknown): Partial<SharedContextMethods> {
        if (isVisitorSharedMethods(value)) return value;
        throw new TypeError("Expected context method table");
    }
    function isVisitorSharedMethods(value: unknown): value is Partial<SharedContextMethods> {
        return isRecord(value) &&
            (value.reset === undefined || typeof value.reset === "function") &&
            (value.invokeVisitorMethod === undefined || typeof value.invokeVisitorMethod === "function") &&
            (value.traverse === undefined || typeof value.traverse === "function") &&
            (value.visit === undefined || typeof value.visit === "function") &&
            (value.reportChanged === undefined || typeof value.reportChanged === "function") &&
            (value.abort === undefined || typeof value.abort === "function");
    }
    return PathVisitor;
}
exports["default"] = pathVisitorPlugin;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=path-visitor.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
