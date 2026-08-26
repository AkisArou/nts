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
    LiteralValue, NodeData, NodeId, NodeKind, Origin, SemanticSnapshot, TypeId, TypeKind, syntax,
};

use super::facts::Facts;
use super::{
    BinOp, Block, BlockId, Callee, Field, Func, HirType, Layout, ManagedType, Op, OpKind, Param,
    Program, Terminator, UnOp, ValueId,
};

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
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));

        // A class contributes one function per method and constructor, each
        // taking the instance as its first parameter. There is no dispatch to
        // arrange: the checker resolved every call site, so a method call is a
        // static call and `this` is an ordinary argument.
        if node.kind == NodeKind::Syntax(syntax::CLASS_DECLARATION) {
            let members: Vec<NodeId> = {
                let probe = FuncBuilder::new(snapshot);
                probe
                    .children(id)
                    .into_iter()
                    .filter(|child| {
                        matches!(
                            probe.kind_of(*child),
                            Some(syntax::METHOD_DECLARATION | syntax::CONSTRUCTOR)
                        )
                    })
                    .collect()
            };
            for member in members {
                let mut builder = FuncBuilder::new(snapshot);
                match builder.lower_method(id, member) {
                    Ok(func) => lowered.program.funcs.push(func),
                    Err(diagnostic) => lowered.diagnostics.push(diagnostic),
                }
                collect_layouts(&mut lowered.program, builder.layouts);
            }
            continue;
        }

        if node.kind != NodeKind::Syntax(syntax::FUNCTION_DECLARATION) {
            continue;
        }
        let mut builder = FuncBuilder::new(snapshot);
        match builder.lower_function(id) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => lowered.diagnostics.push(diagnostic),
        }
        collect_layouts(&mut lowered.program, builder.layouts);
    }

    canonicalize_objects(&mut lowered.program);
    lowered
}

/// Merge a function's discovered layouts into the program's.
///
/// A layout is a property of the type, not of the function that happened to
/// mention it first.
fn collect_layouts(program: &mut Program, layouts: Vec<Layout>) {
    for layout in layouts {
        if let Some(existing) = program
            .layouts
            .iter_mut()
            .find(|known| known.same_shape(&layout.fields))
        {
            for ty in layout.types {
                if !existing.types.contains(&ty) {
                    existing.types.push(ty);
                }
            }
            // A declared name beats a generated one, and the two functions that
            // mention a type may be discovered in either order.
            if existing.name.starts_with("Type") && !layout.name.starts_with("Type") {
                existing.name = layout.name;
            }
        } else {
            program.layouts.push(layout);
        }
    }
}

/// Give structurally identical object types one identity.
///
/// TypeScript is structurally typed, so `Point` and the anonymous
/// `{ x: number; y: number }` of a literal returned as one *are* the same type
/// — but the checker gives them different ids, and `HirType` compares by id.
/// Left alone, a `return { x, y }` from a function declared to return `Point`
/// looks like a representation change and earns a conversion between two
/// pointers to the same struct.
///
/// Rewriting every object type to its layout's representative makes `HirType`
/// equality mean what it should: *the same representation*.
fn canonicalize_objects(program: &mut Program) {
    let representatives: Vec<(Vec<TypeId>, TypeId)> = program
        .layouts
        .iter()
        .filter_map(|layout| Some((layout.types.clone(), *layout.types.first()?)))
        .collect();

    let canonical = |ty: &mut HirType| {
        if let HirType::Managed(ManagedType::Object(id)) = ty
            && let Some((_, representative)) = representatives
                .iter()
                .find(|(members, _)| members.contains(id))
        {
            *id = *representative;
        }
    };

    for func in &mut program.funcs {
        canonical(&mut func.return_type);
        for param in &mut func.params {
            canonical(&mut param.ty);
        }
        for value in &mut func.values {
            canonical(&mut value.ty);
        }
    }
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

        // A union whose members all share one representation has that
        // representation. `0 | 1 | 2` is three literal types and one machine
        // type, and refusing it would reject the most useful thing TypeScript
        // can tell this compiler about a parameter.
        //
        // A union whose members disagree — `number | undefined`, `string | number`
        // — needs a tagged representation, which is a decision this pass does
        // not get to make on its own.
        TypeKind::Union(members) => {
            let mut shared: Option<HirType> = None;
            for member in members {
                let member = representation(snapshot, *member)?;
                match &shared {
                    Some(existing) if *existing != member => return None,
                    _ => shared = Some(member),
                }
            }
            shared?
        }

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

/// A block under construction.
struct PartialBlock {
    params: Vec<ValueId>,
    ops: Vec<ValueId>,
    /// `None` until the block is terminated. A block that reaches its end without
    /// one is still open and will be given a jump or a return.
    terminator: Option<Terminator>,
}

/// Builds one function.
struct FuncBuilder<'a> {
    snapshot: &'a SemanticSnapshot,
    /// Every value the function defines.
    values: Vec<Op>,
    blocks: Vec<PartialBlock>,
    current: BlockId,
    /// Symbol index → the value holding it.
    ///
    /// This is what makes two identifiers with one symbol become one value
    /// rather than two loads.
    bindings: rustc_hash::FxHashMap<u32, ValueId>,
    /// Layouts discovered while lowering this function.
    layouts: Vec<Layout>,
    /// The receiver, in a method.
    this: Option<ValueId>,
}

impl<'a> FuncBuilder<'a> {
    fn new(snapshot: &'a SemanticSnapshot) -> Self {
        Self {
            snapshot,
            values: Vec::new(),
            blocks: vec![PartialBlock {
                params: Vec::new(),
                ops: Vec::new(),
                terminator: None,
            }],
            current: BlockId(0),
            bindings: rustc_hash::FxHashMap::default(),
            layouts: Vec::new(),
            this: None,
        }
    }

