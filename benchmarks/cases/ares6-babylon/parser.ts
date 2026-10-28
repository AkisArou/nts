/*
 * Copyright (C) 2012-2014 by various contributors (see AUTHORS)
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
*/

// Transcribed from WebKit ARES-6 Babylon/index.js at revision
// b64265f153b3178bfb4ca9f51736289f57982fce.
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Babylon/index.js
// All grammar, identifier tables, tokenization, and plugin implementations retained.
// Prototype installation becomes declared class methods; per-instance plugins retain their wrapping.

// Nodes are built incrementally, as in upstream. These declarations describe
// the unions present in the completed AST; checked readers below narrow fields
// where a grammar production establishes their concrete shape.
export interface RegExpValue { pattern: string; flags: string; value?: NodeValue; }
interface TemplateValue { raw: string; cooked: NodeValue; }
export type NodeValue = string | number | boolean | null | undefined | Node | RegExp | RegExpValue | TemplateValue;
interface NodeExtra { [key: string]: NodeValue; raw?: string; rawValue?: NodeValue; parenthesized?: boolean; parenStart?: number; }
interface TokenConfiguration { keyword?: string; beforeExpr?: boolean; startsExpr?: boolean; rightAssociative?: boolean; isLoop?: boolean; isAssign?: boolean; prefix?: boolean; postfix?: boolean; binop?: number; }
interface Label { kind?: string | null; name?: string; statementStart?: number; }
interface Comment { type: string; value: string; start: number; end: number; loc: SourceLocation; }
interface StartReference { start: number; }
interface FunctionTypeParameters { params: (Node | null)[]; rest: Node | null; }
export class ParserOptions {
  [key: string]: unknown;
  declare sourceType: string;
  declare sourceFilename: string | undefined;
  declare startLine: number;
  declare allowReturnOutsideFunction: boolean;
  declare allowImportExportEverywhere: boolean;
  declare allowSuperOutsideMethod: boolean;
  declare plugins: string[];
  declare strictMode: boolean | null;
  declare ranges: boolean;
}
interface PositionedSyntaxError extends SyntaxError { pos?: number; loc?: Position; }



function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new TypeError("Missing Babylon parser value");
  return value;
}
function nodeValue(value: unknown): Node {
  if (!(value instanceof Node)) throw new TypeError("Expected Babylon syntax node");
  return value;
}
function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected Babylon token string");
  return value;
}
function numberValue(value: unknown): number {
  if (typeof value !== "number") throw new TypeError("Expected Babylon token number");
  return value;
}
function nodeArray(value: Node | Node[]): Node[] {
  if (!Array.isArray(value)) throw new TypeError("Expected Babylon syntax node array");
  return value;
}
function regexpValue(value: NodeValue): RegExpValue {
  if (value !== null && typeof value === "object" && "pattern" in value && typeof value.pattern === "string" && "flags" in value && typeof value.flags === "string") return value;
  throw new TypeError("Expected Babylon regexp token");
}
function removeField<K extends string>(object: { [P in K]?: unknown }, key: K): void {
  delete object[key];
}

class Position {
  declare line: number;
  declare column: number;

      constructor(line: number, col: number) {
        this.line = line;
        this.column = col;
      }
    }

class SourceLocation {
  declare start: Position | SourceLocation;
  declare end: Position | SourceLocation | null | undefined;
  declare filename?: string;
  declare identifierName?: string | Node | null;

      constructor(start: Position | SourceLocation, end?: Position | null) {
        this.start = start;
        this.end = end;
      }
    }

class TokenType {
  declare label: string;
  declare keyword: string | undefined;
  declare beforeExpr: boolean;
  declare startsExpr: boolean;
  declare rightAssociative: boolean;
  declare isLoop: boolean;
  declare isAssign: boolean;
  declare prefix: boolean;
  declare postfix: boolean;
  declare binop: number | null;
  declare updateContext: ((this: Parser, previous: TokenType) => void) | null;

      constructor(label: string, conf: TokenConfiguration = {}) {
        this.label = label;
        this.keyword = conf.keyword;
        this.beforeExpr = !!conf.beforeExpr;
        this.startsExpr = !!conf.startsExpr;
        this.rightAssociative = !!conf.rightAssociative;
        this.isLoop = !!conf.isLoop;
        this.isAssign = !!conf.isAssign;
        this.prefix = !!conf.prefix;
        this.postfix = !!conf.postfix;
        this.binop = conf.binop || null;
        this.updateContext = null;
      }
    }

class KeywordTokenType extends TokenType {
      constructor(name: string, options: TokenConfiguration = {}) {
        options.keyword = name;

        super(name, options);
      }
    }

class BinopTokenType extends TokenType {
      constructor(name: string, prec: number) {
        super(name, { beforeExpr, binop: prec });
      }
    }

class TokContext {
  declare token: string;
  declare isExpr: boolean;
  declare preserveSpace: boolean;
  declare override: ((parser: Parser) => void) | undefined;

      constructor(token: string, isExpr: boolean, preserveSpace?: boolean, override?: (parser: Parser) => void) {
        this.token = token;
        this.isExpr = !!isExpr;
        this.preserveSpace = !!preserveSpace;
        this.override = override;
      }

      //token: string;
      //isExpr: boolean;
      //preserveSpace: boolean;
      //override: ?Function;
    }

class State {
  [key: string]: unknown;
  declare strict: boolean;
  declare input: string;
  declare potentialArrowAt: number;
  declare inMethod: boolean | string | undefined;
  declare inFunction: boolean | undefined;
  declare inGenerator: boolean | undefined;
  declare inAsync: boolean | undefined;
  declare inPropertyName: boolean | undefined;
  declare inType: boolean;
  declare noAnonFunctionType: boolean;
  declare labels: Label[];
  declare decorators: Node[];
  declare tokens: (Token | Comment)[];
  declare comments: Comment[];
  declare trailingComments: Comment[];
  declare leadingComments: Comment[];
  declare commentStack: Node[];
  declare pos: number;
  declare lineStart: number;
  declare curLine: number;
  declare type: TokenType;
  declare value: NodeValue;
  declare start: number;
  declare end: number;
  declare startLoc: Position;
  declare endLoc: Position;
  declare lastTokEndLoc: Position | null;
  declare lastTokStartLoc: Position | null;
  declare lastTokStart: number;
  declare lastTokEnd: number;
  declare context: TokContext[];
  declare exprAllowed: boolean;
  declare containsEsc: boolean;
  declare containsOctal: boolean;
  declare octalPosition: number | null;
  declare invalidTemplateEscapePosition: number | null;
  declare exportedIdentifiers: string[];
  declare commentPreviousNode: Node | undefined;

      init(options: ParserOptions, input: string): State {
        this.strict = options.strictMode === false ? false : options.sourceType === "module";

        this.input = input;

        this.potentialArrowAt = -1;

        this.inMethod =
          this.inFunction =
          this.inGenerator =
          this.inAsync =
          this.inPropertyName =
          this.inType =
          this.noAnonFunctionType =
            false;

        this.labels = [];

        this.decorators = [];

        this.tokens = [];

        this.comments = [];

        this.trailingComments = [];
        this.leadingComments  = [];
        this.commentStack     = [];

        this.pos = this.lineStart = 0;
        this.curLine = options.startLine;

        this.type = tt.eof;
        this.value = null;
        this.start = this.end = this.pos;
        this.startLoc = this.endLoc = this.curPosition();

        this.lastTokEndLoc = this.lastTokStartLoc = null;
        this.lastTokStart = this.lastTokEnd = this.pos;

        this.context = [ct.braceStatement];
        this.exprAllowed = true;

        this.containsEsc = this.containsOctal = false;
        this.octalPosition = null;

        this.invalidTemplateEscapePosition = null;

        this.exportedIdentifiers = [];

        return this;
      }

      //// TODO
      //strict: boolean;

      //// TODO
      //input: string;

      //// Used to signify the start of a potential arrow function
      //potentialArrowAt: number;

      //// Flags to track whether we are in a function, a generator.
      //inFunction: boolean;
      //inGenerator: boolean;
      //inMethod: boolean;
      //inAsync: boolean;
      //inType: boolean;
      //inPropertyName: boolean;

      //// Labels in scope.
      //labels: Array<Object>;

      //// Leading decorators.
      //decorators: Array<Object>;

      //// Token store.
      //tokens: Array<Object>;

      //// Comment store.
      //comments: Array<Object>;

      //// Comment attachment store
      //trailingComments: Array<Object>;
      //leadingComments: Array<Object>;
      //commentStack: Array<Object>;

      //// The current position of the tokenizer in the input.
      //pos: number;
      //lineStart: number;
      //curLine: number;

      //// Properties of the current token:
      //// Its type
      //type: TokenType;

      //// For tokens that include more information than their type, the value
      //value: any;

      //// Its start and end offset
      //start: number;
      //end: number;

      //// And, if locations are used, the {line, column} object
      //// corresponding to those offsets
      //startLoc: Position | SourceLocation;
      //endLoc: Position;

      //// Position information for the previous token
      //lastTokEndLoc: ?Position;
      //lastTokStartLoc: ?Position;
      //lastTokStart: number;
      //lastTokEnd: number;

      //// The context stack is used to superficially track syntactic
      //// context to predict whether a regular expression is allowed in a
      //// given position.
      //context: Array<TokContext>;
      //exprAllowed: boolean;

      //// Used to signal to callers of `readWord1` whether the word
      //// contained any escape sequences. This is needed because words with
      //// escape sequences must not be interpreted as keywords.
      //containsEsc: boolean;

      //// TODO
      //containsOctal: boolean;
      //octalPosition: ?number;

      //// Names of exports store. `default` is stored as a name for both
      //// `export default foo;` and `export { foo as default };`.
      //exportedIdentifiers: Array<string>;

      curPosition(): Position {
        return new Position(this.curLine, this.pos - this.lineStart);
      }

      clone(skipArrays?: boolean | undefined): State {
        const state = new State;
        for (const key in this) {
          let val: unknown = this[key];

          if ((!skipArrays || key === "context") && Array.isArray(val)) {
            val = val.slice();
          }

          state[key] = val;
        }
        return state;
      }
    }

class Token {
  declare type: TokenType;
  declare value: NodeValue;
  declare start: number;
  declare end: number;
  declare loc: SourceLocation;

      constructor(state: State) {
        this.type = state.type;
        this.value = state.value;
        this.start = state.start;
        this.end = state.end;
        this.loc = new SourceLocation(state.startLoc, state.endLoc);
      }
    }

export class Node {
  [key: string]: unknown;
  declare type: string;
  declare start: number;
  declare end: number;
  declare loc: SourceLocation;
  declare range: number[];
  declare body: Node | Node[];
  declare value: NodeValue;
  declare expression: Node | boolean | null;
  declare extra: NodeExtra | null;
  declare leadingComments: Comment[] | null;
  declare trailingComments: Comment[] | null;
  declare innerComments: Comment[] | null;
  declare comments: Comment[];
  declare tokens: (Token | Comment)[];
  declare name: string | Node | null;
  declare kind: string | undefined;
  declare operator: string;
  declare directive: string;
  declare sourceType: string;
  declare exportKind: string;
  declare importKind: string | null;
  declare raw: string;
  declare pattern: string;
  declare flags: string;
  declare regex: RegExpValue;
  declare computed: boolean | undefined;
  declare async: boolean | undefined;
  declare await: boolean | undefined;
  declare generator: boolean | undefined;
  declare delegate: boolean | undefined;
  declare prefix: boolean;
  declare method: boolean;
  declare optional: boolean;
  declare selfClosing: boolean | undefined;
  declare shorthand: boolean;
  declare static: boolean | undefined;
  declare _exprListItem: boolean;
  declare tail: boolean;
  declare arguments: (Node | null)[];
  declare attributes: Node[];
  declare cases: Node[];
  declare children: Node[];
  declare declarations: Node[];
  declare decorators: Node[];
  declare directives: Node[];
  declare elements: (Node | null)[];
  declare expressions: Node[];
  declare extends: Node[];
  declare guardedHandlers: Node[];
  declare implements: Node[];
  declare mixins: Node[];
  declare params: (Node | null)[];
  declare properties: Node[];
  declare quasis: Node[];
  declare specifiers: Node[];
  declare types: Node[];
  declare argument: Node | null;
  declare alternate: Node | null;
  declare block: Node;
  declare bound: Node | null;
  declare callee: Node;
  declare closingElement: Node | null;
  declare declaration: Node | null;
  declare discriminant: Node;
  declare elementType: Node;
  declare exported: Node;
  declare finalizer: Node | null;
  declare handler: Node | null;
  declare id: Node | null;
  declare imported: Node;
  declare init: Node | null;
  declare key: Node;
  declare label: Node | null;
  declare left: Node;
  declare local: Node;
  declare meta: Node;
  declare namespace: Node;
  declare object: Node | null;
  declare openingElement: Node;
  declare predicate: Node | null;
  declare program: Node;
  declare property: Node;
  declare quasi: Node;
  declare rest: Node | null;
  declare returnType: Node | null;
  declare right: Node;
  declare source: Node | null;
  declare superClass: Node | null;
  declare superTypeParameters: Node;
  declare tag: Node;
  declare test: Node | null;
  declare typeAnnotation: Node | null;
  declare typeParameters: Node | null;
  declare update: Node | null;
  declare variance: Node | null;
  declare consequent: Node | Node[];
  declare indexers: Node[];
  declare callProperties: Node[];
  declare param: Node;
  declare exact: boolean | undefined;

      constructor(parser: Parser | undefined, pos: number, loc: Position | SourceLocation) {
        this.type = "";
        this.start = pos;
        this.end = 0;
        this.loc = new SourceLocation(loc);
        if (parser && parser.options.ranges) this.range = [pos, 0];
        if (parser && parser.filename) this.loc.filename = parser.filename;
      }

      //type: string;
      //start: ?number;
      //end: number;
      //loc: SourceLocation;

      __clone(): Node{
        const node2 = new Node(undefined, this.start, this.loc.start);
        for (const key in this) {
          // Do not clone comments that are already attached to the node
          if (commentKeys.indexOf(key) < 0) {
            node2[key] = this[key];
          }
        }

        return node2;
      }
    }

// utilIdentifierJS
function makePredicate(wordList: string): (str: string) => boolean {
      const words = wordList.split(" ");
      return function (str: string): boolean {
        return words.indexOf(str) >= 0;
      };
    }

const reservedWords = {
      6: makePredicate("enum await"),
      strict: makePredicate("implements interface let package private protected public static yield"),
      strictBind: makePredicate("eval arguments")
    };

const isKeyword = makePredicate("break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this let const class extends export import yield super");

let nonASCIIidentifierStartChars: string | null = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u08a0-\u08b4\u08b6-\u08bd\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0af9\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c60\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1877\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c88\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2118-\u211d\u2124\u2126\u2128\u212a-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309b-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fd5\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7ae\ua7b0-\ua7b7\ua7f7-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab65\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";

let nonASCIIidentifierChars: string | null = "\u200c\u200d\xb7\u0300-\u036f\u0387\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u0669\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u06f0-\u06f9\u0711\u0730-\u074a\u07a6-\u07b0\u07c0-\u07c9\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d4-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u09e6-\u09ef\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c00-\u0c03\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c66-\u0c6f\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0ce6-\u0cef\u0d01-\u0d03\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62\u0d63\u0d66-\u0d6f\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0de6-\u0def\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0e50-\u0e59\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1040-\u1049\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u1369-\u1371\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u18a9\u1920-\u192b\u1930-\u193b\u1946-\u194f\u19d0-\u19da\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1ab0-\u1abd\u1b00-\u1b04\u1b34-\u1b44\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1bb0-\u1bb9\u1be6-\u1bf3\u1c24-\u1c37\u1c40-\u1c49\u1c50-\u1c59\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf2-\u1cf4\u1cf8\u1cf9\u1dc0-\u1df5\u1dfb-\u1dff\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua620-\ua629\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua880\ua881\ua8b4-\ua8c5\ua8d0-\ua8d9\ua8e0-\ua8f1\ua900-\ua909\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9d0-\ua9d9\ua9e5\ua9f0-\ua9f9\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaa50-\uaa59\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaeb-\uaaef\uaaf5\uaaf6\uabe3-\uabea\uabec\uabed\uabf0-\uabf9\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";

const nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");

const nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");

nonASCIIidentifierStartChars = nonASCIIidentifierChars = null;

const astralIdentifierStartCodes = [0,11,2,25,2,18,2,1,2,14,3,13,35,122,70,52,268,28,4,48,48,31,17,26,6,37,11,29,3,35,5,7,2,4,43,157,19,35,5,35,5,39,9,51,157,310,10,21,11,7,153,5,3,0,2,43,2,1,4,0,3,22,11,22,10,30,66,18,2,1,11,21,11,25,71,55,7,1,65,0,16,3,2,2,2,26,45,28,4,28,36,7,2,27,28,53,11,21,11,18,14,17,111,72,56,50,14,50,785,52,76,44,33,24,27,35,42,34,4,0,13,47,15,3,22,0,2,0,36,17,2,24,85,6,2,0,2,3,2,14,2,9,8,46,39,7,3,1,3,21,2,6,2,1,2,4,4,0,19,0,13,4,159,52,19,3,54,47,21,1,2,0,185,46,42,3,37,47,21,0,60,42,86,25,391,63,32,0,449,56,264,8,2,36,18,0,50,29,881,921,103,110,18,195,2749,1070,4050,582,8634,568,8,30,114,29,19,47,17,3,32,20,6,18,881,68,12,0,67,12,65,0,32,6124,20,754,9486,1,3071,106,6,12,4,8,8,9,5991,84,2,70,2,1,3,0,3,1,3,3,2,11,2,0,2,6,2,64,2,3,3,7,2,6,2,27,2,3,2,4,2,0,4,6,2,339,3,24,2,24,2,30,2,24,2,30,2,24,2,30,2,24,2,30,2,24,2,7,4149,196,60,67,1213,3,2,26,2,1,2,0,3,0,2,9,2,3,2,0,2,0,7,0,5,0,2,0,2,0,2,2,2,1,2,0,3,0,2,0,2,0,2,0,2,0,2,1,2,0,3,3,2,6,2,3,2,3,2,0,2,9,2,16,6,2,2,4,2,16,4421,42710,42,4148,12,221,3,5761,10591,541];

const astralIdentifierCodes = [509,0,227,0,150,4,294,9,1368,2,2,1,6,3,41,2,5,0,166,1,1306,2,54,14,32,9,16,3,46,10,54,9,7,2,37,13,2,9,52,0,13,2,49,13,10,2,4,9,83,11,7,0,161,11,6,9,7,3,57,0,2,6,3,1,3,2,10,0,11,1,3,6,4,4,193,17,10,9,87,19,13,9,214,6,3,8,28,1,83,16,16,9,82,12,9,9,84,14,5,9,423,9,838,7,2,7,17,9,57,21,2,13,19882,9,135,4,60,6,26,9,1016,45,17,3,19723,1,5319,4,4,5,9,7,3,6,31,3,149,2,1418,49,513,54,5,49,9,0,15,0,23,4,2,14,1361,6,2,16,3,6,2,1,2,4,2214,6,110,6,6,9,792487,239];

function isInAstralSet(code: number, set: number[]): boolean | undefined {
      let pos = 0x10000;
      for (let i = 0; i < set.length; i += 2) {
        pos += set[i];
        if (pos > code) return false;

        pos += set[i + 1];
        if (pos >= code) return true;
      }
    }

function isIdentifierStart(code: number): boolean | undefined {
      if (code < 65) return code === 36;
      if (code < 91) return true;
      if (code < 97) return code === 95;
      if (code < 123) return true;
      if (code <= 0xffff) return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code));
      return isInAstralSet(code, astralIdentifierStartCodes);
    }

function isIdentifierChar(code: number, _astral?: boolean): boolean | undefined {
      if (code < 48) return code === 36;
      if (code < 58) return true;
      if (code < 65) return false;
      if (code < 91) return true;
      if (code < 97) return code === 95;
      if (code < 123) return true;
      if (code <= 0xffff) return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code));
      return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
    }

// utilWhitespaceJS
const lineBreak = /\r\n?|\n|\u2028|\u2029/;

const lineBreakG = new RegExp(lineBreak.source, "g");

function isNewLine(code: number): boolean{
      return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
    }

const nonASCIIwhitespace = /[\u1680\u180e\u2000-\u200a\u202f\u205f\u3000\ufeff]/;

// utilLocationJS
function getLineInfo(input: string, offset: number): Position {
      for (let line = 1, cur = 0; ;) {
        lineBreakG.lastIndex = cur;
        const match = lineBreakG.exec(input);
        if (match && match.index < offset) {
          ++line;
          cur = match.index + match[0].length;
        } else {
          return new Position(line, offset - cur);
        }
      }
    }

// tokenizerTypesJS
const beforeExpr = true;

const startsExpr = true;

const isLoop = true;

const isAssign = true;

const prefix = true;

const postfix = true;

const tt: Record<string, TokenType> = {
      num: new TokenType("num", { startsExpr }),
      regexp: new TokenType("regexp", { startsExpr }),
      string: new TokenType("string", { startsExpr }),
      name: new TokenType("name", { startsExpr }),
      eof: new TokenType("eof"),

      // Punctuation token tt.
      bracketL: new TokenType("[", { beforeExpr, startsExpr }),
      bracketR: new TokenType("]"),
      braceL: new TokenType("{", { beforeExpr, startsExpr }),
      braceBarL: new TokenType("{|", { beforeExpr, startsExpr }),
      braceR: new TokenType("}"),
      braceBarR: new TokenType("|}"),
      parenL: new TokenType("(", { beforeExpr, startsExpr }),
      parenR: new TokenType(")"),
      comma: new TokenType(",", { beforeExpr }),
      semi: new TokenType(";", { beforeExpr }),
      colon: new TokenType(":", { beforeExpr }),
      doubleColon: new TokenType("::", { beforeExpr }),
      dot: new TokenType("."),
      question: new TokenType("?", { beforeExpr }),
      arrow: new TokenType("=>", { beforeExpr }),
      template: new TokenType("template"),
      ellipsis: new TokenType("...", { beforeExpr }),
      backQuote: new TokenType("`", { startsExpr }),
      dollarBraceL: new TokenType("${", { beforeExpr, startsExpr }),
      at: new TokenType("@"),

      // Operators. These carry several kinds of properties to help the
      // parser use them properly (the presence of these properties is
      // what categorizes them as operators).
      //
      // `binop`, when present, specifies that this operator is a binary
      // operator, and will refer to its precedence.
      //
      // `prefix` and `postfix` mark the operator as a prefix or postfix
      // unary operator.
      //
      // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
      // binary operators with a very low precedence, that should result
      // in AssignmentExpression nodes.

      eq: new TokenType("=", { beforeExpr, isAssign }),
      assign: new TokenType("_=", { beforeExpr, isAssign }),
      incDec: new TokenType("++/--", { prefix, postfix, startsExpr }),
      prefix: new TokenType("prefix", { beforeExpr, prefix, startsExpr }),
      logicalOR: new BinopTokenType("||", 1),
      logicalAND: new BinopTokenType("&&", 2),
      bitwiseOR: new BinopTokenType("|", 3),
      bitwiseXOR: new BinopTokenType("^", 4),
      bitwiseAND: new BinopTokenType("&", 5),
      equality: new BinopTokenType("==/!=", 6),
      relational: new BinopTokenType("</>", 7),
      bitShift: new BinopTokenType("<</>>", 8),
      plusMin: new TokenType("+/-", { beforeExpr, binop: 9, prefix, startsExpr }),
      modulo: new BinopTokenType("%", 10),
      star: new BinopTokenType("*", 10),
      slash: new BinopTokenType("/", 10),
      exponent: new TokenType("**", { beforeExpr, binop: 11, rightAssociative: true })
    };

const keywordTypes: Record<string, TokenType> = {
      "break": new KeywordTokenType("break"),
      "case": new KeywordTokenType("case", { beforeExpr }),
      "catch": new KeywordTokenType("catch"),
      "continue": new KeywordTokenType("continue"),
      "debugger": new KeywordTokenType("debugger"),
      "default": new KeywordTokenType("default", { beforeExpr }),
      "do": new KeywordTokenType("do", { isLoop, beforeExpr }),
      "else": new KeywordTokenType("else", { beforeExpr }),
      "finally": new KeywordTokenType("finally"),
      "for": new KeywordTokenType("for", { isLoop }),
      "function": new KeywordTokenType("function", { startsExpr }),
      "if": new KeywordTokenType("if"),
      "return": new KeywordTokenType("return", { beforeExpr }),
      "switch": new KeywordTokenType("switch"),
      "throw": new KeywordTokenType("throw", { beforeExpr }),
      "try": new KeywordTokenType("try"),
      "var": new KeywordTokenType("var"),
      "let": new KeywordTokenType("let"),
      "const": new KeywordTokenType("const"),
      "while": new KeywordTokenType("while", { isLoop }),
      "with": new KeywordTokenType("with"),
      "new": new KeywordTokenType("new", { beforeExpr, startsExpr }),
      "this": new KeywordTokenType("this", { startsExpr }),
      "super": new KeywordTokenType("super", { startsExpr }),
      "class": new KeywordTokenType("class"),
      "extends": new KeywordTokenType("extends", { beforeExpr }),
      "export": new KeywordTokenType("export"),
      "import": new KeywordTokenType("import", { startsExpr }),
      "yield": new KeywordTokenType("yield", { beforeExpr, startsExpr }),
      "null": new KeywordTokenType("null", { startsExpr }),
      "true": new KeywordTokenType("true", { startsExpr }),
      "false": new KeywordTokenType("false", { startsExpr }),
      "in": new KeywordTokenType("in", { beforeExpr, binop: 7 }),
      "instanceof": new KeywordTokenType("instanceof", { beforeExpr, binop: 7 }),
      "typeof": new KeywordTokenType("typeof", { beforeExpr, prefix, startsExpr }),
      "void": new KeywordTokenType("void", { beforeExpr, prefix, startsExpr }),
      "delete": new KeywordTokenType("delete", { beforeExpr, prefix, startsExpr })
    };

Object.keys(keywordTypes).forEach((name) => {
      tt["_" + name] = keywordTypes[name];
    });

