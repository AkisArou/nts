
// Exact Esprima 4.0.1 module from the pinned Lebab bundle; BSD-2-Clause.
import {exportsReady, hasEsModuleFlag} from "../../../../webpack.ts";
let cache: Partial<ReturnType<typeof initialize>> | undefined;
export function load(): ReturnType<typeof initialize> { if (cache !== undefined) { if (!isReady(cache)) throw new TypeError("Incomplete cached Esprima exports"); return cache; } return initialize(); }
function isReady(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> { return hasEsModuleFlag(value) && exportsReady(value, ["Syntax"]); }
function initialize() {
const exports: {__esModule?:true; "Syntax"?: Syntax;} = {};
cache = exports;


	"use strict";
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Syntax = {
	    AssignmentExpression: 'AssignmentExpression',
	    AssignmentPattern: 'AssignmentPattern',
	    ArrayExpression: 'ArrayExpression',
	    ArrayPattern: 'ArrayPattern',
	    ArrowFunctionExpression: 'ArrowFunctionExpression',
	    AwaitExpression: 'AwaitExpression',
	    BlockStatement: 'BlockStatement',
	    BinaryExpression: 'BinaryExpression',
	    BreakStatement: 'BreakStatement',
	    CallExpression: 'CallExpression',
	    CatchClause: 'CatchClause',
	    ClassBody: 'ClassBody',
	    ClassDeclaration: 'ClassDeclaration',
	    ClassExpression: 'ClassExpression',
	    ConditionalExpression: 'ConditionalExpression',
	    ContinueStatement: 'ContinueStatement',
	    DoWhileStatement: 'DoWhileStatement',
	    DebuggerStatement: 'DebuggerStatement',
	    EmptyStatement: 'EmptyStatement',
	    ExportAllDeclaration: 'ExportAllDeclaration',
	    ExportDefaultDeclaration: 'ExportDefaultDeclaration',
	    ExportNamedDeclaration: 'ExportNamedDeclaration',
	    ExportSpecifier: 'ExportSpecifier',
	    ExpressionStatement: 'ExpressionStatement',
	    ForStatement: 'ForStatement',
	    ForOfStatement: 'ForOfStatement',
	    ForInStatement: 'ForInStatement',
	    FunctionDeclaration: 'FunctionDeclaration',
	    FunctionExpression: 'FunctionExpression',
	    Identifier: 'Identifier',
	    IfStatement: 'IfStatement',
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
	    SwitchCase: 'SwitchCase',
	    SwitchStatement: 'SwitchStatement',
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


/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected Esprima module flag");
if (!exportsReady(exports, ["Syntax"])) throw new TypeError("Incomplete Esprima exports");
return exports;
}

export type Syntax = { AssignmentExpression: "AssignmentExpression"; AssignmentPattern: "AssignmentPattern"; ArrayExpression: "ArrayExpression"; ArrayPattern: "ArrayPattern"; ArrowFunctionExpression: "ArrowFunctionExpression"; AwaitExpression: "AwaitExpression"; BlockStatement: "BlockStatement"; BinaryExpression: "BinaryExpression"; BreakStatement: "BreakStatement"; CallExpression: "CallExpression"; CatchClause: "CatchClause"; ClassBody: "ClassBody"; ClassDeclaration: "ClassDeclaration"; ClassExpression: "ClassExpression"; ConditionalExpression: "ConditionalExpression"; ContinueStatement: "ContinueStatement"; DoWhileStatement: "DoWhileStatement"; DebuggerStatement: "DebuggerStatement"; EmptyStatement: "EmptyStatement"; ExportAllDeclaration: "ExportAllDeclaration"; ExportDefaultDeclaration: "ExportDefaultDeclaration"; ExportNamedDeclaration: "ExportNamedDeclaration"; ExportSpecifier: "ExportSpecifier"; ExpressionStatement: "ExpressionStatement"; ForStatement: "ForStatement"; ForOfStatement: "ForOfStatement"; ForInStatement: "ForInStatement"; FunctionDeclaration: "FunctionDeclaration"; FunctionExpression: "FunctionExpression"; Identifier: "Identifier"; IfStatement: "IfStatement"; ImportDeclaration: "ImportDeclaration"; ImportDefaultSpecifier: "ImportDefaultSpecifier"; ImportNamespaceSpecifier: "ImportNamespaceSpecifier"; ImportSpecifier: "ImportSpecifier"; Literal: "Literal"; LabeledStatement: "LabeledStatement"; LogicalExpression: "LogicalExpression"; MemberExpression: "MemberExpression"; MetaProperty: "MetaProperty"; MethodDefinition: "MethodDefinition"; NewExpression: "NewExpression"; ObjectExpression: "ObjectExpression"; ObjectPattern: "ObjectPattern"; Program: "Program"; Property: "Property"; RestElement: "RestElement"; ReturnStatement: "ReturnStatement"; SequenceExpression: "SequenceExpression"; SpreadElement: "SpreadElement"; Super: "Super"; SwitchCase: "SwitchCase"; SwitchStatement: "SwitchStatement"; TaggedTemplateExpression: "TaggedTemplateExpression"; TemplateElement: "TemplateElement"; TemplateLiteral: "TemplateLiteral"; ThisExpression: "ThisExpression"; ThrowStatement: "ThrowStatement"; TryStatement: "TryStatement"; UnaryExpression: "UnaryExpression"; UpdateExpression: "UpdateExpression"; VariableDeclaration: "VariableDeclaration"; VariableDeclarator: "VariableDeclarator"; WhileStatement: "WhileStatement"; WithStatement: "WithStatement"; YieldExpression: "YieldExpression"; };
