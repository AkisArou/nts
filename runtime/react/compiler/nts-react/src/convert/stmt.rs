//! Statements, declarations and the module's imports and exports.

use nts_semantic_schema::NodeId;
use react_compiler_ast::common::RawNode;
use react_compiler_ast::declarations::{
    Declaration, ExportAllDeclaration, ExportDefaultDecl, ExportDefaultDeclaration, ExportKind, ExportNamedDeclaration,
    ExportSpecifier, ExportSpecifierData, ImportDeclaration, ImportDefaultSpecifierData, ImportKind,
    ImportNamespaceSpecifierData, ImportSpecifier, ImportSpecifierData, ModuleExportName, TSDeclareFunction,
    TSEnumDeclaration, TSInterfaceDeclaration, TSModuleDeclaration, TSTypeAliasDeclaration,
};
use react_compiler_ast::expressions::{ClassBody, Expression};
use react_compiler_ast::literals::StringLiteral;
use react_compiler_ast::statements::{
    BlockStatement, BreakStatement, CatchClause, ClassDeclaration, ContinueStatement, DebuggerStatement, Directive,
    DirectiveLiteral, DoWhileStatement, EmptyStatement, ExpressionStatement, ForInOfLeft, ForInStatement, ForInit,
    ForOfStatement, ForStatement, FunctionDeclaration, IfStatement, LabeledStatement, ReturnStatement, Statement,
    SwitchCase, SwitchStatement, ThrowStatement, TryStatement, UnknownStatement, VariableDeclaration,
    VariableDeclarationKind, VariableDeclarator, WhileStatement,
};
use serde_json::Value;

use super::{Converted, Converter, k};

/// tsgo's `NodeFlags` for a declaration list's keyword.
const FLAG_LET: u32 = 1 << 0;
const FLAG_CONST: u32 = 1 << 1;
const FLAG_USING: u32 = 1 << 2;

