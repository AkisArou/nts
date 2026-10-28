// Exact module body from JetStream 3.0 ./node_modules/tslib/tslib.es6.mjs.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, hasEsModuleFlag, exportsReady, runtimeProperty, runtimeRecord, runtimeCall, runtimeMethod, runtimeCallable, runtimeIterator, runtimeIteratorResult, runtimeArrayLike, type RuntimeCallable, type RuntimeRecord, type RuntimeIterator, type RawIteratorResult} from "../../webpack.ts";

type ImportNamespace<T> = Pick<T, Exclude<Extract<keyof T, string>, "default">> & {default: T};
type ImportStar<T> = T extends {__esModule: true} ? T : "__esModule" extends keyof T ? T | ImportNamespace<T> : ImportNamespace<T>;
type ImportDefault<T> = T extends {__esModule: true} ? T : "__esModule" extends keyof T ? T | {default: T} : {default: T};

interface AssignFunction {
  <T extends object>(target: T): T;
  <T extends object, U>(target: T, source: U): T & U;
  <T extends object, U, V>(target: T, source1: U, source2: V): T & U & V;
  <T extends object, U, V, W>(target: T, source1: U, source2: V, source3: W): T & U & V & W;
  (target: object, ...sources: unknown[]): object;
}
function isAssignFunction(value: unknown): value is AssignFunction { return typeof value === "function"; }
function assignValue(value: unknown): AssignFunction {
  if (!isAssignFunction(value)) throw new TypeError("Expected the original assignment helper");
  return value;
}
function forInObject(value: unknown): RuntimeRecord | null | undefined {
  if (value === null || value === undefined) return value;
  return boxedRecord(value);
}

