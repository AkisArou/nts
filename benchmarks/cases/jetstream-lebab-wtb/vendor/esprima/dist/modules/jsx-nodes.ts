import type {BaseNode} from "./node-metadata.ts";
import type { JSXSyntax } from "./jsx-syntax.ts";
import type * as NodeTypes from "./nodes.ts";
export type JSXAttributeName = JSXIdentifier | JSXNamespacedName;
export type JSXAttributeValue = NodeTypes.Literal | JSXElement | JSXSpreadAttribute | JSXExpressionContainer;
export type JSXChild = JSXElement | JSXExpressionContainer | JSXText;
export type JSXElementAttribute = JSXAttribute | JSXSpreadAttribute;
export type JSXElementName = JSXIdentifier | JSXNamespacedName | JSXMemberExpression;
export interface JSXClosingElement extends BaseNode { readonly type: "JSXClosingElement"; readonly name: JSXElementName; }
export interface JSXElement extends BaseNode { readonly type: "JSXElement"; readonly openingElement: JSXOpeningElement; readonly children: JSXChild[]; readonly closingElement: JSXClosingElement | null; }
export interface JSXEmptyExpression extends BaseNode { readonly type: "JSXEmptyExpression"; }
export interface JSXExpressionContainer extends BaseNode { readonly type: "JSXExpressionContainer"; readonly expression: NodeTypes.Expression | JSXEmptyExpression; }
export interface JSXIdentifier extends BaseNode { readonly type: "JSXIdentifier"; readonly name: string; }
export interface JSXMemberExpression extends BaseNode { readonly type: "JSXMemberExpression"; readonly object: JSXMemberExpression | JSXIdentifier; readonly property: JSXIdentifier; }
export interface JSXAttribute extends BaseNode { readonly type: "JSXAttribute"; readonly name: JSXAttributeName; readonly value: JSXAttributeValue | null; }
export interface JSXNamespacedName extends BaseNode { readonly type: "JSXNamespacedName"; readonly namespace: JSXIdentifier; readonly name: JSXIdentifier; }
export interface JSXOpeningElement extends BaseNode { readonly type: "JSXOpeningElement"; readonly name: JSXElementName; readonly selfClosing: boolean; readonly attributes: JSXElementAttribute[]; }
export interface JSXSpreadAttribute extends BaseNode { readonly type: "JSXSpreadAttribute"; readonly argument: NodeTypes.Expression; }
export interface JSXText extends BaseNode { readonly type: "JSXText"; readonly value: string; readonly raw: string; }
// Exact Esprima 4.0.1 module from the pinned Lebab bundle; BSD-2-Clause.
import {exportsReady, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load6} from "./jsx-syntax.ts";
let cache: Partial<ReturnType<typeof initialize>> | undefined;
export function load(): ReturnType<typeof initialize> { if (cache !== undefined) { if (!isReady(cache)) throw new TypeError("Incomplete cached Esprima exports"); return cache; } return initialize(); }
function isReady(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> { return hasEsModuleFlag(value) && exportsReady(value, ["JSXClosingElement","JSXElement","JSXEmptyExpression","JSXExpressionContainer","JSXIdentifier","JSXMemberExpression","JSXAttribute","JSXNamespacedName","JSXOpeningElement","JSXSpreadAttribute","JSXText"]); }
function initialize() {
const exports: {__esModule?:true; "JSXClosingElement"?: typeof JSXClosingElement; "JSXElement"?: typeof JSXElement; "JSXEmptyExpression"?: typeof JSXEmptyExpression; "JSXExpressionContainer"?: typeof JSXExpressionContainer; "JSXIdentifier"?: typeof JSXIdentifier; "JSXMemberExpression"?: typeof JSXMemberExpression; "JSXAttribute"?: typeof JSXAttribute; "JSXNamespacedName"?: typeof JSXNamespacedName; "JSXOpeningElement"?: typeof JSXOpeningElement; "JSXSpreadAttribute"?: typeof JSXSpreadAttribute; "JSXText"?: typeof JSXText;} = {};
cache = exports;


	"use strict";
	Object.defineProperty(exports, "__esModule", { value: true });
	var jsx_syntax_1 = load6();
	/* tslint:disable:max-classes-per-file */
	class JSXClosingElement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXClosingElement";
declare readonly name: JSXElementName;
constructor(name: JSXElementName) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXClosingElement;
	        this.name = name;
	    }
}
	exports.JSXClosingElement = JSXClosingElement;
	class JSXElement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXElement";
