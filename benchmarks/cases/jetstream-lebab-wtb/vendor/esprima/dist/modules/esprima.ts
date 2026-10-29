import type {ParserOptions, Delegate, BaseNode, Metadata} from "./node-metadata.ts";
import type {BufferEntry} from "./tokenizer.ts";
import type { CommentHandler } from "./comment-handler.ts";
import type { JSXParser } from "./jsx-parser.ts";
import type { Parser } from "./parser.ts";
import type { Tokenizer } from "./tokenizer.ts";
// Exact Esprima 4.0.1 module from the pinned Lebab bundle; BSD-2-Clause.
import {exportsReady, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load1} from "./comment-handler.ts";
import {load as load3} from "./jsx-parser.ts";
import {load as load8} from "./parser.ts";
import {load as load15} from "./tokenizer.ts";
import {load as load2} from "./syntax.ts";
let cache: Partial<ReturnType<typeof initialize>> | undefined;
export function load(): ReturnType<typeof initialize> { if (cache !== undefined) { if (!isReady(cache)) throw new TypeError("Incomplete cached Esprima exports"); return cache; } return initialize(); }
function isReady(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> { return hasEsModuleFlag(value) && exportsReady(value, ["parse","parseModule","parseScript","tokenize","Syntax","version"]); }
function initialize() {
const exports: {__esModule?:true; "parse"?: typeof parse; "parseModule"?: typeof parseModule; "parseScript"?: typeof parseScript; "tokenize"?: typeof tokenize; "Syntax"?: typeof syntax_1.Syntax; "version"?: string;} = {};
cache = exports;


	"use strict";
	/*
	  Copyright JS Foundation and other contributors, https://js.foundation/

	  Redistribution and use in source and binary forms, with or without
	  modification, are permitted provided that the following conditions are met:

	    * Redistributions of source code must retain the above copyright
	      notice, this list of conditions and the following disclaimer.
	    * Redistributions in binary form must reproduce the above copyright
	      notice, this list of conditions and the following disclaimer in the
	      documentation and/or other materials provided with the distribution.

	  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
	  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
	  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
	  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
	  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
	  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
	  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
	  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
	  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
	  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	var comment_handler_1 = load1();
	var jsx_parser_1 = load3();
	var parser_1 = load8();
	var tokenizer_1 = load15();
	function parse(code: string, options?: ParserOptions, delegate?: Delegate) {
	    var commentHandler: CommentHandler | null = null;
	    var proxyDelegate = function (node: BaseNode, metadata: Metadata) {
	        if (delegate) {
	            delegate(node, metadata);
	        }
	        if (commentHandler) {
	            commentHandler.visit(node, metadata);
	        }
	    };
	    var parserDelegate = (typeof delegate === 'function') ? proxyDelegate : null;
	    var collectComment = false;
	    if (options) {
	        collectComment = (typeof options.comment === 'boolean' && options.comment);
	        var attachComment = (typeof options.attachComment === 'boolean' && options.attachComment);
	        if (collectComment || attachComment) {
	            commentHandler = new comment_handler_1.CommentHandler();
	            commentHandler.attach = attachComment;
	            options.comment = true;
	            parserDelegate = proxyDelegate;
	        }
	    }
	    var isModule = false;
	    if (options && typeof options.sourceType === 'string') {
	        isModule = (options.sourceType === 'module');
	    }
	    var parser: Parser | JSXParser;
	    if (options && typeof options.jsx === 'boolean' && options.jsx) {
	        parser = new jsx_parser_1.JSXParser(code, options, parserDelegate);
	    }
	    else {
	        parser = new parser_1.Parser(code, options, parserDelegate);
	    }
	    var program = isModule ? parser.parseModule() : parser.parseScript();
	    var ast = program;
	    if (collectComment && commentHandler) {
	        ast.comments = commentHandler.comments;
	    }
	    if (parser.config.tokens) {
	        ast.tokens = parser.tokens;
	    }
	    if (parser.config.tolerant) {
	        ast.errors = parser.errorHandler.errors;
	    }
	    return ast;
	}
	exports.parse = parse;
	function parseModule(code: string, options?: ParserOptions, delegate?: Delegate) {
	    var parsingOptions = options || {};
	    parsingOptions.sourceType = 'module';
	    return parse(code, parsingOptions, delegate);
	}
	exports.parseModule = parseModule;
	function parseScript(code: string, options?: ParserOptions, delegate?: Delegate) {
	    var parsingOptions = options || {};
	    parsingOptions.sourceType = 'script';
	    return parse(code, parsingOptions, delegate);
	}
	exports.parseScript = parseScript;
	function tokenize(code: string, options?: ParserOptions, delegate?: (token: BufferEntry) => BufferEntry | undefined) {
	    var tokenizer = new tokenizer_1.Tokenizer(code, options);
	    var tokens: (BufferEntry | undefined)[] & {errors?: unknown[]};
	    tokens = [];
	    try {
	        while (true) {
	            var token = tokenizer.getNextToken();
	            if (!token) {
	                break;
	            }
	            if (delegate) {
	                token = delegate(token);
	            }
	            tokens.push(token);
	        }
	    }
	    catch (e) {
	        tokenizer.errorHandler.tolerate(e);
	    }
	    if (tokenizer.errorHandler.tolerant) {
	        tokens.errors = tokenizer.errors();
	    }
	    return tokens;
	}
	exports.tokenize = tokenize;
	var syntax_1 = load2();
	exports.Syntax = syntax_1.Syntax;
	// Sync with *.json manifests.
	exports.version = '4.0.1';


/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected Esprima module flag");
if (!exportsReady(exports, ["parse","parseModule","parseScript","tokenize","Syntax","version"])) throw new TypeError("Incomplete Esprima exports");
return exports;
}
