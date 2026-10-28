import type * as JSXNode from "./jsx-nodes.ts";
// Esprima-next 6.0.3, BSD-2-Clause; original notice in esprima.ts and ../LICENSE-jetstream.
// Strict TypeScript transcription of the source embedded in the pinned JetStream bundle.
import { Syntax } from './syntax.ts';

export type ArgumentListElement = Expression | SpreadElement;
export type ArrayExpressionElement = Expression | SpreadElement | null;
export type ArrayPatternElement = AssignmentPattern | BindingIdentifier | BindingPattern | RestElement | null;
export type BindingPattern = ArrayPattern | ObjectPattern;
export type BindingIdentifier = Identifier
export type ChainElement = CallExpression | MemberExpression | MemberExpression;
export type Class = ClassDeclaration | ClassExpression;
export type Declaration = FunctionDeclaration | VariableDeclaration | ClassDeclaration | ImportDeclaration | ExportDeclaration;
export type ExportableDefaultDeclaration = BindingIdentifier | BindingPattern | ClassDeclaration | Expression | FunctionDeclaration;
export type ExportableNamedDeclaration = AsyncFunctionDeclaration | ClassDeclaration | FunctionDeclaration | VariableDeclaration;
export type ExportDeclaration = ExportAllDeclaration | ExportDefaultDeclaration | ExportNamedDeclaration;
export type Expression = Super | PrivateIdentifier | import("./parser.ts").ArrowParameterPlaceHolderNode | JSXNode.JSXElement | BigIntLiteral | ArrayExpression | ArrowFunctionExpression | AssignmentExpression |
    AwaitExpression | BinaryExpression | CallExpression | ChainExpression | ClassExpression | MemberExpression |
    ConditionalExpression | Identifier | FunctionExpression | Literal | LogicalExpression | NewExpression | ObjectExpression |
    RegexLiteral | SequenceExpression | MemberExpression | TemplateLiteral | TaggedTemplateExpression |
    ThisExpression | UnaryExpression | UpdateExpression | YieldExpression | MetaProperty | ImportExpression;
export type FunctionParameter = Pattern | SpreadElement;
export type Function = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;
export type ImportDeclarationSpecifier = ImportDefaultSpecifier | ImportNamespaceSpecifier | ImportSpecifier;
export type ObjectExpressionProperty = Property | SpreadElement;
export type ObjectPatternProperty = Property | RestElement;
export type Statement = BlockStatement | BreakStatement | LabeledStatement | ContinueStatement | DebuggerStatement | DoWhileStatement |
    EmptyStatement | ExpressionStatement | Directive | ForStatement | ForInStatement | ForOfStatement |
    IfStatement | ReturnStatement | SwitchStatement | ThrowStatement |
    TryStatement | VariableDeclaration | WhileStatement | WithStatement | Declaration;
export type Pattern = Expression | ObjectPattern | ArrayPattern | Identifier | AssignmentPattern | RestElement;
export type PropertyKey = Expression;
export type PropertyValue = Expression | AssignmentPattern | BindingPattern;

export type Node = Module | Script | AsyncFunctionDeclaration | Program | Function | Statement | VariableDeclarator | Expression | Property | PropertyKey | Pattern | SwitchCase | CatchClause | MethodDefinition |
    Class | ClassBody | ImportDeclaration | ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier | ExportNamedDeclaration | ExportSpecifier |
    ExportDefaultDeclaration | ExportAllDeclaration | TemplateElement | Super | ArgumentListElement | PropertyDefinition | StaticBlock | Decorator | ImportAttribute |
    null;

export class ArrayExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ArrayExpression;
    readonly elements: ArrayExpressionElement[];
    constructor(elements: ArrayExpressionElement[]) {
        this.type = Syntax.ArrayExpression;
        this.elements = elements;
    }
}

export class ArrayPattern {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ArrayPattern;
    readonly elements: ArrayPatternElement[];
    constructor(elements: ArrayPatternElement[]) {
        this.type = Syntax.ArrayPattern;
        this.elements = elements;
    }
}

