import type {BaseNode, Metadata} from "./node-metadata.ts";
import {readProperty} from "../../../../webpack.ts";
import type { SourceLocation } from "./scanner.ts";
import type { Syntax } from "./syntax.ts";
export interface Comment extends BaseNode {
    type: string;
    value: string;
    range?: [number, number];
    loc?: SourceLocation;
}
export interface AttachedComment extends Comment { range: [number, number]; }
export interface Entry {
    comment: AttachedComment;
    start: number;
}
export interface NodeInfo {
    node: BaseNode;
    start: number;
}
export type CommentHandler = InstanceType<ReturnType<typeof load>["CommentHandler"]>;
// Exact Esprima 4.0.1 module from the pinned Lebab bundle; BSD-2-Clause.
import {exportsReady, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load2} from "./syntax.ts";
let cache: Partial<ReturnType<typeof initialize>> | undefined;
export function load(): ReturnType<typeof initialize> { if (cache !== undefined) { if (!isReady(cache)) throw new TypeError("Incomplete cached Esprima exports"); return cache; } return initialize(); }
function isReady(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> { return hasEsModuleFlag(value) && exportsReady(value, ["CommentHandler"]); }
function initialize() {
const exports: {__esModule?:true; "CommentHandler"?: typeof CommentHandler;} = {};
cache = exports;


	"use strict";
	Object.defineProperty(exports, "__esModule", { value: true });
	var syntax_1 = load2();
	class CommentHandler {
declare attach: boolean;
declare comments: Comment[];
declare stack: NodeInfo[];
declare leading: Entry[];
declare trailing: Entry[];
constructor() {
	        this.attach = false;
	        this.comments = [];
	        this.stack = [];
	        this.leading = [];
	        this.trailing = [];
	    }
insertInnerComments(node: BaseNode, metadata: Metadata) {
	        //  innnerComments for properties empty block
	        //  `function a() {/** comments **\/}`
	        if (node.type === syntax_1.Syntax.BlockStatement && commentBody(node).length === 0) {
	            var innerComments: AttachedComment[] = [];
	            for (var i = this.leading.length - 1; i >= 0; --i) {
	                var entry: NodeInfo | Entry = this.leading[i];
	                if (metadata.end.offset >= entry.start) {
	                    innerComments.unshift(entry.comment);
	                    this.leading.splice(i, 1);
	                    this.trailing.splice(i, 1);
	                }
	            }
	            if (innerComments.length) {
	                node.innerComments = innerComments;
	            }
	        }
	    }
findTrailingComments(metadata: Metadata) {
	        var trailingComments: AttachedComment[] = [];
	        if (this.trailing.length > 0) {
	            for (var i = this.trailing.length - 1; i >= 0; --i) {
	                var entry_1 = this.trailing[i];
	                if (entry_1.start >= metadata.end.offset) {
	                    trailingComments.unshift(entry_1.comment);
	                }
	            }
	            this.trailing.length = 0;
	            return trailingComments;
	        }
	        var entry: NodeInfo | Entry = this.stack[this.stack.length - 1];
	        if (entry && entry.node.trailingComments) {
	            var firstComment = entry.node.trailingComments[0];
	            if (firstComment && firstComment.range[0] >= metadata.end.offset) {
	                trailingComments = entry.node.trailingComments;
	                delete entry.node.trailingComments;
	            }
	        }
	        return trailingComments;
	    }
findLeadingComments(metadata: Metadata) {
	        var leadingComments: AttachedComment[] = [];
	        var target: BaseNode | undefined;
	        while (this.stack.length > 0) {
	            var entry: NodeInfo | Entry = this.stack[this.stack.length - 1];
	            if (entry && entry.start >= metadata.start.offset) {
	                target = entry.node;
	                this.stack.pop();
	            }
	            else {
	                break;
	            }
	        }
	        if (target) {
	            var count = target.leadingComments ? target.leadingComments.length : 0;
	            for (var i = count - 1; i >= 0; --i) {
	                var comment = target.leadingComments![i];
	                if (comment.range[1] <= metadata.start.offset) {
	                    leadingComments.unshift(comment);
	                    target.leadingComments!.splice(i, 1);
	                }
	            }
	            if (target.leadingComments && target.leadingComments.length === 0) {
	                delete target.leadingComments;
	            }
	            return leadingComments;
	        }
	        for (var i = this.leading.length - 1; i >= 0; --i) {
	            var entry: NodeInfo | Entry = this.leading[i];
	            if (entry.start <= metadata.start.offset) {
	                leadingComments.unshift(entry.comment);
	                this.leading.splice(i, 1);
	            }
	        }
	        return leadingComments;
	    }
visitNode(node: BaseNode, metadata: Metadata) {
	        if (node.type === syntax_1.Syntax.Program && commentBody(node).length > 0) {
	            return;
	        }
	        this.insertInnerComments(node, metadata);
	        var trailingComments = this.findTrailingComments(metadata);
	        var leadingComments = this.findLeadingComments(metadata);
	        if (leadingComments.length > 0) {
	            node.leadingComments = leadingComments;
	        }
	        if (trailingComments.length > 0) {
	            node.trailingComments = trailingComments;
	        }
	        this.stack.push({
	            node: node,
	            start: metadata.start.offset
	        });
	    }
visitComment(node: Comment, metadata: Metadata) {
	        var type = (node.type[0] === 'L') ? 'Line' : 'Block';
	        var comment: Comment = {
	            type: type,
	            value: node.value
	        };
	        if (node.range) {
	            comment.range = node.range;
	        }
	        if (node.loc) {
	            comment.loc = node.loc;
	        }
	        this.comments.push(comment);
	        if (this.attach) {
	            var entry: Entry = {
	                comment: {
	                    type: type,
	                    value: node.value,
	                    range: [metadata.start.offset, metadata.end.offset]
	                },
	                start: metadata.start.offset
	            };
	            if (node.loc) {
	                entry.comment.loc = node.loc;
	            }
	            node.type = type;
	            this.leading.push(entry);
	            this.trailing.push(entry);
	        }
	    }
visit(node: BaseNode, metadata: Metadata) {
	        if (node.type === 'LineComment') {
	            this.visitComment(commentValue(node), metadata);
	        }
	        else if (node.type === 'BlockComment') {
	            this.visitComment(commentValue(node), metadata);
	        }
	        else if (this.attach) {
	            this.visitNode(node, metadata);
	        }
	    }
}
	exports.CommentHandler = CommentHandler;


/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected Esprima module flag");
if (!exportsReady(exports, ["CommentHandler"])) throw new TypeError("Incomplete Esprima exports");
return exports;
}

function commentBody(node: BaseNode): unknown[] {
    const body = readProperty(node, "body");
    if (Array.isArray(body)) return body;
    throw new TypeError("Expected an Esprima statement body");
}
function isComment(node: BaseNode): node is Comment {
    return "value" in node && typeof node.value === "string";
}
function commentValue(node: BaseNode): Comment {
    if (isComment(node)) return node;
    throw new TypeError("Expected an Esprima comment");
}