// tokenizerContextJS
const ct: Record<string, TokContext> = {
      braceStatement: new TokContext("{", false),
      braceExpression: new TokContext("{", true),
      templateQuasi: new TokContext("${", true),
      parenStatement: new TokContext("(", false),
      parenExpression: new TokContext("(", true),
      template: new TokContext("`", true, true, (p) => p.readTmplToken()),
      functionExpression: new TokContext("function", true)
    };

tt.parenR.updateContext = tt.braceR.updateContext = function (this: Parser): void {
      if (this.state.context.length === 1) {
        this.state.exprAllowed = true;
        return;
      }

      const out = present(this.state.context.pop());
      if (out === ct.braceStatement && this.curContext() === ct.functionExpression) {
        this.state.context.pop();
        this.state.exprAllowed = false;
      } else if (out === ct.templateQuasi) {
        this.state.exprAllowed = true;
      } else {
        this.state.exprAllowed = !out.isExpr;
      }
    };

tt.name.updateContext = function (this: Parser, prevType: TokenType): void {
      this.state.exprAllowed = false;

      if (prevType === tt._let || prevType === tt._const || prevType === tt._var) {
        if (lineBreak.test(this.input.slice(this.state.end))) {
          this.state.exprAllowed = true;
        }
      }
    };

tt.braceL.updateContext = function (this: Parser, prevType: TokenType): void {
      this.state.context.push(this.braceIsBlock(prevType) ? ct.braceStatement : ct.braceExpression);
      this.state.exprAllowed = true;
    };

tt.dollarBraceL.updateContext = function (this: Parser): void {
      this.state.context.push(ct.templateQuasi);
      this.state.exprAllowed = true;
    };

tt.parenL.updateContext = function (this: Parser, prevType: TokenType): void {
      const statementParens = prevType === tt._if || prevType === tt._for ||
                            prevType === tt._with || prevType === tt._while;
      this.state.context.push(statementParens ? ct.parenStatement : ct.parenExpression);
      this.state.exprAllowed = true;
    };

tt.incDec.updateContext = function (this: Parser): void {
      // tokExprAllowed stays unchanged
    };

tt._function.updateContext = function (this: Parser): void {
      if (this.curContext() !== ct.braceStatement) {
        this.state.context.push(ct.functionExpression);
      }

      this.state.exprAllowed = false;
    };

tt.backQuote.updateContext = function (this: Parser): void {
      if (this.curContext() === ct.template) {
        this.state.context.pop();
      } else {
        this.state.context.push(ct.template);
      }
      this.state.exprAllowed = false;
    };

// tokenizerStateJS


// tokenizerIndexJS
function codePointToString(code: number): string {
      // UTF-16 Decoding
      if (code <= 0xFFFF) {
        return String.fromCharCode(code);
      } else {
        return String.fromCharCode(((code - 0x10000) >> 10) + 0xD800, ((code - 0x10000) & 1023) + 0xDC00);
      }
    }

// optionsJS
const defaultOptions: ParserOptions = {
      // Source type ("script" or "module") for different semantics
      sourceType: "script",
      // Source filename.
      sourceFilename: undefined,
      // Line from which to start counting source. Useful for
      // integration with other tools.
      startLine: 1,
      // When enabled, a return at the top level is not considered an
      // error.
      allowReturnOutsideFunction: false,
      // When enabled, import/export statements are not constrained to
      // appearing at the top of the program.
      allowImportExportEverywhere: false,
      // TODO
      allowSuperOutsideMethod: false,
      // An array of plugins to enable
      plugins: [],
      // TODO
      strictMode: null,
      // Nodes have their start and end characters offsets recorded in
      // `start` and `end` properties (directly on the node, rather than
      // the `loc` object, which holds line/column data. To also add a
      // [semi-standardized][range] `range` property holding a `[start,
      // end]` array with the same numbers, set the `ranges` option to
      // `true`.
      //
      // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
      ranges: false,
    };

function getOptions(opts: Partial<ParserOptions> | undefined): ParserOptions {
      const options = new ParserOptions;
      for (const key in defaultOptions) {
        options[key] = opts && key in opts ? opts[key] : defaultOptions[key];
      }
      return options;
    }

// parserIndexJS
const plugins: Record<string, (instance: Parser) => void> = {};

    /**
     * Based on the comment attachment algorithm used in espree and estraverse.
     *
     * Redistribution and use in source and binary forms, with or without
     * modification, are permitted provided that the following conditions are met:
     *
     * * Redistributions of source code must retain the above copyright
     *   notice, this list of conditions and the following disclaimer.
     * * Redistributions in binary form must reproduce the above copyright
     *   notice, this list of conditions and the following disclaimer in the
     *   documentation and/or other materials provided with the distribution.
     *
     * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
     * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
     * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
     * ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
     * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
     * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
     * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
     * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
     * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
     * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
     */



// parserCommentsJS
function last<T>(stack: T[]): T {
          return stack[stack.length - 1];
        }

// parserExpressionJS


// parserLocationJS


// parserLvalJS


// parserNodeJS
const commentKeys = ["leadingComments", "trailingComments", "innerComments"];

function finishNodeAt(this: Parser, node: Node, type: string, pos: number, loc: Position | SourceLocation | null | undefined): Node {
      node.type = type;
      node.end = pos;
      node.loc.end = loc;
      if (this.options.ranges) node.range[1] = pos;
      this.processComment(node);
      return node;
    }

// parserStatementJS
const loopLabel = { kind: "loop" }, switchLabel = { kind: "switch" };

const empty: Node[] = [];

// parserUtilJS


// pluginsEstreeJS
function isSimpleProperty(node: Node): boolean {
      return node &&
        node.type === "Property" &&
        node.kind === "init" &&
        node.method === false;
    }

function pluginsEstreeJS(instance: Parser): void {
      instance.extend("checkDeclaration", function(inner: Parser["checkDeclaration"]) {
        return function (this: Parser, node: Node): void {
          node = present(node);
          if (isSimpleProperty(node)) {
            this.checkDeclaration(nodeValue(node.value));
          } else {
            inner.call(this, node);
          }
        };
      });

      instance.extend("checkGetterSetterParamCount", function() {
        return function (this: Parser, prop: Node): void {
          const paramCount = prop.kind === "get" ? 0 : 1;
          if (nodeValue(prop.value).params.length !== paramCount) {
            const start = prop.start;
            if (prop.kind === "get") {
              this.raise(start, "getter should have no params");
            } else {
              this.raise(start, "setter should have exactly one param");
            }
          }
        };
      });

      instance.extend("checkLVal", function(inner: Parser["checkLVal"]) {
        return function (this: Parser, expr: Node, isBinding: boolean | undefined, checkClashes: Record<string, boolean> | undefined, ...args: [contextDescription: string]): void {
          switch (expr.type) {
            case "ObjectPattern":
              expr.properties.forEach((prop) => {
                this.checkLVal(
                  prop.type === "Property" ? nodeValue(prop.value) : prop,
                  isBinding,
                  checkClashes,
                  "object destructuring pattern"
                );
              });
              break;
            default:
              inner.call(this, expr, isBinding, checkClashes, ...args);
          }
        };
      });

      instance.extend("checkPropClash", function () {
        return function (this: Parser, prop: Node, propHash: Record<string, boolean>): void {
          if (prop.computed || !isSimpleProperty(prop)) return;

          const key = prop.key;
          // It is either an Identifier or a String/NumericLiteral
          const name = key.type === "Identifier" ? key.name : String(key.value);

          if (name === "__proto__") {
            if (propHash.proto) this.raise(key.start, "Redefinition of __proto__ property");
            propHash.proto = true;
          }
        };
      });

      instance.extend("isStrictBody", function () {
        return function (this: Parser, node: Node, isExpression: boolean | undefined): boolean {
          if (!isExpression && nodeArray(nodeValue(node.body).body).length > 0) {
            for (const directive of (nodeArray(nodeValue(node.body).body))) {
              if (directive.type === "ExpressionStatement" && nodeValue(directive.expression).type === "Literal") {
                if (nodeValue(directive.expression).value === "use strict") return true;
              } else {
                // Break for the first non literal expression
                break;
              }
            }
          }

          return false;
        };
      });

      instance.extend("isValidDirective", function () {
        return function (this: Parser, stmt: Node): boolean {
          return stmt.type === "ExpressionStatement" &&
            nodeValue(stmt.expression).type === "Literal" &&
            typeof nodeValue(stmt.expression).value === "string" &&
            (!nodeValue(stmt.expression).extra || !present(nodeValue(stmt.expression).extra).parenthesized);
        };
      });

      instance.extend("parseBlockBody", function (inner: Parser["parseBlockBody"]) {
        return function (this: Parser, node: Node, ...args: [allowDirectives: boolean | undefined, topLevel: boolean | undefined, end: TokenType]): void {
          inner.call(this, node, ...args);

          node.directives.reverse().forEach((directive) => {
            nodeArray(node.body).unshift(this.directiveToStmt(directive));
          });
          removeField(node, "directives");
        };
      });

      instance.extend("parseClassMethod", function (inner: Parser["parseClassMethod"]) {
        return function (this: Parser, classBody: Node, ...args: [method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined]): void {
          inner.call(this, classBody, ...args);

          const body = nodeArray(classBody.body);
          body[body.length - 1].type = "MethodDefinition";
        };
      });

      instance.extend("parseExprAtom", function(inner: Parser["parseExprAtom"]) {
        return function (this: Parser, ...args: [refShorthandDefaultPos?: StartReference | undefined]): Node {
          switch (this.state.type) {
            case tt.regexp:
              return this.estreeParseRegExpLiteral(regexpValue(this.state.value));

            case tt.num:
            case tt.string:
              return this.estreeParseLiteral(this.state.value);

            case tt._null:
              return this.estreeParseLiteral(null);

            case tt._true:
              return this.estreeParseLiteral(true);

            case tt._false:
              return this.estreeParseLiteral(false);

            default:
              return inner.call(this, ...args);
          }
        };
      });

      instance.extend("parseLiteral", function(inner: Parser["parseLiteral"]) {
        return function (this: Parser, ...args: [value: NodeValue, type: string, startPos?: number, startLoc?: Position | SourceLocation | null | undefined]): Node {
          const node = inner.call(this, ...args);
          node.raw = stringValue(present(node.extra).raw);
          removeField(node, "extra");

          return node;
        };
      });

      instance.extend("parseMethod", function(inner: Parser["parseMethod"]) {
        return function (this: Parser, node: Node, ...args: [isGenerator?: boolean | undefined, isAsync?: boolean | undefined]): Node {
          let funcNode = this.startNode();
          funcNode.kind = node.kind; // provide kind, so inner method correctly sets state
          funcNode = inner.call(this, funcNode, ...args);
          removeField(funcNode, "kind");
          node.value = this.finishNode(funcNode, "FunctionExpression");

          return node;
        };
      });

      instance.extend("parseObjectMethod", function(inner: Parser["parseObjectMethod"]) {
        return function (this: Parser, ...args: [prop: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined]): Node | undefined {
          const node = inner.call(this, ...args);

          if (node) {
            if (node.kind === "method") node.kind = "init";
            node.type = "Property";
          }

          return node;
        };
      });

      instance.extend("parseObjectProperty", function(inner: Parser["parseObjectProperty"]) {
        return function (this: Parser, ...args: [prop: Node, startPos: number, startLoc: Position | SourceLocation, isPattern: boolean | undefined, refShorthandDefaultPos: StartReference | undefined]): Node | undefined {
          const node = inner.call(this, ...args);

          if (node) {
            node.kind = "init";
            node.type = "Property";
          }

          return node;
        };
      });

      instance.extend("toAssignable", function(inner: Parser["toAssignable"]) {
        return function (this: Parser, node: Node | null, isBinding: boolean | undefined, ...args: [contextDescription: string]): Node | null {
          node = present(node);
          if (isSimpleProperty(node)) {
            this.toAssignable(nodeValue(node.value), isBinding, ...args);

            return node;
          } else if (node.type === "ObjectExpression") {
            node.type = "ObjectPattern";
            for (const prop of (node.properties)) {
              if (prop.kind === "get" || prop.kind === "set") {
                this.raise(prop.key.start, "Object pattern can't contain getter or setter");
              } else if (prop.method) {
                this.raise(prop.key.start, "Object pattern can't contain methods");
              } else {
                this.toAssignable(prop, isBinding, "object destructuring pattern");
              }
            }

            return node;
          }

          return inner.call(this, node, isBinding, ...args);
        };
      });
    }

// pluginsFlowJS
const primitiveTypes = [
      "any",
      "mixed",
      "empty",
      "bool",
      "boolean",
      "number",
      "string",
      "void",
      "null"
    ];

function pluginsFlowJS(instance: Parser): void {
      // plain function return types: function name(): string {}
      instance.extend("parseFunctionBody", function (inner: Parser["parseFunctionBody"]) {
        return function (this: Parser, node: Node, allowExpression?: boolean | undefined): void {
          if (this.match(tt.colon) && !allowExpression) {
            // if allowExpression is true then we're parsing an arrow function and if
            // there's a return type then it's been handled elsewhere
            node.returnType = this.flowParseTypeAndPredicateAnnotation();
          }

          return inner.call(this, node, allowExpression);
        };
      });

      // interfaces
      instance.extend("parseStatement", function (inner: Parser["parseStatement"]) {
        return function (this: Parser, declaration: boolean | undefined, topLevel?: boolean | undefined): Node {
          // strict mode handling of `interface` since it's a reserved word
          if (this.state.strict && this.match(tt.name) && this.state.value === "interface") {
            const node = this.startNode();
            this.next();
            return this.flowParseInterface(node);
          } else {
            return inner.call(this, declaration, topLevel);
          }
        };
      });

      // declares, interfaces and type aliases
      instance.extend("parseExpressionStatement", function (inner: Parser["parseExpressionStatement"]) {
        return function (this: Parser, node: Node, expr: Node): Node {
          if (expr.type === "Identifier") {
            if (expr.name === "declare") {
              if (this.match(tt._class) || this.match(tt.name) || this.match(tt._function) || this.match(tt._var)) {
                return this.flowParseDeclare(node);
              }
            } else if (this.match(tt.name)) {
              if (expr.name === "interface") {
                return this.flowParseInterface(node);
              } else if (expr.name === "type") {
                return this.flowParseTypeAlias(node);
              }
            }
          }

          return inner.call(this, node, expr);
        };
      });

      // export type
      instance.extend("shouldParseExportDeclaration", function (inner: Parser["shouldParseExportDeclaration"]) {
        return function (this: Parser): boolean {
          return this.isContextual("type")
              || this.isContextual("interface")
              || inner.call(this);
        };
      });

      instance.extend("parseConditional", function (inner: Parser["parseConditional"]) {
        return function (this: Parser, expr: Node, noIn: boolean | undefined, startPos: number, startLoc: Position | SourceLocation, refNeedsArrowPos?: StartReference | undefined): Node {
          // only do the expensive clone if there is a question mark
          // and if we come from inside parens
          if (refNeedsArrowPos && this.match(tt.question)) {
            const state = this.state.clone();
            try {
              return inner.call(this, expr, noIn, startPos, startLoc);
            } catch (err) {
              if (err instanceof SyntaxError) {
                this.state = state;
                refNeedsArrowPos.start = ("pos" in err ? numberValue(err.pos) : undefined) || this.state.start;
                return expr;
              } else {
                // istanbul ignore next: no such error is expected
                throw err;
              }
            }
          }

          return inner.call(this, expr, noIn, startPos, startLoc);
        };
      });

      instance.extend("parseParenItem", function (inner: Parser["parseParenItem"]) {
        return function (this: Parser, node: Node, startPos?: number, startLoc?: Position | SourceLocation): Node {
          node = inner.call(this, node, startPos, startLoc);
          if (this.eat(tt.question)) {
            node.optional = true;
          }

          if (this.match(tt.colon)) {
            const typeCastNode = this.startNodeAt(present(startPos), startLoc);
            typeCastNode.expression = node;
            typeCastNode.typeAnnotation = this.flowParseTypeAnnotation();

            return this.finishNode(typeCastNode, "TypeCastExpression");
          }

          return node;
        };
      });

      instance.extend("parseExport", function (inner: Parser["parseExport"]) {
        return function (this: Parser, node: Node): Node {
          node = inner.call(this, node);
          if (node.type === "ExportNamedDeclaration") {
            node.exportKind = node.exportKind || "value";
          }
          return node;
        };
      });

      instance.extend("parseExportDeclaration", function (inner: Parser["parseExportDeclaration"]) {
        return function (this: Parser, node?: Node): Node | null {
          node = present(node);
          if (this.isContextual("type")) {
            node.exportKind = "type";

            const declarationNode = this.startNode();
            this.next();

            if (this.match(tt.braceL)) {
              // export type { foo, bar };
              node.specifiers = this.parseExportSpecifiers();
              this.parseExportFrom(node);
              return null;
            } else {
              // export type Foo = Bar;
              return this.flowParseTypeAlias(declarationNode);
            }
          } else if (this.isContextual("interface")) {
            node.exportKind = "type";
            const declarationNode = this.startNode();
            this.next();
            return this.flowParseInterface(declarationNode);
          } else {
            return inner.call(this, node);
          }
        };
      });

      instance.extend("parseClassId", function (inner: Parser["parseClassId"]) {
        return function (this: Parser, node: Node, isStatement: boolean | number, optionalId: boolean | undefined): void {
          inner.call(this, node, isStatement, optionalId);
          if (this.isRelational("<")) {
            node.typeParameters = this.flowParseTypeParameterDeclaration();
          }
        };
      });

      // don't consider `void` to be a keyword as then it'll use the void token type
      // and set startExpr
      instance.extend("isKeyword", function (inner: Parser["isKeyword"]) {
        return function (this: Parser, name: string): boolean {
          if (this.state.inType && name === "void") {
            return false;
          } else {
            return inner.call(this, name);
          }
        };
      });

      // ensure that inside flow types, we bypass the jsx parser plugin
      instance.extend("readToken", function (inner: Parser["readToken"]) {
        return function (this: Parser, code: number): void {
          if (this.state.inType && (code === 62 || code === 60)) {
            return this.finishOp(tt.relational, 1);
          } else {
            return inner.call(this, code);
          }
        };
      });

      // don't lex any token as a jsx one inside a flow type
      instance.extend("jsx_readToken", function (inner: Parser["jsx_readToken"]) {
        return function () {
          if (!this.state.inType) return present(inner).call(this);
        };
      });

      instance.extend("toAssignable", function (inner: Parser["toAssignable"]) {
        return function (this: Parser, node: Node | null, isBinding: boolean | undefined, contextDescription: string): Node | null {
          node = present(node);
          if (node.type === "TypeCastExpression") {
            return inner.call(this, this.typeCastToParameter(node), isBinding, contextDescription);
          } else {
            return inner.call(this, node, isBinding, contextDescription);
          }
        };
      });

      // turn type casts that we found in function parameter head into type annotated params
      instance.extend("toAssignableList", function (inner: Parser["toAssignableList"]) {
        return function (this: Parser, exprList: (Node | null)[], isBinding: boolean | undefined, contextDescription: string): (Node | null)[] {
          for (let i = 0; i < exprList.length; i++) {
            const expr = exprList[i];
            if (expr && expr.type === "TypeCastExpression") {
              exprList[i] = this.typeCastToParameter(expr);
            }
          }
          return inner.call(this, exprList, isBinding, contextDescription);
        };
      });

      // this is a list of nodes, from something like a call expression, we need to filter the
      // type casts that we've found that are illegal in this context
      instance.extend("toReferencedList", function () {
        return function (this: Parser, exprList: (Node | null)[]): (Node | null)[] {
          for (let i = 0; i < exprList.length; i++) {
            const expr = exprList[i];
            if (expr && expr._exprListItem && expr.type === "TypeCastExpression") {
              this.raise(expr.start, "Unexpected type cast");
            }
          }

          return exprList;
        };
      });

      // parse an item inside a expression list eg. `(NODE, NODE)` where NODE represents
      // the position where this function is called
      instance.extend("parseExprListItem", function (inner: Parser["parseExprListItem"]) {
        return function (this: Parser, ...args: [allowEmpty: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos?: StartReference | undefined]): Node | null {
          const container = this.startNode();
          const node = inner.call(this, ...args);
          if (this.match(tt.colon)) {
            container._exprListItem = true;
            container.expression = node;
            container.typeAnnotation = this.flowParseTypeAnnotation();
            return this.finishNode(container, "TypeCastExpression");
          } else {
            return node;
          }
        };
      });

      instance.extend("checkLVal", function (inner: Parser["checkLVal"]) {
        return function (this: Parser, node: Node, isBinding: boolean | undefined, checkClashes: Record<string, boolean> | undefined, contextDescription: string): void {
          if (node.type !== "TypeCastExpression") {
            return inner.call(this, node, isBinding, checkClashes, contextDescription);
          }
        };
      });

      // parse class property type annotations
      instance.extend("parseClassProperty", function (inner: Parser["parseClassProperty"]) {
        return function (this: Parser, node: Node): Node {
          if (this.match(tt.colon)) {
            node.typeAnnotation = this.flowParseTypeAnnotation();
          }
          return inner.call(this, node);
        };
      });

      // determine whether or not we're currently in the position where a class method would appear
      instance.extend("isClassMethod", function (inner: Parser["isClassMethod"]) {
        return function (this: Parser): boolean {
          return this.isRelational("<") || inner.call(this);
        };
      });

      // determine whether or not we're currently in the position where a class property would appear
      instance.extend("isClassProperty", function (inner: Parser["isClassProperty"]) {
        return function (this: Parser): boolean {
          return this.match(tt.colon) || inner.call(this);
        };
      });

      // parse type parameters for class methods
      instance.extend("parseClassMethod", function (inner: Parser["parseClassMethod"]) {
        return function (this: Parser, classBody: Node, method: Node, ...args: [isGenerator: boolean | undefined, isAsync: boolean | undefined]): void {
          if (method.variance) {
            this.unexpected(method.variance.start);
          }
          removeField(method, "variance");
          if (this.isRelational("<")) {
            method.typeParameters = this.flowParseTypeParameterDeclaration();
          }

          inner.call(this, classBody, method, ...args);
        };
      });

      // parse a the super class type parameters and implements
      instance.extend("parseClassSuper", function (inner: Parser["parseClassSuper"]) {
        return function (this: Parser, node: Node, isStatement?: boolean | undefined): void {
          inner.call(this, node, isStatement);
          if (node.superClass && this.isRelational("<")) {
            node.superTypeParameters = this.flowParseTypeParameterInstantiation();
          }
          if (this.isContextual("implements")) {
            this.next();
            const implemented: Node[] = node.implements = [];
            do {
              const node = this.startNode();
              node.id = this.parseIdentifier();
              if (this.isRelational("<")) {
                node.typeParameters = this.flowParseTypeParameterInstantiation();
              } else {
                node.typeParameters = null;
              }
              implemented.push(this.finishNode(node, "ClassImplements"));
            } while (this.eat(tt.comma));
          }
        };
      });

      instance.extend("parsePropertyName", function (inner: Parser["parsePropertyName"]) {
        return function (this: Parser, node: Node): Node {
          const variance = this.flowParseVariance();
          const key = inner.call(this, node);
          node.variance = variance;
          return key;
        };
      });

      // parse type parameters for object method shorthand
      instance.extend("parseObjPropValue", function (inner: Parser["parseObjPropValue"]) {
        return function (this: Parser, prop: Node, startPos: number | undefined, startLoc: Position | SourceLocation | undefined, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node | undefined {
          if (prop.variance) {
            this.unexpected(prop.variance.start);
          }
          removeField(prop, "variance");

          let typeParameters;

          // method shorthand
          if (this.isRelational("<")) {
            typeParameters = this.flowParseTypeParameterDeclaration();
            if (!this.match(tt.parenL)) this.unexpected();
          }

          inner.call(this, prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos);

          // add typeParameters if we found them
          if (typeParameters) {
            nodeValue(prop.value || prop).typeParameters = typeParameters;
          }
          return undefined;
        };
      });

      instance.extend("parseAssignableListItemTypes", function () {
        return function (this: Parser, param: Node): Node {
          if (this.eat(tt.question)) {
            param.optional = true;
          }
          if (this.match(tt.colon)) {
            param.typeAnnotation = this.flowParseTypeAnnotation();
          }
          this.finishNode(param, param.type);
          return param;
        };
      });

      instance.extend("parseMaybeDefault", function (inner: Parser["parseMaybeDefault"]) {
        return function (this: Parser, ...args: [startPos?: number, startLoc?: Position | SourceLocation | null | undefined, left?: Node]): Node {
          const node = inner.apply(this, args);

          if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
            this.raise(node.typeAnnotation.start, "Type annotations must come before default assignments, e.g. instead of `age = 25: number` use `age: number = 25`");
          }

          return node;
        };
      });


      // parse typeof and type imports
      instance.extend("parseImportSpecifiers", function (inner: Parser["parseImportSpecifiers"]) {
        return function (this: Parser, node: Node): void {
          node.importKind = "value";

          let kind = null;
          if (this.match(tt._typeof)) {
            kind = "typeof";
          } else if (this.isContextual("type")) {
            kind = "type";
          }
          if (kind) {
            const lh = this.lookahead();
            if ((lh.type === tt.name && lh.value !== "from") || lh.type === tt.braceL || lh.type === tt.star) {
              this.next();
              node.importKind = kind;
            }
          }

          inner.call(this, node);
        };
      });

      // parse import-type/typeof shorthand
      instance.extend("parseImportSpecifier", function () {
        return function (this: Parser, node: Node): void {
          const specifier = this.startNode();
          const firstIdentLoc = this.state.start;
          const firstIdent = this.parseIdentifier(true);

          let specifierTypeKind = null;
          if (firstIdent.name === "type") {
            specifierTypeKind = "type";
          } else if (firstIdent.name === "typeof") {
            specifierTypeKind = "typeof";
          }

          let isBinding = false;
          if (this.isContextual("as")) {
            const as_ident = this.parseIdentifier(true);
            if (specifierTypeKind !== null && !this.match(tt.name) && !this.state.type.keyword) {
              // `import {type as ,` or `import {type as }`
              specifier.imported = as_ident;
              specifier.importKind = specifierTypeKind;
              specifier.local = as_ident.__clone();
            } else {
              // `import {type as foo`
              specifier.imported = firstIdent;
              specifier.importKind = null;
              specifier.local = this.parseIdentifier();
            }
          } else if (specifierTypeKind !== null && (this.match(tt.name) || this.state.type.keyword)) {
            // `import {type foo`
            specifier.imported = this.parseIdentifier(true);
            specifier.importKind = specifierTypeKind;
            if (this.eatContextual("as")) {
              specifier.local = this.parseIdentifier();
            } else {
              isBinding = true;
              specifier.local = specifier.imported.__clone();
            }
          } else {
            isBinding = true;
            specifier.imported = firstIdent;
            specifier.importKind = null;
            specifier.local = specifier.imported.__clone();
          }

          if (
            (node.importKind === "type" || node.importKind === "typeof") &&
            (specifier.importKind === "type" || specifier.importKind === "typeof")
          ) {
            this.raise(firstIdentLoc, "`The `type` and `typeof` keywords on named imports can only be used on regular `import` statements. It cannot be used with `import type` or `import typeof` statements`");
          }

          if (isBinding) this.checkReservedWord(specifier.local.name, specifier.start, true, true);

          this.checkLVal(specifier.local, true, undefined, "import specifier");
          node.specifiers.push(this.finishNode(specifier, "ImportSpecifier"));
        };
      });

      // parse function type parameters - function foo<T>() {}
      instance.extend("parseFunctionParams", function (inner: Parser["parseFunctionParams"]) {
        return function (this: Parser, node: Node): void {
          if (this.isRelational("<")) {
            node.typeParameters = this.flowParseTypeParameterDeclaration();
          }
          inner.call(this, node);
        };
      });

      // parse flow type annotations on variable declarator heads - let foo: string = bar
      instance.extend("parseVarHead", function (inner: Parser["parseVarHead"]) {
        return function (this: Parser, decl: Node): void {
          inner.call(this, decl);
          if (this.match(tt.colon)) {
            present(decl.id).typeAnnotation = this.flowParseTypeAnnotation();
            this.finishNode(present(decl.id), present(decl.id).type);
          }
        };
      });

      // parse the return type of an async arrow function - let foo = (async (): number => {});
      instance.extend("parseAsyncArrowFromCallExpression", function (inner: Parser["parseAsyncArrowFromCallExpression"]) {
        return function (this: Parser, node: Node, call: Node): Node {
          if (this.match(tt.colon)) {
            const oldNoAnonFunctionType = this.state.noAnonFunctionType;
            this.state.noAnonFunctionType = true;
            node.returnType = this.flowParseTypeAnnotation();
            this.state.noAnonFunctionType = oldNoAnonFunctionType;
          }

          return inner.call(this, node, call);
        };
      });

      // todo description
      instance.extend("shouldParseAsyncArrow", function (inner: Parser["shouldParseAsyncArrow"]) {
        return function (this: Parser): boolean {
          return this.match(tt.colon) || inner.call(this);
        };
      });

      // We need to support type parameter declarations for arrow functions. This
      // is tricky. There are three situations we need to handle
      //
      // 1. This is either JSX or an arrow function. We'll try JSX first. If that
      //    fails, we'll try an arrow function. If that fails, we'll throw the JSX
      //    error.
      // 2. This is an arrow function. We'll parse the type parameter declaration,
      //    parse the rest, make sure the rest is an arrow function, and go from
      //    there
      // 3. This is neither. Just call the inner function
      instance.extend("parseMaybeAssign", function (inner: Parser["parseMaybeAssign"]) {
        return function (this: Parser, ...args: [noIn?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined, afterLeftParse?: (this: Parser, node: Node, startPos: number, startLoc: Position | SourceLocation) => Node, refNeedsArrowPos?: StartReference | undefined]): Node {
          let jsxError = null;
          if (tt.jsxTagStart && this.match(tt.jsxTagStart)) {
            const state = this.state.clone();
            try {
              return inner.apply(this, args);
            } catch (err) {
              if (err instanceof SyntaxError) {
                this.state = state;
                jsxError = err;
              } else {
                // istanbul ignore next: no such error is expected
                throw err;
              }
            }
          }

          if (jsxError != null || this.isRelational("<")) {
            // Need to push something onto the context to stop
            // the JSX plugin from messing with the tokens
            this.state.context.push(ct.parenExpression);
            let arrowExpression;
            let typeParameters;
            try {
              typeParameters = this.flowParseTypeParameterDeclaration();

              arrowExpression = inner.apply(this, args);
              arrowExpression.typeParameters = typeParameters;
              this.resetStartLocationFromNode(arrowExpression, typeParameters);
            } catch (err) {
              this.state.context.pop();

              throw jsxError || err;
            }

            this.state.context.pop();

            if (arrowExpression.type === "ArrowFunctionExpression") {
              return arrowExpression;
            } else if (jsxError != null) {
              throw jsxError;
            } else {
              this.raise(
                typeParameters.start,
                "Expected an arrow function after this type parameter declaration",
              );
            }
          }

          return inner.apply(this, args);
        };
      });

      // handle return types for arrow functions
      instance.extend("parseArrow", function (inner: Parser["parseArrow"]) {
        return function (this: Parser, node: Node): Node | undefined {
          if (this.match(tt.colon)) {
            const state = this.state.clone();
            try {
              const oldNoAnonFunctionType = this.state.noAnonFunctionType;
              this.state.noAnonFunctionType = true;
              const returnType = this.flowParseTypeAndPredicateAnnotation();
              this.state.noAnonFunctionType = oldNoAnonFunctionType;

              if (this.canInsertSemicolon()) this.unexpected();
              if (!this.match(tt.arrow)) this.unexpected();
              // assign after it is clear it is an arrow
              node.returnType = returnType;
            } catch (err) {
              if (err instanceof SyntaxError) {
                this.state = state;
              } else {
                // istanbul ignore next: no such error is expected
                throw err;
              }
            }
          }

          return inner.call(this, node);
        };
      });

      instance.extend("shouldParseArrow", function (inner: Parser["shouldParseArrow"]) {
        return function (this: Parser): boolean {
          return this.match(tt.colon) || inner.call(this);
        };
      });
    }

