//! Parameter environments which cannot be reconstructed at the caller.
//!
//! A closure made by a parameter initializer and the body's later reads and
//! writes must share the parameter binding, including its cell when boxed.
//! Read the existing capture records: this is not another free-variable walk.

use std::collections::BTreeMap;

use nts_diagnostics::Diagnostic;
use nts_semantic_schema::{DeclarationModifiers, NodeId, VariableKind, syntax};
use rustc_hash::FxHashSet;

use super::{
    Arrivals, Block, BlockId, Branch, Callee, ClosureInfo, ClosureSource, Facts, Func, FuncBuilder,
    HirType, LoweringSnapshot, Op, OpKind, Param, ParamShape, Program, Terminator, ValueId,
};

#[derive(Debug)]
pub(super) struct Cut {
    block: BlockId,
    values: usize,
}

#[derive(Debug)]
pub(super) struct Split {
    pub(super) name: String,
    pub(super) cut: Cut,
    pub(super) public_types: BTreeMap<u32, PublicInput>,
}

#[derive(Debug)]
pub(super) struct PublicInput {
    pub(super) parameter: Param,
    pub(super) absent: super::Absent,
    pub(super) slots: super::Absent,
}

pub(super) struct ClosureInputs {
    pub(super) params: Vec<Param>,
    pub(super) forwarded: Vec<ValueId>,
    pub(super) early_return: Option<(Option<crate::hir::GeneratorFrame>, HirType)>,
    pub(super) authored_entry: bool,
}