export class ArrowFunctionExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ArrowFunctionExpression;
    id: Identifier | null;
    readonly params: FunctionParameter[];
    readonly body: BlockStatement | Expression;
    readonly generator: boolean;
    readonly expression: boolean;
    readonly async: boolean | undefined;
    constructor(params: FunctionParameter[], body: BlockStatement | Expression, expression: boolean, isAsync: boolean | undefined) {
        this.type = Syntax.ArrowFunctionExpression;
        this.id = null;
        this.params = params;
        this.body = body;
        this.generator = false;
        this.expression = expression;
        this.async = isAsync;
    }
}

export class AssignmentExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.AssignmentExpression;
    readonly operator: string;
    readonly left: Expression;
    readonly right: Expression;
    constructor(operator: string, left: Expression, right: Expression) {
        this.type = Syntax.AssignmentExpression;
        this.operator = operator;
        this.left = left;
        this.right = right;
    }
}

export class AssignmentPattern {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.AssignmentPattern;
    readonly left: BindingIdentifier | BindingPattern;
    readonly right: Expression;
    constructor(left: BindingIdentifier | BindingPattern, right: Expression) {
        this.type = Syntax.AssignmentPattern;
        this.left = left;
        this.right = right;
    }
}

export class AsyncFunctionDeclaration {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.FunctionDeclaration;
    id: Identifier | null;
    readonly params: FunctionParameter[];
    readonly body: BlockStatement;
    readonly generator: boolean;
    readonly expression: boolean;
    readonly async: boolean;
    constructor(id: Identifier | null, params: FunctionParameter[], body: BlockStatement, generator: boolean) {
        this.type = Syntax.FunctionDeclaration;
        this.id = id;
        this.params = params;
        this.body = body;
        this.generator = generator;
        this.expression = false;
        this.async = true;
    }
}

export class AwaitExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.AwaitExpression;
    readonly argument: Expression;
    constructor(argument: Expression) {
        this.type = Syntax.AwaitExpression;
        this.argument = argument;
    }
}

export class BigIntLiteral {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Literal;
    readonly value: null | bigint;
    readonly raw: string;
    readonly bigint: string;
    constructor(value: null | bigint, raw: string, bigint: string) {
        this.type = Syntax.Literal;
        this.value = value;
        this.raw = raw;
        this.bigint = bigint;
    }
}

export class BinaryExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.BinaryExpression;
    readonly operator: string;
    readonly left: Expression | PrivateIdentifier;
    readonly right: Expression;
    constructor(operator: string, left: Expression | PrivateIdentifier, right: Expression) {
        this.type = Syntax.BinaryExpression;
        this.operator = operator;
        this.left = left;
        this.right = right;
    }
}

export class BlockStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.BlockStatement;
    readonly body: Statement[];
    constructor(body: Statement[]) {
        this.type = Syntax.BlockStatement;
        this.body = body;
    }
}

export class BreakStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.BreakStatement;
    readonly label: Identifier | null;
    constructor(label: Identifier | null) {
        this.type = Syntax.BreakStatement;
        this.label = label;
    }
}

export class CallExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.CallExpression;
    readonly callee: Expression | ImportExpression;
    readonly arguments: ArgumentListElement[];
    readonly optional: boolean;
    constructor(callee: Expression | ImportExpression, args: ArgumentListElement[], optional: boolean) {
        this.type = Syntax.CallExpression;
        this.callee = callee;
        this.arguments = args;
        this.optional = optional;
    }
}

export class CatchClause {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.CatchClause;
    readonly param: BindingIdentifier | BindingPattern | null;
    readonly body: BlockStatement;
    constructor(param: BindingIdentifier | BindingPattern | null, body: BlockStatement) {
        this.type = Syntax.CatchClause;
        this.param = param;
        this.body = body;
    }
}

export class ChainExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ChainExpression;
    readonly expression: ChainElement;
    constructor(expression: ChainElement) {
        this.type = Syntax.ChainExpression;
        this.expression = expression;
    }
}

export class ClassBody {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ClassBody;
    readonly body: (MethodDefinition | PropertyDefinition | StaticBlock)[];
    constructor(body: (MethodDefinition | PropertyDefinition | StaticBlock)[]) {
        this.type = Syntax.ClassBody;
        this.body = body;
    }
}

