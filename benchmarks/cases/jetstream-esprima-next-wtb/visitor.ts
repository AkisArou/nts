// Esprima-next 6.0.3, BSD-2-Clause; original notice in esprima.ts and ../LICENSE-jetstream.
// Strict TypeScript transcription of the source embedded in the pinned JetStream bundle.
import * as nodes from './nodes.ts'
import { Syntax } from './syntax.ts';

export class Visitor {
                visit(node: nodes.BindingIdentifier): nodes.BindingIdentifier;
    visit(node: nodes.ArrayExpression): nodes.ArrayExpression;
    visit(node: nodes.ArrayPattern): nodes.ArrayPattern;
    visit(node: nodes.ArrowFunctionExpression): nodes.ArrowFunctionExpression;
    visit(node: nodes.AssignmentExpression): nodes.AssignmentExpression;
    visit(node: nodes.AssignmentPattern): nodes.AssignmentPattern;
    visit(node: nodes.AsyncFunctionDeclaration): nodes.AsyncFunctionDeclaration;
    visit(node: nodes.AsyncFunctionDeclaration["body"]): nodes.AsyncFunctionDeclaration["body"];
    visit(node: nodes.AwaitExpression): nodes.AwaitExpression;
    visit(node: nodes.BigIntLiteral): nodes.BigIntLiteral;
    visit(node: nodes.BinaryExpression): nodes.BinaryExpression;
    visit(node: nodes.BreakStatement): nodes.BreakStatement;
    visit(node: nodes.CallExpression): nodes.CallExpression;
    visit(node: nodes.CatchClause): nodes.CatchClause;
    visit(node: nodes.ChainExpression): nodes.ChainExpression;
    visit(node: nodes.ClassBody): nodes.ClassBody;
    visit(node: nodes.ClassDeclaration): nodes.ClassDeclaration;
    visit(node: nodes.ClassExpression): nodes.ClassExpression;
    visit(node: nodes.Class): nodes.Class;
    visit(node: nodes.ConditionalExpression): nodes.ConditionalExpression;
    visit(node: nodes.ContinueStatement): nodes.ContinueStatement;
    visit(node: nodes.DebuggerStatement): nodes.DebuggerStatement;
    visit(node: nodes.Decorator): nodes.Decorator;
    visit(node: nodes.Directive): nodes.Directive;
    visit(node: nodes.DoWhileStatement): nodes.DoWhileStatement;
    visit(node: nodes.EmptyStatement): nodes.EmptyStatement;
    visit(node: nodes.ExportAllDeclaration): nodes.ExportAllDeclaration;
    visit(node: nodes.ExportAllDeclaration["source"]): nodes.ExportAllDeclaration["source"];
    visit(node: nodes.ExportDefaultDeclaration): nodes.ExportDefaultDeclaration;
    visit(node: nodes.ExportNamedDeclaration): nodes.ExportNamedDeclaration;
    visit(node: nodes.ExportDeclaration): nodes.ExportDeclaration;
    visit(node: nodes.ExportSpecifier): nodes.ExportSpecifier;
    visit(node: nodes.ExpressionStatement): nodes.ExpressionStatement;
    visit(node: nodes.ForInStatement): nodes.ForInStatement;
    visit(node: nodes.ForOfStatement): nodes.ForOfStatement;
    visit(node: nodes.ForStatement): nodes.ForStatement;
    visit(node: nodes.FunctionDeclaration): nodes.FunctionDeclaration;
    visit(node: nodes.FunctionExpression): nodes.FunctionExpression;
    visit(node: nodes.Function): nodes.Function;
    visit(node: nodes.IfStatement): nodes.IfStatement;
    visit(node: nodes.ImportAttribute): nodes.ImportAttribute;
    visit(node: nodes.ImportExpression): nodes.ImportExpression;
    visit(node: nodes.ImportDeclaration): nodes.ImportDeclaration;
    visit(node: nodes.ImportDefaultSpecifier): nodes.ImportDefaultSpecifier;
    visit(node: nodes.ImportNamespaceSpecifier): nodes.ImportNamespaceSpecifier;
    visit(node: nodes.ImportSpecifier): nodes.ImportSpecifier;
    visit(node: nodes.ImportDeclarationSpecifier): nodes.ImportDeclarationSpecifier;
    visit(node: nodes.LabeledStatement): nodes.LabeledStatement;
    visit(node: nodes.LogicalExpression): nodes.LogicalExpression;
    visit(node: nodes.MemberExpression): nodes.MemberExpression;
    visit(node: nodes.ChainElement): nodes.ChainElement;
    visit(node: nodes.MetaProperty): nodes.MetaProperty;
    visit(node: nodes.ExportSpecifier["exported"]): nodes.ExportSpecifier["exported"];
    visit(node: nodes.MethodDefinition): nodes.MethodDefinition;
    visit(node: nodes.Module): nodes.Module;
    visit(node: nodes.NewExpression): nodes.NewExpression;
    visit(node: nodes.ObjectExpression): nodes.ObjectExpression;
    visit(node: nodes.ObjectPattern): nodes.ObjectPattern;
    visit(node: nodes.BindingPattern): nodes.BindingPattern;
    visit(node: nodes.AssignmentPattern["left"]): nodes.AssignmentPattern["left"];
    visit(node: nodes.PrivateIdentifier): nodes.PrivateIdentifier;
    visit(node: nodes.Property): nodes.Property;
    visit(node: nodes.PropertyDefinition): nodes.PropertyDefinition;
    visit(node: nodes.RegexLiteral): nodes.RegexLiteral;
    visit(node: nodes.RestElement): nodes.RestElement;
    visit(node: nodes.ObjectPatternProperty): nodes.ObjectPatternProperty;
    visit(node: nodes.ReturnStatement): nodes.ReturnStatement;
    visit(node: nodes.Script): nodes.Script;
    visit(node: nodes.Program): nodes.Program;
    visit(node: nodes.SequenceExpression): nodes.SequenceExpression;
    visit(node: nodes.SpreadElement): nodes.SpreadElement;
    visit(node: nodes.ObjectExpressionProperty): nodes.ObjectExpressionProperty;
    visit(node: nodes.StaticBlock): nodes.StaticBlock;
    visit(node: nodes.Super): nodes.Super;
    visit(node: nodes.SwitchCase): nodes.SwitchCase;
    visit(node: nodes.SwitchStatement): nodes.SwitchStatement;
    visit(node: nodes.TaggedTemplateExpression): nodes.TaggedTemplateExpression;
    visit(node: nodes.TaggedTemplateExpression["quasi"]): nodes.TaggedTemplateExpression["quasi"];
    visit(node: nodes.TemplateElement): nodes.TemplateElement;
    visit(node: nodes.ThisExpression): nodes.ThisExpression;
    visit(node: nodes.ThrowStatement): nodes.ThrowStatement;
    visit(node: nodes.TryStatement): nodes.TryStatement;
    visit(node: nodes.UnaryExpression): nodes.UnaryExpression;
    visit(node: nodes.UpdateExpression): nodes.UpdateExpression;
    visit(node: nodes.VariableDeclaration): nodes.VariableDeclaration;
    visit(node: nodes.ExportableNamedDeclaration): nodes.ExportableNamedDeclaration;
    visit(node: nodes.Declaration): nodes.Declaration;
    visit(node: nodes.VariableDeclarator): nodes.VariableDeclarator;
    visit(node: nodes.WhileStatement): nodes.WhileStatement;
    visit(node: nodes.WithStatement): nodes.WithStatement;
    visit(node: nodes.Statement): nodes.Statement;
    visit(node: nodes.YieldExpression): nodes.YieldExpression;
    visit(node: nodes.Expression): nodes.Expression;
    visit(node: nodes.ArgumentListElement): nodes.ArgumentListElement;
    visit(node: nodes.ExportableDefaultDeclaration): nodes.ExportableDefaultDeclaration;
    visit(node: nodes.PropertyValue): nodes.PropertyValue;
    visit(node: nodes.Pattern): nodes.Pattern;
    visit(node: nodes.FunctionParameter): nodes.FunctionParameter;
    visit(node: nodes.ArrowFunctionExpression["body"]): nodes.ArrowFunctionExpression["body"];
    visit(node: nodes.ForInStatement["left"]): nodes.ForInStatement["left"];
    visit(node: null): null;
    visit(node: nodes.ArrowFunctionExpression["id"]): nodes.ArrowFunctionExpression["id"];
    visit(node: nodes.ExportNamedDeclaration["declaration"]): nodes.ExportNamedDeclaration["declaration"];
    visit(node: nodes.ExportNamedDeclaration["source"]): nodes.ExportNamedDeclaration["source"];
    visit(node: nodes.CatchClause["param"]): nodes.CatchClause["param"];
    visit(node: nodes.ArrayPatternElement): nodes.ArrayPatternElement;
    visit(node: nodes.ExportAllDeclaration["exported"]): nodes.ExportAllDeclaration["exported"];
    visit(node: nodes.MethodDefinition["value"]): nodes.MethodDefinition["value"];
    visit(node: nodes.ClassDeclaration["superClass"]): nodes.ClassDeclaration["superClass"];
    visit(node: nodes.TryStatement["handler"]): nodes.TryStatement["handler"];
    visit(node: nodes.TryStatement["finalizer"]): nodes.TryStatement["finalizer"];
    visit(node: nodes.IfStatement["alternate"]): nodes.IfStatement["alternate"];
    visit(node: nodes.ArrayExpressionElement): nodes.ArrayExpressionElement;
    visit(node: nodes.ForStatement["init"]): nodes.ForStatement["init"];
    visit(node: nodes.Property["value"]): nodes.Property["value"];
    visit(node: nodes.Node): nodes.Node;
    visit(node: undefined): undefined;
    visit(node: nodes.Node | undefined): nodes.Node | undefined;
visit(node: nodes.Node | undefined): nodes.Node | undefined {
        if (node == null)
            return node;
        switch (node.type) {
            case Syntax.AssignmentExpression:
                return this.visitAssignmentExpression(node);
            case Syntax.AssignmentPattern:
                return this.visitAssignmentPattern(node);
            case Syntax.ArrayExpression:
                return this.visitArrayExpression(node);
            case Syntax.ArrayPattern:
                return this.visitArrayPattern(node);
            case Syntax.ArrowFunctionExpression:
                return this.visitArrowFunctionExpression(node);
            case Syntax.AwaitExpression:
                return this.visitAwaitExpression(node);
            case Syntax.BlockStatement:
                return this.visitBlockStatement(node);
            case Syntax.BinaryExpression:
                return this.visitBinaryExpression(node);
            case Syntax.BreakStatement:
                return this.visitBreakStatement(node);
            case Syntax.CallExpression:
                return this.visitCallExpression(node);
            case Syntax.CatchClause:
                return this.visitCatchClause(node);
            case Syntax.ChainExpression:
                return this.visitChainExpression(node);
            case Syntax.ClassBody:
                return this.visitClassBody(node);
            case Syntax.ClassDeclaration:
                return this.visitClassDeclaration(node);
            case Syntax.ClassExpression:
                return this.visitClassExpression(node);
            case Syntax.ConditionalExpression:
                return this.visitConditionalExpression(node);
            case Syntax.ContinueStatement:
                return this.visitContinueStatement(node);
            case Syntax.Decorator:
                return this.visitDecorator(node);
            case Syntax.DoWhileStatement:
                return this.visitDoWhileStatement(node);
            case Syntax.DebuggerStatement:
                return this.visitDebuggerStatement(node);
            case Syntax.EmptyStatement:
                return this.visitEmptyStatement(node);
            case Syntax.ExportAllDeclaration:
                return this.visitExportAllDeclaration(node);
            case Syntax.ExportDefaultDeclaration:
                return this.visitExportDefaultDeclaration(node);
            case Syntax.ExportNamedDeclaration:
                return this.visitExportNamedDeclaration(node);
            case Syntax.ExportSpecifier:
                return this.visitExportSpecifier(node);
            case Syntax.ExpressionStatement:
                return this.visitExpressionStatement(node);
            case Syntax.ForStatement:
                return this.visitForStatement(node);
            case Syntax.ForOfStatement:
                return this.visitForOfStatement(node);
            case Syntax.ForInStatement:
                return this.visitForInStatement(node);
            case Syntax.FunctionDeclaration:
                return this.visitFunctionDeclaration(node);
            case Syntax.FunctionExpression:
                return this.visitFunctionExpression(node);
            case Syntax.Identifier:
                return this.visitIdentifier(node);
            case Syntax.IfStatement:
                return this.visitIfStatement(node);
            case Syntax.ImportAttribute:
                return this.visitImportAttribute(node);
            case Syntax.ImportExpression:
                return this.visitImportExpression(node);
            case Syntax.ImportDeclaration:
                return this.visitImportDeclaration(node);
            case Syntax.ImportDefaultSpecifier:
                return this.visitImportDefaultSpecifier(node);
            case Syntax.ImportNamespaceSpecifier:
                return this.visitImportNamespaceSpecifier(node);
            case Syntax.ImportSpecifier:
                return this.visitImportSpecifier(node);
            case Syntax.Literal:
                return this.visitLiteral(node);
            case Syntax.LabeledStatement:
                return this.visitLabeledStatement(node);
            case Syntax.LogicalExpression:
                return this.visitLogicalExpression(node);
            case Syntax.MemberExpression:
                return this.visitMemberExpression(node);
            case Syntax.MetaProperty:
                return this.visitMetaProperty(node);
            case Syntax.MethodDefinition:
                return this.visitMethodDefinition(node);
            case Syntax.NewExpression:
                return this.visitNewExpression(node);
            case Syntax.ObjectExpression:
                return this.visitObjectExpression(node);
            case Syntax.ObjectPattern:
                return this.visitObjectPattern(node);
            case Syntax.Program:
                return this.visitProgram(node);
            case Syntax.Property:
                return this.visitProperty(node);
            case Syntax.PrivateIdentifier:
                return this.visitPrivateIdentifier(node);
            case Syntax.RestElement:
                return this.visitRestElement(node);
            case Syntax.ReturnStatement:
                return this.visitReturnStatement(node);
            case Syntax.SequenceExpression:
                return this.visitSequenceExpression(node);
            case Syntax.SpreadElement:
                return this.visitSpreadElement(node);
            case Syntax.StaticBlock:
                return this.visitStaticBlock(node);
            case Syntax.Super:
                return this.visitSuper(node);
            case Syntax.SwitchCase:
                return this.visitSwitchCase(node);
            case Syntax.SwitchStatement:
                return this.visitSwitchStatement(node);
            case Syntax.TaggedTemplateExpression:
                return this.visitTaggedTemplateExpression(node);
            case Syntax.TemplateElement:
                return this.visitTemplateElement(node);
            case Syntax.TemplateLiteral:
                return this.visitTemplateLiteral(node);
            case Syntax.ThisExpression:
                return this.visitThisExpression(node);
            case Syntax.ThrowStatement:
                return this.visitThrowStatement(node);
            case Syntax.TryStatement:
                return this.visitTryStatement(node);
            case Syntax.UnaryExpression:
                return this.visitUnaryExpression(node);
            case Syntax.UpdateExpression:
                return this.visitUpdateExpression(node);
            case Syntax.VariableDeclaration:
                return this.visitVariableDeclaration(node);
            case Syntax.VariableDeclarator:
                return this.visitVariableDeclarator(node);
            case Syntax.WhileStatement:
                return this.visitWhileStatement(node);
            case Syntax.WithStatement:
                return this.visitWithStatement(node);
            case Syntax.YieldExpression:
                return this.visitYieldExpression(node);
        }
    }