impl FuncBuilder<'_> {
    /// Every parameter binding exists before the first initializer. Opening
    /// captured cells here also keeps them present on both arms of a default;
    /// a conditional initializer must not leave its closure holding a cell
    /// which the later parameter binding replaces with another one.
    pub(super) fn prepare_parameter_cells(&mut self, callable: NodeId) {
        for parameter in super::parameters_of(self, callable) {
            let Some(name) = self.children(parameter).into_iter().find(|child| {
                matches!(
                    self.kind_of(*child),
                    Some(
                        syntax::IDENTIFIER
                            | syntax::OBJECT_BINDING_PATTERN
                            | syntax::ARRAY_BINDING_PATTERN
                    )
                )
            }) else {
                continue;
            };
            let mut names = Vec::new();
            if self.kind_of(name) == Some(syntax::IDENTIFIER) {
                names.push(name);
            } else {
                self.pattern_names(name, &mut names);
            }
            for name in names {
                if let Some(symbol) = self.node(name).symbol {
                    self.open_cell_early(symbol.0, name);
                }
            }
        }
    }

    /// A capturing default belongs to the callable's parameter environment.
    /// Pattern-only generator entries keep ordinary caller-filled defaults.
    pub(super) fn owns_parameter_defaults(&self, callable: NodeId) -> bool {
        matches!(
            self.kind_of(callable),
            Some(
                syntax::FUNCTION_DECLARATION | syntax::FUNCTION_EXPRESSION | syntax::ARROW_FUNCTION
            )
        ) && !self
            .node(callable)
            .modifiers
            .contains(DeclarationModifiers::ASYNC)
            && self.closures.needs_parameter_entry(callable)
    }

    pub(super) fn needs_parameter_entry(&self, callable: NodeId) -> bool {
        self.owns_parameter_defaults(callable)
            || (self
                .node(callable)
                .modifiers
                .contains(DeclarationModifiers::GENERATOR)
                && !self
                    .node(callable)
                    .modifiers
                    .contains(DeclarationModifiers::ASYNC)
                && super::parameters_of(self, callable)
                    .into_iter()
                    .any(|parameter| {
                        self.children(parameter).into_iter().any(|child| {
                            matches!(
                                self.kind_of(child),
                                Some(
                                    syntax::ARRAY_BINDING_PATTERN | syntax::OBJECT_BINDING_PATTERN
                                )
                            )
                        })
                    }))
    }

    pub(super) fn parameter_defaults_in_entry(&self) -> bool {
        self.parameter_entry
            .is_some_and(|callable| self.owns_parameter_defaults(callable))
    }

    fn has_parameter_expressions(&self, callable: NodeId) -> bool {
        super::parameters_of(self, callable)
            .into_iter()
            .any(|parameter| {
                if self.default_of(parameter).is_some() {
                    return true;
                }
                let mut pattern = Vec::new();
                if let Some(name) = self.children(parameter).into_iter().find(|child| {
                    matches!(
                        self.kind_of(*child),
                        Some(syntax::ARRAY_BINDING_PATTERN | syntax::OBJECT_BINDING_PATTERN)
                    )
                }) {
                    self.subtree(name, &mut pattern);
                }
                pattern.into_iter().any(|node| {
                    self.kind_of(node) == Some(syntax::COMPUTED_PROPERTY_NAME)
                        || (self.kind_of(node) == Some(syntax::BINDING_ELEMENT)
                            && self.default_of(node).is_some())
                })
            })
    }

    pub(super) fn parameter_entry_for_call(&self, call: NodeId) -> Option<NodeId> {
        let callable = self.snapshot.call_targets.get(&call)?.callee?;
        let callable = self.implementation_of(callable);
        self.owns_parameter_defaults(callable).then_some(callable)
    }

    pub(super) fn bind_parameter_default(
        &mut self,
        raw: ValueId,
        initializer: NodeId,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let Some(undefined) = self.defaulted_when(initializer, initializer, raw)? else {
            return self.coerce(raw, ty, initializer);
        };
        let before = self.expecting.replace(ty.clone());
        // The existing conditional merger carries assignments made by a
        // default to later parameters and the body on just the taken arm.
        let value = self.lower_branching_value_at(
            initializer,
            ty.clone(),
            undefined,
            Branch::Expression(initializer),
            Branch::Unerased(raw, ty.clone()),
        );
        self.expecting = before;
        value
    }

    pub(super) fn start_bound_body(&mut self, callable: NodeId) -> Result<(), Diagnostic> {
        if self.parameter_entry != Some(callable) {
            return Ok(());
        }
        if self.has_parameter_expressions(callable) {
            self.separate_body_variables(callable)?;
        }
        let block = self.new_block();
        self.terminate(Terminator::Jump {
            target: block,
            args: Vec::new(),
        });
        self.switch_to(block);
        self.parameter_cut = Some(Cut {
            block,
            values: self.values.len(),
        });
        Ok(())
    }

    /// Parameter expressions give the body its own `var` bindings. Even where
    /// the checker merges their symbols, the closure made above this point
    /// keeps the parameter cell and a body `var x` gets a new initialized cell.
    fn separate_body_variables(&mut self, callable: NodeId) -> Result<(), Diagnostic> {
        let mut parameters = BTreeMap::new();
        for parameter in super::parameters_of(self, callable) {
            let Some(name) = self.children(parameter).into_iter().find(|child| {
                matches!(
                    self.kind_of(*child),
                    Some(
                        syntax::IDENTIFIER
                            | syntax::OBJECT_BINDING_PATTERN
                            | syntax::ARRAY_BINDING_PATTERN
                    )
                )
            }) else {
                continue;
            };
            let mut names = Vec::new();
            if self.kind_of(name) == Some(syntax::IDENTIFIER) {
                names.push(name);
            } else {
                self.pattern_names(name, &mut names);
            }
            for name in names {
                let Some(symbol) = self.node(name).symbol.map(|symbol| symbol.0) else {
                    continue;
                };
                if let Some(bound) = self.bindings.get(&symbol).copied()
                    && let Some(record) = self.snapshot.symbols.get(symbol as usize)
                {
                    parameters.insert(record.name.clone(), (symbol, bound, name));
                }
            }
        }
        let Some(body) = self
            .children(callable)
            .into_iter()
            .find(|node| self.kind_of(*node) == Some(syntax::BLOCK))
        else {
            return Ok(());
        };
        let mut nodes = Vec::new();
        self.subtree(body, &mut nodes);
        let mut initialized = FxHashSet::default();
        for declaration in nodes {
            if self.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION)
                || self.enclosing_callable(declaration) != Some(callable)
                || !self
                    .ancestor(declaration, syntax::VARIABLE_DECLARATION_LIST)
                    .is_some_and(|list| {
                        VariableKind::from_flags(self.node(list).flags) == VariableKind::Var
                    })
            {
                continue;
            }
            let Some(name) = self
                .children(declaration)
                .into_iter()
                .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            else {
                continue;
            };
            let Some((symbol, bound, parameter)) = self
                .node(name)
                .text
                .as_ref()
                .and_then(|name| parameters.get(name))
                .copied()
            else {
                continue;
            };
            let Some(body_symbol) = self.node(name).symbol.map(|symbol| symbol.0) else {
                continue;
            };
            if !initialized.insert(body_symbol) {
                continue;
            }
            let value = self.read_cell(symbol, bound, parameter)?.unwrap_or(bound);
            self.bindings.remove(&body_symbol);
            let binding = self.open_cell(body_symbol, value, name);
            self.bindings.insert(body_symbol, binding);
        }
        Ok(())
    }
}