interface MutableConstructor { prototype: object; [key: string]: unknown; }
interface RuntimeDescriptor { configurable?: boolean; enumerable?: boolean; writable?: boolean; value?: unknown; get?: RuntimeCallable; set?: RuntimeCallable; }
interface DecoratorContext { kind: string; name: PropertyKey; static?: boolean; access: Record<string, unknown>; [key: string]: unknown; }
interface DecoratorContextCopy { access?: Record<string, unknown>; addInitializer?: (f: unknown) => void; [key: string]: unknown; }
type GeneratorOperation = [number, unknown?];
type GeneratorTry = [number, number, number, number];
interface GeneratorFrame { label: number; sent(): unknown; trys: GeneratorTry[]; ops: GeneratorOperation[]; }
type IteratorKey = "next" | "throw" | "return";
interface Disposal { value?: unknown; dispose?: RuntimeCallable; async: boolean; }
interface DisposalEnvironment { stack: Disposal[]; error?: unknown; hasError?: boolean; }
declare const AsyncIterator: {prototype: object} | undefined;
function numberValue(value: unknown): number { if (typeof value !== "number") throw new TypeError("Expected a number"); return value; }
function stringValue(value: unknown): string { if (typeof value !== "string") throw new TypeError("Expected a string"); return value; }
function writeProperty(object: object, key: PropertyKey, value: unknown): void { runtimeRecord(object)[key] = value; }
function boxedRecord(value: unknown): RuntimeRecord { const boxed: unknown = Object(value); return runtimeRecord(boxed); }
function frame(value: GeneratorFrame | 0): GeneratorFrame { if (value === 0) throw new TypeError("Generator has completed"); return value; }

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for tslib/tslib.es6.mjs");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return hasEsModuleFlag(value) && exportsReady(value, exportNames);
}
const exportNames: readonly ("__addDisposableResource" | "__assign" | "__asyncDelegator" | "__asyncGenerator" | "__asyncValues" | "__await" | "__awaiter" | "__classPrivateFieldGet" | "__classPrivateFieldIn" | "__classPrivateFieldSet" | "__createBinding" | "__decorate" | "__disposeResources" | "__esDecorate" | "__exportStar" | "__extends" | "__generator" | "__importDefault" | "__importStar" | "__makeTemplateObject" | "__metadata" | "__param" | "__propKey" | "__read" | "__rest" | "__rewriteRelativeImportExtension" | "__runInitializers" | "__setFunctionName" | "__spread" | "__spreadArray" | "__spreadArrays" | "__values" | "default")[] = ["__addDisposableResource", "__assign", "__asyncDelegator", "__asyncGenerator", "__asyncValues", "__await", "__awaiter", "__classPrivateFieldGet", "__classPrivateFieldIn", "__classPrivateFieldSet", "__createBinding", "__decorate", "__disposeResources", "__esDecorate", "__exportStar", "__extends", "__generator", "__importDefault", "__importStar", "__makeTemplateObject", "__metadata", "__param", "__propKey", "__read", "__rest", "__rewriteRelativeImportExtension", "__runInitializers", "__setFunctionName", "__spread", "__spreadArray", "__spreadArrays", "__values", "default"];
function initialize() {
const exports: { __esModule?: true; "__addDisposableResource"?: typeof __addDisposableResource; "__assign"?: AssignFunction; "__asyncDelegator"?: typeof __asyncDelegator; "__asyncGenerator"?: typeof __asyncGenerator; "__asyncValues"?: typeof __asyncValues; "__await"?: typeof __await; "__awaiter"?: typeof __awaiter; "__classPrivateFieldGet"?: typeof __classPrivateFieldGet; "__classPrivateFieldIn"?: typeof __classPrivateFieldIn; "__classPrivateFieldSet"?: typeof __classPrivateFieldSet; "__createBinding"?: typeof __createBinding; "__decorate"?: typeof __decorate; "__disposeResources"?: typeof __disposeResources; "__esDecorate"?: typeof __esDecorate; "__exportStar"?: typeof __exportStar; "__extends"?: typeof __extends; "__generator"?: typeof __generator; "__importDefault"?: typeof __importDefault; "__importStar"?: typeof __importStar; "__makeTemplateObject"?: typeof __makeTemplateObject; "__metadata"?: typeof __metadata; "__param"?: typeof __param; "__propKey"?: typeof __propKey; "__read"?: typeof __read; "__rest"?: typeof __rest; "__rewriteRelativeImportExtension"?: typeof __rewriteRelativeImportExtension; "__runInitializers"?: typeof __runInitializers; "__setFunctionName"?: typeof __setFunctionName; "__spread"?: typeof __spread; "__spreadArray"?: typeof __spreadArray; "__spreadArrays"?: typeof __spreadArrays; "__values"?: typeof __values; "default"?: typeof __WEBPACK_DEFAULT_EXPORT__; } = {};
let module = {exports};
const __webpack_exports__ = exports;
cache = module;


"use strict";
webpack.r(__webpack_exports__);
/* harmony export */ webpack.d(__webpack_exports__, {
/* harmony export */   __addDisposableResource: () => (/* binding */ __addDisposableResource),
/* harmony export */   __assign: () => (/* binding */ assignValue(__assign)),
/* harmony export */   __asyncDelegator: () => (/* binding */ __asyncDelegator),
/* harmony export */   __asyncGenerator: () => (/* binding */ __asyncGenerator),
/* harmony export */   __asyncValues: () => (/* binding */ __asyncValues),
/* harmony export */   __await: () => (/* binding */ __await),
/* harmony export */   __awaiter: () => (/* binding */ __awaiter),
/* harmony export */   __classPrivateFieldGet: () => (/* binding */ __classPrivateFieldGet),
/* harmony export */   __classPrivateFieldIn: () => (/* binding */ __classPrivateFieldIn),
/* harmony export */   __classPrivateFieldSet: () => (/* binding */ __classPrivateFieldSet),
/* harmony export */   __createBinding: () => (/* binding */ __createBinding),
/* harmony export */   __decorate: () => (/* binding */ __decorate),
/* harmony export */   __disposeResources: () => (/* binding */ __disposeResources),
/* harmony export */   __esDecorate: () => (/* binding */ __esDecorate),
/* harmony export */   __exportStar: () => (/* binding */ __exportStar),
/* harmony export */   __extends: () => (/* binding */ __extends),
/* harmony export */   __generator: () => (/* binding */ __generator),
/* harmony export */   __importDefault: () => (/* binding */ __importDefault),
/* harmony export */   __importStar: () => (/* binding */ __importStar),
/* harmony export */   __makeTemplateObject: () => (/* binding */ __makeTemplateObject),
/* harmony export */   __metadata: () => (/* binding */ __metadata),
/* harmony export */   __param: () => (/* binding */ __param),
/* harmony export */   __propKey: () => (/* binding */ __propKey),
/* harmony export */   __read: () => (/* binding */ __read),
/* harmony export */   __rest: () => (/* binding */ __rest),
/* harmony export */   __rewriteRelativeImportExtension: () => (/* binding */ __rewriteRelativeImportExtension),
/* harmony export */   __runInitializers: () => (/* binding */ __runInitializers),
/* harmony export */   __setFunctionName: () => (/* binding */ __setFunctionName),
/* harmony export */   __spread: () => (/* binding */ __spread),
/* harmony export */   __spreadArray: () => (/* binding */ __spreadArray),
/* harmony export */   __spreadArrays: () => (/* binding */ __spreadArrays),
/* harmony export */   __values: () => (/* binding */ __values),
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */

var extendStatics: (d: object, b: object | null) => void = function(d, b) {
  extendStatics = Object.setPrototypeOf ||
      ({ __proto__: [] } instanceof Array && function (d: object, b: object | null) { runtimeRecord(d).__proto__ = b; }) ||
      function (d: object, b: object | null) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) runtimeRecord(d)[p] = runtimeProperty(b, p); };
  return extendStatics(d, b);
};

function __extends(d: MutableConstructor, b: object|null) {
  if (typeof b !== "function" && b !== null)
      throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
  extendStatics(d, b);
  const constructorProperty = "constructor";
  class __ {
    declare [constructorProperty]: object;
    [key: string]: unknown;
    constructor() {
      const prototype = runtimeProperty(b, "prototype");
      const instance = runtimeRecord(Object.create(isRecord(prototype) ? prototype : Object.prototype));
      writeProperty(instance, "constructor", d);
      return instance;
    }
  }
  d.prototype = b === null ? Object.create(b) : new __();
}

var __assign: RuntimeCallable = function(this: unknown): unknown {
  __assign = runtimeCallable(Object.assign || function __assign(t: object) {
      for (var s: unknown, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in forInObject(s)) if (Object.prototype.hasOwnProperty.call(s, p)) runtimeRecord(t)[p] = runtimeProperty(s, p);
      }
      return t;
  });
  return runtimeCall(__assign, this, arguments);
};