    /// Add a parameter to a block and return the value it defines.
    ///
    /// A block parameter is a value like any other, but it belongs to the block
    /// rather than to the operation list — nothing computes it, a predecessor
    /// supplies it.
    fn push_block_param(&mut self, block: BlockId, ty: HirType, origin: Origin) -> ValueId {
        let index = u32::try_from(self.blocks[block.0 as usize].params.len()).unwrap_or(0);
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op {
            kind: OpKind::BlockParam(index),
            ty,
            origin,
        });
        self.blocks[block.0 as usize].params.push(id);
        id
    }

    /// Start a new block and return its id. Does not switch to it.
    fn new_block(&mut self) -> BlockId {
        self.blocks.push(PartialBlock {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: None,
        });
        BlockId(u32::try_from(self.blocks.len() - 1).unwrap_or(u32::MAX))
    }

    fn switch_to(&mut self, block: BlockId) {
        self.current = block;
    }

    /// Whether the current block has already ended.
    ///
    /// A `return` inside a branch terminates its block, and appending a jump
    /// after it would put two terminators in one block.
    fn is_terminated(&self) -> bool {
        self.blocks[self.current.0 as usize].terminator.is_some()
    }

    /// End the current block, unless something already did.
    fn terminate(&mut self, terminator: Terminator) {
        let block = &mut self.blocks[self.current.0 as usize];
        if block.terminator.is_none() {
            block.terminator = Some(terminator);
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
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op { kind, ty, origin });
        self.blocks[self.current.0 as usize].ops.push(id);
        id
    }

    fn unsupported(&self, id: NodeId, what: &str) -> Diagnostic {
        Diagnostic::error(
            "NTS1001",
            format!("{what} is not supported by this lowering yet"),
            self.location(id),
        )
    }

    /// One method or constructor of a class, as a function taking the instance.
    ///
    /// There is no dispatch to arrange. The checker resolved every call site, so
    /// `c.advance()` names one target and lowers to a static call with `c` as
    /// the first argument — which is what a method *is* once the receiver is
    /// explicit. A vtable only becomes necessary where a call site has more than
    /// one possible target, and TypeScript tells us when that is.
    fn lower_method(&mut self, class: NodeId, member: NodeId) -> Result<Func, Diagnostic> {
        let class_name = self
            .children(class)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            .and_then(|child| self.node(child).text.clone())
            .ok_or_else(|| self.unsupported(class, "an anonymous class"))?;

        // A static method has no receiver: it is a namespaced function, and its
        // call sites name the class rather than an instance. Lowering one as if
        // it took `this` would give it a parameter no caller passes.
        let modifiers = self.node(member).modifiers;
        if modifiers.contains(nts_semantic_schema::DeclarationModifiers::STATIC) {
            return Err(self.unsupported(member, "a static method"));
        }
        if modifiers.contains(nts_semantic_schema::DeclarationModifiers::ABSTRACT) {
            return Err(self.unsupported(member, "an abstract method"));
        }

        let is_constructor = self.kind_of(member) == Some(syntax::CONSTRUCTOR);
        let member_name = if is_constructor {
            "constructor".to_owned()
        } else {
            self.children(member)
                .into_iter()
                .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
                .and_then(|child| self.node(child).text.clone())
                .ok_or_else(|| self.unsupported(member, "a method with a computed name"))?
        };

        // `#` cannot appear in a TypeScript identifier, so a qualified name
        // cannot collide with a plain function's.
        let name = format!("{class_name}#{member_name}");

        // `this` is parameter zero. Its type is the class's instance type, which
        // is what the checker gives the class declaration's name.
        let instance = self
            .type_of(class)
            .ok_or_else(|| self.unsupported(class, "a class of unrepresentable type"))?;
        let origin = self.origin(member);
        let receiver = self.push(OpKind::Param(0), instance.clone(), origin.clone());
        self.this = Some(receiver);
        let mut params = vec![Param {
            name: "this".to_owned(),
            ty: instance.clone(),
            origin: origin.clone(),
            known: Facts::TOP,
        }];

        for child in self.children(member) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            params.push(self.lower_param(child, index)?);
        }

        let body = self
            .children(member)
            .into_iter()
            .rev()
            .find(|child| self.kind_of(*child) == Some(syntax::BLOCK))
            .ok_or_else(|| self.unsupported(member, "a method without a body"))?;

        // A constructor returns nothing. It could return the instance -- it has
        // one in hand -- but the caller allocated that instance and already
        // names it, so returning it hands the caller a second reference to an
        // object it is already holding. Under reference counting that is a
        // retain and a release per construction for no gain, and under any
        // provider it is a copy the C compiler has to see through.
        let return_type = if is_constructor {
            HirType::Void
        } else {
            self.children(member)
                .into_iter()
                .filter(|child| {
                    !matches!(
                        self.kind_of(*child),
                        Some(syntax::PARAMETER | syntax::IDENTIFIER)
                    ) && *child != body
                })
                .find_map(|child| self.type_of(child))
                .unwrap_or(HirType::Void)
        };

        self.lower_block(body)?;
        self.terminate(Terminator::Return(None));

        // A method is reachable from outside exactly when its class is, so the
        // class's `export` is what makes it a root.
        let exported = self
            .node(class)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::EXPORT);
        let mut func = self.finish(name, params, return_type, origin, exported);
        // A constructor runs over an object `new` allocated a moment ago, so
        // every field it writes is writing over a zero.
        func.initializes_receiver = is_constructor;
        Ok(func)
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

        // A body that falls off its end returns nothing. TypeScript already
        // rejects that for a non-void function, so reaching it means void.
        self.terminate(Terminator::Return(None));

        let origin = self.origin(id);
        let exported = self
            .node(id)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::EXPORT);
        Ok(self.finish(name, params, return_type, origin, exported))
    }

    /// Assemble what has been built into a function.
    fn finish(
        &mut self,
        name: String,
        params: Vec<Param>,
        return_type: HirType,
        origin: Origin,
        exported: bool,
    ) -> Func {
        let blocks = std::mem::take(&mut self.blocks)
            .into_iter()
            .map(|block| Block {
                params: block.params,
                ops: block.ops,
                // Every block is terminated by construction: an open one is only
                // possible if a lowering forgot, and Unreachable states that
                // rather than leaving a malformed function.
                terminator: block.terminator.unwrap_or(Terminator::Unreachable),
            })
            .collect();

        Func {
            name,
            params,
            return_type,
            values: std::mem::take(&mut self.values),
            blocks,
            origin,
            exported,
            // Set by the caller: `finish` does not know what it is assembling,
            // and a seventh positional bool next to `exported` would be a
            // parameter waiting to be passed in the wrong order.
            initializes_receiver: false,
        }
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
        // What the declared type says, before anything in the body is seen.
        let known = self
            .snapshot
            .node_types
            .get(&name_node)
            .map_or(Facts::TOP, |declared| {
                known_values(self.snapshot, *declared, 0)
            });
        let value = self.push(OpKind::Param(index), ty.clone(), origin.clone());
        // Bound by symbol, so every later mention of this name resolves to the
        // same value rather than to a fresh load.
        if let Some(symbol) = self.node(name_node).symbol {
            self.bindings.insert(symbol.0, value);
        }

        Ok(Param {
            name,
            ty,
            origin,
            known,
        })
    }

    fn lower_block(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        for statement in self.children(id) {
            // Everything after a `return` in the same block is dead. Lowering it
            // would put operations in a block that has already ended.
            if self.is_terminated() {
                break;
            }
            self.lower_statement(statement)?;
        }
        Ok(())
    }

    /// Symbols assigned anywhere inside a subtree.
    ///
    /// Collected before a loop body is lowered, because the header needs a
    /// parameter for each of them *before* the body can refer to it — the body
    /// reads the value the previous iteration produced, which does not exist yet.
    fn assigned_symbols(&self, root: NodeId, into: &mut Vec<u32>) {
        // Every form that writes to a name, not just `=`. Missing one does not
        // fail loudly: the header simply gets no parameter for that name, the
        // loop reads the value it had on entry, and the back edge never passes
        // the update. `for (let i = 0; i < n; i++)` then runs forever, and the
        // only thing that catches it is the SSA verifier noticing that the exit
        // reads a value the body defined.
        let written = match self.kind_of(root) {
            Some(syntax::BINARY_EXPRESSION) => {
                let children = self.children(root);
                match children.as_slice() {
                    [target, operator, _] => {
                        let token = self.kind_of(*operator).unwrap_or(0);
                        if token == syntax::EQUALS_TOKEN || compound_operator(token).is_some() {
                            Some(*target)
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => {
                let NodeData::Children { small, .. } = self.node(root).data else {
                    return;
                };
                matches!(
                    small & syntax::prefix_operator::MASK,
                    syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS
                )
                .then(|| self.children(root).first().copied())
                .flatten()
            }
            // Every postfix operator is a step, so no operator check is needed.
            Some(syntax::POSTFIX_UNARY_EXPRESSION) => self.children(root).first().copied(),
            _ => None,
        };

        // Only a bare name is carried. `box.cell = c` and `xs[i] = c` write
        // *through* a reference and leave the reference itself alone, so they
        // need no loop parameter -- and taking the target's symbol anyway would
        // pick up the class member `cell`, a symbol no local scope declares,
        // which then looks like an assignment to a name from an enclosing scope
        // and gets the loop refused.
        if let Some(target) = written
            && self.kind_of(target) == Some(syntax::IDENTIFIER)
            && let Some(symbol) = self.node(target).symbol
            && !into.contains(&symbol.0)
        {
            into.push(symbol.0);
        }

        for child in &self.node(root).children {
            self.assigned_symbols(*child, into);
        }
    }

    /// Symbols *declared* anywhere inside a subtree.
    ///
    /// A name declared inside a loop body is fresh on every iteration, so it is
    /// not carried across the back edge however often the body assigns it.
    /// Treating it as carried asks the header for a value that does not exist
    /// before the loop — which is the shape of `let x = 0` inside an outer loop,
    /// and therefore of every nested loop written the obvious way.
    fn declared_symbols(&self, root: NodeId, into: &mut Vec<u32>) {
        if self.kind_of(root) == Some(syntax::VARIABLE_DECLARATION)
            && let Some(name) = self.children(root).first()
            && let Some(symbol) = self.node(*name).symbol
        {
            into.push(symbol.0);
        }
        for child in &self.node(root).children {
            self.declared_symbols(*child, into);
        }
    }

    /// `while (c) { .. }`.
    ///
    /// # Where block parameters earn their keep
    ///
    /// A variable the body assigns has a different value on each iteration, and
    /// the header has to see whichever one the previous iteration produced. That
    /// is exactly a block parameter: the entry passes the initial value, the back
    /// edge passes the updated one, and the body reads the parameter.
    ///
    /// The parameters are created before the body is lowered, because the body
    /// refers to them. Which variables need one is a syntactic question —
    /// [`Self::assigned_symbols`] — answered by scanning the body first.
    fn lower_while(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let [condition, body] = children.as_slice() else {
            return Err(self.unsupported(id, "a `while` of unexpected shape"));
        };

        let mut carried = Vec::new();
        self.assigned_symbols(*body, &mut carried);
        let mut declared = Vec::new();
        self.declared_symbols(*body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let header = self.new_block();
        let origin = self.origin(id);
        let (params, exit) = self.enter_loop(id, header, &carried, Some(*condition), &origin)?;

        self.lower_statement(*body)?;
        self.close_loop(header, &carried, &params, exit);
        Ok(())
    }

    /// Open a loop: jump to the header, give it a parameter per carried name,
    /// test the condition, and leave the builder positioned in the body.
    ///
    /// Returns the header's parameters and the exit block.
    fn enter_loop(
        &mut self,
        id: NodeId,
        header: BlockId,
        carried: &[u32],
        condition: Option<NodeId>,
        origin: &Origin,
    ) -> Result<(Vec<ValueId>, BlockId), Diagnostic> {
        // The values entering the loop, in the order the parameters take them.
        let mut incoming = Vec::new();
        for symbol in carried {
            let value = *self.bindings.get(symbol).ok_or_else(|| {
                self.unsupported(id, "a loop assigning a name declared outside it")
            })?;
            incoming.push(value);
        }
        self.terminate(Terminator::Jump {
            target: header,
            args: incoming.clone(),
        });

        // Inside the loop, each carried name *is* its parameter.
        self.switch_to(header);
        let mut params = Vec::new();
        for (symbol, entering) in carried.iter().zip(&incoming) {
            let ty = self.values[entering.0 as usize].ty.clone();
            let param = self.push_block_param(header, ty, origin.clone());
            self.bindings.insert(*symbol, param);
            params.push(param);
        }

        let body_block = self.new_block();
        let exit = self.new_block();
        match condition {
            Some(condition) => {
                let cond = self.lower_expression(condition)?;
                self.terminate(Terminator::Branch {
                    cond,
                    then_target: body_block,
                    then_args: Vec::new(),
                    else_target: exit,
                    else_args: Vec::new(),
                });
            }
            // `for (;;)`. The exit block stays reachable only through a `return`
            // inside the body, which is exactly what the source says.
            None => self.terminate(Terminator::Jump {
                target: body_block,
                args: Vec::new(),
            }),
        }

        self.switch_to(body_block);
        Ok((params, exit))
    }

    /// Close a loop: take the back edge, restore the carried names, and continue
    /// after the loop.
    fn close_loop(&mut self, header: BlockId, carried: &[u32], params: &[ValueId], exit: BlockId) {
        if !self.is_terminated() {
            // The back edge carries whatever the body left in each name.
            let updated: Vec<ValueId> =
                carried.iter().map(|symbol| self.bindings[symbol]).collect();
            self.terminate(Terminator::Jump {
                target: header,
                args: updated,
            });
        }

        // After the loop the live value of a carried name is the header
        // parameter, and the bindings must be put back to it. The body
        // overwrote them with values defined in the body block — which the exit
        // does not dominate, so using one after the loop is invalid SSA that
        // reads whatever the last iteration happened to leave.
        for (symbol, param) in carried.iter().zip(params) {
            self.bindings.insert(*symbol, *param);
        }
        self.switch_to(exit);
    }

    /// `for (init; cond; update) body`.
    ///
    /// The same shape as a `while`, with two differences that matter. The
    /// initializer runs once *before* the header, so a name it declares is in
    /// scope at the header and is carried across the back edge — unlike a name
    /// declared in the body, which is fresh each iteration. And the update runs
    /// at the end of the body, so the back edge carries what it produced.
    ///
    /// A missing condition is `for (;;)`: the loop is entered unconditionally.
    fn lower_for(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let Some([initializer, condition, update, body]) = self.child_slots::<4>(id) else {
            return Err(self.unsupported(id, "a `for` of unexpected shape"));
        };
        let Some(body) = body else {
            return Err(self.unsupported(id, "a `for` without a body"));
        };

        if let Some(initializer) = initializer {
            if self.kind_of(initializer) == Some(syntax::VARIABLE_DECLARATION_LIST) {
                self.lower_variable_statement(initializer)?;
            } else {
                self.lower_expression(initializer)?;
            }
        }

        // The update assigns the loop variable too, so it counts toward what is
        // carried. Missing it is how `i` ends up defined in the body and read
        // from the header.
        let mut carried = Vec::new();
        self.assigned_symbols(body, &mut carried);
        if let Some(update) = update {
            self.assigned_symbols(update, &mut carried);
        }
        let mut declared = Vec::new();
        self.declared_symbols(body, &mut declared);
        carried.retain(|symbol| !declared.contains(symbol));

        let header = self.new_block();
        let origin = self.origin(id);
        let (params, exit) = self.enter_loop(id, header, &carried, condition, &origin)?;

        self.lower_statement(body)?;
        if let Some(update) = update
            && !self.is_terminated()
        {
            self.lower_expression(update)?;
        }
        self.close_loop(header, &carried, &params, exit);
        Ok(())
    }

    /// A node's children assigned to their declared property slots.
    ///
    /// [`Self::children`] returns only the children that are *present*, so
    /// nothing about a position identifies which property it is. The node's
    /// presence bitmask does, one bit per property in visitor order.
    ///
    /// Reading positionally instead is wrong in two different ways, both of
    /// which happened: `for (;; i++)` becomes an infinite loop with `i++` as its
    /// condition, and `c ? a : b` picks up the `:` token as its true branch —
    /// which at least fails loudly, being a token where an expression belongs.
    fn child_slots<const N: usize>(&self, id: NodeId) -> Option<[Option<NodeId>; N]> {
        let NodeData::Children { present, .. } = self.node(id).data else {
            return None;
        };
        let mut children = self.children(id).into_iter();
        let mut slots = [None; N];
        for (bit, slot) in slots.iter_mut().enumerate() {
            if present & (1 << bit) != 0 {
                *slot = children.next();
            }
        }
        Some(slots)
    }

    /// `i++` / `i--`, whose value is what the name held *before* the step.
    fn lower_postfix_unary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let NodeData::Children { small, .. } = self.node(id).data else {
            return Err(self.unsupported(id, "a step expression without operator data"));
        };
        let children = self.children(id);
        let [operand] = children.as_slice() else {
            return Err(self.unsupported(id, "a step expression of unexpected shape"));
        };
        // One bit, not the prefix table: `++` is 0 and `--` is 1.
        let op = if small & syntax::postfix_operator::MASK == syntax::postfix_operator::MINUS_MINUS
        {
            BinOp::Sub
        } else {
            BinOp::Add
        };
        let before = self.lower_expression(*operand)?;
        self.step(id, *operand, op, before)?;
        Ok(before)
    }

    /// `target = value`, for each kind of target.
    ///
    /// Three different operations wear one spelling. A name rebinds, which
    /// emits nothing at all -- the binding *is* the assignment. A field or an
    /// element writes through a reference, where there is no name to rebind and
    /// the store is the whole of the effect.
    fn lower_assignment(
        &mut self,
        id: NodeId,
        target: NodeId,
        source: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let lhs_node = &target;
        let rhs_node = &source;

        // `xs[i] = v` writes through a reference; there is no name to
        // rebind, and the store is the whole of the effect.
        if self.kind_of(*lhs_node) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let children = self.children(*lhs_node);
            let [target, member] = children.as_slice() else {
                return Err(self.unsupported(*lhs_node, "a property of unexpected shape"));
            };
            let object = self.lower_expression(*target)?;
            let HirType::Managed(ManagedType::Object(type_id)) =
                self.values[object.0 as usize].ty.clone()
            else {
                return Err(self.unsupported(*lhs_node, "assigning to this property"));
            };
            let layout = self.layout_of(*lhs_node, type_id)?;
            let name = self
                .node(*member)
                .text
                .clone()
                .ok_or_else(|| self.unsupported(*member, "a computed property name"))?;
            let field = layout.index_of(&name).ok_or_else(|| {
                self.unsupported(*lhs_node, "a property the type does not declare")
            })?;
            if layout.fields[field as usize].readonly {
                return Err(self.unsupported(*lhs_node, "assigning to a readonly property"));
            }
            let value = self.lower_expression(*rhs_node)?;
            let origin = self.origin(id);
            self.push(
                OpKind::FieldSet {
                    object,
                    field,
                    value,
                },
                HirType::Void,
                origin,
            );
            return Ok(value);
        }

        if self.kind_of(*lhs_node) == Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
            let (array, index) = self.element_access_parts(*lhs_node)?;
            let value = self.lower_expression(*rhs_node)?;
            let origin = self.origin(id);
            self.push(
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    checked: true,
                },
                HirType::Void,
                origin,
            );
            return Ok(value);
        }

        let value = self.lower_expression(*rhs_node)?;
        let symbol = self
            .node(*lhs_node)
            .symbol
            .ok_or_else(|| self.unsupported(*lhs_node, "assignment to a computed target"))?;
        self.bindings.insert(symbol.0, value);
        Ok(value)
    }

    /// A bitwise operation, with the coercions the language requires.
    ///
    /// `a & b` is `ToInt32(a) & ToInt32(b)` reinterpreted as a number, and the
    /// coercions are emitted as their own operations so the analysis can see
    /// that their results are integers. `>>>` coerces its left operand unsigned;
    /// the shift count is masked either way.
    fn push_bitwise(
        &mut self,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
        ty: HirType,
        origin: &Origin,
    ) -> ValueId {
        let left_coercion = if matches!(op, BinOp::UShr) {
            UnOp::ToUint32
        } else {
            UnOp::ToInt32
        };
        let left = self.push(
            OpKind::Unary {
                op: left_coercion,
                operand: lhs,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let right = self.push(
            OpKind::Unary {
                op: UnOp::ToInt32,
                operand: rhs,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.push(
            OpKind::Binary {
                op,
                lhs: left,
                rhs: right,
            },
            ty,
            origin.clone(),
        )
    }

    /// The shared half of `++`/`--`: add or subtract one and rebind the name.
    fn step(
        &mut self,
        id: NodeId,
        target: NodeId,
        op: BinOp,
        current: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a step of unrepresentable type"))?;
        let one = self.push(OpKind::ConstFloat(1.0), ty.clone(), origin.clone());
        let stepped = self.push(
            OpKind::Binary {
                op,
                lhs: current,
                rhs: one,
            },
            ty,
            origin,
        );
        let symbol = self
            .node(target)
            .symbol
            .ok_or_else(|| self.unsupported(target, "a step of something that is not a name"))?;
        self.bindings.insert(symbol.0, stepped);
        Ok(stepped)
    }

    /// `if (c) { .. } else { .. }`.
    ///
    /// # The merge is where the arms have to agree
    ///
    /// Each arm may leave a different value in the same name. After the `if`,
    /// which one is live depends on the edge taken — which is precisely what a
    /// block parameter is for, and the same mechanism a loop header uses.
    ///
    /// Without it, the name keeps whatever value the last-lowered arm produced,
    /// defined in a block the merge does not dominate. That is invalid SSA. It
    /// also *compiles*, to code that reads a variable the other path never wrote,
    /// which is why the verifier exists rather than a code review.
    ///
    /// Only names the arms disagree about become parameters. One they agree on is
    /// already defined before the branch — two arms cannot produce the same
    /// [`ValueId`] otherwise — so it dominates the merge, and a parameter for it
    /// would be a copy carrying no information.
    fn lower_if(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let children = self.children(id);
        let (condition, then_branch, else_branch) = match children.as_slice() {
            [condition, then_branch] => (*condition, *then_branch, None),
            [condition, then_branch, else_branch] => (*condition, *then_branch, Some(*else_branch)),
            _ => return Err(self.unsupported(id, "an `if` of unexpected shape")),
        };

        let origin = self.origin(id);
        let cond = self.lower_expression(condition)?;
        let then_block = self.new_block();

        // With no `else`, the false edge goes straight to the merge. Allocating an
        // else block for it would leave a block whose only content is a jump —
        // once per `if` without an else, which is most of them.
        let (else_block, preallocated) = if else_branch.is_some() {
            (self.new_block(), None)
        } else {
            let merge = self.new_block();
            (merge, Some(merge))
        };

        // Remembered because the false edge's arguments are not known until the
        // merge has parameters, which is after both arms are lowered.
        let branch_block = self.current;
        self.terminate(Terminator::Branch {
            cond,
            then_target: then_block,
            then_args: Vec::new(),
            else_target: else_block,
            else_args: Vec::new(),
        });

        // What each name held on entry: the baseline the arms are compared
        // against, and what the false edge carries when there is no `else`.
        let entry = self.bindings.clone();

        self.switch_to(then_block);
        self.lower_statement(then_branch)?;
        // The block the arm *ended* in, which nested control flow moves away from
        // the block it started in. Terminating `then_block` instead would leave
        // the real tail without a terminator.
        let then_tail = self.current;
        let then_open = !self.is_terminated();
        let then_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        let (else_tail, else_open, else_bindings) = match else_branch {
            Some(else_branch) => {
                self.switch_to(else_block);
                self.lower_statement(else_branch)?;
                let tail = self.current;
                let open = !self.is_terminated();
                let bindings = std::mem::replace(&mut self.bindings, entry.clone());
                (tail, open, bindings)
            }
            // The false edge is the merge, which is open by construction and
            // changes nothing.
            None => (else_block, true, entry.clone()),
        };

        if !then_open && !else_open {
            // Both arms ended. Anything after the `if` is unreachable, and the
            // enclosing block is already closed.
            return Ok(());
        }

        let merge = preallocated.unwrap_or_else(|| self.new_block());

        let mut merged: Vec<(u32, ValueId, ValueId)> = Vec::new();
        if then_open && else_open {
            for (symbol, entering) in &entry {
                let from_then = then_bindings.get(symbol).copied().unwrap_or(*entering);
                let from_else = else_bindings.get(symbol).copied().unwrap_or(*entering);
                if from_then != from_else {
                    merged.push((*symbol, from_then, from_else));
                }
            }
            // Sorted because the source is a hash map: without this the parameter
            // list would vary between runs of one compiler on one input, and the
            // snapshot digest would stop being a cache key.
            merged.sort_unstable();
        }

        let mut params = Vec::new();
        for (symbol, from_then, _) in &merged {
            let ty = self.values[from_then.0 as usize].ty.clone();
            params.push((*symbol, self.push_block_param(merge, ty, origin.clone())));
        }

        if then_open {
            self.switch_to(then_tail);
            let args = merged.iter().map(|(_, from_then, _)| *from_then).collect();
            self.terminate(Terminator::Jump {
                target: merge,
                args,
            });
        }
        if else_branch.is_some() {
            if else_open {
                self.switch_to(else_tail);
                let args = merged.iter().map(|(_, _, from_else)| *from_else).collect();
                self.terminate(Terminator::Jump {
                    target: merge,
                    args,
                });
            }
        } else if let Some(Terminator::Branch { else_args, .. }) =
            &mut self.blocks[branch_block.0 as usize].terminator
        {
            // The false edge points at the merge directly, so its arguments live
            // on the branch rather than on a jump of its own.
            *else_args = merged.iter().map(|(_, _, from_else)| *from_else).collect();
        }

        self.switch_to(merge);
        self.bindings = match (then_open, else_open) {
            // Only one arm reaches the merge, so its bindings are the live ones
            // outright — no parameter is needed to choose between them.
            (true, false) => then_bindings,
            (false, true) => else_bindings,
            _ => {
                let mut live = entry;
                for (symbol, param) in params {
                    live.insert(symbol, param);
                }
                live
            }
        };
        Ok(())
    }

    fn lower_statement(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::RETURN_STATEMENT) => {
                let value = match self.children(id).first().copied() {
                    Some(expression) => Some(self.lower_expression(expression)?),
                    None => None,
                };
                self.terminate(Terminator::Return(value));
                Ok(())
            }
            Some(syntax::BLOCK) => self.lower_block(id),
            Some(syntax::IF_STATEMENT) => self.lower_if(id),
            Some(syntax::WHILE_STATEMENT) => self.lower_while(id),
            Some(syntax::FOR_STATEMENT) => self.lower_for(id),
            Some(syntax::EXPRESSION_STATEMENT) => {
                let Some(expression) = self.children(id).first().copied() else {
                    return Ok(());
                };
                self.lower_expression(expression)?;
                Ok(())
            }
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
            // Parentheses group; they compute nothing. Lowering the inner
            // expression is the whole of it — the grouping already happened when
            // the parser built the tree this shape.
            Some(syntax::PARENTHESIZED_EXPRESSION) => {
                let children = self.children(id);
                let [inner] = children.as_slice() else {
                    return Err(
                        self.unsupported(id, "a parenthesized expression of unexpected shape")
                    );
                };
                self.lower_expression(*inner)
            }
            Some(syntax::CONDITIONAL_EXPRESSION) => self.lower_conditional(id),
            Some(syntax::ARRAY_LITERAL_EXPRESSION) => self.lower_array_literal(id),
            Some(syntax::OBJECT_LITERAL_EXPRESSION) => self.lower_object_literal(id),
            Some(syntax::NEW_EXPRESSION) => self.lower_new(id),
            // `this` is parameter zero of a method. Outside one there is no
            // receiver to name.
            Some(syntax::THIS_KEYWORD) => self
                .this
                .ok_or_else(|| self.unsupported(id, "`this` outside a method")),
            Some(syntax::ELEMENT_ACCESS_EXPRESSION) => self.lower_element_access(id),
            Some(syntax::PROPERTY_ACCESS_EXPRESSION) => self.lower_property_access(id),
            // `x!`, `x as T` and `x satisfies T` are claims about types. The
            // first two narrow what the checker believes; the third asserts
            // without narrowing. None of them computes anything, so each lowers
            // to its operand — but the *claim* is not free: an `x!` on an
            // element access is the author asserting the index is in bounds, and
            // the bounds check is what makes that assertion checked rather than
            // assumed. `docs/any-unknown.md` calls this out as the general rule
            // for assertions.
            Some(
                syntax::NON_NULL_EXPRESSION | syntax::AS_EXPRESSION | syntax::SATISFIES_EXPRESSION,
            ) => {
                let children = self.children(id);
                let Some(inner) = children.first() else {
                    return Err(self.unsupported(id, "an assertion with no operand"));
                };
                self.lower_expression(*inner)
            }
            Some(syntax::PREFIX_UNARY_EXPRESSION) => self.lower_prefix_unary(id),
            Some(syntax::POSTFIX_UNARY_EXPRESSION) => self.lower_postfix_unary(id),
            Some(syntax::TRUE_KEYWORD) => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin))
            }
            Some(syntax::FALSE_KEYWORD) => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstBool(false), HirType::Bool, origin))
            }
            _ => Err(self.unsupported(id, "this expression")),
        }
    }

    /// `const x = expr` / `let x = expr`.
    ///
    /// A declaration with an initializer binds its symbol to the initializer's
    /// value — no slot and no store, because nothing here can reassign it yet.
    /// When assignment arrives, a `let` will need one and a `const` still will
    /// not, which is what the snapshot's variable kind is for.
    /// `[a, b, c]`.
    ///
    /// An allocation and a store per element. The length is known here, so it
    /// is a constant, which is what lets the analysis prove that every one of
    /// these stores is in bounds — the checks below are elided before they cost
    /// anything.
    fn lower_array_literal(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "an array literal of unrepresentable type"))?;
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(id, "an array literal that is not an array"));
        }
        let origin = self.origin(id);
        let elements = self.children(id);

        #[allow(clippy::cast_precision_loss)]
        let count = elements.len() as f64;
        let length = self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin.clone());
        let array = self.push(OpKind::ArrayNew { length }, ty, origin.clone());

        for (index, element) in elements.iter().enumerate() {
            let value = self.lower_expression(*element)?;
            #[allow(clippy::cast_precision_loss)]
            let position = index as f64;
            let index = self.push(
                OpKind::ConstFloat(position),
                HirType::NUMBER,
                origin.clone(),
            );
            self.push(
                OpKind::ArraySet {
                    array,
                    index,
                    value,
                    checked: true,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(array)
    }

    /// `[]`, with the element type supplied from outside.
    fn lower_empty_array(&mut self, id: NodeId, ty: HirType) -> Result<ValueId, Diagnostic> {
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(id, "an empty array literal that is not an array"));
        }
        let origin = self.origin(id);
        let length = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        Ok(self.push(OpKind::ArrayNew { length }, ty, origin))
    }

    /// `{ x: 1, y }`.
    ///
    /// An allocation and a store per field. The fields are written in *layout*
    /// order rather than source order, so two literals of one type produce the
    /// same stores — which is what lets a later pass recognize them as the same
    /// shape.
    fn lower_object_literal(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "an object literal of unrepresentable type"))?;
        let HirType::Managed(ManagedType::Object(type_id)) = ty else {
            return Err(self.unsupported(id, "an object literal that is not an object"));
        };
        let layout = self.layout_of(id, type_id)?;
        let origin = self.origin(id);
        let object = self.push(OpKind::ObjectNew, ty, origin.clone());

        // Source order, since an initializer may have effects and they happen
        // where the author wrote them. The *field index* is what puts them in
        // layout order.
        for property in self.children(id) {
            let (name, value) = self.property_parts(property)?;
            let Some(field) = layout.index_of(&name) else {
                return Err(self.unsupported(property, "a property the type does not declare"));
            };
            self.push(
                OpKind::FieldSet {
                    object,
                    field,
                    value,
                },
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(object)
    }

    /// The name and value of one property in an object literal.
    fn property_parts(&mut self, id: NodeId) -> Result<(String, ValueId), Diagnostic> {
        match self.kind_of(id) {
            Some(syntax::PROPERTY_ASSIGNMENT) => {
                let children = self.children(id);
                let [name, initializer] = children.as_slice() else {
                    return Err(self.unsupported(id, "a property of unexpected shape"));
                };
                let text = self
                    .node(*name)
                    .text
                    .clone()
                    .ok_or_else(|| self.unsupported(*name, "a computed property name"))?;
                let value = self.lower_expression(*initializer)?;
                Ok((text, value))
            }
            // `{ x }` — one node serving as both the field name and a reference
            // to a variable, and the checker gives it the *property's* symbol.
            // The variable's symbol is what `getShorthandAssignmentValueSymbol`
            // answers, which the snapshot does not carry yet; until it does, the
            // reference is resolved by name against what is in scope.
            //
            // That is sound only while the name is unambiguous, so a shadowed
            // one is refused rather than guessed at.
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                let children = self.children(id);
                let [name] = children.as_slice() else {
                    return Err(self.unsupported(id, "a shorthand property of unexpected shape"));
                };
                let text = self
                    .node(*name)
                    .text
                    .clone()
                    .ok_or_else(|| self.unsupported(*name, "a shorthand without a name"))?;

                let mut found = self.bindings.iter().filter(|(symbol, _)| {
                    self.snapshot
                        .symbols
                        .get(**symbol as usize)
                        .is_some_and(|record| record.name == text)
                });
                let value = match (found.next(), found.next()) {
                    (Some((_, value)), None) => *value,
                    (Some(_), Some(_)) => {
                        return Err(
                            self.unsupported(*name, "a shorthand naming a shadowed binding")
                        );
                    }
                    _ => return Err(self.unsupported(*name, "a shorthand naming nothing in scope")),
                };
                Ok((text, value))
            }
            _ => Err(self.unsupported(id, "this kind of property")),
        }
    }

    /// The layout of an object type, computed once and remembered.
    ///
    /// Declaration order, which is the order the checker reports members in.
    /// When classes arrive this becomes base-first (RFC §8.1), so that a
    /// subclass's prefix is its base's layout and an upcast is free.
    fn layout_of(&mut self, id: NodeId, ty: TypeId) -> Result<Layout, Diagnostic> {
        if let Some(known) = self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))
        {
            return Ok(known.clone());
        }
        let record =
            self.snapshot.types.get(ty.0 as usize).ok_or_else(|| {
                self.unsupported(id, "an object type that is not in the snapshot")
            })?;
        let TypeKind::Object { properties } = &record.kind else {
            return Err(self.unsupported(id, "an object type that was not decomposed"));
        };

        let mut fields = Vec::new();
        for property in properties {
            if property.accessor.is_some() {
                return Err(self.unsupported(id, "an object with an accessor"));
            }
            // A method is a member of the type but not a field of the object.
            // It has no storage: the checker resolved every call site, so it is
            // a function the call names directly rather than a slot to load
            // from. This is where a vtable would go if dispatch needed one.
            if matches!(
                self.snapshot
                    .types
                    .get(property.ty.0 as usize)
                    .map(|record| &record.kind),
                Some(TypeKind::Function(_))
            ) {
                continue;
            }
            if property.optional {
                // An optional field needs a presence bit, which changes the
                // layout rather than adding to it.
                return Err(self.unsupported(id, "an object with an optional property"));
            }
            // A reference field is a pointer. Under NoGC nothing is ever freed,
            // so it costs neither a write barrier nor a trace; which fields are
            // references is recorded on the layout for the collector that comes
            // later, because that is a fact about the layout and the layout is
            // decided here.
            let field_ty = representation(self.snapshot, property.ty)
                .ok_or_else(|| self.unsupported(id, "a property of unrepresentable type"))?;
            fields.push(Field {
                name: property.name.clone(),
                ty: field_ty,
                readonly: property.readonly,
            });
        }

        // The declared name where there is one. An anonymous object type —
        // `{ x: number }` written inline — has no symbol, so it is named after
        // its type id, which is at least stable and unique.
        let name = record
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(|| format!("Type{}", ty.0), |symbol| symbol.name.clone());
        // Structural, so a type whose shape is already laid out joins that
        // layout rather than getting one of its own. The first name wins, which
        // is usually the declared one -- an anonymous literal type tends to be
        // discovered second.
        if let Some(existing) = self
            .layouts
            .iter_mut()
            .find(|layout| layout.same_shape(&fields))
        {
            existing.types.push(ty);
            // A declared name beats a generated one, whichever was seen first.
            // The anonymous type of a literal is usually discovered before the
            // interface it is assigned to, and `NtsObj_Point` reads better than
            // `NtsObj_Type5`.
            if existing.name.starts_with("Type") && !name.starts_with("Type") {
                existing.name = name;
            }
            return Ok(existing.clone());
        }

        let layout = Layout {
            types: vec![ty],
            name,
            fields,
        };
        self.layouts.push(layout.clone());
        Ok(layout)
    }

    /// `new C(a, b)` — allocate, then run the constructor over it.
    ///
    /// The allocation is the value. The constructor writes through the pointer
    /// it is handed and returns nothing, so `new` is an allocation and a call
    /// rather than an allocation, a call, and a pointer round-trip that every
    /// stage downstream has to prove is the identity.
    fn lower_new(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let callee = *children
            .first()
            .ok_or_else(|| self.unsupported(id, "a `new` with no callee"))?;
        let class = self
            .node(callee)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(callee, "a computed constructor"))?;

        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a `new` of unrepresentable type"))?;
        let HirType::Managed(ManagedType::Object(type_id)) = ty else {
            return Err(self.unsupported(id, "a `new` that does not produce an object"));
        };
        // Laying the class out here is what makes its fields addressable; the
        // constructor is about to write every one of them.
        self.layout_of(id, type_id)?;

        let origin = self.origin(id);
        let object = self.push(OpKind::ObjectNew, ty.clone(), origin.clone());

        let mut args = vec![object];
        for argument in children.iter().skip(1) {
            args.push(self.lower_expression(*argument)?);
        }
        self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{class}#constructor")),
                args,
            },
            HirType::Void,
            origin,
        );
        Ok(object)
    }

    /// `xs[i]`, as a read. Writes are handled by the assignment lowering.
    fn lower_element_access(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let (array, index) = self.element_access_parts(id)?;
        // The element's representation comes from the *array*, not from the
        // access node's type. Under `noUncheckedIndexedAccess` — which is what
        // TypeScript actually knows — that type is `number | undefined`, and
        // there is no `undefined` to put in a double. What is stored in the
        // slot is a number; the `!` the author wrote is the claim that one is
        // there, and the bounds test is what checks it.
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[array.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(id, "indexing something that is not an array"));
        };
        let ty = *element;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ArrayGet {
                array,
                index,
                checked: true,
            },
            ty,
            origin,
        ))
    }

    /// The array and index of an `xs[i]`, lowered in source order.
    fn element_access_parts(&mut self, id: NodeId) -> Result<(ValueId, ValueId), Diagnostic> {
        let children = self.children(id);
        let [array, index] = children.as_slice() else {
            return Err(self.unsupported(id, "an element access of unexpected shape"));
        };
        let array_value = self.lower_expression(*array)?;
        if !matches!(
            self.values[array_value.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_))
        ) {
            return Err(self.unsupported(id, "indexing something that is not an array"));
        }
        let index_value = self.lower_expression(*index)?;
        Ok((array_value, index_value))
    }

    /// `xs.length`. Other members are not lowered yet.
    fn lower_property_access(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let [object, member] = children.as_slice() else {
            return Err(self.unsupported(id, "a property access of unexpected shape"));
        };
        let member_name = self
            .node(*member)
            .text
            .clone()
            .ok_or_else(|| self.unsupported(id, "a computed property name"))?;
        let value = self.lower_expression(*object)?;

        if let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[value.0 as usize].ty.clone()
        {
            let layout = self.layout_of(id, type_id)?;
            let field = layout
                .index_of(&member_name)
                .ok_or_else(|| self.unsupported(id, "a property the type does not declare"))?;
            let ty = layout.fields[field as usize].ty.clone();
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                ty,
                origin,
            ));
        }

        if member_name != "length" {
            return Err(self.unsupported(id, "this property"));
        }
        if !matches!(
            self.values[value.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_) | ManagedType::String)
        ) {
            return Err(self.unsupported(id, "`length` of something without one"));
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::Length(value), HirType::NUMBER, origin))
    }

    /// `c ? a : b`, and the short-circuiting `a && b` / `a || b`.
    ///
    /// All three are one shape: evaluate a condition, take one of two paths, and
    /// arrive at a value that depends on which. That is a merge block with a
    /// parameter — the same mechanism an `if` uses for a name the two arms
    /// disagree about, applied to a value with no name.
    ///
    /// The point of doing it this way rather than evaluating both sides is that
    /// both sides *must not* be evaluated: `a && expensive()` does not call
    /// `expensive` when `a` is falsy, and in a language with side effects that
    /// is a semantic difference rather than an optimization.
    fn lower_branching_value(
        &mut self,
        id: NodeId,
        condition: ValueId,
        then_branch: Branch,
        else_branch: Branch,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a conditional of unrepresentable type"))?;

        let then_block = self.new_block();
        let else_block = self.new_block();
        self.terminate(Terminator::Branch {
            cond: condition,
            then_target: then_block,
            then_args: Vec::new(),
            else_target: else_block,
            else_args: Vec::new(),
        });

        let entry = self.bindings.clone();
        self.switch_to(then_block);
        let then_value = self.evaluate(then_branch)?;
        let then_tail = self.current;
        let then_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        self.switch_to(else_block);
        let else_value = self.evaluate(else_branch)?;
        let else_tail = self.current;
        let else_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        // The two arms must agree about representation, since one parameter
        // receives both. They do whenever the checker gave the expression a type
        // at all; a `number | string` would not be lowerable in the first place.
        let merge = self.new_block();
        let result = self.push_block_param(merge, ty, origin.clone());

        let mut merged = Vec::new();
        for (symbol, entering) in &entry {
            let from_then = then_bindings.get(symbol).copied().unwrap_or(*entering);
            let from_else = else_bindings.get(symbol).copied().unwrap_or(*entering);
            if from_then != from_else {
                merged.push((*symbol, from_then, from_else));
            }
        }
        merged.sort_unstable();

        let mut params = Vec::new();
        for (symbol, from_then, _) in &merged {
            let carried = self.values[from_then.0 as usize].ty.clone();
            params.push((
                *symbol,
                self.push_block_param(merge, carried, origin.clone()),
            ));
        }

        self.switch_to(then_tail);
        let mut args = vec![then_value];
        args.extend(merged.iter().map(|(_, from_then, _)| *from_then));
        self.terminate(Terminator::Jump {
            target: merge,
            args,
        });

        self.switch_to(else_tail);
        let mut args = vec![else_value];
        args.extend(merged.iter().map(|(_, _, from_else)| *from_else));
        self.terminate(Terminator::Jump {
            target: merge,
            args,
        });

        self.switch_to(merge);
        self.bindings = entry;
        for (symbol, param) in params {
            self.bindings.insert(symbol, param);
        }
        Ok(result)
    }

    /// Produce a branch's value: either an expression to lower here, or one
    /// already computed before the branch.
    fn evaluate(&mut self, branch: Branch) -> Result<ValueId, Diagnostic> {
        match branch {
            Branch::Expression(node) => self.lower_expression(node),
            Branch::Value(value) => Ok(value),
        }
    }

    /// `c ? a : b`.
    fn lower_conditional(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        // condition, `?`, whenTrue, `:`, whenFalse — the punctuation is made of
        // children too, so the slots come from the presence bitmask.
        let Some([Some(condition), _, Some(when_true), _, Some(when_false)]) =
            self.child_slots::<5>(id)
        else {
            return Err(self.unsupported(id, "a conditional of unexpected shape"));
        };
        let condition = self.lower_expression(condition)?;
        let condition = self.truthy(id, condition);
        self.lower_branching_value(
            id,
            condition,
            Branch::Expression(when_true),
            Branch::Expression(when_false),
        )
    }

    /// `a && b` and `a || b`, which do not evaluate `b` unless they have to.
    fn lower_logical(
        &mut self,
        id: NodeId,
        and: bool,
        left: NodeId,
        right: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let first = self.lower_expression(left)?;
        let condition = self.truthy(id, first);
        // `a && b` is `b` when `a` is truthy and `a` otherwise; `a || b` is the
        // other way round. Neither yields a bool in general — `0 || 5` is `5`.
        let (then_branch, else_branch) = if and {
            (Branch::Expression(right), Branch::Value(first))
        } else {
            (Branch::Value(first), Branch::Expression(right))
        };
        self.lower_branching_value(id, condition, then_branch, else_branch)
    }

    /// A value as a condition, by JavaScript's rules.
    fn truthy(&mut self, id: NodeId, value: ValueId) -> ValueId {
        // A bool is already its own condition; anything else needs the rule.
        if matches!(self.values[value.0 as usize].ty, HirType::Bool) {
            return value;
        }
        let origin = self.origin(id);
        self.push(
            OpKind::Unary {
                op: UnOp::Truthy,
                operand: value,
            },
            HirType::Bool,
            origin,
        )
    }

    /// `-x`, `+x`, `!x`.
    ///
    /// # The operator is not a child
    ///
    /// A `BinaryExpression` holds its operator as a real token node, so
    /// [`Self::children`] returns it. A `PrefixUnaryExpression` does not: tsgo
    /// stores the operator as a `Kind` *field*, which the encoder packs into the
    /// node's small data as a dense index — see
    /// [`syntax::prefix_operator`] for why that index is not a `SyntaxKind`
    /// however firmly the encoder's documentation says it is. The only child is
    /// the operand.
    ///
    /// Unary `+` is `ToNumber`, which on something already typed `number` is the
    /// identity — including on `-0`, so it is dropped rather than lowered to an
    /// operation that would then have to preserve the sign of zero.
    fn lower_prefix_unary(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let NodeData::Children { small, .. } = self.node(id).data else {
            return Err(self.unsupported(id, "a unary expression without operator data"));
        };
        let children = self.children(id);
        let [operand] = children.as_slice() else {
            return Err(self.unsupported(id, "a unary expression of unexpected shape"));
        };

        // `++i` and `--i` step the name and evaluate to the *new* value, which
        // is the only way they differ from the postfix forms.
        if matches!(
            small & syntax::prefix_operator::MASK,
            syntax::prefix_operator::PLUS_PLUS | syntax::prefix_operator::MINUS_MINUS
        ) {
            let op =
                if small & syntax::prefix_operator::MASK == syntax::prefix_operator::MINUS_MINUS {
                    BinOp::Sub
                } else {
                    BinOp::Add
                };
            let current = self.lower_expression(*operand)?;
            return self.step(id, *operand, op, current);
        }

        let op = match small & syntax::prefix_operator::MASK {
            syntax::prefix_operator::PLUS => None,
            syntax::prefix_operator::MINUS => Some(UnOp::Neg),
            syntax::prefix_operator::EXCLAMATION => Some(UnOp::Not),
            // `~` is `ToInt32` then a bitwise complement, and `++`/`--` assign.
            // Both are lowerable; neither is a spelling of what is here.
            _ => return Err(self.unsupported(id, "this unary operator")),
        };

        let value = self.lower_expression(*operand)?;
        let Some(op) = op else { return Ok(value) };
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a unary expression of unrepresentable type"))?;
        Ok(self.push(OpKind::Unary { op, operand: value }, ty, origin))
    }

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
            // name, `!`, type, initializer — the annotation is a child too, so
            // `const scale: number = 3` has three where `const scale = 3` has
            // two. Destructuring positionally refused every annotated local.
            let Some([Some(name), _, _, initializer]) = self.child_slots::<4>(declaration) else {
                return Err(self.unsupported(declaration, "a declaration of unexpected shape"));
            };
            let Some(initializer) = initializer else {
                return Err(self.unsupported(declaration, "a declaration without an initializer"));
            };
            // An empty array literal has type `never[]`: with no elements the
            // checker has nothing to infer from. The declaration does know —
            // `const out: number[] = []` says so — so the annotation supplies
            // what the literal cannot.
            let value = if self.kind_of(initializer) == Some(syntax::ARRAY_LITERAL_EXPRESSION)
                && self.children(initializer).is_empty()
            {
                let declared = self.type_of(name).ok_or_else(|| {
                    self.unsupported(declaration, "an empty array of unrepresentable type")
                })?;
                self.lower_empty_array(initializer, declared)?
            } else {
                self.lower_expression(initializer)?
            };
            let symbol = self
                .node(name)
                .symbol
                .ok_or_else(|| self.unsupported(name, "an unresolved declaration"))?;
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

        // `Math.floor(x)` and friends are operations, not calls. Lowering them
        // as operations is what lets the analysis see that the result is a whole
        // number — which is the entire reason an author writes `Math.floor`
        // rather than a division.
        if let Some(intrinsic) = self.math_intrinsic(callee_node) {
            return self.lower_math(id, intrinsic, &children[1..]);
        }

        // `c.advance()` — a method call. The receiver becomes the first
        // argument, which is what a method is once it is explicit.
        if self.kind_of(callee_node) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let parts = self.children(callee_node);
            let [receiver_node, member] = parts.as_slice() else {
                return Err(self.unsupported(callee_node, "a method call of unexpected shape"));
            };
            let receiver = self.lower_expression(*receiver_node)?;
            let HirType::Managed(ManagedType::Object(type_id)) =
                self.values[receiver.0 as usize].ty.clone()
            else {
                return Err(self.unsupported(id, "a method call on something without methods"));
            };
            let layout = self.layout_of(id, type_id)?;
            let member_name = self
                .node(*member)
                .text
                .clone()
                .ok_or_else(|| self.unsupported(*member, "a computed method name"))?;

            let mut args = vec![receiver];
            for argument in children.iter().skip(1) {
                args.push(self.lower_expression(*argument)?);
            }
            let ty = self
                .type_of(id)
                .ok_or_else(|| self.unsupported(id, "a call returning an unrepresentable type"))?;
            let origin = self.origin(id);
            return Ok(self.push(
                OpKind::Call {
                    callee: Callee::Direct(format!("{}#{member_name}", layout.name)),
                    args,
                },
                ty,
                origin,
            ));
        }

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

    /// The `Math` member a callee names, if it names one.
    ///
    /// Recognized by shape rather than by symbol identity, which is a
    /// simplification: a program that shadowed the global `Math` with its own
    /// object would be mis-read. It cannot be shadowed by a *function* in the
    /// compiled program — that call would resolve to a direct target and never
    /// reach here — so the remaining case is an import named `Math` with
    /// matching method names.
    ///
    /// `docs/any-unknown.md` describes the principled version: profiles that
    /// associate trusted *declaration identities* with a closed set of
    /// compiler-owned semantics, so the core never matches on a name at all.
    /// This is the shape that becomes.
    fn math_intrinsic(&self, callee: NodeId) -> Option<MathIntrinsic> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let children = self.children(callee);
        let object = *children.first()?;
        let member = *children.last()?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER)
            || self.node(object).text.as_deref() != Some("Math")
        {
            return None;
        }
        match self.node(member).text.as_deref()? {
            "floor" => Some(MathIntrinsic::Unary(UnOp::Floor)),
            "ceil" => Some(MathIntrinsic::Unary(UnOp::Ceil)),
            "trunc" => Some(MathIntrinsic::Unary(UnOp::Trunc)),
            "round" => Some(MathIntrinsic::Unary(UnOp::Round)),
            "abs" => Some(MathIntrinsic::Unary(UnOp::Abs)),
            "min" => Some(MathIntrinsic::Binary(BinOp::Min)),
            "max" => Some(MathIntrinsic::Binary(BinOp::Max)),
            _ => None,
        }
    }

    fn lower_math(
        &mut self,
        id: NodeId,
        intrinsic: MathIntrinsic,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a `Math` call of unrepresentable type"))?;
        let origin = self.origin(id);

        match (intrinsic, arguments) {
            (MathIntrinsic::Unary(op), [argument]) => {
                let operand = self.lower_expression(*argument)?;
                Ok(self.push(OpKind::Unary { op, operand }, ty, origin))
            }
            (MathIntrinsic::Binary(op), [left, right]) => {
                let lhs = self.lower_expression(*left)?;
                let rhs = self.lower_expression(*right)?;
                Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
            }
            // `Math.min()` is `Infinity` and `Math.min(a, b, c)` folds, but both
            // are shapes this lowering does not accept yet, and quietly
            // producing the two-argument answer for a three-argument call would
            // be wrong in a way nothing downstream could detect.
            _ => Err(self.unsupported(id, "a `Math` call with this many arguments")),
        }
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

        // Assignment is not arithmetic on a location: it rebinds a name to a
        // value. With the name bound directly there is no slot to store into and
        // nothing to emit — the rebinding *is* the assignment.
        if self.kind_of(*operator) == Some(syntax::EQUALS_TOKEN) {
            return self.lower_assignment(id, *lhs_node, *rhs_node);
        }

        // `&&` and `||` must not evaluate their right operand unless the left
        // one requires it, so they are taken before the ordinary path lowers
        // both.
        let token = self.kind_of(*operator).unwrap_or(0);
        if token == syntax::AMPERSAND_AMPERSAND_TOKEN || token == syntax::BAR_BAR_TOKEN {
            return self.lower_logical(
                id,
                token == syntax::AMPERSAND_AMPERSAND_TOKEN,
                *lhs_node,
                *rhs_node,
            );
        }

        // `x += e` is `x = x + e`: the operator applies, and the name rebinds.
        // Spelling it out here rather than in a desugaring keeps one place that
        // knows a bitwise operator needs its coercions.
        if let Some(op) = compound_operator(self.kind_of(*operator).unwrap_or(0)) {
            let current = self.lower_expression(*lhs_node)?;
            let addend = self.lower_expression(*rhs_node)?;
            let ty = self.type_of(id).ok_or_else(|| {
                self.unsupported(id, "a compound assignment of unrepresentable type")
            })?;
            let origin = self.origin(id);
            let updated = if bitwise_operator_of(op) {
                self.push_bitwise(op, current, addend, ty, &origin)
            } else {
                self.push(
                    OpKind::Binary {
                        op,
                        lhs: current,
                        rhs: addend,
                    },
                    ty,
                    origin,
                )
            };
            let symbol = self.node(*lhs_node).symbol.ok_or_else(|| {
                self.unsupported(*lhs_node, "compound assignment to a computed target")
            })?;
            self.bindings.insert(symbol.0, updated);
            return Ok(updated);
        }

        let lhs = self.lower_expression(*lhs_node)?;
        let rhs = self.lower_expression(*rhs_node)?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unsupported(id, "a binary expression of unrepresentable type"))?;

        let token = self
            .kind_of(*operator)
            .ok_or_else(|| self.unsupported(id, "a binary expression with no operator"))?;

        // A bitwise operator is `ToInt32`, the machine operation, and back. The
        // coercion is made explicit rather than folded into the operator so the
        // analysis can see it: `ToInt32` is where "this value is an integer"
        // stops being a hope and becomes a fact, and `x | 0` is how a TypeScript
        // author writes exactly that.
        if let Some(op) = bitwise_operator(token) {
            let origin = self.origin(id);
            return Ok(self.push_bitwise(op, lhs, rhs, ty, &origin));
        }

        // `+` is not one operator. On numbers it is arithmetic; on strings it is
        // concatenation, and the two lower to nothing alike. Resolving it here
        // against the result type means no backend has to ask again.
        let op = match token {
            syntax::EQUALS_TOKEN => unreachable!("assignment is handled before this"),
            syntax::PLUS_TOKEN if ty.is_managed() => BinOp::Concat,
            syntax::PLUS_TOKEN => BinOp::Add,
            syntax::MINUS_TOKEN => BinOp::Sub,
            syntax::ASTERISK_TOKEN => BinOp::Mul,
            syntax::SLASH_TOKEN => BinOp::Div,
            syntax::PERCENT_TOKEN => BinOp::Rem,
            syntax::LESS_THAN_TOKEN => BinOp::Lt,
            syntax::LESS_THAN_EQUALS_TOKEN => BinOp::Le,
            syntax::GREATER_THAN_TOKEN => BinOp::Gt,
            syntax::GREATER_THAN_EQUALS_TOKEN => BinOp::Ge,
            // `==` and `===` differ only by coercion, and both operands are
            // already known to be numbers here — where the two agree. A `==`
            // between different types would not reach this lowering, because
            // the checker rejects it under `strict`.
            syntax::EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_EQUALS_TOKEN => BinOp::Eq,
            syntax::EXCLAMATION_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN => BinOp::Ne,
            _ => return Err(self.unsupported(*operator, "this operator")),
        };

        let origin = self.origin(id);
        Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
    }
}

