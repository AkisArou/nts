import type {BaseNode} from "./node-metadata.ts";
import type { Syntax } from "./syntax.ts";
export type ArgumentListElement = Expression | SpreadElement;
export type ArrayExpressionElement = Expression | SpreadElement | null;
export type ArrayPatternElement = AssignmentPattern | BindingIdentifier | BindingPattern | RestElement | null;
export type BindingPattern = ArrayPattern | ObjectPattern;
export type BindingIdentifier = Identifier;
export type Declaration = AsyncFunctionDeclaration | ClassDeclaration | ExportDeclaration | FunctionDeclaration | ImportDeclaration | VariableDeclaration;
export type ExportableDefaultDeclaration = BindingIdentifier | BindingPattern | ClassDeclaration | Expression | FunctionDeclaration;
export type ExportableNamedDeclaration = AsyncFunctionDeclaration | ClassDeclaration | FunctionDeclaration | VariableDeclaration;
export type ExportDeclaration = ExportAllDeclaration | ExportDefaultDeclaration | ExportNamedDeclaration;
export type Expression = ArrayExpression | ArrowFunctionExpression | AssignmentExpression | AsyncArrowFunctionExpression | AsyncFunctionExpression |
    AwaitExpression | BinaryExpression | CallExpression | ClassExpression | ComputedMemberExpression |
    ConditionalExpression | Identifier | FunctionExpression | Literal | NewExpression | ObjectExpression |
    RegexLiteral | SequenceExpression | StaticMemberExpression | TaggedTemplateExpression |
    ThisExpression | UnaryExpression | UpdateExpression | YieldExpression | TemplateLiteral | Super | MetaProperty | BindingPattern | AssignmentPattern | RestElement | SpreadElement | import("./jsx-nodes.ts").JSXElement | import("./parser.ts").ArrowParameterPlaceHolderNode;
export type FunctionParameter = Expression;
export type ImportDeclarationSpecifier = ImportDefaultSpecifier | ImportNamespaceSpecifier | ImportSpecifier;
export type Statement = AsyncFunctionDeclaration | BreakStatement | ContinueStatement | DebuggerStatement | DoWhileStatement |
    EmptyStatement | ExpressionStatement | Directive | ForStatement | ForInStatement | ForOfStatement |
    FunctionDeclaration | IfStatement | ReturnStatement | SwitchStatement | ThrowStatement |
    TryStatement | VariableDeclaration | WhileStatement | WithStatement | BlockStatement | LabeledStatement;
