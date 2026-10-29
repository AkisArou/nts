import {stringKey} from "../../traversal-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/esrecurse/esrecurse.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, readProperty, record, runtimeCallable} from "../../webpack.ts";
import {load as load0} from "../estraverse/estraverse.ts";
import {load as load1} from "./package.json.ts";

export interface VisitorOptions {childVisitorKeys?: Record<string, string[]> | null; fallback?: "iteration" | ((node: object) => string[]);}
export interface RecursionVisitor {__visitor: unknown; __childVisitorKeys: Record<string, string[]>; __fallback?: (node: object) => string[]; visitChildren(node: unknown): void; visit(node: unknown): void;}
export interface RecursionModule {version: string; Visitor: new (visitor?: unknown, options?: VisitorOptions) => RecursionVisitor; visit(node: unknown, visitor?: unknown, options?: VisitorOptions): void;}
function isRecursionModule(value: unknown): value is RecursionModule {return isRecord(value) && typeof value.version === "string" && typeof value.Visitor === "function" && typeof value.visit === "function";}

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for esrecurse/esrecurse.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecursionModule(value);
}
function initialize(): RecursionModule {
const exports: Partial<RecursionModule> = {};
let module = {exports};
cache = module;


/*
  Copyright (C) 2014 Yusuke Suzuki <utatane.tea@gmail.com>

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
(function () {
    'use strict';

    var estraverse = load0();

    function isNode(node: unknown): node is {type: string} {
        if (node == null) {
            return false;
        }
        return typeof node === 'object' && typeof readProperty(node, "type") === 'string';
    }

    function isProperty(nodeType: unknown, key: string) {
        return (nodeType === estraverse.Syntax.ObjectExpression || nodeType === estraverse.Syntax.ObjectPattern) && key === 'properties';
    }

    class Visitor {
declare __visitor: unknown; declare __childVisitorKeys: Record<string, string[]>; declare __fallback?: (node: object) => string[]; declare visitChildren: (node: unknown) => void; declare visit: (node: unknown) => void;
constructor(visitor?: unknown, options?: VisitorOptions) {
        options = options || {};

        this.__visitor = visitor ||  this;
        this.__childVisitorKeys = options.childVisitorKeys
            ? Object.assign({}, estraverse.VisitorKeys, options.childVisitorKeys)
            : estraverse.VisitorKeys;
        if (options.fallback === 'iteration') {
            this.__fallback = Object.keys;
        } else if (typeof options.fallback === 'function') {
            this.__fallback = options.fallback;
        }
    }
}

    /* Default method for visiting children.
     * When you need to call default visiting operation inside custom visiting
     * operation, you can use it with `this.visitChildren(node)`.
     */
    Visitor.prototype.visitChildren = function (this: Visitor, node: unknown) {
        var type: unknown, children: string[], i: number, iz: number, j: number, jz: number, child: unknown;

        if (node == null) {
            return;
        }

        type = readProperty(node, "type") || estraverse.Syntax.Property;

        children = this.__childVisitorKeys[stringKey(type)];
        if (!children) {
            if (this.__fallback) {
                children = this.__fallback(record(node));
            } else {
                throw new Error('Unknown node type ' + type + '.');
            }
        }

        for (i = 0, iz = children.length; i < iz; ++i) {
            child = readProperty(node, children[i]);
            if (child) {
                if (Array.isArray(child)) {
                    for (j = 0, jz = child.length; j < jz; ++j) {
                        if (child[j]) {
                            if (isNode(child[j]) || isProperty(type, children[i])) {
                                this.visit(child[j]);
                            }
                        }
                    }
                } else if (isNode(child)) {
                    this.visit(child);
                }
            }
        }
    };

    /* Dispatching node. */
    Visitor.prototype.visit = function (this: Visitor, node: unknown) {
        var type: unknown;

        if (node == null) {
            return;
        }

        type = readProperty(node, "type") || estraverse.Syntax.Property;
        if (readProperty(this.__visitor, stringKey(type))) {
            runtimeCallable(readProperty(this.__visitor, stringKey(type))).call(this, node);
            return;
        }
        this.visitChildren(node);
    };

    exports.version = stringKey(readProperty(load1(), "version"));
    exports.Visitor = Visitor;
    exports.visit = function (node: unknown, visitor?: unknown, options?: VisitorOptions) {
        var v = new Visitor(visitor, options);
        v.visit(node);
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */


/***/ 
if (!isRecursionModule(exports)) throw new TypeError("Incomplete original recursion exports");
return exports;
}