                visitNodeList(original: nodes.ExportNamedDeclaration["specifiers"]): nodes.ExportNamedDeclaration["specifiers"];
    visitNodeList(original: nodes.Property["decorators"]): nodes.Property["decorators"];
    visitNodeList(original: nodes.SwitchStatement["cases"]): nodes.SwitchStatement["cases"];
    visitNodeList(original: nodes.TemplateLiteral["quasis"]): nodes.TemplateLiteral["quasis"];
    visitNodeList(original: nodes.VariableDeclaration["declarations"]): nodes.VariableDeclaration["declarations"];
    visitNodeList(original: nodes.BindingIdentifier[]): nodes.BindingIdentifier[];
    visitNodeList(original: nodes.ArrayExpression[]): nodes.ArrayExpression[];
    visitNodeList(original: nodes.ArrayPattern[]): nodes.ArrayPattern[];
    visitNodeList(original: nodes.ArrowFunctionExpression[]): nodes.ArrowFunctionExpression[];
    visitNodeList(original: nodes.AssignmentExpression[]): nodes.AssignmentExpression[];
    visitNodeList(original: nodes.AssignmentPattern[]): nodes.AssignmentPattern[];
    visitNodeList(original: nodes.AsyncFunctionDeclaration[]): nodes.AsyncFunctionDeclaration[];
    visitNodeList(original: nodes.AwaitExpression[]): nodes.AwaitExpression[];
    visitNodeList(original: nodes.BigIntLiteral[]): nodes.BigIntLiteral[];
    visitNodeList(original: nodes.BinaryExpression[]): nodes.BinaryExpression[];
    visitNodeList(original: nodes.BlockStatement[]): nodes.BlockStatement[];
    visitNodeList(original: nodes.BreakStatement[]): nodes.BreakStatement[];
    visitNodeList(original: nodes.CallExpression[]): nodes.CallExpression[];
    visitNodeList(original: nodes.CatchClause[]): nodes.CatchClause[];
    visitNodeList(original: nodes.ChainExpression[]): nodes.ChainExpression[];
    visitNodeList(original: nodes.ClassBody[]): nodes.ClassBody[];
    visitNodeList(original: nodes.ClassDeclaration[]): nodes.ClassDeclaration[];
    visitNodeList(original: nodes.ClassExpression[]): nodes.ClassExpression[];
    visitNodeList(original: nodes.Class[]): nodes.Class[];
    visitNodeList(original: nodes.ConditionalExpression[]): nodes.ConditionalExpression[];
    visitNodeList(original: nodes.ContinueStatement[]): nodes.ContinueStatement[];
    visitNodeList(original: nodes.DebuggerStatement[]): nodes.DebuggerStatement[];
    visitNodeList(original: nodes.Directive[]): nodes.Directive[];
    visitNodeList(original: nodes.DoWhileStatement[]): nodes.DoWhileStatement[];
    visitNodeList(original: nodes.EmptyStatement[]): nodes.EmptyStatement[];
    visitNodeList(original: nodes.ExportAllDeclaration[]): nodes.ExportAllDeclaration[];
    visitNodeList(original: nodes.ExportDefaultDeclaration[]): nodes.ExportDefaultDeclaration[];
    visitNodeList(original: nodes.ExportNamedDeclaration[]): nodes.ExportNamedDeclaration[];
    visitNodeList(original: nodes.ExportDeclaration[]): nodes.ExportDeclaration[];
    visitNodeList(original: nodes.ExpressionStatement[]): nodes.ExpressionStatement[];
    visitNodeList(original: nodes.ForInStatement[]): nodes.ForInStatement[];
    visitNodeList(original: nodes.ForOfStatement[]): nodes.ForOfStatement[];
    visitNodeList(original: nodes.ForStatement[]): nodes.ForStatement[];
    visitNodeList(original: nodes.FunctionDeclaration[]): nodes.FunctionDeclaration[];
    visitNodeList(original: nodes.FunctionExpression[]): nodes.FunctionExpression[];
    visitNodeList(original: nodes.Function[]): nodes.Function[];
    visitNodeList(original: nodes.IfStatement[]): nodes.IfStatement[];
    visitNodeList(original: nodes.ImportAttribute[]): nodes.ImportAttribute[];
    visitNodeList(original: nodes.ImportExpression[]): nodes.ImportExpression[];
    visitNodeList(original: nodes.ImportDeclaration[]): nodes.ImportDeclaration[];
    visitNodeList(original: nodes.ImportDefaultSpecifier[]): nodes.ImportDefaultSpecifier[];
    visitNodeList(original: nodes.ImportNamespaceSpecifier[]): nodes.ImportNamespaceSpecifier[];
    visitNodeList(original: nodes.ImportSpecifier[]): nodes.ImportSpecifier[];
    visitNodeList(original: nodes.ImportDeclaration["specifiers"]): nodes.ImportDeclaration["specifiers"];
    visitNodeList(original: nodes.LabeledStatement[]): nodes.LabeledStatement[];
    visitNodeList(original: nodes.Literal[]): nodes.Literal[];
    visitNodeList(original: nodes.LogicalExpression[]): nodes.LogicalExpression[];
    visitNodeList(original: nodes.MemberExpression[]): nodes.MemberExpression[];
    visitNodeList(original: nodes.ChainElement[]): nodes.ChainElement[];
    visitNodeList(original: nodes.MetaProperty[]): nodes.MetaProperty[];
    visitNodeList(original: nodes.MethodDefinition[]): nodes.MethodDefinition[];
    visitNodeList(original: nodes.Module[]): nodes.Module[];
    visitNodeList(original: nodes.NewExpression[]): nodes.NewExpression[];
    visitNodeList(original: nodes.ObjectExpression[]): nodes.ObjectExpression[];
    visitNodeList(original: nodes.ObjectPattern[]): nodes.ObjectPattern[];
    visitNodeList(original: nodes.BindingPattern[]): nodes.BindingPattern[];
    visitNodeList(original: nodes.PrivateIdentifier[]): nodes.PrivateIdentifier[];
    visitNodeList(original: nodes.Property[]): nodes.Property[];
    visitNodeList(original: nodes.PropertyDefinition[]): nodes.PropertyDefinition[];
    visitNodeList(original: nodes.RegexLiteral[]): nodes.RegexLiteral[];
    visitNodeList(original: nodes.RestElement[]): nodes.RestElement[];
    visitNodeList(original: nodes.ArrayPattern["elements"]): nodes.ArrayPattern["elements"];
    visitNodeList(original: nodes.ObjectPattern["properties"]): nodes.ObjectPattern["properties"];
    visitNodeList(original: nodes.ReturnStatement[]): nodes.ReturnStatement[];
    visitNodeList(original: nodes.Script[]): nodes.Script[];
    visitNodeList(original: nodes.Program[]): nodes.Program[];
    visitNodeList(original: nodes.SequenceExpression[]): nodes.SequenceExpression[];
    visitNodeList(original: nodes.SpreadElement[]): nodes.SpreadElement[];
    visitNodeList(original: nodes.ObjectExpression["properties"]): nodes.ObjectExpression["properties"];
    visitNodeList(original: nodes.StaticBlock[]): nodes.StaticBlock[];
    visitNodeList(original: nodes.ClassBody["body"]): nodes.ClassBody["body"];
    visitNodeList(original: nodes.Super[]): nodes.Super[];
    visitNodeList(original: nodes.SwitchStatement[]): nodes.SwitchStatement[];
    visitNodeList(original: nodes.TaggedTemplateExpression[]): nodes.TaggedTemplateExpression[];
    visitNodeList(original: nodes.TemplateLiteral[]): nodes.TemplateLiteral[];
    visitNodeList(original: nodes.ThisExpression[]): nodes.ThisExpression[];
    visitNodeList(original: nodes.ThrowStatement[]): nodes.ThrowStatement[];
    visitNodeList(original: nodes.TryStatement[]): nodes.TryStatement[];
    visitNodeList(original: nodes.UnaryExpression[]): nodes.UnaryExpression[];
    visitNodeList(original: nodes.UpdateExpression[]): nodes.UpdateExpression[];
    visitNodeList(original: nodes.VariableDeclaration[]): nodes.VariableDeclaration[];
    visitNodeList(original: nodes.ExportableNamedDeclaration[]): nodes.ExportableNamedDeclaration[];
    visitNodeList(original: nodes.Declaration[]): nodes.Declaration[];
    visitNodeList(original: nodes.WhileStatement[]): nodes.WhileStatement[];
    visitNodeList(original: nodes.WithStatement[]): nodes.WithStatement[];
    visitNodeList(original: nodes.BlockStatement["body"]): nodes.BlockStatement["body"];
    visitNodeList(original: nodes.YieldExpression[]): nodes.YieldExpression[];
    visitNodeList(original: nodes.SequenceExpression["expressions"]): nodes.SequenceExpression["expressions"];
    visitNodeList(original: nodes.CallExpression["arguments"]): nodes.CallExpression["arguments"];
    visitNodeList(original: nodes.ArrayExpression["elements"]): nodes.ArrayExpression["elements"];
    visitNodeList(original: nodes.PropertyValue[]): nodes.PropertyValue[];
    visitNodeList(original: nodes.ExportableDefaultDeclaration[]): nodes.ExportableDefaultDeclaration[];
    visitNodeList(original: nodes.Pattern[]): nodes.Pattern[];
    visitNodeList(original: nodes.ArrowFunctionExpression["params"]): nodes.ArrowFunctionExpression["params"];
    visitNodeList(original: nodes.Node[]): nodes.Node[];
    visitNodeList(original: null): null;
    visitNodeList(original: nodes.ClassDeclaration["decorators"]): nodes.ClassDeclaration["decorators"];
    visitNodeList(original: nodes.ExportAllDeclaration["assertions"]): nodes.ExportAllDeclaration["assertions"];
    visitNodeList(original: nodes.BindingIdentifier[] | null): nodes.BindingIdentifier[] | null;
    visitNodeList(original: nodes.ArrayExpression[] | null): nodes.ArrayExpression[] | null;
    visitNodeList(original: nodes.ArrayPattern[] | null): nodes.ArrayPattern[] | null;
    visitNodeList(original: nodes.ArrowFunctionExpression[] | null): nodes.ArrowFunctionExpression[] | null;
    visitNodeList(original: nodes.AssignmentExpression[] | null): nodes.AssignmentExpression[] | null;
    visitNodeList(original: nodes.AssignmentPattern[] | null): nodes.AssignmentPattern[] | null;
    visitNodeList(original: nodes.AsyncFunctionDeclaration[] | null): nodes.AsyncFunctionDeclaration[] | null;
    visitNodeList(original: nodes.AwaitExpression[] | null): nodes.AwaitExpression[] | null;
    visitNodeList(original: nodes.BigIntLiteral[] | null): nodes.BigIntLiteral[] | null;
    visitNodeList(original: nodes.BinaryExpression[] | null): nodes.BinaryExpression[] | null;
    visitNodeList(original: nodes.BlockStatement[] | null): nodes.BlockStatement[] | null;
    visitNodeList(original: nodes.BreakStatement[] | null): nodes.BreakStatement[] | null;
    visitNodeList(original: nodes.CallExpression[] | null): nodes.CallExpression[] | null;
    visitNodeList(original: nodes.CatchClause[] | null): nodes.CatchClause[] | null;
    visitNodeList(original: nodes.ChainExpression[] | null): nodes.ChainExpression[] | null;
    visitNodeList(original: nodes.ClassBody[] | null): nodes.ClassBody[] | null;
    visitNodeList(original: nodes.ClassDeclaration[] | null): nodes.ClassDeclaration[] | null;
    visitNodeList(original: nodes.ClassExpression[] | null): nodes.ClassExpression[] | null;
    visitNodeList(original: nodes.Class[] | null): nodes.Class[] | null;
    visitNodeList(original: nodes.ConditionalExpression[] | null): nodes.ConditionalExpression[] | null;
    visitNodeList(original: nodes.ContinueStatement[] | null): nodes.ContinueStatement[] | null;
    visitNodeList(original: nodes.DebuggerStatement[] | null): nodes.DebuggerStatement[] | null;
    visitNodeList(original: nodes.Directive[] | null): nodes.Directive[] | null;
    visitNodeList(original: nodes.DoWhileStatement[] | null): nodes.DoWhileStatement[] | null;
    visitNodeList(original: nodes.EmptyStatement[] | null): nodes.EmptyStatement[] | null;
    visitNodeList(original: nodes.ExportAllDeclaration[] | null): nodes.ExportAllDeclaration[] | null;
    visitNodeList(original: nodes.ExportDefaultDeclaration[] | null): nodes.ExportDefaultDeclaration[] | null;
    visitNodeList(original: nodes.ExportNamedDeclaration[] | null): nodes.ExportNamedDeclaration[] | null;
    visitNodeList(original: nodes.ExportDeclaration[] | null): nodes.ExportDeclaration[] | null;
    visitNodeList(original: nodes.ExportSpecifier[] | null): nodes.ExportSpecifier[] | null;
    visitNodeList(original: nodes.ExpressionStatement[] | null): nodes.ExpressionStatement[] | null;
    visitNodeList(original: nodes.ForInStatement[] | null): nodes.ForInStatement[] | null;
    visitNodeList(original: nodes.ForOfStatement[] | null): nodes.ForOfStatement[] | null;
    visitNodeList(original: nodes.ForStatement[] | null): nodes.ForStatement[] | null;
    visitNodeList(original: nodes.FunctionDeclaration[] | null): nodes.FunctionDeclaration[] | null;
    visitNodeList(original: nodes.FunctionExpression[] | null): nodes.FunctionExpression[] | null;
    visitNodeList(original: nodes.Function[] | null): nodes.Function[] | null;
    visitNodeList(original: nodes.IfStatement[] | null): nodes.IfStatement[] | null;
    visitNodeList(original: nodes.ImportExpression[] | null): nodes.ImportExpression[] | null;
    visitNodeList(original: nodes.ImportDeclaration[] | null): nodes.ImportDeclaration[] | null;
    visitNodeList(original: nodes.ImportDefaultSpecifier[] | null): nodes.ImportDefaultSpecifier[] | null;
    visitNodeList(original: nodes.ImportNamespaceSpecifier[] | null): nodes.ImportNamespaceSpecifier[] | null;
    visitNodeList(original: nodes.ImportSpecifier[] | null): nodes.ImportSpecifier[] | null;
    visitNodeList(original: nodes.ImportDeclarationSpecifier[] | null): nodes.ImportDeclarationSpecifier[] | null;
    visitNodeList(original: nodes.LabeledStatement[] | null): nodes.LabeledStatement[] | null;
    visitNodeList(original: nodes.Literal[] | null): nodes.Literal[] | null;
    visitNodeList(original: nodes.LogicalExpression[] | null): nodes.LogicalExpression[] | null;
    visitNodeList(original: nodes.MemberExpression[] | null): nodes.MemberExpression[] | null;
    visitNodeList(original: nodes.ChainElement[] | null): nodes.ChainElement[] | null;
    visitNodeList(original: nodes.MetaProperty[] | null): nodes.MetaProperty[] | null;
    visitNodeList(original: nodes.MethodDefinition[] | null): nodes.MethodDefinition[] | null;
    visitNodeList(original: nodes.Module[] | null): nodes.Module[] | null;
    visitNodeList(original: nodes.NewExpression[] | null): nodes.NewExpression[] | null;
    visitNodeList(original: nodes.ObjectExpression[] | null): nodes.ObjectExpression[] | null;
    visitNodeList(original: nodes.ObjectPattern[] | null): nodes.ObjectPattern[] | null;
    visitNodeList(original: nodes.BindingPattern[] | null): nodes.BindingPattern[] | null;
    visitNodeList(original: nodes.PrivateIdentifier[] | null): nodes.PrivateIdentifier[] | null;
    visitNodeList(original: nodes.Property[] | null): nodes.Property[] | null;
    visitNodeList(original: nodes.PropertyDefinition[] | null): nodes.PropertyDefinition[] | null;
    visitNodeList(original: nodes.RegexLiteral[] | null): nodes.RegexLiteral[] | null;
    visitNodeList(original: nodes.RestElement[] | null): nodes.RestElement[] | null;
    visitNodeList(original: nodes.ArrayPatternElement[] | null): nodes.ArrayPatternElement[] | null;
    visitNodeList(original: nodes.ObjectPatternProperty[] | null): nodes.ObjectPatternProperty[] | null;
    visitNodeList(original: nodes.ReturnStatement[] | null): nodes.ReturnStatement[] | null;
    visitNodeList(original: nodes.Script[] | null): nodes.Script[] | null;
    visitNodeList(original: nodes.Program[] | null): nodes.Program[] | null;
    visitNodeList(original: nodes.SequenceExpression[] | null): nodes.SequenceExpression[] | null;
    visitNodeList(original: nodes.SpreadElement[] | null): nodes.SpreadElement[] | null;
    visitNodeList(original: nodes.ObjectExpressionProperty[] | null): nodes.ObjectExpressionProperty[] | null;
    visitNodeList(original: nodes.StaticBlock[] | null): nodes.StaticBlock[] | null;
    visitNodeList(original: nodes.Super[] | null): nodes.Super[] | null;
    visitNodeList(original: nodes.SwitchCase[] | null): nodes.SwitchCase[] | null;
    visitNodeList(original: nodes.SwitchStatement[] | null): nodes.SwitchStatement[] | null;
    visitNodeList(original: nodes.TaggedTemplateExpression[] | null): nodes.TaggedTemplateExpression[] | null;
    visitNodeList(original: nodes.TemplateElement[] | null): nodes.TemplateElement[] | null;
    visitNodeList(original: nodes.TemplateLiteral[] | null): nodes.TemplateLiteral[] | null;
    visitNodeList(original: nodes.ThisExpression[] | null): nodes.ThisExpression[] | null;
    visitNodeList(original: nodes.ThrowStatement[] | null): nodes.ThrowStatement[] | null;
    visitNodeList(original: nodes.TryStatement[] | null): nodes.TryStatement[] | null;
    visitNodeList(original: nodes.UnaryExpression[] | null): nodes.UnaryExpression[] | null;
    visitNodeList(original: nodes.UpdateExpression[] | null): nodes.UpdateExpression[] | null;
    visitNodeList(original: nodes.VariableDeclaration[] | null): nodes.VariableDeclaration[] | null;
    visitNodeList(original: nodes.ExportableNamedDeclaration[] | null): nodes.ExportableNamedDeclaration[] | null;
    visitNodeList(original: nodes.Declaration[] | null): nodes.Declaration[] | null;
    visitNodeList(original: nodes.VariableDeclarator[] | null): nodes.VariableDeclarator[] | null;
    visitNodeList(original: nodes.WhileStatement[] | null): nodes.WhileStatement[] | null;
    visitNodeList(original: nodes.WithStatement[] | null): nodes.WithStatement[] | null;
    visitNodeList(original: nodes.Statement[] | null): nodes.Statement[] | null;
    visitNodeList(original: nodes.YieldExpression[] | null): nodes.YieldExpression[] | null;
    visitNodeList(original: nodes.PropertyKey[] | null): nodes.PropertyKey[] | null;
    visitNodeList(original: nodes.PropertyValue[] | null): nodes.PropertyValue[] | null;
    visitNodeList(original: nodes.ArgumentListElement[] | null): nodes.ArgumentListElement[] | null;
    visitNodeList(original: nodes.ArrayExpressionElement[] | null): nodes.ArrayExpressionElement[] | null;
    visitNodeList(original: nodes.ExportableDefaultDeclaration[] | null): nodes.ExportableDefaultDeclaration[] | null;
    visitNodeList(original: nodes.Pattern[] | null): nodes.Pattern[] | null;
    visitNodeList(original: nodes.FunctionParameter[] | null): nodes.FunctionParameter[] | null;
    visitNodeList(original: nodes.Node[] | null): nodes.Node[] | null;
    visitNodeList(original: undefined): undefined;
    visitNodeList(original: nodes.BindingIdentifier[] | undefined): nodes.BindingIdentifier[] | undefined;
    visitNodeList(original: nodes.ArrayExpression[] | undefined): nodes.ArrayExpression[] | undefined;
    visitNodeList(original: nodes.ArrayPattern[] | undefined): nodes.ArrayPattern[] | undefined;
    visitNodeList(original: nodes.ArrowFunctionExpression[] | undefined): nodes.ArrowFunctionExpression[] | undefined;
    visitNodeList(original: nodes.AssignmentExpression[] | undefined): nodes.AssignmentExpression[] | undefined;
    visitNodeList(original: nodes.AssignmentPattern[] | undefined): nodes.AssignmentPattern[] | undefined;
    visitNodeList(original: nodes.AsyncFunctionDeclaration[] | undefined): nodes.AsyncFunctionDeclaration[] | undefined;
    visitNodeList(original: nodes.AwaitExpression[] | undefined): nodes.AwaitExpression[] | undefined;
    visitNodeList(original: nodes.BigIntLiteral[] | undefined): nodes.BigIntLiteral[] | undefined;
    visitNodeList(original: nodes.BinaryExpression[] | undefined): nodes.BinaryExpression[] | undefined;
    visitNodeList(original: nodes.BlockStatement[] | undefined): nodes.BlockStatement[] | undefined;
    visitNodeList(original: nodes.BreakStatement[] | undefined): nodes.BreakStatement[] | undefined;
    visitNodeList(original: nodes.CallExpression[] | undefined): nodes.CallExpression[] | undefined;
    visitNodeList(original: nodes.CatchClause[] | undefined): nodes.CatchClause[] | undefined;
    visitNodeList(original: nodes.ChainExpression[] | undefined): nodes.ChainExpression[] | undefined;
    visitNodeList(original: nodes.ClassBody[] | undefined): nodes.ClassBody[] | undefined;
    visitNodeList(original: nodes.ClassDeclaration[] | undefined): nodes.ClassDeclaration[] | undefined;
    visitNodeList(original: nodes.ClassExpression[] | undefined): nodes.ClassExpression[] | undefined;
    visitNodeList(original: nodes.Class[] | undefined): nodes.Class[] | undefined;
    visitNodeList(original: nodes.ConditionalExpression[] | undefined): nodes.ConditionalExpression[] | undefined;
    visitNodeList(original: nodes.ContinueStatement[] | undefined): nodes.ContinueStatement[] | undefined;
    visitNodeList(original: nodes.DebuggerStatement[] | undefined): nodes.DebuggerStatement[] | undefined;
    visitNodeList(original: nodes.Decorator[] | undefined): nodes.Decorator[] | undefined;
    visitNodeList(original: nodes.Directive[] | undefined): nodes.Directive[] | undefined;
    visitNodeList(original: nodes.DoWhileStatement[] | undefined): nodes.DoWhileStatement[] | undefined;
    visitNodeList(original: nodes.EmptyStatement[] | undefined): nodes.EmptyStatement[] | undefined;
    visitNodeList(original: nodes.ExportAllDeclaration[] | undefined): nodes.ExportAllDeclaration[] | undefined;
    visitNodeList(original: nodes.ExportDefaultDeclaration[] | undefined): nodes.ExportDefaultDeclaration[] | undefined;
    visitNodeList(original: nodes.ExportNamedDeclaration[] | undefined): nodes.ExportNamedDeclaration[] | undefined;
    visitNodeList(original: nodes.ExportDeclaration[] | undefined): nodes.ExportDeclaration[] | undefined;
    visitNodeList(original: nodes.ExportSpecifier[] | undefined): nodes.ExportSpecifier[] | undefined;
    visitNodeList(original: nodes.ExpressionStatement[] | undefined): nodes.ExpressionStatement[] | undefined;
    visitNodeList(original: nodes.ForInStatement[] | undefined): nodes.ForInStatement[] | undefined;
    visitNodeList(original: nodes.ForOfStatement[] | undefined): nodes.ForOfStatement[] | undefined;
    visitNodeList(original: nodes.ForStatement[] | undefined): nodes.ForStatement[] | undefined;
    visitNodeList(original: nodes.FunctionDeclaration[] | undefined): nodes.FunctionDeclaration[] | undefined;
    visitNodeList(original: nodes.FunctionExpression[] | undefined): nodes.FunctionExpression[] | undefined;
    visitNodeList(original: nodes.Function[] | undefined): nodes.Function[] | undefined;
    visitNodeList(original: nodes.IfStatement[] | undefined): nodes.IfStatement[] | undefined;
    visitNodeList(original: nodes.ImportAttribute[] | undefined): nodes.ImportAttribute[] | undefined;
    visitNodeList(original: nodes.ImportExpression[] | undefined): nodes.ImportExpression[] | undefined;
    visitNodeList(original: nodes.ImportDeclaration[] | undefined): nodes.ImportDeclaration[] | undefined;
    visitNodeList(original: nodes.ImportDefaultSpecifier[] | undefined): nodes.ImportDefaultSpecifier[] | undefined;
    visitNodeList(original: nodes.ImportNamespaceSpecifier[] | undefined): nodes.ImportNamespaceSpecifier[] | undefined;
    visitNodeList(original: nodes.ImportSpecifier[] | undefined): nodes.ImportSpecifier[] | undefined;
    visitNodeList(original: nodes.ImportDeclarationSpecifier[] | undefined): nodes.ImportDeclarationSpecifier[] | undefined;
    visitNodeList(original: nodes.LabeledStatement[] | undefined): nodes.LabeledStatement[] | undefined;
    visitNodeList(original: nodes.Literal[] | undefined): nodes.Literal[] | undefined;
    visitNodeList(original: nodes.LogicalExpression[] | undefined): nodes.LogicalExpression[] | undefined;
    visitNodeList(original: nodes.MemberExpression[] | undefined): nodes.MemberExpression[] | undefined;
    visitNodeList(original: nodes.ChainElement[] | undefined): nodes.ChainElement[] | undefined;
    visitNodeList(original: nodes.MetaProperty[] | undefined): nodes.MetaProperty[] | undefined;
    visitNodeList(original: nodes.MethodDefinition[] | undefined): nodes.MethodDefinition[] | undefined;
    visitNodeList(original: nodes.Module[] | undefined): nodes.Module[] | undefined;
    visitNodeList(original: nodes.NewExpression[] | undefined): nodes.NewExpression[] | undefined;
    visitNodeList(original: nodes.ObjectExpression[] | undefined): nodes.ObjectExpression[] | undefined;
    visitNodeList(original: nodes.ObjectPattern[] | undefined): nodes.ObjectPattern[] | undefined;
    visitNodeList(original: nodes.BindingPattern[] | undefined): nodes.BindingPattern[] | undefined;
    visitNodeList(original: nodes.PrivateIdentifier[] | undefined): nodes.PrivateIdentifier[] | undefined;
    visitNodeList(original: nodes.Property[] | undefined): nodes.Property[] | undefined;
    visitNodeList(original: nodes.PropertyDefinition[] | undefined): nodes.PropertyDefinition[] | undefined;
    visitNodeList(original: nodes.RegexLiteral[] | undefined): nodes.RegexLiteral[] | undefined;
    visitNodeList(original: nodes.RestElement[] | undefined): nodes.RestElement[] | undefined;
    visitNodeList(original: nodes.ArrayPatternElement[] | undefined): nodes.ArrayPatternElement[] | undefined;
    visitNodeList(original: nodes.ObjectPatternProperty[] | undefined): nodes.ObjectPatternProperty[] | undefined;
    visitNodeList(original: nodes.ReturnStatement[] | undefined): nodes.ReturnStatement[] | undefined;
    visitNodeList(original: nodes.Script[] | undefined): nodes.Script[] | undefined;
    visitNodeList(original: nodes.Program[] | undefined): nodes.Program[] | undefined;
    visitNodeList(original: nodes.SequenceExpression[] | undefined): nodes.SequenceExpression[] | undefined;
    visitNodeList(original: nodes.SpreadElement[] | undefined): nodes.SpreadElement[] | undefined;
    visitNodeList(original: nodes.ObjectExpressionProperty[] | undefined): nodes.ObjectExpressionProperty[] | undefined;
    visitNodeList(original: nodes.StaticBlock[] | undefined): nodes.StaticBlock[] | undefined;
    visitNodeList(original: nodes.Super[] | undefined): nodes.Super[] | undefined;
    visitNodeList(original: nodes.SwitchCase[] | undefined): nodes.SwitchCase[] | undefined;
    visitNodeList(original: nodes.SwitchStatement[] | undefined): nodes.SwitchStatement[] | undefined;
    visitNodeList(original: nodes.TaggedTemplateExpression[] | undefined): nodes.TaggedTemplateExpression[] | undefined;
    visitNodeList(original: nodes.TemplateElement[] | undefined): nodes.TemplateElement[] | undefined;
    visitNodeList(original: nodes.TemplateLiteral[] | undefined): nodes.TemplateLiteral[] | undefined;
    visitNodeList(original: nodes.ThisExpression[] | undefined): nodes.ThisExpression[] | undefined;
    visitNodeList(original: nodes.ThrowStatement[] | undefined): nodes.ThrowStatement[] | undefined;
    visitNodeList(original: nodes.TryStatement[] | undefined): nodes.TryStatement[] | undefined;
    visitNodeList(original: nodes.UnaryExpression[] | undefined): nodes.UnaryExpression[] | undefined;
    visitNodeList(original: nodes.UpdateExpression[] | undefined): nodes.UpdateExpression[] | undefined;
    visitNodeList(original: nodes.VariableDeclaration[] | undefined): nodes.VariableDeclaration[] | undefined;
    visitNodeList(original: nodes.ExportableNamedDeclaration[] | undefined): nodes.ExportableNamedDeclaration[] | undefined;
    visitNodeList(original: nodes.Declaration[] | undefined): nodes.Declaration[] | undefined;
    visitNodeList(original: nodes.VariableDeclarator[] | undefined): nodes.VariableDeclarator[] | undefined;
    visitNodeList(original: nodes.WhileStatement[] | undefined): nodes.WhileStatement[] | undefined;
    visitNodeList(original: nodes.WithStatement[] | undefined): nodes.WithStatement[] | undefined;
    visitNodeList(original: nodes.Statement[] | undefined): nodes.Statement[] | undefined;
    visitNodeList(original: nodes.YieldExpression[] | undefined): nodes.YieldExpression[] | undefined;
    visitNodeList(original: nodes.PropertyKey[] | undefined): nodes.PropertyKey[] | undefined;
    visitNodeList(original: nodes.PropertyValue[] | undefined): nodes.PropertyValue[] | undefined;
    visitNodeList(original: nodes.ArgumentListElement[] | undefined): nodes.ArgumentListElement[] | undefined;
    visitNodeList(original: nodes.ArrayExpressionElement[] | undefined): nodes.ArrayExpressionElement[] | undefined;
    visitNodeList(original: nodes.ExportableDefaultDeclaration[] | undefined): nodes.ExportableDefaultDeclaration[] | undefined;
    visitNodeList(original: nodes.Pattern[] | undefined): nodes.Pattern[] | undefined;
    visitNodeList(original: nodes.FunctionParameter[] | undefined): nodes.FunctionParameter[] | undefined;
    visitNodeList(original: nodes.Node[] | undefined): nodes.Node[] | undefined;
    visitNodeList(original: nodes.Node[] | null | undefined): nodes.Node[] | null | undefined;
visitNodeList(original: nodes.Node[] | null | undefined): (nodes.Node | undefined)[] | null | undefined {
        if (original == null)
            return original;

        let list: (nodes.Node | undefined)[] | null = null;
        for (let i = 0, n = original.length; i < n; i++) {
            let p = this.visit(original[i]);
            if (list != null) {
                list.push(p);
            }
            else if (p != original[i]) {
                list = [];
                for (let j = 0; j < i; j++) {
                    list.push(original[j]);
                }
                list.push(p);
            }
        }
        if (list != null)
            return list;
        return original;
    }