export type PropertyKey = Expression;
export type PropertyValue = AssignmentPattern | Expression | BindingPattern;
export type StatementListItem = Declaration | Statement;
export interface TemplateElementValue {
    cooked: string;
    raw: string;
}
export interface ArrayExpression extends BaseNode { readonly type: "ArrayExpression"; readonly elements: ArrayExpressionElement[]; }
export interface ArrayPattern extends BaseNode { readonly type: "ArrayPattern"; readonly elements: ArrayPatternElement[]; }
export interface ArrowFunctionExpression extends BaseNode { readonly type: "ArrowFunctionExpression"; readonly id: Identifier | null; readonly params: FunctionParameter[]; readonly body: BlockStatement | Expression; readonly generator: boolean; readonly expression: boolean; readonly async: boolean; }
export interface AssignmentExpression extends BaseNode { readonly type: "AssignmentExpression"; readonly operator: string; readonly left: Expression; readonly right: Expression; }
export interface AssignmentPattern extends BaseNode { readonly type: "AssignmentPattern"; readonly left: BindingIdentifier | BindingPattern; readonly right: Expression; }
export interface AsyncArrowFunctionExpression extends BaseNode { readonly type: "ArrowFunctionExpression"; readonly id: Identifier | null; readonly params: FunctionParameter[]; readonly body: BlockStatement | Expression; readonly generator: boolean; readonly expression: boolean; readonly async: boolean; }
export interface AsyncFunctionDeclaration extends BaseNode { readonly type: "FunctionDeclaration"; readonly id: Identifier | null; readonly params: FunctionParameter[]; readonly body: BlockStatement; readonly generator: boolean; readonly expression: boolean; readonly async: boolean; }
export interface AsyncFunctionExpression extends BaseNode { readonly type: "FunctionExpression"; readonly id: Identifier | null; readonly params: FunctionParameter[]; readonly body: BlockStatement; readonly generator: boolean; readonly expression: boolean; readonly async: boolean; }
export interface AwaitExpression extends BaseNode { readonly type: "AwaitExpression"; readonly argument: Expression; }
export interface BinaryExpression extends BaseNode { readonly type: "LogicalExpression" | "BinaryExpression"; readonly operator: string; readonly left: Expression; readonly right: Expression; }
export interface BlockStatement extends BaseNode { readonly type: "BlockStatement"; readonly body: StatementListItem[]; }
export interface BreakStatement extends BaseNode { readonly type: "BreakStatement"; readonly label: Identifier | null; }
export interface CallExpression extends BaseNode { readonly type: "CallExpression"; readonly callee: Expression; readonly arguments: ArgumentListElement[]; }
export interface CatchClause extends BaseNode { readonly type: "CatchClause"; readonly param: BindingIdentifier | BindingPattern; readonly body: BlockStatement; }
export interface ClassBody extends BaseNode { readonly type: "ClassBody"; readonly body: MethodDefinition[]; }
export interface ClassDeclaration extends BaseNode { readonly type: "ClassDeclaration"; readonly id: Identifier | null; readonly superClass: Expression | null; readonly body: ClassBody; }
export interface ClassExpression extends BaseNode { readonly type: "ClassExpression"; readonly id: Identifier | null; readonly superClass: Expression | null; readonly body: ClassBody; }
export interface ComputedMemberExpression extends BaseNode { readonly type: "MemberExpression"; readonly computed: boolean; readonly object: Expression; readonly property: Expression; }
export interface ConditionalExpression extends BaseNode { readonly type: "ConditionalExpression"; readonly test: Expression; readonly consequent: Expression; readonly alternate: Expression; }
export interface ContinueStatement extends BaseNode { readonly type: "ContinueStatement"; readonly label: Identifier | null; }
export interface DebuggerStatement extends BaseNode { readonly type: "DebuggerStatement"; }
export interface Directive extends BaseNode { readonly type: "ExpressionStatement"; readonly expression: Expression; readonly directive: string; }
export interface DoWhileStatement extends BaseNode { readonly type: "DoWhileStatement"; readonly body: Statement; readonly test: Expression; }
export interface EmptyStatement extends BaseNode { readonly type: "EmptyStatement"; }
export interface ExportAllDeclaration extends BaseNode { readonly type: "ExportAllDeclaration"; readonly source: Literal; }
export interface ExportDefaultDeclaration extends BaseNode { readonly type: "ExportDefaultDeclaration"; readonly declaration: ExportableDefaultDeclaration; }
export interface ExportNamedDeclaration extends BaseNode { readonly type: "ExportNamedDeclaration"; readonly declaration: ExportableNamedDeclaration | null; readonly specifiers: ExportSpecifier[]; readonly source: Literal | null; }
export interface ExportSpecifier extends BaseNode { readonly type: "ExportSpecifier"; readonly exported: Identifier; readonly local: Identifier; }
export interface ExpressionStatement extends BaseNode { readonly type: "ExpressionStatement"; readonly expression: Expression; }
export interface ForInStatement extends BaseNode { readonly type: "ForInStatement"; readonly left: Expression | VariableDeclaration; readonly right: Expression; readonly body: Statement; readonly each: boolean; }
export interface ForOfStatement extends BaseNode { readonly type: "ForOfStatement"; readonly left: Expression | VariableDeclaration; readonly right: Expression; readonly body: Statement; }
export interface ForStatement extends BaseNode { readonly type: "ForStatement"; readonly init: Expression | VariableDeclaration | null; readonly test: Expression | null; readonly update: Expression | null; body: Statement; }
export interface FunctionDeclaration extends BaseNode { readonly type: "FunctionDeclaration"; readonly id: Identifier | null; readonly params: FunctionParameter[]; readonly body: BlockStatement; readonly generator: boolean; readonly expression: boolean; readonly async: boolean; }
export interface FunctionExpression extends BaseNode { readonly type: "FunctionExpression"; readonly id: Identifier | null; readonly params: FunctionParameter[]; readonly body: BlockStatement; readonly generator: boolean; readonly expression: boolean; readonly async: boolean; }
export interface Identifier extends BaseNode { readonly type: "Identifier"; readonly name: string; }
export interface IfStatement extends BaseNode { readonly type: "IfStatement"; readonly test: Expression; readonly consequent: Statement; readonly alternate: Statement | null; }
export interface ImportDeclaration extends BaseNode { readonly type: "ImportDeclaration"; readonly specifiers: ImportDeclarationSpecifier[]; readonly source: Literal; }
export interface ImportDefaultSpecifier extends BaseNode { readonly type: "ImportDefaultSpecifier"; readonly local: Identifier; }
export interface ImportNamespaceSpecifier extends BaseNode { readonly type: "ImportNamespaceSpecifier"; readonly local: Identifier; }
export interface ImportSpecifier extends BaseNode { readonly type: "ImportSpecifier"; readonly local: Identifier; readonly imported: Identifier; }
export interface LabeledStatement extends BaseNode { readonly type: "LabeledStatement"; readonly label: Identifier; readonly body: StatementListItem; }
export interface Literal extends BaseNode { readonly type: "Literal"; readonly value: boolean | number | string | null; readonly raw: string; }
export interface MetaProperty extends BaseNode { readonly type: "MetaProperty"; readonly meta: Identifier; readonly property: Identifier; }
export interface MethodDefinition extends BaseNode { readonly type: "MethodDefinition"; readonly key: Expression | null; readonly computed: boolean; readonly value: AsyncFunctionExpression | FunctionExpression | null; readonly kind: string; readonly static: boolean; }
export interface Module extends BaseNode { readonly type: "Program"; readonly body: StatementListItem[]; readonly sourceType: string; comments?: import("./comment-handler.ts").Comment[]; tokens?: import("./parser.ts").TokenEntry[]; errors?: unknown[];  }
export interface NewExpression extends BaseNode { readonly type: "NewExpression"; readonly callee: Expression; readonly arguments: ArgumentListElement[]; }
export interface ObjectExpression extends BaseNode { readonly type: "ObjectExpression"; readonly properties: Property[]; }
export interface ObjectPattern extends BaseNode { readonly type: "ObjectPattern"; readonly properties: Property[]; }
export interface Property extends BaseNode { readonly type: "Property"; readonly key: PropertyKey; readonly computed: boolean; readonly value: PropertyValue | null; readonly kind: string; readonly method: boolean; readonly shorthand: boolean; }
export interface RegexLiteral extends BaseNode { readonly type: "Literal"; readonly value: RegExp | null; readonly raw: string; readonly regex: { pattern: string, flags: string }; }
export interface RestElement extends BaseNode { readonly type: "RestElement"; readonly argument: BindingIdentifier | BindingPattern; }
export interface ReturnStatement extends BaseNode { readonly type: "ReturnStatement"; readonly argument: Expression | null; }
export interface Script extends BaseNode { readonly type: "Program"; readonly body: StatementListItem[]; readonly sourceType: string; comments?: import("./comment-handler.ts").Comment[]; tokens?: import("./parser.ts").TokenEntry[]; errors?: unknown[];  }
export interface SequenceExpression extends BaseNode { readonly type: "SequenceExpression"; readonly expressions: Expression[]; }
export interface SpreadElement extends BaseNode { readonly type: "SpreadElement"; readonly argument: Expression; }
export interface StaticMemberExpression extends BaseNode { readonly type: "MemberExpression"; readonly computed: boolean; readonly object: Expression; readonly property: Expression; }
export interface Super extends BaseNode { readonly type: "Super"; }
export interface SwitchCase extends BaseNode { readonly type: "SwitchCase"; readonly test: Expression | null; readonly consequent: StatementListItem[]; }
export interface SwitchStatement extends BaseNode { readonly type: "SwitchStatement"; readonly discriminant: Expression; readonly cases: SwitchCase[]; }
export interface TaggedTemplateExpression extends BaseNode { readonly type: "TaggedTemplateExpression"; readonly tag: Expression; readonly quasi: TemplateLiteral; }
export interface TemplateElement extends BaseNode { readonly type: "TemplateElement"; readonly value: TemplateElementValue; readonly tail: boolean; }
export interface TemplateLiteral extends BaseNode { readonly type: "TemplateLiteral"; readonly quasis: TemplateElement[]; readonly expressions: Expression[]; }
export interface ThisExpression extends BaseNode { readonly type: "ThisExpression"; }
export interface ThrowStatement extends BaseNode { readonly type: "ThrowStatement"; readonly argument: Expression; }
export interface TryStatement extends BaseNode { readonly type: "TryStatement"; readonly block: BlockStatement; readonly handler: CatchClause | null; readonly finalizer: BlockStatement | null; }
export interface UnaryExpression extends BaseNode { readonly type: "UnaryExpression"; readonly operator: string; readonly argument: Expression; readonly prefix: boolean; }
export interface UpdateExpression extends BaseNode { readonly type: "UpdateExpression"; readonly operator: string; readonly argument: Expression; readonly prefix: boolean; }
export interface VariableDeclaration extends BaseNode { readonly type: "VariableDeclaration"; readonly declarations: VariableDeclarator[]; readonly kind: string; }
export interface VariableDeclarator extends BaseNode { readonly type: "VariableDeclarator"; readonly id: BindingIdentifier | BindingPattern; readonly init: Expression | null; }
export interface WhileStatement extends BaseNode { readonly type: "WhileStatement"; readonly test: Expression; readonly body: Statement; }
export interface WithStatement extends BaseNode { readonly type: "WithStatement"; readonly object: Expression; readonly body: Statement; }
export interface YieldExpression extends BaseNode { readonly type: "YieldExpression"; readonly argument: Expression | null; readonly delegate: boolean; }
// Exact Esprima 4.0.1 module from the pinned Lebab bundle; BSD-2-Clause.
import {exportsReady, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load2} from "./syntax.ts";
let cache: Partial<ReturnType<typeof initialize>> | undefined;
export function load(): ReturnType<typeof initialize> { if (cache !== undefined) { if (!isReady(cache)) throw new TypeError("Incomplete cached Esprima exports"); return cache; } return initialize(); }
function isReady(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> { return hasEsModuleFlag(value) && exportsReady(value, ["ArrayExpression","ArrayPattern","ArrowFunctionExpression","AssignmentExpression","AssignmentPattern","AsyncArrowFunctionExpression","AsyncFunctionDeclaration","AsyncFunctionExpression","AwaitExpression","BinaryExpression","BlockStatement","BreakStatement","CallExpression","CatchClause","ClassBody","ClassDeclaration","ClassExpression","ComputedMemberExpression","ConditionalExpression","ContinueStatement","DebuggerStatement","Directive","DoWhileStatement","EmptyStatement","ExportAllDeclaration","ExportDefaultDeclaration","ExportNamedDeclaration","ExportSpecifier","ExpressionStatement","ForInStatement","ForOfStatement","ForStatement","FunctionDeclaration","FunctionExpression","Identifier","IfStatement","ImportDeclaration","ImportDefaultSpecifier","ImportNamespaceSpecifier","ImportSpecifier","LabeledStatement","Literal","MetaProperty","MethodDefinition","Module","NewExpression","ObjectExpression","ObjectPattern","Property","RegexLiteral","RestElement","ReturnStatement","Script","SequenceExpression","SpreadElement","StaticMemberExpression","Super","SwitchCase","SwitchStatement","TaggedTemplateExpression","TemplateElement","TemplateLiteral","ThisExpression","ThrowStatement","TryStatement","UnaryExpression","UpdateExpression","VariableDeclaration","VariableDeclarator","WhileStatement","WithStatement","YieldExpression"]); }
function initialize() {
const exports: {__esModule?:true; "ArrayExpression"?: typeof ArrayExpression; "ArrayPattern"?: typeof ArrayPattern; "ArrowFunctionExpression"?: typeof ArrowFunctionExpression; "AssignmentExpression"?: typeof AssignmentExpression; "AssignmentPattern"?: typeof AssignmentPattern; "AsyncArrowFunctionExpression"?: typeof AsyncArrowFunctionExpression; "AsyncFunctionDeclaration"?: typeof AsyncFunctionDeclaration; "AsyncFunctionExpression"?: typeof AsyncFunctionExpression; "AwaitExpression"?: typeof AwaitExpression; "BinaryExpression"?: typeof BinaryExpression; "BlockStatement"?: typeof BlockStatement; "BreakStatement"?: typeof BreakStatement; "CallExpression"?: typeof CallExpression; "CatchClause"?: typeof CatchClause; "ClassBody"?: typeof ClassBody; "ClassDeclaration"?: typeof ClassDeclaration; "ClassExpression"?: typeof ClassExpression; "ComputedMemberExpression"?: typeof ComputedMemberExpression; "ConditionalExpression"?: typeof ConditionalExpression; "ContinueStatement"?: typeof ContinueStatement; "DebuggerStatement"?: typeof DebuggerStatement; "Directive"?: typeof Directive; "DoWhileStatement"?: typeof DoWhileStatement; "EmptyStatement"?: typeof EmptyStatement; "ExportAllDeclaration"?: typeof ExportAllDeclaration; "ExportDefaultDeclaration"?: typeof ExportDefaultDeclaration; "ExportNamedDeclaration"?: typeof ExportNamedDeclaration; "ExportSpecifier"?: typeof ExportSpecifier; "ExpressionStatement"?: typeof ExpressionStatement; "ForInStatement"?: typeof ForInStatement; "ForOfStatement"?: typeof ForOfStatement; "ForStatement"?: typeof ForStatement; "FunctionDeclaration"?: typeof FunctionDeclaration; "FunctionExpression"?: typeof FunctionExpression; "Identifier"?: typeof Identifier; "IfStatement"?: typeof IfStatement; "ImportDeclaration"?: typeof ImportDeclaration; "ImportDefaultSpecifier"?: typeof ImportDefaultSpecifier; "ImportNamespaceSpecifier"?: typeof ImportNamespaceSpecifier; "ImportSpecifier"?: typeof ImportSpecifier; "LabeledStatement"?: typeof LabeledStatement; "Literal"?: typeof Literal; "MetaProperty"?: typeof MetaProperty; "MethodDefinition"?: typeof MethodDefinition; "Module"?: typeof Module; "NewExpression"?: typeof NewExpression; "ObjectExpression"?: typeof ObjectExpression; "ObjectPattern"?: typeof ObjectPattern; "Property"?: typeof Property; "RegexLiteral"?: typeof RegexLiteral; "RestElement"?: typeof RestElement; "ReturnStatement"?: typeof ReturnStatement; "Script"?: typeof Script; "SequenceExpression"?: typeof SequenceExpression; "SpreadElement"?: typeof SpreadElement; "StaticMemberExpression"?: typeof StaticMemberExpression; "Super"?: typeof Super; "SwitchCase"?: typeof SwitchCase; "SwitchStatement"?: typeof SwitchStatement; "TaggedTemplateExpression"?: typeof TaggedTemplateExpression; "TemplateElement"?: typeof TemplateElement; "TemplateLiteral"?: typeof TemplateLiteral; "ThisExpression"?: typeof ThisExpression; "ThrowStatement"?: typeof ThrowStatement; "TryStatement"?: typeof TryStatement; "UnaryExpression"?: typeof UnaryExpression; "UpdateExpression"?: typeof UpdateExpression; "VariableDeclaration"?: typeof VariableDeclaration; "VariableDeclarator"?: typeof VariableDeclarator; "WhileStatement"?: typeof WhileStatement; "WithStatement"?: typeof WithStatement; "YieldExpression"?: typeof YieldExpression;} = {};
cache = exports;


	"use strict";
	Object.defineProperty(exports, "__esModule", { value: true });
	var syntax_1 = load2();
	/* tslint:disable:max-classes-per-file */
	class ArrayExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ArrayExpression";
declare readonly elements: ArrayExpressionElement[];
constructor(elements: ArrayExpressionElement[]) {
	        this.type = syntax_1.Syntax.ArrayExpression;
	        this.elements = elements;
	    }
}
	exports.ArrayExpression = ArrayExpression;
	class ArrayPattern {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ArrayPattern";
declare readonly elements: ArrayPatternElement[];
constructor(elements: ArrayPatternElement[]) {
	        this.type = syntax_1.Syntax.ArrayPattern;
	        this.elements = elements;
	    }
}
	exports.ArrayPattern = ArrayPattern;
	class ArrowFunctionExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ArrowFunctionExpression";
declare readonly id: Identifier | null;
declare readonly params: FunctionParameter[];
declare readonly body: BlockStatement | Expression;
declare readonly generator: boolean;
declare readonly expression: boolean;
declare readonly async: boolean;
constructor(params: FunctionParameter[], body: BlockStatement | Expression, expression: boolean) {
	        this.type = syntax_1.Syntax.ArrowFunctionExpression;
	        this.id = null;
	        this.params = params;
	        this.body = body;
	        this.generator = false;
	        this.expression = expression;
	        this.async = false;
	    }
}
	exports.ArrowFunctionExpression = ArrowFunctionExpression;
	class AssignmentExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "AssignmentExpression";
