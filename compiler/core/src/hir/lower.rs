//! Lowering a semantic snapshot into HIR.
//!
//! # Scope
//!
//! The first slice: functions, parameters, literals, binary arithmetic, and
//! `return`. Enough to carry a program end to end through a backend, which is
//! what makes the next design decisions answerable by a consumer rather than
//! guessed at.
//!
//! Anything outside it is refused rather than approximated. RFC §4.1 requires
//! that unsupported *reachable* behavior produce a precise diagnostic, and a
//! lowering that silently emits nothing for a statement it did not understand
//! produces a program that runs and is wrong.

use nts_diagnostics::{Diagnostic, Location};
use nts_semantic_schema::{
    LiteralValue, NodeId, NodeKind, Origin, SemanticSnapshot, TypeId, TypeKind, syntax,
};

use super::{BinOp, Callee, Func, HirType, ManagedType, Op, OpKind, Param, Program, ValueId};

/// What a lowering produced, and what it could not.
#[derive(Debug, Default)]
pub struct Lowered {
    pub program: Program,
    /// Constructs the lowering did not understand.
    ///
    /// Collected rather than returned as an error so one run reports every
    /// unsupported construct instead of the first.
    pub diagnostics: Vec<Diagnostic>,
}

impl Lowered {
    /// Whether anything was refused.
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.diagnostics.is_empty()
    }
}

/// Lower every function declaration in a snapshot.
#[must_use]
pub fn lower(snapshot: &SemanticSnapshot) -> Lowered {
    let mut lowered = Lowered::default();

    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::FUNCTION_DECLARATION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let mut builder = FuncBuilder::new(snapshot);
        match builder.lower_function(id) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => lowered.diagnostics.push(diagnostic),
        }
    }

    lowered
}

/// Choose a representation for a source type.
///
/// The decision the whole layer exists to make. Unspecialized, so `number`
/// becomes `f64` — correct, and the thing specialization improves on once
/// analysis can show a value is integral and in range.
#[must_use]
pub fn representation(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<HirType> {
    let record = snapshot.types.get(ty.0 as usize)?;
    Some(match &record.kind {
        TypeKind::Void | TypeKind::Undefined => HirType::Void,
        TypeKind::Never => HirType::Never,
        // A literal shares its widened type's representation. The literal *value*
        // is still known and can become an immediate; what it cannot have is a
        // representation narrower than the type it widens to.
        TypeKind::Boolean | TypeKind::Literal(LiteralValue::Boolean(_)) => HirType::Bool,
        TypeKind::Number | TypeKind::Literal(LiteralValue::Number(_)) => HirType::NUMBER,
        TypeKind::String | TypeKind::Literal(LiteralValue::String(_)) => {
            HirType::Managed(ManagedType::String)
        }
        TypeKind::Array(element) => {
            let element = representation(snapshot, *element)?;
            HirType::Managed(ManagedType::Array(Box::new(element)))
        }
        TypeKind::Object { .. } => HirType::Managed(ManagedType::Object(ty)),

        // `any` and `unknown` fall here and are refused, which is right for one
        // of them and wrong for the other.
        //
        // `docs/any-unknown.md` settles it: `any` is not a runtime type at all
        // and none may reach MIR — application `any` is rejected, while
        // declaration-originated `any` (from `lib.*.d.ts` or `@types`) is tracked
        // as *unchecked* rather than rejected, so the ecosystem stays usable.
        // `unknown`, by contrast, is a fully supported top type that "must not be
        // rejected merely because it requires an erased representation", and its
        // representation is chosen by whole-program analysis — a primitive, a
        // managed reference, a closed union, a handle, or a general erased value,
        // whichever is cheapest across all reachable uses.
        //
        // Refusing `unknown` therefore rejects valid programs today. Implementing
        // it needs the provenance tracking and representation analysis that
        // document describes, not another arm in this match.
        _ => return None,
    })
}

/// Builds one function.
struct FuncBuilder<'a> {
    snapshot: &'a SemanticSnapshot,
    ops: Vec<Op>,
    /// Symbol index → the value holding it.
    ///
    /// This is what makes two identifiers with one symbol become one value
    /// rather than two loads.
    bindings: rustc_hash::FxHashMap<u32, ValueId>,
}

impl<'a> FuncBuilder<'a> {
    fn new(snapshot: &'a SemanticSnapshot) -> Self {
        Self {
            snapshot,
            ops: Vec::new(),
            bindings: rustc_hash::FxHashMap::default(),
        }
    }

