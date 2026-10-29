import {nodeArray, regexpValue} from "../../acorn/dist/acorn.ts";
import type * as acornTypes from "../../acorn/dist/acorn.ts";
export interface EspreeOptions extends Partial<acornTypes.Options> {
  range?: boolean; loc?: boolean; tokens?: boolean; comment?: boolean;
  ecmaFeatures?: {jsx?: boolean; impliedStrict?: boolean; globalReturn?: boolean};
}
export interface EsprimaComment {type: string; value: string; start?: number; end?: number; range?: number[]; loc?: {start: acornTypes.Position | null | undefined; end: acornTypes.Position | null | undefined};}
export interface EsprimaToken {type: string | acornTypes.TokenType; value: acornTypes.TokenValue; start?: number; end?: number; range?: number[]; loc?: {start: acornTypes.Position | null | undefined; end: acornTypes.Position | null | undefined}; regex?: {pattern: string; flags: string};}
export interface EsprimaTokenList extends Array<EsprimaToken> { comments?: EsprimaComment[]; }
interface EspreeState {originalSourceType: string; tokens: EsprimaTokenList | null; comments: EsprimaComment[] | null; impliedStrict: boolean; ecmaVersion: number; jsxAttrValueToken: boolean; lastToken: acornTypes.Token | null; templateElements: acornTypes.Node[];}
interface EspreeError extends SyntaxError {index?: number; lineNumber?: number; column?: number;}
// Exact module body from JetStream 3.0 ./node_modules/lebab/node_modules/espree/dist/espree.cjs.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, hasEsModuleFlag, webpack, isRecord, record, readProperty} from "../../../webpack.ts";
import {load as load0, TokenType, Token, TokContext, SourceLocation, Position, Parser, Options, Node} from "../../acorn/dist/acorn.ts";
import {load as load1} from "../../acorn-jsx/index.ts";
import {load as load2} from "../../lebab--eslint-visitor-keys/dist/eslint-visitor-keys.cjs.ts";

let cache: {exports: unknown} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab--espree/dist/espree.cjs");
  return value;
 }
 return initialize();
}
function isExport(value: unknown): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && isRecord(value.Syntax) && isRecord(value.VisitorKeys) && typeof value.parse === "function" && typeof value.tokenize === "function" && typeof value.latestEcmaVersion === "number" && typeof value.name === "string" && Array.isArray(value.supportedEcmaVersions) && typeof value.version === "string";
}
function initialize() {
const exports: { __esModule?: true; "Syntax"?: typeof Syntax; "VisitorKeys"?: typeof VisitorKeys; "latestEcmaVersion"?: typeof latestEcmaVersion; "name"?: typeof name; "parse"?: typeof parse; "supportedEcmaVersions"?: typeof supportedEcmaVersions; "tokenize"?: typeof tokenize; "version"?: typeof version; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

var acorn = load0();
var jsx = load1();
var visitorKeys = load2();

function _interopDefaultLegacy<T extends (...args: never[]) => unknown>(e: T): {default: T};
function _interopDefaultLegacy(e: unknown) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

function _interopNamespace<T extends object>(e: T): T & {default?: T};
function _interopNamespace(e: object) {
    if (e && readProperty(e, "__esModule")) return e;
    var n = record(Object.create(null));
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d!.get ? d! : {
                    enumerable: true,
                    get: function () { return readProperty(e, k); }
                });
            }
        });
    }
    n["default"] = e;
    return Object.freeze(n);
}

var acorn__namespace = /*#__PURE__*/_interopNamespace(acorn);
var jsx__default = /*#__PURE__*/_interopDefaultLegacy(jsx);
var visitorKeys__namespace = /*#__PURE__*/_interopNamespace(visitorKeys);

/**
 * @fileoverview Translates tokens between Acorn format and Esprima format.
 * @author Nicholas C. Zakas
 */

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

// none!

//------------------------------------------------------------------------------
// Private
//------------------------------------------------------------------------------


