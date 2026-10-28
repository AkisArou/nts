import type {Options} from "../../../types/recast/lib/options.js";
import type {Lines} from "../../../types/recast/lib/lines.js";
import {sourceLocation, sourceToken, type SourceLocation} from "../../../types/recast/runtime-ast.ts";
// Exact module body from JetStream 3.0 ./node_modules/recast/lib/parser.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record} from "../../../webpack.ts";
import {load as load0} from "../../tslib/tslib.es6.ts";
import {load as load1} from "../../tiny-invariant/dist/tiny-invariant.cjs.ts";
import {load as load2} from "../../ast-types/lib/main.ts";
import {load as load3} from "./options.ts";
import {load as load4} from "./lines.ts";
import {load as load5} from "./comments.ts";
import {load as load6} from "./util.ts";
import {load as load7} from "../../esprima/dist/esprima.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast/lib/parser.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","parse"]);
}
function initialize() {
interface TreeCopierType {
  lines: Lines;
  tokens: unknown[];
  startTokenIndex: number;
  endTokenIndex: number;
  indent: number;
  seen: Map<unknown, unknown>;
  copy(node: unknown): unknown;
  findTokenRange(loc: SourceLocation): void;
}
interface TreeCopierConstructor {
  new (lines: Lines, tokens: unknown[]): TreeCopierType;
}

const exports: { __esModule?: true; "parse"?: typeof parse; } = {};
let module = {exports};
cache = module;


"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.parse = void 0;
var tslib_1 = load0();
var tiny_invariant_1: {default: (condition: unknown, message?: string | (() => string)) => void} = tslib_1.__importDefault(load1());
var types = tslib_1.__importStar(load2());
var b = types.builders;
var isObject = types.builtInTypes.object;
var isArray = types.builtInTypes.array;
var options_1 = load3();
var lines_1 = load4();
var comments_1 = load5();
var util = tslib_1.__importStar(load6());
function parse(source: string, options?: Partial<Options>) {
    options = (0, options_1.normalize)(options);
    var lines = (0, lines_1.fromString)(source, options);
    var sourceWithoutTabs = lines.toString({
        tabWidth: options.tabWidth,
        reuseWhitespace: false,
        useTabs: false,
    });
    var comments: unknown[] = [];
    var ast = parserRoot(parserObject(options.parser).parse(sourceWithoutTabs, {
        jsx: true,
        loc: true,
        locations: true,
        range: options.range,
        comment: true,
        onComment: comments,
        tolerant: util.getOption(options, "tolerant", true),
        ecmaVersion: 6,
        sourceType: util.getOption(options, "sourceType", "module"),
    }));
    // Use ast.tokens if possible, and otherwise fall back to the Esprima
    // tokenizer. All the preconfigured ../parsers/* expose ast.tokens
    // automatically, but custom parsers might need additional configuration
    // to avoid this fallback.
    var tokens: unknown[] = Array.isArray(ast.tokens)
        ? ast.tokens
        : (load7().tokenize)(sourceWithoutTabs, {
            loc: true,
        });
    // We will reattach the tokens array to the file object below.
    delete ast.tokens;
    // Make sure every token has a token.value string.
    tokens.forEach(function (token) {
        if (typeof sourceToken(token).value !== "string") {
            sourceToken(token).value = lines.sliceString(sourceToken(token).loc.start, sourceToken(token).loc.end);
        }
    });
    if (Array.isArray(ast.comments)) {
        comments = ast.comments;
        delete ast.comments;
    }
    if (ast.loc) {
        // If the source was empty, some parsers give loc.{start,end}.line
        // values of 0, instead of the minimum of 1.
        util.fixFaultyLocations(ast, lines);
    }
    else {
        ast.loc = {
            start: lines.firstPos(),
            end: lines.lastPos(),
        };
    }
    sourceLocation(ast.loc).lines = lines;
    sourceLocation(ast.loc).indent = 0;
    var file: ParserFile | undefined;
    var program: ParserProgram | undefined;
    if (ast.type === "Program") {
        program = ast;
        // In order to ensure we reprint leading and trailing program
        // comments, wrap the original Program node with a File node. Only
        // ESTree parsers (Acorn and Esprima) return a Program as the root AST
        // node. Most other (Babylon-like) parsers return a File.
        file = parserFile(b.file(ast, options.sourceFileName || null));
        file.loc = {
            start: lines.firstPos(),
            end: lines.lastPos(),
            lines: lines,
            indent: 0,
        };
    }
    else if (ast.type === "File") {
        file = ast;
        program = file.program;
    }
    // Expose file.tokens unless the caller passed false for options.tokens.
    if (options.tokens) {
        file!.tokens = tokens;
    }
    // Expand the Program's .loc to include all comments (not just those
    // attached to the Program node, as its children may have comments as
    // well), since sometimes program.loc.{start,end} will coincide with the
    // .loc.{start,end} of the first and last *statements*, mistakenly
    // excluding comments that fall outside that region.
    var trueProgramLoc = util.getTrueLoc({
        type: program!.type,
        loc: program!.loc,
        body: [],
        comments: comments,
    }, lines);
    sourceLocation(program!.loc).start = trueProgramLoc!.start;
    sourceLocation(program!.loc).end = trueProgramLoc!.end;
    // Passing file.program here instead of just file means that initial
    // comments will be attached to program.body[0] instead of program.
    (0, comments_1.attach)(comments, program!.body.length ? file!.program : file, lines);
    // Return a copy of the original AST so that any changes made may be
    // compared to the original.
    return new TreeCopier(lines, tokens).copy(file);
}
exports.parse = parse;
interface ParserProgram extends Record<PropertyKey, unknown> { type: "Program"; body: unknown[]; }
interface ParserFile extends Record<PropertyKey, unknown> { type: "File"; program: ParserProgram; }
function isParserProgram(value: unknown): value is ParserProgram {
    return isRecord(value) && value.type === "Program" && Array.isArray(value.body);
}
function isParserFile(value: unknown): value is ParserFile {
    return isRecord(value) && value.type === "File" && isParserProgram(value.program);
}
function parserRoot(value: unknown): ParserProgram | ParserFile {
    if (isParserProgram(value) || isParserFile(value)) return value;
    throw new TypeError("Expected parser Program or File root");
}
function parserFile(value: unknown): ParserFile {
    if (isParserFile(value)) return value;
    throw new TypeError("Expected parser File root");
}
interface ParserObject { parse(source: string, options: Record<string, unknown>): unknown; }
function parserObject(value: unknown): ParserObject {
    if (isParserObject(value)) return value;
    throw new TypeError("Expected original parser object");
}
function isParserObject(value: unknown): value is ParserObject {
    return isRecord(value) && typeof value.parse === "function";
}

class TreeCopier {
declare lines: Lines;
declare tokens: unknown[];
declare startTokenIndex: number;
declare endTokenIndex: number;
declare indent: number;
declare seen: Map<unknown, unknown>;
declare copy: (node: unknown) => unknown;
declare findTokenRange: (loc: SourceLocation) => void;

constructor(lines: Lines, tokens: unknown[]) {
    (0, tiny_invariant_1.default)(this instanceof TreeCopier);
    this.lines = lines;
    this.tokens = tokens;
    this.startTokenIndex = 0;
    this.endTokenIndex = tokens.length;
    this.indent = 0;
    this.seen = new Map<unknown, unknown>();
}
}
var TCp: TreeCopierType = TreeCopier.prototype;
TCp.copy = function (node) {
    if (this.seen.has(node)) {
        return this.seen.get(node);
    }
    if (isArray.check(node)) {
        var copy_1 = new Array<unknown>(node.length);
        this.seen.set(node, copy_1);
        node.forEach(function (this: TreeCopierType, item, i) {
            copy_1[i] = this.copy(item);
        }, this);
        return copy_1;
    }
    if (!isObject.check(node)) {
        return node;
    }
    util.fixFaultyLocations(node, this.lines);
    var copy = record(Object.create(Object.getPrototypeOf(node), {
        original: {
            // Provide a link from the copy to the original.
            value: node,
            configurable: false,
            enumerable: false,
            writable: true,
        },
    }));
    this.seen.set(node, copy);
    var loc = node.loc;
    var oldIndent = this.indent;
    var newIndent = oldIndent;
    var oldStartTokenIndex = this.startTokenIndex;
    var oldEndTokenIndex = this.endTokenIndex;
    if (loc) {
        // When node is a comment, we set node.loc.indent to
        // node.loc.start.column so that, when/if we print the comment by
        // itself, we can strip that much whitespace from the left margin of
        // the comment. This only really matters for multiline Block comments,
        // but it doesn't hurt for Line comments.
        if (node.type === "Block" ||
            node.type === "Line" ||
            node.type === "CommentBlock" ||
            node.type === "CommentLine" ||
            this.lines.isPrecededOnlyByWhitespace(sourceLocation(loc).start)) {
            newIndent = this.indent = sourceLocation(loc).start.column;
        }
        // Every node.loc has a reference to the original source lines as well
        // as a complete list of source tokens.
        sourceLocation(loc).lines = this.lines;
        sourceLocation(loc).tokens = this.tokens;
        sourceLocation(loc).indent = newIndent;
        // Set loc.start.token and loc.end.token such that
        // loc.tokens.slice(loc.start.token, loc.end.token) returns a list of
        // all the tokens that make up this node.
        this.findTokenRange(sourceLocation(loc));
    }
    var keys = Object.keys(node);
    var keyCount = keys.length;
    for (var i = 0; i < keyCount; ++i) {
        var key = keys[i];
        if (key === "loc") {
            copy[key] = node[key];
        }
        else if (key === "tokens" && node.type === "File") {
            // Preserve file.tokens (uncopied) in case client code cares about
            // it, even though Recast ignores it when reprinting.
            copy[key] = node[key];
        }
        else {
            copy[key] = this.copy(node[key]);
        }
    }
    this.indent = oldIndent;
    this.startTokenIndex = oldStartTokenIndex;
    this.endTokenIndex = oldEndTokenIndex;
    return copy;
};
// If we didn't have any idea where in loc.tokens to look for tokens
// contained by this loc, a binary search would be appropriate, but
// because we maintain this.startTokenIndex and this.endTokenIndex as we
// traverse the AST, we only need to make small (linear) adjustments to
// those indexes with each recursive iteration.
TCp.findTokenRange = function (loc) {
    // In the unlikely event that loc.tokens![this.startTokenIndex] starts
    // *after* loc.start, we need to rewind this.startTokenIndex first.
    while (this.startTokenIndex > 0) {
        var token = loc.tokens![this.startTokenIndex];
        if (util.comparePos(loc.start, sourceToken(token).loc.start) < 0) {
            --this.startTokenIndex;
        }
        else
            break;
    }
    // In the unlikely event that loc.tokens![this.endTokenIndex - 1] ends
    // *before* loc.end, we need to fast-forward this.endTokenIndex first.
    while (this.endTokenIndex < loc.tokens!.length) {
        var token = loc.tokens![this.endTokenIndex];
        if (util.comparePos(sourceToken(token).loc.end, loc.end) < 0) {
            ++this.endTokenIndex;
        }
        else
            break;
    }
    // Increment this.startTokenIndex until we've found the first token
    // contained by this node.
    while (this.startTokenIndex < this.endTokenIndex) {
        var token = loc.tokens![this.startTokenIndex];
        if (util.comparePos(sourceToken(token).loc.start, loc.start) < 0) {
            ++this.startTokenIndex;
        }
        else
            break;
    }
    // Index into loc.tokens of the first token within this node.
    loc.start.token = this.startTokenIndex;
    // Decrement this.endTokenIndex until we've found the first token after
    // this node (not contained by the node).
    while (this.endTokenIndex > this.startTokenIndex) {
        var token = loc.tokens![this.endTokenIndex - 1];
        if (util.comparePos(loc.end, sourceToken(token).loc.end) < 0) {
            --this.endTokenIndex;
        }
        else
            break;
    }
    // Index into loc.tokens of the first token *after* this node.
    // If loc.start.token === loc.end.token, the node contains no tokens,
    // and the index is that of the next token following this node.
    loc.end.token = this.endTokenIndex;
};


/***/ 
if (!exportsReady(exports, ["__esModule","parse"])) throw new TypeError("Incomplete original module exports");
return exports;
}