export class ClassDeclaration {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ClassDeclaration;
    id: Identifier | null;
    readonly superClass: Expression | null;
    readonly body: ClassBody;
    readonly decorators: Decorator[] | null;
    constructor(id: Identifier | null, superClass: Expression | null, body: ClassBody, decorators: Decorator[] | null) {
        this.type = Syntax.ClassDeclaration;
        this.id = id;
        this.superClass = superClass;
        this.body = body;
        this.decorators = decorators;
    }
}

export class ClassExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ClassExpression;
    id: Identifier | null;
    readonly superClass: Expression | null;
    readonly body: ClassBody;
    readonly decorators: Decorator[] | null;
    constructor(id: Identifier | null, superClass: Expression | null, body: ClassBody, decorators: Decorator[] | null) {
        this.type = Syntax.ClassExpression;
        this.id = id;
        this.superClass = superClass;
        this.body = body;
        this.decorators = decorators;
    }
}

export class ConditionalExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ConditionalExpression;
    readonly test: Expression;
    readonly consequent: Expression;
    readonly alternate: Expression;
    constructor(test: Expression, consequent: Expression, alternate: Expression) {
        this.type = Syntax.ConditionalExpression;
        this.test = test;
        this.consequent = consequent;
        this.alternate = alternate;
    }
}

export class ContinueStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ContinueStatement;
    readonly label: Identifier | null;
    constructor(label: Identifier | null) {
        this.type = Syntax.ContinueStatement;
        this.label = label;
    }
}

export class DebuggerStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.DebuggerStatement;
    constructor() {
        this.type = Syntax.DebuggerStatement;
    }
}

export class Decorator {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Decorator;
    readonly expression: Expression;
    constructor(expression: Expression) {
        this.type = Syntax.Decorator;
        this.expression = expression;
    }
}

export class Directive {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ExpressionStatement;
    readonly expression: Expression;
    readonly directive: string;
    constructor(expression: Expression, directive: string) {
        this.type = Syntax.ExpressionStatement;
        this.expression = expression;
        this.directive = directive;
    }
}

export class DoWhileStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.DoWhileStatement;
    readonly body: Statement;
    readonly test: Expression;
    constructor(body: Statement, test: Expression) {
        this.type = Syntax.DoWhileStatement;
        this.body = body;
        this.test = test;
    }
}

export class EmptyStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.EmptyStatement;
    constructor() {
        this.type = Syntax.EmptyStatement;
    }
}

export class ExportAllDeclaration {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ExportAllDeclaration;
    readonly source: Literal;
    readonly exported: Identifier | Literal | null;
    readonly assertions: ImportAttribute[] | null;
    constructor(source: Literal, exported: Identifier | Literal | null, assertions: ImportAttribute[] | null) {
        this.type = Syntax.ExportAllDeclaration;
        this.source = source;
        this.exported = exported;
        this.assertions = assertions;
    }
}

export class ExportDefaultDeclaration {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ExportDefaultDeclaration;
    readonly declaration: ExportableDefaultDeclaration;
    constructor(declaration: ExportableDefaultDeclaration) {
        this.type = Syntax.ExportDefaultDeclaration;
        this.declaration = declaration;
    }
}

export class ExportNamedDeclaration {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ExportNamedDeclaration;
    readonly declaration: ExportableNamedDeclaration | null;
    readonly specifiers: ExportSpecifier[];
    readonly source: Literal | null;
    readonly assertions: ImportAttribute[] | null;
    constructor(declaration: ExportableNamedDeclaration | null, specifiers: ExportSpecifier[], source: Literal | null, assertions: ImportAttribute[] | null) {
        this.type = Syntax.ExportNamedDeclaration;
        this.declaration = declaration;
        this.specifiers = specifiers;
        this.source = source;
        this.assertions = assertions;
    }
}

export class ExportSpecifier {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ExportSpecifier;
    readonly exported: Identifier | Literal;
    readonly local: Identifier | Literal;
    constructor(local: Identifier | Literal, exported: Identifier | Literal) {
        this.type = Syntax.ExportSpecifier;
        this.exported = exported;
        this.local = local;
    }
}