    visitAssignmentExpression(node: nodes.AssignmentExpression): nodes.AssignmentExpression {
        const left = this.visit(node.left);
        const right = this.visit(node.right);
        if (left !== node.left || right !== node.right)
            return new nodes.AssignmentExpression(node.operator, left, right);
        return node;
    }

    visitAssignmentPattern(node: nodes.AssignmentPattern): nodes.AssignmentPattern {
        const left = this.visit(node.left);
        const right = this.visit(node.right);
        if (left !== node.left || right !== node.right)
            return new nodes.AssignmentPattern(left, right);
        return node;
    }

    visitArrayExpression(node: nodes.ArrayExpression): nodes.ArrayExpression {
        const elements = this.visitNodeList(node.elements);
        if (elements !== node.elements)
            return new nodes.ArrayExpression(elements);
        return node;
    }

    visitArrayPattern(node: nodes.ArrayPattern): nodes.ArrayPattern {
        const elements = this.visitNodeList(node.elements);
        if (elements !== node.elements)
            return new nodes.ArrayPattern(elements);
        return node;
    }

    visitArrowFunctionExpression(node: nodes.ArrowFunctionExpression): nodes.ArrowFunctionExpression {
        const id = this.visit(node.id);
        const params = this.visitNodeList(node.params);
        const body = this.visit(node.body);
        if (id !== node.id || params !== node.params || body !== node.body) {
            const ret = new nodes.ArrowFunctionExpression(params, body, node.expression, node.async);
            ret.id = id;
            return ret;
        }
        return node;
    }