// Esprima Token Types
const Token = {
    Boolean: "Boolean",
    EOF: "<end>",
    Identifier: "Identifier",
    PrivateIdentifier: "PrivateIdentifier",
    Keyword: "Keyword",
    Null: "Null",
    Numeric: "Numeric",
    Punctuator: "Punctuator",
    String: "String",
    RegularExpression: "RegularExpression",
    Template: "Template",
    JSXIdentifier: "JSXIdentifier",
    JSXText: "JSXText"
};

/**
 * Converts part of a template into an Esprima token.
 * @param {AcornToken[]} tokens The Acorn tokens representing the template.
 * @param {string} code The source code.
 * @returns {EsprimaToken} The Esprima equivalent of the template token.
 * @private
 */
function convertTemplatePart(tokens: acornTypes.Token[], code: string): EsprimaToken {
    const firstToken = tokens[0],
        lastTemplateToken = tokens[tokens.length - 1];

    const token: EsprimaToken = {
        type: Token.Template,
        value: code.slice(firstToken.start, lastTemplateToken.end)
    };

    if (firstToken.loc) {
        token.loc = {
            start: firstToken.loc.start,
            end: lastTemplateToken.loc.end
        };
    }

    if (firstToken.range) {
        token.start = firstToken.range[0];
        token.end = lastTemplateToken.range[1];
        token.range = [token.start, token.end];
    }

    return token;
}

/**
 * Contains logic to translate Acorn tokens into Esprima tokens.
 * @param {Object} acornTokTypes The Acorn token types.
 * @param {string} code The source code Acorn is parsing. This is necessary
 *      to correct the "value" property of some tokens.
 * @constructor
 */
class TokenTranslator {
declare _acornTokTypes: Record<string, acornTypes.TokenType>;
declare _tokens: acornTypes.Token[];
declare _curlyBrace: acornTypes.Token | null;
declare _code: string;
constructor(acornTokTypes: Record<string, acornTypes.TokenType>,code: string) {

    // token types
    this._acornTokTypes = acornTokTypes;

    // token buffer for templates
    this._tokens = [];

    // track the last curly brace
    this._curlyBrace = null;

    // the source code
    this._code = code;

}
translate(token: acornTypes.Token, extra: EspreeState): EsprimaToken {

        const type = tokenType(token.type),
            tt = this._acornTokTypes;

        if (type === tt.name) {
            token.type = Token.Identifier;

            // TODO: See if this is an Acorn bug
            if (token.value === "static") {
                token.type = Token.Keyword;
            }

            if (extra.ecmaVersion > 5 && (token.value === "yield" || token.value === "let")) {
                token.type = Token.Keyword;
            }

        } else if (type === tt.privateId) {
            token.type = Token.PrivateIdentifier;

        } else if (type === tt.semi || type === tt.comma ||
                 type === tt.parenL || type === tt.parenR ||
                 type === tt.braceL || type === tt.braceR ||
                 type === tt.dot || type === tt.bracketL ||
                 type === tt.colon || type === tt.question ||
                 type === tt.bracketR || type === tt.ellipsis ||
                 type === tt.arrow || type === tt.jsxTagStart ||
                 type === tt.incDec || type === tt.starstar ||
                 type === tt.jsxTagEnd || type === tt.prefix ||
                 type === tt.questionDot ||
                 (type.binop && !type.keyword) ||
                 type.isAssign) {

            token.type = Token.Punctuator;
            token.value = this._code.slice(token.start, token.end);
        } else if (type === tt.jsxName) {
            token.type = Token.JSXIdentifier;
        } else if (type.label === "jsxText" || type === tt.jsxAttrValueToken) {
            token.type = Token.JSXText;
        } else if (type.keyword) {
            if (type.keyword === "true" || type.keyword === "false") {
                token.type = Token.Boolean;
            } else if (type.keyword === "null") {
                token.type = Token.Null;
            } else {
                token.type = Token.Keyword;
            }
        } else if (type === tt.num) {
            token.type = Token.Numeric;
            token.value = this._code.slice(token.start, token.end);
        } else if (type === tt.string) {

            if (extra.jsxAttrValueToken) {
                extra.jsxAttrValueToken = false;
                token.type = Token.JSXText;
            } else {
                token.type = Token.String;
            }

            token.value = this._code.slice(token.start, token.end);
        } else if (type === tt.regexp) {
            token.type = Token.RegularExpression;
            const value = regexpValue(token.value);

            token.regex = {
                flags: value.flags,
                pattern: value.pattern
            };
            token.value = `/${value.pattern}/${value.flags}`;
        }

        return token;
    }
onToken(token: acornTypes.Token, extra: EspreeState): void {

        const tt = this._acornTokTypes,
            tokens = extra.tokens!,
            templateTokens = this._tokens;

        /**
         * Flushes the buffered template tokens and resets the template
         * tracking.
         * @returns {void}
         * @private
         */
        const translateTemplateTokens = () => {
            tokens.push(convertTemplatePart(this._tokens, this._code));
            this._tokens = [];
        };

        if (token.type === tt.eof) {

            // might be one last curlyBrace
            if (this._curlyBrace) {
                tokens.push(this.translate(this._curlyBrace, extra));
            }

            return;
        }

        if (token.type === tt.backQuote) {

            // if there's already a curly, it's not part of the template
            if (this._curlyBrace) {
                tokens.push(this.translate(this._curlyBrace, extra));
                this._curlyBrace = null;
            }

            templateTokens.push(token);

            // it's the end
            if (templateTokens.length > 1) {
                translateTemplateTokens();
            }

            return;
        }
        if (token.type === tt.dollarBraceL) {
            templateTokens.push(token);
            translateTemplateTokens();
            return;
        }
        if (token.type === tt.braceR) {

            // if there's already a curly, it's not part of the template
            if (this._curlyBrace) {
                tokens.push(this.translate(this._curlyBrace, extra));
            }

            // store new curly for later
            this._curlyBrace = token;
            return;
        }
        if (token.type === tt.template || token.type === tt.invalidTemplate) {
            if (this._curlyBrace) {
                templateTokens.push(this._curlyBrace);
                this._curlyBrace = null;
            }

            templateTokens.push(token);
            return;
        }

        if (this._curlyBrace) {
            tokens.push(this.translate(this._curlyBrace, extra));
            this._curlyBrace = null;
        }

        tokens.push(this.translate(token, extra));
    }
}