export class ExpressionStatement {
    declare directive?: string;
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ExpressionStatement;
    readonly expression: Expression;
    constructor(expression: Expression) {
        this.type = Syntax.ExpressionStatement;
        this.expression = expression;
    }
}

export class ForInStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ForInStatement;
    readonly left: Expression | VariableDeclaration;
    readonly right: Expression;
    readonly body: Statement;
    readonly each: boolean;
    constructor(left: Expression | VariableDeclaration, right: Expression, body: Statement) {
        this.type = Syntax.ForInStatement;
        this.left = left;
        this.right = right;
        this.body = body;
        this.each = false;
    }
}

export class ForOfStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ForOfStatement;
    readonly await: boolean;
    readonly left: Expression | VariableDeclaration;
    readonly right: Expression;
    readonly body: Statement;
    constructor(left: Expression | VariableDeclaration, right: Expression, body: Statement, _await: boolean) {
        this.type = Syntax.ForOfStatement;
        this.await = _await;
        this.left = left;
        this.right = right;
        this.body = body;
    }
}

export class ForStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ForStatement;
    readonly init: Expression | VariableDeclaration | null;
    readonly test: Expression | null;
    readonly update: Expression | null;
    body: Statement;
    constructor(init: Expression | VariableDeclaration | null, test: Expression | null, update: Expression | null, body: Statement) {
        this.type = Syntax.ForStatement;
        this.init = init;
        this.test = test;
        this.update = update;
        this.body = body;
    }
}

export class FunctionDeclaration {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.FunctionDeclaration;
    id: Identifier | null;
    readonly params: FunctionParameter[];
    readonly body: BlockStatement;
    readonly generator: boolean;
    readonly expression: boolean;
    readonly async: boolean;
    constructor(id: Identifier | null, params: FunctionParameter[], body: BlockStatement, generator: boolean) {
        this.type = Syntax.FunctionDeclaration;
        this.id = id;
        this.params = params;
        this.body = body;
        this.generator = generator;
        this.expression = false;
        this.async = false;
    }
}

export class FunctionExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.FunctionExpression;
    id: Identifier | null;
    readonly params: FunctionParameter[];
    readonly body: BlockStatement;
    readonly generator: boolean;
    readonly expression: boolean;
    readonly async: boolean;
    constructor(id: Identifier | null, params: FunctionParameter[], body: BlockStatement, generator: boolean, isAsync: boolean) {
        this.type = Syntax.FunctionExpression;
        this.id = id;
        this.params = params;
        this.body = body;
        this.generator = generator;
        this.expression = false;
        this.async = isAsync;
    }
}

export class Identifier {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Identifier;
    readonly name: string;
    constructor(name: string) {
        this.type = Syntax.Identifier;
        this.name = name;
    }
}

export class IfStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.IfStatement;
    readonly test: Expression;
    readonly consequent: Statement;
    readonly alternate: Statement | null;
    constructor(test: Expression, consequent: Statement, alternate: Statement | null) {
        this.type = Syntax.IfStatement;
        this.test = test;
        this.consequent = consequent;
        this.alternate = alternate;
    }
}

export class ImportAttribute {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ImportAttribute;
    readonly key: Identifier | Literal;
    readonly value: Literal;
    constructor(key: Identifier | Literal, value: Literal) {
        this.type = Syntax.ImportAttribute;
        this.key = key;
        this.value = value;
    }
}

export class ImportExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ImportExpression;
    readonly source: Expression;
    readonly attributes: Expression | null;
    constructor(source: Expression, attributes: Expression | null) {
        this.type = Syntax.ImportExpression;
        this.source = source;
        this.attributes = attributes;
    }
}

export class ImportDeclaration {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ImportDeclaration;
    readonly specifiers: ImportDeclarationSpecifier[];
    readonly source: Literal;
    readonly assertions: ImportAttribute[] | null;
    constructor(specifiers: ImportDeclarationSpecifier[], source: Literal, assertions: ImportAttribute[] | null) {
        this.type = Syntax.ImportDeclaration;
        this.specifiers = specifiers;
        this.source = source;
        this.assertions = assertions;
    }
}