    fn node(&self, id: NodeId) -> &'a nts_semantic_schema::NodeRecord {
        &self.snapshot.nodes[id.0 as usize]
    }

    fn origin(&self, id: NodeId) -> Origin {
        self.node(id).origin.clone()
    }

    fn location(&self, id: NodeId) -> Location {
        self.node(id).origin.location
    }

    /// Children, with list nodes flattened away.
    ///
    /// A `NodeList` is an encoding artifact rather than a construct, so it is not
    /// something the lowering should have to know about at every step.
    fn children(&self, id: NodeId) -> Vec<NodeId> {
        self.node(id)
            .children
            .iter()
            .flat_map(|child| {
                let node = self.node(*child);
                if node.kind == NodeKind::List {
                    node.children.clone()
                } else {
                    vec![*child]
                }
            })
            .collect()
    }

    fn kind_of(&self, id: NodeId) -> Option<u16> {
        match self.node(id).kind {
            NodeKind::Syntax(kind) => Some(kind),
            NodeKind::List => None,
        }
    }

    fn type_of(&self, id: NodeId) -> Option<HirType> {
        let ty = self.snapshot.node_types.get(&id)?;
        representation(self.snapshot, *ty)
    }

    fn push(&mut self, kind: OpKind, ty: HirType, origin: Origin) -> ValueId {
        let id = ValueId(u32::try_from(self.ops.len()).unwrap_or(u32::MAX));
        self.ops.push(Op { kind, ty, origin });
        id
    }

    fn unsupported(&self, id: NodeId, what: &str) -> Diagnostic {
        Diagnostic::error(
            "NTS1001",
            format!("{what} is not supported by this lowering yet"),
            self.location(id),
        )
    }

    fn lower_function(&mut self, id: NodeId) -> Result<Func, Diagnostic> {
        let children = self.children(id);

        let name = children
            .iter()
            .find(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))
            .and_then(|child| self.node(*child).text.clone())
            .ok_or_else(|| self.unsupported(id, "an anonymous function"))?;

        let mut params = Vec::new();
        for child in &children {
            if self.kind_of(*child) != Some(syntax::PARAMETER) {
                continue;
            }
            params.push(self.lower_param(*child, u32::try_from(params.len()).unwrap_or(0))?);
        }

        // The return type comes from the annotation when there is one. Without it
        // the checker's inferred type is on the signature, not on any node, so an
        // unannotated function is refused rather than guessed at.
        let body = children
            .iter()
            .rev()
            .find(|child| self.kind_of(**child) == Some(syntax::BLOCK))
            .copied()
            .ok_or_else(|| self.unsupported(id, "a function without a body"))?;

        let return_type = children
            .iter()
            .filter(|child| {
                self.kind_of(**child) != Some(syntax::PARAMETER)
                    && self.kind_of(**child) != Some(syntax::IDENTIFIER)
                    && **child != body
            })
            .find_map(|child| self.type_of(*child))
            .unwrap_or(HirType::Void);

        self.lower_block(body)?;

        Ok(Func {
            name,
            params,
            return_type,
            ops: std::mem::take(&mut self.ops),
            origin: self.origin(id),
            exported: self
                .node(id)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::EXPORT),
        })
    }

    fn lower_param(&mut self, id: NodeId, index: u32) -> Result<Param, Diagnostic> {
        let children = self.children(id);
        let name_node = children
            .iter()
            .find(|child| self.kind_of(**child) == Some(syntax::IDENTIFIER))
            .copied()
            .ok_or_else(|| self.unsupported(id, "a destructured parameter"))?;

        let name = self
            .node(name_node)
            .text
            .clone()
            .unwrap_or_else(|| format!("arg{index}"));
        let ty = self
            .type_of(name_node)
            .ok_or_else(|| self.unsupported(id, "a parameter of an unrepresentable type"))?;

        let origin = self.origin(name_node);
        let value = self.push(OpKind::Param(index), ty.clone(), origin.clone());
        // Bound by symbol, so every later mention of this name resolves to the
        // same value rather than to a fresh load.
        if let Some(symbol) = self.node(name_node).symbol {
            self.bindings.insert(symbol.0, value);
        }

        Ok(Param { name, ty, origin })
    }

    fn lower_block(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        for statement in self.children(id) {
            self.lower_statement(statement)?;
        }
        Ok(())
    }

    fn lower_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::RETURN_STATEMENT) => {
                let value = match self.children(id).first().copied() {
                    Some(expression) => Some(self.lower_expression(expression)?),
                    None => None,
                };
                let origin = self.origin(id);
                self.push(OpKind::Return(value), HirType::Void, origin);
                Ok(())
            }
            Some(syntax::BLOCK) => self.lower_block(id),
            Some(syntax::VARIABLE_STATEMENT) => self.lower_variable_statement(id),
            _ => Err(self.unsupported(id, "this statement")),
        }
    }

    fn lower_expression(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::IDENTIFIER) => self.lower_identifier(id),
            Some(syntax::NUMERIC_LITERAL) => self.lower_number(id),
            Some(syntax::STRING_LITERAL) => self.lower_string(id),
            Some(syntax::BINARY_EXPRESSION) => self.lower_binary(id),
            Some(syntax::CALL_EXPRESSION) => self.lower_call(id),
            _ => Err(self.unsupported(id, "this expression")),
        }
    }

    /// `const x = expr` / `let x = expr`.
    ///
    /// A declaration with an initializer binds its symbol to the initializer's
    /// value — no slot and no store, because nothing here can reassign it yet.
    /// When assignment arrives, a `let` will need one and a `const` still will
    /// not, which is what the snapshot's variable kind is for.
    fn lower_variable_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        // A `VariableDeclarationList` is an ordinary syntax node, not a NodeList,
        // so `children` does not flatten it away — the declarations sit one level
        // further down than they appear to.
        let declarations: Vec<NodeId> = self
            .children(id)
            .into_iter()
            .flat_map(|child| {
                if self.kind_of(child) == Some(syntax::VARIABLE_DECLARATION_LIST) {
                    self.children(child)
                } else {
                    vec![child]
                }
            })
            .collect();

        for declaration in declarations {
            if self.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION) {
                continue;
            }
            let children = self.children(declaration);
            let [name, initializer] = children.as_slice() else {
                return Err(self.unsupported(declaration, "a declaration without an initializer"));
            };
            let value = self.lower_expression(*initializer)?;
            let symbol = self
                .node(*name)
                .symbol
                .ok_or_else(|| self.unsupported(*name, "an unresolved declaration"))?;
            self.bindings.insert(symbol.0, value);
        }
        Ok(())
    }

    fn lower_string(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let text = self
            .snapshot
            .node_types
            .get(&id)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .and_then(|record| match &record.kind {
                TypeKind::Literal(LiteralValue::String(text)) => Some(text.clone()),
                _ => None,
            })
            .ok_or_else(|| self.unsupported(id, "a string literal with no known value"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ConstString(text),
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// A call to a statically resolved target.
    ///
    /// Requires the frontend's call resolution: without it there is no way to
    /// know *which* function a call site reaches, and guessing from the callee's
    /// spelling would pick the wrong overload silently. Refusing is the honest
    /// answer, and the diagnostic says what is missing rather than what is
    /// unsupported.
    fn lower_call(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let Some(target) = self.snapshot.call_targets.get(&id) else {
            return Err(Diagnostic::error(
                "NTS1002",
                "this call was not resolved to a target; the frontend's call \
                 resolution pass has to run before lowering",
                self.location(id),
            ));
        };

        let children = self.children(id);
        let callee_node = *children
            .first()
            .ok_or_else(|| self.unsupported(id, "a call with no callee"))?;
        let name = self
            .node(callee_node)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(callee_node, "a computed callee"))?;

        // A callee inside the compiled program becomes a static call; one outside
        // it is still typed exactly, and the definition comes from elsewhere.
        let callee = if target.callee.is_some() {
            Callee::Direct(name)
        } else {
            Callee::External(name)
        };

        let mut args = Vec::new();
        for argument in children.iter().skip(1) {
            args.push(self.lower_expression(*argument)?);
        }

        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
        let origin = self.origin(id);
        Ok(self.push(OpKind::Call { callee, args }, ty, origin))
    }

    fn lower_identifier(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let symbol = self
            .node(id)
            .symbol
            .ok_or_else(|| self.unsupported(id, "an unresolved name"))?;
        self.bindings
            .get(&symbol.0)
            .copied()
            .ok_or_else(|| self.unsupported(id, "a name declared outside this function"))
    }

    fn lower_number(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // The constant folder already answered this where it could; otherwise the
        // literal type carries the value.
        let value = match self.snapshot.constants.get(&id) {
            Some(nts_semantic_schema::ConstantValue::Number(value)) => *value,
            _ => self
                .snapshot
                .node_types
                .get(&id)
                .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
                .and_then(|record| match &record.kind {
                    TypeKind::Literal(LiteralValue::Number(value)) => Some(*value),
                    _ => None,
                })
                .ok_or_else(|| self.unsupported(id, "a numeric literal with no known value"))?,
        };
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin))
    }

    fn lower_binary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let [lhs_node, operator, rhs_node] = children.as_slice() else {
            return Err(self.unsupported(id, "a binary expression of unexpected shape"));
        };

        let lhs = self.lower_expression(*lhs_node)?;
        let rhs = self.lower_expression(*rhs_node)?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a binary expression of unrepresentable type"))?;

        let token = self
            .kind_of(*operator)
            .ok_or_else(|| self.unsupported(id, "a binary expression with no operator"))?;

        // `+` is not one operator. On numbers it is arithmetic; on strings it is
        // concatenation, and the two lower to nothing alike. Resolving it here
        // against the result type means no backend has to ask again.
        let op = match token {
            syntax::PLUS_TOKEN if ty.is_managed() => BinOp::Concat,
            syntax::PLUS_TOKEN => BinOp::Add,
            syntax::MINUS_TOKEN => BinOp::Sub,
            syntax::ASTERISK_TOKEN => BinOp::Mul,
            syntax::SLASH_TOKEN => BinOp::Div,
            syntax::PERCENT_TOKEN => BinOp::Rem,
            syntax::LESS_THAN_TOKEN => BinOp::Lt,
            syntax::GREATER_THAN_TOKEN => BinOp::Gt,
            _ => return Err(self.unsupported(*operator, "this operator")),
        };

        let origin = self.origin(id);
        Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
    }
}