/**
 * @fileoverview A collection of methods for processing Espree's options.
 * @author Kai Cataldo
 */

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const SUPPORTED_VERSIONS = [
    3,
    5,
    6, // 2015
    7, // 2016
    8, // 2017
    9, // 2018
    10, // 2019
    11, // 2020
    12, // 2021
    13, // 2022
    14, // 2023
    15 // 2024
];

/**
 * Get the latest ECMAScript version supported by Espree.
 * @returns {number} The latest ECMAScript version.
 */
function getLatestEcmaVersion() {
    return SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1];
}

/**
 * Get the list of ECMAScript versions supported by Espree.
 * @returns {number[]} An array containing the supported ECMAScript versions.
 */
function getSupportedEcmaVersions() {
    return [...SUPPORTED_VERSIONS];
}

/**
 * Normalize ECMAScript version from the initial config
 * @param {(number|"latest")} ecmaVersion ECMAScript version from the initial config
 * @throws {Error} throws an error if the ecmaVersion is invalid.
 * @returns {number} normalized ECMAScript version
 */
function normalizeEcmaVersion(ecmaVersion: number | string | null = 5): number {

    let version = ecmaVersion === "latest" ? getLatestEcmaVersion() : ecmaVersion;

    if (typeof version !== "number") {
        throw new Error(`ecmaVersion must be a number or "latest". Received value of type ${typeof ecmaVersion} instead.`);
    }

    // Calculate ECMAScript edition number from official year version starting with
    // ES2015, which corresponds with ES6 (or a difference of 2009).
    if (version >= 2015) {
        version -= 2009;
    }

    if (!SUPPORTED_VERSIONS.includes(version)) {
        throw new Error("Invalid ecmaVersion.");
    }

    return version;
}