export class ImportDefaultSpecifier {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ImportDefaultSpecifier;
    readonly local: Identifier;
    constructor(local: Identifier) {
        this.type = Syntax.ImportDefaultSpecifier;
        this.local = local;
    }
}

export class ImportNamespaceSpecifier {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ImportNamespaceSpecifier;
    readonly local: Identifier;
    constructor(local: Identifier) {
        this.type = Syntax.ImportNamespaceSpecifier;
        this.local = local;
    }
}

export class ImportSpecifier {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ImportSpecifier;
    readonly local: Identifier;
    readonly imported: Identifier | Literal;
    constructor(local: Identifier, imported: Identifier | Literal) {
        this.type = Syntax.ImportSpecifier;
        this.local = local;
        this.imported = imported;
    }
}

export class LabeledStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.LabeledStatement;
    readonly label: Identifier;
    readonly body: Statement;
    constructor(label: Identifier, body: Statement) {
        this.type = Syntax.LabeledStatement;
        this.label = label;
        this.body = body;
    }
}

export class Literal {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Literal;
    readonly value: boolean | number | string | null;
    readonly raw: string;
    constructor(value: boolean | number | string | null, raw: string) {
        this.type = Syntax.Literal;
        this.value = value;
        this.raw = raw;
    }
}

export class LogicalExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.LogicalExpression;
    readonly operator: string;
    readonly left: Expression;
    readonly right: Expression;
    constructor(operator: string, left: Expression, right: Expression) {
        this.type = Syntax.LogicalExpression;
        this.operator = operator;
        this.left = left;
        this.right = right;
    }
}

export class MemberExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.MemberExpression;
    readonly computed: boolean;
    readonly object: Expression;
    readonly property: Expression | PrivateIdentifier;
    readonly optional: boolean;
    constructor(computed: boolean, object: Expression, property: PrivateIdentifier | Expression, optional: boolean) {
        this.type = Syntax.MemberExpression;
        this.computed = computed;
        this.object = object;
        this.property = property;
        this.optional = optional;
    }
}

export class MetaProperty {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.MetaProperty;
    readonly meta: Identifier;
    readonly property: Identifier;
    constructor(meta: Identifier, property: Identifier) {
        this.type = Syntax.MetaProperty;
        this.meta = meta;
        this.property = property;
    }
}

export class MethodDefinition {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.MethodDefinition;
    readonly key: Expression | PrivateIdentifier | null;
    readonly computed: boolean;
    readonly value: FunctionExpression | null;
    readonly kind: string;
    readonly static: boolean;
    readonly decorators: Decorator[] | null;
    constructor(key: Expression | PrivateIdentifier | null, computed: boolean, value: FunctionExpression | null, kind: string, isStatic: boolean, decorators: Decorator[] | null) {
        this.type = Syntax.MethodDefinition;
        this.key = key;
        this.computed = computed;
        this.value = value;
        this.kind = kind;
        this.static = isStatic;
        this.decorators = decorators;
    }
}

export class Module {
    declare comments?: import("./comment-handler.ts").Comment[];
    declare tokens?: import("./parser.ts").TokenEntry[];
    declare errors?: import("./error-handler.ts").EsprimaError[];
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Program;
    readonly body: Statement[];
    readonly sourceType: "module";
    constructor(body: Statement[]) {
        this.type = Syntax.Program;
        this.body = body;
        this.sourceType = 'module';
    }
}

export class NewExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.NewExpression;
    readonly callee: Expression;
    readonly arguments: ArgumentListElement[];
    constructor(callee: Expression, args: ArgumentListElement[]) {
        this.type = Syntax.NewExpression;
        this.callee = callee;
        this.arguments = args;
    }
}

export class ObjectExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ObjectExpression;
    readonly properties: ObjectExpressionProperty[];
    constructor(properties: ObjectExpressionProperty[]) {
        this.type = Syntax.ObjectExpression;
        this.properties = properties;
    }
}

export class ObjectPattern {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ObjectPattern;
    readonly properties: ObjectPatternProperty[];
    constructor(properties: ObjectPatternProperty[]) {
        this.type = Syntax.ObjectPattern;
        this.properties = properties;
    }
}