// pluginsJsxXhtmlJS
const XHTMLEntities: Record<string, string> = {
      quot: "\u0022",
      amp: "&",
      apos: "\u0027",
      lt: "<",
      gt: ">",
      nbsp: "\u00A0",
      iexcl: "\u00A1",
      cent: "\u00A2",
      pound: "\u00A3",
      curren: "\u00A4",
      yen: "\u00A5",
      brvbar: "\u00A6",
      sect: "\u00A7",
      uml: "\u00A8",
      copy: "\u00A9",
      ordf: "\u00AA",
      laquo: "\u00AB",
      not: "\u00AC",
      shy: "\u00AD",
      reg: "\u00AE",
      macr: "\u00AF",
      deg: "\u00B0",
      plusmn: "\u00B1",
      sup2: "\u00B2",
      sup3: "\u00B3",
      acute: "\u00B4",
      micro: "\u00B5",
      para: "\u00B6",
      middot: "\u00B7",
      cedil: "\u00B8",
      sup1: "\u00B9",
      ordm: "\u00BA",
      raquo: "\u00BB",
      frac14: "\u00BC",
      frac12: "\u00BD",
      frac34: "\u00BE",
      iquest: "\u00BF",
      Agrave: "\u00C0",
      Aacute: "\u00C1",
      Acirc: "\u00C2",
      Atilde: "\u00C3",
      Auml: "\u00C4",
      Aring: "\u00C5",
      AElig: "\u00C6",
      Ccedil: "\u00C7",
      Egrave: "\u00C8",
      Eacute: "\u00C9",
      Ecirc: "\u00CA",
      Euml: "\u00CB",
      Igrave: "\u00CC",
      Iacute: "\u00CD",
      Icirc: "\u00CE",
      Iuml: "\u00CF",
      ETH: "\u00D0",
      Ntilde: "\u00D1",
      Ograve: "\u00D2",
      Oacute: "\u00D3",
      Ocirc: "\u00D4",
      Otilde: "\u00D5",
      Ouml: "\u00D6",
      times: "\u00D7",
      Oslash: "\u00D8",
      Ugrave: "\u00D9",
      Uacute: "\u00DA",
      Ucirc: "\u00DB",
      Uuml: "\u00DC",
      Yacute: "\u00DD",
      THORN: "\u00DE",
      szlig: "\u00DF",
      agrave: "\u00E0",
      aacute: "\u00E1",
      acirc: "\u00E2",
      atilde: "\u00E3",
      auml: "\u00E4",
      aring: "\u00E5",
      aelig: "\u00E6",
      ccedil: "\u00E7",
      egrave: "\u00E8",
      eacute: "\u00E9",
      ecirc: "\u00EA",
      euml: "\u00EB",
      igrave: "\u00EC",
      iacute: "\u00ED",
      icirc: "\u00EE",
      iuml: "\u00EF",
      eth: "\u00F0",
      ntilde: "\u00F1",
      ograve: "\u00F2",
      oacute: "\u00F3",
      ocirc: "\u00F4",
      otilde: "\u00F5",
      ouml: "\u00F6",
      divide: "\u00F7",
      oslash: "\u00F8",
      ugrave: "\u00F9",
      uacute: "\u00FA",
      ucirc: "\u00FB",
      uuml: "\u00FC",
      yacute: "\u00FD",
      thorn: "\u00FE",
      yuml: "\u00FF",
      OElig: "\u0152",
      oelig: "\u0153",
      Scaron: "\u0160",
      scaron: "\u0161",
      Yuml: "\u0178",
      fnof: "\u0192",
      circ: "\u02C6",
      tilde: "\u02DC",
      Alpha: "\u0391",
      Beta: "\u0392",
      Gamma: "\u0393",
      Delta: "\u0394",
      Epsilon: "\u0395",
      Zeta: "\u0396",
      Eta: "\u0397",
      Theta: "\u0398",
      Iota: "\u0399",
      Kappa: "\u039A",
      Lambda: "\u039B",
      Mu: "\u039C",
      Nu: "\u039D",
      Xi: "\u039E",
      Omicron: "\u039F",
      Pi: "\u03A0",
      Rho: "\u03A1",
      Sigma: "\u03A3",
      Tau: "\u03A4",
      Upsilon: "\u03A5",
      Phi: "\u03A6",
      Chi: "\u03A7",
      Psi: "\u03A8",
      Omega: "\u03A9",
      alpha: "\u03B1",
      beta: "\u03B2",
      gamma: "\u03B3",
      delta: "\u03B4",
      epsilon: "\u03B5",
      zeta: "\u03B6",
      eta: "\u03B7",
      theta: "\u03B8",
      iota: "\u03B9",
      kappa: "\u03BA",
      lambda: "\u03BB",
      mu: "\u03BC",
      nu: "\u03BD",
      xi: "\u03BE",
      omicron: "\u03BF",
      pi: "\u03C0",
      rho: "\u03C1",
      sigmaf: "\u03C2",
      sigma: "\u03C3",
      tau: "\u03C4",
      upsilon: "\u03C5",
      phi: "\u03C6",
      chi: "\u03C7",
      psi: "\u03C8",
      omega: "\u03C9",
      thetasym: "\u03D1",
      upsih: "\u03D2",
      piv: "\u03D6",
      ensp: "\u2002",
      emsp: "\u2003",
      thinsp: "\u2009",
      zwnj: "\u200C",
      zwj: "\u200D",
      lrm: "\u200E",
      rlm: "\u200F",
      ndash: "\u2013",
      mdash: "\u2014",
      lsquo: "\u2018",
      rsquo: "\u2019",
      sbquo: "\u201A",
      ldquo: "\u201C",
      rdquo: "\u201D",
      bdquo: "\u201E",
      dagger: "\u2020",
      Dagger: "\u2021",
      bull: "\u2022",
      hellip: "\u2026",
      permil: "\u2030",
      prime: "\u2032",
      Prime: "\u2033",
      lsaquo: "\u2039",
      rsaquo: "\u203A",
      oline: "\u203E",
      frasl: "\u2044",
      euro: "\u20AC",
      image: "\u2111",
      weierp: "\u2118",
      real: "\u211C",
      trade: "\u2122",
      alefsym: "\u2135",
      larr: "\u2190",
      uarr: "\u2191",
      rarr: "\u2192",
      darr: "\u2193",
      harr: "\u2194",
      crarr: "\u21B5",
      lArr: "\u21D0",
      uArr: "\u21D1",
      rArr: "\u21D2",
      dArr: "\u21D3",
      hArr: "\u21D4",
      forall: "\u2200",
      part: "\u2202",
      exist: "\u2203",
      empty: "\u2205",
      nabla: "\u2207",
      isin: "\u2208",
      notin: "\u2209",
      ni: "\u220B",
      prod: "\u220F",
      sum: "\u2211",
      minus: "\u2212",
      lowast: "\u2217",
      radic: "\u221A",
      prop: "\u221D",
      infin: "\u221E",
      ang: "\u2220",
      and: "\u2227",
      or: "\u2228",
      cap: "\u2229",
      cup: "\u222A",
      "int": "\u222B",
      there4: "\u2234",
      sim: "\u223C",
      cong: "\u2245",
      asymp: "\u2248",
      ne: "\u2260",
      equiv: "\u2261",
      le: "\u2264",
      ge: "\u2265",
      sub: "\u2282",
      sup: "\u2283",
      nsub: "\u2284",
      sube: "\u2286",
      supe: "\u2287",
      oplus: "\u2295",
      otimes: "\u2297",
      perp: "\u22A5",
      sdot: "\u22C5",
      lceil: "\u2308",
      rceil: "\u2309",
      lfloor: "\u230A",
      rfloor: "\u230B",
      lang: "\u2329",
      rang: "\u232A",
      loz: "\u25CA",
      spades: "\u2660",
      clubs: "\u2663",
      hearts: "\u2665",
      diams: "\u2666"
    };

// pluginsJsxIndexJS
const HEX_NUMBER = /^[\da-fA-F]+$/;

const DECIMAL_NUMBER = /^\d+$/;

ct.j_oTag = new TokContext("<tag", false);

ct.j_cTag = new TokContext("</tag", false);

ct.j_expr = new TokContext("<tag>...</tag>", true, true);

tt.jsxName = new TokenType("jsxName");

tt.jsxText = new TokenType("jsxText", { beforeExpr: true });

tt.jsxTagStart = new TokenType("jsxTagStart", { startsExpr: true });

tt.jsxTagEnd = new TokenType("jsxTagEnd");

tt.jsxTagStart.updateContext = function(this: Parser): void {
      this.state.context.push(ct.j_expr); // treat as beginning of JSX expression
      this.state.context.push(ct.j_oTag); // start opening tag context
      this.state.exprAllowed = false;
    };

tt.jsxTagEnd.updateContext = function(this: Parser, prevType: TokenType): void {
      const out = present(this.state.context.pop());
      if (out === ct.j_oTag && prevType === tt.slash || out === ct.j_cTag) {
        this.state.context.pop();
        this.state.exprAllowed = this.curContext() === ct.j_expr;
      } else {
        this.state.exprAllowed = true;
      }
    };

function getQualifiedJSXName(objectValue: NodeValue): string | undefined {
  const object = nodeValue(objectValue);
      if (object.type === "JSXIdentifier") {
        return stringValue(object.name);
      }

      if (object.type === "JSXNamespacedName") {
        return object.namespace.name + ":" + nodeValue(object.name).name;
      }

      if (object.type === "JSXMemberExpression") {
        return getQualifiedJSXName(object.object) + "." + getQualifiedJSXName(object.property);
      }
    }

function pluginsJsxIndexJS(instance: Parser): void {
      instance.extend("parseExprAtom", function(inner: Parser["parseExprAtom"]) {
        return function(this: Parser, refShortHandDefaultPos?: StartReference | undefined): Node {
          if (this.match(tt.jsxText)) {
            const node = this.parseLiteral(this.state.value, "JSXText");
            // https://github.com/babel/babel/issues/2078
            node.extra = null;
            return node;
          } else if (this.match(tt.jsxTagStart)) {
            return this.jsxParseElement();
          } else {
            return inner.call(this, refShortHandDefaultPos);
          }
        };
      });

      instance.extend("readToken", function(inner: Parser["readToken"]) {
        return function(this: Parser, code: number): void {
          if (this.state.inPropertyName) return inner.call(this, code);

          const context = this.curContext();

          if (context === ct.j_expr) {
            return this.jsxReadToken();
          }

          if (context === ct.j_oTag || context === ct.j_cTag) {
            if (isIdentifierStart(code)) {
              return this.jsxReadWord();
            }

            if (code === 62) {
              ++this.state.pos;
              return this.finishToken(tt.jsxTagEnd);
            }

            if ((code === 34 || code === 39) && context === ct.j_oTag) {
              return this.jsxReadString(code);
            }
          }

          if (code === 60 && this.state.exprAllowed) {
            ++this.state.pos;
            return this.finishToken(tt.jsxTagStart);
          }

          return inner.call(this, code);
        };
      });

      instance.extend("updateContext", function(inner: Parser["updateContext"]) {
        return function(this: Parser, prevType: TokenType): void {
          if (this.match(tt.braceL)) {
            const curContext = this.curContext();
            if (curContext === ct.j_oTag) {
              this.state.context.push(ct.braceExpression);
            } else if (curContext === ct.j_expr) {
              this.state.context.push(ct.templateQuasi);
            } else {
              inner.call(this, prevType);
            }
            this.state.exprAllowed = true;
          } else if (this.match(tt.slash) && prevType === tt.jsxTagStart) {
            this.state.context.length -= 2; // do not consider JSX expr -> JSX open tag -> ... anymore
            this.state.context.push(ct.j_cTag); // reconsider as closing tag context
            this.state.exprAllowed = false;
          } else {
            return inner.call(this, prevType);
          }
        };
      });
    }

export class Parser {
  declare state: State;
  declare options: ParserOptions;
  declare inModule: boolean;
  declare input: string;
  declare plugins: Record<string, boolean>;
  declare filename: string | undefined;
  declare isLookahead: boolean | undefined;
  declare jsx_readToken?: (this: Parser) => void;

next(): void {
        if (!this.isLookahead) {
          this.state.tokens.push(new Token(this.state));
        }

        this.state.lastTokEnd = this.state.end;
        this.state.lastTokStart = this.state.start;
        this.state.lastTokEndLoc = this.state.endLoc;
        this.state.lastTokStartLoc = this.state.startLoc;
        this.nextToken();
      }

eat(type: TokenType): boolean | undefined {
        if (this.match(type)) {
          this.next();
          return true;
        } else {
          return false;
        }
      }

match(type: TokenType): boolean {
        return this.state.type === type;
      }

isKeyword(word: string): boolean {
        return isKeyword(word);
      }

lookahead(): State {
        const old = this.state;
        this.state = old.clone(true);

        this.isLookahead = true;
        this.next();
        this.isLookahead = false;

        const curr = this.state.clone(true);
        this.state = old;
        return curr;
      }

setStrict(strict: boolean): void {
        this.state.strict = strict;
        if (!this.match(tt.num) && !this.match(tt.string)) return;
        this.state.pos = this.state.start;
        while (this.state.pos < this.state.lineStart) {
          this.state.lineStart = this.input.lastIndexOf("\n", this.state.lineStart - 2) + 1;
          --this.state.curLine;
        }
        this.nextToken();
      }

curContext(): TokContext {
        return this.state.context[this.state.context.length - 1];
      }

nextToken(): void {
        const curContext = this.curContext();
        if (!curContext || !curContext.preserveSpace) this.skipSpace();

        this.state.containsOctal = false;
        this.state.octalPosition = null;
        this.state.start = this.state.pos;
        this.state.startLoc = this.state.curPosition();
        if (this.state.pos >= this.input.length) return this.finishToken(tt.eof);

        if (curContext.override) {
          return curContext.override(this);
        } else {
          return this.readToken(this.fullCharCodeAtPos());
        }
      }

readToken(code: number): void {
        // Identifier or keyword. '\uXXXX' sequences are allowed in
        // identifiers, so '\' also dispatches to that.
        if (isIdentifierStart(code) || code === 92 /* '\' */) {
          return this.readWord();
        } else {
          return this.getTokenFromCode(code);
        }
      }

fullCharCodeAtPos(): number {
        const code = this.input.charCodeAt(this.state.pos);
        if (code <= 0xd7ff || code >= 0xe000) return code;

        const next = this.input.charCodeAt(this.state.pos + 1);
        return (code << 10) + next - 0x35fdc00;
      }

pushComment(block: boolean, text: string, start: number, end: number, startLoc: Position | SourceLocation, endLoc: Position): void {
        const comment = {
          type: block ? "CommentBlock" : "CommentLine",
          value: text,
          start: start,
          end: end,
          loc: new SourceLocation(startLoc, endLoc)
        };

        if (!this.isLookahead) {
          this.state.tokens.push(comment);
          this.state.comments.push(comment);
          this.addComment(comment);
        }
      }

skipBlockComment(): void {
        const startLoc = this.state.curPosition();
        const start = this.state.pos;
        const end = this.input.indexOf("*/", this.state.pos += 2);
        if (end === -1) this.raise(this.state.pos - 2, "Unterminated comment");

        this.state.pos = end + 2;
        lineBreakG.lastIndex = start;
        let match;
        while ((match = lineBreakG.exec(this.input)) && match.index < this.state.pos) {
          ++this.state.curLine;
          this.state.lineStart = match.index + match[0].length;
        }

        this.pushComment(true, this.input.slice(start + 2, end), start, this.state.pos, startLoc, this.state.curPosition());
      }

skipLineComment(startSkip: number): void {
        const start = this.state.pos;
        const startLoc = this.state.curPosition();
        let ch = this.input.charCodeAt(this.state.pos += startSkip);
        while (this.state.pos < this.input.length && ch !== 10 && ch !== 13 && ch !== 8232 && ch !== 8233) {
          ++this.state.pos;
          ch = this.input.charCodeAt(this.state.pos);
        }

        this.pushComment(false, this.input.slice(start + startSkip, this.state.pos), start, this.state.pos, startLoc, this.state.curPosition());
      }

skipSpace(): void {
        loop: while (this.state.pos < this.input.length) {
          const ch = this.input.charCodeAt(this.state.pos);
          switch (ch) {
            case 32: case 160: // ' '
              ++this.state.pos;
              break;

            case 13:
              if (this.input.charCodeAt(this.state.pos + 1) === 10) {
                ++this.state.pos;
              }

            case 10: case 8232: case 8233:
              ++this.state.pos;
              ++this.state.curLine;
              this.state.lineStart = this.state.pos;
              break;

            case 47: // '/'
              switch (this.input.charCodeAt(this.state.pos + 1)) {
                case 42: // '*'
                  this.skipBlockComment();
                  break;

                case 47:
                  this.skipLineComment(2);
                  break;

                default:
                  break loop;
              }
              break;

            default:
              if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
                ++this.state.pos;
              } else {
                break loop;
              }
          }
        }
      }

finishToken(type: TokenType, val?: NodeValue): void {
        this.state.end = this.state.pos;
        this.state.endLoc = this.state.curPosition();
        const prevType = this.state.type;
        this.state.type = type;
        this.state.value = val;

        this.updateContext(prevType);
      }

readToken_dot(): void {
        const next = this.input.charCodeAt(this.state.pos + 1);
        if (next >= 48 && next <= 57) {
          return this.readNumber(true);
        }

        const next2 = this.input.charCodeAt(this.state.pos + 2);
        if (next === 46 && next2 === 46) { // 46 = dot '.'
          this.state.pos += 3;
          return this.finishToken(tt.ellipsis);
        } else {
          ++this.state.pos;
          return this.finishToken(tt.dot);
        }
      }

readToken_slash(): void { // '/'
        if (this.state.exprAllowed) {
          ++this.state.pos;
          return this.readRegexp();
        }

        const next = this.input.charCodeAt(this.state.pos + 1);
        if (next === 61) {
          return this.finishOp(tt.assign, 2);
        } else {
          return this.finishOp(tt.slash, 1);
        }
      }

readToken_mult_modulo(code: number): void { // '%*'
        let type = code === 42 ? tt.star : tt.modulo;
        let width = 1;
        let next = this.input.charCodeAt(this.state.pos + 1);

        if (next === 42) { // '*'
          width++;
          next = this.input.charCodeAt(this.state.pos + 2);
          type = tt.exponent;
        }

        if (next === 61) {
          width++;
          type = tt.assign;
        }

        return this.finishOp(type, width);
      }

readToken_pipe_amp(code: number): void { // '|&'
        const next = this.input.charCodeAt(this.state.pos + 1);
        if (next === code) return this.finishOp(code === 124 ? tt.logicalOR : tt.logicalAND, 2);
        if (next === 61) return this.finishOp(tt.assign, 2);
        if (code === 124 && next === 125 && this.hasPlugin("flow")) return this.finishOp(tt.braceBarR, 2);
        return this.finishOp(code === 124 ? tt.bitwiseOR : tt.bitwiseAND, 1);
      }

readToken_caret(): void { // '^'
        const next = this.input.charCodeAt(this.state.pos + 1);
        if (next === 61) {
          return this.finishOp(tt.assign, 2);
        } else {
          return this.finishOp(tt.bitwiseXOR, 1);
        }
      }

readToken_plus_min(code: number): void { // '+-'
        const next = this.input.charCodeAt(this.state.pos + 1);

        if (next === code) {
          if (next === 45 && this.input.charCodeAt(this.state.pos + 2) === 62 && lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.pos))) {
            // A `-->` line comment
            this.skipLineComment(3);
            this.skipSpace();
            return this.nextToken();
          }
          return this.finishOp(tt.incDec, 2);
        }

        if (next === 61) {
          return this.finishOp(tt.assign, 2);
        } else {
          return this.finishOp(tt.plusMin, 1);
        }
      }

readToken_lt_gt(code: number): void { // '<>'
        const next = this.input.charCodeAt(this.state.pos + 1);
        let size = 1;

        if (next === code) {
          size = code === 62 && this.input.charCodeAt(this.state.pos + 2) === 62 ? 3 : 2;
          if (this.input.charCodeAt(this.state.pos + size) === 61) return this.finishOp(tt.assign, size + 1);
          return this.finishOp(tt.bitShift, size);
        }

        if (next === 33 && code === 60 && this.input.charCodeAt(this.state.pos + 2) === 45 && this.input.charCodeAt(this.state.pos + 3) === 45) {
          if (this.inModule) this.unexpected();
          // `<!--`, an XML-style comment that should be interpreted as a line comment
          this.skipLineComment(4);
          this.skipSpace();
          return this.nextToken();
        }

        if (next === 61) {
          // <= | >=
          size = 2;
        }

        return this.finishOp(tt.relational, size);
      }