/**
 * Normalize sourceType from the initial config
 * @param {string} sourceType to normalize
 * @throws {Error} throw an error if sourceType is invalid
 * @returns {string} normalized sourceType
 */
function normalizeSourceType(sourceType = "script"): string {
    if (sourceType === "script" || sourceType === "module") {
        return sourceType;
    }

    if (sourceType === "commonjs") {
        return "script";
    }

    throw new Error("Invalid sourceType.");
}

/**
 * Normalize parserOptions
 * @param {Object} options the parser options to normalize
 * @throws {Error} throw an error if found invalid option.
 * @returns {Object} normalized options
 */
function normalizeOptions(options: EspreeOptions) {
    const ecmaVersion = normalizeEcmaVersion(options.ecmaVersion);
    const sourceType = normalizeSourceType(options.sourceType);
    const ranges = options.range === true;
    const locations = options.loc === true;

    if (ecmaVersion !== 3 && options.allowReserved) {

        // a value of `false` is intentionally allowed here, so a shared config can overwrite it when needed
        throw new Error("`allowReserved` is only supported when ecmaVersion is 3");
    }
    if (typeof options.allowReserved !== "undefined" && typeof options.allowReserved !== "boolean") {
        throw new Error("`allowReserved`, when present, must be `true` or `false`");
    }
    const allowReserved = ecmaVersion === 3 ? (options.allowReserved || "never") : false;
    const ecmaFeatures = options.ecmaFeatures || {};
    const allowReturnOutsideFunction = options.sourceType === "commonjs" ||
        Boolean(ecmaFeatures.globalReturn);

    if (sourceType === "module" && ecmaVersion < 6) {
        throw new Error("sourceType 'module' is not supported when ecmaVersion < 2015. Consider adding `{ ecmaVersion: 2015 }` to the parser options.");
    }

    return Object.assign({}, options, {
        ecmaVersion,
        sourceType,
        ranges,
        locations,
        allowReserved,
        allowReturnOutsideFunction
    });
}

/* eslint no-param-reassign: 0 -- stylistic choice */


const STATE = Symbol("espree's internal state");
const ESPRIMA_FINISH_NODE = Symbol("espree's esprimaFinishNode");


/**
 * Converts an Acorn comment to a Esprima comment.
 * @param {boolean} block True if it's a block comment, false if not.
 * @param {string} text The text of the comment.
 * @param {int} start The index at which the comment starts.
 * @param {int} end The index at which the comment ends.
 * @param {Location} startLoc The location at which the comment starts.
 * @param {Location} endLoc The location at which the comment ends.
 * @param {string} code The source code being parsed.
 * @returns {Object} The comment object.
 * @private
 */
function convertAcornCommentToEsprimaComment(block: boolean, text: string, start: number, end: number, startLoc: acornTypes.Position | null | undefined, endLoc: acornTypes.Position | null | undefined, code: string): EsprimaComment {
    let type: EsprimaComment["type"];

    if (block) {
        type = "Block";
    } else if (code.slice(start, start + 2) === "#!") {
        type = "Hashbang";
    } else {
        type = "Line";
    }

    const comment: EsprimaComment = {
        type,
        value: text
    };

    if (typeof start === "number") {
        comment.start = start;
        comment.end = end;
        comment.range = [start, end];
    }

    if (typeof startLoc === "object") {
        comment.loc = {
            start: startLoc,
            end: endLoc
        };
    }

    return comment;
}