export class PrivateIdentifier {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.PrivateIdentifier;
    readonly name: string;
    constructor(name: string) {
        this.type = Syntax.PrivateIdentifier;
        this.name = name;
    }
}

export class Program {
    declare comments?: import("./comment-handler.ts").Comment[];
    declare tokens?: import("./parser.ts").TokenEntry[];
    declare errors?: import("./error-handler.ts").EsprimaError[];
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Program;
    readonly body: Statement[]
    readonly sourceType: 'script' | 'module';
    constructor(sourceType: 'script' | 'module', body: Statement[]) {
        this.type = Syntax.Program;
        this.sourceType = sourceType;
        this.body = body;
    }
}

export class Property {
    declare decorators?: Decorator[];
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Property;
    readonly key: PropertyKey;
    readonly computed: boolean;
    readonly value: PropertyValue | null;
    readonly kind: string;
    readonly method: boolean;
    readonly shorthand: boolean;
    constructor(kind: string, key: PropertyKey, computed: boolean, value: PropertyValue | null, method: boolean, shorthand: boolean) {
        this.type = Syntax.Property;
        this.key = key;
        this.computed = computed;
        this.value = value;
        this.kind = kind;
        this.method = method;
        this.shorthand = shorthand;
    }
}

export class PropertyDefinition {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Property;
    readonly key: PropertyKey;
    readonly computed: boolean;
    readonly value: PropertyValue | null;
    readonly static: boolean;
    readonly decorators: Decorator[] | null
    constructor(key: PropertyKey, computed: boolean, value: PropertyValue | null, isStatic: boolean, decorators: Decorator[] | null) {
        this.type = Syntax.Property;
        this.key = key;
        this.computed = computed;
        this.value = value;
        this.static = isStatic;
        this.decorators = decorators;
    }
}

export class RegexLiteral {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Literal;
    readonly value: RegExp;
    readonly raw: string;
    readonly regex: { pattern: string; flags: string };
    constructor(value: RegExp, raw: string, pattern: string, flags: string) {
        this.type = Syntax.Literal;
        this.value = value;
        this.raw = raw;
        this.regex = { pattern, flags };
    }
}

export class RestElement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.RestElement;
    readonly argument: BindingIdentifier | BindingPattern;
    constructor(argument: BindingIdentifier | BindingPattern) {
        this.type = Syntax.RestElement;
        this.argument = argument;
    }
}

export class ReturnStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ReturnStatement;
    readonly argument: Expression | null;
    constructor(argument: Expression | null) {
        this.type = Syntax.ReturnStatement;
        this.argument = argument;
    }
}

export class Script {
    declare comments?: import("./comment-handler.ts").Comment[];
    declare tokens?: import("./parser.ts").TokenEntry[];
    declare errors?: import("./error-handler.ts").EsprimaError[];
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Program;
    readonly body: Statement[];
    readonly sourceType: "script";
    constructor(body: Statement[]) {
        this.type = Syntax.Program;
        this.body = body;
        this.sourceType = 'script';
    }
}

export class SequenceExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.SequenceExpression;
    readonly expressions: Expression[];
    constructor(expressions: Expression[]) {
        this.type = Syntax.SequenceExpression;
        this.expressions = expressions;
    }
}

export class SpreadElement {
    declare method?: boolean;
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.SpreadElement;
    readonly argument: Expression;
    constructor(argument: Expression) {
        this.type = Syntax.SpreadElement;
        this.argument = argument;
    }
}

export class StaticBlock {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.StaticBlock;
    readonly body: Statement[];
    constructor(body: Statement[]) {
        this.type = Syntax.StaticBlock;
        this.body = body;
    }
}

export class Super {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.Super;
    constructor() {
        this.type = Syntax.Super;
    }
}

export class SwitchCase {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.SwitchCase;
    readonly test: Expression | null;
    readonly consequent: Statement[];
    constructor(test: Expression | null, consequent: Statement[]) {
        this.type = Syntax.SwitchCase;
        this.test = test;
        this.consequent = consequent;
    }
}

