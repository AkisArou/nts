import type {RuntimeNamedTypes} from "../../../types/ast-types/runtime-named-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/types.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, hasEsModuleFlag, webpack, isRecord, record, readProperty, runtimeCallable} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "./shared.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): Partial<ReturnType<typeof initialize>> & {__esModule: true} {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!hasEsModuleFlag(value)) throw new TypeError("Expected original ES module marker");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","Def","default"]);
}
function initialize() {
const exports: { __esModule?: true; "Def"?: typeof Def; "default"?: typeof typesPlugin; } = {};
let module = {exports};
cache = module;


"use strict";
/* module decorator */ module = webpack.nmd(module);

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Def = void 0;
var tslib_1 = load0();
var shared_1 = load1();
type Fork = {
  use<T>(plugin: Plugin<T>): T;
};
type Plugin<T> = (fork: Fork) => T;
type Omit<T, K> = Pick<T, Exclude<keyof T, K>>;
type Deep = boolean | ((type: Type<unknown>, value: unknown) => void);
type Type<T> =
  | ArrayType<T>
  | IdentityType<T>
  | ObjectType<T>
  | OrType<T>
  | PredicateType<T>;
interface AnyType {
  toString(): string;
  check(value: unknown, deep?: Deep): boolean;
  assert(value: unknown, deep?: Deep): boolean;
  arrayOf(): AnyType;
}
type FieldType<T> = Field<T>;
interface ASTNode {
  type?: unknown;
  [key: string]: unknown;
}
interface Builder {
  (...args: unknown[]): ASTNode;
  from(obj: { [param: string]: unknown }): ASTNode;
}
type BuiltInTypes = {
    string: string;
    function: Function;
    array: unknown[];
    object: { [key: string]: unknown };
    RegExp: RegExp;
    Date: Date;
    number: number;
    boolean: boolean;
    null: null;
    undefined: undefined;
    BigInt: BigInt;
  };
var Op = Object.prototype;
var objToStr = Op.toString;
var hasOwn = Op.hasOwnProperty;
abstract class BaseType<T> {
abstract toString(): string;
abstract check(value: unknown, deep?: Deep): value is T;
constructor() {
    }
assert(value: unknown, deep?: Deep): value is T {
        if (!this.check(value, deep)) {
            var str = shallowStringify(value);
            throw new Error(str + " does not match type " + this);
        }
        return true;
    }
arrayOf(): Type<T[]> {
        var elemType = this;
        return new ArrayType(elemType);
    }
}
class ArrayType<T> extends BaseType<T> {
declare kind: "ArrayType";
declare elemType: BaseType<T extends (infer E)[] ? E : never>;
constructor(elemType: BaseType<T extends (infer E)[] ? E : never>) {
        super(); var _this = this;
        _this.elemType = elemType;
        _this.kind = "ArrayType";
        return _this;
    }
toString(): string {
        return "[" + this.elemType + "]";
    }
check(value: unknown, deep?: Deep): value is T {
        var _this = this;
        return Array.isArray(value) && value.every(function (elem: unknown) { return _this.elemType.check(elem, deep); });
    }
}
class IdentityType<T> extends BaseType<T> {
declare kind: "IdentityType";
declare value: T;
constructor(value: T) {
        super(); var _this = this;
        _this.value = value;
        _this.kind = "IdentityType";
        return _this;
    }
toString(): string {
        return String(this.value);
    }
check(value: unknown, deep?: Deep): value is T {
        var result = value === this.value;
        if (!result && typeof deep === "function") {
            deep(this, value);
        }
        return result;
    }
}
class ObjectType<T> extends BaseType<T> {
declare kind: "ObjectType";
declare fields: Field<unknown>[];
constructor(fields: Field<unknown>[]) {
        super(); var _this = this;
        _this.fields = fields;
        _this.kind = "ObjectType";
        return _this;
    }
toString() {
        return "{ " + this.fields.join(", ") + " }";
    }
check(value: unknown, deep?: Deep): value is T {
        return (objToStr.call(value) === objToStr.call({}) &&
            this.fields.every(function (field) {
                return field.type.check(readProperty(value, field.name), deep);
            }));
    }
}
class OrType<T> extends BaseType<T> {
declare kind: "OrType";
declare types: Type<unknown>[];
constructor(types: Type<unknown>[]) {
        super(); var _this = this;
        _this.types = types;
        _this.kind = "OrType";
        return _this;
    }
toString(): string {
        return this.types.join(" | ");
    }
check(value: unknown, deep?: Deep): value is T {
        if (this.types.some(function (type) { return type.check(value, !!deep); })) {
            return true;
        }
        if (typeof deep === "function") {
            deep(this, value);
        }
        return false;
    }
}
class PredicateType<T> extends BaseType<T> {
declare kind: "PredicateType";
declare name: string;
declare predicate: (value: unknown, deep?: Deep) => unknown;
constructor(name: string, predicate: (value: unknown, deep?: Deep) => unknown) {
        super(); var _this = this;
        _this.name = name;
        _this.predicate = predicate;
        _this.kind = "PredicateType";
        return _this;
    }
toString(): string {
        return this.name;
    }
check(value: unknown, deep?: Deep): value is T {
        var result = this.predicate(value, deep);
        if (typeof result !== "boolean") throw new TypeError("Expected the original type predicate to return a boolean");
        if (!result && typeof deep === "function") {
            deep(this, value);
        }
        return result;
    }
}
abstract class Def<T = unknown> {
declare baseNames: string[];
declare ownFields: { [name: string]: Field<unknown> };
declare allSupertypes: { [name: string]: Def<unknown> };
declare supertypeList: string[];
declare allFields: { [name: PropertyKey]: Field<unknown> };
declare fieldNames: string[];
declare finalized: boolean;
declare buildable: boolean;
declare buildParams: string[];
abstract check(value: unknown, deep?: Deep): boolean;
abstract build(...buildParams: string[]): this;
abstract field(
    name: string,
    type: unknown,
    defaultFn?: Function,
    hidden?: boolean,
  ): this;
abstract finalize(): void;
declare type: Type<T>;
declare typeName: string;
constructor(type: Type<T>, typeName: string) {
        this.type = type;
        this.typeName = typeName;
        this.baseNames = [];
        this.ownFields = Object.create(null);
        // Includes own typeName. Populated during finalization.
        this.allSupertypes = Object.create(null);
        // Linear inheritance hierarchy. Populated during finalization.
        this.supertypeList = [];
        // Includes inherited fields.
        this.allFields = Object.create(null);
        // Non-hidden keys of allFields.
        this.fieldNames = [];
        // This property will be overridden as true by individual Def instances
        // when they are finalized.
        this.finalized = false;
        // False by default until .build(...) is called on an instance.
        this.buildable = false;
        this.buildParams = [];
    }
isSupertypeOf(that: Def<unknown>): boolean {
        if (that instanceof Def) {
            if (this.finalized !== true ||
                that.finalized !== true) {
                throw new Error("");
            }
            return hasOwn.call(that.allSupertypes, this.typeName);
        }
        else {
            throw new Error(that + " is not a Def");
        }
    }
checkAllFields(value: unknown, deep?: Deep): boolean {
        var allFields = this.allFields;
        if (this.finalized !== true) {
            throw new Error("" + this.typeName);
        }
        function checkFieldByName(name: string | number) {
            var field = allFields[name];
            var type = field.type;
            var child = field.getValue(value);
            return type.check(child, deep);
        }
        return value !== null &&
            typeof value === "object" &&
            Object.keys(allFields).every(checkFieldByName);
    }
bases(...supertypeNames: string[]): this;
bases(): this {
        var supertypeNames: string[] = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            supertypeNames[_i] = arguments[_i];
        }
        var bases = this.baseNames;
        if (this.finalized) {
            if (supertypeNames.length !== bases.length) {
                throw new Error("");
            }
            for (var i = 0; i < supertypeNames.length; i++) {
                if (supertypeNames[i] !== bases[i]) {
                    throw new Error("");
                }
            }
            return this;
        }
        supertypeNames.forEach(function (baseName) {
            // This indexOf lookup may be O(n), but the typical number of base
            // names is very small, and indexOf is a native Array method.
            if (bases.indexOf(baseName) < 0) {
                bases.push(baseName);
            }
        });
        return this; // For chaining.
    }
}
exports.Def = Def;
class Field<T> {
declare hidden: boolean;
declare name: string;
declare type: Type<T>;
declare defaultFn?: Function;
constructor(name: string, type: Type<T>, defaultFn?: Function, hidden?: boolean) {
        this.name = name;
        this.type = type;
        this.defaultFn = defaultFn;
        this.hidden = !!hidden;
    }
toString(): string {
        return JSON.stringify(this.name) + ": " + this.type;
    }
getValue(obj: unknown): unknown {
        var value = readProperty(obj, this.name);
        if (typeof value !== "undefined") {
            return value;
        }
        if (typeof this.defaultFn === "function") {
            value = this.defaultFn.call(obj);
        }
        return value;
    }
}
function shallowStringify(value: unknown): string | undefined {
    if (Array.isArray(value)) {
        return "[" + value.map(shallowStringify).join(", ") + "]";
    }
    if (value && typeof value === "object") {
        return "{ " + Object.keys(value).map(function (key) {
            return key + ": " + readProperty(value, key);
        }).join(", ") + " }";
    }
    return JSON.stringify(value);
}
function typesPlugin(_fork: Fork) {
    var Type: {
        or(...types: unknown[]): Type<unknown>;
        from(value: unknown, name?: string): Type<unknown>;
        def(typeName: string): Def;
        hasDef(typeName: string): boolean;
    } = {
        or: function (): Type<unknown> {
            var types: unknown[] = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                types[_i] = arguments[_i];
            }
            return new OrType(types.map(function (type) { return Type.from(type); }));
        },
        from: function (value: unknown, name?: string): Type<unknown> {
            if (value instanceof ArrayType ||
                value instanceof IdentityType ||
                value instanceof ObjectType ||
                value instanceof OrType ||
                value instanceof PredicateType) {
                return value;
            }
            // The Def type is used as a helper for constructing compound
            // interface types for AST nodes.
            if (value instanceof Def) {
                return value.type;
            }
            // Support [ElemType] syntax.
            if (isArray.check(value)) {
                if (value.length !== 1) {
                    throw new Error("only one element type is permitted for typed arrays");
                }
                return new ArrayType<unknown[]>(Type.from(value[0]));
            }
            // Support { someField: FieldType, ... } syntax.
            if (isObject.check(value)) {
                return new ObjectType(Object.keys(value).map(function (name) {
                    return new Field(name, Type.from(value[name], name));
                }));
            }
            if (typeof value === "function") {
                var bicfIndex = builtInCtorFns.indexOf(value);
                if (bicfIndex >= 0) {
                    return builtInCtorTypes[bicfIndex];
                }
                if (typeof name !== "string") {
                    throw new Error("missing name");
                }
                return new PredicateType(name, runtimeCallable(value));
            }
            // As a last resort, toType returns a type that matches any value that
            // is === from. This is primarily useful for literal values like
            // toType(null), but it has the additional advantage of allowing
            // toType to be a total function.
            return new IdentityType(value);
        },
        // Define a type whose name is registered in a namespace (the defCache) so
        // that future definitions will return the same type given the same name.
        // In particular, this system allows for circular and forward definitions.
        // The Def object d returned from Type.def may be used to configure the
        // type d.type by calling methods such as d.bases, d.build, and d.field.
        def: function (typeName: string): Def {
            return hasOwn.call(defCache, typeName)
                ? defCache[typeName]
                : defCache[typeName] = new DefImpl(typeName);
        },
        hasDef: function (typeName: string) {
            return hasOwn.call(defCache, typeName);
        }
    };
    var builtInCtorFns: Function[] = [];
    var builtInCtorTypes: Type<unknown>[] = [];
    function defBuiltInType<K extends keyof BuiltInTypes>(name: K, example: BuiltInTypes[K]): Type<BuiltInTypes[K]> {
        var objStr: string = objToStr.call(example);
        var type = new PredicateType<BuiltInTypes[K]>(name, function (value) { return objToStr.call(value) === objStr; });
        if (example && typeof example.constructor === "function") {
            builtInCtorFns.push(example.constructor);
            builtInCtorTypes.push(type);
        }
        return type;
    }
    // These types check the underlying [[Class]] attribute of the given
    // value, rather than using the problematic typeof operator. Note however
    // that no subtyping is considered; so, for instance, isObject.check
    // returns false for [], /./, new Date, and null.
    var isString = defBuiltInType("string", "truthy");
    var isFunction = defBuiltInType("function", function () { });
    var isArray = defBuiltInType("array", []);
    var isObject = defBuiltInType("object", {});
    var isRegExp = defBuiltInType("RegExp", /./);
    var isDate = defBuiltInType("Date", new Date());
    var isNumber = defBuiltInType("number", 3);
    var isBoolean = defBuiltInType("boolean", true);
    var isNull = defBuiltInType("null", null);
    var isUndefined = defBuiltInType("undefined", undefined);
    var isBigInt = typeof BigInt === "function"
        ? defBuiltInType("BigInt", BigInt(1234))
        : new PredicateType<BigInt>("BigInt", function () { return false; });
    var builtInTypes = {
        string: isString,
        function: isFunction,
        array: isArray,
        object: isObject,
        RegExp: isRegExp,
        Date: isDate,
        number: isNumber,
        boolean: isBoolean,
        null: isNull,
        undefined: isUndefined,
        BigInt: isBigInt,
    };
    // In order to return the same Def instance every time Type.def is called
    // with a particular name, those instances need to be stored in a cache.
    var defCache: { [typeName: string]: Def<unknown> } = Object.create(null);
    function defFromValue(value: unknown): Def<unknown> | null {
        if (value && typeof value === "object") {
            var type = readProperty(value, "type");
            if (typeof type === "string" &&
                hasOwn.call(defCache, type)) {
                var d = defCache[type];
                if (d.finalized) {
                    return d;
                }
            }
        }
        return null;
    }
    class DefImpl<T = unknown> extends Def<T> {
constructor(typeName: string) {
            super(new PredicateType<T>(typeName, function (value, deep) { return _this.check(value, deep); }), typeName); var _this = this;
            return _this;
        }
check(value: unknown, deep?: Deep): boolean {
            if (this.finalized !== true) {
                throw new Error("prematurely checking unfinalized type " + this.typeName);
            }
            // A Def type can only match an object value.
            if (value === null || typeof value !== "object") {
                return false;
            }
            var vDef = defFromValue(value);
            if (!vDef) {
                // If we couldn't infer the Def associated with the given value,
                // and we expected it to be a SourceLocation or a Position, it was
                // probably just missing a "type" field (because Esprima does not
                // assign a type property to such nodes). Be optimistic and let
                // this.checkAllFields make the final decision.
                if (this.typeName === "SourceLocation" ||
                    this.typeName === "Position") {
                    return this.checkAllFields(value, deep);
                }
                // Calling this.checkAllFields for any other type of node is both
                // bad for performance and way too forgiving.
                return false;
            }
            // If checking deeply and vDef === this, then we only need to call
            // checkAllFields once. Calling checkAllFields is too strict when deep
            // is false, because then we only care about this.isSupertypeOf(vDef).
            if (deep && vDef === this) {
                return this.checkAllFields(value, deep);
            }
            // In most cases we rely exclusively on isSupertypeOf to make O(1)
            // subtyping determinations. This suffices in most situations outside
            // of unit tests, since interface conformance is checked whenever new
            // instances are created using builder functions.
            if (!this.isSupertypeOf(vDef)) {
                return false;
            }
            // The exception is when deep is true; then, we recursively check all
            // fields.
            if (!deep) {
                return true;
            }
            // Use the more specific Def (vDef) to perform the deep check, but
            // shallow-check fields defined by the less specific Def (this).
            return vDef.checkAllFields(value, deep)
                && this.checkAllFields(value, false);
        }
build(...buildParams: string[]): this;
build(): this {
            var _this = this;
            var buildParams: string[] = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                buildParams[_i] = arguments[_i];
            }
            // Calling Def.prototype.build multiple times has the effect of merely
            // redefining this property.
            this.buildParams = buildParams;
            if (this.buildable) {
                // If this Def is already buildable, update self.buildParams and
                // continue using the old builder function.
                return this;
            }
            // Every buildable type will have its "type" field filled in
            // automatically. This includes types that are not subtypes of Node,
            // like SourceLocation, but that seems harmless (TODO?).
            this.field("type", String, function () { return _this.typeName; });
            // Override Dp.buildable for this Def instance.
            this.buildable = true;
            var addParam = function (built: Record<string, unknown>, param: string, arg: unknown, isArgAvailable: boolean) {
                if (hasOwn.call(built, param))
                    return;
                var all = _this.allFields;
                if (!hasOwn.call(all, param)) {
                    throw new Error("" + param);
                }
                var field = all[param];
                var type = field.type;
                var value: unknown;
                if (isArgAvailable) {
                    value = arg;
                }
                else if (field.defaultFn) {
                    // Expose the partially-built object to the default
                    // function as its `this` object.
                    value = field.defaultFn.call(built);
                }
                else {
                    var message = "no value or default function given for field " +
                        JSON.stringify(param) + " of " + _this.typeName + "(" +
                        _this.buildParams.map(function (name) {
                            return all[name];
                        }).join(", ") + ")";
                    throw new Error(message);
                }
                if (!type.check(value)) {
                    throw new Error(shallowStringify(value) +
                        " does not match field " + field +
                        " of type " + _this.typeName);
                }
                built[param] = value;
            };
            // Calling the builder function will construct an instance of the Def,
            // with positional arguments mapped to the fields original passed to .build.
            // If not enough arguments are provided, the default value for the remaining fields
            // will be used.
            var builder: {(...args: unknown[]): ASTNode; from?: (obj: Record<string, unknown>) => ASTNode} = function () {
                var args: unknown[] = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    args[_i] = arguments[_i];
                }
                var argc = args.length;
                if (!_this.finalized) {
                    throw new Error("attempting to instantiate unfinalized type " +
                        _this.typeName);
                }
                var built: Record<string, unknown> = Object.create(nodePrototype);
                _this.buildParams.forEach(function (param, i) {
                    if (i < argc) {
                        addParam(built, param, args[i], true);
                    }
                    else {
                        addParam(built, param, null, false);
                    }
                });
                Object.keys(_this.allFields).forEach(function (param) {
                    // Use the default value.
                    addParam(built, param, null, false);
                });
                // Make sure that the "type" field was filled automatically.
                if (built.type !== _this.typeName) {
                    throw new Error("");
                }
                return built;
            };
            // Calling .from on the builder function will construct an instance of the Def,
            // using field values from the passed object. For fields missing from the passed object,
            // their default value will be used.
            builder.from = function (obj: Record<string, unknown>) {
                if (!_this.finalized) {
                    throw new Error("attempting to instantiate unfinalized type " +
                        _this.typeName);
                }
                var built: Record<string, unknown> = Object.create(nodePrototype);
                Object.keys(_this.allFields).forEach(function (param) {
                    if (hasOwn.call(obj, param)) {
                        addParam(built, param, obj[param], true);
                    }
                    else {
                        addParam(built, param, null, false);
                    }
                });
                // Make sure that the "type" field was filled automatically.
                if (built.type !== _this.typeName) {
                    throw new Error("");
                }
                return built;
            };
            Object.defineProperty(builders, getBuilderName(this.typeName), {
                enumerable: true,
                value: builder
            });
            return this;
        }