readToken_eq_excl(code: number): void { // '=!'
        const next = this.input.charCodeAt(this.state.pos + 1);
        if (next === 61) return this.finishOp(tt.equality, this.input.charCodeAt(this.state.pos + 2) === 61 ? 3 : 2);
        if (code === 61 && next === 62) { // '=>'
          this.state.pos += 2;
          return this.finishToken(tt.arrow);
        }
        return this.finishOp(code === 61 ? tt.eq : tt.prefix, 1);
      }

getTokenFromCode(code: number): void {
        switch (code) {
          // The interpretation of a dot depends on whether it is followed
          // by a digit or another two dots.
          case 46: // '.'
            return this.readToken_dot();

          // Punctuation tokens.
          case 40: ++this.state.pos; return this.finishToken(tt.parenL);
          case 41: ++this.state.pos; return this.finishToken(tt.parenR);
          case 59: ++this.state.pos; return this.finishToken(tt.semi);
          case 44: ++this.state.pos; return this.finishToken(tt.comma);
          case 91: ++this.state.pos; return this.finishToken(tt.bracketL);
          case 93: ++this.state.pos; return this.finishToken(tt.bracketR);

          case 123:
            if (this.hasPlugin("flow") && this.input.charCodeAt(this.state.pos + 1) === 124) {
              return this.finishOp(tt.braceBarL, 2);
            } else {
              ++this.state.pos;
              return this.finishToken(tt.braceL);
            }

          case 125:
            ++this.state.pos; return this.finishToken(tt.braceR);

          case 58:
            if (this.hasPlugin("functionBind") && this.input.charCodeAt(this.state.pos + 1) === 58) {
              return this.finishOp(tt.doubleColon, 2);
            } else {
              ++this.state.pos;
              return this.finishToken(tt.colon);
            }

          case 63: ++this.state.pos; return this.finishToken(tt.question);
          case 64: ++this.state.pos; return this.finishToken(tt.at);

          case 96: // '`'
            ++this.state.pos;
            return this.finishToken(tt.backQuote);

          case 48: // '0'
            const next = this.input.charCodeAt(this.state.pos + 1);
            if (next === 120 || next === 88) return this.readRadixNumber(16); // '0x', '0X' - hex number
            if (next === 111 || next === 79) return this.readRadixNumber(8); // '0o', '0O' - octal number
            if (next === 98 || next === 66) return this.readRadixNumber(2); // '0b', '0B' - binary number
            // Anything else beginning with a digit is an integer, octal
            // number, or float.
          case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: // 1-9
            return this.readNumber(false);

            // Quotes produce strings.
          case 34: case 39: // '"', "'"
            return this.readString(code);

          // Operators are parsed inline in tiny state machines. '=' (61) is
          // often referred to. `finishOp` simply skips the amount of
          // characters it is given as second argument, and returns a token
          // of the type given by its first argument.

          case 47: // '/'
            return this.readToken_slash();

          case 37: case 42: // '%*'
            return this.readToken_mult_modulo(code);

          case 124: case 38: // '|&'
            return this.readToken_pipe_amp(code);

          case 94: // '^'
            return this.readToken_caret();

          case 43: case 45: // '+-'
            return this.readToken_plus_min(code);

          case 60: case 62: // '<>'
            return this.readToken_lt_gt(code);

          case 61: case 33: // '=!'
            return this.readToken_eq_excl(code);

          case 126: // '~'
            return this.finishOp(tt.prefix, 1);
        }

        this.raise(this.state.pos, `Unexpected character '${codePointToString(code)}'`);
      }

finishOp(type: TokenType, size: number): void {
        const str = this.input.slice(this.state.pos, this.state.pos + size);
        this.state.pos += size;
        return this.finishToken(type, str);
      }

readRegexp(): void {
        const start = this.state.pos;
        let escaped, inClass;
        for (;;) {
          if (this.state.pos >= this.input.length) this.raise(start, "Unterminated regular expression");
          const ch = this.input.charAt(this.state.pos);
          if (lineBreak.test(ch)) {
            this.raise(start, "Unterminated regular expression");
          }
          if (escaped) {
            escaped = false;
          } else {
            if (ch === "[") {
              inClass = true;
            } else if (ch === "]" && inClass) {
              inClass = false;
            } else if (ch === "/" && !inClass) {
              break;
            }
            escaped = ch === "\\";
          }
          ++this.state.pos;
        }
        const content = this.input.slice(start, this.state.pos);
        ++this.state.pos;
        // Need to use `readWord1` because '\uXXXX' sequences are allowed
        // here (don't ask).
        const mods = this.readWord1();
        if (mods) {
          const validFlags = /^[gmsiyu]*$/;
          if (!validFlags.test(mods)) this.raise(start, "Invalid regular expression flag");
        }
        return this.finishToken(tt.regexp, {
          pattern: content,
          flags: mods
        });
      }

readInt(radix: number, len?: number): number | null {
        const start = this.state.pos;
        let total = 0;

        for (let i = 0, e = len == null ? Infinity : len; i < e; ++i) {
          const code = this.input.charCodeAt(this.state.pos);
          let val;
          if (code >= 97) {
            val = code - 97 + 10; // a
          } else if (code >= 65) {
            val = code - 65 + 10; // A
          } else if (code >= 48 && code <= 57) {
            val = code - 48; // 0-9
          } else  {
            val = Infinity;
          }
          if (val >= radix) break;
          ++this.state.pos;
          total = total * radix + val;
        }
        if (this.state.pos === start || len != null && this.state.pos - start !== len) return null;

        return total;
      }

readRadixNumber(radix: number): void {
        this.state.pos += 2; // 0x
        const val = this.readInt(radix);
        if (val == null) this.raise(this.state.start + 2, "Expected number in radix " + radix);
        if (isIdentifierStart(this.fullCharCodeAtPos())) this.raise(this.state.pos, "Identifier directly after number");
        return this.finishToken(tt.num, val);
      }

readNumber(startsWithDot: boolean | undefined): void {
        const start = this.state.pos;
        const octal = this.input.charCodeAt(this.state.pos) === 48;
        let isFloat = false;

        if (!startsWithDot && this.readInt(10) === null) this.raise(start, "Invalid number");
        let next = this.input.charCodeAt(this.state.pos);
        if (next === 46) { // '.'
          ++this.state.pos;
          this.readInt(10);
          isFloat = true;
          next = this.input.charCodeAt(this.state.pos);
        }
        if (next === 69 || next === 101) { // 'eE'
          next = this.input.charCodeAt(++this.state.pos);
          if (next === 43 || next === 45) ++this.state.pos; // '+-'
          if (this.readInt(10) === null) this.raise(start, "Invalid number");
          isFloat = true;
        }
        if (isIdentifierStart(this.fullCharCodeAtPos())) this.raise(this.state.pos, "Identifier directly after number");

        const str = this.input.slice(start, this.state.pos);
        let val;
        if (isFloat) {
          val = parseFloat(str);
        } else if (!octal || str.length === 1) {
          val = parseInt(str, 10);
        } else if (/[89]/.test(str) || this.state.strict) {
          this.raise(start, "Invalid number");
        } else {
          val = parseInt(str, 8);
        }
        return this.finishToken(tt.num, val);
      }

readCodePoint(throwOnInvalid: boolean | undefined): number | null {
        const ch = this.input.charCodeAt(this.state.pos);
        let code;

        if (ch === 123) { // '{'
          const codePos = ++this.state.pos;
          code = this.readHexChar(this.input.indexOf("}", this.state.pos) - this.state.pos, throwOnInvalid);
          ++this.state.pos;
          if (code === null) {
            this.state.invalidTemplateEscapePosition = present(this.state.invalidTemplateEscapePosition) - 1; // to point to the '\'' instead of the 'u'
          } else if (code > 0x10FFFF) {
            if (throwOnInvalid) {
              this.raise(codePos, "Code point out of bounds");
            } else {
              this.state.invalidTemplateEscapePosition = codePos - 2;
              return null;
            }
          }
        } else {
          code = this.readHexChar(4, throwOnInvalid);
        }
        return code;
      }

readString(quote: number): void {
        let out = "", chunkStart = ++this.state.pos;
        for (;;) {
          if (this.state.pos >= this.input.length) this.raise(this.state.start, "Unterminated string constant");
          const ch = this.input.charCodeAt(this.state.pos);
          if (ch === quote) break;
          if (ch === 92) { // '\'
            out += this.input.slice(chunkStart, this.state.pos);
            out += this.readEscapedChar(false);
            chunkStart = this.state.pos;
          } else {
            if (isNewLine(ch)) this.raise(this.state.start, "Unterminated string constant");
            ++this.state.pos;
          }
        }
        out += this.input.slice(chunkStart, this.state.pos++);
        return this.finishToken(tt.string, out);
      }

readTmplToken(): void {
        let out = "", chunkStart = this.state.pos, containsInvalid = false;
        for (;;) {
          if (this.state.pos >= this.input.length) this.raise(this.state.start, "Unterminated template");
          const ch = this.input.charCodeAt(this.state.pos);
          if (ch === 96 || ch === 36 && this.input.charCodeAt(this.state.pos + 1) === 123) { // '`', '${'
            if (this.state.pos === this.state.start && this.match(tt.template)) {
              if (ch === 36) {
                this.state.pos += 2;
                return this.finishToken(tt.dollarBraceL);
              } else {
                ++this.state.pos;
                return this.finishToken(tt.backQuote);
              }
            }
            out += this.input.slice(chunkStart, this.state.pos);
            return this.finishToken(tt.template, containsInvalid ? null : out);
          }
          if (ch === 92) { // '\'
            out += this.input.slice(chunkStart, this.state.pos);
            const escaped = this.readEscapedChar(true);
            if (escaped === null) {
              containsInvalid = true;
            } else {
              out += escaped;
            }
            chunkStart = this.state.pos;
          } else if (isNewLine(ch)) {
            out += this.input.slice(chunkStart, this.state.pos);
            ++this.state.pos;
            switch (ch) {
              case 13:
                if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos;
              case 10:
                out += "\n";
                break;
              default:
                out += String.fromCharCode(ch);
                break;
            }
            ++this.state.curLine;
            this.state.lineStart = this.state.pos;
            chunkStart = this.state.pos;
          } else {
            ++this.state.pos;
          }
        }
      }

readEscapedChar(inTemplate: boolean | undefined): string | null {
        const throwOnInvalid = !inTemplate;
        const ch = this.input.charCodeAt(++this.state.pos);
        ++this.state.pos;
        switch (ch) {
          case 110: return "\n"; // 'n' -> '\n'
          case 114: return "\r"; // 'r' -> '\r'
          case 120: { // 'x'
            const code = this.readHexChar(2, throwOnInvalid);
            return code === null ? null : String.fromCharCode(code);
          }
          case 117: { // 'u'
            const code = this.readCodePoint(throwOnInvalid);
            return code === null ? null : codePointToString(code);
          }
          case 116: return "\t"; // 't' -> '\t'
          case 98: return "\b"; // 'b' -> '\b'
          case 118: return "\u000b"; // 'v' -> '\u000b'
          case 102: return "\f"; // 'f' -> '\f'
          case 13: if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos; // '\r\n'
          case 10: // ' \n'
            this.state.lineStart = this.state.pos;
            ++this.state.curLine;
            return "";
          default:
            if (ch >= 48 && ch <= 55) {
              const codePos = this.state.pos - 1;
              let octalStr = present(this.input.substr(this.state.pos - 1, 3).match(/^[0-7]+/))[0];
              let octal = parseInt(octalStr, 8);
              if (octal > 255) {
                octalStr = octalStr.slice(0, -1);
                octal = parseInt(octalStr, 8);
              }
              if (octal > 0) {
                if (inTemplate) {
                  this.state.invalidTemplateEscapePosition = codePos;
                  return null;
                } else if (this.state.strict) {
                  this.raise(codePos, "Octal literal in strict mode");
                } else if (!this.state.containsOctal) {
                  // These properties are only used to throw an error for an octal which occurs
                  // in a directive which occurs prior to a "use strict" directive.
                  this.state.containsOctal = true;
                  this.state.octalPosition = codePos;
                }
              }
              this.state.pos += octalStr.length - 1;
              return String.fromCharCode(octal);
            }
            return String.fromCharCode(ch);
        }
      }

readHexChar(len: number, throwOnInvalid: boolean | undefined): number | null {
        const codePos = this.state.pos;
        const n = this.readInt(16, len);
        if (n === null) {
          if (throwOnInvalid) {
            this.raise(codePos, "Bad character escape sequence");
          } else {
            this.state.pos = codePos - 1;
            this.state.invalidTemplateEscapePosition = codePos - 1;
          }
        }
        return n;
      }

readWord1(): string {
        this.state.containsEsc = false;
        let word = "", first = true, chunkStart = this.state.pos;
        while (this.state.pos < this.input.length) {
          const ch = this.fullCharCodeAtPos();
          if (isIdentifierChar(ch)) {
            this.state.pos += ch <= 0xffff ? 1 : 2;
          } else if (ch === 92) { // "\"
            this.state.containsEsc = true;

            word += this.input.slice(chunkStart, this.state.pos);
            const escStart = this.state.pos;

            if (this.input.charCodeAt(++this.state.pos) !== 117) { // "u"
              this.raise(this.state.pos, "Expecting Unicode escape sequence \\uXXXX");
            }

            ++this.state.pos;
            const esc = present(this.readCodePoint(true));
            if (!(first ? isIdentifierStart : isIdentifierChar)(esc, true)) {
              this.raise(escStart, "Invalid Unicode escape");
            }

            word += codePointToString(esc);
            chunkStart = this.state.pos;
          } else {
            break;
          }
          first = false;
        }
        return word + this.input.slice(chunkStart, this.state.pos);
      }

readWord(): void {
        const word = this.readWord1();
        let type = tt.name;
        if (!this.state.containsEsc && this.isKeyword(word)) {
          type = keywordTypes[word];
        }
        return this.finishToken(type, word);
      }

braceIsBlock(prevType: TokenType): boolean {
        if (prevType === tt.colon) {
          const parent = this.curContext();
          if (parent === ct.braceStatement || parent === ct.braceExpression) {
            return !parent.isExpr;
          }
        }

        if (prevType === tt._return) {
          return lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
        }

        if (prevType === tt._else || prevType === tt.semi || prevType === tt.eof || prevType === tt.parenR) {
          return true;
        }

        if (prevType === tt.braceL) {
          return this.curContext() === ct.braceStatement;
        }

        return !this.state.exprAllowed;
      }

updateContext(prevType: TokenType): void {
        const type = this.state.type;
        let update;

        if (type.keyword && prevType === tt.dot) {
          this.state.exprAllowed = false;
        } else if (update = type.updateContext) {
          update.call(this, prevType);
        } else {
          this.state.exprAllowed = type.beforeExpr;
        }
      }

constructor(inputOptions: Partial<ParserOptions> | undefined, input: string) {
        const options = getOptions(inputOptions);
        this.state = new State;
        this.state.init(options, input);

        this.options = options;
        this.inModule = this.options.sourceType === "module";
        this.input = input;
        this.plugins = this.loadPlugins(this.options.plugins);
        this.filename = options.sourceFilename;

        // If enabled, skip leading hashbang line.
        if (this.state.pos === 0 && this.input[0] === "#" && this.input[1] === "!") {
          this.skipLineComment(2);
        }
      }

isReservedWord(word: string): boolean {
        if (word === "await") {
          return this.inModule;
        } else {
          return reservedWords[6](word);
        }
      }

hasPlugin(name: string): boolean {
        return !!this.plugins[name];
      }

extend<K extends keyof Parser>(name: K, f: (inner: Parser[K]) => Parser[K]): void {
  const target: Parser = this;
  target[name] = f(target[name]);
}

loadPlugins(pluginList: string[]): Record<string, boolean>  {
        const pluginMap: Record<string, boolean> = {};

        if (pluginList.indexOf("flow") >= 0) {
          // ensure flow plugin loads last
          pluginList = pluginList.filter((plugin) => plugin !== "flow");
          pluginList.push("flow");
        }

        if (pluginList.indexOf("estree") >= 0) {
          // ensure estree plugin loads first
          pluginList = pluginList.filter((plugin) => plugin !== "estree");
          pluginList.unshift("estree");
        }

        for (const name of pluginList) {
          if (!pluginMap[name]) {
            pluginMap[name] = true;

            const plugin = plugins[name];
            if (plugin) plugin(this);
          }
        }

        return pluginMap;
      }

parse(): Node {
        const file = this.startNode();
        const program = this.startNode();
        this.nextToken();
        return this.parseTopLevel(file, program);
      }

addComment(comment: Comment): void {
          if (this.filename) comment.loc.filename = this.filename;
          this.state.trailingComments.push(comment);
          this.state.leadingComments.push(comment);
        }

processComment(node: Node): void {
          if (node.type === "Program" && nodeArray(node.body).length > 0) return;

          const stack = this.state.commentStack;

          let lastChild, trailingComments, i, j;

          if (this.state.trailingComments.length > 0) {
            // If the first comment in trailingComments comes after the
            // current node, then we're good - all comments in the array will
            // come after the node and so it's safe to add them as official
            // trailingComments.
            if (this.state.trailingComments[0].start >= node.end) {
              trailingComments = this.state.trailingComments;
              this.state.trailingComments = [];
            } else {
              // Otherwise, if the first comment doesn't come after the
              // current node, that means we have a mix of leading and trailing
              // comments in the array and that leadingComments contains the
              // same items as trailingComments. Reset trailingComments to
              // zero items and we'll handle this by evaluating leadingComments
              // later.
              this.state.trailingComments.length = 0;
            }
          } else {
            const lastInStack = last(stack);
            if (stack.length > 0 && lastInStack.trailingComments && lastInStack.trailingComments[0].start >= node.end) {
              trailingComments = lastInStack.trailingComments;
              lastInStack.trailingComments = null;
            }
          }

          // Eating the stack.
          while (stack.length > 0 && last(stack).start >= node.start) {
            lastChild = stack.pop();
          }

          if (lastChild) {
            if (lastChild.leadingComments) {
              if (lastChild !== node && last(lastChild.leadingComments).end <= node.start) {
                node.leadingComments = lastChild.leadingComments;
                lastChild.leadingComments = null;
              } else {
                // A leading comment for an anonymous class had been stolen by its first ClassMethod,
                // so this takes back the leading comment.
                // See also: https://github.com/eslint/espree/issues/158
                for (i = lastChild.leadingComments.length - 2; i >= 0; --i) {
                  if (lastChild.leadingComments[i].end <= node.start) {
                    node.leadingComments = lastChild.leadingComments.splice(0, i + 1);
                    break;
                  }
                }
              }
            }
          } else if (this.state.leadingComments.length > 0) {
            if (last(this.state.leadingComments).end <= node.start) {
              if (this.state.commentPreviousNode) {
                for (j = 0; j < this.state.leadingComments.length; j++) {
                  if (this.state.leadingComments[j].end < this.state.commentPreviousNode.end) {
                    this.state.leadingComments.splice(j, 1);
                    j--;
                  }
                }
              }
              if (this.state.leadingComments.length > 0) {
                node.leadingComments = this.state.leadingComments;
                this.state.leadingComments = [];
              }
            } else {
              // https://github.com/eslint/espree/issues/2
              //
              // In special cases, such as return (without a value) and
              // debugger, all comments will end up as leadingComments and
              // will otherwise be eliminated. This step runs when the
              // commentStack is empty and there are comments left
              // in leadingComments.
              //
              // This loop figures out the stopping point between the actual
              // leading and trailing comments by finding the location of the
              // first comment that comes after the given node.
              for (i = 0; i < this.state.leadingComments.length; i++) {
                if (this.state.leadingComments[i].end > node.start) {
                  break;
                }
              }

              // Split the array based on the location of the first comment
              // that comes after the node. Keep in mind that this could
              // result in an empty array, and if so, the array must be
              // deleted.
              node.leadingComments = this.state.leadingComments.slice(0, i);
              if ((node.leadingComments).length === 0) {
                node.leadingComments = null;
              }

              // Similarly, trailing comments are attached later. The variable
              // must be reset to null if there are no trailing comments.
              trailingComments = this.state.leadingComments.slice(i);
              if (trailingComments.length === 0) {
                trailingComments = null;
              }
            }
          }

          this.state.commentPreviousNode = node;

          if (trailingComments) {
            if (trailingComments.length && trailingComments[0].start >= node.start && last(trailingComments).end <= node.end) {
              node.innerComments = trailingComments;
            } else {
              node.trailingComments = trailingComments;
            }
          }

          stack.push(node);
        }

checkPropClash(prop: Node, propHash: Record<string, boolean>): void {
      if (prop.computed || prop.kind) return;

      const key = prop.key;
      // It is either an Identifier or a String/NumericLiteral
      const name = key.type === "Identifier" ? key.name : String(key.value);

      if (name === "__proto__") {
        if (propHash.proto) this.raise(key.start, "Redefinition of __proto__ property");
        propHash.proto = true;
      }
    }

getExpression(): Node {
      this.nextToken();
      const expr = this.parseExpression();
      if (!this.match(tt.eof)) {
        this.unexpected();
      }
      return expr;
    }

parseExpression(noIn?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      const expr = this.parseMaybeAssign(noIn, refShorthandDefaultPos);
      if (this.match(tt.comma)) {
        const node = this.startNodeAt(startPos, startLoc);
        node.expressions = [expr];
        while (this.eat(tt.comma)) {
          node.expressions.push(this.parseMaybeAssign(noIn, refShorthandDefaultPos));
        }
        this.toReferencedList(node.expressions);
        return this.finishNode(node, "SequenceExpression");
      }
      return expr;
    }

parseMaybeAssign(noIn?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined, afterLeftParse?: (this: Parser, node: Node, startPos: number, startLoc: Position | SourceLocation) => Node, refNeedsArrowPos?: StartReference | undefined): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;

      if (this.match(tt._yield) && this.state.inGenerator) {
        let left = this.parseYield();
        if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc);
        return left;
      }

      let failOnShorthandAssign;
      if (refShorthandDefaultPos) {
        failOnShorthandAssign = false;
      } else {
        refShorthandDefaultPos = { start: 0 };
        failOnShorthandAssign = true;
      }

      if (this.match(tt.parenL) || this.match(tt.name)) {
        this.state.potentialArrowAt = this.state.start;
      }

      let left = this.parseMaybeConditional(noIn, refShorthandDefaultPos, refNeedsArrowPos);
      if (afterLeftParse) left = afterLeftParse.call(this, left, startPos, startLoc);
      if (this.state.type.isAssign) {
        const node = this.startNodeAt(startPos, startLoc);
        node.operator = stringValue(this.state.value);
        node.left = this.match(tt.eq) ? present(this.toAssignable(left, undefined, "assignment expression")) : left;
        refShorthandDefaultPos.start = 0; // reset because shorthand default was used correctly

        this.checkLVal(left, undefined, undefined, "assignment expression");

        if (left.extra && left.extra.parenthesized) {
          let errorMsg;
          if (left.type === "ObjectPattern") {
            errorMsg = "`({a}) = 0` use `({a} = 0)`";
          } else if (left.type === "ArrayPattern") {
            errorMsg = "`([a]) = 0` use `([a] = 0)`";
          }
          if (errorMsg) {
            this.raise(left.start, `You're trying to assign to a parenthesized expression, eg. instead of ${errorMsg}`);
          }
        }

        this.next();
        node.right = this.parseMaybeAssign(noIn);
        return this.finishNode(node, "AssignmentExpression");
      } else if (failOnShorthandAssign && refShorthandDefaultPos.start) {
        this.unexpected(refShorthandDefaultPos.start);
      }

      return left;
    }

parseMaybeConditional(noIn: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos: StartReference | undefined): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      const expr = this.parseExprOps(noIn, refShorthandDefaultPos);
      if (refShorthandDefaultPos && refShorthandDefaultPos.start) return expr;

      return this.parseConditional(expr, noIn, startPos, startLoc, refNeedsArrowPos);
    }

parseConditional(expr: Node, noIn: boolean | undefined, startPos: number, startLoc: Position | SourceLocation, refNeedsArrowPos?: StartReference | undefined): Node {
      if (this.eat(tt.question)) {
        const node = this.startNodeAt(startPos, startLoc);
        node.test = expr;
        node.consequent = this.parseMaybeAssign();
        this.expect(tt.colon);
        node.alternate = this.parseMaybeAssign(noIn);
        return this.finishNode(node, "ConditionalExpression");
      }
      return expr;
    }

parseExprOps(noIn: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      const expr = this.parseMaybeUnary(refShorthandDefaultPos);
      if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
        return expr;
      } else {
        return this.parseExprOp(expr, startPos, startLoc, -1, noIn);
      }
    }

parseExprOp(left: Node, leftStartPos: number, leftStartLoc: Position | SourceLocation, minPrec: number, noIn: boolean | undefined): Node {
      const prec = this.state.type.binop;
      if (prec != null && (!noIn || !this.match(tt._in))) {
        if (prec > minPrec) {
          const node = this.startNodeAt(leftStartPos, leftStartLoc);
          node.left = left;
          node.operator = stringValue(this.state.value);

          if (
            node.operator === "**" &&
            left.type === "UnaryExpression" &&
            left.extra &&
            !left.extra.parenthesizedArgument &&
            !left.extra.parenthesized
          ) {
            this.raise(present(left.argument).start, "Illegal expression. Wrap left hand side or entire exponentiation in parentheses.");
          }

          const op = this.state.type;
          this.next();

          const startPos = this.state.start;
          const startLoc = this.state.startLoc;
          node.right = this.parseExprOp(this.parseMaybeUnary(), startPos, startLoc, op.rightAssociative ? prec - 1 : prec, noIn);

          this.finishNode(node, (op === tt.logicalOR || op === tt.logicalAND) ? "LogicalExpression" : "BinaryExpression");
          return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn);
        }
      }
      return left;
    }

