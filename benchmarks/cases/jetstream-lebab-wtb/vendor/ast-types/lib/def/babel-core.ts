import type {Fork} from "../../../../types/ast-types/types.js";
import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
// Exact module body from JetStream 3.0 ./node_modules/ast-types/lib/def/babel-core.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, readProperty, runtimeMethod} from "../../../../webpack.ts";
import {load as load0} from "../../../tslib/tslib.es6.ts";
import {load as load1} from "./es-proposals.ts";
import {load as load2} from "../types.ts";
import {load as load3} from "../shared.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for ast-types/lib/def/babel-core.js");
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
var es_proposals_1 = tslib_1.__importDefault(load1());
var types_1 = tslib_1.__importDefault(load2());
var shared_1 = tslib_1.__importStar(load3());
function default_1(fork: Fork) {
    var _a: ReturnType<typeof def>, _b: ReturnType<typeof def>, _c: ReturnType<typeof def>, _d: ReturnType<typeof def>, _e: ReturnType<typeof def>;
    fork.use(es_proposals_1.default);
    var types = fork.use(types_1.default!);
    var defaults = fork.use(shared_1.default!).defaults;
    var def = types.Type.def;
    var or = types.Type.or;
    var isUndefined = types.builtInTypes.undefined;
    def("Noop")
        .bases("Statement")
        .build();
    def("DoExpression")
        .bases("Expression")
        .build("body")
        .field("body", [def("Statement")]);
    def("BindExpression")
        .bases("Expression")
        .build("object", "callee")
        .field("object", or(def("Expression"), null))
        .field("callee", def("Expression"));
    def("ParenthesizedExpression")
        .bases("Expression")
        .build("expression")
        .field("expression", def("Expression"));
    def("ExportNamespaceSpecifier")
        .bases("Specifier")
        .build("exported")
        .field("exported", def("Identifier"));
    def("ExportDefaultSpecifier")
        .bases("Specifier")
        .build("exported")
        .field("exported", def("Identifier"));
    def("CommentBlock")
        .bases("Comment")
        .build("value", /*optional:*/ "leading", "trailing");
    def("CommentLine")
        .bases("Comment")
        .build("value", /*optional:*/ "leading", "trailing");
    def("Directive")
        .bases("Node")
        .build("value")
        .field("value", def("DirectiveLiteral"));
    def("DirectiveLiteral")
        .bases("Node", "Expression")
        .build("value")
        .field("value", String, defaults["use strict"]);
    def("InterpreterDirective")
        .bases("Node")
        .build("value")
        .field("value", String);
    def("BlockStatement")
        .bases("Statement")
        .build("body")
        .field("body", [def("Statement")])
        .field("directives", [def("Directive")], defaults.emptyArray);
    def("Program")
        .bases("Node")
        .build("body")
        .field("body", [def("Statement")])
        .field("directives", [def("Directive")], defaults.emptyArray)
        .field("interpreter", or(def("InterpreterDirective"), null), defaults["null"]);
    function makeLiteralExtra<TNode extends Omit<N.Literal, "type"> | N.RegExpLiteral>(rawValueType?: unknown, toRaw?: (value: unknown) => string): Parameters<import("../../../../types/ast-types/types.js").Def["field"]> {
        if (rawValueType === void 0) { rawValueType = String; }
        return [
            "extra",
            {
                rawValue: rawValueType,
                raw: String,
            },
            function getDefault(this: TNode) {
                var value = types.getFieldValue(this, "value");
                return {
                    rawValue: value,
                    raw: toRaw ? toRaw(value) : String(value),
                };
            },
        ];
    }
    // Split Literal
    (_a = def("StringLiteral")
        .bases("Literal")
        .build("value")
        .field("value", String))
        .field.apply(_a, makeLiteralExtra(String, function (val) { return JSON.stringify(val); }));
    (_b = def("NumericLiteral")
        .bases("Literal")
        .build("value")
        .field("value", Number)
        .field("raw", or(String, null), defaults["null"]))
        .field.apply(_b, makeLiteralExtra(Number));
    (_c = def("BigIntLiteral")
        .bases("Literal")
        .build("value")
        // Only String really seems appropriate here, since BigInt values
        // often exceed the limits of JS numbers.
        .field("value", or(String, Number)))
        .field.apply(_c, makeLiteralExtra(String, function (val) { return val + "n"; }));
    // https://github.com/tc39/proposal-decimal
    // https://github.com/babel/babel/pull/11640
    (_d = def("DecimalLiteral")
        .bases("Literal")
        .build("value")
        .field("value", String))
        .field.apply(_d, makeLiteralExtra(String, function (val) { return val + "m"; }));
    def("NullLiteral")
        .bases("Literal")
        .build()
        .field("value", null, defaults["null"]);
    def("BooleanLiteral")
        .bases("Literal")
        .build("value")
        .field("value", Boolean);
    (_e = def("RegExpLiteral")
        .bases("Literal")
        .build("pattern", "flags")
        .field("pattern", String)
        .field("flags", String)
        .field("value", RegExp, function (this: N.RegExpLiteral) {
        return new RegExp(this.pattern, this.flags);
    }))
        .field.apply(_e, makeLiteralExtra(or(RegExp, isUndefined), function (exp) { const first = runtimeMethod("/", "concat", [readProperty(exp, "pattern"), "/"]); const result = runtimeMethod(first, "concat", [readProperty(exp, "flags") || ""]); if (typeof result !== "string") throw new TypeError("Expected original literal text"); return result; })).field("regex", {
        pattern: String,
        flags: String
    }, function (this: N.RegExpLiteral) {
        return {
            pattern: this.pattern,
            flags: this.flags,
        };
    });
    var ObjectExpressionProperty = or(def("Property"), def("ObjectMethod"), def("ObjectProperty"), def("SpreadProperty"), def("SpreadElement"));
    // Split Property -> ObjectProperty and ObjectMethod
    def("ObjectExpression")
        .bases("Expression")
        .build("properties")
        .field("properties", [ObjectExpressionProperty]);
    // ObjectMethod hoist .value properties to own properties
    def("ObjectMethod")
        .bases("Node", "Function")
        .build("kind", "key", "params", "body", "computed")
        .field("kind", or("method", "get", "set"))
        .field("key", or(def("Literal"), def("Identifier"), def("Expression")))
        .field("params", [def("Pattern")])
        .field("body", def("BlockStatement"))
        .field("computed", Boolean, defaults["false"])
        .field("generator", Boolean, defaults["false"])
        .field("async", Boolean, defaults["false"])
        .field("accessibility", // TypeScript
    or(def("Literal"), null), defaults["null"])
        .field("decorators", or([def("Decorator")], null), defaults["null"]);
    def("ObjectProperty")
        .bases("Node")
        .build("key", "value")
        .field("key", or(def("Literal"), def("Identifier"), def("Expression")))
        .field("value", or(def("Expression"), def("Pattern")))
        .field("accessibility", // TypeScript
    or(def("Literal"), null), defaults["null"])
        .field("computed", Boolean, defaults["false"]);
    var ClassBodyElement = or(def("MethodDefinition"), def("VariableDeclarator"), def("ClassPropertyDefinition"), def("ClassProperty"), def("ClassPrivateProperty"), def("ClassMethod"), def("ClassPrivateMethod"), def("ClassAccessorProperty"), def("StaticBlock"));
    // MethodDefinition -> ClassMethod
    def("ClassBody")
        .bases("Declaration")
        .build("body")
        .field("body", [ClassBodyElement]);
    def("ClassMethod")
        .bases("Declaration", "Function")
        .build("kind", "key", "params", "body", "computed", "static")
        .field("key", or(def("Literal"), def("Identifier"), def("Expression")));
    def("ClassPrivateMethod")
        .bases("Declaration", "Function")
        .build("key", "params", "body", "kind", "computed", "static")
        .field("key", def("PrivateName"));
    def("ClassAccessorProperty")
        .bases("Declaration")
        .build("key", "value", "decorators", "computed", "static")
        .field("key", or(def("Literal"), def("Identifier"), def("PrivateName"), 
    // Only when .computed is true (TODO enforce this)
    def("Expression")))
        .field("value", or(def("Expression"), null), defaults["null"]);
    ["ClassMethod",
        "ClassPrivateMethod",
    ].forEach(function (typeName) {
        def(typeName)
            .field("kind", or("get", "set", "method", "constructor"), function () { return "method"; })
            .field("body", def("BlockStatement"))
            // For backwards compatibility only. Expect accessibility instead (see below).
            .field("access", or("public", "private", "protected", null), defaults["null"]);
    });
    ["ClassMethod",
        "ClassPrivateMethod",
        "ClassAccessorProperty",
    ].forEach(function (typeName) {
        def(typeName)
            .field("computed", Boolean, defaults["false"])
            .field("static", Boolean, defaults["false"])
            .field("abstract", Boolean, defaults["false"])
            .field("accessibility", or("public", "private", "protected", null), defaults["null"])
            .field("decorators", or([def("Decorator")], null), defaults["null"])
            .field("definite", Boolean, defaults["false"])
            .field("optional", Boolean, defaults["false"])
            .field("override", Boolean, defaults["false"])
            .field("readonly", Boolean, defaults["false"]);
    });
    var ObjectPatternProperty = or(def("Property"), def("PropertyPattern"), def("SpreadPropertyPattern"), def("SpreadProperty"), // Used by Esprima
    def("ObjectProperty"), // Babel 6
    def("RestProperty"), // Babel 6
    def("RestElement"));
    // Split into RestProperty and SpreadProperty
    def("ObjectPattern")
        .bases("Pattern")
        .build("properties")
        .field("properties", [ObjectPatternProperty])
        .field("decorators", or([def("Decorator")], null), defaults["null"]);
    def("SpreadProperty")
        .bases("Node")
        .build("argument")
        .field("argument", def("Expression"));
    def("RestProperty")
        .bases("Node")
        .build("argument")
        .field("argument", def("Expression"));
    def("ForAwaitStatement")
        .bases("Statement")
        .build("left", "right", "body")
        .field("left", or(def("VariableDeclaration"), def("Expression")))
        .field("right", def("Expression"))
        .field("body", def("Statement"));
    // The callee node of a dynamic import(...) expression.
    def("Import")
        .bases("Expression")
        .build();
}
exports["default"] = default_1;
;
if (!exportsReady(shared_1, ["maybeSetModuleExports"])) throw new TypeError("Incomplete shared module");
(0, shared_1.maybeSetModuleExports)(function () { return module; });
//# sourceMappingURL=babel-core.js.map

/***/ 
if (!exportsReady(module.exports, ["__esModule","default"])) throw new TypeError("Incomplete original module exports");
return module.exports;
}