field(name: string, type: unknown, defaultFn?: Function, hidden?: boolean): this {
            if (this.finalized) {
                console.error("Ignoring attempt to redefine field " +
                    JSON.stringify(name) + " of finalized type " +
                    JSON.stringify(this.typeName));
                return this;
            }
            this.ownFields[name] = new Field(name, Type.from(type), defaultFn, hidden);
            return this; // For chaining.
        }
finalize() {
            var _this = this;
            // It's not an error to finalize a type more than once, but only the
            // first call to .finalize does anything.
            if (!this.finalized) {
                var allFields = this.allFields;
                var allSupertypes = this.allSupertypes;
                this.baseNames.forEach(function (name) {
                    var def = defCache[name];
                    if (def instanceof Def) {
                        def.finalize();
                        extend(allFields, def.allFields);
                        extend(allSupertypes, def.allSupertypes);
                    }
                    else {
                        var message = "unknown supertype name " +
                            JSON.stringify(name) +
                            " for subtype " +
                            JSON.stringify(_this.typeName);
                        throw new Error(message);
                    }
                });
                // TODO Warn if fields are overridden with incompatible types.
                extend(allFields, this.ownFields);
                allSupertypes[this.typeName] = this;
                this.fieldNames.length = 0;
                for (var fieldName in allFields) {
                    if (hasOwn.call(allFields, fieldName) &&
                        !allFields[fieldName].hidden) {
                        this.fieldNames.push(fieldName);
                    }
                }
                // Types are exported only once they have been finalized.
                Object.defineProperty(namedTypes, this.typeName, {
                    enumerable: true,
                    value: this.type
                });
                this.finalized = true;
                // A linearization of the inheritance hierarchy.
                populateSupertypeList(this.typeName, this.supertypeList);
                if (this.buildable &&
                    this.supertypeList.lastIndexOf("Expression") >= 0) {
                    wrapExpressionBuilderWithStatement(this.typeName);
                }
            }
        }
}
    // Note that the list returned by this function is a copy of the internal
    // supertypeList, *without* the typeName itself as the first element.
    function getSupertypeNames(typeName: string): string[] {
        if (!hasOwn.call(defCache, typeName)) {
            throw new Error("");
        }
        var d = defCache[typeName];
        if (d.finalized !== true) {
            throw new Error("");
        }
        return d.supertypeList.slice(1);
    }
    // Returns an object mapping from every known type in the defCache to the
    // most specific supertype whose name is an own property of the candidates
    // object.
    function computeSupertypeLookupTable(candidates: unknown) {
        var table: { [typeName: string ]: unknown } = {};
        var typeNames = Object.keys(defCache);
        var typeNameCount = typeNames.length;
        for (var i = 0; i < typeNameCount; ++i) {
            var typeName = typeNames[i];
            var d = defCache[typeName];
            if (d.finalized !== true) {
                throw new Error("" + typeName);
            }
            for (var j = 0; j < d.supertypeList.length; ++j) {
                var superTypeName = d.supertypeList[j];
                if (hasOwn.call(candidates, superTypeName)) {
                    table[typeName] = superTypeName;
                    break;
                }
            }
        }
        return table;
    }
    var builders: Record<string, Builder> = Object.create(null);
    // This object is used as prototype for any node created by a builder.
    var nodePrototype: { [definedMethod: PropertyKey]: Function | undefined } = {};
    // Call this function to define a new method to be shared by all AST
    // nodes. The replaced method (if any) is returned for easy wrapping.
    function defineMethod(name: PropertyKey, func?: Function) {
        var old = nodePrototype[name];
        // Pass undefined as func to delete nodePrototype[name].
        if (isUndefined.check(func)) {
            delete nodePrototype[name];
        }
        else {
            isFunction.assert(func);
            Object.defineProperty(nodePrototype, name, {
                enumerable: true,
                configurable: true,
                value: func
            });
        }
        return old;
    }
    function getBuilderName(typeName: string) {
        return typeName.replace(/^[A-Z]+/, function (upperCasePrefix: string) {
            var len = upperCasePrefix.length;
            switch (len) {
                case 0: return "";
                // If there's only one initial capital letter, just lower-case it.
                case 1: return upperCasePrefix.toLowerCase();
                default:
                    // If there's more than one initial capital letter, lower-case
                    // all but the last one, so that XMLDefaultDeclaration (for
                    // example) becomes xmlDefaultDeclaration.
                    return upperCasePrefix.slice(0, len - 1).toLowerCase() +
                        upperCasePrefix.charAt(len - 1);
            }
        });
    }
    function getStatementBuilderName(typeName: string) {
        typeName = getBuilderName(typeName);
        return typeName.replace(/(Expression)?$/, "Statement");
    }
    var namedTypes: Partial<RuntimeNamedTypes> = {};
    // Like Object.keys, but aware of what fields each AST type should have.
    function getFieldNames(object: unknown) {
        var d = defFromValue(object);
        if (d) {
            return d.fieldNames.slice(0);
        }
        if ("type" in record(object)) {
            throw new Error("did not recognize object of type " +
                JSON.stringify(readProperty(object, "type")));
        }
        return Object.keys(record(object));
    }
    // Get the value of an object property, taking object.type and default
    // functions into account.
    function getFieldValue(object: unknown, fieldName: PropertyKey) {
        var d = defFromValue(object);
        if (d) {
            var field = d.allFields[fieldName];
            if (field) {
                return field.getValue(object);
            }
        }
        return object && readProperty(object, fieldName);
    }
    // Iterate over all defined fields of an object, including those missing
    // or undefined, passing each field name and effective value (as returned
    // by getFieldValue) to the callback. If the object has no corresponding
    // Def, the callback will never be called.
    function eachField(object: unknown, callback: (this: unknown, name: string, value: unknown) => unknown, context?: unknown) {
        getFieldNames(object).forEach(function (this: unknown, name) {
            callback.call(this, name, getFieldValue(object, name));
        }, context);
    }
    // Similar to eachField, except that iteration stops as soon as the
    // callback returns a truthy value. Like Array.prototype.some, the final
    // result is either true or false to indicates whether the callback
    // returned true for any element or not.
    function someField(object: unknown, callback: (this: unknown, name: string, value: unknown) => unknown, context?: unknown) {
        return getFieldNames(object).some(function (this: unknown, name) {
            return callback.call(this, name, getFieldValue(object, name));
        }, context);
    }
    // Adds an additional builder for Expression subtypes
    // that wraps the built Expression in an ExpressionStatements.
    function wrapExpressionBuilderWithStatement(typeName: string) {
        var wrapperName = getStatementBuilderName(typeName);
        // skip if the builder already exists
        if (builders[wrapperName])
            return;
        // the builder function to wrap with builders.ExpressionStatement
        var wrapped = builders[getBuilderName(typeName)];
        // skip if there is nothing to wrap
        if (!wrapped)
            return;
        var builder: {(...args: unknown[]): ASTNode; from?: (obj: Record<string, unknown>) => ASTNode} = function () {
            var args: unknown[] = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return builders.expressionStatement(wrapped.apply(builders, args));
        };
        builder.from = function () {
            var args: unknown[] = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            return builders.expressionStatement(runtimeCallable(wrapped.from).apply(builders, args));
        };
        if (!exportsReady(builder, ["from"])) throw new TypeError("Incomplete builder methods");
        builders[wrapperName] = builder;
    }
    function populateSupertypeList(typeName: string, list: string[]) {
        list.length = 0;
        list.push(typeName);
        var lastSeen: Record<string, number> = Object.create(null);
        for (var pos = 0; pos < list.length; ++pos) {
            typeName = list[pos];
            var d = defCache[typeName];
            if (d.finalized !== true) {
                throw new Error("");
            }
            // If we saw typeName earlier in the breadth-first traversal,
            // delete the last-seen occurrence.
            if (hasOwn.call(lastSeen, typeName)) {
                delete list[lastSeen[typeName]];
            }
            // Record the new index of the last-seen occurrence of typeName.
            lastSeen[typeName] = pos;
            // Enqueue the base names of this type.
            list.push.apply(list, d.baseNames);
        }
        // Compaction loop to remove array holes.
        for (var to = 0, from = to, len = list.length; from < len; ++from) {
            if (hasOwn.call(list, from)) {
                list[to++] = list[from];
            }
        }
        list.length = to;
    }
    function extend<T>(into: Record<string, T>, from: Record<string, T>) {
        Object.keys(from).forEach(function (name) {
            into[name] = from[name];
        });
        return into;
    }
    function finalize() {
        Object.keys(defCache).forEach(function (name) {
            defCache[name].finalize();
        });
    }
    return {
        Type: Type,
        builtInTypes: builtInTypes,
        getSupertypeNames: getSupertypeNames,
        computeSupertypeLookupTable: computeSupertypeLookupTable,
        builders: builders,
        defineMethod: defineMethod,
        getBuilderName: getBuilderName,
        getStatementBuilderName: getStatementBuilderName,
        namedTypes: namedTypes,
        getFieldNames: getFieldNames,
        getFieldValue: getFieldValue,
        eachField: eachField,
        someField: someField,
        finalize: finalize,
    };
}
exports["default"] = typesPlugin;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=types.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","Def","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