parseMaybeUnary(refShorthandDefaultPos?: StartReference | undefined): Node {
      if (this.state.type.prefix) {
        const node = this.startNode();
        const update = this.match(tt.incDec);
        node.operator = stringValue(this.state.value);
        node.prefix = true;
        this.next();

        const argType = this.state.type;
        node.argument = this.parseMaybeUnary();

        this.addExtra(node, "parenthesizedArgument", argType === tt.parenL && (!node.argument.extra || !node.argument.extra.parenthesized));

        if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
          this.unexpected(refShorthandDefaultPos.start);
        }

        if (update) {
          this.checkLVal(node.argument, undefined, undefined, "prefix operation");
        } else if (this.state.strict && node.operator === "delete" && node.argument.type === "Identifier") {
          this.raise(node.start, "Deleting local variable in strict mode");
        }

        return this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
      }

      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      let expr = this.parseExprSubscripts(refShorthandDefaultPos);
      if (refShorthandDefaultPos && refShorthandDefaultPos.start) return expr;
      while (this.state.type.postfix && !this.canInsertSemicolon()) {
        const node = this.startNodeAt(startPos, startLoc);
        node.operator = stringValue(this.state.value);
        node.prefix = false;
        node.argument = expr;
        this.checkLVal(expr, undefined, undefined, "postfix operation");
        this.next();
        expr = this.finishNode(node, "UpdateExpression");
      }
      return expr;
    }

parseExprSubscripts(refShorthandDefaultPos?: StartReference | undefined): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      const potentialArrowAt = this.state.potentialArrowAt;
      const expr = this.parseExprAtom(refShorthandDefaultPos);

      if (expr.type === "ArrowFunctionExpression" && expr.start === potentialArrowAt) {
        return expr;
      }

      if (refShorthandDefaultPos && refShorthandDefaultPos.start) {
        return expr;
      }

      return this.parseSubscripts(expr, startPos, startLoc);
    }

parseSubscripts(base: Node, startPos: number, startLoc: Position | SourceLocation, noCalls?: boolean | undefined): Node {
      for (;;) {
        if (!noCalls && this.eat(tt.doubleColon)) {
          const node = this.startNodeAt(startPos, startLoc);
          node.object = base;
          node.callee = this.parseNoCallExpr();
          return this.parseSubscripts(this.finishNode(node, "BindExpression"), startPos, startLoc, noCalls);
        } else if (this.eat(tt.dot)) {
          const node = this.startNodeAt(startPos, startLoc);
          node.object = base;
          node.property = this.parseIdentifier(true);
          node.computed = false;
          base = this.finishNode(node, "MemberExpression");
        } else if (this.eat(tt.bracketL)) {
          const node = this.startNodeAt(startPos, startLoc);
          node.object = base;
          node.property = this.parseExpression();
          node.computed = true;
          this.expect(tt.bracketR);
          base = this.finishNode(node, "MemberExpression");
        } else if (!noCalls && this.match(tt.parenL)) {
          const possibleAsync = this.state.potentialArrowAt === base.start && base.type === "Identifier" && base.name === "async" && !this.canInsertSemicolon();
          this.next();

          const node = this.startNodeAt(startPos, startLoc);
          node.callee = base;
          node.arguments = this.parseCallExpressionArguments(tt.parenR, possibleAsync);
          if (node.callee.type === "Import" && node.arguments.length !== 1) {
            this.raise(node.start, "import() requires exactly one argument");
          }
          base = this.finishNode(node, "CallExpression");

          if (possibleAsync && this.shouldParseAsyncArrow()) {
            return this.parseAsyncArrowFromCallExpression(this.startNodeAt(startPos, startLoc), node);
          } else {
            this.toReferencedList(node.arguments);
          }
        } else if (this.match(tt.backQuote)) {
          const node = this.startNodeAt(startPos, startLoc);
          node.tag = base;
          node.quasi = this.parseTemplate(true);
          base = this.finishNode(node, "TaggedTemplateExpression");
        } else {
          return base;
        }
      }
    }

parseCallExpressionArguments(close: TokenType, possibleAsyncArrow: boolean | undefined): (Node | null)[] {
      const elts = [];
      let innerParenStart;
      let first = true;

      while (!this.eat(close)) {
        if (first) {
          first = false;
        } else {
          this.expect(tt.comma);
          if (this.eat(close)) break;
        }

        // we need to make sure that if this is an async arrow functions, that we don't allow inner parens inside the params
        if (this.match(tt.parenL) && !innerParenStart) {
          innerParenStart = this.state.start;
        }

        elts.push(this.parseExprListItem(false, possibleAsyncArrow ? { start: 0 } : undefined, possibleAsyncArrow ? { start: 0 } : undefined));
      }

      // we found an async arrow function so let's not allow any inner parens
      if (possibleAsyncArrow && innerParenStart && this.shouldParseAsyncArrow()) {
        this.unexpected();
      }

      return elts;
    }

shouldParseAsyncArrow(): boolean {
      return this.match(tt.arrow);
    }

parseAsyncArrowFromCallExpression(node: Node, call: Node): Node {
      this.expect(tt.arrow);
      return this.parseArrowExpression(node, call.arguments, true);
    }

parseNoCallExpr(): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      return this.parseSubscripts(this.parseExprAtom(), startPos, startLoc, true);
    }

parseExprAtom(refShorthandDefaultPos?: StartReference | undefined): Node {
      const canBeArrow = this.state.potentialArrowAt === this.state.start;
      let node;

      switch (this.state.type) {
        case tt._super:
          if (!this.state.inMethod && !this.options.allowSuperOutsideMethod) {
            this.raise(this.state.start, "'super' outside of function or class");
          }

          node = this.startNode();
          this.next();
          if (!this.match(tt.parenL) && !this.match(tt.bracketL) && !this.match(tt.dot)) {
            this.unexpected();
          }
          if (this.match(tt.parenL) && this.state.inMethod !== "constructor" && !this.options.allowSuperOutsideMethod) {
            this.raise(node.start, "super() is only valid inside a class constructor. Make sure the method name is spelled exactly as 'constructor'.");
          }
          return this.finishNode(node, "Super");

        case tt._import:
          if (!this.hasPlugin("dynamicImport")) this.unexpected();

          node = this.startNode();
          this.next();
          if (!this.match(tt.parenL)) {
            this.unexpected(null, tt.parenL);
          }
          return this.finishNode(node, "Import");

        case tt._this:
          node = this.startNode();
          this.next();
          return this.finishNode(node, "ThisExpression");

        case tt._yield:
          if (this.state.inGenerator) this.unexpected();

        case tt.name:
          node = this.startNode();
          const allowAwait = this.state.value === "await" && this.state.inAsync;
          const allowYield = this.shouldAllowYieldIdentifier();
          const id = this.parseIdentifier(allowAwait || allowYield);

          if (id.name === "await") {
            if (this.state.inAsync || this.inModule) {
              return this.parseAwait(node);
            }
          } else if (id.name === "async" && this.match(tt._function) && !this.canInsertSemicolon()) {
            this.next();
            return this.parseFunction(node, false, false, true);
          } else if (canBeArrow && id.name === "async" && this.match(tt.name)) {
            const params = [this.parseIdentifier()];
            this.expect(tt.arrow);
            // let foo = bar => {};
            return this.parseArrowExpression(node, params, true);
          }

          if (canBeArrow && !this.canInsertSemicolon() && this.eat(tt.arrow)) {
            return this.parseArrowExpression(node, [id]);
          }

          return id;

        case tt._do:
          if (this.hasPlugin("doExpressions")) {
            const node = this.startNode();
            this.next();
            const oldInFunction = this.state.inFunction;
            const oldLabels = this.state.labels;
            this.state.labels = [];
            this.state.inFunction = false;
            node.body = this.parseBlock(false, true);
            this.state.inFunction = oldInFunction;
            this.state.labels = oldLabels;
            return this.finishNode(node, "DoExpression");
          }

        case tt.regexp:
          const value = regexpValue(this.state.value);
          node = this.parseLiteral(value.value, "RegExpLiteral");
          node.pattern = value.pattern;
          node.flags = value.flags;
          return node;

        case tt.num:
          return this.parseLiteral(this.state.value, "NumericLiteral");

        case tt.string:
          return this.parseLiteral(this.state.value, "StringLiteral");

        case tt._null:
          node = this.startNode();
          this.next();
          return this.finishNode(node, "NullLiteral");

        case tt._true: case tt._false:
          node = this.startNode();
          node.value = this.match(tt._true);
          this.next();
          return this.finishNode(node, "BooleanLiteral");

        case tt.parenL:
          return this.parseParenAndDistinguishExpression(null, null, canBeArrow);

        case tt.bracketL:
          node = this.startNode();
          this.next();
          node.elements = this.parseExprList(tt.bracketR, true, refShorthandDefaultPos);
          this.toReferencedList(node.elements);
          return this.finishNode(node, "ArrayExpression");

        case tt.braceL:
          return this.parseObj(false, refShorthandDefaultPos);

        case tt._function:
          return this.parseFunctionExpression();

        case tt.at:
          this.parseDecorators();

        case tt._class:
          node = this.startNode();
          this.takeDecorators(node);
          return this.parseClass(node, false);

        case tt._new:
          return this.parseNew();

        case tt.backQuote:
          return this.parseTemplate(false);

        case tt.doubleColon:
          node = this.startNode();
          this.next();
          node.object = null;
          const callee = node.callee = this.parseNoCallExpr();
          if (callee.type === "MemberExpression") {
            return this.finishNode(node, "BindExpression");
          } else {
            this.raise(callee.start, "Binding should be performed on object property.");
          }

        default:
          this.unexpected();
      }
    }

parseFunctionExpression(): Node {
      const node = this.startNode();
      const meta = this.parseIdentifier(true);
      if (this.state.inGenerator && this.eat(tt.dot) && this.hasPlugin("functionSent")) {
        return this.parseMetaProperty(node, meta, "sent");
      } else {
        return this.parseFunction(node, false);
      }
    }

parseMetaProperty(node: Node, meta: Node, propertyName: string): Node {
      node.meta = meta;
      node.property = this.parseIdentifier(true);

      if (node.property.name !== propertyName) {
        this.raise(node.property.start, `The only valid meta property for new is ${meta.name}.${propertyName}`);
      }

      return this.finishNode(node, "MetaProperty");
    }

parseLiteral(value: NodeValue, type: string, startPos?: number, startLoc?: Position | SourceLocation | null | undefined): Node {
      startPos = startPos || this.state.start;
      startLoc = startLoc || this.state.startLoc;

      const node = this.startNodeAt(startPos, startLoc);
      this.addExtra(node, "rawValue", value);
      this.addExtra(node, "raw", this.input.slice(startPos, this.state.end));
      node.value = value;
      this.next();
      return this.finishNode(node, type);
    }

parseParenExpression(): Node {
      this.expect(tt.parenL);
      const val = this.parseExpression();
      this.expect(tt.parenR);
      return val;
    }

parseParenAndDistinguishExpression(startPos: number | null, startLoc: Position | SourceLocation | null, canBeArrow: boolean | undefined): Node {
      startPos = startPos || this.state.start;
      startLoc = startLoc || this.state.startLoc;

      let val;
      this.expect(tt.parenL);

      const innerStartPos = this.state.start;
      const innerStartLoc = this.state.startLoc;
      const exprList = [];
      const refShorthandDefaultPos = { start: 0 };
      const refNeedsArrowPos = { start: 0 };
      let first = true;
      let spreadStart;
      let optionalCommaStart;

      while (!this.match(tt.parenR)) {
        if (first) {
          first = false;
        } else {
          this.expect(tt.comma, refNeedsArrowPos.start || null);
          if (this.match(tt.parenR)) {
            optionalCommaStart = this.state.start;
            break;
          }
        }

        if (this.match(tt.ellipsis)) {
          const spreadNodeStartPos = this.state.start;
          const spreadNodeStartLoc = this.state.startLoc;
          spreadStart = this.state.start;
          exprList.push(this.parseParenItem(this.parseRest(), spreadNodeStartPos, spreadNodeStartLoc));
          break;
        } else {
          exprList.push(this.parseMaybeAssign(false, refShorthandDefaultPos, this.parseParenItem, refNeedsArrowPos));
        }
      }

      const innerEndPos = this.state.start;
      const innerEndLoc = this.state.startLoc;
      this.expect(tt.parenR);

      let arrowNode: Node | undefined = this.startNodeAt(startPos, startLoc);
      if (canBeArrow && this.shouldParseArrow() && (arrowNode = this.parseArrow(arrowNode))) {
        for (const param of exprList) {
          if (param.extra && param.extra.parenthesized) this.unexpected(param.extra.parenStart);
        }

        return this.parseArrowExpression(present(arrowNode), exprList);
      }

      if (!exprList.length) {
        this.unexpected(this.state.lastTokStart);
      }
      if (optionalCommaStart) this.unexpected(optionalCommaStart);
      if (spreadStart) this.unexpected(spreadStart);
      if (refShorthandDefaultPos.start) this.unexpected(refShorthandDefaultPos.start);
      if (refNeedsArrowPos.start) this.unexpected(refNeedsArrowPos.start);

      if (exprList.length > 1) {
        val = this.startNodeAt(innerStartPos, innerStartLoc);
        val.expressions = exprList;
        this.toReferencedList(val.expressions);
        this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
      } else {
        val = exprList[0];
      }


      this.addExtra(val, "parenthesized", true);
      this.addExtra(val, "parenStart", startPos);

      return val;
    }

shouldParseArrow(): boolean {
      return !this.canInsertSemicolon();
    }

parseArrow(node: Node): Node | undefined {
      if (this.eat(tt.arrow)) {
        return node;
      }
    }

parseParenItem(node: Node, startPos?: number, startLoc?: Position | SourceLocation): Node {
      return node;
    }

parseNew(): Node {
      const node = this.startNode();
      const meta = this.parseIdentifier(true);

      if (this.eat(tt.dot)) {
        const metaProp = this.parseMetaProperty(node, meta, "target");

        if (!this.state.inFunction) {
          this.raise(metaProp.property.start, "new.target can only be used in functions");
        }

        return metaProp;
      }

      node.callee = this.parseNoCallExpr();

      if (this.eat(tt.parenL)) {
        node.arguments = this.parseExprList(tt.parenR);
        this.toReferencedList(node.arguments);
      } else {
        node.arguments = [];
      }

      return this.finishNode(node, "NewExpression");
    }

parseTemplateElement(isTagged: boolean | undefined): Node {
      const elem = this.startNode();
      if (this.state.value === null) {
        if (!isTagged) {
          this.raise(present(this.state.invalidTemplateEscapePosition), "Invalid escape sequence in template");
        } else {
          this.state.invalidTemplateEscapePosition = null;
        }
      }
      elem.value = {
        raw: this.input.slice(this.state.start, this.state.end).replace(/\r\n?/g, "\n"),
        cooked: this.state.value
      };
      this.next();
      elem.tail = this.match(tt.backQuote);
      return this.finishNode(elem, "TemplateElement");
    }

parseTemplate(isTagged: boolean | undefined): Node {
      const node = this.startNode();
      this.next();
      node.expressions = [];
      let curElt = this.parseTemplateElement(isTagged);
      node.quasis = [curElt];
      while (!curElt.tail) {
        this.expect(tt.dollarBraceL);
        node.expressions.push(this.parseExpression());
        this.expect(tt.braceR);
        node.quasis.push(curElt = this.parseTemplateElement(isTagged));
      }
      this.next();
      return this.finishNode(node, "TemplateLiteral");
    }

parseObj(isPattern: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): Node {
      let decorators = [];
      const propHash = Object.create(null);
      let first = true;
      const node = this.startNode();

      node.properties = [];
      this.next();

      let firstRestLocation = null;

      while (!this.eat(tt.braceR)) {
        if (first) {
          first = false;
        } else {
          this.expect(tt.comma);
          if (this.eat(tt.braceR)) break;
        }

        while (this.match(tt.at)) {
          decorators.push(this.parseDecorator());
        }

        let prop = this.startNode(), isGenerator: boolean | undefined = false, isAsync = false, startPos, startLoc;
        if (decorators.length) {
          prop.decorators = decorators;
          decorators = [];
        }

        if (this.hasPlugin("objectRestSpread") && this.match(tt.ellipsis)) {
          prop = this.parseSpread(isPattern ? { start: 0 } : undefined);
          prop.type = isPattern ? "RestElement" : "SpreadElement";
          if (isPattern) this.toAssignable(prop.argument, true, "object pattern");
          node.properties.push(prop);
          if (isPattern) {
            const position = this.state.start;
            if (firstRestLocation !== null) {
              this.unexpected(firstRestLocation, "Cannot have multiple rest elements when destructuring");
            } else if (this.eat(tt.braceR)) {
              break;
            } else if (this.match(tt.comma) && this.lookahead().type === tt.braceR) {
              this.unexpected(position, "A trailing comma is not permitted after the rest element");
            } else {
              firstRestLocation = position;
              continue;
            }
          } else {
            continue;
          }
        }

        prop.method = false;
        prop.shorthand = false;

        if (isPattern || refShorthandDefaultPos) {
          startPos = this.state.start;
          startLoc = this.state.startLoc;
        }

        if (!isPattern) {
          isGenerator = this.eat(tt.star);
        }

        if (!isPattern && this.isContextual("async")) {
          if (isGenerator) this.unexpected();

          const asyncId = this.parseIdentifier();
          if (this.match(tt.colon) || this.match(tt.parenL) || this.match(tt.braceR) || this.match(tt.eq) || this.match(tt.comma)) {
            prop.key = asyncId;
            prop.computed = false;
          } else {
            isAsync = true;
            if (this.hasPlugin("asyncGenerators")) isGenerator = this.eat(tt.star);
            this.parsePropertyName(prop);
          }
        } else {
          this.parsePropertyName(prop);
        }

        this.parseObjPropValue(prop, startPos, startLoc, isGenerator, isAsync, isPattern, refShorthandDefaultPos);
        this.checkPropClash(prop, propHash);

        if (prop.shorthand) {
          this.addExtra(prop, "shorthand", true);
        }

        node.properties.push(prop);
      }

      if (firstRestLocation !== null) {
        this.unexpected(firstRestLocation, "The rest element has to be the last element when destructuring");
      }

      if (decorators.length) {
        this.raise(this.state.start, "You have trailing decorators with no property");
      }

      return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression");
    }

isGetterOrSetterMethod(prop: Node, isPattern: boolean | undefined): boolean | string | undefined {
      return !isPattern &&
        !prop.computed &&
        prop.key.type === "Identifier" &&
        (prop.key.name === "get" || prop.key.name === "set") &&
        (
          this.match(tt.string) || // get "string"() {}
          this.match(tt.num) || // get 1() {}
          this.match(tt.bracketL) || // get ["string"]() {}
          this.match(tt.name) || // get foo() {}
          this.state.type.keyword // get debugger() {}
        );
    }

checkGetterSetterParamCount(method: Node): void {
      const paramCount = method.kind === "get" ? 0 : 1;
      if (method.params.length !== paramCount) {
        const start = method.start;
        if (method.kind === "get") {
          this.raise(start, "getter should have no params");
        } else {
          this.raise(start, "setter should have exactly one param");
        }
      }
    }

parseObjectMethod(prop: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined): Node | undefined {
      if (isAsync || isGenerator || this.match(tt.parenL)) {
        if (isPattern) this.unexpected();
        prop.kind = "method";
        prop.method = true;
        this.parseMethod(prop, isGenerator, isAsync);

        return this.finishNode(prop, "ObjectMethod");
      }

      if (this.isGetterOrSetterMethod(prop, isPattern)) {
        if (isGenerator || isAsync) this.unexpected();
        prop.kind = stringValue(prop.key.name);
        this.parsePropertyName(prop);
        this.parseMethod(prop);
        this.checkGetterSetterParamCount(prop);

        return this.finishNode(prop, "ObjectMethod");
      }
    }

parseObjectProperty(prop: Node, startPos: number | undefined, startLoc: Position | SourceLocation | undefined, isPattern: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node | undefined {
      if (this.eat(tt.colon)) {
        prop.value = isPattern ? this.parseMaybeDefault(this.state.start, this.state.startLoc) : this.parseMaybeAssign(false, refShorthandDefaultPos);

        return this.finishNode(prop, "ObjectProperty");
      }

      if (!prop.computed && prop.key.type === "Identifier") {
        if (isPattern) {
          this.checkReservedWord(prop.key.name, prop.key.start, true, true);
          prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key.__clone());
        } else if (this.match(tt.eq) && refShorthandDefaultPos) {
          if (!refShorthandDefaultPos.start) {
            refShorthandDefaultPos.start = this.state.start;
          }
          prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key.__clone());
        } else {
          prop.value = prop.key.__clone();
        }
        prop.shorthand = true;

        return this.finishNode(prop, "ObjectProperty");
      }
    }

parseObjPropValue(prop: Node, startPos: number | undefined, startLoc: Position | SourceLocation | undefined, isGenerator: boolean | undefined, isAsync: boolean | undefined, isPattern: boolean | undefined, refShorthandDefaultPos: StartReference | undefined): Node | undefined {
      const node =
        this.parseObjectMethod(prop, isGenerator, isAsync, isPattern) ||
        this.parseObjectProperty(prop, startPos, startLoc, isPattern, refShorthandDefaultPos);

      if (!node) this.unexpected();

      return node;
    }

parsePropertyName(prop: Node): Node {
      if (this.eat(tt.bracketL)) {
        prop.computed = true;
        prop.key = this.parseMaybeAssign();
        this.expect(tt.bracketR);
      } else {
        prop.computed = false;
        const oldInPropertyName = this.state.inPropertyName;
        this.state.inPropertyName = true;
        prop.key = (this.match(tt.num) || this.match(tt.string)) ? this.parseExprAtom() : this.parseIdentifier(true);
        this.state.inPropertyName = oldInPropertyName;
      }
      return prop.key;
    }

initFunction(node: Node, isAsync: boolean | undefined): void {
      node.id = null;
      node.generator = false;
      node.expression = false;
      node.async = !!isAsync;
    }

parseMethod(node: Node, isGenerator?: boolean | undefined, isAsync?: boolean | undefined): Node {
      const oldInMethod = this.state.inMethod;
      this.state.inMethod = node.kind || true;
      this.initFunction(node, isAsync);
      this.expect(tt.parenL);
      node.params = this.parseBindingList(tt.parenR);
      node.generator = !!isGenerator;
      this.parseFunctionBody(node);
      this.state.inMethod = oldInMethod;
      return node;
    }

parseArrowExpression(node: Node, params: (Node | null)[], isAsync?: boolean | undefined): Node {
      this.initFunction(node, isAsync);
      node.params = this.toAssignableList(params, true, "arrow function parameters");
      this.parseFunctionBody(node, true);
      return this.finishNode(node, "ArrowFunctionExpression");
    }

isStrictBody(node: Node, isExpression: boolean | undefined): boolean {
      if (!isExpression && nodeValue(node.body).directives.length) {
        for (const directive of (nodeValue(node.body).directives)) {
          if (nodeValue(directive.value).value === "use strict") {
            return true;
          }
        }
      }

      return false;
    }

parseFunctionBody(node: Node, allowExpression?: boolean | undefined): void {
      const isExpression = allowExpression && !this.match(tt.braceL);

      const oldInAsync = this.state.inAsync;
      this.state.inAsync = node.async;
      if (isExpression) {
        node.body = this.parseMaybeAssign();
        node.expression = true;
      } else {
        // Start a new scope with regard to labels and the `inFunction`
        // flag (restore them to their old value afterwards).
        const oldInFunc = this.state.inFunction;
        const oldInGen = this.state.inGenerator;
        const oldLabels = this.state.labels;
        this.state.inFunction = true; this.state.inGenerator = node.generator; this.state.labels = [];
        node.body = this.parseBlock(true);
        node.expression = false;
        this.state.inFunction = oldInFunc; this.state.inGenerator = oldInGen; this.state.labels = oldLabels;
      }
      this.state.inAsync = oldInAsync;

      // If this is a strict mode function, verify that argument names
      // are not repeated, and it does not try to bind the words `eval`
      // or `arguments`.
      const isStrict = this.isStrictBody(node, isExpression);
      // Also check when allowExpression === true for arrow functions
      const checkLVal = this.state.strict || allowExpression || isStrict;

      if (isStrict && node.id && node.id.type === "Identifier" && node.id.name === "yield") {
        this.raise(node.id.start, "Binding yield in strict mode");
      }

      if (checkLVal) {
        const nameHash = Object.create(null);
        const oldStrict = this.state.strict;
        if (isStrict) this.state.strict = true;
        if (node.id) {
          this.checkLVal(node.id, true, undefined, "function name");
        }
        for (const parameter of (node.params)) {
          const param = present(parameter);
          if (isStrict && param.type !== "Identifier") {
            this.raise(param.start, "Non-simple parameter in strict mode");
          }
          this.checkLVal(param, true, nameHash, "function parameter list");
        }
        this.state.strict = oldStrict;
      }
    }

parseExprList(close: TokenType, allowEmpty?: boolean | undefined, refShorthandDefaultPos?: StartReference | undefined): (Node | null)[] {
      const elts = [];
      let first = true;

      while (!this.eat(close)) {
        if (first) {
          first = false;
        } else {
          this.expect(tt.comma);
          if (this.eat(close)) break;
        }

        elts.push(this.parseExprListItem(allowEmpty, refShorthandDefaultPos));
      }
      return elts;
    }

parseExprListItem(allowEmpty: boolean | undefined, refShorthandDefaultPos: StartReference | undefined, refNeedsArrowPos?: StartReference | undefined): Node | null {
      let elt;
      if (allowEmpty && this.match(tt.comma)) {
        elt = null;
      } else if (this.match(tt.ellipsis)) {
        elt = this.parseSpread(refShorthandDefaultPos);
      } else {
        elt = this.parseMaybeAssign(false, refShorthandDefaultPos, this.parseParenItem, refNeedsArrowPos);
      }
      return elt;
    }

parseIdentifier(liberal?: boolean | undefined, isBinding?: boolean | undefined): Node {
      const node = this.startNode();
      if (!liberal) {
        this.checkReservedWord(stringValue(this.state.value), this.state.start, !!this.state.type.keyword, false);
      }

      if (this.match(tt.name)) {
        node.name = stringValue(this.state.value);
      } else if (this.state.type.keyword) {
        node.name = this.state.type.keyword;
      } else {
        this.unexpected();
      }

      if (!liberal && node.name === "await" && this.state.inAsync) {
        this.raise(node.start, "invalid use of await inside of an async function");
      }

      node.loc.identifierName = node.name;

      this.next();
      return this.finishNode(node, "Identifier");
    }