fn private_name(name: &str, part: &str) -> String {
    match name.strip_suffix(super::RAISING_SUFFIX) {
        Some(plain) => format!("{plain}@{part}{}", super::RAISING_SUFFIX),
        None => format!("{name}@{part}"),
    }
}

fn crossing_values(entry: &Func, cut: &Cut, arrivals: &Arrivals) -> Vec<ValueId> {
    let first = cut.block.0 as usize;
    let mut carried = FxHashSet::default();
    for block in &entry.blocks[first..] {
        for id in &block.ops {
            carried.extend(
                crate::hir::operands_of(&entry.values[id.0 as usize].kind)
                    .into_iter()
                    .filter(|id| (id.0 as usize) < cut.values),
            );
        }
        carried.extend(
            crate::hir::operands_of_terminator(&block.terminator)
                .into_iter()
                .filter(|id| (id.0 as usize) < cut.values),
        );
    }
    for obligation in &entry.obligations {
        if obligation.block.0 >= cut.block.0 && (obligation.value.0 as usize) < cut.values {
            carried.insert(obligation.value);
        }
    }
    for site in &arrivals.uniform_sites {
        if site.function == entry.name && (site.answered.0 as usize) >= cut.values {
            carried.extend(
                site.args
                    .iter()
                    .copied()
                    .filter(|id| (id.0 as usize) < cut.values),
            );
        }
    }
    let mut carried: Vec<_> = carried.into_iter().collect();
    carried.sort_unstable();
    carried
}

fn bound_body(entry: &Func, cut: &Cut, carried: &[ValueId]) -> Func {
    let first = cut.block.0 as usize;
    let mut body = entry.clone();
    body.name = private_name(&entry.name, "bindings");
    body.exported = false;
    if let Some(frame) = &mut body.frame {
        frame.parameter_entry = Some(entry.name.clone());
    }
    body.params = carried
        .iter()
        .enumerate()
        .map(|(at, id)| {
            let op = &mut body.values[id.0 as usize];
            let parameter = match op.kind {
                OpKind::Param(index) => entry.params.get(index as usize).cloned(),
                _ => None,
            };
            op.kind = OpKind::Param(u32::try_from(at).unwrap_or(u32::MAX));
            parameter.unwrap_or_else(|| Param {
                name: format!("binding{at}"),
                ty: op.ty.clone(),
                origin: op.origin.clone(),
                shape: ParamShape::Ordinary,
                known: Facts::TOP,
                written: None,
            })
        })
        .collect();
    for block in &mut body.blocks[..first] {
        block.params.clear();
        block.ops.clear();
        block.terminator = Terminator::Unreachable;
    }
    body.blocks[0] = Block {
        params: Vec::new(),
        ops: carried.to_vec(),
        terminator: Terminator::Jump {
            target: cut.block,
            args: Vec::new(),
        },
    };
    body.obligations
        .retain(|obligation| obligation.block.0 >= cut.block.0);

    body
}