function __rest(s: unknown, e: readonly PropertyKey[]) {
  var t: Record<PropertyKey, unknown> = {};
  for (var p in forInObject(s)) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
      t[p] = runtimeProperty(s, p);
  if (s != null && typeof Object.getOwnPropertySymbols === "function")
      for (var i = 0, symbols = Object.getOwnPropertySymbols(s); i < symbols.length; i++) {
          if (e.indexOf(symbols[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, symbols[i]))
              t[symbols[i]] = runtimeProperty(s, symbols[i]);
      }
  return t;
}

function __decorate(decorators: RuntimeCallable[], target: object, key?: PropertyKey, desc?: RuntimeDescriptor|null) {
  var c = arguments.length, r: unknown = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key!) : desc, d: RuntimeCallable | undefined;
  if (typeof Reflect === "object" && typeof runtimeProperty(Reflect, "decorate") === "function") r = runtimeMethod(Reflect, "decorate", [decorators, target, key, desc]);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key!, runtimeRecord(r)), r;
}

function __param(paramIndex: number, decorator: RuntimeCallable) {
  return function (target: object, key?: PropertyKey) { decorator(target, key, paramIndex); }
}

function __esDecorate(ctor: {prototype: object} | null | undefined, descriptorIn: RuntimeDescriptor | undefined, decorators: RuntimeCallable[], contextIn: DecoratorContext, initializers: RuntimeCallable[], extraInitializers: RuntimeCallable[]) {
  function accept(f: unknown) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f === undefined ? f : runtimeCallable(f); }
  var kind = contextIn.kind, key: "get" | "set" | "value" = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
  var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
  var descriptor: RuntimeDescriptor | undefined = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
  var _: RuntimeCallable | undefined, done = false;
  for (var i = decorators.length - 1; i >= 0; i--) {
      var context: DecoratorContextCopy = {};
      for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
      for (var p in contextIn.access) context.access![p] = contextIn.access[p];
      context.addInitializer = function (f: unknown) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)!); };
      var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor!.get, set: descriptor!.set } : descriptor![key], context);
      if (kind === "accessor") {
          if (result === void 0) continue;
          if (result === null || typeof result !== "object") throw new TypeError("Object expected");
          if (_ = accept(runtimeProperty(result, "get"))) descriptor!.get = _;
          if (_ = accept(runtimeProperty(result, "set"))) descriptor!.set = _;
          if (_ = accept(runtimeProperty(result, "init"))) initializers.unshift(_);
      }
      else if (_ = accept(result)) {
          if (kind === "field") initializers.unshift(_);
          else descriptor![key] = _;
      }
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor!);
  done = true;
};