checkReservedWord(wordValue: string | Node | null, startLoc: number, checkKeywords: boolean | undefined, isBinding: boolean | undefined): void {
      const word = stringValue(wordValue);
      if (this.isReservedWord(word) || (checkKeywords && this.isKeyword(word))) {
        this.raise(startLoc, word + " is a reserved word");
      }

      if (this.state.strict && (reservedWords.strict(word) || (isBinding && reservedWords.strictBind(word)))) {
        this.raise(startLoc, word + " is a reserved word in strict mode");
      }
    }

parseAwait(node: Node): Node {
      // istanbul ignore next: this condition is checked at the call site so won't be hit here
      if (!this.state.inAsync) {
        this.unexpected();
      }
      if (this.match(tt.star)) {
        this.raise(node.start, "await* has been removed from the async functions proposal. Use Promise.all() instead.");
      }
      node.argument = this.parseMaybeUnary();
      return this.finishNode(node, "AwaitExpression");
    }

parseYield(): Node {
      const node = this.startNode();
      this.next();
      if (
        this.match(tt.semi) ||
        this.canInsertSemicolon() ||
        (!this.match(tt.star) && !this.state.type.startsExpr)
      ) {
        node.delegate = false;
        node.argument = null;
      } else {
        node.delegate = this.eat(tt.star);
        node.argument = this.parseMaybeAssign();
      }
      return this.finishNode(node, "YieldExpression");
    }

raise(pos: number, message: string): never {
      const loc = getLineInfo(this.input, pos);
      message += ` (${loc.line}:${loc.column})`;
      const err: PositionedSyntaxError = new SyntaxError(message);
      err.pos = pos;
      err.loc = loc;
      throw err;
    }

toAssignable(node: Node | null, isBinding: boolean | undefined, contextDescription: string): Node | null {
      if (node) {
        switch (node.type) {
          case "Identifier":
          case "ObjectPattern":
          case "ArrayPattern":
          case "AssignmentPattern":
            break;

          case "ObjectExpression":
            node.type = "ObjectPattern";
            for (const prop of (node.properties)) {
              if (prop.type === "ObjectMethod") {
                if (prop.kind === "get" || prop.kind === "set") {
                  this.raise(prop.key.start, "Object pattern can't contain getter or setter");
                } else {
                  this.raise(prop.key.start, "Object pattern can't contain methods");
                }
              } else {
                this.toAssignable(prop, isBinding, "object destructuring pattern");
              }
            }
            break;

          case "ObjectProperty":
            this.toAssignable(nodeValue(node.value), isBinding, contextDescription);
            break;

          case "SpreadElement":
            node.type = "RestElement";
            break;

          case "ArrayExpression":
            node.type = "ArrayPattern";
            this.toAssignableList(node.elements, isBinding, contextDescription);
            break;

          case "AssignmentExpression":
            if (node.operator === "=") {
              node.type = "AssignmentPattern";
              removeField(node, "operator");
            } else {
              this.raise(node.left.end, "Only '=' operator can be used for specifying default value.");
            }
            break;

          case "MemberExpression":
            if (!isBinding) break;

          default: {
            const message = "Invalid left-hand side" +
              (contextDescription ? " in " + contextDescription : /* istanbul ignore next */ "expression");
            this.raise(node.start, message);
          }
        }
      }
      return node;
    }

toAssignableList(exprList: (Node | null)[], isBinding: boolean | undefined, contextDescription: string): (Node | null)[] {
      let end = exprList.length;
      if (end) {
        const last = exprList[end - 1];
        if (last && last.type === "RestElement") {
          --end;
        } else if (last && last.type === "SpreadElement") {
          last.type = "RestElement";
          const arg = present(last.argument);
          this.toAssignable(arg, isBinding, contextDescription);
          if (arg.type !== "Identifier" && arg.type !== "MemberExpression" && arg.type !== "ArrayPattern") {
            this.unexpected(arg.start);
          }
          --end;
        }
      }
      for (let i = 0; i < end; i++) {
        const elt = exprList[i];
        if (elt && elt.type === "SpreadElement")
          this.raise(elt.start, "The rest element has to be the last element when destructuring");
        if (elt) this.toAssignable(elt, isBinding, contextDescription);
      }
      return exprList;
    }

toReferencedList(exprList: (Node | null)[]): (Node | null)[] {
      return exprList;
    }

parseSpread(refShorthandDefaultPos: StartReference | undefined): Node {
      const node = this.startNode();
      this.next();
      node.argument = this.parseMaybeAssign(false, refShorthandDefaultPos);
      return this.finishNode(node, "SpreadElement");
    }

parseRest(): Node {
      const node = this.startNode();
      this.next();
      node.argument = this.parseBindingIdentifier();
      return this.finishNode(node, "RestElement");
    }

shouldAllowYieldIdentifier(): boolean {
      return this.match(tt._yield) && !this.state.strict && !this.state.inGenerator;
    }

parseBindingIdentifier(): Node {
      return this.parseIdentifier(this.shouldAllowYieldIdentifier());
    }

parseBindingAtom(): Node {
      switch (this.state.type) {
        case tt._yield:
          if (this.state.strict || this.state.inGenerator) this.unexpected();
          // fall-through
        case tt.name:
          return this.parseIdentifier(true);

        case tt.bracketL:
          const node = this.startNode();
          this.next();
          node.elements = this.parseBindingList(tt.bracketR, true);
          return this.finishNode(node, "ArrayPattern");

        case tt.braceL:
          return this.parseObj(true);

        default:
          this.unexpected();
      }
    }

parseBindingList(close: TokenType, allowEmpty?: boolean | undefined): (Node | null)[] {
      const elts = [];
      let first = true;
      while (!this.eat(close)) {
        if (first) {
          first = false;
        } else {
          this.expect(tt.comma);
        }
        if (allowEmpty && this.match(tt.comma)) {
          elts.push(null);
        } else if (this.eat(close)) {
          break;
        } else if (this.match(tt.ellipsis)) {
          elts.push(this.parseAssignableListItemTypes(this.parseRest()));
          this.expect(close);
          break;
        } else {
          const decorators = [];
          while (this.match(tt.at)) {
            decorators.push(this.parseDecorator());
          }
          const left = this.parseMaybeDefault();
          if (decorators.length) {
            left.decorators = decorators;
          }
          this.parseAssignableListItemTypes(left);
          elts.push(this.parseMaybeDefault(left.start, left.loc.start, left));
        }
      }
      return elts;
    }

parseAssignableListItemTypes(param: Node): Node {
      return param;
    }

parseMaybeDefault(startPos?: number, startLoc?: Position | SourceLocation | null | undefined, left?: Node): Node {
      startLoc = startLoc || this.state.startLoc;
      startPos = startPos || this.state.start;
      left = left || this.parseBindingAtom();
      if (!this.eat(tt.eq)) return left;

      const node = this.startNodeAt(startPos, startLoc);
      node.left = left;
      node.right = this.parseMaybeAssign();
      return this.finishNode(node, "AssignmentPattern");
    }

checkLVal(expr: Node, isBinding: boolean | undefined, checkClashes: Record<string, boolean> | undefined, contextDescription: string): void {
      switch (expr.type) {
        case "Identifier":
          this.checkReservedWord(expr.name, expr.start, false, true);

          if (checkClashes) {
            // we need to prefix this with an underscore for the cases where we have a key of
            // `__proto__`. there's a bug in old V8 where the following wouldn't work:
            //
            //   > var obj = Object.create(null);
            //   undefined
            //   > obj.__proto__
            //   null
            //   > obj.__proto__ = true;
            //   true
            //   > obj.__proto__
            //   null
            const key = `_${expr.name}`;

            if (checkClashes[key]) {
              this.raise(expr.start, "Argument name clash in strict mode");
            } else {
              checkClashes[key] = true;
            }
          }
          break;

        case "MemberExpression":
          if (isBinding) this.raise(expr.start, (isBinding ? "Binding" : "Assigning to") + " member expression");
          break;

        case "ObjectPattern":
          for (let prop of (expr.properties)) {
            if (prop.type === "ObjectProperty") prop = nodeValue(prop.value);
            this.checkLVal(prop, isBinding, checkClashes, "object destructuring pattern");
          }
          break;

        case "ArrayPattern":
          for (const elem of (expr.elements)) {
            if (elem) this.checkLVal(elem, isBinding, checkClashes, "array destructuring pattern");
          }
          break;

        case "AssignmentPattern":
          this.checkLVal(expr.left, isBinding, checkClashes, "assignment pattern");
          break;

        case "RestElement":
          this.checkLVal(present(expr.argument), isBinding, checkClashes, "rest element");
          break;

        default: {
          const message = (isBinding ? /* istanbul ignore next */ "Binding invalid" : "Invalid") +
            " left-hand side" +
            (contextDescription ? " in " + contextDescription : /* istanbul ignore next */ "expression");
          this.raise(expr.start, message);
        }
      }
    }

startNode(): Node {
      return new Node(this, this.state.start, this.state.startLoc);
    }

startNodeAt(pos: number, loc: Position | SourceLocation | null | undefined): Node {
      return new Node(this, pos, present(loc));
    }

finishNode(node: Node, type: string): Node {
      return finishNodeAt.call(this, node, type, this.state.lastTokEnd, this.state.lastTokEndLoc);
    }

finishNodeAt(node: Node, type: string, pos: number, loc: Position | SourceLocation | null | undefined): Node {
      return finishNodeAt.call(this, node, type, pos, loc);
    }

resetStartLocationFromNode(node: Node, locationNode: Node): Node {
      node.start = locationNode.start;
      node.loc.start = locationNode.loc.start;
      if (this.options.ranges) node.range[0] = locationNode.range[0];

      return node;
    }

parseTopLevel(file: Node, program: Node): Node {
      program.sourceType = this.options.sourceType;

      this.parseBlockBody(program, true, true, tt.eof);

      file.program  = this.finishNode(program, "Program");
      file.comments = this.state.comments;
      file.tokens   = this.state.tokens;

      return this.finishNode(file, "File");
    }

stmtToDirective(stmt: Node): Node {
      const expr = nodeValue(stmt.expression);

      const directiveLiteral = this.startNodeAt(expr.start, expr.loc.start);
      const directive        = this.startNodeAt(stmt.start, stmt.loc.start);

      const raw = this.input.slice(expr.start, expr.end);
      const val = directiveLiteral.value = raw.slice(1, -1); // remove quotes

      this.addExtra(directiveLiteral, "raw", raw);
      this.addExtra(directiveLiteral, "rawValue", val);

      directive.value = this.finishNodeAt(directiveLiteral, "DirectiveLiteral", expr.end, expr.loc.end);

      return this.finishNodeAt(directive, "Directive", stmt.end, stmt.loc.end);
    }

parseStatement(declaration: boolean | undefined, topLevel?: boolean | undefined): Node {
      if (this.match(tt.at)) {
        this.parseDecorators(true);
      }

      const starttype = this.state.type;
      const node = this.startNode();

      // Most types of statements are recognized by the keyword they
      // start with. Many are trivial to parse, some require a bit of
      // complexity.

      switch (starttype) {
        case tt._break: case tt._continue: return this.parseBreakContinueStatement(node, starttype.keyword);
        case tt._debugger: return this.parseDebuggerStatement(node);
        case tt._do: return this.parseDoStatement(node);
        case tt._for: return this.parseForStatement(node);
        case tt._function:
          if (!declaration) this.unexpected();
          return this.parseFunctionStatement(node);

        case tt._class:
          if (!declaration) this.unexpected();
          return this.parseClass(node, true);

        case tt._if: return this.parseIfStatement(node);
        case tt._return: return this.parseReturnStatement(node);
        case tt._switch: return this.parseSwitchStatement(node);
        case tt._throw: return this.parseThrowStatement(node);
        case tt._try: return this.parseTryStatement(node);

        case tt._let:
        case tt._const:
          if (!declaration) this.unexpected(); // NOTE: falls through to _var

        case tt._var:
          return this.parseVarStatement(node, starttype);

        case tt._while: return this.parseWhileStatement(node);
        case tt._with: return this.parseWithStatement(node);
        case tt.braceL: return this.parseBlock();
        case tt.semi: return this.parseEmptyStatement(node);
        case tt._export:
        case tt._import:
          if (this.hasPlugin("dynamicImport") && this.lookahead().type === tt.parenL) break;

          if (!this.options.allowImportExportEverywhere) {
            if (!topLevel) {
              this.raise(this.state.start, "'import' and 'export' may only appear at the top level");
            }

            if (!this.inModule) {
              this.raise(this.state.start, "'import' and 'export' may appear only with 'sourceType: module'");
            }
          }
          return starttype === tt._import ? this.parseImport(node) : this.parseExport(node);

        case tt.name:
          if (this.state.value === "async") {
            // peek ahead and see if next token is a function
            const state = this.state.clone();
            this.next();
            if (this.match(tt._function) && !this.canInsertSemicolon()) {
              this.expect(tt._function);
              return this.parseFunction(node, true, false, true);
            } else {
              this.state = state;
            }
          }
      }

      // If the statement does not start with a statement keyword or a
      // brace, it's an ExpressionStatement or LabeledStatement. We
      // simply start parsing an expression, and afterwards, if the
      // next token is a colon and the expression was a simple
      // Identifier node, we switch to interpreting it as a label.
      const maybeName = this.state.value;
      const expr = this.parseExpression();

      if (starttype === tt.name && expr.type === "Identifier" && this.eat(tt.colon)) {
        return this.parseLabeledStatement(node, stringValue(maybeName), expr);
      } else {
        return this.parseExpressionStatement(node, expr);
      }
    }

takeDecorators(node: Node): void {
      if (this.state.decorators.length) {
        node.decorators = this.state.decorators;
        this.state.decorators = [];
      }
    }

parseDecorators(allowExport?: boolean | undefined): void {
      while (this.match(tt.at)) {
        const decorator = this.parseDecorator();
        this.state.decorators.push(decorator);
      }

      if (allowExport && this.match(tt._export)) {
        return;
      }

      if (!this.match(tt._class)) {
        this.raise(this.state.start, "Leading decorators must be attached to a class declaration");
      }
    }

parseDecorator(): Node {
      if (!this.hasPlugin("decorators")) {
        this.unexpected();
      }
      const node = this.startNode();
      this.next();
      node.expression = this.parseMaybeAssign();
      return this.finishNode(node, "Decorator");
    }

parseBreakContinueStatement(node: Node, keyword: string | undefined): Node {
      const isBreak = keyword === "break";
      this.next();

      if (this.isLineTerminator()) {
        node.label = null;
      } else if (!this.match(tt.name)) {
        this.unexpected();
      } else {
        node.label = this.parseIdentifier();
        this.semicolon();
      }

      // Verify that there is an actual destination to break or
      // continue to.
      let i;
      for (i = 0; i < this.state.labels.length; ++i) {
        const lab = this.state.labels[i];
        if (node.label == null || lab.name === node.label.name) {
          if (lab.kind != null && (isBreak || lab.kind === "loop")) break;
          if (node.label && isBreak) break;
        }
      }
      if (i === this.state.labels.length) this.raise(node.start, "Unsyntactic " + keyword);
      return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
    }

parseDebuggerStatement(node: Node): Node {
      this.next();
      this.semicolon();
      return this.finishNode(node, "DebuggerStatement");
    }

parseDoStatement(node: Node): Node {
      this.next();
      this.state.labels.push(loopLabel);
      node.body = this.parseStatement(false);
      this.state.labels.pop();
      this.expect(tt._while);
      node.test = this.parseParenExpression();
      this.eat(tt.semi);
      return this.finishNode(node, "DoWhileStatement");
    }

parseForStatement(node: Node): Node {
      this.next();
      this.state.labels.push(loopLabel);

      let forAwait = false;
      if (this.hasPlugin("asyncGenerators") && this.state.inAsync && this.isContextual("await")) {
        forAwait = true;
        this.next();
      }
      this.expect(tt.parenL);

      if (this.match(tt.semi)) {
        if (forAwait) {
          this.unexpected();
        }
        return this.parseFor(node, null);
      }

      if (this.match(tt._var) || this.match(tt._let) || this.match(tt._const)) {
        const init = this.startNode();
        const varKind = this.state.type;
        this.next();
        this.parseVar(init, true, varKind);
        this.finishNode(init, "VariableDeclaration");

        if (this.match(tt._in) || this.isContextual("of")) {
          if (init.declarations.length === 1 && !init.declarations[0].init) {
            return this.parseForIn(node, init, forAwait);
          }
        }
        if (forAwait) {
          this.unexpected();
        }
        return this.parseFor(node, init);
      }

      const refShorthandDefaultPos = { start: 0 };
      const init = this.parseExpression(true, refShorthandDefaultPos);
      if (this.match(tt._in) || this.isContextual("of")) {
        const description = this.isContextual("of") ? "for-of statement" : "for-in statement";
        this.toAssignable(init, undefined, description);
        this.checkLVal(init, undefined, undefined, description);
        return this.parseForIn(node, init, forAwait);
      } else if (refShorthandDefaultPos.start) {
        this.unexpected(refShorthandDefaultPos.start);
      }
      if (forAwait) {
        this.unexpected();
      }
      return this.parseFor(node, init);
    }

parseFunctionStatement(node: Node): Node {
      this.next();
      return this.parseFunction(node, true);
    }

parseIfStatement(node: Node): Node {
      this.next();
      node.test = this.parseParenExpression();
      node.consequent = this.parseStatement(false);
      node.alternate = this.eat(tt._else) ? this.parseStatement(false) : null;
      return this.finishNode(node, "IfStatement");
    }

parseReturnStatement(node: Node): Node {
      if (!this.state.inFunction && !this.options.allowReturnOutsideFunction) {
        this.raise(this.state.start, "'return' outside of function");
      }

      this.next();

      // In `return` (and `break`/`continue`), the keywords with
      // optional arguments, we eagerly look for a semicolon or the
      // possibility to insert one.

      if (this.isLineTerminator()) {
        node.argument = null;
      } else {
        node.argument = this.parseExpression();
        this.semicolon();
      }

      return this.finishNode(node, "ReturnStatement");
    }

parseSwitchStatement(node: Node): Node {
      this.next();
      node.discriminant = this.parseParenExpression();
      node.cases = [];
      this.expect(tt.braceL);
      this.state.labels.push(switchLabel);

      // Statements under must be grouped (by label) in SwitchCase
      // nodes. `cur` is used to keep the node that we are currently
      // adding statements to.

      let cur;
      for (let sawDefault; !this.match(tt.braceR); ) {
        if (this.match(tt._case) || this.match(tt._default)) {
          const isCase = this.match(tt._case);
          if (cur) this.finishNode(cur, "SwitchCase");
          node.cases.push(cur = this.startNode());
          cur.consequent = [];
          this.next();
          if (isCase) {
            cur.test = this.parseExpression();
          } else {
            if (sawDefault) this.raise(this.state.lastTokStart, "Multiple default clauses");
            sawDefault = true;
            cur.test = null;
          }
          this.expect(tt.colon);
        } else {
          if (cur) {
            nodeArray(cur.consequent).push(this.parseStatement(true));
          } else {
            this.unexpected();
          }
        }
      }
      if (cur) this.finishNode(cur, "SwitchCase");
      this.next(); // Closing brace
      this.state.labels.pop();
      return this.finishNode(node, "SwitchStatement");
    }

parseThrowStatement(node: Node): Node {
      this.next();
      if (lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start)))
        this.raise(this.state.lastTokEnd, "Illegal newline after throw");
      node.argument = this.parseExpression();
      this.semicolon();
      return this.finishNode(node, "ThrowStatement");
    }

parseTryStatement(node: Node): Node {
      this.next();

      node.block = this.parseBlock();
      node.handler = null;

      if (this.match(tt._catch)) {
        const clause = this.startNode();
        this.next();

        this.expect(tt.parenL);
        clause.param = this.parseBindingAtom();
        this.checkLVal(clause.param, true, Object.create(null), "catch clause");
        this.expect(tt.parenR);

        clause.body = this.parseBlock();
        node.handler = this.finishNode(clause, "CatchClause");
      }

      node.guardedHandlers = empty;
      node.finalizer = this.eat(tt._finally) ? this.parseBlock() : null;

      if (!node.handler && !node.finalizer) {
        this.raise(node.start, "Missing catch or finally clause");
      }

      return this.finishNode(node, "TryStatement");
    }

parseVarStatement(node: Node, kind: TokenType): Node {
      this.next();
      this.parseVar(node, false, kind);
      this.semicolon();
      return this.finishNode(node, "VariableDeclaration");
    }

parseWhileStatement(node: Node): Node {
      this.next();
      node.test = this.parseParenExpression();
      this.state.labels.push(loopLabel);
      node.body = this.parseStatement(false);
      this.state.labels.pop();
      return this.finishNode(node, "WhileStatement");
    }

parseWithStatement(node: Node): Node {
      if (this.state.strict) this.raise(this.state.start, "'with' in strict mode");
      this.next();
      node.object = this.parseParenExpression();
      node.body = this.parseStatement(false);
      return this.finishNode(node, "WithStatement");
    }

parseEmptyStatement(node: Node): Node {
      this.next();
      return this.finishNode(node, "EmptyStatement");
    }

parseLabeledStatement(node: Node, maybeName: string, expr: Node): Node {
      for (const label of (this.state.labels)) {
        if (label.name === maybeName) {
          this.raise(expr.start, `Label '${maybeName}' is already declared`);
        }
      }

      const kind = this.state.type.isLoop ? "loop" : this.match(tt._switch) ? "switch" : null;
      for (let i = this.state.labels.length - 1; i >= 0; i--) {
        const label = this.state.labels[i];
        if (label.statementStart === node.start) {
          label.statementStart = this.state.start;
          label.kind = kind;
        } else {
          break;
        }
      }

      this.state.labels.push({ name: maybeName, kind: kind, statementStart: this.state.start });
      node.body = this.parseStatement(true);
      this.state.labels.pop();
      node.label = expr;
      return this.finishNode(node, "LabeledStatement");
    }

parseExpressionStatement(node: Node, expr: Node): Node {
      node.expression = expr;
      this.semicolon();
      return this.finishNode(node, "ExpressionStatement");
    }

parseBlock(allowDirectives?: boolean | undefined, _topLevel?: boolean): Node {
      const node = this.startNode();
      this.expect(tt.braceL);
      this.parseBlockBody(node, allowDirectives, false, tt.braceR);
      return this.finishNode(node, "BlockStatement");
    }

isValidDirective(stmt: Node): boolean {
      return stmt.type === "ExpressionStatement" &&
        nodeValue(stmt.expression).type === "StringLiteral" &&
        !present(nodeValue(stmt.expression).extra).parenthesized;
    }

parseBlockBody(node: Node, allowDirectives: boolean | undefined, topLevel: boolean | undefined, end: TokenType): void {
      node.body = [];
      node.directives = [];

      let parsedNonDirective = false;
      let oldStrict;
      let octalPosition;

      while (!this.eat(end)) {
        if (!parsedNonDirective && this.state.containsOctal && !octalPosition) {
          octalPosition = this.state.octalPosition;
        }

        const stmt = this.parseStatement(true, topLevel);

        if (allowDirectives && !parsedNonDirective && this.isValidDirective(stmt)) {
          const directive = this.stmtToDirective(stmt);
          node.directives.push(directive);

          if (oldStrict === undefined && nodeValue(directive.value).value === "use strict") {
            oldStrict = this.state.strict;
            this.setStrict(true);

            if (octalPosition) {
              this.raise(octalPosition, "Octal literal in strict mode");
            }
          }

          continue;
        }

        parsedNonDirective = true;
        node.body.push(stmt);
      }

      if (oldStrict === false) {
        this.setStrict(false);
      }
    }

parseFor(node: Node, init: Node | null): Node {
      node.init = init;
      this.expect(tt.semi);
      node.test = this.match(tt.semi) ? null : this.parseExpression();
      this.expect(tt.semi);
      node.update = this.match(tt.parenR) ? null : this.parseExpression();
      this.expect(tt.parenR);
      node.body = this.parseStatement(false);
      this.state.labels.pop();
      return this.finishNode(node, "ForStatement");
    }

parseForIn(node: Node, init: Node, forAwait: boolean | undefined): Node {
      const type = this.match(tt._in) ? "ForInStatement" : "ForOfStatement";
      if (forAwait) {
        this.eatContextual("of");
      } else {
        this.next();
      }
      node.await = !!forAwait;
      node.left = init;
      node.right = this.parseExpression();
      this.expect(tt.parenR);
      node.body = this.parseStatement(false);
      this.state.labels.pop();
      return this.finishNode(node, type);
    }

parseVar(node: Node, isFor: boolean | undefined, kind: TokenType): Node {
      node.declarations = [];
      node.kind = kind.keyword;
      for (;;) {
        const decl = this.startNode();
        this.parseVarHead(decl);
        if (this.eat(tt.eq)) {
          decl.init = this.parseMaybeAssign(isFor);
        } else if (kind === tt._const && !(this.match(tt._in) || this.isContextual("of"))) {
          this.unexpected();
        } else if (present(decl.id).type !== "Identifier" && !(isFor && (this.match(tt._in) || this.isContextual("of")))) {
          this.raise(this.state.lastTokEnd, "Complex binding patterns require an initialization value");
        } else {
          decl.init = null;
        }
        node.declarations.push(this.finishNode(decl, "VariableDeclarator"));
        if (!this.eat(tt.comma)) break;
      }
      return node;
    }

parseVarHead(decl: Node): void {
      decl.id = this.parseBindingAtom();
      this.checkLVal(decl.id, true, undefined, "variable declaration");
    }

parseFunction(node: Node, isStatement: boolean | number, allowExpressionBody?: boolean | undefined, isAsync?: boolean | undefined, optionalId?: boolean | undefined): Node {
      const oldInMethod = this.state.inMethod;
      this.state.inMethod = false;

      this.initFunction(node, isAsync);

      if (this.match(tt.star)) {
        if (node.async && !this.hasPlugin("asyncGenerators")) {
          this.unexpected();
        } else {
          node.generator = true;
          this.next();
        }
      }

      if (isStatement && !optionalId && !this.match(tt.name) && !this.match(tt._yield)) {
        this.unexpected();
      }

      if (this.match(tt.name) || this.match(tt._yield)) {
        node.id = this.parseBindingIdentifier();
      }

      this.parseFunctionParams(node);
      this.parseFunctionBody(node, allowExpressionBody);

      this.state.inMethod = oldInMethod;

      return this.finishNode(node, isStatement ? "FunctionDeclaration" : "FunctionExpression");
    }