fn returns(ty: &HirType, result: ValueId) -> Terminator {
    match ty {
        HirType::Never => Terminator::Unreachable,
        HirType::Void => Terminator::Return(None),
        _ => Terminator::Return(Some(result)),
    }
}

fn prefix(mut entry: Func, cut: &Cut, body: &str, carried: Vec<ValueId>) -> Func {
    let first = cut.block.0 as usize;
    entry.frame = None;
    entry.async_result = None;
    entry.blocks.truncate(first);
    entry
        .obligations
        .retain(|obligation| obligation.block.0 < cut.block.0);
    let result = ValueId(u32::try_from(entry.values.len()).unwrap_or(u32::MAX));
    entry.values.push(Op {
        kind: OpKind::Call {
            callee: Callee::Direct(body.to_owned()),
            args: carried,
            frame: None,
        },
        ty: entry.return_type.clone(),
        origin: entry.origin.clone(),
    });
    for block in &mut entry.blocks {
        if matches!(block.terminator, Terminator::Jump { target, .. } if target == cut.block) {
            block.ops.push(result);
            block.terminator = returns(&entry.return_type, result);
        }
    }
    entry
}

fn public_entry(entry: &Func, inputs: &BTreeMap<u32, PublicInput>) -> Func {
    let mut public = entry.clone();
    public.frame = None;
    public.values.clear();
    public.blocks.clear();
    public.obligations.clear();
    let mut args = Vec::new();
    let mut ops = Vec::new();
    for (at, parameter) in public.params.iter_mut().enumerate() {
        let index = u32::try_from(at).unwrap_or(u32::MAX);
        if let Some(input) = inputs.get(&index) {
            *parameter = input.parameter.clone();
        }
        let id = ValueId(u32::try_from(public.values.len()).unwrap_or(u32::MAX));
        public.values.push(Op {
            kind: OpKind::Param(index),
            ty: parameter.ty.clone(),
            origin: parameter.origin.clone(),
        });
        ops.push(id);
        if parameter.ty == entry.params[at].ty {
            args.push(id);
        } else {
            let erased = ValueId(u32::try_from(public.values.len()).unwrap_or(u32::MAX));
            let input = &inputs[&index];
            public.values.push(Op {
                kind: OpKind::Erase {
                    value: id,
                    absent: input.absent,
                    slots: input.slots,
                },
                ty: HirType::Erased,
                origin: parameter.origin.clone(),
            });
            ops.push(erased);
            args.push(erased);
        }
    }
    let value = ValueId(u32::try_from(public.values.len()).unwrap_or(u32::MAX));
    public.values.push(Op {
        kind: OpKind::Call {
            callee: Callee::Direct(entry.name.clone()),
            args,
            frame: None,
        },
        ty: public.return_type.clone(),
        origin: public.origin.clone(),
    });
    ops.push(value);
    public.blocks.push(Block {
        params: Vec::new(),
        ops,
        terminator: returns(&public.return_type, value),
    });
    public
}