impl Converter<'_> {
    /// A statement list, with a leading run of string-literal expression
    /// statements split off as directives, as Babel does for a program or a
    /// function body. `'use no memo'` is one, and the compiler reads it there.
    pub(super) fn statements_with_directives(&self, ids: &[NodeId]) -> Converted<(Vec<Statement>, Vec<Directive>)> {
        let mut directives = Vec::new();
        let mut rest = ids;
        while let Some((&first, tail)) = rest.split_first() {
            let Some(directive) = self.directive(first) else { break };
            directives.push(directive);
            rest = tail;
        }
        let body = rest.iter().map(|id| self.statement(*id)).collect::<Converted<_>>()?;
        Ok((body, directives))
    }

    fn directive(&self, id: NodeId) -> Option<Directive> {
        if self.kind(id) != k::EXPRESSION_STATEMENT {
            return None;
        }
        let literal = self.child(id, "expression")?;
        if self.kind(literal) != k::STRING_LITERAL {
            return None;
        }
        let (start, end) = (self.start(literal), self.end(literal));
        Some(Directive {
            base: self.base(id),
            value: DirectiveLiteral {
                base: self.base_span(literal, start, end),
                // Babel keeps a directive's text as written, between its quotes.
                value: self.text.slice(start + 1, end.saturating_sub(1)),
            },
        })
    }

    pub(super) fn block(&self, id: NodeId) -> Converted<BlockStatement> {
        let body = self.list(id, "statements").into_iter().map(|s| self.statement(s)).collect::<Converted<_>>()?;
        Ok(BlockStatement { base: self.base(id), body, directives: Vec::new() })
    }

    /// A function body: a block whose leading string literals are directives.
    pub(super) fn function_body(&self, id: NodeId) -> Converted<BlockStatement> {
        let (body, directives) = self.statements_with_directives(&self.list(id, "statements"))?;
        Ok(BlockStatement { base: self.base(id), body, directives })
    }

    fn boxed_statement(&self, id: NodeId) -> Converted<Box<Statement>> {
        self.statement(id).map(Box::new)
    }

    #[allow(clippy::too_many_lines)]
    pub(super) fn statement(&self, id: NodeId) -> Converted<Statement> {
        let base = self.base(id);
        Ok(match self.kind(id) {
            k::BLOCK => Statement::BlockStatement(self.block(id)?),
            k::EMPTY_STATEMENT => Statement::EmptyStatement(EmptyStatement { base }),
            k::DEBUGGER_STATEMENT => Statement::DebuggerStatement(DebuggerStatement { base }),
            k::EXPRESSION_STATEMENT => Statement::ExpressionStatement(ExpressionStatement {
                base,
                expression: Box::new(self.expression(self.need(id, "expression")?)?),
            }),
            k::RETURN_STATEMENT => Statement::ReturnStatement(ReturnStatement {
                base,
                argument: self.child(id, "expression").map(|e| self.expression(e).map(Box::new)).transpose()?,
            }),
            k::THROW_STATEMENT => Statement::ThrowStatement(ThrowStatement {
                base,
                argument: Box::new(self.expression(self.need(id, "expression")?)?),
            }),
            k::IF_STATEMENT => Statement::IfStatement(IfStatement {
                base,
                test: Box::new(self.expression(self.need(id, "expression")?)?),
                consequent: self.boxed_statement(self.need(id, "thenStatement")?)?,
                alternate: self.child(id, "elseStatement").map(|s| self.boxed_statement(s)).transpose()?,
            }),
            k::WHILE_STATEMENT => Statement::WhileStatement(WhileStatement {
                base,
                test: Box::new(self.expression(self.need(id, "expression")?)?),
                body: self.boxed_statement(self.need(id, "statement")?)?,
            }),
            k::DO_STATEMENT => Statement::DoWhileStatement(DoWhileStatement {
                base,
                test: Box::new(self.expression(self.need(id, "expression")?)?),
                body: self.boxed_statement(self.need(id, "statement")?)?,
            }),
            k::FOR_STATEMENT => Statement::ForStatement(ForStatement {
                base,
                init: self
                    .child(id, "initializer")
                    .map(|init| {
                        Converted::Ok(Box::new(if self.kind(init) == k::VARIABLE_DECLARATION_LIST {
                            ForInit::VariableDeclaration(self.variable_declaration(init, self.start(init), self.end(init))?)
                        } else {
                            ForInit::Expression(Box::new(self.expression(init)?))
                        }))
                    })
                    .transpose()?,
                test: self.child(id, "condition").map(|e| self.expression(e).map(Box::new)).transpose()?,
                update: self.child(id, "incrementor").map(|e| self.expression(e).map(Box::new)).transpose()?,
                body: self.boxed_statement(self.need(id, "statement")?)?,
            }),
            k::FOR_OF_STATEMENT => Statement::ForOfStatement(ForOfStatement {
                base,
                left: Box::new(self.for_left(self.need(id, "initializer")?)?),
                right: Box::new(self.expression(self.need(id, "expression")?)?),
                body: self.boxed_statement(self.need(id, "statement")?)?,
                is_await: self.child(id, "awaitModifier").is_some(),
            }),
            k::FOR_IN_STATEMENT => Statement::ForInStatement(ForInStatement {
                base,
                left: Box::new(self.for_left(self.need(id, "initializer")?)?),
                right: Box::new(self.expression(self.need(id, "expression")?)?),
                body: self.boxed_statement(self.need(id, "statement")?)?,
            }),
            k::BREAK_STATEMENT => {
                Statement::BreakStatement(BreakStatement { base, label: self.child(id, "label").map(|l| self.identifier(l)) })
            }
            k::CONTINUE_STATEMENT => {
                Statement::ContinueStatement(ContinueStatement { base, label: self.child(id, "label").map(|l| self.identifier(l)) })
            }
            k::LABELED_STATEMENT => Statement::LabeledStatement(LabeledStatement {
                base,
                label: self.identifier(self.need(id, "label")?),
                body: self.boxed_statement(self.need(id, "statement")?)?,
            }),
            k::SWITCH_STATEMENT => Statement::SwitchStatement(self.switch(id)?),
            k::TRY_STATEMENT => Statement::TryStatement(self.try_statement(id)?),
            k::VARIABLE_STATEMENT => self.exported(id, |start| {
                let list = self.need(id, "declarationList")?;
                let mut declaration = self.variable_declaration(list, start, self.end(id))?;
                declaration.declare = self.has_modifier(id, k::DECLARE_KEYWORD).then_some(true);
                Ok(Declaration::VariableDeclaration(declaration))
            })?,
            k::FUNCTION_DECLARATION => self.exported(id, |start| self.function_declaration(id, start))?,
            k::CLASS_DECLARATION => self.exported(id, |start| Ok(Declaration::ClassDeclaration(self.class_declaration(id, start)?)))?,
            k::TYPE_ALIAS_DECLARATION => self.exported(id, |start| {
                Ok(Declaration::TSTypeAliasDeclaration(TSTypeAliasDeclaration {
                    base: self.base_span(id, start, self.end(id)),
                    id: self.identifier(self.need(id, "name")?),
                    type_annotation: self.type_node(self.need(id, "type")?),
                    type_parameters: self.type_parameters(id),
                    declare: self.has_modifier(id, k::DECLARE_KEYWORD).then_some(true),
                }))
            })?,
            k::INTERFACE_DECLARATION => self.exported(id, |start| {
                Ok(Declaration::TSInterfaceDeclaration(TSInterfaceDeclaration {
                    base: self.base_span(id, start, self.end(id)),
                    id: self.identifier(self.need(id, "name")?),
                    body: self.raw_span("TSInterfaceBody", id, self.token_at(self.end(self.need(id, "name")?), "{").unwrap_or(start), self.end(id)),
                    type_parameters: self.type_parameters(id),
                    extends: None,
                    declare: self.has_modifier(id, k::DECLARE_KEYWORD).then_some(true),
                }))
            })?,
            k::ENUM_DECLARATION => self.exported(id, |start| {
                Ok(Declaration::TSEnumDeclaration(TSEnumDeclaration {
                    base: self.base_span(id, start, self.end(id)),
                    id: self.identifier(self.need(id, "name")?),
                    members: self.list(id, "members").into_iter().map(|m| self.raw("TSEnumMember", m)).collect(),
                    declare: self.has_modifier(id, k::DECLARE_KEYWORD).then_some(true),
                    is_const: self.has_modifier(id, k::CONST_KEYWORD).then_some(true),
                }))
            })?,
            k::MODULE_DECLARATION => self.exported(id, |start| {
                Ok(Declaration::TSModuleDeclaration(TSModuleDeclaration {
                    base: self.base_span(id, start, self.end(id)),
                    id: self.raw("Identifier", self.need(id, "name")?),
                    body: self.child(id, "body").map_or_else(RawNode::null, |b| self.raw("TSModuleBlock", b)),
                    declare: self.has_modifier(id, k::DECLARE_KEYWORD).then_some(true),
                    global: None,
                }))
            })?,
            k::IMPORT_DECLARATION => Statement::ImportDeclaration(self.import(id)?),
            k::EXPORT_DECLARATION => self.export_declaration(id)?,
            k::EXPORT_ASSIGNMENT => self.export_assignment(id)?,
            // `import x = require(…)`, `export as namespace …`: statements the
            // compiler does not model, passed through as they are.
            k::IMPORT_EQUALS_DECLARATION | k::NAMESPACE_EXPORT_DECLARATION => self.unknown_statement(id)?,
            _ => return Err(self.unsupported(id, "a statement this converter does not know")),
        })
    }

    fn unknown_statement(&self, id: NodeId) -> Converted<Statement> {
        let raw = if self.kind(id) == k::IMPORT_EQUALS_DECLARATION {
            // `import lib = require(…)` binds `lib`, which the scope builder
            // reads from here: the one name inside a pass-through statement
            // that code can use as a value.
            self.raw_with_name("TSImportEqualsDeclaration", id, self.need(id, "name")?)
        } else {
            self.raw("TSNamespaceExportDeclaration", id)
        };
        UnknownStatement::from_raw(raw).map(Statement::Unknown).map_err(|why| self.unsupported(id, &why))
    }

    /// A declaration, wrapped as Babel wraps it when it carries `export` (and
    /// `default`). Babel's declaration then starts after those keywords.
    fn exported(&self, id: NodeId, declaration: impl FnOnce(u32) -> Converted<Declaration>) -> Converted<Statement> {
        let modifiers = self.list(id, "modifiers");
        let exported = modifiers.iter().any(|m| self.kind(*m) == k::EXPORT_KEYWORD);
        let is_default = modifiers.iter().any(|m| self.kind(*m) == k::DEFAULT_KEYWORD);
        let inner_start = if exported {
            // The first modifier that stays on the declaration (`async`,
            // `declare`), or the token after the last export keyword.
            modifiers
                .iter()
                .find(|m| !matches!(self.kind(**m), k::EXPORT_KEYWORD | k::DEFAULT_KEYWORD))
                .map_or_else(
                    || {
                        let last = modifiers.iter().rev().find(|m| matches!(self.kind(**m), k::EXPORT_KEYWORD | k::DEFAULT_KEYWORD));
                        last.map_or_else(|| self.start(id), |m| self.text.token_start(self.end(*m)))
                    },
                    |m| self.start(*m),
                )
        } else {
            self.start(id)
        };
        let declaration = declaration(inner_start)?;
        if !exported {
            return Ok(declaration_statement(declaration));
        }
        // The declaration keeps the tsgo node's id; the export around it is a
        // second Babel node made from the same tsgo node.
        let mut base = self.base(id);
        base.node_id = Some(id.0 | super::expr::SECOND_NODE);
        if is_default {
            let declaration = match declaration {
                Declaration::FunctionDeclaration(f) => ExportDefaultDecl::FunctionDeclaration(f),
                Declaration::ClassDeclaration(c) => ExportDefaultDecl::ClassDeclaration(c),
                _ => return Err(self.unsupported(id, "an `export default` of this declaration")),
            };
            return Ok(Statement::ExportDefaultDeclaration(ExportDefaultDeclaration {
                base,
                declaration: Box::new(declaration),
                export_kind: Some(ExportKind::Value),
            }));
        }
        let type_only = matches!(
            declaration,
            Declaration::TSTypeAliasDeclaration(_) | Declaration::TSInterfaceDeclaration(_)
        );
        Ok(Statement::ExportNamedDeclaration(ExportNamedDeclaration {
            base,
            declaration: Some(Box::new(declaration)),
            specifiers: Vec::new(),
            source: None,
            export_kind: Some(if type_only { ExportKind::Type } else { ExportKind::Value }),
            assertions: None,
            attributes: None,
        }))
    }

    /// A `VariableDeclarationList`, as the Babel `VariableDeclaration` spanning
    /// `start..end` (the statement's span when there is one).
    pub(super) fn variable_declaration(&self, list: NodeId, start: u32, end: u32) -> Converted<VariableDeclaration> {
        let flags = self.flags(list);
        let kind = if flags & (FLAG_CONST | FLAG_USING) == (FLAG_CONST | FLAG_USING) {
            VariableDeclarationKind::AwaitUsing
        } else if flags & FLAG_USING != 0 {
            VariableDeclarationKind::Using
        } else if flags & FLAG_CONST != 0 {
            VariableDeclarationKind::Const
        } else if flags & FLAG_LET != 0 {
            VariableDeclarationKind::Let
        } else {
            VariableDeclarationKind::Var
        };
        let declarations = self
            .list(list, "declarations")
            .into_iter()
            .map(|declarator| {
                let name = self.need(declarator, "name")?;
                let annotation = self.child(declarator, "type");
                let definite = self.child(declarator, "exclamationToken").is_some();
                Ok(VariableDeclarator {
                    base: self.base(declarator),
                    id: self.binding_target(name, annotation)?,
                    init: self.child(declarator, "initializer").map(|e| self.expression(e).map(Box::new)).transpose()?,
                    definite: definite.then_some(true),
                })
            })
            .collect::<Converted<_>>()?;
        Ok(VariableDeclaration { base: self.base_span(list, start, end), declarations, kind, declare: None })
    }

    /// The left of a `for…of` or `for…in`: a declaration or an assignment target.
    fn for_left(&self, id: NodeId) -> Converted<ForInOfLeft> {
        if self.kind(id) == k::VARIABLE_DECLARATION_LIST {
            Ok(ForInOfLeft::VariableDeclaration(self.variable_declaration(id, self.start(id), self.end(id))?))
        } else {
            Ok(ForInOfLeft::Pattern(Box::new(self.assignment_target(id)?)))
        }
    }

    fn switch(&self, id: NodeId) -> Converted<SwitchStatement> {
        let block = self.need(id, "caseBlock")?;
        let cases = self
            .list(block, "clauses")
            .into_iter()
            .map(|clause| {
                Ok(SwitchCase {
                    base: self.base(clause),
                    test: if self.kind(clause) == k::CASE_CLAUSE {
                        Some(Box::new(self.expression(self.need(clause, "expression")?)?))
                    } else {
                        None
                    },
                    consequent: self.list(clause, "statements").into_iter().map(|s| self.statement(s)).collect::<Converted<_>>()?,
                })
            })
            .collect::<Converted<_>>()?;
        Ok(SwitchStatement { base: self.base(id), discriminant: Box::new(self.expression(self.need(id, "expression")?)?), cases })
    }

    fn try_statement(&self, id: NodeId) -> Converted<TryStatement> {
        let handler = self
            .child(id, "catchClause")
            .map(|clause| {
                let param = self
                    .child(clause, "variableDeclaration")
                    .map(|declaration| self.binding_target(self.need(declaration, "name")?, self.child(declaration, "type")))
                    .transpose()?;
                Ok(CatchClause { base: self.base(clause), param, body: self.block(self.need(clause, "block")?)? })
            })
            .transpose()?;
        Ok(TryStatement {
            base: self.base(id),
            block: self.block(self.need(id, "tryBlock")?)?,
            handler,
            finalizer: self.child(id, "finallyBlock").map(|b| self.block(b)).transpose()?,
        })
    }

    fn function_declaration(&self, id: NodeId, start: u32) -> Converted<Declaration> {
        let base = self.base_span(id, start, self.end(id));
        let name = self.child(id, "name").map(|n| self.identifier(n));
        let parts = self.function_parts(id)?;
        let Some(body) = self.child(id, "body") else {
            // An overload signature.
            return Ok(Declaration::TSDeclareFunction(TSDeclareFunction {
                base,
                id: name,
                params: self.list(id, "parameters").into_iter().map(|p| self.raw("Identifier", p)).collect(),
                is_async: Some(parts.is_async),
                declare: self.has_modifier(id, k::DECLARE_KEYWORD).then_some(true),
                generator: Some(parts.generator),
                return_type: parts.return_type,
                type_parameters: parts.type_parameters,
            }));
        };
        Ok(Declaration::FunctionDeclaration(FunctionDeclaration {
            base,
            id: name,
            params: parts.params,
            body: self.function_body(body)?,
            generator: parts.generator,
            is_async: parts.is_async,
            declare: None,
            return_type: parts.return_type,
            type_parameters: parts.type_parameters,
            predicate: None,
            component_declaration: false,
            hook_declaration: false,
        }))
    }

    pub(super) fn class_declaration(&self, id: NodeId, start: u32) -> Converted<ClassDeclaration> {
        Ok(ClassDeclaration {
            base: self.base_span(id, start, self.end(id)),
            id: self.child(id, "name").map(|n| self.identifier(n)),
            super_class: self.super_class(id)?,
            body: self.class_body(id)?,
            decorators: None,
            is_abstract: self.has_modifier(id, k::ABSTRACT_KEYWORD).then_some(true),
            declare: self.has_modifier(id, k::DECLARE_KEYWORD).then_some(true),
            implements: None,
            super_type_parameters: self.super_type_arguments(id),
            type_parameters: self.type_parameters(id),
            mixins: None,
        })
    }

    /// The type after `extends` -- `Base<T>` -- if the class has one.
    fn extends_type(&self, id: NodeId) -> Option<NodeId> {
        // `small` is 0 for `extends`, 1 for `implements`.
        self.list(id, "heritageClauses")
            .into_iter()
            .find(|clause| self.small(*clause) == 0)
            .and_then(|clause| self.list(clause, "types").first().copied())
    }

    /// The expression after `extends`, if the class has one.
    pub(super) fn super_class(&self, id: NodeId) -> Converted<Option<Box<Expression>>> {
        self.extends_type(id).map(|base| Ok(Box::new(self.expression(self.need(base, "expression")?)?))).transpose()
    }

    /// The type arguments after `extends` -- the `<T>` of `Base<T>`.
    pub(super) fn super_type_arguments(&self, id: NodeId) -> Option<RawNode> {
        self.extends_type(id).and_then(|base| self.type_arguments(base))
    }

    /// A class body. The compiler reads class members only as JSON, and only
    /// to find identifiers a method captures, which matters for a class inside
    /// a function it compiles. That is refused here rather than half-described;
    /// a class at module scope is never compiled.
    ///
    /// Each member carries, under `jsx`, the JSX elements and fragments in it
    /// (the outermost ones), converted: the output printer copies a member as
    /// its text, and lowers the JSX in it from these. It also carries what
    /// the printer needs to describe a class component (`print::class`):
    /// its kind, name and staticness.
    pub(super) fn class_body(&self, id: NodeId) -> Converted<ClassBody> {
        let members = self.list(id, "members");
        // The body starts at its `{`: before the first member, or, with none,
        // just before the closing `}`.
        let before = members.first().map_or_else(|| self.end(id).saturating_sub(1), |m| self.start(*m));
        let start = self.token_before(before, '{').unwrap_or_else(|| self.start(id));
        if self.inside_function(id) {
            return Err(self.unsupported(id, "a class inside a function"));
        }
        let mut base = self.base_span(id, start, self.end(id));
        base.node_id = None;
        let body = members
            .into_iter()
            .map(|member| {
                let mut jsx = Vec::new();
                self.outermost_jsx(member, &mut jsx)?;
                let mut raw = self.raw("ClassMember", member).parse_value();
                if let Value::Object(map) = &mut raw {
                    self.describe_member(member, map);
                    if !jsx.is_empty() {
                        map.insert("jsx".to_owned(), serde_json::to_value(jsx).unwrap_or(Value::Null));
                    }
                }
                Ok(RawNode::from_value(&raw))
            })
            .collect::<Converted<Vec<_>>>()?;
        Ok(ClassBody { base, body })
    }

    /// A class member's kind (`method`, `property`, `accessor`, `constructor`
    /// or `other`), its name when it is written as an identifier or a
    /// string, whether it is static, whether a property holds a function,
    /// and how many parameters a constructor takes.
    fn describe_member(&self, member: NodeId, into: &mut serde_json::Map<String, Value>) {
        let kind = match self.kind(member) {
            k::METHOD_DECLARATION => "method",
            k::PROPERTY_DECLARATION => "property",
            k::GET_ACCESSOR | k::SET_ACCESSOR => "accessor",
            k::CONSTRUCTOR => "constructor",
            _ => "other",
        };
        into.insert("memberKind".to_owned(), Value::from(kind));
        if let Some(name) = self.child(member, "name").filter(|n| matches!(self.kind(*n), k::IDENTIFIER | k::STRING_LITERAL)) {
            into.insert("name".to_owned(), Value::from(self.text_of(name)));
        }
        into.insert("static".to_owned(), Value::from(self.has_modifier(member, k::STATIC_KEYWORD)));
        if kind == "property" {
            let function = self.child(member, "initializer").is_some_and(|i| matches!(self.kind(i), k::ARROW_FUNCTION | k::FUNCTION_EXPRESSION));
            into.insert("functionValued".to_owned(), Value::from(function));
        }
        if kind == "constructor" {
            into.insert("parameters".to_owned(), Value::from(self.list(member, "parameters").len()));
        }
    }

    /// The JSX elements and fragments under `id` that no other one contains.
    fn outermost_jsx(&self, id: NodeId, into: &mut Vec<Expression>) -> Converted<()> {
        for &child in &self.record(id).children {
            if matches!(self.nodes.kind(child), Some(k::JSX_ELEMENT | k::JSX_SELF_CLOSING_ELEMENT | k::JSX_FRAGMENT)) {
                into.push(self.expression(child)?);
            } else {
                self.outermost_jsx(child, into)?;
            }
        }
        Ok(())
    }

    fn inside_function(&self, id: NodeId) -> bool {
        let mut at = self.record(id).parent;
        while let Some(parent) = at {
            if matches!(
                self.nodes.kind(parent),
                Some(
                    k::FUNCTION_DECLARATION
                        | k::FUNCTION_EXPRESSION
                        | k::ARROW_FUNCTION
                        | k::METHOD_DECLARATION
                        | k::CONSTRUCTOR
                        | k::GET_ACCESSOR
                        | k::SET_ACCESSOR
                )
            ) {
                return true;
            }
            at = self.record(parent).parent;
        }
        false
    }

    // ---- modules ---------------------------------------------------------

    fn string_literal(&self, id: NodeId) -> StringLiteral {
        StringLiteral { base: self.base(id), value: self.string_value(id) }
    }

    fn module_export_name(&self, id: NodeId) -> ModuleExportName {
        if self.kind(id) == k::STRING_LITERAL {
            ModuleExportName::StringLiteral(self.string_literal(id))
        } else {
            ModuleExportName::Identifier(self.identifier(id))
        }
    }

    fn import(&self, id: NodeId) -> Converted<ImportDeclaration> {
        let source = self.string_literal(self.need(id, "moduleSpecifier")?);
        let mut specifiers = Vec::new();
        let mut type_only = false;
        if let Some(clause) = self.child(id, "importClause") {
            // `small` is 1 for `import type`, 2 for `import defer`.
            type_only = self.small(clause) == 1;
            if let Some(default) = self.child(clause, "name") {
                specifiers.push(ImportSpecifier::ImportDefaultSpecifier(ImportDefaultSpecifierData {
                    base: self.base(default),
                    local: self.identifier(default),
                }));
            }
            if let Some(bindings) = self.child(clause, "namedBindings") {
                if self.kind(bindings) == k::NAMESPACE_IMPORT {
                    specifiers.push(ImportSpecifier::ImportNamespaceSpecifier(ImportNamespaceSpecifierData {
                        base: self.base(bindings),
                        local: self.identifier(self.need(bindings, "name")?),
                    }));
                } else {
                    for element in self.list(bindings, "elements") {
                        let local = self.identifier(self.need(element, "name")?);
                        let imported =
                            self.child(element, "propertyName").map_or_else(|| ModuleExportName::Identifier(local.clone()), |p| self.module_export_name(p));
                        specifiers.push(ImportSpecifier::ImportSpecifier(ImportSpecifierData {
                            base: self.base(element),
                            local,
                            imported,
                            import_kind: Some(if self.small(element) == 1 { ImportKind::Type } else { ImportKind::Value }),
                        }));
                    }
                }
            }
        }
        Ok(ImportDeclaration {
            base: self.base(id),
            specifiers,
            source,
            import_kind: Some(if type_only { ImportKind::Type } else { ImportKind::Value }),
            assertions: None,
            attributes: None,
        })
    }

    /// `export { a, b as c }`, `export { a } from "m"`, `export * from "m"`.
    fn export_declaration(&self, id: NodeId) -> Converted<Statement> {
        let base = self.base(id);
        let type_only = self.small(id) == 1;
        let export_kind = Some(if type_only { ExportKind::Type } else { ExportKind::Value });
        let source = self.child(id, "moduleSpecifier").map(|s| self.string_literal(s));
        let Some(clause) = self.child(id, "exportClause") else {
            let source = source.ok_or_else(|| self.unsupported(id, "an `export *` without a module"))?;
            return Ok(Statement::ExportAllDeclaration(ExportAllDeclaration { base, source, export_kind, assertions: None, attributes: None }));
        };
        if self.kind(clause) == k::NAMESPACE_EXPORT {
            return Err(self.unsupported(id, "an `export * as name`"));
        }
        let specifiers = self
            .list(clause, "elements")
            .into_iter()
            .map(|element| {
                let exported = self.module_export_name(self.need(element, "name")?);
                let local = self.child(element, "propertyName").map_or_else(|| exported.clone(), |p| self.module_export_name(p));
                Ok(ExportSpecifier::ExportSpecifier(ExportSpecifierData {
                    base: self.base(element),
                    local,
                    exported,
                    export_kind: Some(if self.small(element) == 1 { ExportKind::Type } else { ExportKind::Value }),
                }))
            })
            .collect::<Converted<_>>()?;
        Ok(Statement::ExportNamedDeclaration(ExportNamedDeclaration {
            base,
            declaration: None,
            specifiers,
            source,
            export_kind,
            assertions: None,
            attributes: None,
        }))
    }

    /// `export default <expression>`; `export = …` is not modelled.
    fn export_assignment(&self, id: NodeId) -> Converted<Statement> {
        if self.small(id) == 1 {
            return UnknownStatement::from_raw(self.raw("TSExportAssignment", id))
                .map(Statement::Unknown)
                .map_err(|why| self.unsupported(id, &why));
        }
        Ok(Statement::ExportDefaultDeclaration(ExportDefaultDeclaration {
            base: self.base(id),
            declaration: Box::new(ExportDefaultDecl::Expression(Box::new(self.expression(self.need(id, "expression")?)?))),
            export_kind: Some(ExportKind::Value),
        }))
    }
}

fn declaration_statement(declaration: Declaration) -> Statement {
    match declaration {
        Declaration::FunctionDeclaration(d) => Statement::FunctionDeclaration(d),
        Declaration::ClassDeclaration(d) => Statement::ClassDeclaration(d),
        Declaration::VariableDeclaration(d) => Statement::VariableDeclaration(d),
        Declaration::TSTypeAliasDeclaration(d) => Statement::TSTypeAliasDeclaration(d),
        Declaration::TSInterfaceDeclaration(d) => Statement::TSInterfaceDeclaration(d),
        Declaration::TSEnumDeclaration(d) => Statement::TSEnumDeclaration(d),
        Declaration::TSModuleDeclaration(d) => Statement::TSModuleDeclaration(d),
        Declaration::TSDeclareFunction(d) => Statement::TSDeclareFunction(d),
        Declaration::TypeAlias(d) => Statement::TypeAlias(d),
        Declaration::OpaqueType(d) => Statement::OpaqueType(d),
        Declaration::InterfaceDeclaration(d) => Statement::InterfaceDeclaration(d),
        Declaration::EnumDeclaration(d) => Statement::EnumDeclaration(d),
    }
}