declare readonly openingElement: JSXOpeningElement;
declare readonly children: JSXChild[];
declare readonly closingElement: JSXClosingElement | null;
constructor(openingElement: JSXOpeningElement, children: JSXChild[], closingElement: JSXClosingElement | null) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXElement;
	        this.openingElement = openingElement;
	        this.children = children;
	        this.closingElement = closingElement;
	    }
}
	exports.JSXElement = JSXElement;
	class JSXEmptyExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXEmptyExpression";
constructor() {
	        this.type = jsx_syntax_1.JSXSyntax.JSXEmptyExpression;
	    }
}
	exports.JSXEmptyExpression = JSXEmptyExpression;
	class JSXExpressionContainer {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXExpressionContainer";
declare readonly expression: NodeTypes.Expression | JSXEmptyExpression;
constructor(expression: NodeTypes.Expression | JSXEmptyExpression) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXExpressionContainer;
	        this.expression = expression;
	    }
}
	exports.JSXExpressionContainer = JSXExpressionContainer;
	class JSXIdentifier {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXIdentifier";
declare readonly name: string;
constructor(name: string) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXIdentifier;
	        this.name = name;
	    }
}
	exports.JSXIdentifier = JSXIdentifier;
	class JSXMemberExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXMemberExpression";
declare readonly object: JSXMemberExpression | JSXIdentifier;
declare readonly property: JSXIdentifier;
constructor(object: JSXMemberExpression | JSXIdentifier, property: JSXIdentifier) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXMemberExpression;
	        this.object = object;
	        this.property = property;
	    }
}
	exports.JSXMemberExpression = JSXMemberExpression;
	class JSXAttribute {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXAttribute";
declare readonly name: JSXAttributeName;
declare readonly value: JSXAttributeValue | null;
constructor(name: JSXAttributeName, value: JSXAttributeValue | null) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXAttribute;
	        this.name = name;
	        this.value = value;
	    }
}
	exports.JSXAttribute = JSXAttribute;
	class JSXNamespacedName {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXNamespacedName";
declare readonly namespace: JSXIdentifier;
declare readonly name: JSXIdentifier;
constructor(namespace: JSXIdentifier, name: JSXIdentifier) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXNamespacedName;
	        this.namespace = namespace;
	        this.name = name;
	    }
}
	exports.JSXNamespacedName = JSXNamespacedName;
	class JSXOpeningElement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXOpeningElement";
declare readonly name: JSXElementName;
declare readonly selfClosing: boolean;
declare readonly attributes: JSXElementAttribute[];
constructor(name: JSXElementName, selfClosing: boolean, attributes: JSXElementAttribute[]) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXOpeningElement;
	        this.name = name;
	        this.selfClosing = selfClosing;
	        this.attributes = attributes;
	    }
}
	exports.JSXOpeningElement = JSXOpeningElement;
	class JSXSpreadAttribute {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXSpreadAttribute";
declare readonly argument: NodeTypes.Expression;
constructor(argument: NodeTypes.Expression) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXSpreadAttribute;
	        this.argument = argument;
	    }
}
	exports.JSXSpreadAttribute = JSXSpreadAttribute;
	class JSXText {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "JSXText";
declare readonly value: string;
declare readonly raw: string;
constructor(value: string, raw: string) {
	        this.type = jsx_syntax_1.JSXSyntax.JSXText;
	        this.value = value;
	        this.raw = raw;
	    }
}
	exports.JSXText = JSXText;


/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected Esprima module flag");
if (!exportsReady(exports, ["JSXClosingElement","JSXElement","JSXEmptyExpression","JSXExpressionContainer","JSXIdentifier","JSXMemberExpression","JSXAttribute","JSXNamespacedName","JSXOpeningElement","JSXSpreadAttribute","JSXText"])) throw new TypeError("Incomplete Esprima exports");
return exports;
}

export type JSXNode = JSXClosingElement | JSXElement | JSXEmptyExpression | JSXExpressionContainer | JSXIdentifier | JSXMemberExpression | JSXAttribute | JSXNamespacedName | JSXOpeningElement | JSXSpreadAttribute | JSXText;