parseFunctionParams(node: Node): void {
      this.expect(tt.parenL);
      node.params = this.parseBindingList(tt.parenR);
    }

parseClass(node: Node, isStatement: boolean | number, optionalId?: boolean | undefined): Node {
      this.next();
      this.takeDecorators(node);
      this.parseClassId(node, isStatement, optionalId);
      this.parseClassSuper(node);
      this.parseClassBody(node);
      return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
    }

isClassProperty(): boolean {
      return this.match(tt.eq) || this.match(tt.semi) || this.match(tt.braceR);
    }

isClassMethod(): boolean {
      return this.match(tt.parenL);
    }

isNonstaticConstructor(method: Node): boolean {
      return !method.computed && !method.static && (
        (method.key.name === "constructor") || // Identifier
        (method.key.value === "constructor")   // Literal
      );
    }

parseClassBody(node: Node): void {
      // class bodies are implicitly strict
      const oldStrict = this.state.strict;
      this.state.strict = true;

      let hadConstructor = false;
      let decorators = [];
      const classBody = this.startNode();

      classBody.body = [];

      this.expect(tt.braceL);

      while (!this.eat(tt.braceR)) {
        if (this.eat(tt.semi)) {
          if (decorators.length > 0) {
            this.raise(this.state.lastTokEnd, "Decorators must not be followed by a semicolon");
          }
          continue;
        }

        if (this.match(tt.at)) {
          decorators.push(this.parseDecorator());
          continue;
        }

        const method = this.startNode();

        // steal the decorators if there are any
        if (decorators.length) {
          method.decorators = decorators;
          decorators = [];
        }

        method.static = false;
        if (this.match(tt.name) && this.state.value === "static") {
          const key = this.parseIdentifier(true); // eats 'static'
          if (this.isClassMethod()) {
            // a method named 'static'
            method.kind = "method";
            method.computed = false;
            method.key = key;
            this.parseClassMethod(classBody, method, false, false);
            continue;
          } else if (this.isClassProperty()) {
            // a property named 'static'
            method.computed = false;
            method.key = key;
            nodeArray(classBody.body).push(this.parseClassProperty(method));
            continue;
          }
          // otherwise something static
          method.static = true;
        }

        if (this.eat(tt.star)) {
          // a generator
          method.kind = "method";
          this.parsePropertyName(method);
          if (this.isNonstaticConstructor(method)) {
            this.raise(method.key.start, "Constructor can't be a generator");
          }
          if (!method.computed && method.static && (method.key.name === "prototype" || method.key.value === "prototype")) {
            this.raise(method.key.start, "Classes may not have static property named prototype");
          }
          this.parseClassMethod(classBody, method, true, false);
        } else {
          const isSimple = this.match(tt.name);
          const key = this.parsePropertyName(method);
          if (!method.computed && method.static && (method.key.name === "prototype" || method.key.value === "prototype")) {
            this.raise(method.key.start, "Classes may not have static property named prototype");
          }
          if (this.isClassMethod()) {
            // a normal method
            if (this.isNonstaticConstructor(method)) {
              if (hadConstructor) {
                this.raise(key.start, "Duplicate constructor in the same class");
              } else if (method.decorators) {
                this.raise(method.start, "You can't attach decorators to a class constructor");
              }
              hadConstructor = true;
              method.kind = "constructor";
            } else {
              method.kind = "method";
            }
            this.parseClassMethod(classBody, method, false, false);
          } else if (this.isClassProperty()) {
            // a normal property
            if (this.isNonstaticConstructor(method)) {
              this.raise(method.key.start, "Classes may not have a non-static field named 'constructor'");
            }
            nodeArray(classBody.body).push(this.parseClassProperty(method));
          } else if (isSimple && key.name === "async" && !this.isLineTerminator()) {
            // an async method
            const isGenerator = this.hasPlugin("asyncGenerators") && this.eat(tt.star);
            method.kind = "method";
            this.parsePropertyName(method);
            if (this.isNonstaticConstructor(method)) {
              this.raise(method.key.start, "Constructor can't be an async function");
            }
            this.parseClassMethod(classBody, method, isGenerator, true);
          } else if (isSimple && (key.name === "get" || key.name === "set") && !(this.isLineTerminator() && this.match(tt.star))) { // `get\n*` is an uninitialized property named 'get' followed by a generator.
            // a getter or setter
            method.kind = key.name;
            this.parsePropertyName(method);
            if (this.isNonstaticConstructor(method)) {
              this.raise(method.key.start, "Constructor can't have get/set modifier");
            }
            this.parseClassMethod(classBody, method, false, false);
            this.checkGetterSetterParamCount(method);
          } else if (this.isLineTerminator()) {
            // an uninitialized class property (due to ASI, since we don't otherwise recognize the next token)
            if (this.isNonstaticConstructor(method)) {
              this.raise(method.key.start, "Classes may not have a non-static field named 'constructor'");
            }
            nodeArray(classBody.body).push(this.parseClassProperty(method));
          } else {
            this.unexpected();
          }
        }
      }

      if (decorators.length) {
        this.raise(this.state.start, "You have trailing decorators with no method");
      }

      node.body = this.finishNode(classBody, "ClassBody");

      this.state.strict = oldStrict;
    }

parseClassProperty(node: Node): Node {
      const noPluginMsg = "You can only use Class Properties when the 'classProperties' plugin is enabled.";
      if (!node.typeAnnotation && !this.hasPlugin("classProperties")) {
        this.raise(node.start, noPluginMsg);
      }

      if (this.match(tt.eq)) {
        if (!this.hasPlugin("classProperties")) this.raise(this.state.start, noPluginMsg);
        this.next();
        node.value = this.parseMaybeAssign();
      } else {
        node.value = null;
      }
      this.semicolon();
      return this.finishNode(node, "ClassProperty");
    }

parseClassMethod(classBody: Node, method: Node, isGenerator: boolean | undefined, isAsync: boolean | undefined): void {
      this.parseMethod(method, isGenerator, isAsync);
      nodeArray(classBody.body).push(this.finishNode(method, "ClassMethod"));
    }

parseClassId(node: Node, isStatement: boolean | number, optionalId: boolean | undefined): void {
      if (this.match(tt.name)) {
        node.id = this.parseIdentifier();
      } else {
        if (optionalId || !isStatement) {
          node.id = null;
        } else {
          this.unexpected();
        }
      }
    }

parseClassSuper(node: Node, isStatement?: boolean | undefined): void {
      node.superClass = this.eat(tt._extends) ? this.parseExprSubscripts() : null;
    }

parseExport(node: Node): Node {
      this.next();
      // export * from '...'
      if (this.match(tt.star)) {
        const specifier = this.startNode();
        this.next();
        if (this.hasPlugin("exportExtensions") && this.eatContextual("as")) {
          specifier.exported = this.parseIdentifier();
          node.specifiers = [this.finishNode(specifier, "ExportNamespaceSpecifier")];
          this.parseExportSpecifiersMaybe(node);
          this.parseExportFrom(node, true);
        } else {
          this.parseExportFrom(node, true);
          return this.finishNode(node, "ExportAllDeclaration");
        }
      } else if (this.hasPlugin("exportExtensions") && this.isExportDefaultSpecifier()) {
        const specifier = this.startNode();
        specifier.exported = this.parseIdentifier(true);
        node.specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
        if (this.match(tt.comma) && this.lookahead().type === tt.star) {
          this.expect(tt.comma);
          const specifier = this.startNode();
          this.expect(tt.star);
          this.expectContextual("as");
          specifier.exported = this.parseIdentifier();
          node.specifiers.push(this.finishNode(specifier, "ExportNamespaceSpecifier"));
        } else {
          this.parseExportSpecifiersMaybe(node);
        }
        this.parseExportFrom(node, true);
      } else if (this.eat(tt._default)) { // export default ...
        let expr = this.startNode();
        let needsSemi = false;
        if (this.eat(tt._function)) {
          expr = this.parseFunction(expr, true, false, false, true);
        } else if (
          this.isContextual("async") &&
          this.lookahead().type === tt._function
        ) { // async function declaration
          this.eatContextual("async");
          this.eat(tt._function);
          expr = this.parseFunction(expr, true, false, true, true);
        } else if (this.match(tt._class)) {
          expr = this.parseClass(expr, true, true);
        } else {
          needsSemi = true;
          expr = this.parseMaybeAssign();
        }
        node.declaration = expr;
        if (needsSemi) this.semicolon();
        this.checkExport(node, true, true);
        return this.finishNode(node, "ExportDefaultDeclaration");
      } else if (this.shouldParseExportDeclaration()) {
        node.specifiers = [];
        node.source = null;
        node.declaration = this.parseExportDeclaration(node);
      } else { // export { x, y as z } [from '...']
        node.declaration = null;
        node.specifiers = this.parseExportSpecifiers();
        this.parseExportFrom(node);
      }
      this.checkExport(node, true);
      return this.finishNode(node, "ExportNamedDeclaration");
    }

parseExportDeclaration(node?: Node): Node | null {
      return this.parseStatement(true);
    }

isExportDefaultSpecifier(): boolean {
      if (this.match(tt.name)) {
        return this.state.value !== "type"
            && this.state.value !== "async"
            && this.state.value !== "interface";
      }

      if (!this.match(tt._default)) {
        return false;
      }

      const lookahead = this.lookahead();
      return lookahead.type === tt.comma || (lookahead.type === tt.name && lookahead.value === "from");
    }

parseExportSpecifiersMaybe(node: Node): void {
      if (this.eat(tt.comma)) {
        node.specifiers = node.specifiers.concat(this.parseExportSpecifiers());
      }
    }

parseExportFrom(node: Node, expect?: boolean | undefined): void {
      if (this.eatContextual("from")) {
        node.source = this.match(tt.string) ? this.parseExprAtom() : this.unexpected();
        this.checkExport(node);
      } else {
        if (expect) {
          this.unexpected();
        } else {
          node.source = null;
        }
      }

      this.semicolon();
    }

shouldParseExportDeclaration(): boolean {
      return this.state.type.keyword === "var"
        || this.state.type.keyword === "const"
        || this.state.type.keyword === "let"
        || this.state.type.keyword === "function"
        || this.state.type.keyword === "class"
        || this.isContextual("async");
    }

checkExport(node: Node, checkNames?: boolean | undefined, isDefault?: boolean | undefined): void {
      if (checkNames) {
        // Check for duplicate exports
        if (isDefault) {
          // Default exports
          this.checkDuplicateExports(node, "default");
        } else if (node.specifiers && node.specifiers.length) {
          // Named exports
          for (const specifier of node.specifiers) {
            this.checkDuplicateExports(specifier, stringValue(specifier.exported.name));
          }
        } else if (node.declaration) {
          // Exported declarations
          if (node.declaration.type === "FunctionDeclaration" || node.declaration.type === "ClassDeclaration") {
            this.checkDuplicateExports(node, stringValue(present(node.declaration.id).name));
          } else if (node.declaration.type === "VariableDeclaration") {
            for (const declaration of node.declaration.declarations) {
              this.checkDeclaration(present(declaration.id));
            }
          }
        }
      }

      if (this.state.decorators.length) {
        const isClass = node.declaration && (node.declaration.type === "ClassDeclaration" || node.declaration.type === "ClassExpression");
        if (!node.declaration || !isClass) {
          this.raise(node.start, "You can only use decorators on an export when exporting a class");
        }
        this.takeDecorators(node.declaration);
      }
    }

checkDeclaration(node: Node): void {
      if (node.type === "ObjectPattern") {
        for (const prop of node.properties) {
          this.checkDeclaration(prop);
        }
      } else if (node.type === "ArrayPattern") {
        for (const elem of node.elements) {
          if (elem) {
            this.checkDeclaration(elem);
          }
        }
      } else if (node.type === "ObjectProperty") {
        this.checkDeclaration(nodeValue(node.value));
      } else if (node.type === "RestElement") {
        this.checkDeclaration(present(node.argument));
      } else if (node.type === "Identifier") {
        this.checkDuplicateExports(node, stringValue(node.name));
      }
    }

checkDuplicateExports(node: Node, name: string): void {
      if (this.state.exportedIdentifiers.indexOf(name) > -1) {
        this.raiseDuplicateExportError(node, name);
      }
      this.state.exportedIdentifiers.push(name);
    }

raiseDuplicateExportError(node: Node, name: string): never {
      this.raise(node.start, name === "default" ?
        "Only one default export allowed per module." :
        `\`${name}\` has already been exported. Exported identifiers must be unique.`
      );
    }

parseExportSpecifiers(): Node[] {
      const nodes = [];
      let first = true;
      let needsFrom;

      // export { x, y as z } [from '...']
      this.expect(tt.braceL);

      while (!this.eat(tt.braceR)) {
        if (first) {
          first = false;
        } else {
          this.expect(tt.comma);
          if (this.eat(tt.braceR)) break;
        }

        const isDefault = this.match(tt._default);
        if (isDefault && !needsFrom) needsFrom = true;

        const node = this.startNode();
        node.local = this.parseIdentifier(isDefault);
        node.exported = this.eatContextual("as") ? this.parseIdentifier(true) : node.local.__clone();
        nodes.push(this.finishNode(node, "ExportSpecifier"));
      }

      // https://github.com/ember-cli/ember-cli/pull/3739
      if (needsFrom && !this.isContextual("from")) {
        this.unexpected();
      }

      return nodes;
    }

parseImport(node: Node): Node {
      this.eat(tt._import);

      // import '...'
      if (this.match(tt.string)) {
        node.specifiers = [];
        node.source = this.parseExprAtom();
      } else {
        node.specifiers = [];
        this.parseImportSpecifiers(node);
        this.expectContextual("from");
        node.source = this.match(tt.string) ? this.parseExprAtom() : this.unexpected();
      }
      this.semicolon();
      return this.finishNode(node, "ImportDeclaration");
    }

parseImportSpecifiers(node: Node): void {
      let first = true;
      if (this.match(tt.name)) {
        // import defaultObj, { x, y as z } from '...'
        const startPos = this.state.start;
        const startLoc = this.state.startLoc;
        node.specifiers.push(this.parseImportSpecifierDefault(this.parseIdentifier(), startPos, startLoc));
        if (!this.eat(tt.comma)) return;
      }

      if (this.match(tt.star)) {
        const specifier = this.startNode();
        this.next();
        this.expectContextual("as");
        specifier.local = this.parseIdentifier();
        this.checkLVal(specifier.local, true, undefined, "import namespace specifier");
        node.specifiers.push(this.finishNode(specifier, "ImportNamespaceSpecifier"));
        return;
      }

      this.expect(tt.braceL);
      while (!this.eat(tt.braceR)) {
        if (first) {
          first = false;
        } else {
          // Detect an attempt to deep destructure
          if (this.eat(tt.colon)) {
            this.unexpected(null, "ES2015 named imports do not destructure. Use another statement for destructuring after the import.");
          }

          this.expect(tt.comma);
          if (this.eat(tt.braceR)) break;
        }

        this.parseImportSpecifier(node);
      }
    }

parseImportSpecifier(node: Node): void {
      const specifier = this.startNode();
      specifier.imported = this.parseIdentifier(true);
      if (this.eatContextual("as")) {
        specifier.local = this.parseIdentifier();
      } else {
        this.checkReservedWord(specifier.imported.name, specifier.start, true, true);
        specifier.local = specifier.imported.__clone();
      }
      this.checkLVal(specifier.local, true, undefined, "import specifier");
      node.specifiers.push(this.finishNode(specifier, "ImportSpecifier"));
    }

parseImportSpecifierDefault(id: Node, startPos: number, startLoc: Position | SourceLocation): Node {
      const node = this.startNodeAt(startPos, startLoc);
      node.local = id;
      this.checkLVal(node.local, true, undefined, "default import specifier");
      return this.finishNode(node, "ImportDefaultSpecifier");
    }

addExtra(node: Node, key: string, val: NodeValue): void {
      if (!node) return;

      const extra = node.extra = node.extra || {};
      extra[key] = val;
    }

isRelational(op: string): boolean {
      return this.match(tt.relational) && this.state.value === op;
    }

expectRelational(op: string): void {
      if (this.isRelational(op)) {
        this.next();
      } else {
        this.unexpected(null, tt.relational);
      }
    }

isContextual(name: string): boolean {
      return this.match(tt.name) && this.state.value === name;
    }

eatContextual(name: string): boolean | undefined {
      return this.state.value === name && this.eat(tt.name);
    }

expectContextual(name: string, message?: string): void {
      if (!this.eatContextual(name)) this.unexpected(null, message);
    }

canInsertSemicolon(): boolean {
      return this.match(tt.eof) ||
        this.match(tt.braceR) ||
        lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.start));
    }

isLineTerminator(): boolean | undefined {
      return this.eat(tt.semi) || this.canInsertSemicolon();
    }

semicolon(): void {
      if (!this.isLineTerminator()) this.unexpected(null, tt.semi);
    }

expect(type: TokenType, pos?: number | null): boolean {
      return this.eat(type) || this.unexpected(pos, type);
    }

unexpected(pos?: number | null, messageOrType: string | TokenType = "Unexpected token"): never {
      if (messageOrType && typeof messageOrType === "object" && messageOrType.label) {
        messageOrType = `Unexpected token, expected ${messageOrType.label}`;
      }
      this.raise(pos != null ? pos : this.state.start, String(messageOrType));
    }

estreeParseRegExpLiteral({ pattern, flags }: RegExpValue): Node {
      let regex = null;
      try {
        regex = new RegExp(pattern, flags);
      } catch (e) {
        // In environments that don't support these flags value will
        // be null as the regex can't be represented natively.
      }
      const node = this.estreeParseLiteral(regex);
      node.regex = { pattern, flags };

      return node;
    }

estreeParseLiteral(value: NodeValue): Node {
      return this.parseLiteral(value, "Literal");
    }

directiveToStmt(directive: Node): Node {
      const directiveLiteral = nodeValue(directive.value);

      const stmt = this.startNodeAt(directive.start, directive.loc.start);
      const expression = this.startNodeAt(directiveLiteral.start, directiveLiteral.loc.start);

      expression.value = directiveLiteral.value;
      expression.raw = stringValue(present(directiveLiteral.extra).raw);

      stmt.expression = this.finishNodeAt(expression, "Literal", directiveLiteral.end, directiveLiteral.loc.end);
      stmt.directive = stringValue(present(directiveLiteral.extra).raw).slice(1, -1);

      return this.finishNodeAt(stmt, "ExpressionStatement", directive.end, directive.loc.end);
    }

flowParseTypeInitialiser(tok?: TokenType): Node {
      const oldInType = this.state.inType;
      this.state.inType = true;
      this.expect(tok || tt.colon);

      const type = this.flowParseType();
      this.state.inType = oldInType;
      return type;
    }

flowParsePredicate(): Node {
      const node = this.startNode();
      const moduloLoc = this.state.startLoc;
      const moduloPos = this.state.start;
      this.expect(tt.modulo);
      const checksLoc = this.state.startLoc;
      this.expectContextual("checks");
      // Force '%' and 'checks' to be adjacent
      if (moduloLoc.line !== checksLoc.line || moduloLoc.column !== checksLoc.column - 1) {
        this.raise(moduloPos, "Spaces between ´%´ and ´checks´ are not allowed here.");
      }
      if (this.eat(tt.parenL)) {
        node.expression = this.parseExpression();
        this.expect(tt.parenR);
        return this.finishNode(node, "DeclaredPredicate");
      } else {
        return this.finishNode(node, "InferredPredicate");
      }
    }

flowParseTypeAndPredicateInitialiser(): [Node | null, Node | null] {
      const oldInType = this.state.inType;
      this.state.inType = true;
      this.expect(tt.colon);
      let type = null;
      let predicate = null;
      if (this.match(tt.modulo)) {
        this.state.inType = oldInType;
        predicate = this.flowParsePredicate();
      } else {
        type = this.flowParseType();
        this.state.inType = oldInType;
        if (this.match(tt.modulo)) {
          predicate = this.flowParsePredicate();
        }
      }
      return [type, predicate];
    }

flowParseDeclareClass(node: Node): Node {
      this.next();
      this.flowParseInterfaceish(node, true);
      return this.finishNode(node, "DeclareClass");
    }

flowParseDeclareFunction(node: Node): Node {
      this.next();

      const id = node.id = this.parseIdentifier();

      const typeNode = this.startNode();
      const typeContainer = this.startNode();

      if (this.isRelational("<")) {
        typeNode.typeParameters = this.flowParseTypeParameterDeclaration();
      } else {
        typeNode.typeParameters = null;
      }

      this.expect(tt.parenL);
      const tmp = this.flowParseFunctionTypeParams();
      typeNode.params = tmp.params;
      typeNode.rest = tmp.rest;
      this.expect(tt.parenR);
      let predicate = null;
      [typeNode.returnType, predicate] = this.flowParseTypeAndPredicateInitialiser();
      typeContainer.typeAnnotation = this.finishNode(typeNode, "FunctionTypeAnnotation");
      typeContainer.predicate = predicate;
      id.typeAnnotation = this.finishNode(typeContainer, "TypeAnnotation");

      this.finishNode(id, id.type);

      this.semicolon();

      return this.finishNode(node, "DeclareFunction");
    }

flowParseDeclare(node: Node, _allowDefault?: boolean): Node {
      if (this.match(tt._class)) {
        return this.flowParseDeclareClass(node);
      } else if (this.match(tt._function)) {
        return this.flowParseDeclareFunction(node);
      } else if (this.match(tt._var)) {
        return this.flowParseDeclareVariable(node);
      } else if (this.isContextual("module")) {
        if (this.lookahead().type === tt.dot) {
          return this.flowParseDeclareModuleExports(node);
        } else {
          return this.flowParseDeclareModule(node);
        }
      } else if (this.isContextual("type")) {
        return this.flowParseDeclareTypeAlias(node);
      } else if (this.isContextual("interface")) {
        return this.flowParseDeclareInterface(node);
      } else {
        this.unexpected();
      }
    }

flowParseDeclareVariable(node: Node): Node {
      this.next();
      node.id = this.flowParseTypeAnnotatableIdentifier();
      this.semicolon();
      return this.finishNode(node, "DeclareVariable");
    }

flowParseDeclareModule(node: Node): Node {
      this.next();

      if (this.match(tt.string)) {
        node.id = this.parseExprAtom();
      } else {
        node.id = this.parseIdentifier();
      }

      const bodyNode = node.body = this.startNode();
      const body: Node[] = bodyNode.body = [];
      this.expect(tt.braceL);
      while (!this.match(tt.braceR)) {
        let bodyNode = this.startNode();

        if (this.match(tt._import)) {
          const lookahead = this.lookahead();
          if (lookahead.value !== "type" && lookahead.value !== "typeof") {
            this.unexpected(null, "Imports within a `declare module` body must always be `import type` or `import typeof`");
          }

          this.parseImport(bodyNode);
        } else {
          this.expectContextual("declare", "Only declares and type imports are allowed inside declare module");

          bodyNode = this.flowParseDeclare(bodyNode, true);
        }

        body.push(bodyNode);
      }
      this.expect(tt.braceR);

      this.finishNode(bodyNode, "BlockStatement");
      return this.finishNode(node, "DeclareModule");
    }

flowParseDeclareModuleExports(node: Node): Node {
      this.expectContextual("module");
      this.expect(tt.dot);
      this.expectContextual("exports");
      node.typeAnnotation = this.flowParseTypeAnnotation();
      this.semicolon();

      return this.finishNode(node, "DeclareModuleExports");
    }

flowParseDeclareTypeAlias(node: Node): Node {
      this.next();
      this.flowParseTypeAlias(node);
      return this.finishNode(node, "DeclareTypeAlias");
    }

flowParseDeclareInterface(node: Node): Node {
      this.next();
      this.flowParseInterfaceish(node);
      return this.finishNode(node, "DeclareInterface");
    }

flowParseInterfaceish(node: Node, allowStatic?: boolean | undefined): void {
      node.id = this.parseIdentifier();

      if (this.isRelational("<")) {
        node.typeParameters = this.flowParseTypeParameterDeclaration();
      } else {
        node.typeParameters = null;
      }

      node.extends = [];
      node.mixins = [];

      if (this.eat(tt._extends)) {
        do {
          node.extends.push(this.flowParseInterfaceExtends());
        } while (this.eat(tt.comma));
      }

      if (this.isContextual("mixins")) {
        this.next();
        do {
          node.mixins.push(this.flowParseInterfaceExtends());
        } while (this.eat(tt.comma));
      }

      node.body = this.flowParseObjectType(allowStatic);
    }

flowParseInterfaceExtends(): Node {
      const node = this.startNode();

      node.id = this.flowParseQualifiedTypeIdentifier();
      if (this.isRelational("<")) {
        node.typeParameters = this.flowParseTypeParameterInstantiation();
      } else {
        node.typeParameters = null;
      }

      return this.finishNode(node, "InterfaceExtends");
    }

flowParseInterface(node: Node): Node {
      this.flowParseInterfaceish(node, false);
      return this.finishNode(node, "InterfaceDeclaration");
    }

flowParseRestrictedIdentifier(liberal?: boolean | undefined): Node {
      if (primitiveTypes.indexOf(stringValue(this.state.value)) > -1) {
        this.raise(this.state.start, `Cannot overwrite primitive type ${this.state.value}`);
      }

      return this.parseIdentifier(liberal);
    }

flowParseTypeAlias(node: Node, allowDefault?: unknown): Node {
      node.id = this.flowParseRestrictedIdentifier();

      if (this.isRelational("<")) {
        node.typeParameters = this.flowParseTypeParameterDeclaration();
      } else {
        node.typeParameters = null;
      }

      node.right = this.flowParseTypeInitialiser(tt.eq);
      this.semicolon();

      return this.finishNode(node, "TypeAlias");
    }

flowParseTypeParameter(): Node {
      const node = this.startNode();

      const variance = this.flowParseVariance();

      const ident = this.flowParseTypeAnnotatableIdentifier();
      node.name = ident.name;
      node.variance = variance;
      node.bound = ident.typeAnnotation;

      if (this.match(tt.eq)) {
        this.eat(tt.eq);
        node.default = this.flowParseType();
      }

      return this.finishNode(node, "TypeParameter");
    }

