//! The compiler's `ScopeInfo` for a converted file, built as upstream's Babel
//! plugin builds it from Babel's scope crawl (`scope.ts`).
//!
//! Two walks over the converted tree share one scope stack:
//!   1. **declare** creates the scopes Babel's `isScope` would, in traversal
//!      order, and registers each binding in the scope Babel puts it in (`var`
//!      in the function, `let` in the block, a function expression's name in
//!      the function itself);
//!   2. **resolve** maps every identifier in a reference position -- a use, an
//!      assignment target, a declaration's own name -- to the binding its name
//!      resolves to, looking outward from the scope it sits in.
//!
//! The oracle is study/scope-diff.cjs, which compares this against
//! `scope.ts`'s output node for node.

use indexmap::IndexMap;
use react_compiler_ast::File;
use react_compiler_ast::declarations::{
    Declaration, ExportDefaultDecl, ExportSpecifier, ImportKind, ImportSpecifier, ModuleExportName,
};
use react_compiler_ast::expressions::{
    ArrowFunctionBody, ClassBody, Expression, FunctionExpression, Identifier, ObjectExpressionProperty,
};
use react_compiler_ast::jsx::{
    JSXAttributeItem, JSXAttributeValue, JSXChild, JSXElement, JSXElementName, JSXExpressionContainerExpr,
    JSXMemberExprObject, JSXMemberExpression,
};
use react_compiler_ast::patterns::{ObjectPatternProperty, PatternLike};
use react_compiler_ast::scope::{
    BindingData, BindingId, BindingKind, ImportBindingData, ImportBindingKind, ScopeData, ScopeId, ScopeInfo, ScopeKind,
};
use react_compiler_ast::statements::{
    BlockStatement, ClassDeclaration, ForInOfLeft, ForInit, FunctionDeclaration, Statement, VariableDeclaration,
    VariableDeclarationKind,
};
use rustc_hash::{FxBuildHasher, FxHashMap};

