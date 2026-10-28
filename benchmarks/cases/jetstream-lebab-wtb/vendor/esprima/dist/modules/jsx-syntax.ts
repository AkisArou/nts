
// Exact Esprima 4.0.1 module from the pinned Lebab bundle; BSD-2-Clause.
import {exportsReady, hasEsModuleFlag} from "../../../../webpack.ts";
let cache: Partial<ReturnType<typeof initialize>> | undefined;
export function load(): ReturnType<typeof initialize> { if (cache !== undefined) { if (!isReady(cache)) throw new TypeError("Incomplete cached Esprima exports"); return cache; } return initialize(); }
function isReady(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> { return hasEsModuleFlag(value) && exportsReady(value, ["JSXSyntax"]); }
function initialize() {
const exports: {__esModule?:true; "JSXSyntax"?: JSXSyntax;} = {};
cache = exports;


	"use strict";
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.JSXSyntax = {
	    JSXAttribute: 'JSXAttribute',
	    JSXClosingElement: 'JSXClosingElement',
	    JSXElement: 'JSXElement',
	    JSXEmptyExpression: 'JSXEmptyExpression',
	    JSXExpressionContainer: 'JSXExpressionContainer',
	    JSXIdentifier: 'JSXIdentifier',
	    JSXMemberExpression: 'JSXMemberExpression',
	    JSXNamespacedName: 'JSXNamespacedName',
	    JSXOpeningElement: 'JSXOpeningElement',
	    JSXSpreadAttribute: 'JSXSpreadAttribute',
	    JSXText: 'JSXText'
	};


/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected Esprima module flag");
if (!exportsReady(exports, ["JSXSyntax"])) throw new TypeError("Incomplete Esprima exports");
return exports;
}

export type JSXSyntax = { JSXAttribute: "JSXAttribute"; JSXClosingElement: "JSXClosingElement"; JSXElement: "JSXElement"; JSXEmptyExpression: "JSXEmptyExpression"; JSXExpressionContainer: "JSXExpressionContainer"; JSXIdentifier: "JSXIdentifier"; JSXMemberExpression: "JSXMemberExpression"; JSXNamespacedName: "JSXNamespacedName"; JSXOpeningElement: "JSXOpeningElement"; JSXSpreadAttribute: "JSXSpreadAttribute"; JSXText: "JSXText"; };