declare readonly operator: string;
declare readonly left: Expression;
declare readonly right: Expression;
constructor(operator: string, left: Expression, right: Expression) {
	        this.type = syntax_1.Syntax.AssignmentExpression;
	        this.operator = operator;
	        this.left = left;
	        this.right = right;
	    }
}
	exports.AssignmentExpression = AssignmentExpression;
	class AssignmentPattern {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "AssignmentPattern";
declare readonly left: BindingIdentifier | BindingPattern;
declare readonly right: Expression;
constructor(left: BindingIdentifier | BindingPattern, right: Expression) {
	        this.type = syntax_1.Syntax.AssignmentPattern;
	        this.left = left;
	        this.right = right;
	    }
}
	exports.AssignmentPattern = AssignmentPattern;
	class AsyncArrowFunctionExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ArrowFunctionExpression";
declare readonly id: Identifier | null;
declare readonly params: FunctionParameter[];
declare readonly body: BlockStatement | Expression;
declare readonly generator: boolean;
declare readonly expression: boolean;
declare readonly async: boolean;
constructor(params: FunctionParameter[], body: BlockStatement | Expression, expression: boolean) {
	        this.type = syntax_1.Syntax.ArrowFunctionExpression;
	        this.id = null;
	        this.params = params;
	        this.body = body;
	        this.generator = false;
	        this.expression = expression;
	        this.async = true;
	    }
}
	exports.AsyncArrowFunctionExpression = AsyncArrowFunctionExpression;
	class AsyncFunctionDeclaration {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "FunctionDeclaration";
declare readonly id: Identifier | null;
declare readonly params: FunctionParameter[];
declare readonly body: BlockStatement;
declare readonly generator: boolean;
declare readonly expression: boolean;
declare readonly async: boolean;
constructor(id: Identifier | null, params: FunctionParameter[], body: BlockStatement) {
	        this.type = syntax_1.Syntax.FunctionDeclaration;
	        this.id = id;
	        this.params = params;
	        this.body = body;
	        this.generator = false;
	        this.expression = false;
	        this.async = true;
	    }
}
	exports.AsyncFunctionDeclaration = AsyncFunctionDeclaration;
	class AsyncFunctionExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "FunctionExpression";
