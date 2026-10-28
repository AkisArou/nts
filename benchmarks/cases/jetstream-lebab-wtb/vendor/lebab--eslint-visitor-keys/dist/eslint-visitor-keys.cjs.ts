// Exact module body from JetStream 3.0 ./node_modules/lebab/node_modules/eslint-visitor-keys/dist/eslint-visitor-keys.cjs.
// Modified: strict TypeScript transcription and static module packaging; original program logic retained.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {webpack, isRecord} from "../../../webpack.ts";

interface VisitorKeysExports {
 __esModule: true;
 KEYS: Record<string, readonly string[]>;
 getKeys(node: {}): string[];
 unionWith(additionalKeys: Record<string, readonly string[]>): Readonly<Record<string, readonly string[]>>;
}

let cache: {exports: Partial<VisitorKeysExports>} | undefined;
export function load(): VisitorKeysExports {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab--eslint-visitor-keys/dist/eslint-visitor-keys.cjs");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<VisitorKeysExports>): value is VisitorKeysExports {
 return value.__esModule === true && value.KEYS !== undefined &&
  typeof value.getKeys === "function" && typeof value.unionWith === "function";
}
function initialize(): VisitorKeysExports {
const exports: Partial<VisitorKeysExports> = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({ value: true }));

/**
 * @typedef {{ readonly [type: string]: ReadonlyArray<string> }} VisitorKeys
 */

/**
 * @type {VisitorKeys}
 */
const KEYS: Record<string, readonly string[]> = {
    ArrayExpression: [
        "elements"
    ],
    ArrayPattern: [
        "elements"
    ],
    ArrowFunctionExpression: [
        "params",
        "body"
    ],
    AssignmentExpression: [
        "left",
        "right"
    ],
    AssignmentPattern: [
        "left",
        "right"
    ],
    AwaitExpression: [
        "argument"
    ],
    BinaryExpression: [
        "left",
        "right"
    ],
    BlockStatement: [
        "body"
    ],
    BreakStatement: [
        "label"
    ],
    CallExpression: [
        "callee",
        "arguments"
    ],
    CatchClause: [
        "param",
        "body"
    ],
    ChainExpression: [
        "expression"
    ],
    ClassBody: [
        "body"
    ],
    ClassDeclaration: [
        "id",
        "superClass",
        "body"
    ],
    ClassExpression: [
        "id",
        "superClass",
        "body"
    ],
    ConditionalExpression: [
        "test",
        "consequent",
        "alternate"
    ],
    ContinueStatement: [
        "label"
    ],
    DebuggerStatement: [],
    DoWhileStatement: [
        "body",
        "test"
    ],
    EmptyStatement: [],
    ExperimentalRestProperty: [
        "argument"
    ],
    ExperimentalSpreadProperty: [
        "argument"
    ],
    ExportAllDeclaration: [
        "exported",
        "source"
    ],
    ExportDefaultDeclaration: [
        "declaration"
    ],
    ExportNamedDeclaration: [
        "declaration",
        "specifiers",
        "source"
    ],
    ExportSpecifier: [
        "exported",
        "local"
    ],
    ExpressionStatement: [
        "expression"
    ],
    ForInStatement: [
        "left",
        "right",
        "body"
    ],
    ForOfStatement: [
        "left",
        "right",
        "body"
    ],
    ForStatement: [
        "init",
        "test",
        "update",
        "body"
    ],
    FunctionDeclaration: [
        "id",
        "params",
        "body"
    ],
    FunctionExpression: [
        "id",
        "params",
        "body"
    ],
    Identifier: [],
    IfStatement: [
        "test",
        "consequent",
        "alternate"
    ],
    ImportDeclaration: [
        "specifiers",
        "source"
    ],
    ImportDefaultSpecifier: [
        "local"
    ],
    ImportExpression: [
        "source"
    ],
    ImportNamespaceSpecifier: [
        "local"
    ],
    ImportSpecifier: [
        "imported",
        "local"
    ],
    JSXAttribute: [
        "name",
        "value"
    ],
    JSXClosingElement: [
        "name"
    ],
    JSXClosingFragment: [],
    JSXElement: [
        "openingElement",
        "children",
        "closingElement"
    ],
    JSXEmptyExpression: [],
    JSXExpressionContainer: [
        "expression"
    ],
    JSXFragment: [
        "openingFragment",
        "children",
        "closingFragment"
    ],
    JSXIdentifier: [],
    JSXMemberExpression: [
        "object",
        "property"
    ],
    JSXNamespacedName: [
        "namespace",
        "name"
    ],
    JSXOpeningElement: [
        "name",
        "attributes"
    ],
    JSXOpeningFragment: [],
    JSXSpreadAttribute: [
        "argument"
    ],
    JSXSpreadChild: [
        "expression"
    ],
    JSXText: [],
    LabeledStatement: [
        "label",
        "body"
    ],
    Literal: [],
    LogicalExpression: [
        "left",
        "right"
    ],
    MemberExpression: [
        "object",
        "property"
    ],
    MetaProperty: [
        "meta",
        "property"
    ],
    MethodDefinition: [
        "key",
        "value"
    ],
    NewExpression: [
        "callee",
        "arguments"
    ],
    ObjectExpression: [
        "properties"
    ],
    ObjectPattern: [
        "properties"
    ],
    PrivateIdentifier: [],
    Program: [
        "body"
    ],
    Property: [
        "key",
        "value"
    ],
    PropertyDefinition: [
        "key",
        "value"
    ],
    RestElement: [
        "argument"
    ],
    ReturnStatement: [
        "argument"
    ],
    SequenceExpression: [
        "expressions"
    ],
    SpreadElement: [
        "argument"
    ],
    StaticBlock: [
        "body"
    ],
    Super: [],
    SwitchCase: [
        "test",
        "consequent"
    ],
    SwitchStatement: [
        "discriminant",
        "cases"
    ],
    TaggedTemplateExpression: [
        "tag",
        "quasi"
    ],
    TemplateElement: [],
    TemplateLiteral: [
        "quasis",
        "expressions"
    ],
    ThisExpression: [],
    ThrowStatement: [
        "argument"
    ],
    TryStatement: [
        "block",
        "handler",
        "finalizer"
    ],
    UnaryExpression: [
        "argument"
    ],
    UpdateExpression: [
        "argument"
    ],
    VariableDeclaration: [
        "declarations"
    ],
    VariableDeclarator: [
        "id",
        "init"
    ],
    WhileStatement: [
        "test",
        "body"
    ],
    WithStatement: [
        "object",
        "body"
    ],
    YieldExpression: [
        "argument"
    ]
};