function __runInitializers(thisArg: unknown, initializers: RuntimeCallable[], value?: unknown) {
  var useValue = arguments.length > 2;
  for (var i = 0; i < initializers.length; i++) {
      value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
  }
  return useValue ? value : void 0;
};

function __propKey(x: unknown) {
  return typeof x === "symbol" ? x : stringValue(runtimeMethod("", "concat", [x]));
};

function __setFunctionName(f: object, name: unknown, prefix?: string) {
  if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
  return Object.defineProperty(f, "name", { configurable: true, value: prefix ? runtimeMethod("", "concat", [prefix, " ", name]) : name });
};

function __metadata(metadataKey: unknown, metadataValue: unknown) {
  if (typeof Reflect === "object" && typeof runtimeProperty(Reflect, "metadata") === "function") return runtimeMethod(Reflect, "metadata", [metadataKey, metadataValue]);
}

function __awaiter(thisArg: unknown, _arguments: ArrayLike<unknown> | undefined, P: PromiseConstructor | undefined, generator: unknown) {
  function adopt(value: unknown): Promise<unknown> { return value instanceof P! ? value : new P!(function (resolve) { resolve(value); }); }
  return new (P || (P = Promise))(function (resolve, reject: (arg0: unknown) => void) {
      function fulfilled(value: unknown) { try { step(runtimeCallable(runtimeProperty(generator, "next")).call(generator, value)); } catch (e) { reject(e); } }
      function rejected(value: unknown) { try { step(runtimeCallable(runtimeProperty(generator, "throw")).call(generator, value)); } catch (e) { reject(e); } }
      function step(result: unknown) { runtimeProperty(result, "done") ? resolve(runtimeProperty(result, "value")) : adopt(runtimeProperty(result, "value")).then(fulfilled, rejected); }
      step(runtimeCallable(runtimeProperty((generator = runtimeCall(generator, thisArg, _arguments || [])), "next")).call(generator));
  });
}