    visitAwaitExpression(node: nodes.AwaitExpression): nodes.AwaitExpression {
        const argument = this.visit(node.argument);
        if (argument !== node.argument)
            return new nodes.AwaitExpression(argument);
        return node;
    }

    visitBlockStatement(node: nodes.BlockStatement): nodes.BlockStatement {
        const body = this.visitNodeList(node.body);
        if (body !== node.body)
            return new nodes.BlockStatement(body);
        return node;
    }

    visitBinaryExpression(node: nodes.BinaryExpression): nodes.BinaryExpression {
        const left = this.visit(node.left);
        const right = this.visit(node.right);
        if (left !== node.left || right !== node.right)
            return new nodes.BinaryExpression(node.operator, left, right);
        return node;
    }

    visitBreakStatement(node: nodes.BreakStatement): nodes.BreakStatement {
        const label = this.visit(node.label);
        if (label !== node.label)
            return new nodes.BreakStatement(label);
        return node;
    }

    visitCallExpression(node: nodes.CallExpression): nodes.CallExpression {
        const callee = this.visit(node.callee);
        const args = this.visitNodeList(node.arguments);
        if (callee !== node.callee || args !== node.arguments)
            return new nodes.CallExpression(callee, args, node.optional);
        return node;
    }

    visitCatchClause(node: nodes.CatchClause): nodes.CatchClause {
        const param = this.visit(node.param);
        const body = this.visit(node.body);
        if (param !== node.param || body !== node.body)
            return new nodes.CatchClause(param, body);
        return node;
    }