// Types.
const NODE_TYPES = Object.keys(KEYS);

// Freeze the keys.
for (const type of NODE_TYPES) {
    Object.freeze(KEYS[type]);
}
Object.freeze(KEYS);

/**
 * @author Toru Nagashima <https://github.com/mysticatea>
 * See LICENSE file in root directory for full license.
 */

/**
 * @typedef {import('./visitor-keys.js').VisitorKeys} VisitorKeys
 */

// List to ignore keys.
const KEY_BLACKLIST = new Set([
    "parent",
    "leadingComments",
    "trailingComments"
]);

/**
 * Check whether a given key should be used or not.
 * @param {string} key The key to check.
 * @returns {boolean} `true` if the key should be used.
 */
function filterKey(key: string) {
    return !KEY_BLACKLIST.has(key) && key[0] !== "_";
}

/**
 * Get visitor keys of a given node.
 * @param {object} node The AST node to get keys.
 * @returns {readonly string[]} Visitor keys of the node.
 */
function getKeys(node: {}) {
    return Object.keys(node).filter(filterKey);
}

// Disable valid-jsdoc rule because it reports syntax error on the type of @returns.
// eslint-disable-next-line valid-jsdoc
/**
 * Make the union set with `KEYS` and given keys.
 * @param {VisitorKeys} additionalKeys The additional keys.
 * @returns {VisitorKeys} The union set.
 */
function unionWith(additionalKeys: Record<string, readonly string[]>) {
    const retv = /** @type {{
        [type: string]: ReadonlyArray<string>
    }} */ (Object.assign({}, KEYS));

    for (const type of Object.keys(additionalKeys)) {
        if (Object.prototype.hasOwnProperty.call(retv, type)) {
            const keys = new Set(additionalKeys[type]);

            for (const key of retv[type]) {
                keys.add(key);
            }

            retv[type] = Object.freeze(Array.from(keys));
        } else {
            retv[type] = Object.freeze(Array.from(additionalKeys[type]));
        }
    }

    return Object.freeze(retv);
}

exports.KEYS = KEYS;
exports.getKeys = getKeys;
exports.unionWith = unionWith;


/***/ 
if (!isExport(exports)) throw new TypeError("Incomplete initialized visitor-keys export");
return exports;
}