/// Cut at the recorded source-body boundary, never by recognizing an emitted
/// operation pattern. The shared body's inputs are the values live across the
/// cut, so a boxed parameter crosses as its existing cell, not its payload.
pub(super) fn split(program: &mut Program, arrivals: &mut Arrivals, splits: Vec<Split>) {
    let mut redirected = BTreeMap::new();
    for split in splits {
        let Some(index) = program
            .funcs
            .iter()
            .position(|func| func.name == split.name)
        else {
            continue;
        };
        let entry = program.funcs[index].clone();
        let carried = crossing_values(&entry, &split.cut, arrivals);
        let mut body = bound_body(&entry, &split.cut, &carried);
        let mut entry = prefix(entry, &split.cut, &body.name, carried);
        // Only a fixed public ABI needs this third function. A concrete slot
        // has no undefined tag; changing it would change the exported C ABI.
        if (entry.exported
            || program
                .public_api
                .iter()
                .any(|(name, _)| *name == entry.name))
            && !split.public_types.is_empty()
        {
            let public_name = entry.name.clone();
            let exported = entry.exported;
            entry.name = private_name(&public_name, "parameters");
            entry.exported = false;
            redirected.insert(public_name.clone(), entry.name.clone());
            let mut public = public_entry(&entry, &split.public_types);
            public.name = public_name;
            public.exported = exported;
            program.funcs[index] = public;
        } else {
            program.funcs[index] = entry.clone();
        }
        for site in &mut arrivals.uniform_sites {
            if site.function == split.name {
                site.function
                    .clone_from(if (site.answered.0 as usize) < split.cut.values {
                        &entry.name
                    } else {
                        &body.name
                    });
            }
        }
        compact(&mut body, arrivals);
        compact(&mut entry, arrivals);
        if redirected.contains_key(&split.name) {
            program.funcs.push(entry);
        } else {
            program.funcs[index] = entry;
        }
        program.funcs.push(body);
    }
    if !redirected.is_empty() {
        for func in &mut program.funcs {
            for block in &func.blocks {
                for id in &block.ops {
                    if let OpKind::Call {
                        callee: Callee::Direct(name),
                        ..
                    } = &mut func.values[id.0 as usize].kind
                        && let Some(entry) = redirected.get(name)
                    {
                        name.clone_from(entry);
                    }
                }
            }
        }
    }
}

/// A cut discards definitions, not just their block membership. In particular,
/// the original Param ops are not parameters of the bound body. Reuse the HIR's
/// exhaustive operand mapper and preserve its recorded call sites as well.
fn compact(func: &mut Func, arrivals: &mut Arrivals) {
    let mut keep = FxHashSet::default();
    for block in &func.blocks {
        keep.extend(block.params.iter().copied());
        keep.extend(block.ops.iter().copied());
        keep.extend(crate::hir::operands_of_terminator(&block.terminator));
    }
    keep.extend(func.obligations.iter().map(|obligation| obligation.value));
    keep.extend(func.async_result);
    for site in &arrivals.uniform_sites {
        if site.function == func.name {
            keep.extend([site.answered, site.value]);
            keep.extend(site.args.iter().copied());
        }
    }
    let mut pending: Vec<_> = keep.iter().copied().collect();
    while let Some(id) = pending.pop() {
        for operand in crate::hir::operands_of(&func.values[id.0 as usize].kind) {
            if keep.insert(operand) {
                pending.push(operand);
            }
        }
    }
    let mut map = vec![None; func.values.len()];
    let mut values = Vec::new();
    for (at, op) in func.values.iter().enumerate() {
        if keep.contains(&ValueId(u32::try_from(at).unwrap_or(u32::MAX))) {
            map[at] = Some(ValueId(u32::try_from(values.len()).unwrap_or(u32::MAX)));
            values.push(op.clone());
        }
    }
    let remap =
        |id: ValueId| map[id.0 as usize].expect("a retained operation's input was retained");
    for op in &mut values {
        crate::hir::simplify::substitute(&mut op.kind, remap);
    }
    for block in &mut func.blocks {
        for id in block.params.iter_mut().chain(&mut block.ops) {
            *id = remap(*id);
        }
        crate::hir::simplify::substitute_terminator(&mut block.terminator, remap);
    }
    for obligation in &mut func.obligations {
        obligation.value = remap(obligation.value);
    }
    func.async_result = func.async_result.map(remap);
    for site in &mut arrivals.uniform_sites {
        if site.function == func.name {
            site.answered = remap(site.answered);
            site.value = remap(site.value);
            for id in &mut site.args {
                *id = remap(*id);
            }
        }
    }
    func.values = values;
}