/// The bitwise operator a token spells, if it spells one.
const fn bitwise_operator(token: u16) -> Option<BinOp> {
    Some(match token {
        syntax::AMPERSAND_TOKEN => BinOp::BitAnd,
        syntax::BAR_TOKEN => BinOp::BitOr,
        syntax::CARET_TOKEN => BinOp::BitXor,
        syntax::LESS_THAN_LESS_THAN_TOKEN => BinOp::Shl,
        syntax::GREATER_THAN_GREATER_THAN_TOKEN => BinOp::Shr,
        syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_TOKEN => BinOp::UShr,
        _ => return None,
    })
}

/// The operator a compound-assignment token applies.
const fn compound_operator(token: u16) -> Option<BinOp> {
    Some(match token {
        syntax::PLUS_EQUALS_TOKEN => BinOp::Add,
        syntax::MINUS_EQUALS_TOKEN => BinOp::Sub,
        syntax::ASTERISK_EQUALS_TOKEN => BinOp::Mul,
        syntax::SLASH_EQUALS_TOKEN => BinOp::Div,
        syntax::PERCENT_EQUALS_TOKEN => BinOp::Rem,
        syntax::AMPERSAND_EQUALS_TOKEN => BinOp::BitAnd,
        syntax::BAR_EQUALS_TOKEN => BinOp::BitOr,
        syntax::CARET_EQUALS_TOKEN => BinOp::BitXor,
        syntax::LESS_THAN_LESS_THAN_EQUALS_TOKEN => BinOp::Shl,
        syntax::GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinOp::Shr,
        syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN => BinOp::UShr,
        _ => return None,
    })
}

