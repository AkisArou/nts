export interface ParseError extends Error { column?: number; index?: number; lineNumber?: number; description?: string; }
export type ErrorHandler = InstanceType<ReturnType<typeof load>["ErrorHandler"]>;
// Exact Esprima 4.0.1 module from the pinned Lebab bundle; BSD-2-Clause.
import {exportsReady, hasEsModuleFlag} from "../../../../webpack.ts";
let cache: Partial<ReturnType<typeof initialize>> | undefined;
export function load(): ReturnType<typeof initialize> { if (cache !== undefined) { if (!isReady(cache)) throw new TypeError("Incomplete cached Esprima exports"); return cache; } return initialize(); }
function isReady(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> { return hasEsModuleFlag(value) && exportsReady(value, ["ErrorHandler"]); }
function initialize() {
const exports: {__esModule?:true; "ErrorHandler"?: typeof ErrorHandler;} = {};
cache = exports;


	"use strict";
	/* tslint:disable:max-classes-per-file */
	Object.defineProperty(exports, "__esModule", { value: true });
	class ErrorHandler {
declare readonly errors: unknown[];
declare tolerant: boolean;
constructor() {
	        this.errors = [];
	        this.tolerant = false;
	    }
recordError(error: unknown): void {
	        this.errors.push(error);
	    }
tolerate(error: unknown): void {
	        if (this.tolerant) {
	            this.recordError(error);
	        }
	        else {
	            throw error;
	        }
	    }
constructError(msg: string, column: number): ParseError {
	        var error: ParseError = new Error(msg);
	        try {
	            throw error;
	        }
	        catch (base) {
	            /* istanbul ignore else */
	            if (Object.create && Object.defineProperty) {
	                error = parseErrorValue(Object.create(parseErrorValue(base)));
	                Object.defineProperty(error, 'column', { value: column });
	            }
	        }
	        /* istanbul ignore next */
	        return error;
	    }
createError(index: number, line: number, col: number, description: string): ParseError {
	        var msg = 'Line ' + line + ': ' + description;
	        var error = this.constructError(msg, col);
	        error.index = index;
	        error.lineNumber = line;
	        error.description = description;
	        return error;
	    }
throwError(index: number, line: number, col: number, description: string): never {
	        throw this.createError(index, line, col, description);
	    }
tolerateError(index: number, line: number, col: number, description: string) {
	        var error = this.createError(index, line, col, description);
	        if (this.tolerant) {
	            this.recordError(error);
	        }
	        else {
	            throw error;
	        }
	    }
}
	exports.ErrorHandler = ErrorHandler;


/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected Esprima module flag");
if (!exportsReady(exports, ["ErrorHandler"])) throw new TypeError("Incomplete Esprima exports");
return exports;
}

function parseErrorValue(value: unknown): ParseError {
    if (value instanceof Error) return value;
    throw new TypeError("Expected an Esprima parser error");
}