declare readonly id: Identifier | null;
declare readonly params: FunctionParameter[];
declare readonly body: BlockStatement;
declare readonly generator: boolean;
declare readonly expression: boolean;
declare readonly async: boolean;
constructor(id: Identifier | null, params: FunctionParameter[], body: BlockStatement) {
	        this.type = syntax_1.Syntax.FunctionExpression;
	        this.id = id;
	        this.params = params;
	        this.body = body;
	        this.generator = false;
	        this.expression = false;
	        this.async = true;
	    }
}
	exports.AsyncFunctionExpression = AsyncFunctionExpression;
	class AwaitExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "AwaitExpression";
declare readonly argument: Expression;
constructor(argument: Expression) {
	        this.type = syntax_1.Syntax.AwaitExpression;
	        this.argument = argument;
	    }
}
	exports.AwaitExpression = AwaitExpression;
	class BinaryExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "LogicalExpression" | "BinaryExpression";
declare readonly operator: string;
declare readonly left: Expression;
declare readonly right: Expression;
constructor(operator: string, left: Expression, right: Expression) {
	        var logical = (operator === '||' || operator === '&&');
	        this.type = logical ? syntax_1.Syntax.LogicalExpression : syntax_1.Syntax.BinaryExpression;
	        this.operator = operator;
	        this.left = left;
	        this.right = right;
	    }
}
	exports.BinaryExpression = BinaryExpression;
	class BlockStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "BlockStatement";
declare readonly body: StatementListItem[];
constructor(body: StatementListItem[]) {
	        this.type = syntax_1.Syntax.BlockStatement;
	        this.body = body;
	    }
}
	exports.BlockStatement = BlockStatement;
	class BreakStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "BreakStatement";
declare readonly label: Identifier | null;
constructor(label: Identifier | null) {
	        this.type = syntax_1.Syntax.BreakStatement;
	        this.label = label;
	    }
}
	exports.BreakStatement = BreakStatement;
	class CallExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "CallExpression";