/// Builds the scope information for `file`.
#[must_use]
pub fn build(file: &File) -> ScopeInfo {
    let mut builder = Builder { pass: Pass::Declare, ..Builder::default() };
    builder.program(file);
    builder.group_bindings_by_scope();
    builder.pass = Pass::Resolve;
    builder.program(file);
    ScopeInfo {
        scopes: builder.scopes,
        bindings: builder.bindings,
        node_to_scope: builder.node_to_scope,
        node_to_scope_end: builder.node_to_scope_end,
        reference_to_binding: IndexMap::default(),
        ref_node_id_to_binding: builder.references,
        node_id_to_scope: builder.node_id_to_scope,
        program_scope: ScopeId(0),
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum Pass {
    #[default]
    Declare,
    Resolve,
}

#[derive(Debug, Default)]
struct Builder {
    pass: Pass,
    scopes: Vec<ScopeData>,
    bindings: Vec<BindingData>,
    node_to_scope: FxHashMap<u32, ScopeId>,
    node_to_scope_end: FxHashMap<u32, u32>,
    node_id_to_scope: FxHashMap<u32, ScopeId>,
    references: IndexMap<u32, BindingId, FxBuildHasher>,
    stack: Vec<ScopeId>,
}

/// What a declared name is, for its binding record.
struct Declared<'a> {
    kind: BindingKind,
    declaration_type: &'a str,
    import: Option<ImportBindingData>,
}

impl Builder {
    // ---- scopes ----------------------------------------------------------

    /// Enters the scope belonging to the node `id` spanning `start..end`:
    /// created on the declare pass, found again on the resolve pass.
    fn enter(&mut self, id: Option<u32>, start: Option<u32>, end: Option<u32>, kind: ScopeKind) {
        let Some(node) = id else {
            return;
        };
        let scope = if self.pass == Pass::Declare {
            let scope = ScopeId(u32::try_from(self.scopes.len()).unwrap_or(u32::MAX));
            self.scopes.push(ScopeData { id: scope, parent: self.stack.last().copied(), kind, bindings: FxHashMap::default() });
            self.node_id_to_scope.insert(node, scope);
            if let (Some(start), Some(end)) = (start, end)
                && end > start
            {
                self.node_to_scope.insert(start, scope);
                self.node_to_scope_end.insert(start, end);
            }
            scope
        } else {
            self.node_id_to_scope[&node]
        };
        self.stack.push(scope);
    }

    fn leave(&mut self, id: Option<u32>) {
        if id.is_some() {
            self.stack.pop();
        }
    }

    fn current(&self) -> ScopeId {
        self.stack.last().copied().unwrap_or(ScopeId(0))
    }

    /// The nearest function or program scope: where a `var` goes.
    fn function_scope(&self) -> ScopeId {
        self.stack
            .iter()
            .rev()
            .copied()
            .find(|s| matches!(self.scopes[s.0 as usize].kind, ScopeKind::Function | ScopeKind::Program))
            .unwrap_or(ScopeId(0))
    }

    // ---- bindings --------------------------------------------------------

    /// Renumbers the bindings grouped by scope, in scope order, keeping the
    /// order within a scope. scope.ts registers each scope with all of its
    /// bindings at once, so a program-level `const` declared after a
    /// component still comes before the component's own bindings.
    fn group_bindings_by_scope(&mut self) {
        let mut order: Vec<usize> = (0..self.bindings.len()).collect();
        order.sort_by_key(|at| self.bindings[*at].scope.0);
        let mut renumbered = vec![BindingId(0); self.bindings.len()];
        for (new, old) in order.iter().enumerate() {
            renumbered[*old] = BindingId(u32::try_from(new).unwrap_or(u32::MAX));
        }
        let mut bindings: Vec<BindingData> = order.iter().map(|old| self.bindings[*old].clone()).collect();
        for binding in &mut bindings {
            binding.id = renumbered[binding.id.0 as usize];
        }
        self.bindings = bindings;
        for scope in &mut self.scopes {
            for binding in scope.bindings.values_mut() {
                *binding = renumbered[binding.0 as usize];
            }
        }
    }

    /// Registers `identifier` in `scope` on the declare pass. A name declared
    /// twice in one scope keeps its first binding, as Babel's does.
    fn declare(&mut self, scope: ScopeId, identifier: &Identifier, declared: Declared<'_>) {
        if self.pass != Pass::Declare || self.scopes[scope.0 as usize].bindings.contains_key(&identifier.name) {
            return;
        }
        let id = BindingId(u32::try_from(self.bindings.len()).unwrap_or(u32::MAX));
        self.bindings.push(BindingData {
            id,
            name: identifier.name.clone(),
            kind: declared.kind,
            scope,
            declaration_type: declared.declaration_type.to_owned(),
            declaration_start: identifier.base.start,
            declaration_node_id: identifier.base.node_id,
            import: declared.import,
        });
        self.scopes[scope.0 as usize].bindings.insert(identifier.name.clone(), id);
    }

    /// Every name a pattern declares.
    fn declare_pattern(&mut self, scope: ScopeId, pattern: &PatternLike, kind: &BindingKind, declaration_type: &str) {
        match pattern {
            PatternLike::Identifier(identifier) => {
                self.declare(scope, identifier, Declared { kind: kind.clone(), declaration_type, import: None });
            }
            PatternLike::ObjectPattern(object) => {
                for property in &object.properties {
                    match property {
                        ObjectPatternProperty::ObjectProperty(p) => self.declare_pattern(scope, &p.value, kind, declaration_type),
                        ObjectPatternProperty::RestElement(r) => self.declare_pattern(scope, &r.argument, kind, declaration_type),
                    }
                }
            }
            PatternLike::ArrayPattern(array) => {
                for element in array.elements.iter().flatten() {
                    self.declare_pattern(scope, element, kind, declaration_type);
                }
            }
            PatternLike::AssignmentPattern(assignment) => self.declare_pattern(scope, &assignment.left, kind, declaration_type),
            PatternLike::RestElement(rest) => self.declare_pattern(scope, &rest.argument, kind, declaration_type),
            _ => {}
        }
    }

    /// The binding `name` resolves to from the current scope.
    fn lookup(&self, name: &str) -> Option<BindingId> {
        let mut scope = self.stack.last().copied();
        while let Some(at) = scope {
            let data = &self.scopes[at.0 as usize];
            if let Some(binding) = data.bindings.get(name) {
                return Some(*binding);
            }
            scope = data.parent;
        }
        None
    }

    /// Maps the node `id` to the binding `name` resolves to, on the resolve pass.
    fn reference(&mut self, id: Option<u32>, name: &str) {
        if self.pass != Pass::Resolve {
            return;
        }
        if let (Some(id), Some(binding)) = (id, self.lookup(name)) {
            self.references.insert(id, binding);
        }
    }

    fn identifier(&mut self, identifier: &Identifier) {
        self.reference(identifier.base.node_id, &identifier.name);
    }

    // ---- the program -----------------------------------------------------

    fn program(&mut self, file: &File) {
        let program = &file.program;
        self.enter(program.base.node_id, program.base.start, program.base.end, ScopeKind::Program);
        for statement in &program.body {
            self.statement(statement);
        }
        self.leave(program.base.node_id);
    }

    fn block(&mut self, block: &BlockStatement) {
        self.enter(block.base.node_id, block.base.start, block.base.end, ScopeKind::Block);
        self.statements(&block.body);
        self.leave(block.base.node_id);
    }

    /// A body whose block is the enclosing function's or catch clause's scope.
    fn statements(&mut self, statements: &[Statement]) {
        for statement in statements {
            self.statement(statement);
        }
    }

    #[allow(clippy::too_many_lines)]
    fn statement(&mut self, statement: &Statement) {
        match statement {
            Statement::BlockStatement(block) => self.block(block),
            Statement::ExpressionStatement(s) => self.expression(&s.expression),
            Statement::ReturnStatement(s) => {
                if let Some(argument) = &s.argument {
                    self.expression(argument);
                }
            }
            Statement::ThrowStatement(s) => self.expression(&s.argument),
            Statement::IfStatement(s) => {
                self.expression(&s.test);
                self.statement(&s.consequent);
                if let Some(alternate) = &s.alternate {
                    self.statement(alternate);
                }
            }
            // Babel's `Scopable` includes both loops: each is a block scope, with
            // its body block another inside it.
            Statement::WhileStatement(s) => {
                self.enter(s.base.node_id, s.base.start, s.base.end, ScopeKind::Block);
                self.expression(&s.test);
                self.statement(&s.body);
                self.leave(s.base.node_id);
            }
            Statement::DoWhileStatement(s) => {
                self.enter(s.base.node_id, s.base.start, s.base.end, ScopeKind::Block);
                self.statement(&s.body);
                self.expression(&s.test);
                self.leave(s.base.node_id);
            }
            Statement::ForStatement(s) => {
                self.enter(s.base.node_id, s.base.start, s.base.end, ScopeKind::For);
                if let Some(init) = &s.init {
                    match init.as_ref() {
                        ForInit::VariableDeclaration(declaration) => self.variable_declaration(declaration),
                        ForInit::Expression(expression) => self.expression(expression),
                    }
                }
                if let Some(test) = &s.test {
                    self.expression(test);
                }
                if let Some(update) = &s.update {
                    self.expression(update);
                }
                self.statement(&s.body);
                self.leave(s.base.node_id);
            }
            Statement::ForOfStatement(s) => {
                self.enter(s.base.node_id, s.base.start, s.base.end, ScopeKind::For);
                self.for_left(&s.left);
                self.expression(&s.right);
                self.statement(&s.body);
                self.leave(s.base.node_id);
            }
            Statement::ForInStatement(s) => {
                self.enter(s.base.node_id, s.base.start, s.base.end, ScopeKind::For);
                self.for_left(&s.left);
                self.expression(&s.right);
                self.statement(&s.body);
                self.leave(s.base.node_id);
            }
            Statement::SwitchStatement(s) => {
                self.expression(&s.discriminant);
                self.enter(s.base.node_id, s.base.start, s.base.end, ScopeKind::Switch);
                for case in &s.cases {
                    if let Some(test) = &case.test {
                        self.expression(test);
                    }
                    self.statements(&case.consequent);
                }
                self.leave(s.base.node_id);
            }
            Statement::TryStatement(s) => {
                self.block(&s.block);
                if let Some(handler) = &s.handler {
                    self.enter(handler.base.node_id, handler.base.start, handler.base.end, ScopeKind::Catch);
                    if let Some(param) = &handler.param {
                        let scope = self.current();
                        self.pattern_scope(param, |builder| {
                            builder.declare_pattern(scope, param, &BindingKind::Let, "CatchClause");
                            builder.pattern(param);
                        });
                    }
                    self.statements(&handler.body.body);
                    self.leave(handler.base.node_id);
                }
                if let Some(finalizer) = &s.finalizer {
                    self.block(finalizer);
                }
            }
            Statement::LabeledStatement(s) => self.statement(&s.body),
            Statement::VariableDeclaration(declaration) => self.variable_declaration(declaration),
            Statement::FunctionDeclaration(f) => self.function_declaration(f),
            Statement::ClassDeclaration(c) => self.class_declaration(c),
            Statement::ImportDeclaration(import) => {
                let source = import.source.value.to_string_lossy();
                let type_only_declaration = matches!(import.import_kind, Some(ImportKind::Type));
                for specifier in &import.specifiers {
                    // A type-only import binds nothing at run time: Babel gives it
                    // no `module` kind, so scope.ts records it as `unknown`.
                    let type_only = type_only_declaration
                        || matches!(specifier, ImportSpecifier::ImportSpecifier(s) if matches!(s.import_kind, Some(ImportKind::Type)));
                    let (local, declaration_type, kind, imported) = match specifier {
                        ImportSpecifier::ImportSpecifier(s) => (
                            &s.local,
                            "ImportSpecifier",
                            ImportBindingKind::Named,
                            Some(match &s.imported {
                                ModuleExportName::Identifier(i) => i.name.clone(),
                                ModuleExportName::StringLiteral(l) => l.value.to_string_lossy(),
                            }),
                        ),
                        ImportSpecifier::ImportDefaultSpecifier(s) => (&s.local, "ImportDefaultSpecifier", ImportBindingKind::Default, None),
                        ImportSpecifier::ImportNamespaceSpecifier(s) => (&s.local, "ImportNamespaceSpecifier", ImportBindingKind::Namespace, None),
                    };
                    let declared = if type_only {
                        Declared { kind: BindingKind::Unknown, declaration_type, import: None }
                    } else {
                        Declared { kind: BindingKind::Module, declaration_type, import: Some(ImportBindingData { source: source.clone(), kind, imported }) }
                    };
                    self.declare(ScopeId(0), local, declared);
                    self.identifier(local);
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(declaration) = &export.declaration {
                    self.declaration(declaration);
                    // Babel counts the export among the references of what it
                    // declares; with several names, the last one keeps it.
                    for name in declared_names(declaration) {
                        self.reference(export.base.node_id, name);
                    }
                }
                if export.source.is_none() {
                    for specifier in &export.specifiers {
                        if let ExportSpecifier::ExportSpecifier(s) = specifier
                            && let ModuleExportName::Identifier(local) = &s.local
                        {
                            self.identifier(local);
                        }
                    }
                }
            }
            Statement::Unknown(unknown) if unknown.node_type() == "TSImportEqualsDeclaration" => {
                // `import lib = require(…)`: Babel binds `lib` with no kind it
                // names, and scope.ts records it as `unknown`.
                let raw = unknown.raw().parse_value();
                if let Some(id) = raw.get("id").and_then(|id| serde_json::from_value::<Identifier>(id.clone()).ok()) {
                    let scope = self.current();
                    self.declare(scope, &id, Declared { kind: BindingKind::Unknown, declaration_type: "TSImportEqualsDeclaration", import: None });
                    self.identifier(&id);
                }
            }
            Statement::ExportDefaultDeclaration(export) => match export.declaration.as_ref() {
                ExportDefaultDecl::FunctionDeclaration(f) => {
                    self.function_declaration(f);
                    if let Some(id) = &f.id {
                        self.reference(export.base.node_id, &id.name);
                    }
                }
                ExportDefaultDecl::ClassDeclaration(c) => {
                    self.class_declaration(c);
                    if let Some(id) = &c.id {
                        self.reference(export.base.node_id, &id.name);
                    }
                }
                ExportDefaultDecl::Expression(expression) => self.expression(expression),
                ExportDefaultDecl::EnumDeclaration(_) => {}
            },
            _ => {}
        }
    }

    fn declaration(&mut self, declaration: &Declaration) {
        match declaration {
            Declaration::FunctionDeclaration(f) => self.function_declaration(f),
            Declaration::ClassDeclaration(c) => self.class_declaration(c),
            Declaration::VariableDeclaration(v) => self.variable_declaration(v),
            _ => {}
        }
    }

    fn variable_declaration(&mut self, declaration: &VariableDeclaration) {
        let (scope, kind) = match declaration.kind {
            VariableDeclarationKind::Var => (self.function_scope(), BindingKind::Var),
            VariableDeclarationKind::Let => (self.current(), BindingKind::Let),
            VariableDeclarationKind::Const | VariableDeclarationKind::Using | VariableDeclarationKind::AwaitUsing => {
                (self.current(), BindingKind::Const)
            }
        };
        for declarator in &declaration.declarations {
            self.declare_pattern(scope, &declarator.id, &kind, "VariableDeclarator");
            self.pattern(&declarator.id);
            if let Some(init) = &declarator.init {
                self.expression(init);
            }
        }
    }

    fn for_left(&mut self, left: &ForInOfLeft) {
        match left {
            ForInOfLeft::VariableDeclaration(declaration) => self.variable_declaration(declaration),
            ForInOfLeft::Pattern(pattern) => self.pattern(pattern),
        }
    }

    // ---- functions and classes -----------------------------------------

    /// A function declaration's name is a `hoisted` binding of the scope the
    /// declaration sits in; the function itself is a scope below it.
    fn function_declaration(&mut self, f: &FunctionDeclaration) {
        if let Some(id) = &f.id {
            let scope = self.current();
            self.declare(scope, id, Declared { kind: BindingKind::Hoisted, declaration_type: "FunctionDeclaration", import: None });
            self.identifier(id);
        }
        self.function(f.base.node_id, f.base.start, f.base.end, None, &f.params, Body::Block(&f.body));
    }

    /// A class declaration's name is a `let` twice over: of the enclosing
    /// scope, and of the class's own, as Babel's crawl registers it and
    /// scope.ts serialises it. Inside the class the name resolves to the inner
    /// binding, and so does the name itself.
    fn class_declaration(&mut self, c: &ClassDeclaration) {
        if let Some(id) = &c.id {
            let scope = self.current();
            self.declare(scope, id, Declared { kind: BindingKind::Let, declaration_type: "ClassDeclaration", import: None });
        }
        let name = c.id.as_ref().map(|id| (id, "ClassDeclaration", BindingKind::Let));
        self.class(c.base.node_id, c.base.start, c.base.end, name, c.super_class.as_deref(), &c.body);
    }

    /// A function's own scope, with its name (for a function expression), its
    /// parameters and its body. A destructuring parameter is a scope of its
    /// own in Babel, holding no bindings.
    fn function(&mut self, id: Option<u32>, start: Option<u32>, end: Option<u32>, local: Option<(&Identifier, &str)>, params: &[PatternLike], body: Body<'_>) {
        self.enter(id, start, end, ScopeKind::Function);
        let scope = self.current();
        // Babel registers the parameters first, then a function expression's
        // own name.
        for param in params {
            let declaration_type = pattern_type(param);
            self.declare_pattern(scope, param, &BindingKind::Param, declaration_type);
        }
        if let Some((name, declaration_type)) = local {
            self.declare(scope, name, Declared { kind: BindingKind::Local, declaration_type, import: None });
            self.identifier(name);
        }
        for param in params {
            self.pattern_scope(param, |builder| builder.pattern(param));
        }
        match body {
            Body::Block(block) => self.statements(&block.body),
            Body::Expression(expression) => self.expression(expression),
        }
        self.leave(id);
    }

    /// Runs `walk` inside the scope Babel gives a destructuring parameter.
    fn pattern_scope(&mut self, pattern: &PatternLike, walk: impl FnOnce(&mut Self)) {
        let base = match pattern {
            PatternLike::ObjectPattern(p) => Some(&p.base),
            PatternLike::ArrayPattern(p) => Some(&p.base),
            PatternLike::AssignmentPattern(p) => Some(&p.base),
            _ => None,
        };
        match base {
            Some(base) => {
                self.enter(base.node_id, base.start, base.end, ScopeKind::Block);
                walk(self);
                self.leave(base.node_id);
            }
            None => walk(self),
        }
    }

    /// A class's own scope, holding its name: a declaration's (`let`) or an
    /// expression's (`local`).
    fn class(
        &mut self,
        id: Option<u32>,
        start: Option<u32>,
        end: Option<u32>,
        name: Option<(&Identifier, &str, BindingKind)>,
        super_class: Option<&Expression>,
        _body: &ClassBody,
    ) {
        if let Some(super_class) = super_class {
            self.expression(super_class);
        }
        self.enter(id, start, end, ScopeKind::Class);
        if let Some((name, declaration_type, kind)) = name {
            let scope = self.current();
            self.declare(scope, name, Declared { kind, declaration_type, import: None });
            self.identifier(name);
        }
        self.leave(id);
    }

    fn function_expression(&mut self, f: &FunctionExpression) {
        let local = f.id.as_ref().map(|name| (name, "FunctionExpression"));
        self.function(f.base.node_id, f.base.start, f.base.end, local, &f.params, Body::Block(&f.body));
    }

    // ---- patterns and expressions ---------------------------------------

    /// The references inside a pattern: its names, and the expressions of its
    /// defaults and computed keys.
    fn pattern(&mut self, pattern: &PatternLike) {
        match pattern {
            PatternLike::Identifier(identifier) => self.identifier(identifier),
            PatternLike::ObjectPattern(object) => {
                for property in &object.properties {
                    match property {
                        ObjectPatternProperty::ObjectProperty(p) => {
                            if p.computed {
                                self.expression(&p.key);
                            }
                            self.pattern(&p.value);
                        }
                        ObjectPatternProperty::RestElement(r) => self.pattern(&r.argument),
                    }
                }
            }
            PatternLike::ArrayPattern(array) => {
                for element in array.elements.iter().flatten() {
                    self.pattern(element);
                }
            }
            PatternLike::AssignmentPattern(assignment) => {
                self.pattern(&assignment.left);
                self.expression(&assignment.right);
            }
            PatternLike::RestElement(rest) => self.pattern(&rest.argument),
            PatternLike::MemberExpression(member) => {
                self.expression(&member.object);
                if member.computed {
                    self.expression(&member.property);
                }
            }
            PatternLike::TSAsExpression(e) => self.expression(&e.expression),
            PatternLike::TSSatisfiesExpression(e) => self.expression(&e.expression),
            PatternLike::TSNonNullExpression(e) => self.expression(&e.expression),
            PatternLike::TSTypeAssertion(e) => self.expression(&e.expression),
            PatternLike::TypeCastExpression(e) => self.expression(&e.expression),
        }
    }

    #[allow(clippy::too_many_lines)]
    fn expression(&mut self, expression: &Expression) {
        match expression {
            Expression::Identifier(identifier) => self.identifier(identifier),
            Expression::CallExpression(e) => {
                self.expression(&e.callee);
                self.expressions(&e.arguments);
            }
            Expression::OptionalCallExpression(e) => {
                self.expression(&e.callee);
                self.expressions(&e.arguments);
            }
            Expression::NewExpression(e) => {
                self.expression(&e.callee);
                self.expressions(&e.arguments);
            }
            Expression::MemberExpression(e) => {
                self.expression(&e.object);
                if e.computed {
                    self.expression(&e.property);
                }
            }
            Expression::OptionalMemberExpression(e) => {
                self.expression(&e.object);
                if e.computed {
                    self.expression(&e.property);
                }
            }
            Expression::BinaryExpression(e) => {
                self.expression(&e.left);
                self.expression(&e.right);
            }
            Expression::LogicalExpression(e) => {
                self.expression(&e.left);
                self.expression(&e.right);
            }
            Expression::UnaryExpression(e) => self.expression(&e.argument),
            Expression::UpdateExpression(e) => self.expression(&e.argument),
            Expression::ConditionalExpression(e) => {
                self.expression(&e.test);
                self.expression(&e.consequent);
                self.expression(&e.alternate);
            }
            Expression::AssignmentExpression(e) => {
                self.pattern(&e.left);
                self.expression(&e.right);
            }
            Expression::SequenceExpression(e) => self.expressions(&e.expressions),
            Expression::ArrowFunctionExpression(f) => {
                let body = match f.body.as_ref() {
                    ArrowFunctionBody::BlockStatement(block) => Body::Block(block),
                    ArrowFunctionBody::Expression(expression) => Body::Expression(expression),
                };
                self.function(f.base.node_id, f.base.start, f.base.end, None, &f.params, body);
            }
            Expression::FunctionExpression(f) => self.function_expression(f),
            Expression::ObjectExpression(object) => {
                for property in &object.properties {
                    match property {
                        ObjectExpressionProperty::ObjectProperty(p) => {
                            if p.computed {
                                self.expression(&p.key);
                            }
                            self.expression(&p.value);
                        }
                        ObjectExpressionProperty::ObjectMethod(m) => {
                            if m.computed {
                                self.expression(&m.key);
                            }
                            self.function(m.base.node_id, m.base.start, m.base.end, None, &m.params, Body::Block(&m.body));
                        }
                        ObjectExpressionProperty::SpreadElement(s) => self.expression(&s.argument),
                    }
                }
            }
            Expression::ArrayExpression(array) => {
                for element in array.elements.iter().flatten() {
                    self.expression(element);
                }
            }
            Expression::TemplateLiteral(t) => self.expressions(&t.expressions),
            Expression::TaggedTemplateExpression(t) => {
                self.expression(&t.tag);
                self.expressions(&t.quasi.expressions);
            }
            Expression::AwaitExpression(e) => self.expression(&e.argument),
            Expression::YieldExpression(e) => {
                if let Some(argument) = &e.argument {
                    self.expression(argument);
                }
            }
            Expression::SpreadElement(e) => self.expression(&e.argument),
            Expression::ClassExpression(c) => {
                let name = c.id.as_ref().map(|id| (id, "ClassExpression", BindingKind::Local));
                self.class(c.base.node_id, c.base.start, c.base.end, name, c.super_class.as_deref(), &c.body);
            }
            Expression::ParenthesizedExpression(e) => self.expression(&e.expression),
            Expression::JSXElement(element) => self.jsx_element(element),
            Expression::JSXFragment(fragment) => self.jsx_children(&fragment.children),
            Expression::AssignmentPattern(p) => {
                self.pattern(&p.left);
                self.expression(&p.right);
            }
            Expression::TSAsExpression(e) => self.expression(&e.expression),
            Expression::TSSatisfiesExpression(e) => self.expression(&e.expression),
            Expression::TSNonNullExpression(e) => self.expression(&e.expression),
            Expression::TSTypeAssertion(e) => self.expression(&e.expression),
            Expression::TSInstantiationExpression(e) => self.expression(&e.expression),
            Expression::TypeCastExpression(e) => self.expression(&e.expression),
            _ => {}
        }
    }

    fn expressions(&mut self, expressions: &[Expression]) {
        for expression in expressions {
            self.expression(expression);
        }
    }

    // ---- JSX -------------------------------------------------------------

    fn jsx_element(&mut self, element: &JSXElement) {
        // An opening tag's plain name is looked up whatever its case, as
        // scope.ts adds; a closing tag's, only if it names a component.
        self.jsx_name(&element.opening_element.name, true);
        for attribute in &element.opening_element.attributes {
            match attribute {
                JSXAttributeItem::JSXAttribute(a) => match &a.value {
                    Some(JSXAttributeValue::JSXExpressionContainer(c)) => self.jsx_container(&c.expression),
                    Some(JSXAttributeValue::JSXElement(e)) => self.jsx_element(e),
                    Some(JSXAttributeValue::JSXFragment(f)) => self.jsx_children(&f.children),
                    _ => {}
                },
                JSXAttributeItem::JSXSpreadAttribute(s) => self.expression(&s.argument),
            }
        }
        self.jsx_children(&element.children);
        if let Some(closing) = &element.closing_element {
            self.jsx_name(&closing.name, false);
        }
    }

    fn jsx_name(&mut self, name: &JSXElementName, opening: bool) {
        match name {
            JSXElementName::JSXIdentifier(identifier) => {
                if opening || !is_compat_tag(&identifier.name) {
                    self.reference(identifier.base.node_id, &identifier.name);
                }
            }
            JSXElementName::JSXMemberExpression(member) => self.jsx_member_object(member),
            JSXElementName::JSXNamespacedName(_) => {}
        }
    }

    /// The identifier at the root of `<a.b.C>`.
    fn jsx_member_object(&mut self, member: &JSXMemberExpression) {
        match member.object.as_ref() {
            JSXMemberExprObject::JSXIdentifier(identifier) => self.reference(identifier.base.node_id, &identifier.name),
            JSXMemberExprObject::JSXMemberExpression(inner) => self.jsx_member_object(inner),
        }
    }

    fn jsx_children(&mut self, children: &[JSXChild]) {
        for child in children {
            match child {
                JSXChild::JSXElement(element) => self.jsx_element(element),
                JSXChild::JSXFragment(fragment) => self.jsx_children(&fragment.children),
                JSXChild::JSXExpressionContainer(container) => self.jsx_container(&container.expression),
                JSXChild::JSXSpreadChild(spread) => self.expression(&spread.expression),
                JSXChild::JSXText(_) => {}
            }
        }
    }

    fn jsx_container(&mut self, expression: &JSXExpressionContainerExpr) {
        if let JSXExpressionContainerExpr::Expression(expression) = expression {
            self.expression(expression);
        }
    }
}

#[derive(Clone, Copy)]
enum Body<'a> {
    Block(&'a BlockStatement),
    Expression(&'a Expression),
}

/// The Babel node type of a parameter, which is its bindings' declaration type.
fn pattern_type(pattern: &PatternLike) -> &'static str {
    match pattern {
        PatternLike::Identifier(_) => "Identifier",
        PatternLike::ObjectPattern(_) => "ObjectPattern",
        PatternLike::ArrayPattern(_) => "ArrayPattern",
        PatternLike::AssignmentPattern(_) => "AssignmentPattern",
        PatternLike::RestElement(_) => "RestElement",
        _ => "Pattern",
    }
}

/// The names a declaration introduces, in order.
fn declared_names(declaration: &Declaration) -> Vec<&str> {
    fn pattern_names<'a>(pattern: &'a PatternLike, out: &mut Vec<&'a str>) {
        match pattern {
            PatternLike::Identifier(i) => out.push(&i.name),
            PatternLike::ObjectPattern(o) => {
                for p in &o.properties {
                    match p {
                        ObjectPatternProperty::ObjectProperty(p) => pattern_names(&p.value, out),
                        ObjectPatternProperty::RestElement(r) => pattern_names(&r.argument, out),
                    }
                }
            }
            PatternLike::ArrayPattern(a) => a.elements.iter().flatten().for_each(|e| pattern_names(e, out)),
            PatternLike::AssignmentPattern(a) => pattern_names(&a.left, out),
            PatternLike::RestElement(r) => pattern_names(&r.argument, out),
            _ => {}
        }
    }
    let mut out = Vec::new();
    match declaration {
        Declaration::FunctionDeclaration(f) => out.extend(f.id.as_ref().map(|i| i.name.as_str())),
        Declaration::ClassDeclaration(c) => out.extend(c.id.as_ref().map(|i| i.name.as_str())),
        Declaration::VariableDeclaration(v) => v.declarations.iter().for_each(|d| pattern_names(&d.id, &mut out)),
        _ => {}
    }
    out
}

/// React's rule for an intrinsic element: a lowercase first letter, or a dash.
fn is_compat_tag(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_lowercase()) || name.contains('-')
}