var espree = () => (Parser: typeof acornTypes.Parser) => {
    const tokTypes = Object.assign({}, Parser.acorn.tokTypes);

    if (Parser.acornJsx) {
        Object.assign(tokTypes, Parser.acornJsx.tokTypes);
    }

    return class Espree extends Parser {
        declare [STATE]: EspreeState;
        constructor(opts: EspreeOptions | undefined, code: string) {
            if (typeof opts !== "object" || opts === null) {
                opts = {};
            }
            if (typeof code !== "string" && !(isBoxedString(code))) {
                code = String(code);
            }

            // save original source type in case of commonjs
            const originalSourceType = opts.sourceType;
            const options = normalizeOptions(opts);
            const ecmaFeatures = options.ecmaFeatures || {};
            const tokenTranslator =
                options.tokens === true
                    ? new TokenTranslator(tokTypes, code)
                    : null;

            /*
             * Data that is unique to Espree and is not represented internally
             * in Acorn.
             *
             * For ES2023 hashbangs, Espree will call `onComment()` during the
             * constructor, so we must define state before having access to
             * `this`.
             */
            const state: EspreeState = {
                originalSourceType: originalSourceType || options.sourceType,
                tokens: tokenTranslator ? [] : null,
                comments: options.comment === true ? [] : null,
                impliedStrict: ecmaFeatures.impliedStrict === true && options.ecmaVersion >= 5,
                ecmaVersion: options.ecmaVersion,
                jsxAttrValueToken: false,
                lastToken: null,
                templateElements: []
            };

            // Initialize acorn parser.
            super({

                // do not use spread, because we don't want to pass any unknown options to acorn
                ecmaVersion: options.ecmaVersion,
                sourceType: options.sourceType,
                ranges: options.ranges,
                locations: options.locations,
                allowReserved: options.allowReserved,

                // Truthy value is true for backward compatibility.
                allowReturnOutsideFunction: options.allowReturnOutsideFunction,

                // Collect tokens
                onToken(token) {
                    if (tokenTranslator) {

                        // Use `tokens`, `ecmaVersion`, and `jsxAttrValueToken` in the state.
                        tokenTranslator.onToken(token, state);
                    }
                    if (token.type !== tokTypes.eof) {
                        state.lastToken = token;
                    }
                },

                // Collect comments
                onComment(block, text, start, end, startLoc, endLoc) {
                    if (state.comments) {
                        const comment = convertAcornCommentToEsprimaComment(block, text, start, end, startLoc, endLoc, code);

                        state.comments.push(comment);
                    }
                }
            }, code);

            /*
             * We put all of this data into a symbol property as a way to avoid
             * potential naming conflicts with future versions of Acorn.
             */
            this[STATE] = state;
        }

        tokenize() {
            do {
                this.next();
            } while (this.type !== tokTypes.eof);

            // Consume the final eof token
            this.next();

            const extra = this[STATE];
            const tokens = extra.tokens!;

            if (extra.comments) {
                tokens.comments = extra.comments;
            }

            return tokens;
        }

        finishNode(...args: Parameters<acornTypes.Parser["finishNode"]>) {
            const result = super.finishNode(...args);

            return this[ESPRIMA_FINISH_NODE](result);
        }

        finishNodeAt(...args: Parameters<acornTypes.Parser["finishNodeAt"]>) {
            const result = super.finishNodeAt(...args);

            return this[ESPRIMA_FINISH_NODE](result);
        }

        parse() {
            const extra = this[STATE];
            const program = super.parse();

            program.sourceType = extra.originalSourceType;

            if (extra.comments) {
                program.comments = extra.comments;
            }
            if (extra.tokens) {
                program.tokens = extra.tokens;
            }

            /*
             * Adjust opening and closing position of program to match Esprima.
             * Acorn always starts programs at range 0 whereas Esprima starts at the
             * first AST node's start (the only real difference is when there's leading
             * whitespace or leading comments). Acorn also counts trailing whitespace
             * as part of the program whereas Esprima only counts up to the last token.
             */
            if (program.body.length) {
                const [firstNode] = nodeArray(program.body);

                if (program.range) {
                    program.range[0] = firstNode.range[0];
                }
                if (program.loc) {
                    program.loc.start = firstNode.loc.start;
                }
                program.start = firstNode.start;
            }
            if (extra.lastToken) {
                if (program.range) {
                    program.range[1] = extra.lastToken.range[1];
                }
                if (program.loc) {
                    program.loc.end = extra.lastToken.loc.end;
                }
                program.end = extra.lastToken.end;
            }


            /*
             * https://github.com/eslint/espree/issues/349
             * Ensure that template elements have correct range information.
             * This is one location where Acorn produces a different value
             * for its start and end properties vs. the values present in the
             * range property. In order to avoid confusion, we set the start
             * and end properties to the values that are present in range.
             * This is done here, instead of in finishNode(), because Acorn
             * uses the values of start and end internally while parsing, making
             * it dangerous to change those values while parsing is ongoing.
             * By waiting until the end of parsing, we can safely change these
             * values without affect any other part of the process.
             */
            this[STATE].templateElements.forEach((templateElement) => {
                const startOffset = -1;
                const endOffset = templateElement.tail ? 1 : 2;

                templateElement.start += startOffset;
                templateElement.end += endOffset;

                if (templateElement.range) {
                    templateElement.range[0] += startOffset;
                    templateElement.range[1] += endOffset;
                }

                if (templateElement.loc) {
                    templateElement.loc.start!.column += startOffset;
                    templateElement.loc.end!.column += endOffset;
                }
            });

            return program;
        }

        parseTopLevel(node: acornTypes.Node): acornTypes.Node {
            if (this[STATE].impliedStrict) {
                this.strict = true;
            }
            return super.parseTopLevel(node);
        }

        /**
         * Overwrites the default raise method to throw Esprima-style errors.
         * @param {int} pos The position of the error.
         * @param {string} message The error message.
         * @throws {SyntaxError} A syntax error.
         * @returns {void}
         */
        raise(pos: number, message: string): never {
            const loc = Parser.acorn.getLineInfo(this.input, pos);
            const err: EspreeError = new SyntaxError(message);

            err.index = pos;
            err.lineNumber = loc.line;
            err.column = loc.column + 1; // acorn uses 0-based columns
            throw err;
        }

        /**
         * Overwrites the default raise method to throw Esprima-style errors.
         * @param {int} pos The position of the error.
         * @param {string} message The error message.
         * @throws {SyntaxError} A syntax error.
         * @returns {void}
         */
        raiseRecoverable(pos: number, message: string): never {
            this.raise(pos, message);
        }

        /**
         * Overwrites the default unexpected method to throw Esprima-style errors.
         * @param {int} pos The position of the error.
         * @throws {SyntaxError} A syntax error.
         * @returns {void}
         */
        unexpected(pos?: number | null): never {
            let message = "Unexpected token";

            if (pos !== null && pos !== void 0) {
                this.pos = pos;

                if (this.options.locations) {
                    while (this.pos < this.lineStart) {
                        this.lineStart = this.input.lastIndexOf("\n", this.lineStart - 2) + 1;
                        --this.curLine;
                    }
                }

                this.nextToken();
            }

            if (this.end > this.start) {
                message += ` ${this.input.slice(this.start, this.end)}`;
            }

            this.raise(this.start, message);
        }

        /*
        * Esprima-FB represents JSX strings as tokens called "JSXText", but Acorn-JSX
        * uses regular tt.string without any distinction between this and regular JS
        * strings. As such, we intercept an attempt to read a JSX string and set a flag
        * on extra so that when tokens are converted, the next token will be switched
        * to JSXText via onToken.
        */
        jsx_readString(quote: number): void { // eslint-disable-line camelcase -- required by API
            const result = super.jsx_readString(quote);

            if (this.type === tokTypes.string) {
                this[STATE].jsxAttrValueToken = true;
            }
            return result;
        }

        /**
         * Performs last-minute Esprima-specific compatibility checks and fixes.
         * @param {ASTNode} result The node to check.
         * @returns {ASTNode} The finished node.
         */
        [ESPRIMA_FINISH_NODE](result: acornTypes.Node): acornTypes.Node {

            // Acorn doesn't count the opening and closing backticks as part of templates
            // so we have to adjust ranges/locations appropriately.
            if (result.type === "TemplateElement") {

                // save template element references to fix start/end later
                this[STATE].templateElements.push(result);
            }

            if (result.type.includes("Function") && !result.generator) {
                result.generator = false;
            }

            return result;
        }
    };
};