declare readonly callee: Expression;
declare readonly arguments: ArgumentListElement[];
constructor(callee: Expression, args: ArgumentListElement[]) {
	        this.type = syntax_1.Syntax.CallExpression;
	        this.callee = callee;
	        this.arguments = args;
	    }
}
	exports.CallExpression = CallExpression;
	class CatchClause {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "CatchClause";
declare readonly param: BindingIdentifier | BindingPattern;
declare readonly body: BlockStatement;
constructor(param: BindingIdentifier | BindingPattern, body: BlockStatement) {
	        this.type = syntax_1.Syntax.CatchClause;
	        this.param = param;
	        this.body = body;
	    }
}
	exports.CatchClause = CatchClause;
	class ClassBody {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ClassBody";
declare readonly body: MethodDefinition[];
constructor(body: MethodDefinition[]) {
	        this.type = syntax_1.Syntax.ClassBody;
	        this.body = body;
	    }
}
	exports.ClassBody = ClassBody;
	class ClassDeclaration {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ClassDeclaration";
declare readonly id: Identifier | null;
declare readonly superClass: Expression | null;
declare readonly body: ClassBody;
constructor(id: Identifier | null, superClass: Expression | null, body: ClassBody) {
	        this.type = syntax_1.Syntax.ClassDeclaration;
	        this.id = id;
	        this.superClass = superClass;
	        this.body = body;
	    }
}
	exports.ClassDeclaration = ClassDeclaration;
	class ClassExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ClassExpression";
declare readonly id: Identifier | null;
declare readonly superClass: Expression | null;
declare readonly body: ClassBody;
constructor(id: Identifier | null, superClass: Expression | null, body: ClassBody) {
	        this.type = syntax_1.Syntax.ClassExpression;
	        this.id = id;
	        this.superClass = superClass;
	        this.body = body;
	    }
}
	exports.ClassExpression = ClassExpression;
	class ComputedMemberExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "MemberExpression";
declare readonly computed: boolean;
declare readonly object: Expression;
declare readonly property: Expression;
constructor(object: Expression, property: Expression) {
	        this.type = syntax_1.Syntax.MemberExpression;
	        this.computed = true;
	        this.object = object;
	        this.property = property;
	    }
}
	exports.ComputedMemberExpression = ComputedMemberExpression;
	class ConditionalExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ConditionalExpression";
declare readonly test: Expression;
declare readonly consequent: Expression;
declare readonly alternate: Expression;
constructor(test: Expression, consequent: Expression, alternate: Expression) {
	        this.type = syntax_1.Syntax.ConditionalExpression;
	        this.test = test;
	        this.consequent = consequent;
	        this.alternate = alternate;
	    }
}
	exports.ConditionalExpression = ConditionalExpression;
	class ContinueStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ContinueStatement";
declare readonly label: Identifier | null;
constructor(label: Identifier | null) {
	        this.type = syntax_1.Syntax.ContinueStatement;
	        this.label = label;
	    }
}
	exports.ContinueStatement = ContinueStatement;
	class DebuggerStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "DebuggerStatement";
constructor() {
	        this.type = syntax_1.Syntax.DebuggerStatement;
	    }
}
	exports.DebuggerStatement = DebuggerStatement;
	class Directive {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ExpressionStatement";
declare readonly expression: Expression;
declare readonly directive: string;
constructor(expression: Expression, directive: string) {
	        this.type = syntax_1.Syntax.ExpressionStatement;
	        this.expression = expression;
	        this.directive = directive;
	    }
}
	exports.Directive = Directive;
	class DoWhileStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "DoWhileStatement";
declare readonly body: Statement;
declare readonly test: Expression;
constructor(body: Statement, test: Expression) {
	        this.type = syntax_1.Syntax.DoWhileStatement;
	        this.body = body;
	        this.test = test;
	    }
}
	exports.DoWhileStatement = DoWhileStatement;
	class EmptyStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "EmptyStatement";
constructor() {
	        this.type = syntax_1.Syntax.EmptyStatement;
	    }
}
	exports.EmptyStatement = EmptyStatement;
	class ExportAllDeclaration {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ExportAllDeclaration";
declare readonly source: Literal;
constructor(source: Literal) {
	        this.type = syntax_1.Syntax.ExportAllDeclaration;
	        this.source = source;
	    }
}
	exports.ExportAllDeclaration = ExportAllDeclaration;
	class ExportDefaultDeclaration {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ExportDefaultDeclaration";
declare readonly declaration: ExportableDefaultDeclaration;
constructor(declaration: ExportableDefaultDeclaration) {
	        this.type = syntax_1.Syntax.ExportDefaultDeclaration;
	        this.declaration = declaration;
	    }
}
	exports.ExportDefaultDeclaration = ExportDefaultDeclaration;
	class ExportNamedDeclaration {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ExportNamedDeclaration";
declare readonly declaration: ExportableNamedDeclaration | null;
declare readonly specifiers: ExportSpecifier[];
declare readonly source: Literal | null;
constructor(declaration: ExportableNamedDeclaration | null, specifiers: ExportSpecifier[], source: Literal | null) {
	        this.type = syntax_1.Syntax.ExportNamedDeclaration;
	        this.declaration = declaration;
	        this.specifiers = specifiers;
	        this.source = source;
	    }
}
	exports.ExportNamedDeclaration = ExportNamedDeclaration;
	class ExportSpecifier {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ExportSpecifier";
declare readonly exported: Identifier;
declare readonly local: Identifier;
constructor(local: Identifier, exported: Identifier) {
	        this.type = syntax_1.Syntax.ExportSpecifier;
	        this.exported = exported;
	        this.local = local;
	    }
}
	exports.ExportSpecifier = ExportSpecifier;
	class ExpressionStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ExpressionStatement";
declare readonly expression: Expression;
constructor(expression: Expression) {
	        this.type = syntax_1.Syntax.ExpressionStatement;
	        this.expression = expression;
	    }
}
	exports.ExpressionStatement = ExpressionStatement;
	class ForInStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ForInStatement";
declare readonly left: Expression | VariableDeclaration;
declare readonly right: Expression;
declare readonly body: Statement;
declare readonly each: boolean;
constructor(left: Expression | VariableDeclaration, right: Expression, body: Statement) {
	        this.type = syntax_1.Syntax.ForInStatement;
	        this.left = left;
	        this.right = right;
	        this.body = body;
	        this.each = false;
	    }
}
	exports.ForInStatement = ForInStatement;
	class ForOfStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ForOfStatement";