pub(super) fn affected(
    snapshot: &LoweringSnapshot<'_>,
    closures: &[ClosureInfo],
) -> FxHashSet<NodeId> {
    let probe = FuncBuilder::probe(snapshot);
    let mut found = FxHashSet::default();
    for closure in closures {
        if !matches!(closure.source, ClosureSource::Authored) {
            continue;
        }
        for capture in &closure.captures {
            let Some(symbol) = snapshot.symbols.get(capture.symbol as usize) else {
                continue;
            };
            for declaration in &symbol.declarations {
                let mut at = Some(*declaration);
                while let Some(node) = at {
                    if probe.kind_of(node) == Some(syntax::PARAMETER) {
                        if let Some(owner) = probe.syntactic_parent(node)
                            && made_in_parameters(&probe, closure.node, owner)
                        {
                            found.insert(owner);
                        }
                        break;
                    }
                    // A binding pattern can stand between the symbol's declaration
                    // and its parameter. A function boundary cannot.
                    if probe.kind_of(node).is_some_and(|kind| {
                        super::binds_its_own_this(kind) || kind == syntax::ARROW_FUNCTION
                    }) {
                        break;
                    }
                    at = probe.syntactic_parent(node);
                }
            }
        }
    }
    found
}

fn made_in_parameters(probe: &FuncBuilder<'_>, closure: NodeId, owner: NodeId) -> bool {
    let mut at = probe.syntactic_parent(closure);
    while let Some(node) = at {
        if probe.kind_of(node) == Some(syntax::PARAMETER)
            && probe.syntactic_parent(node) == Some(owner)
        {
            return true;
        }
        if node == owner {
            return false;
        }
        at = probe.syntactic_parent(node);
    }
    false
}

#[cfg(test)]
mod tests {
    use camino::Utf8Path;
    use nts_frontend_ts::{SemanticSource, TsgoApi};

    use super::*;