flowParseTypeParameterDeclaration(): Node {
      const oldInType = this.state.inType;
      const node = this.startNode();
      node.params = [];

      this.state.inType = true;

      // istanbul ignore else: this condition is already checked at all call sites
      if (this.isRelational("<") || this.match(tt.jsxTagStart)) {
        this.next();
      } else {
        this.unexpected();
      }

      do {
        node.params.push(this.flowParseTypeParameter());
        if (!this.isRelational(">")) {
          this.expect(tt.comma);
        }
      } while (!this.isRelational(">"));
      this.expectRelational(">");

      this.state.inType = oldInType;

      return this.finishNode(node, "TypeParameterDeclaration");
    }

flowParseTypeParameterInstantiation(): Node {
      const node = this.startNode();
      const oldInType = this.state.inType;
      node.params = [];

      this.state.inType = true;

      this.expectRelational("<");
      while (!this.isRelational(">")) {
        node.params.push(this.flowParseType());
        if (!this.isRelational(">")) {
          this.expect(tt.comma);
        }
      }
      this.expectRelational(">");

      this.state.inType = oldInType;

      return this.finishNode(node, "TypeParameterInstantiation");
    }

flowParseObjectPropertyKey(): Node {
      return (this.match(tt.num) || this.match(tt.string)) ? this.parseExprAtom() : this.parseIdentifier(true);
    }

flowParseObjectTypeIndexer(node: Node, isStatic: boolean | undefined, variance: Node | null): Node {
      node.static = isStatic;

      this.expect(tt.bracketL);
      if (this.lookahead().type === tt.colon) {
        node.id = this.flowParseObjectPropertyKey();
        node.key = this.flowParseTypeInitialiser();
      } else {
        node.id = null;
        node.key = this.flowParseType();
      }
      this.expect(tt.bracketR);
      node.value = this.flowParseTypeInitialiser();
      node.variance = variance;

      // Finish node first to not include a possible semicolon in the locations
      const indexer = this.finishNode(node, "ObjectTypeIndexer");
      this.flowObjectTypeSemicolon();

      return indexer;
    }

flowParseObjectTypeMethodish(node: Node): Node {
      node.params = [];
      node.rest = null;
      node.typeParameters = null;

      if (this.isRelational("<")) {
        node.typeParameters = this.flowParseTypeParameterDeclaration();
      }

      this.expect(tt.parenL);
      while (this.match(tt.name)) {
        node.params.push(this.flowParseFunctionTypeParam());
        if (!this.match(tt.parenR)) {
          this.expect(tt.comma);
        }
      }

      if (this.eat(tt.ellipsis)) {
        node.rest = this.flowParseFunctionTypeParam();
      }
      this.expect(tt.parenR);
      node.returnType = this.flowParseTypeInitialiser();

      return this.finishNode(node, "FunctionTypeAnnotation");
    }

flowParseObjectTypeMethod(startPos: number, startLoc: Position | SourceLocation, isStatic: boolean | undefined, key: Node): Node {
      const node = this.startNodeAt(startPos, startLoc);
      node.value = this.flowParseObjectTypeMethodish(this.startNodeAt(startPos, startLoc));
      node.static = isStatic;
      node.key = key;
      node.optional = false;
      this.flowObjectTypeSemicolon();
      return this.finishNode(node, "ObjectTypeProperty");
    }

flowParseObjectTypeCallProperty(node: Node, isStatic: boolean | undefined): Node {
      const valueNode = this.startNode();
      node.static = isStatic;
      node.value = this.flowParseObjectTypeMethodish(valueNode);
      this.flowObjectTypeSemicolon();
      return this.finishNode(node, "ObjectTypeCallProperty");
    }

flowParseObjectType(allowStatic: boolean | undefined, allowExact?: boolean | undefined): Node {
      const oldInType = this.state.inType;
      this.state.inType = true;

      const nodeStart = this.startNode();
      let node;
      let propertyKey;
      let isStatic = false;

      nodeStart.callProperties = [];
      nodeStart.properties = [];
      nodeStart.indexers = [];

      let endDelim;
      let exact;
      if (allowExact && this.match(tt.braceBarL)) {
        this.expect(tt.braceBarL);
        endDelim = tt.braceBarR;
        exact = true;
      } else {
        this.expect(tt.braceL);
        endDelim = tt.braceR;
        exact = false;
      }

      nodeStart.exact = exact;

      while (!this.match(endDelim)) {
        let optional = false;
        const startPos = this.state.start;
        const startLoc = this.state.startLoc;
        node = this.startNode();
        if (allowStatic && this.isContextual("static") && this.lookahead().type !== tt.colon) {
          this.next();
          isStatic = true;
        }

        const variance = this.flowParseVariance();

        if (this.match(tt.bracketL)) {
          nodeStart.indexers.push(this.flowParseObjectTypeIndexer(node, isStatic, variance));
        } else if (this.match(tt.parenL) || this.isRelational("<")) {
          if (variance) {
            this.unexpected(variance.start);
          }
          nodeStart.callProperties.push(this.flowParseObjectTypeCallProperty(node, isStatic));
        } else {
          propertyKey = this.flowParseObjectPropertyKey();
          if (this.isRelational("<") || this.match(tt.parenL)) {
            // This is a method property
            if (variance) {
              this.unexpected(variance.start);
            }
            nodeStart.properties.push(this.flowParseObjectTypeMethod(startPos, startLoc, isStatic, propertyKey));
          } else {
            if (this.eat(tt.question)) {
              optional = true;
            }
            node.key = propertyKey;
            node.value = this.flowParseTypeInitialiser();
            node.optional = optional;
            node.static = isStatic;
            node.variance = variance;
            this.flowObjectTypeSemicolon();
            nodeStart.properties.push(this.finishNode(node, "ObjectTypeProperty"));
          }
        }

        isStatic = false;
      }

      this.expect(endDelim);

      const out = this.finishNode(nodeStart, "ObjectTypeAnnotation");

      this.state.inType = oldInType;

      return out;
    }

flowObjectTypeSemicolon(): void {
      if (!this.eat(tt.semi) && !this.eat(tt.comma) &&
          !this.match(tt.braceR) && !this.match(tt.braceBarR)) {
        this.unexpected();
      }
    }

flowParseQualifiedTypeIdentifier(startPos?: number, startLoc?: Position | SourceLocation, id?: Node): Node {
      startPos = startPos || this.state.start;
      startLoc = startLoc || this.state.startLoc;
      let node = id || this.parseIdentifier();

      while (this.eat(tt.dot)) {
        const node2 = this.startNodeAt(startPos, startLoc);
        node2.qualification = node;
        node2.id = this.parseIdentifier();
        node = this.finishNode(node2, "QualifiedTypeIdentifier");
      }

      return node;
    }

flowParseGenericType(startPos: number, startLoc: Position | SourceLocation, id: Node): Node {
      const node = this.startNodeAt(startPos, startLoc);

      node.typeParameters = null;
      node.id = this.flowParseQualifiedTypeIdentifier(startPos, startLoc, id);

      if (this.isRelational("<")) {
        node.typeParameters = this.flowParseTypeParameterInstantiation();
      }

      return this.finishNode(node, "GenericTypeAnnotation");
    }

flowParseTypeofType(): Node {
      const node = this.startNode();
      this.expect(tt._typeof);
      node.argument = this.flowParsePrimaryType();
      return this.finishNode(node, "TypeofTypeAnnotation");
    }

flowParseTupleType(): Node {
      const node = this.startNode();
      node.types = [];
      this.expect(tt.bracketL);
      // We allow trailing commas
      while (this.state.pos < this.input.length && !this.match(tt.bracketR)) {
        node.types.push(this.flowParseType());
        if (this.match(tt.bracketR)) break;
        this.expect(tt.comma);
      }
      this.expect(tt.bracketR);
      return this.finishNode(node, "TupleTypeAnnotation");
    }

flowParseFunctionTypeParam(): Node {
      let name = null;
      let optional = false;
      let typeAnnotation = null;
      const node = this.startNode();
      const lh = this.lookahead();
      if (lh.type === tt.colon ||
          lh.type === tt.question) {
        name = this.parseIdentifier();
        if (this.eat(tt.question)) {
          optional = true;
        }
        typeAnnotation = this.flowParseTypeInitialiser();
      } else {
        typeAnnotation = this.flowParseType();
      }
      node.name = name;
      node.optional = optional;
      node.typeAnnotation = typeAnnotation;
      return this.finishNode(node, "FunctionTypeParam");
    }

reinterpretTypeAsFunctionTypeParam(type: Node): Node {
      const node = this.startNodeAt(type.start, type.loc);
      node.name = null;
      node.optional = false;
      node.typeAnnotation = type;
      return this.finishNode(node, "FunctionTypeParam");
    }

flowParseFunctionTypeParams(params: (Node | null)[] = []): FunctionTypeParameters {
      const ret: FunctionTypeParameters = { params, rest: null };
      while (!this.match(tt.parenR) && !this.match(tt.ellipsis)) {
        ret.params.push(this.flowParseFunctionTypeParam());
        if (!this.match(tt.parenR)) {
          this.expect(tt.comma);
        }
      }
      if (this.eat(tt.ellipsis)) {
        ret.rest = this.flowParseFunctionTypeParam();
      }
      return ret;
    }

flowIdentToTypeAnnotation(startPos: number, startLoc: Position | SourceLocation, node: Node, id: Node): Node {
      switch (id.name) {
        case "any":
          return this.finishNode(node, "AnyTypeAnnotation");

        case "void":
          return this.finishNode(node, "VoidTypeAnnotation");

        case "bool":
        case "boolean":
          return this.finishNode(node, "BooleanTypeAnnotation");

        case "mixed":
          return this.finishNode(node, "MixedTypeAnnotation");

        case "empty":
          return this.finishNode(node, "EmptyTypeAnnotation");

        case "number":
          return this.finishNode(node, "NumberTypeAnnotation");

        case "string":
          return this.finishNode(node, "StringTypeAnnotation");

        default:
          return this.flowParseGenericType(startPos, startLoc, id);
      }
    }

flowParsePrimaryType(): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      const node = this.startNode();
      let tmp;
      let type;
      let isGroupedType = false;
      const oldNoAnonFunctionType = this.state.noAnonFunctionType;

      switch (this.state.type) {
        case tt.name:
          return this.flowIdentToTypeAnnotation(startPos, startLoc, node, this.parseIdentifier());

        case tt.braceL:
          return this.flowParseObjectType(false, false);

        case tt.braceBarL:
          return this.flowParseObjectType(false, true);

        case tt.bracketL:
          return this.flowParseTupleType();

        case tt.relational:
          if (this.state.value === "<") {
            node.typeParameters = this.flowParseTypeParameterDeclaration();
            this.expect(tt.parenL);
            tmp = this.flowParseFunctionTypeParams();
            node.params = tmp.params;
            node.rest = tmp.rest;
            this.expect(tt.parenR);

            this.expect(tt.arrow);

            node.returnType = this.flowParseType();

            return this.finishNode(node, "FunctionTypeAnnotation");
          }
          break;

        case tt.parenL:
          this.next();

          // Check to see if this is actually a grouped type
          if (!this.match(tt.parenR) && !this.match(tt.ellipsis)) {
            if (this.match(tt.name)) {
              const token = this.lookahead().type;
              isGroupedType = token !== tt.question && token !== tt.colon;
            } else {
              isGroupedType = true;
            }
          }

          if (isGroupedType) {
            this.state.noAnonFunctionType = false;
            type = this.flowParseType();
            this.state.noAnonFunctionType = oldNoAnonFunctionType;

            // A `,` or a `) =>` means this is an anonymous function type
            if (this.state.noAnonFunctionType ||
                !(this.match(tt.comma) ||
                 (this.match(tt.parenR) && this.lookahead().type === tt.arrow))) {
              this.expect(tt.parenR);
              return type;
            } else {
              // Eat a comma if there is one
              this.eat(tt.comma);
            }
          }

          if (type) {
            tmp = this.flowParseFunctionTypeParams(
              [this.reinterpretTypeAsFunctionTypeParam(type)],
            );
          } else {
            tmp = this.flowParseFunctionTypeParams();
          }

          node.params = tmp.params;
          node.rest = tmp.rest;

          this.expect(tt.parenR);

          this.expect(tt.arrow);

          node.returnType = this.flowParseType();

          node.typeParameters = null;

          return this.finishNode(node, "FunctionTypeAnnotation");

        case tt.string:
          return this.parseLiteral(this.state.value, "StringLiteralTypeAnnotation");

        case tt._true: case tt._false:
          node.value = this.match(tt._true);
          this.next();
          return this.finishNode(node, "BooleanLiteralTypeAnnotation");

        case tt.plusMin:
          if (this.state.value === "-") {
            this.next();
            if (!this.match(tt.num)) this.unexpected(null, "Unexpected token, expected number");

            return this.parseLiteral(-this.state.value, "NumberLiteralTypeAnnotation", node.start, node.loc.start);
          }

          this.unexpected();
        case tt.num:
          return this.parseLiteral(this.state.value, "NumberLiteralTypeAnnotation");

        case tt._null:
          node.value = this.match(tt._null);
          this.next();
          return this.finishNode(node, "NullLiteralTypeAnnotation");

        case tt._this:
          node.value = this.match(tt._this);
          this.next();
          return this.finishNode(node, "ThisTypeAnnotation");

        case tt.star:
          this.next();
          return this.finishNode(node, "ExistsTypeAnnotation");

        default:
          if (this.state.type.keyword === "typeof") {
            return this.flowParseTypeofType();
          }
      }

      this.unexpected();
    }

flowParsePostfixType(): Node {
      const startPos = this.state.start, startLoc = this.state.startLoc;
      let type = this.flowParsePrimaryType();
      while (!this.canInsertSemicolon() && this.match(tt.bracketL)) {
        const node = this.startNodeAt(startPos, startLoc);
        node.elementType = type;
        this.expect(tt.bracketL);
        this.expect(tt.bracketR);
        type = this.finishNode(node, "ArrayTypeAnnotation");
      }
      return type;
    }

flowParsePrefixType(): Node {
      const node = this.startNode();
      if (this.eat(tt.question)) {
        node.typeAnnotation = this.flowParsePrefixType();
        return this.finishNode(node, "NullableTypeAnnotation");
      } else {
        return this.flowParsePostfixType();
      }
    }

flowParseAnonFunctionWithoutParens(): Node {
      const param = this.flowParsePrefixType();
      if (!this.state.noAnonFunctionType && this.eat(tt.arrow)) {
        const node  = this.startNodeAt(param.start, param.loc);
        node.params = [this.reinterpretTypeAsFunctionTypeParam(param)];
        node.rest = null;
        node.returnType = this.flowParseType();
        node.typeParameters = null;
        return this.finishNode(node, "FunctionTypeAnnotation");
      }
      return param;
    }

flowParseIntersectionType(): Node {
      const node = this.startNode();
      this.eat(tt.bitwiseAND);
      const type = this.flowParseAnonFunctionWithoutParens();
      node.types = [type];
      while (this.eat(tt.bitwiseAND)) {
        node.types.push(this.flowParseAnonFunctionWithoutParens());
      }
      return node.types.length === 1 ? type : this.finishNode(node, "IntersectionTypeAnnotation");
    }

flowParseUnionType(): Node {
      const node = this.startNode();
      this.eat(tt.bitwiseOR);
      const type = this.flowParseIntersectionType();
      node.types = [type];
      while (this.eat(tt.bitwiseOR)) {
        node.types.push(this.flowParseIntersectionType());
      }
      return node.types.length === 1 ? type : this.finishNode(node, "UnionTypeAnnotation");
    }

flowParseType(): Node {
      const oldInType = this.state.inType;
      this.state.inType = true;
      const type = this.flowParseUnionType();
      this.state.inType = oldInType;
      return type;
    }

flowParseTypeAnnotation(): Node {
      const node = this.startNode();
      node.typeAnnotation = this.flowParseTypeInitialiser();
      return this.finishNode(node, "TypeAnnotation");
    }

flowParseTypeAndPredicateAnnotation(): Node {
      const node = this.startNode();
      [node.typeAnnotation, node.predicate] = this.flowParseTypeAndPredicateInitialiser();
      return this.finishNode(node, "TypeAnnotation");
    }

flowParseTypeAnnotatableIdentifier(): Node {
      const ident = this.flowParseRestrictedIdentifier();
      if (this.match(tt.colon)) {
        ident.typeAnnotation = this.flowParseTypeAnnotation();
        this.finishNode(ident, ident.type);
      }
      return ident;
    }

typeCastToParameter(node: Node): Node {
      nodeValue(node.expression).typeAnnotation = node.typeAnnotation;

      return this.finishNodeAt(
        nodeValue(node.expression),
        nodeValue(node.expression).type,
        present(node.typeAnnotation).end,
        present(node.typeAnnotation).loc.end
      );
    }

flowParseVariance(): Node | null {
      let variance = null;
      if (this.match(tt.plusMin)) {
        variance = this.startNode();
        if (this.state.value === "+") {
          variance.kind = "plus";
        } else {
          variance.kind = "minus";
        }
        this.next();
        this.finishNode(variance, "Variance");
      }
      return variance;
    }

jsxReadToken(): void {
      let out = "";
      let chunkStart = this.state.pos;
      for (;;) {
        if (this.state.pos >= this.input.length) {
          this.raise(this.state.start, "Unterminated JSX contents");
        }

        const ch = this.input.charCodeAt(this.state.pos);

        switch (ch) {
          case 60: // "<"
          case 123: // "{"
            if (this.state.pos === this.state.start) {
              if (ch === 60 && this.state.exprAllowed) {
                ++this.state.pos;
                return this.finishToken(tt.jsxTagStart);
              }
              return this.getTokenFromCode(ch);
            }
            out += this.input.slice(chunkStart, this.state.pos);
            return this.finishToken(tt.jsxText, out);

          case 38: // "&"
            out += this.input.slice(chunkStart, this.state.pos);
            out += this.jsxReadEntity();
            chunkStart = this.state.pos;
            break;

          default:
            if (isNewLine(ch)) {
              out += this.input.slice(chunkStart, this.state.pos);
              out += this.jsxReadNewLine(true);
              chunkStart = this.state.pos;
            } else {
              ++this.state.pos;
            }
        }
      }
    }

jsxReadNewLine(normalizeCRLF: boolean | undefined): string {
      const ch = this.input.charCodeAt(this.state.pos);
      let out;
      ++this.state.pos;
      if (ch === 13 && this.input.charCodeAt(this.state.pos) === 10) {
        ++this.state.pos;
        out = normalizeCRLF ? "\n" : "\r\n";
      } else {
        out = String.fromCharCode(ch);
      }
      ++this.state.curLine;
      this.state.lineStart = this.state.pos;

      return out;
    }

jsxReadString(quote: number): void {
      let out = "";
      let chunkStart = ++this.state.pos;
      for (;;) {
        if (this.state.pos >= this.input.length) {
          this.raise(this.state.start, "Unterminated string constant");
        }

        const ch = this.input.charCodeAt(this.state.pos);
        if (ch === quote) break;
        if (ch === 38) { // "&"
          out += this.input.slice(chunkStart, this.state.pos);
          out += this.jsxReadEntity();
          chunkStart = this.state.pos;
        } else if (isNewLine(ch)) {
          out += this.input.slice(chunkStart, this.state.pos);
          out += this.jsxReadNewLine(false);
          chunkStart = this.state.pos;
        } else {
          ++this.state.pos;
        }
      }
      out += this.input.slice(chunkStart, this.state.pos++);
      return this.finishToken(tt.string, out);
    }

jsxReadEntity(): string {
      let str = "";
      let count = 0;
      let entity;
      let ch = this.input[this.state.pos];

      const startPos = ++this.state.pos;
      while (this.state.pos < this.input.length && count++ < 10) {
        ch = this.input[this.state.pos++];
        if (ch === ";") {
          if (str[0] === "#") {
            if (str[1] === "x") {
              str = str.substr(2);
              if (HEX_NUMBER.test(str))
                entity = String.fromCodePoint(parseInt(str, 16));
            } else {
              str = str.substr(1);
              if (DECIMAL_NUMBER.test(str))
                entity = String.fromCodePoint(parseInt(str, 10));
            }
          } else {
            entity = XHTMLEntities[str];
          }
          break;
        }
        str += ch;
      }
      if (!entity) {
        this.state.pos = startPos;
        return "&";
      }
      return entity;
    }

jsxReadWord(): void {
      let ch;
      const start = this.state.pos;
      do {
        ch = this.input.charCodeAt(++this.state.pos);
      } while (isIdentifierChar(ch) || ch === 45); // "-"
      return this.finishToken(tt.jsxName, this.input.slice(start, this.state.pos));
    }

jsxParseIdentifier(): Node {
      const node = this.startNode();
      if (this.match(tt.jsxName)) {
        node.name = stringValue(this.state.value);
      } else if (this.state.type.keyword) {
        node.name = this.state.type.keyword;
      } else {
        this.unexpected();
      }
      this.next();
      return this.finishNode(node, "JSXIdentifier");
    }

jsxParseNamespacedName(): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      const name = this.jsxParseIdentifier();
      if (!this.eat(tt.colon)) return name;

      const node = this.startNodeAt(startPos, startLoc);
      node.namespace = name;
      node.name = this.jsxParseIdentifier();
      return this.finishNode(node, "JSXNamespacedName");
    }

jsxParseElementName(): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      let node = this.jsxParseNamespacedName();
      while (this.eat(tt.dot)) {
        const newNode = this.startNodeAt(startPos, startLoc);
        newNode.object = node;
        newNode.property = this.jsxParseIdentifier();
        node = this.finishNode(newNode, "JSXMemberExpression");
      }
      return node;
    }

jsxParseAttributeValue(): Node {
      let node;
      switch (this.state.type) {
        case tt.braceL:
          node = this.jsxParseExpressionContainer();
          if (nodeValue(node.expression).type === "JSXEmptyExpression") {
            this.raise(node.start, "JSX attributes must only be assigned a non-empty expression");
          } else {
            return node;
          }

        case tt.jsxTagStart:
        case tt.string:
          node = this.parseExprAtom();
          node.extra = null;
          return node;

        default:
          this.raise(this.state.start, "JSX value should be either an expression or a quoted JSX text");
      }
    }

jsxParseEmptyExpression(): Node {
      const node = this.startNodeAt(this.state.lastTokEnd, this.state.lastTokEndLoc);
      return this.finishNodeAt(node, "JSXEmptyExpression", this.state.start, this.state.startLoc);
    }

jsxParseSpreadChild(): Node {
      const node = this.startNode();
      this.expect(tt.braceL);
      this.expect(tt.ellipsis);
      node.expression = this.parseExpression();
      this.expect(tt.braceR);

      return this.finishNode(node, "JSXSpreadChild");
    }

jsxParseExpressionContainer(): Node {
      const node = this.startNode();
      this.next();
      if (this.match(tt.braceR)) {
        node.expression = this.jsxParseEmptyExpression();
      } else {
        node.expression = this.parseExpression();
      }
      this.expect(tt.braceR);
      return this.finishNode(node, "JSXExpressionContainer");
    }

jsxParseAttribute(): Node {
      const node = this.startNode();
      if (this.eat(tt.braceL)) {
        this.expect(tt.ellipsis);
        node.argument = this.parseMaybeAssign();
        this.expect(tt.braceR);
        return this.finishNode(node, "JSXSpreadAttribute");
      }
      node.name = this.jsxParseNamespacedName();
      node.value = this.eat(tt.eq) ? this.jsxParseAttributeValue() : null;
      return this.finishNode(node, "JSXAttribute");
    }

jsxParseOpeningElementAt(startPos: number, startLoc: Position | SourceLocation): Node {
      const node = this.startNodeAt(startPos, startLoc);
      node.attributes = [];
      node.name = this.jsxParseElementName();
      while (!this.match(tt.slash) && !this.match(tt.jsxTagEnd)) {
        node.attributes.push(this.jsxParseAttribute());
      }
      node.selfClosing = this.eat(tt.slash);
      this.expect(tt.jsxTagEnd);
      return this.finishNode(node, "JSXOpeningElement");
    }

jsxParseClosingElementAt(startPos: number, startLoc: Position | SourceLocation): Node {
      const node = this.startNodeAt(startPos, startLoc);
      node.name = this.jsxParseElementName();
      this.expect(tt.jsxTagEnd);
      return this.finishNode(node, "JSXClosingElement");
    }

jsxParseElementAt(startPos: number, startLoc: Position | SourceLocation): Node {
      const node = this.startNodeAt(startPos, startLoc);
      const children = [];
      const openingElement = this.jsxParseOpeningElementAt(startPos, startLoc);
      let closingElement = null;

      if (!openingElement.selfClosing) {
        contents: for (;;) {
          switch (this.state.type) {
            case tt.jsxTagStart:
              startPos = this.state.start; startLoc = this.state.startLoc;
              this.next();
              if (this.eat(tt.slash)) {
                closingElement = this.jsxParseClosingElementAt(startPos, startLoc);
                break contents;
              }
              children.push(this.jsxParseElementAt(startPos, startLoc));
              break;

            case tt.jsxText:
              children.push(this.parseExprAtom());
              break;

            case tt.braceL:
              if (this.lookahead().type === tt.ellipsis) {
                children.push(this.jsxParseSpreadChild());
              } else {
                children.push(this.jsxParseExpressionContainer());
              }

              break;

            // istanbul ignore next - should never happen
            default:
              this.unexpected();
          }
        }

        if (getQualifiedJSXName(closingElement.name) !== getQualifiedJSXName(openingElement.name)) {
          this.raise(
            closingElement.start,
            "Expected corresponding JSX closing tag for <" + getQualifiedJSXName(openingElement.name) + ">"
          );
        }
      }

      node.openingElement = openingElement;
      node.closingElement = closingElement;
      node.children = children;
      if (this.match(tt.relational) && this.state.value === "<") {
        this.raise(this.state.start, "Adjacent JSX elements must be wrapped in an enclosing tag");
      }
      return this.finishNode(node, "JSXElement");
    }

jsxParseElement(): Node {
      const startPos = this.state.start;
      const startLoc = this.state.startLoc;
      this.next();
      return this.jsxParseElementAt(startPos, startLoc);
    }
}

export function preparePlugins(): void {
  plugins.estree = pluginsEstreeJS;
  plugins.flow = pluginsFlowJS;
  plugins.jsx = pluginsJsxIndexJS;
}

preparePlugins();