function __generator(thisArg: unknown, body: (this: unknown, state: GeneratorFrame) => GeneratorOperation): RuntimeRecord {
  var _: GeneratorFrame | 0 = { label: 0, sent: function() { if (numberValue(runtimeProperty(t, 0)) & 1) throw runtimeProperty(t, 1); return runtimeProperty(t, 1); }, trys: [], ops: [] }, f: number, y: unknown, t: unknown, g: RuntimeRecord | 0 = runtimeRecord(Object.create((typeof Iterator === "function" ? Iterator : Object).prototype));
  return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function(this: RuntimeRecord) { return this; }), g;
  function verb(n: number) { return function (v: unknown) { return step([n, v]); }; }
  function step(op: GeneratorOperation): unknown {
      if (f) throw new TypeError("Generator is already executing.");
      while (g && (g = 0, op[0] && (_ = 0)), _) try {
          if (f = 1, y && (t = op[0] & 2 ? runtimeProperty(y, "return") : op[0] ? runtimeProperty(y, "throw") || ((t = runtimeProperty(y, "return")) && runtimeCall(t, y, []), 0) : runtimeProperty(y, "next")) && !runtimeProperty(t = runtimeCall(t, y, [op[1]]), "done")) return t;
          if (y = 0, t) op = [op[0] & 2, runtimeProperty(t, "value")];
          switch (op[0]) {
              case 0: case 1: t = op; break;
              case 4: _.label++; return { value: op[1], done: false };
              case 5: _.label++; y = op[1]; op = [0]; continue;
              case 7: op = _.ops.pop()!; _.trys.pop(); continue;
              default:
                  if (!(t = _.trys, t = runtimeArrayLike(t).length > 0 && runtimeProperty(t, runtimeArrayLike(t).length - 1)) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                  if (op[0] === 3 && (!t || (numberValue(op[1]) > numberValue(runtimeProperty(t, 0)) && numberValue(op[1]) < numberValue(runtimeProperty(t, 3))))) { _.label = numberValue(op[1]); break; }
                  if (op[0] === 6 && _.label < numberValue(runtimeProperty(t, 1))) { _.label = numberValue(runtimeProperty(t, 1)); t = op; break; }
                  if (t && _.label < numberValue(runtimeProperty(t, 2))) { _.label = numberValue(runtimeProperty(t, 2)); _.ops.push(op); break; }
                  if (runtimeProperty(t, 2)) _.ops.pop();
                  _.trys.pop(); continue;
          }
          op = body.call(thisArg, _);
      } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
      if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
  }
}

var __createBinding = runtimeProperty(Object, "create") ? (function(o: object, m: unknown, k: PropertyKey, k2?: PropertyKey) {
  if (k2 === undefined) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !runtimeProperty(m, "__esModule") : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return runtimeProperty(m, k); } };
  }
  Object.defineProperty(o, k2, desc);
}) : (function(o: object, m: unknown, k: PropertyKey, k2?: PropertyKey) {
  if (k2 === undefined) k2 = k;
  runtimeRecord(o)[k2] = runtimeProperty(m, k);
});

function __exportStar(m: unknown, o: object) {
  for (var p in forInObject(m)) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);
}

function __values(o: unknown): unknown {
  var s = typeof Symbol === "function" && Symbol.iterator, m = s && runtimeProperty(o, s), i = 0;
  if (m) return runtimeCall(m, o, []);
  if (o && typeof runtimeProperty(o, "length") === "number") return {
      next: function () {
          if (o && i >= numberValue(runtimeProperty(o, "length"))) o = void 0;
          return { value: o && runtimeProperty(o, i++), done: !o };
      }
  };
  throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
}

function __read(o: unknown, n?: number) {
  var m = typeof Symbol === "function" && runtimeProperty(o, Symbol.iterator);
  if (!m) return o;
  var i = runtimeCall(m, o, []), r: unknown, ar: unknown[] = [], e: {error: unknown} | undefined;
  try {
      while ((n === void 0 || n-- > 0) && !runtimeProperty((r = runtimeCallable(runtimeProperty(i, "next")).call(i)), "done")) ar.push(runtimeProperty(r, "value"));
  }
  catch (error) { e = { error: error }; }
  finally {
      try {
          if (r && !runtimeProperty(r, "done") && (m = runtimeProperty(i, "return"))) runtimeCall(m, i, []);
      }
      finally { if (e) throw e.error; }
  }
  return ar;
}

/** @deprecated */
function __spread() {
  for (var ar: unknown[] = [], i = 0; i < arguments.length; i++)
      ar = ar.concat(__read(arguments[i]));
  return ar;
}

/** @deprecated */
function __spreadArrays() {
  for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += runtimeArrayLike(arguments[i]).length;
  for (var r: unknown[] = Array(s), k = 0, i = 0; i < il; i++)
      for (var a = runtimeArrayLike(arguments[i]), j = 0, jl = a.length; j < jl; j++, k++)
          r[k] = a[j];
  return r;
}