    visitChainExpression(node: nodes.ChainExpression): nodes.ChainExpression {
        const expression = this.visit(node.expression);
        if (expression !== node.expression)
            return new nodes.ChainExpression(expression);
        return node;
    }

    visitClassBody(node: nodes.ClassBody): nodes.ClassBody {
        const body = this.visitNodeList(node.body);
        if (body !== node.body)
            return new nodes.ClassBody(body);
        return node;
    }

    visitClassDeclaration(node: nodes.ClassDeclaration): nodes.ClassDeclaration {
        const id = this.visit(node.id);
        const superClass = this.visit(node.superClass);
        const body = this.visit(node.body);
        const decorators = this.visitNodeList(node.decorators);
        if (id !== node.id || superClass !== node.superClass || body !== node.body || decorators !== node.decorators)
            return new nodes.ClassDeclaration(id, superClass, body, decorators);
        return node;
    }

    visitClassExpression(node: nodes.ClassExpression): nodes.ClassExpression {
        const id = this.visit(node.id);
        const superClass = this.visit(node.superClass);
        const body = this.visit(node.body);
        const decorators = this.visitNodeList(node.decorators);
        if (id !== node.id || superClass !== node.superClass || body !== node.body || decorators !== node.decorators)
            return new nodes.ClassExpression(id, superClass, body, decorators);
        return node;
    }