declare readonly left: Expression | VariableDeclaration;
declare readonly right: Expression;
declare readonly body: Statement;
constructor(left: Expression | VariableDeclaration, right: Expression, body: Statement) {
	        this.type = syntax_1.Syntax.ForOfStatement;
	        this.left = left;
	        this.right = right;
	        this.body = body;
	    }
}
	exports.ForOfStatement = ForOfStatement;
	class ForStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ForStatement";
declare readonly init: Expression | VariableDeclaration | null;
declare readonly test: Expression | null;
declare readonly update: Expression | null;
declare body: Statement;
constructor(init: Expression | VariableDeclaration | null, test: Expression | null, update: Expression | null, body: Statement) {
	        this.type = syntax_1.Syntax.ForStatement;
	        this.init = init;
	        this.test = test;
	        this.update = update;
	        this.body = body;
	    }
}
	exports.ForStatement = ForStatement;
	class FunctionDeclaration {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "FunctionDeclaration";
declare readonly id: Identifier | null;
declare readonly params: FunctionParameter[];
declare readonly body: BlockStatement;
declare readonly generator: boolean;
declare readonly expression: boolean;
declare readonly async: boolean;
constructor(id: Identifier | null, params: FunctionParameter[], body: BlockStatement, generator: boolean) {
	        this.type = syntax_1.Syntax.FunctionDeclaration;
	        this.id = id;
	        this.params = params;
	        this.body = body;
	        this.generator = generator;
	        this.expression = false;
	        this.async = false;
	    }
}
	exports.FunctionDeclaration = FunctionDeclaration;
	class FunctionExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "FunctionExpression";
declare readonly id: Identifier | null;
declare readonly params: FunctionParameter[];
declare readonly body: BlockStatement;
declare readonly generator: boolean;
declare readonly expression: boolean;
declare readonly async: boolean;
constructor(id: Identifier | null, params: FunctionParameter[], body: BlockStatement, generator: boolean) {
	        this.type = syntax_1.Syntax.FunctionExpression;
	        this.id = id;
	        this.params = params;
	        this.body = body;
	        this.generator = generator;
	        this.expression = false;
	        this.async = false;
	    }
}
	exports.FunctionExpression = FunctionExpression;
	class Identifier {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "Identifier";
declare readonly name: string;
constructor(name: string) {
	        this.type = syntax_1.Syntax.Identifier;
	        this.name = name;
	    }
}
	exports.Identifier = Identifier;
	class IfStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "IfStatement";
declare readonly test: Expression;
declare readonly consequent: Statement;
declare readonly alternate: Statement | null;
constructor(test: Expression, consequent: Statement, alternate: Statement | null) {
	        this.type = syntax_1.Syntax.IfStatement;
	        this.test = test;
	        this.consequent = consequent;
	        this.alternate = alternate;
	    }
}
	exports.IfStatement = IfStatement;
	class ImportDeclaration {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ImportDeclaration";
declare readonly specifiers: ImportDeclarationSpecifier[];
declare readonly source: Literal;
constructor(specifiers: ImportDeclarationSpecifier[], source: Literal) {
	        this.type = syntax_1.Syntax.ImportDeclaration;
	        this.specifiers = specifiers;
	        this.source = source;
	    }
}
	exports.ImportDeclaration = ImportDeclaration;
	class ImportDefaultSpecifier {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ImportDefaultSpecifier";
declare readonly local: Identifier;
constructor(local: Identifier) {
	        this.type = syntax_1.Syntax.ImportDefaultSpecifier;
	        this.local = local;
	    }
}
	exports.ImportDefaultSpecifier = ImportDefaultSpecifier;
	class ImportNamespaceSpecifier {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ImportNamespaceSpecifier";
declare readonly local: Identifier;
constructor(local: Identifier) {
	        this.type = syntax_1.Syntax.ImportNamespaceSpecifier;
	        this.local = local;
	    }
}
	exports.ImportNamespaceSpecifier = ImportNamespaceSpecifier;
	class ImportSpecifier {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ImportSpecifier";
declare readonly local: Identifier;
declare readonly imported: Identifier;
constructor(local: Identifier, imported: Identifier) {
	        this.type = syntax_1.Syntax.ImportSpecifier;
	        this.local = local;
	        this.imported = imported;
	    }
}
	exports.ImportSpecifier = ImportSpecifier;
	class LabeledStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "LabeledStatement";
declare readonly label: Identifier;
declare readonly body: StatementListItem;
constructor(label: Identifier, body: StatementListItem) {
	        this.type = syntax_1.Syntax.LabeledStatement;
	        this.label = label;
	        this.body = body;
	    }
}
	exports.LabeledStatement = LabeledStatement;
	class Literal {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "Literal";
declare readonly value: boolean | number | string | null;
declare readonly raw: string;
constructor(value: boolean | number | string | null, raw: string) {
	        this.type = syntax_1.Syntax.Literal;
	        this.value = value;
	        this.raw = raw;
	    }
}
	exports.Literal = Literal;
	class MetaProperty {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "MetaProperty";
declare readonly meta: Identifier;
declare readonly property: Identifier;
constructor(meta: Identifier, property: Identifier) {
	        this.type = syntax_1.Syntax.MetaProperty;
	        this.meta = meta;
	        this.property = property;
	    }
}
	exports.MetaProperty = MetaProperty;
	class MethodDefinition {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "MethodDefinition";
declare readonly key: Expression | null;
declare readonly computed: boolean;
declare readonly value: AsyncFunctionExpression | FunctionExpression | null;
declare readonly kind: string;
declare readonly static: boolean;
constructor(key: Expression | null, computed: boolean, value: AsyncFunctionExpression | FunctionExpression | null, kind: string, isStatic: boolean) {
	        this.type = syntax_1.Syntax.MethodDefinition;
	        this.key = key;
	        this.computed = computed;
	        this.value = value;
	        this.kind = kind;
	        this.static = isStatic;
	    }
}
	exports.MethodDefinition = MethodDefinition;
	class Module {
declare comments?: import("./comment-handler.ts").Comment[];
declare tokens?: import("./parser.ts").TokenEntry[];
declare errors?: unknown[];

declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "Program";
declare readonly body: StatementListItem[];
declare readonly sourceType: string;
constructor(body: StatementListItem[]) {
	        this.type = syntax_1.Syntax.Program;
	        this.body = body;
	        this.sourceType = 'module';
	    }
}
	exports.Module = Module;
	class NewExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "NewExpression";