export class SwitchStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.SwitchStatement;
    readonly discriminant: Expression;
    readonly cases: SwitchCase[];
    constructor(discriminant: Expression, cases: SwitchCase[]) {
        this.type = Syntax.SwitchStatement;
        this.discriminant = discriminant;
        this.cases = cases;
    }
}

export class TaggedTemplateExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.TaggedTemplateExpression;
    readonly tag: Expression;
    readonly quasi: TemplateLiteral;
    constructor(tag: Expression, quasi: TemplateLiteral) {
        this.type = Syntax.TaggedTemplateExpression;
        this.tag = tag;
        this.quasi = quasi;
    }
}

interface TemplateElementValue {
    cooked: string | null;
    raw: string;
}

export class TemplateElement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.TemplateElement;
    readonly value: TemplateElementValue;
    readonly tail: boolean;
    constructor(value: TemplateElementValue, tail: boolean) {
        this.type = Syntax.TemplateElement;
        this.value = value;
        this.tail = tail;
    }
}

export class TemplateLiteral {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.TemplateLiteral;
    readonly quasis: TemplateElement[];
    readonly expressions: Expression[];
    constructor(quasis: TemplateElement[], expressions: Expression[]) {
        this.type = Syntax.TemplateLiteral;
        this.quasis = quasis;
        this.expressions = expressions;
    }
}

export class ThisExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ThisExpression;
    constructor() {
        this.type = Syntax.ThisExpression;
    }
}

export class ThrowStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.ThrowStatement;
    readonly argument: Expression;
    constructor(argument: Expression) {
        this.type = Syntax.ThrowStatement;
        this.argument = argument;
    }
}

export class TryStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.TryStatement;
    readonly block: BlockStatement;
    readonly handler: CatchClause | null;
    readonly finalizer: BlockStatement | null;
    constructor(block: BlockStatement, handler: CatchClause | null, finalizer: BlockStatement | null) {
        this.type = Syntax.TryStatement;
        this.block = block;
        this.handler = handler;
        this.finalizer = finalizer;
    }
}

export class UnaryExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.UnaryExpression;
    readonly operator: string;
    readonly argument: Expression;
    readonly prefix: boolean;
    constructor(operator: string, argument: Expression) {
        this.type = Syntax.UnaryExpression;
        this.operator = operator;
        this.argument = argument;
        this.prefix = true;
    }
}

export class UpdateExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.UpdateExpression;
    readonly operator: string;
    readonly argument: Expression;
    readonly prefix: boolean;
    constructor(operator: string, argument: Expression, prefix: boolean) {
        this.type = Syntax.UpdateExpression;
        this.operator = operator;
        this.argument = argument;
        this.prefix = prefix;
    }
}

export class VariableDeclaration {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.VariableDeclaration;
    readonly declarations: VariableDeclarator[];
    readonly kind: string;
    constructor(declarations: VariableDeclarator[], kind: string) {
        this.type = Syntax.VariableDeclaration;
        this.declarations = declarations;
        this.kind = kind;
    }
}

export class VariableDeclarator {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.VariableDeclarator;
    readonly id: BindingIdentifier | BindingPattern;
    readonly init: Expression | null;
    constructor(id: BindingIdentifier | BindingPattern, init: Expression | null) {
        this.type = Syntax.VariableDeclarator;
        this.id = id;
        this.init = init;
    }
}

export class WhileStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.WhileStatement;
    readonly test: Expression;
    readonly body: Statement;
    constructor(test: Expression, body: Statement) {
        this.type = Syntax.WhileStatement;
        this.test = test;
        this.body = body;
    }
}

export class WithStatement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.WithStatement;
    readonly object: Expression;
    readonly body: Statement;
    constructor(object: Expression, body: Statement) {
        this.type = Syntax.WithStatement;
        this.object = object;
        this.body = body;
    }
}

export class YieldExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof Syntax.YieldExpression;
    readonly argument: Expression | null;
    readonly delegate: boolean;
    constructor(argument: Expression | null, delegate: boolean) {
        this.type = Syntax.YieldExpression;
        this.argument = argument;
        this.delegate = delegate;
    }
}