/// Whether an operator needs the `ToInt32` coercions.
const fn bitwise_operator_of(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr
    )
}

/// The values a declared type admits.
///
/// Only literal types and unions of them say anything useful; everything else
/// is as wide as its representation. Bounded so that a self-referential union
/// cannot make this recurse forever — the checker should not produce one, but a
/// stack overflow is a poor way to find out.
fn known_values(snapshot: &SemanticSnapshot, ty: TypeId, depth: u32) -> Facts {
    const MAX_DEPTH: u32 = 8;
    if depth > MAX_DEPTH {
        return Facts::TOP;
    }
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return Facts::TOP;
    };
    match &record.kind {
        TypeKind::Literal(LiteralValue::Number(value)) => Facts::constant(*value),
        TypeKind::Union(members) => members.iter().fold(Facts::BOTTOM, |accumulated, member| {
            accumulated.join(known_values(snapshot, *member, depth + 1))
        }),
        _ => Facts::TOP,
    }
}

/// A `Math` member the compiler implements directly.
#[derive(Debug, Clone, Copy)]
enum MathIntrinsic {
    Unary(UnOp),
    Binary(BinOp),
}

/// One side of a branching expression.
///
/// A ternary's arms are expressions to lower inside their own blocks; a
/// short-circuit's "untaken" arm is the left operand, already evaluated before
/// the branch.
#[derive(Debug, Clone, Copy)]
enum Branch {
    Expression(NodeId),
    Value(ValueId),
}