declare readonly callee: Expression;
declare readonly arguments: ArgumentListElement[];
constructor(callee: Expression, args: ArgumentListElement[]) {
	        this.type = syntax_1.Syntax.NewExpression;
	        this.callee = callee;
	        this.arguments = args;
	    }
}
	exports.NewExpression = NewExpression;
	class ObjectExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ObjectExpression";
declare readonly properties: Property[];
constructor(properties: Property[]) {
	        this.type = syntax_1.Syntax.ObjectExpression;
	        this.properties = properties;
	    }
}
	exports.ObjectExpression = ObjectExpression;
	class ObjectPattern {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ObjectPattern";
declare readonly properties: Property[];
constructor(properties: Property[]) {
	        this.type = syntax_1.Syntax.ObjectPattern;
	        this.properties = properties;
	    }
}
	exports.ObjectPattern = ObjectPattern;
	class Property {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "Property";
declare readonly key: PropertyKey;
declare readonly computed: boolean;
declare readonly value: PropertyValue | null;
declare readonly kind: string;
declare readonly method: boolean;
declare readonly shorthand: boolean;
constructor(kind: string, key: PropertyKey, computed: boolean, value: PropertyValue | null, method: boolean, shorthand: boolean) {
	        this.type = syntax_1.Syntax.Property;
	        this.key = key;
	        this.computed = computed;
	        this.value = value;
	        this.kind = kind;
	        this.method = method;
	        this.shorthand = shorthand;
	    }
}
	exports.Property = Property;
	class RegexLiteral {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "Literal";
declare readonly value: RegExp | null;
declare readonly raw: string;
declare readonly regex: { pattern: string, flags: string };
constructor(value: RegExp | null, raw: string, pattern: string, flags: string) {
	        this.type = syntax_1.Syntax.Literal;
	        this.value = value;
	        this.raw = raw;
	        this.regex = { pattern: pattern, flags: flags };
	    }
}
	exports.RegexLiteral = RegexLiteral;
	class RestElement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "RestElement";
declare readonly argument: BindingIdentifier | BindingPattern;
constructor(argument: BindingIdentifier | BindingPattern) {
	        this.type = syntax_1.Syntax.RestElement;
	        this.argument = argument;
	    }
}
	exports.RestElement = RestElement;
	class ReturnStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ReturnStatement";
declare readonly argument: Expression | null;
constructor(argument: Expression | null) {
	        this.type = syntax_1.Syntax.ReturnStatement;
	        this.argument = argument;
	    }
}
	exports.ReturnStatement = ReturnStatement;
	class Script {
declare comments?: import("./comment-handler.ts").Comment[];
declare tokens?: import("./parser.ts").TokenEntry[];
declare errors?: unknown[];

declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "Program";
declare readonly body: StatementListItem[];
declare readonly sourceType: string;
constructor(body: StatementListItem[]) {
	        this.type = syntax_1.Syntax.Program;
	        this.body = body;
	        this.sourceType = 'script';
	    }
}
	exports.Script = Script;
	class SequenceExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "SequenceExpression";
declare readonly expressions: Expression[];
constructor(expressions: Expression[]) {
	        this.type = syntax_1.Syntax.SequenceExpression;
	        this.expressions = expressions;
	    }
}
	exports.SequenceExpression = SequenceExpression;
	class SpreadElement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "SpreadElement";
declare readonly argument: Expression;
constructor(argument: Expression) {
	        this.type = syntax_1.Syntax.SpreadElement;
	        this.argument = argument;
	    }
}
	exports.SpreadElement = SpreadElement;
	class StaticMemberExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "MemberExpression";
declare readonly computed: boolean;
declare readonly object: Expression;
declare readonly property: Expression;
constructor(object: Expression, property: Expression) {
	        this.type = syntax_1.Syntax.MemberExpression;
	        this.computed = false;
	        this.object = object;
	        this.property = property;
	    }
}
	exports.StaticMemberExpression = StaticMemberExpression;
	class Super {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "Super";
constructor() {
	        this.type = syntax_1.Syntax.Super;
	    }
}
	exports.Super = Super;
	class SwitchCase {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "SwitchCase";
declare readonly test: Expression | null;
declare readonly consequent: StatementListItem[];
constructor(test: Expression | null, consequent: StatementListItem[]) {
	        this.type = syntax_1.Syntax.SwitchCase;
	        this.test = test;
	        this.consequent = consequent;
	    }
}
	exports.SwitchCase = SwitchCase;
	class SwitchStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "SwitchStatement";
declare readonly discriminant: Expression;
declare readonly cases: SwitchCase[];
constructor(discriminant: Expression, cases: SwitchCase[]) {
	        this.type = syntax_1.Syntax.SwitchStatement;
	        this.discriminant = discriminant;
	        this.cases = cases;
	    }
}
	exports.SwitchStatement = SwitchStatement;
	class TaggedTemplateExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "TaggedTemplateExpression";
declare readonly tag: Expression;
declare readonly quasi: TemplateLiteral;
constructor(tag: Expression, quasi: TemplateLiteral) {
	        this.type = syntax_1.Syntax.TaggedTemplateExpression;
	        this.tag = tag;
	        this.quasi = quasi;
	    }
}
	exports.TaggedTemplateExpression = TaggedTemplateExpression;
	class TemplateElement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "TemplateElement";
declare readonly value: TemplateElementValue;
declare readonly tail: boolean;
constructor(value: TemplateElementValue, tail: boolean) {
	        this.type = syntax_1.Syntax.TemplateElement;
	        this.value = value;
	        this.tail = tail;
	    }
}
	exports.TemplateElement = TemplateElement;
	class TemplateLiteral {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "TemplateLiteral";
declare readonly quasis: TemplateElement[];
declare readonly expressions: Expression[];
constructor(quasis: TemplateElement[], expressions: Expression[]) {
	        this.type = syntax_1.Syntax.TemplateLiteral;
	        this.quasis = quasis;
	        this.expressions = expressions;
	    }
}
	exports.TemplateLiteral = TemplateLiteral;
	class ThisExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ThisExpression";
constructor() {
	        this.type = syntax_1.Syntax.ThisExpression;
	    }
}
	exports.ThisExpression = ThisExpression;
	class ThrowStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "ThrowStatement";
declare readonly argument: Expression;
constructor(argument: Expression) {
	        this.type = syntax_1.Syntax.ThrowStatement;
	        this.argument = argument;
	    }
}
	exports.ThrowStatement = ThrowStatement;
	class TryStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "TryStatement";
