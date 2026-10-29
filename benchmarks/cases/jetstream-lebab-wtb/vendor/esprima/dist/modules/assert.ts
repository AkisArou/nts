
// Exact Esprima 4.0.1 module from the pinned Lebab bundle; BSD-2-Clause.
import {exportsReady, hasEsModuleFlag} from "../../../../webpack.ts";
let cache: Partial<ReturnType<typeof initialize>> | undefined;
export function load(): ReturnType<typeof initialize> { if (cache !== undefined) { if (!isReady(cache)) throw new TypeError("Incomplete cached Esprima exports"); return cache; } return initialize(); }
function isReady(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> { return hasEsModuleFlag(value) && exportsReady(value, ["assert"]); }
function initialize() {
const exports: {__esModule?:true; "assert"?: typeof assert;} = {};
cache = exports;


	"use strict";
	// Ensure the condition is true, otherwise throw an error.
	// This is only to have a better contract semantic, i.e. another safety net
	// to catch a logic error. The condition shall be fulfilled in normal case.
	// Do NOT use this to enforce a certain condition on any user input.
	Object.defineProperty(exports, "__esModule", { value: true });
	function assert(condition: unknown, message: string) {
	    /* istanbul ignore if */
	    if (!condition) {
	        throw new Error('ASSERT: ' + message);
	    }
	}
	exports.assert = assert;


/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected Esprima module flag");
if (!exportsReady(exports, ["assert"])) throw new TypeError("Incomplete Esprima exports");
return exports;
}

export type assert = ReturnType<typeof load>["assert"];