    visitConditionalExpression(node: nodes.ConditionalExpression): nodes.ConditionalExpression {
        const test = this.visit(node.test);
        const consequent = this.visit(node.consequent);
        const alternate = this.visit(node.alternate);
        if (test !== node.test || consequent !== node.consequent || alternate !== node.alternate)
            return new nodes.ConditionalExpression(test, consequent, alternate);
        return node;
    }

    visitContinueStatement(node: nodes.ContinueStatement): nodes.ContinueStatement {
        const label = this.visit(node.label);
        if (label !== node.label)
            return new nodes.ContinueStatement(label);
        return node;
    }

    visitDecorator(node: nodes.Decorator): nodes.Decorator {
        const expression = this.visit(node.expression);
        if (expression !== node.expression)
            return new nodes.Decorator(expression);
        return node;
    }

    visitDoWhileStatement(node: nodes.DoWhileStatement): nodes.DoWhileStatement {
        const body = this.visit(node.body);
        const test = this.visit(node.test);
        if (body !== node.body || test !== node.test)
            return new nodes.DoWhileStatement(body, test);
        return node;
    }

    visitDebuggerStatement(node: nodes.DebuggerStatement): nodes.DebuggerStatement {
        return node;
    }

    visitEmptyStatement(node: nodes.EmptyStatement): nodes.EmptyStatement {
        return node;
    }