function __spreadArray<T, U>(to: T[], from: ArrayLike<U>, pack?: boolean): (T | U)[];
function __spreadArray(to: unknown[], from: ArrayLike<unknown>, pack?: boolean) {
  if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar: unknown[] | undefined; i < l; i++) {
      if (ar || !(i in from)) {
          if (!ar) ar = Array.prototype.slice.call(from, 0, i);
          ar[i] = from[i];
      }
  }
  return to.concat(ar || Array.prototype.slice.call(from));
}

class __await {
  declare v: unknown;
  constructor(v: unknown) {
    return this instanceof __await ? (this.v = v, this) : new __await(v);
  }
}

function __asyncGenerator(thisArg: unknown, _arguments: ArrayLike<unknown> | undefined, generator: RuntimeCallable) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var g = runtimeCall(generator, thisArg, _arguments || []), i: RuntimeRecord, q: [IteratorKey, unknown, (result: unknown) => void, (reason: unknown) => void][] = [];
  return i = runtimeRecord(Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype)), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function(this: RuntimeRecord) { return this; }, i;
  function awaitReturn(f: unknown) { return function (v: unknown) { return Promise.resolve(v).then(runtimeCallable(f), reject); }; }
  function verb(n: IteratorKey, f?: (method: unknown) => (value: unknown) => unknown) { if (runtimeProperty(g, n)) { i[n] = function (v: unknown) { return new Promise<unknown>(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
  function resume(n: IteratorKey, v: unknown) { try { step(runtimeCallable(runtimeProperty(g, n)).call(g, v)); } catch (e) { settle(q[0][3], e); } }
  function step(r: unknown) { runtimeProperty(r, "value") instanceof __await ? Promise.resolve(runtimeProperty(runtimeProperty(r, "value"), "v")).then(fulfill, reject) : settle(q[0][2], r); }
  function fulfill(value: unknown) { resume("next", value); }
  function reject(value: unknown) { resume("throw", value); }
  function settle<T>(f: (value: T) => void, v: T) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
}

function __asyncDelegator(o: RuntimeIterator) {
  var i: RuntimeRecord, p: boolean;
  return i = {}, verb("next"), verb("throw", function (e: unknown) { throw e; }), verb("return"), i[Symbol.iterator] = function(this: RuntimeRecord) { return this; }, i;
  function verb(n: IteratorKey, f?: (value: unknown) => unknown) { i[n] = o[n] ? function (v: unknown) { return (p = !p) ? { value: new __await(o[n]!(v)), done: false } : f ? f(v) : v; } : f; }
}

function __asyncValues(o: unknown) {
  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
  var m = runtimeProperty(o, Symbol.asyncIterator), i: RuntimeRecord;
  return m ? runtimeCall(m, o, []) : (o = typeof __values === "function" ? __values(o) : runtimeMethod(o, Symbol.iterator, []), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function(this: RuntimeRecord) { return this; }, i);
  function verb(n: IteratorKey) { i[n] = runtimeProperty(o, n) && function (v: unknown) { return new Promise<RawIteratorResult>(function (resolve, reject) { v = runtimeMethod(o, n, [v]), settle(resolve, reject, runtimeProperty(v, "done"), runtimeProperty(v, "value")); }); }; }
  function settle(resolve: (value: RawIteratorResult) => void, reject: (reason: unknown) => void, d: unknown, v: unknown) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
}

function __makeTemplateObject(cooked: unknown[] & {raw?: unknown}, raw: unknown) {
  if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
  return cooked;
};

var __setModuleDefault = runtimeProperty(Object, "create") ? (function(o: object, v: unknown) {
  Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o: object, v: unknown) {
  runtimeRecord(o)["default"] = v;
};

var ownKeys = function(o: unknown): string[] {
  ownKeys = Object.getOwnPropertyNames || function (o: unknown) {
    var ar: string[] = [];
    for (var k in forInObject(o)) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
    return ar;
  };
  return ownKeys(o);
};

function __importStar<T>(mod: T): ImportStar<T>;
function __importStar(mod: unknown): unknown {
  if (mod && runtimeProperty(mod, "__esModule")) return mod;
  var result: Record<PropertyKey, unknown> = {};
  if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
  __setModuleDefault(result, mod);
  return result;
}

function __importDefault<T>(mod: T): ImportDefault<T>;
function __importDefault(mod: unknown): unknown {
  return (mod && runtimeProperty(mod, "__esModule")) ? mod : { default: mod };
}

function __classPrivateFieldGet(receiver: unknown, state: RuntimeCallable | {has(value: unknown): boolean; get(value: unknown): unknown}, kind: string, f?: RuntimeCallable | {value: unknown}) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? runtimeCall(f, receiver, []) : f ? runtimeProperty(f, "value") : runtimeMethod(state, "get", [receiver]);
}

function __classPrivateFieldSet(receiver: unknown, state: RuntimeCallable | {has(value: unknown): boolean; set(key: unknown, value: unknown): unknown}, value: unknown, kind: string, f?: RuntimeCallable | {value: unknown}) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return (kind === "a" ? runtimeCall(f, receiver, [value]) : f ? runtimeRecord(f).value = value : runtimeMethod(state, "set", [receiver, value])), value;
}

function __classPrivateFieldIn(state: RuntimeCallable | {has(value: unknown): boolean}, receiver: unknown) {
  if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use 'in' operator on non-object");
  return typeof state === "function" ? receiver === state : state.has(receiver);
}

function __addDisposableResource(env: DisposalEnvironment, value: unknown, async: boolean) {
  if (value !== null && value !== void 0) {
    if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
    var dispose: unknown, inner: unknown;
    if (async) {
      if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
      dispose = runtimeProperty(value, Symbol.asyncDispose);
    }
    if (dispose === void 0) {
      if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
      dispose = runtimeProperty(value, Symbol.dispose);
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
    if (inner) dispose = function(this: unknown) { try { runtimeCall(inner, this, []); } catch (e) { return Promise.reject(e); } };
    env.stack.push({ value: value, dispose: runtimeCallable(dispose), async: async });
  }
  else if (async) {
    env.stack.push({ async: true });
  }
  return value;
}

var _SuppressedError = typeof SuppressedError === "function" ? SuppressedError : class {
  declare name: string; declare message: string; declare stack?: string; declare error?: unknown; declare suppressed?: unknown;
  constructor(error: unknown, suppressed: unknown, message?: string) {
    var e: Error & {error?: unknown; suppressed?: unknown} = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
  }
};

function __disposeResources(env: DisposalEnvironment) {
  function fail(e: unknown) {
    env.error = env.hasError ? new _SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
    env.hasError = true;
  }
  var r: Disposal | undefined, s = 0;
  function next(): void | Promise<void> {
    while (r = env.stack.pop()) {
      try {
        if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
        if (r.dispose) {
          var result = r.dispose.call(r.value);
          if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e: unknown) { fail(e); return next(); });
        }
        else s |= 1;
      }
      catch (e) {
        fail(e);
      }
    }
    if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
    if (env.hasError) throw env.error;
  }
  return next();
}

function __rewriteRelativeImportExtension(path: unknown, preserveJsx?: boolean) {
  if (typeof path === "string" && /^\.\.?\//.test(path)) {
      return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m: string, tsx: string | undefined, d: string | undefined, ext: string | undefined, cm: string | undefined) {
          return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d! + ext! + "." + cm!.toLowerCase() + "js");
      });
  }
  return path;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ({
  __extends,
  __assign: assignValue(__assign),
  __rest,
  __decorate,
  __param,
  __esDecorate,
  __runInitializers,
  __propKey,
  __setFunctionName,
  __metadata,
  __awaiter,
  __generator,
  __createBinding,
  __exportStar,
  __values,
  __read,
  __spread,
  __spreadArrays,
  __spreadArray,
  __await,
  __asyncGenerator,
  __asyncDelegator,
  __asyncValues,
  __makeTemplateObject,
  __importStar,
  __importDefault,
  __classPrivateFieldGet,
  __classPrivateFieldSet,
  __classPrivateFieldIn,
  __addDisposableResource,
  __disposeResources,
  __rewriteRelativeImportExtension,
});


/***/ 
if (!hasEsModuleFlag(exports) || !exportsReady(exports, exportNames)) throw new TypeError("Incomplete tslib exports");
return exports;
}