    #[test]
    fn entry_membership_uses_the_closures_actual_parameter_captures() {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
            return;
        };
        let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/programs/captured-parameter-defaults/tsconfig.json");
        let snapshot = TsgoApi::for_compilation(tsgo)
            .snapshot(&config)
            .expect("the parameter-environment fixture has a snapshot");
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let indexed = LoweringSnapshot::new(&snapshot);
        let probe = FuncBuilder::probe(&indexed);
        let readers = super::super::initialization::PrivateReaders::new(&probe);
        let closures = super::super::collect_closures(&indexed, &readers);
        let shared = super::super::SharedClosures::new(&indexed, closures);
        let mut names = Vec::new();
        for (at, node) in snapshot.nodes.iter().enumerate() {
            let id = NodeId(u32::try_from(at).expect("a small fixture"));
            if shared.needs_parameter_entry(id) {
                names.push(
                    probe
                        .children(id)
                        .into_iter()
                        .find_map(|child| {
                            (probe.kind_of(child) == Some(syntax::IDENTIFIER))
                                .then(|| probe.node(child).text.clone())
                                .flatten()
                        })
                        .expect("each affected fixture function is named"),
                );
            }
            // Membership is the declaration's, not the parameter, binding,
            // closure or specialised builder's freshly computed opinion.
            if node.kind == nts_semantic_schema::NodeKind::Syntax(syntax::PARAMETER) {
                assert!(!shared.needs_parameter_entry(id));
            }
        }
        names.sort();
        assert_eq!(
            names,
            [
                "captured",
                "destructured",
                "generated",
                "readOnly",
                "scalarDefault",
                "separateBodyVar"
            ]
        );
        let lowered = super::super::lower(&snapshot);
        for func in &lowered.program.funcs {
            assert!(
                func.parameter_values().is_some(),
                "{} has a unique ABI definition for each parameter",
                func.name
            );
        }
        check_entry_abis(&lowered.program);
        let simple = lowered
            .program
            .funcs
            .iter()
            .find(|func| func.name == "bodyOnly")
            .expect("a simple parameter control");
        assert!(
            !simple.values.iter().any(|op| matches!(
                op.kind,
                OpKind::FieldGet { field: 1, .. } | OpKind::CellReady { .. }
            )),
            "a simple parameter has no readiness check"
        );
        crate::hir::prepare(&snapshot).expect("separated parameter entries produce valid HIR");
    }
    fn check_entry_abis(program: &Program) {
        for name in ["captured", "readOnly", "separateBodyVar", "destructured"] {
            let public = program
                .funcs
                .iter()
                .find(|func| func.name == name)
                .expect("the public ABI remains");
            assert!(matches!(
                public.params.last().expect("typed public input").ty,
                HirType::Managed(_)
            ));
            let raw = program
                .funcs
                .iter()
                .find(|func| func.name == format!("{name}@parameters"))
                .expect("raw entry");
            assert_eq!(
                raw.params.last().expect("default input").ty,
                HirType::Erased
            );
            assert!(
                program
                    .funcs
                    .iter()
                    .any(|func| func.name == format!("{name}@bindings"))
            );
            assert!(
                program
                    .funcs
                    .iter()
                    .any(|func| func.name == format!("{name}@parameters"))
            );
        }
        for name in ["constant", "bodyOnly", "outerOnly"] {
            assert!(
                !program
                    .funcs
                    .iter()
                    .any(|func| func.name.starts_with(&format!("{name}@")))
            );
        }
        let scalar = program
            .funcs
            .iter()
            .find(|func| func.name == "scalarDefault")
            .expect("public scalar ABI");
        assert_eq!(scalar.params[1].ty, HirType::NUMBER);
        let raw = program
            .funcs
            .iter()
            .find(|func| func.name == "scalarDefault@parameters")
            .expect("scalar ABI needs a raw entry");
        assert_eq!(raw.params[1].ty, HirType::Erased);
    }
}

#[cfg(test)]
mod generator_tests {
    use camino::Utf8Path;
    use nts_frontend_ts::{SemanticSource, TsgoApi};

    #[test]
    fn generator_entries_keep_the_public_resumption_and_leave_simple_parameters_alone() {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
            return;
        };
        let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/programs/captured-parameter-defaults/tsconfig.json");
        let snapshot = TsgoApi::for_compilation(tsgo)
            .snapshot(&config)
            .expect("the generator fixture");
        assert!(!snapshot.has_errors());
        let lowered = super::super::lower(&snapshot);
        let simple = lowered
            .program
            .funcs
            .iter()
            .find(|func| func.name == "simpleGenerated")
            .expect("simple generator");
        assert!(
            simple
                .frame
                .as_ref()
                .expect("a suspended body")
                .parameter_entry
                .is_none()
        );
        assert!(
            !lowered
                .program
                .funcs
                .iter()
                .any(|func| func.name.starts_with("simpleGenerated@"))
        );
        let bound = lowered
            .program
            .funcs
            .iter()
            .find(|func| func.name == "patternGenerated@bindings")
            .expect("one bound body");
        assert_eq!(
            bound
                .frame
                .as_ref()
                .expect("bound suspended body")
                .parameter_entry
                .as_deref(),
            Some("patternGenerated")
        );
        let prepared = crate::hir::prepare(&snapshot).expect("valid separated generators");
        for name in ["patternGenerated", "generated"] {
            let resume = format!("{name}__resume");
            assert!(
                prepared
                    .program
                    .funcs
                    .iter()
                    .any(|func| func.name == resume)
            );
            assert!(
                prepared
                    .program
                    .generators
                    .iter()
                    .any(|generator| generator.constructor == name && generator.resume == resume)
            );
        }
    }
}