    visitExportAllDeclaration(node: nodes.ExportAllDeclaration): nodes.ExportAllDeclaration {
        const source = this.visit(node.source);
        const exported = this.visit(node.exported);
        const assertions = this.visitNodeList(node.assertions);
        if (source !== node.source || exported !== node.exported || assertions !== node.assertions)
            return new nodes.ExportAllDeclaration(source, exported, assertions);
        return node;
    }

    visitExportDefaultDeclaration(node: nodes.ExportDefaultDeclaration): nodes.ExportDefaultDeclaration {
        const declaration = this.visit(node.declaration);
        if (declaration !== node.declaration)
            return new nodes.ExportDefaultDeclaration(declaration);
        return node;
    }

    visitExportNamedDeclaration(node: nodes.ExportNamedDeclaration): nodes.ExportNamedDeclaration {
        const declaration = this.visit(node.declaration);
        const specifiers = this.visitNodeList(node.specifiers);
        const source = this.visit(node.source);
        const assertions = this.visitNodeList(node.assertions);
        if (declaration !== node.declaration || specifiers !== node.specifiers || source !== node.source || assertions !== node.assertions)
            return new nodes.ExportNamedDeclaration(declaration, specifiers, source, assertions);
        return node;
    }

    visitExportSpecifier(node: nodes.ExportSpecifier): nodes.ExportSpecifier {
        const exported = this.visit(node.exported);
        const local = this.visit(node.local);
        if (exported !== node.exported || local !== node.local)
            return new nodes.ExportSpecifier(exported, local);
        return node;
    }

    visitExpressionStatement(node: nodes.ExpressionStatement): nodes.ExpressionStatement {
        const expression = this.visit(node.expression);
        if (expression !== node.expression)
            return new nodes.ExpressionStatement(expression);
        return node;
    }

    visitForStatement(node: nodes.ForStatement): nodes.ForStatement {
        const init = this.visit(node.init);
        const test = this.visit(node.test);
        const update = this.visit(node.update);
        const body = this.visit(node.body);
        if (init !== node.init || test !== node.test || update !== node.update || body !== node.body)
            return new nodes.ForStatement(init, test, update, body);
        return node;
    }

    visitForOfStatement(node: nodes.ForOfStatement): nodes.ForOfStatement {
        const left = this.visit(node.left);
        const right = this.visit(node.right);
        const body = this.visit(node.body);
        if (left !== node.left || right !== node.right || body !== node.body)
            return new nodes.ForOfStatement(left, right, body, node.await);
        return node;
    }

    visitForInStatement(node: nodes.ForInStatement): nodes.ForInStatement {
        const left = this.visit(node.left);
        const right = this.visit(node.right);
        const body = this.visit(node.body);
        if (left !== node.left || right !== node.right || body !== node.body)
            return new nodes.ForInStatement(left, right, body);
        return node;
    }

    visitFunctionDeclaration(node: nodes.FunctionDeclaration): nodes.FunctionDeclaration {
        const id = this.visit(node.id);
        const params = this.visitNodeList(node.params);
        const body = this.visit(node.body);
        if (id !== node.id || params !== node.params || body !== node.body)
            return new nodes.FunctionDeclaration(id, params, body, node.generator);
        return node;
    }

    visitFunctionExpression(node: nodes.FunctionExpression): nodes.FunctionExpression {
        const id = this.visit(node.id);
        const params = this.visitNodeList(node.params);
        const body = this.visit(node.body);
        if (id !== node.id || params !== node.params || body !== node.body)
            return new nodes.FunctionExpression(id, params, body, node.generator, node.async);
        return node;
    }

    visitIdentifier(node: nodes.Identifier): nodes.Identifier {
        return node;
    }

    visitIfStatement(node: nodes.IfStatement): nodes.IfStatement {
        const test = this.visit(node.test);
        const consequent = this.visit(node.consequent);
        const alternate = this.visit(node.alternate);
        if (test !== node.test || consequent !== node.consequent || alternate !== node.alternate)
            return new nodes.IfStatement(test, consequent, alternate);
        return node;
    }

    visitImportAttribute(node: nodes.ImportAttribute): nodes.ImportAttribute {
        const key = this.visit(node.key);
        const value = this.visit(node.value);
        if (key !== node.key || value !== node.value)
            return new nodes.ImportAttribute(key, value);
        return node;
    }

    visitImportExpression(node: nodes.ImportExpression): nodes.ImportExpression {
        const source = this.visit(node.source);
        const attributes = this.visit(node.attributes);
        if (source !== node.source || attributes !== node.attributes)
            return new nodes.ImportExpression(source, attributes);
        return node;
    }

    visitImportDeclaration(node: nodes.ImportDeclaration): nodes.ImportDeclaration {
        const specifiers = this.visitNodeList(node.specifiers);
        const source = this.visit(node.source);
        const assertions = this.visitNodeList(node.assertions);
        if (specifiers !== node.specifiers || source !== node.source || assertions !== node.assertions)
            return new nodes.ImportDeclaration(specifiers, source, assertions);
        return node;
    }

    visitImportDefaultSpecifier(node: nodes.ImportDefaultSpecifier): nodes.ImportDefaultSpecifier {
        const local = this.visit(node.local);
        if (local !== node.local)
            return new nodes.ImportDefaultSpecifier(local);
        return node;
    }

    visitImportNamespaceSpecifier(node: nodes.ImportNamespaceSpecifier): nodes.ImportNamespaceSpecifier {
        const local = this.visit(node.local);
        if (local !== node.local)
            return new nodes.ImportNamespaceSpecifier(local);
        return node;
    }

    visitImportSpecifier(node: nodes.ImportSpecifier): nodes.ImportSpecifier {
        const local = this.visit(node.local);
        const imported = this.visit(node.imported);
        if (local !== node.local || imported !== node.imported)
            return new nodes.ImportSpecifier(local, imported);
        return node;
    }

    visitLiteral(node: nodes.Literal | nodes.RegexLiteral | nodes.BigIntLiteral): nodes.Literal | nodes.RegexLiteral | nodes.BigIntLiteral {
        return node;
    }

    visitLabeledStatement(node: nodes.LabeledStatement): nodes.LabeledStatement {
        const label = this.visit(node.label);
        const body = this.visit(node.body);
        if (label !== node.label || body !== node.body)
            return new nodes.LabeledStatement(label, body);
        return node;
    }