declare readonly block: BlockStatement;
declare readonly handler: CatchClause | null;
declare readonly finalizer: BlockStatement | null;
constructor(block: BlockStatement, handler: CatchClause | null, finalizer: BlockStatement | null) {
	        this.type = syntax_1.Syntax.TryStatement;
	        this.block = block;
	        this.handler = handler;
	        this.finalizer = finalizer;
	    }
}
	exports.TryStatement = TryStatement;
	class UnaryExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "UnaryExpression";
declare readonly operator: string;
declare readonly argument: Expression;
declare readonly prefix: boolean;
constructor(operator: string, argument: Expression) {
	        this.type = syntax_1.Syntax.UnaryExpression;
	        this.operator = operator;
	        this.argument = argument;
	        this.prefix = true;
	    }
}
	exports.UnaryExpression = UnaryExpression;
	class UpdateExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "UpdateExpression";
declare readonly operator: string;
declare readonly argument: Expression;
declare readonly prefix: boolean;
constructor(operator: string, argument: Expression, prefix: boolean) {
	        this.type = syntax_1.Syntax.UpdateExpression;
	        this.operator = operator;
	        this.argument = argument;
	        this.prefix = prefix;
	    }
}
	exports.UpdateExpression = UpdateExpression;
	class VariableDeclaration {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "VariableDeclaration";
declare readonly declarations: VariableDeclarator[];
declare readonly kind: string;
constructor(declarations: VariableDeclarator[], kind: string) {
	        this.type = syntax_1.Syntax.VariableDeclaration;
	        this.declarations = declarations;
	        this.kind = kind;
	    }
}
	exports.VariableDeclaration = VariableDeclaration;
	class VariableDeclarator {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "VariableDeclarator";
declare readonly id: BindingIdentifier | BindingPattern;
declare readonly init: Expression | null;
constructor(id: BindingIdentifier | BindingPattern, init: Expression | null) {
	        this.type = syntax_1.Syntax.VariableDeclarator;
	        this.id = id;
	        this.init = init;
	    }
}
	exports.VariableDeclarator = VariableDeclarator;
	class WhileStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "WhileStatement";
declare readonly test: Expression;
declare readonly body: Statement;
constructor(test: Expression, body: Statement) {
	        this.type = syntax_1.Syntax.WhileStatement;
	        this.test = test;
	        this.body = body;
	    }
}
	exports.WhileStatement = WhileStatement;
	class WithStatement {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "WithStatement";
declare readonly object: Expression;
declare readonly body: Statement;
constructor(object: Expression, body: Statement) {
	        this.type = syntax_1.Syntax.WithStatement;
	        this.object = object;
	        this.body = body;
	    }
}
	exports.WithStatement = WithStatement;
	class YieldExpression {
declare range?: [number, number];
declare loc?: import("./scanner.ts").SourceLocation;
declare leadingComments?: import("./comment-handler.ts").AttachedComment[];
declare trailingComments?: import("./comment-handler.ts").AttachedComment[];
declare innerComments?: import("./comment-handler.ts").AttachedComment[];

declare readonly type: "YieldExpression";
declare readonly argument: Expression | null;
declare readonly delegate: boolean;
constructor(argument: Expression | null, delegate: boolean) {
	        this.type = syntax_1.Syntax.YieldExpression;
	        this.argument = argument;
	        this.delegate = delegate;
	    }
}
	exports.YieldExpression = YieldExpression;


/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected Esprima module flag");
if (!exportsReady(exports, ["ArrayExpression","ArrayPattern","ArrowFunctionExpression","AssignmentExpression","AssignmentPattern","AsyncArrowFunctionExpression","AsyncFunctionDeclaration","AsyncFunctionExpression","AwaitExpression","BinaryExpression","BlockStatement","BreakStatement","CallExpression","CatchClause","ClassBody","ClassDeclaration","ClassExpression","ComputedMemberExpression","ConditionalExpression","ContinueStatement","DebuggerStatement","Directive","DoWhileStatement","EmptyStatement","ExportAllDeclaration","ExportDefaultDeclaration","ExportNamedDeclaration","ExportSpecifier","ExpressionStatement","ForInStatement","ForOfStatement","ForStatement","FunctionDeclaration","FunctionExpression","Identifier","IfStatement","ImportDeclaration","ImportDefaultSpecifier","ImportNamespaceSpecifier","ImportSpecifier","LabeledStatement","Literal","MetaProperty","MethodDefinition","Module","NewExpression","ObjectExpression","ObjectPattern","Property","RegexLiteral","RestElement","ReturnStatement","Script","SequenceExpression","SpreadElement","StaticMemberExpression","Super","SwitchCase","SwitchStatement","TaggedTemplateExpression","TemplateElement","TemplateLiteral","ThisExpression","ThrowStatement","TryStatement","UnaryExpression","UpdateExpression","VariableDeclaration","VariableDeclarator","WhileStatement","WithStatement","YieldExpression"])) throw new TypeError("Incomplete Esprima exports");
return exports;
}

export type Node = import("./parser.ts").ArrowParameterPlaceHolderNode | ArrayExpression | ArrayPattern | ArrowFunctionExpression | AssignmentExpression | AssignmentPattern | AsyncArrowFunctionExpression | AsyncFunctionDeclaration | AsyncFunctionExpression | AwaitExpression | BinaryExpression | BlockStatement | BreakStatement | CallExpression | CatchClause | ClassBody | ClassDeclaration | ClassExpression | ComputedMemberExpression | ConditionalExpression | ContinueStatement | DebuggerStatement | Directive | DoWhileStatement | EmptyStatement | ExportAllDeclaration | ExportDefaultDeclaration | ExportNamedDeclaration | ExportSpecifier | ExpressionStatement | ForInStatement | ForOfStatement | ForStatement | FunctionDeclaration | FunctionExpression | Identifier | IfStatement | ImportDeclaration | ImportDefaultSpecifier | ImportNamespaceSpecifier | ImportSpecifier | LabeledStatement | Literal | MetaProperty | MethodDefinition | Module | NewExpression | ObjectExpression | ObjectPattern | Property | RegexLiteral | RestElement | ReturnStatement | Script | SequenceExpression | SpreadElement | StaticMemberExpression | Super | SwitchCase | SwitchStatement | TaggedTemplateExpression | TemplateElement | TemplateLiteral | ThisExpression | ThrowStatement | TryStatement | UnaryExpression | UpdateExpression | VariableDeclaration | VariableDeclarator | WhileStatement | WithStatement | YieldExpression | import("./jsx-nodes.ts").JSXNode;