const version$1 = "9.6.1";

/* eslint-disable jsdoc/no-multi-asterisks -- needed to preserve original formatting of licences */


// To initialize lazily.
type EspreeConstructor = ReturnType<ReturnType<typeof espree>>;
interface ParserCache {
  _regular: EspreeConstructor | null;
  _jsx: EspreeConstructor | null;
  readonly regular: EspreeConstructor;
  readonly jsx: EspreeConstructor;
  get(options?: EspreeOptions): EspreeConstructor;
}
const parsers: ParserCache = {
    _regular: null,
    _jsx: null,

    get regular() {
        if (this._regular === null) {
            this._regular = acorn__namespace.Parser.extend(espree());
        }
        return this._regular;
    },

    get jsx() {
        if (this._jsx === null) {
            this._jsx = acorn__namespace.Parser.extend(jsx__default["default"](), espree());
        }
        return this._jsx;
    },

    get(options?: EspreeOptions) {
        const useJsx = Boolean(
            options &&
            options.ecmaFeatures &&
            options.ecmaFeatures.jsx
        );

        return useJsx ? this.jsx : this.regular;
    }
};

//------------------------------------------------------------------------------
// Tokenizer
//------------------------------------------------------------------------------

/**
 * Tokenizes the given code.
 * @param {string} code The code to tokenize.
 * @param {Object} options Options defining how to tokenize.
 * @returns {Token[]} An array of tokens.
 * @throws {SyntaxError} If the input code is invalid.
 * @private
 */