    visitLogicalExpression(node: nodes.LogicalExpression): nodes.LogicalExpression {
        const left = this.visit(node.left);
        const right = this.visit(node.right);
        if (left !== node.left || right !== node.right)
            return new nodes.LogicalExpression(node.operator, left, right);
        return node;
    }

    visitMemberExpression(node: nodes.MemberExpression): nodes.MemberExpression {
        const _object = this.visit(node.object);
        const property = this.visit(node.property);
        if (_object !== node.object || property !== node.property)
            return new nodes.MemberExpression(node.computed, _object, property, node.optional);
        return node;
    }

    visitMetaProperty(node: nodes.MetaProperty): nodes.MetaProperty {
        const meta = this.visit(node.meta);
        const property = this.visit(node.property);
        if (meta !== node.meta || property !== node.property)
            return new nodes.MetaProperty(meta, property);
        return node;
    }

    visitMethodDefinition(node: nodes.MethodDefinition): nodes.MethodDefinition {
        const key = this.visit(node.key);
        const value = this.visit(node.value);
        const decorators = this.visitNodeList(node.decorators);
        if (key !== node.key || value !== node.value || decorators !== node.decorators)
            return new nodes.MethodDefinition(key, node.computed, value, node.kind, node.static, decoratorList(decorators));
        return node;
    }

    visitNewExpression(node: nodes.NewExpression): nodes.NewExpression {
        const callee = this.visit(node.callee);
        const args = this.visitNodeList(node.arguments);
        if (callee !== node.callee || args !== node.arguments)
            return new nodes.NewExpression(callee, args);
        return node;
    }

    visitObjectExpression(node: nodes.ObjectExpression): nodes.ObjectExpression {
        const properties = this.visitNodeList(node.properties);
        if (properties !== node.properties)
            return new nodes.ObjectExpression(properties);
        return node;
    }

    visitObjectPattern(node: nodes.ObjectPattern): nodes.ObjectPattern {
        const properties = this.visitNodeList(node.properties);
        if (properties !== node.properties)
            return new nodes.ObjectPattern(properties);
        return node;
    }

    visitProgram(node: nodes.Program): nodes.Program {
        const body = this.visitNodeList(node.body);
        if (body !== node.body)
            return new nodes.Program(node.sourceType, body);
        return node;
    }

    visitProperty(node: nodes.Property | nodes.PropertyDefinition): nodes.Property | nodes.PropertyDefinition {
        const key = this.visit(node.key);
        const value = this.visit(node.value);
        const decorators = this.visitNodeList((node).decorators);
        if (key !== node.key || value !== node.value || decorators !== decorators) {
            if ('kind' in node)
                return new nodes.Property(node.kind, key, node.computed, value, node.method, node.shorthand);
            else
                return new nodes.PropertyDefinition(key, node.computed, value, node.static, decoratorList(decorators));
        }
        return node;
    }

    visitPrivateIdentifier(node: nodes.PrivateIdentifier): nodes.PrivateIdentifier {
        return node;
    }

    visitRestElement(node: nodes.RestElement): nodes.RestElement {
        const argument = this.visit(node.argument);
        if (argument !== node.argument)
            return new nodes.RestElement(argument);
        return node;
    }

    visitReturnStatement(node: nodes.ReturnStatement): nodes.ReturnStatement {
        const argument = this.visit(node.argument);
        if (argument !== node.argument)
            return new nodes.ReturnStatement(argument);
        return node;
    }

    visitSequenceExpression(node: nodes.SequenceExpression): nodes.SequenceExpression {
        const expressions = this.visitNodeList(node.expressions);
        if (expressions !== node.expressions)
            return new nodes.SequenceExpression(expressions);
        return node;
    }

    visitSpreadElement(node: nodes.SpreadElement): nodes.SpreadElement {
        const argument = this.visit(node.argument);
        if (argument !== node.argument)
            return new nodes.SpreadElement(argument);
        return node;
    }

    visitStaticBlock(node: nodes.StaticBlock): nodes.StaticBlock {
        const body = this.visitNodeList(node.body);
        if (body !== node.body)
            return new nodes.StaticBlock(body);
        return node;
    }

    visitSuper(node: nodes.Super): nodes.Super {
        return node;
    }

    visitSwitchCase(node: nodes.SwitchCase): nodes.SwitchCase {
        const test = this.visit(node.test);
        const consequent = this.visitNodeList(node.consequent);
        if (test !== node.test || consequent !== node.consequent)
            return new nodes.SwitchCase(test, consequent);
        return node;
    }

    visitSwitchStatement(node: nodes.SwitchStatement): nodes.SwitchStatement {
        const discriminant = this.visit(node.discriminant);
        const cases = this.visitNodeList(node.cases);
        if (discriminant !== node.discriminant || cases !== node.cases)
            return new nodes.SwitchStatement(discriminant, cases);
        return node;
    }

    visitTaggedTemplateExpression(node: nodes.TaggedTemplateExpression): nodes.TaggedTemplateExpression {
        const tag = this.visit(node.tag);
        const quasi = this.visit(node.quasi);
        if (tag !== node.tag || quasi !== node.quasi)
            return new nodes.TaggedTemplateExpression(tag, quasi);
        return node;
    }

    visitTemplateElement(node: nodes.TemplateElement): nodes.TemplateElement {
        return node;
    }

    visitTemplateLiteral(node: nodes.TemplateLiteral): nodes.TemplateLiteral {
        const quasis = this.visitNodeList(node.quasis);
        const expressions = this.visitNodeList(node.expressions);
        if (quasis !== node.quasis || expressions !== node.expressions)
            return new nodes.TemplateLiteral(quasis, expressions);
        return node;
    }

    visitThisExpression(node: nodes.ThisExpression): nodes.ThisExpression {
        return node;
    }

    visitThrowStatement(node: nodes.ThrowStatement): nodes.ThrowStatement {
        const argument = this.visit(node.argument);
        if (argument !== node.argument)
            return new nodes.ThrowStatement(argument);
        return node;
    }

    visitTryStatement(node: nodes.TryStatement): nodes.TryStatement {
        const block = this.visit(node.block);
        const handler = this.visit(node.handler);
        const finalizer = this.visit(node.finalizer);
        if (block !== node.block || handler !== node.handler || finalizer !== node.finalizer)
            return new nodes.TryStatement(block, handler, finalizer);
        return node;
    }

    visitUnaryExpression(node: nodes.UnaryExpression): nodes.UnaryExpression {
        const argument = this.visit(node.argument);
        if (argument !== node.argument)
            return new nodes.UnaryExpression(node.operator, argument);
        return node;
    }

    visitUpdateExpression(node: nodes.UpdateExpression): nodes.UpdateExpression {
        const argument = this.visit(node.argument);
        if (argument !== node.argument)
            return new nodes.UpdateExpression(node.operator, argument, node.prefix);
        return node;
    }

    visitVariableDeclaration(node: nodes.VariableDeclaration): nodes.VariableDeclaration {
        const declarations = this.visitNodeList(node.declarations);
        if (declarations !== node.declarations)
            return new nodes.VariableDeclaration(declarations, node.kind);
        return node;
    }

    visitVariableDeclarator(node: nodes.VariableDeclarator): nodes.VariableDeclarator {
        const id = this.visit(node.id);
        const init = this.visit(node.init);
        if (id !== node.id || init !== node.init)
            return new nodes.VariableDeclarator(id, init);
        return node;
    }

    visitWhileStatement(node: nodes.WhileStatement): nodes.WhileStatement {
        const test = this.visit(node.test);
        const body = this.visit(node.body);
        if (test !== node.test || body !== node.body)
            return new nodes.WhileStatement(test, body);
        return node;
    }

    visitWithStatement(node: nodes.WithStatement): nodes.WithStatement {
        const _object = this.visit(node.object);
        const body = this.visit(node.body);
        if (_object !== node.object || body !== node.body)
            return new nodes.WithStatement(_object, body);
        return node;
    }

    visitYieldExpression(node: nodes.YieldExpression): nodes.YieldExpression {
        const argument = this.visit(node.argument);
        if (argument !== node.argument)
            return new nodes.YieldExpression(argument, node.delegate);
        return node;
    }
}
function decoratorList(value: nodes.Node[] | null | undefined): nodes.Decorator[] | null {
 if (value === null) return value;
 if (Array.isArray(value) && value.every((item): item is nodes.Decorator => item !== null && item.type === Syntax.Decorator)) return value;
 throw new TypeError("Expected decorator list");
}
