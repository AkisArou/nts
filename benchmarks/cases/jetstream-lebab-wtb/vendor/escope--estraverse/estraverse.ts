import {isTraversalModule, stringKey, numericReference, traversalCallback, rangedValue, rangedComment, extendedComment, commentArray, type SyntaxTable, type TraversalModule, type TraversalVisitor, type TraversalReference, type TraversalElement, type TraversalPath, type RangedValue, type RangedComment, type ExtendedComment} from "../../traversal-types.ts";
// Exact module body from JetStream 3.0 ./node_modules/escope/node_modules/estraverse/estraverse.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord, record, readProperty} from "../../webpack.ts";
import {load as load0} from "./package.json.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for escope--estraverse/estraverse.js");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isTraversalModule(value);
}
function initialize(): TraversalModule {
const exports: Partial<TraversalModule> = {};
let module = {exports};
cache = module;


/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>

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
/*jslint vars:false, bitwise:true*/
/*jshint indent:4*/
/*global exports:true*/
(function clone(exports: Partial<TraversalModule>): TraversalModule {
    'use strict';

    var Syntax: SyntaxTable,
        VisitorOption: {Break: object; Skip: object; Remove: object},
        VisitorKeys: Record<string, string[]>,
        BREAK: object,
        SKIP: object,
        REMOVE: object;

    function deepCopy(obj: Record<PropertyKey, unknown>): Record<PropertyKey, unknown> {
        var ret: Record<PropertyKey, unknown> = {}, key: string, val: unknown;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                val = obj[key];
                if (typeof val === 'object' && val !== null) {
                    ret[key] = deepCopy(record(val));
                } else {
                    ret[key] = val;
                }
            }
        }
        return ret;
    }

    // based on LLVM libc++ upper_bound / lower_bound
    // MIT License

    function upperBound<T>(array: ArrayLike<T>, func: (item: T) => boolean) {
        var diff: number, len: number, i: number, current: number;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                len = diff;
            } else {
                i = current + 1;
                len -= diff + 1;
            }
        }
        return i;
    }

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        AssignmentPattern: 'AssignmentPattern',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        AwaitExpression: 'AwaitExpression', // CAUTION: It's deferred to ES7.
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ClassBody: 'ClassBody',
        ClassDeclaration: 'ClassDeclaration',
        ClassExpression: 'ClassExpression',
        ComprehensionBlock: 'ComprehensionBlock',  // CAUTION: It's deferred to ES7.
        ComprehensionExpression: 'ComprehensionExpression',  // CAUTION: It's deferred to ES7.
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DebuggerStatement: 'DebuggerStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        EmptyStatement: 'EmptyStatement',
        ExportAllDeclaration: 'ExportAllDeclaration',
        ExportDefaultDeclaration: 'ExportDefaultDeclaration',
        ExportNamedDeclaration: 'ExportNamedDeclaration',
        ExportSpecifier: 'ExportSpecifier',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        ForOfStatement: 'ForOfStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        GeneratorExpression: 'GeneratorExpression',  // CAUTION: It's deferred to ES7.
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        ImportExpression: 'ImportExpression',
        ImportDeclaration: 'ImportDeclaration',
        ImportDefaultSpecifier: 'ImportDefaultSpecifier',
        ImportNamespaceSpecifier: 'ImportNamespaceSpecifier',
        ImportSpecifier: 'ImportSpecifier',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        MetaProperty: 'MetaProperty',
        MethodDefinition: 'MethodDefinition',
        ModuleSpecifier: 'ModuleSpecifier',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        RestElement: 'RestElement',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SpreadElement: 'SpreadElement',
        Super: 'Super',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        TaggedTemplateExpression: 'TaggedTemplateExpression',
        TemplateElement: 'TemplateElement',
        TemplateLiteral: 'TemplateLiteral',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    VisitorKeys = {
        AssignmentExpression: ['left', 'right'],
        AssignmentPattern: ['left', 'right'],
        ArrayExpression: ['elements'],
        ArrayPattern: ['elements'],
        ArrowFunctionExpression: ['params', 'body'],
        AwaitExpression: ['argument'], // CAUTION: It's deferred to ES7.
        BlockStatement: ['body'],
        BinaryExpression: ['left', 'right'],
        BreakStatement: ['label'],
        CallExpression: ['callee', 'arguments'],
        CatchClause: ['param', 'body'],
        ClassBody: ['body'],
        ClassDeclaration: ['id', 'superClass', 'body'],
        ClassExpression: ['id', 'superClass', 'body'],
        ComprehensionBlock: ['left', 'right'],  // CAUTION: It's deferred to ES7.
        ComprehensionExpression: ['blocks', 'filter', 'body'],  // CAUTION: It's deferred to ES7.
        ConditionalExpression: ['test', 'consequent', 'alternate'],
        ContinueStatement: ['label'],
        DebuggerStatement: [],
        DirectiveStatement: [],
        DoWhileStatement: ['body', 'test'],
        EmptyStatement: [],
        ExportAllDeclaration: ['source'],
        ExportDefaultDeclaration: ['declaration'],
        ExportNamedDeclaration: ['declaration', 'specifiers', 'source'],
        ExportSpecifier: ['exported', 'local'],
        ExpressionStatement: ['expression'],
        ForStatement: ['init', 'test', 'update', 'body'],
        ForInStatement: ['left', 'right', 'body'],
        ForOfStatement: ['left', 'right', 'body'],
        FunctionDeclaration: ['id', 'params', 'body'],
        FunctionExpression: ['id', 'params', 'body'],
        GeneratorExpression: ['blocks', 'filter', 'body'],  // CAUTION: It's deferred to ES7.
        Identifier: [],
        IfStatement: ['test', 'consequent', 'alternate'],
        ImportExpression: ['source'],
        ImportDeclaration: ['specifiers', 'source'],
        ImportDefaultSpecifier: ['local'],
        ImportNamespaceSpecifier: ['local'],
        ImportSpecifier: ['imported', 'local'],
        Literal: [],
        LabeledStatement: ['label', 'body'],
        LogicalExpression: ['left', 'right'],
        MemberExpression: ['object', 'property'],
        MetaProperty: ['meta', 'property'],
        MethodDefinition: ['key', 'value'],
        ModuleSpecifier: [],
        NewExpression: ['callee', 'arguments'],
        ObjectExpression: ['properties'],
        ObjectPattern: ['properties'],
        Program: ['body'],
        Property: ['key', 'value'],
        RestElement: [ 'argument' ],
        ReturnStatement: ['argument'],
        SequenceExpression: ['expressions'],
        SpreadElement: ['argument'],
        Super: [],
        SwitchStatement: ['discriminant', 'cases'],
        SwitchCase: ['test', 'consequent'],
        TaggedTemplateExpression: ['tag', 'quasi'],
        TemplateElement: [],
        TemplateLiteral: ['quasis', 'expressions'],
        ThisExpression: [],
        ThrowStatement: ['argument'],
        TryStatement: ['block', 'handler', 'finalizer'],
        UnaryExpression: ['argument'],
        UpdateExpression: ['argument'],
        VariableDeclaration: ['declarations'],
        VariableDeclarator: ['id', 'init'],
        WhileStatement: ['test', 'body'],
        WithStatement: ['object', 'body'],
        YieldExpression: ['argument']
    };

    // unique id
    BREAK = {};
    SKIP = {};
    REMOVE = {};

    VisitorOption = {
        Break: BREAK,
        Skip: SKIP,
        Remove: REMOVE
    };

    class Reference {
declare parent: unknown; declare key: string | number; declare replace: (node: unknown) => void; declare remove: () => boolean;
constructor(parent: unknown, key: string | number) {
        this.parent = parent;
        this.key = key;
    }
}

    Reference.prototype.replace = function replace(this: Reference, node: unknown) {
        record(this.parent)[this.key] = node;
    };

    Reference.prototype.remove = function remove(this: Reference) {
        if (Array.isArray(this.parent)) {
            this.parent.splice(numericReference(this).key, 1);
            return true;
        } else {
            this.replace(null);
            return false;
        }
    };

    class Element {
declare node: unknown; declare path: TraversalPath | null; declare wrap: string | null; declare ref: Reference | null;
constructor(node: unknown, path: TraversalPath | null, wrap: string | null, ref: Reference | null) {
        this.node = node;
        this.path = path;
        this.wrap = wrap;
        this.ref = ref;
    }
}

    class Controller {
declare visitor: TraversalVisitor; declare root: unknown; declare __worklist: TraversalElement[]; declare __leavelist: TraversalElement[]; declare __current: TraversalElement | null; declare __state: unknown; declare __fallback: ((node: object) => string[]) | null; declare __keys: Record<string, string[]>;
declare path: () => (string | number | null | undefined)[] | null; declare type: () => unknown; declare parents: () => unknown[]; declare current: () => unknown; declare __execute: (callback: unknown, element: TraversalElement) => unknown; declare notify: (flag: unknown) => void; declare skip: () => void; declare break: () => void; declare remove: () => void; declare __initialize: (root: unknown, visitor: TraversalVisitor) => void; declare traverse: (root: unknown, visitor: TraversalVisitor) => void; declare replace: (root: unknown, visitor: TraversalVisitor) => unknown;
constructor() { }
}

    // API:
    // return property path array from root to current node
    Controller.prototype.path = function path(this: Controller) {
        var i: number, iz: number, j: number, jz: number, result: (string | number | null | undefined)[], element: TraversalElement;

        function addToPath(result: (string | number | null | undefined)[], path: TraversalPath | null | undefined) {
            if (Array.isArray(path)) {
                for (j = 0, jz = path.length; j < jz; ++j) {
                    result.push(path[j]);
                }
            } else {
                result.push(path);
            }
        }

        // root node
        if (!this.__current!.path) {
            return null;
        }

        // first node is sentinel, second node is root element
        result = [];
        for (i = 2, iz = this.__leavelist.length; i < iz; ++i) {
            element = this.__leavelist[i];
            addToPath(result, element.path);
        }
        addToPath(result, this.__current!.path);
        return result;
    };

    // API:
    // return type of current node
    Controller.prototype.type = function (this: Controller) {
        var node = this.current();
        return readProperty(node, "type") || this.__current!.wrap;
    };

    // API:
    // return array of parent elements
    Controller.prototype.parents = function parents(this: Controller) {
        var i: number, iz: number, result: unknown[];

        // first node is sentinel
        result = [];
        for (i = 1, iz = this.__leavelist.length; i < iz; ++i) {
            result.push(this.__leavelist[i].node);
        }

        return result;
    };

    // API:
    // return current node
    Controller.prototype.current = function current(this: Controller) {
        return this.__current!.node;
    };

    Controller.prototype.__execute = function __execute(this: Controller, callback: unknown, element: TraversalElement) {
        var previous: TraversalElement | null, result: unknown;

        result = undefined;

        previous  = this.__current;
        this.__current = element;
        this.__state = null;
        if (callback) {
            result = traversalCallback(callback).call(this, element.node, this.__leavelist[this.__leavelist.length - 1].node);
        }
        this.__current = previous;

        return result;
    };

    // API:
    // notify control skip / break
    Controller.prototype.notify = function notify(this: Controller, flag: unknown) {
        this.__state = flag;
    };

    // API:
    // skip child nodes of current node
    Controller.prototype.skip = function (this: Controller) {
        this.notify(SKIP);
    };

    // API:
    // break traversals
    Controller.prototype['break'] = function (this: Controller) {
        this.notify(BREAK);
    };

    // API:
    // remove node
    Controller.prototype.remove = function (this: Controller) {
        this.notify(REMOVE);
    };

    Controller.prototype.__initialize = function(this: Controller, root: unknown, visitor: TraversalVisitor) {
        this.visitor = visitor;
        this.root = root;
        this.__worklist = [];
        this.__leavelist = [];
        this.__current = null;
        this.__state = null;
        this.__fallback = null;
        if (visitor.fallback === 'iteration') {
            this.__fallback = Object.keys;
        } else if (typeof visitor.fallback === 'function') {
            this.__fallback = visitor.fallback;
        }

        this.__keys = VisitorKeys;
        if (visitor.keys) {
            this.__keys = Object.assign(Object.create(this.__keys), visitor.keys);
        }
    };

    function isNode(node: unknown): node is {type: string} {
        if (node == null) {
            return false;
        }
        return typeof node === 'object' && typeof readProperty(node, "type") === 'string';
    }

    function isProperty(nodeType: unknown, key: string) {
        return (nodeType === Syntax.ObjectExpression || nodeType === Syntax.ObjectPattern) && 'properties' === key;
    }

    Controller.prototype.traverse = function traverse(this: Controller, root: unknown, visitor: TraversalVisitor) {
        var worklist: TraversalElement[],
            leavelist: TraversalElement[],
            element: TraversalElement,
            node: unknown,
            nodeType: unknown,
            ret: unknown,
            key: string,
            current: number,
            current2: number,
            candidates: string[],
            candidate: unknown,
            sentinel: TraversalElement;

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        worklist.push(new Element(root, null, null, null));
        leavelist.push(new Element(null, null, null, null));

        while (worklist.length) {
            element = worklist.pop()!;

            if (element === sentinel) {
                element = leavelist.pop()!;

                ret = this.__execute(visitor.leave, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }
                continue;
            }

            if (element.node) {

                ret = this.__execute(visitor.enter, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }

                worklist.push(sentinel);
                leavelist.push(element);

                if (this.__state === SKIP || ret === SKIP) {
                    continue;
                }

                node = element.node;
                nodeType = readProperty(node, "type") || element.wrap;
                candidates = this.__keys[stringKey(nodeType)];
                if (!candidates) {
                    if (this.__fallback) {
                        candidates = this.__fallback(record(node));
                    } else {
                        throw new Error('Unknown node type ' + nodeType + '.');
                    }
                }

                current = candidates.length;
                while ((current -= 1) >= 0) {
                    key = candidates[current];
                    candidate = readProperty(node, key);
                    if (!candidate) {
                        continue;
                    }

                    if (Array.isArray(candidate)) {
                        current2 = candidate.length;
                        while ((current2 -= 1) >= 0) {
                            if (!candidate[current2]) {
                                continue;
                            }
                            if (isProperty(nodeType, candidates[current])) {
                                element = new Element(candidate[current2], [key, current2], 'Property', null);
                            } else if (isNode(candidate[current2])) {
                                element = new Element(candidate[current2], [key, current2], null, null);
                            } else {
                                continue;
                            }
                            worklist.push(element);
                        }
                    } else if (isNode(candidate)) {
                        worklist.push(new Element(candidate, key, null, null));
                    }
                }
            }
        }
    };

    Controller.prototype.replace = function replace(this: Controller, root: unknown, visitor: TraversalVisitor) {
        var worklist: TraversalElement[],
            leavelist: TraversalElement[],
            node: unknown,
            nodeType: unknown,
            target: unknown,
            element: TraversalElement,
            current: number,
            current2: number,
            candidates: string[],
            candidate: unknown,
            sentinel: TraversalElement,
            outer: {root: unknown},
            key: string;

        function removeElem(element: TraversalElement) {
            var i: number,
                key: number,
                nextElem: TraversalElement,
                parent: unknown;

            if (element.ref!.remove()) {
                // When the reference is an element of an array.
                key = numericReference(element.ref!).key;
                parent = element.ref!.parent;

                // If removed from array, then decrease following items' keys.
                i = worklist.length;
                while (i--) {
                    nextElem = worklist[i];
                    if (nextElem.ref && nextElem.ref.parent === parent) {
                        if  (numericReference(nextElem.ref).key < key) {
                            break;
                        }
                        --numericReference(nextElem.ref).key;
                    }
                }
            }
        }

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        outer = {
            root: root
        };
        element = new Element(root, null, null, new Reference(outer, 'root'));
        worklist.push(element);
        leavelist.push(element);

        while (worklist.length) {
            element = worklist.pop()!;

            if (element === sentinel) {
                element = leavelist.pop()!;

                target = this.__execute(visitor.leave, element);

                // node may be replaced with null,
                // so distinguish between undefined and null in this place
                if (target !== undefined && target !== BREAK && target !== SKIP && target !== REMOVE) {
                    // replace
                    element.ref!.replace(target);
                }

                if (this.__state === REMOVE || target === REMOVE) {
                    removeElem(element);
                }

                if (this.__state === BREAK || target === BREAK) {
                    return outer.root;
                }
                continue;
            }

            target = this.__execute(visitor.enter, element);

            // node may be replaced with null,
            // so distinguish between undefined and null in this place
            if (target !== undefined && target !== BREAK && target !== SKIP && target !== REMOVE) {
                // replace
                element.ref!.replace(target);
                element.node = target;
            }

            if (this.__state === REMOVE || target === REMOVE) {
                removeElem(element);
                element.node = null;
            }

            if (this.__state === BREAK || target === BREAK) {
                return outer.root;
            }

            // node may be null
            node = element.node;
            if (!node) {
                continue;
            }

            worklist.push(sentinel);
            leavelist.push(element);

            if (this.__state === SKIP || target === SKIP) {
                continue;
            }

            nodeType = readProperty(node, "type") || element.wrap;
            candidates = this.__keys[stringKey(nodeType)];
            if (!candidates) {
                if (this.__fallback) {
                    candidates = this.__fallback(record(node));
                } else {
                    throw new Error('Unknown node type ' + nodeType + '.');
                }
            }

            current = candidates.length;
            while ((current -= 1) >= 0) {
                key = candidates[current];
                candidate = readProperty(node, key);
                if (!candidate) {
                    continue;
                }

                if (Array.isArray(candidate)) {
                    current2 = candidate.length;
                    while ((current2 -= 1) >= 0) {
                        if (!candidate[current2]) {
                            continue;
                        }
                        if (isProperty(nodeType, candidates[current])) {
                            element = new Element(candidate[current2], [key, current2], 'Property', new Reference(candidate, current2));
                        } else if (isNode(candidate[current2])) {
                            element = new Element(candidate[current2], [key, current2], null, new Reference(candidate, current2));
                        } else {
                            continue;
                        }
                        worklist.push(element);
                    }
                } else if (isNode(candidate)) {
                    worklist.push(new Element(candidate, key, null, new Reference(node, key)));
                }
            }
        }

        return outer.root;
    };

    function traverse(root: unknown, visitor: TraversalVisitor) {
        var controller = new Controller();
        return controller.traverse(root, visitor);
    }

    function replace(root: unknown, visitor: TraversalVisitor) {
        var controller = new Controller();
        return controller.replace(root, visitor);
    }

    function extendCommentRange(comment: RangedComment, tokens: readonly RangedValue[]): ExtendedComment {
        var target: number;

        target = upperBound(tokens, function search(token: RangedValue) {
            return token.range[0] > comment.range[0];
        });

        comment.extendedRange = [comment.range[0], comment.range[1]];

        if (target !== tokens.length) {
            comment.extendedRange[1] = tokens[target].range[0];
        }

        target -= 1;
        if (target >= 0) {
            comment.extendedRange[0] = tokens[target].range[1];
        }

        return extendedComment(comment);
    }

    function attachComments(tree: unknown, providedComments: readonly unknown[], tokens: readonly RangedValue[]) {
        // At first, we should calculate extended comment ranges.
        var comments: ExtendedComment[] = [], comment: RangedComment, len: number, i: number, cursor: number;

        if (!readProperty(tree, "range")) {
            throw new Error('attachComments needs range information');
        }

        // tokens array is empty, we attach comments to tree as 'leadingComments'
        if (!tokens.length) {
            if (providedComments.length) {
                for (i = 0, len = providedComments.length; i < len; i += 1) {
                    comment = rangedComment(deepCopy(record(providedComments[i])));
                    comment.extendedRange = [0, rangedValue(tree).range[0]];
                    comments.push(extendedComment(comment));
                }
                record(tree).leadingComments = comments;
            }
            return tree;
        }

        for (i = 0, len = providedComments.length; i < len; i += 1) {
            comments.push(extendCommentRange(rangedComment(deepCopy(record(providedComments[i]))), tokens));
        }

        // This is based on John Freeman's implementation.
        cursor = 0;
        traverse(tree, {
            enter: function (node: unknown) {
                var comment: ExtendedComment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (comment.extendedRange[1] > rangedValue(node).range[0]) {
                        break;
                    }

                    if (comment.extendedRange[1] === rangedValue(node).range[0]) {
                        if (!readProperty(node, "leadingComments")) {
                            record(node).leadingComments = [];
                        }
                        commentArray(readProperty(node, "leadingComments")).push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > rangedValue(node).range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        cursor = 0;
        traverse(tree, {
            leave: function (node: unknown) {
                var comment: ExtendedComment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (rangedValue(node).range[1] < comment.extendedRange[0]) {
                        break;
                    }

                    if (rangedValue(node).range[1] === comment.extendedRange[0]) {
                        if (!readProperty(node, "trailingComments")) {
                            record(node).trailingComments = [];
                        }
                        commentArray(readProperty(node, "trailingComments")).push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > rangedValue(node).range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        return tree;
    }

    exports.version = stringKey(readProperty(load0(), "version"));
    exports.Syntax = Syntax;
    exports.traverse = traverse;
    exports.replace = replace;
    exports.attachComments = attachComments;
    exports.VisitorKeys = VisitorKeys;
    exports.VisitorOption = VisitorOption;
    exports.Controller = Controller;
    exports.cloneEnvironment = function () { return clone({}); };

    if (!isTraversalModule(exports)) throw new TypeError("Incomplete original traversal exports");
    return exports;
}(exports));
/* vim: set sw=4 ts=4 et tw=80 : */


/***/ 
if (!isTraversalModule(exports)) throw new TypeError("Incomplete original traversal exports");
return exports;
}