function tokenize(code: string, options: EspreeOptions): EsprimaTokenList {
    const Parser = parsers.get(options);

    // Ensure to collect tokens.
    if (!options || options.tokens !== true) {
        options = Object.assign({}, options, { tokens: true }); // eslint-disable-line no-param-reassign -- stylistic choice
    }

    return new Parser(options, code).tokenize();
}

//------------------------------------------------------------------------------
// Parser
//------------------------------------------------------------------------------

/**
 * Parses the given code.
 * @param {string} code The code to tokenize.
 * @param {Object} options Options defining how to tokenize.
 * @returns {ASTNode} The "Program" AST node.
 * @throws {SyntaxError} If the input code is invalid.
 */
function parse(code: string, options?: EspreeOptions): acornTypes.Node {
    const Parser = parsers.get(options);

    return new Parser(options, code).parse();
}

//------------------------------------------------------------------------------
// Public
//------------------------------------------------------------------------------

const version = version$1;
const name = "espree";

/* istanbul ignore next */
const VisitorKeys = (function() {
    return visitorKeys__namespace.KEYS;
}());

// Derive node types from VisitorKeys
/* istanbul ignore next */
const Syntax = (function() {
    let key: string,
        types: Record<string, string> = {};

    if (typeof Object.create === "function") {
        types = Object.create(null);
    }

    for (key in VisitorKeys) {
        if (Object.hasOwnProperty.call(VisitorKeys, key)) {
            types[key] = key;
        }
    }

    if (typeof Object.freeze === "function") {
        Object.freeze(types);
    }

    return types;
}());

const latestEcmaVersion = getLatestEcmaVersion();

const supportedEcmaVersions = getSupportedEcmaVersions();

exports.Syntax = Syntax;
exports.VisitorKeys = VisitorKeys;
exports.latestEcmaVersion = latestEcmaVersion;
exports.name = name;
exports.parse = parse;
exports.supportedEcmaVersions = supportedEcmaVersions;
exports.tokenize = tokenize;
exports.version = version;


/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["Syntax", "VisitorKeys", "latestEcmaVersion", "name", "parse", "supportedEcmaVersions", "tokenize", "version"])) throw new TypeError("Incomplete bundled exports");
return exports;
}

function tokenType(value: string | acornTypes.TokenType): acornTypes.TokenType {
  const AcornTokenType = load0().TokenType;
  if (!(value instanceof AcornTokenType)) throw new TypeError("Expected untranslated Acorn token");
  return value;
}
function isBoxedString(value: unknown): value is String { return value instanceof String; }
