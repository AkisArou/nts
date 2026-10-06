//! A named generic function has one object identity and one erased entry.
//!
//! Receiving signatures may offer bounded static kernels; they do not change
//! the singleton's layout or certify values arriving at its uniform root.
//! The open source kernel must actually compile before a wrapper can name it.

use super::{
    Callee, ClosureInfo, ClosureSource, Diagnostic, Facts, Func, FuncBuilder, HirType,
    NodeId, TypeId, TypeKind, syntax, declaration_initializer, representation,
    BinOp, BlockId, ValueId, Origin, Absent,
    ManagedType, OpKind, Param, ParamShape, RAISING_SUFFIX, SemanticSnapshot,
    Terminator, closure_names, closure_type, is_generic_function,
};

use crate::hir::generics::{self, GenericFunctions};
use crate::hir::instantiate::{Owner, Templates, mentions_a_parameter};
use nts_semantic_schema::LiteralValue;

/// Receiving annotations offer contexts; they never re-type the stored field.
pub(super) fn register(snapshot: &SemanticSnapshot, closures: &[ClosureInfo], found: &mut GenericFunctions) {
    generics::add_value_fallbacks(snapshot, found, closures.iter()
        .filter(|info| info.source == ClosureSource::Function).map(|info| info.node));
    if found.value_fallbacks.is_empty() { return; }
    let probe = FuncBuilder::probe(snapshot);
    let sources: rustc_hash::FxHashSet<_> = found.value_fallbacks.keys().copied().collect();
    let templates = Templates::new(snapshot);
    let mut offers = Vec::new();
    for (call, target) in &snapshot.call_targets {
        let Some(signature) = snapshot.signatures.get(target.signature.0 as usize) else { continue; };
        for (argument, parameter) in probe.arguments_of(*call).iter().zip(&signature.parameters) {
            if let Some(declaration) = source_function(&probe, *argument, &sources) {
                offers.push((declaration, parameter.ty));
            }
        }
    }
    for (at, node) in snapshot.nodes.iter().enumerate() {
        if !matches!(node.kind, nts_semantic_schema::NodeKind::Syntax(
            syntax::VARIABLE_DECLARATION | syntax::PROPERTY_DECLARATION)) { continue; }
        let declaration = NodeId(u32::try_from(at).unwrap_or(u32::MAX));
        let Some(name) = probe.name_node(declaration) else { continue; };
        let children = probe.children(declaration);
        let Some(initializer) = declaration_initializer(&children, name, |id| probe.kind_of(id)) else { continue; };
        let Some(source) = source_function(&probe, initializer, &sources) else { continue; };
        if let Some(receiving) = snapshot.node_types.get(&name) { offers.push((source, *receiving)); }
    }
    offers.sort(); offers.dedup();
    for (declaration, receiving) in offers {
        if !found.value_fallbacks.contains_key(&declaration) { continue; }
        for receiving in concrete_receivers(snapshot, &templates, found, receiving) {
            let Some(TypeKind::Function(signature)) = snapshot.types.get(receiving.0 as usize)
                .map(|record| &record.kind) else { continue; };
            let Some(signature) = snapshot.signatures.get(signature.0 as usize) else { continue; };
            if signature.parameters.iter().all(|param| guard(snapshot, param.ty, 0).is_some()) {
                generics::add_value_context(snapshot, &templates, found, declaration, receiving);
            }
        }
    }
    generics::settle_value_contexts(snapshot, found);
    pin_alias_calls(&probe, &sources, found);
}

/// A call through a `const` alias of a generic function -- `const id:
/// (v: bigint) => bigint = identity; id(x)` -- is the call the alias's own
/// signature makes, and that signature has a context where it is a receiving
/// type [`register`] gave one -- and the erased root where it is not, as any
/// other use of the value past a typed context. Nothing pinned a copy for such
/// a call (its resolved signature names no type parameter), so it named the
/// bare generic function, which nothing defines.
fn pin_alias_calls(probe: &FuncBuilder<'_>, sources: &rustc_hash::FxHashSet<NodeId>, found: &mut GenericFunctions) {
    let snapshot = probe.snapshot;
    let mut pinned = Vec::new();
    for call in snapshot.call_targets.keys() {
        if found.at_call.contains_key(call) {
            continue;
        }
        let Some(callee) = probe.children(*call).first().copied() else { continue; };
        if probe.kind_of(callee) != Some(syntax::IDENTIFIER) {
            continue;
        }
        // The function the alias chain names; the checker's own callee for
        // such a call is the alias.
        let Some(declaration) = source_function(probe, callee, sources) else { continue; };
        // Through an alias, not the function's own name: a call by its name
        // pins its own copy from its own arguments.
        if probe.node(callee).symbol.map(|symbol| probe.denoted_symbol(symbol))
            == probe.node(declaration).symbol.map(|symbol| probe.denoted_symbol(symbol))
        {
            continue;
        }
        // The alias's own signature's context where it has one, and otherwise
        // the erased root every use of the value past a typed context takes.
        let receiving = snapshot.node_types.get(&callee);
        let context = found
            .value_contexts
            .get(&declaration)
            .and_then(|contexts| contexts.iter().find(|context| receiving.is_some_and(|ty| context.receiving.contains(ty))))
            .map(|context| &context.instance)
            .or_else(|| found.value_fallbacks.get(&declaration));
        let Some(instance) = context else { continue; };
        pinned.push((*call, instance.suffix.clone()));
    }
    found.at_call.extend(pinned);
}

fn source_function(probe: &FuncBuilder<'_>, mut node: NodeId, sources: &rustc_hash::FxHashSet<NodeId>) -> Option<NodeId> {
    for _ in 0..8 {
        node = probe.through_assertions(node);
        let symbol = probe.denoted_symbol(probe.node(node).symbol?);
        let record = probe.snapshot.symbols.get(symbol.0 as usize)?;
        if let Some(declaration) = record.declarations.iter().find(|declaration| sources.contains(declaration)) {
            return Some(*declaration);
        }
        let declaration = *record.declarations.first()?;
        if probe.kind_of(declaration) != Some(syntax::VARIABLE_DECLARATION)
            || probe.declaration_kind(declaration) != nts_semantic_schema::VariableKind::Const { return None; }
        let name = probe.name_node(declaration)?;
        node = declaration_initializer(&probe.children(declaration), name, |id| probe.kind_of(id))?;
    }
    None
}

fn concrete_receivers(
    snapshot: &SemanticSnapshot, templates: &Templates, found: &GenericFunctions, ty: TypeId,
) -> Vec<TypeId> {
    if !mentions_a_parameter(snapshot, ty) { return vec![ty]; }
    match templates.owner_of(ty) {
        Some(Owner::Function(owner)) => found.copies.get(&owner).into_iter().flatten()
            .filter_map(|copy| {
                let sigma = copy.sources.iter().map(|(k, v)| (*k, *v)).collect();
                let receiving = templates.resolve(ty, &sigma)?;
                (!mentions_a_parameter(snapshot, receiving)).then_some(receiving)
            }).collect(),
        Some(Owner::Type(_)) => templates.bindings_of(ty).into_iter().map(|(_, ty)| ty).collect(),
        None => Vec::new(),
    }
}

#[derive(Clone, PartialEq, Eq)]
enum Guard {
    Scalar(u32, Option<LiteralValue>),
    Class(TypeId),
    Any(Vec<Guard>),
}

/// Actual tags/classes, never a callable annotation or generic array wrapper.
/// Unsupported union members fall through to the compiled erased kernel.
fn guard(snapshot: &SemanticSnapshot, ty: TypeId, depth: u32) -> Option<Guard> {
    if depth > 12 { return None; }
    let record = snapshot.types.get(ty.0 as usize)?;
    let scalar = |tag| Some(Guard::Scalar(tag, None));
    match &record.kind {
        TypeKind::Number => scalar(crate::hir::tags::NUMBER),
        TypeKind::Boolean => scalar(crate::hir::tags::BOOLEAN),
        TypeKind::String => scalar(crate::hir::tags::STRING),
        TypeKind::BigInt => scalar(crate::hir::tags::BIGINT),
        TypeKind::Symbol => scalar(crate::hir::tags::SYMBOL),
        TypeKind::Literal(literal @ LiteralValue::Number(_)) => Some(Guard::Scalar(crate::hir::tags::NUMBER, Some(literal.clone()))),
        TypeKind::Literal(literal @ LiteralValue::Boolean(_)) => Some(Guard::Scalar(crate::hir::tags::BOOLEAN, Some(literal.clone()))),
        TypeKind::Literal(literal @ LiteralValue::String(_)) => Some(Guard::Scalar(crate::hir::tags::STRING, Some(literal.clone()))),
        TypeKind::Literal(literal @ LiteralValue::BigInt(digits)) => {
            super::parse_bigint(digits)?;
            Some(Guard::Scalar(crate::hir::tags::BIGINT, Some(literal.clone())))
        }
        TypeKind::Union(items) => {
            let mut guards = Vec::new();
            for item in items {
                let Some(found) = guard(snapshot, *item, depth + 1) else { continue; };
                let alternatives = match found { Guard::Any(guards) => guards, other => vec![other] };
                for guard in alternatives { if !guards.contains(&guard) { guards.push(guard); } }
            }
            match guards.len() {
                0 => None, 1 => guards.pop(), _ => Some(Guard::Any(guards)),
            }
        }
        TypeKind::Object { .. } => {
            let symbol = record.symbol?;
            let class = snapshot.symbols.get(symbol.0 as usize)?.declarations.iter().any(|node|
                snapshot.nodes.get(node.0 as usize).is_some_and(|node| matches!(node.kind,
                    nts_semantic_schema::NodeKind::Syntax(syntax::CLASS_DECLARATION | syntax::CLASS_EXPRESSION))));
            class.then_some(Guard::Class(ty))
        }
        _ => None,
    }
}

pub(super) fn is_canonical(snapshot: &SemanticSnapshot, info: &ClosureInfo) -> bool {
    info.source == ClosureSource::Function && is_generic_function(snapshot, info.node)
}

pub(super) fn lower(
    builder: &mut FuncBuilder<'_>,
    index: usize,
    info: &ClosureInfo,
    generics: &super::super::generics::GenericFunctions,
    kernels: &[Func],
) -> Option<Result<Func, Diagnostic>> {
    if !is_canonical(builder.snapshot, info) { return None; }
    Some(lower_open(builder, index, info, generics, kernels))
}

fn lower_open(
    builder: &mut FuncBuilder<'_>,
    index: usize,
    info: &ClosureInfo,
    generics: &super::super::generics::GenericFunctions,
    kernels: &[Func],
) -> Result<Func, Diagnostic> {
    let id = info.node;
    let fallback = generics.value_fallbacks.get(&id)
        .ok_or_else(|| builder.unsupported(id,
            "a generic function value with no checker-owned erased source kernel"))?;
    let base = builder.qualified.get(&id).cloned()
        .or_else(|| builder.static_method_name(id))
        .or_else(|| builder.declared_name(id))
        .ok_or_else(|| builder.unsupported(id, "a function declaration with no name"))?;
    let plain_name = format!("{base}{}", fallback.suffix);
    let plain = kernels.iter().find(|func| func.name == plain_name)
        .ok_or_else(|| builder.unsupported(id,
            "a generic function value whose erased source kernel could not be compiled"))?;
    // This prerequisite handles pure erased carry/call. An array tag cannot
    // certify its element storage, and a function tag cannot certify a written
    // callback signature; those must never become unchecked Fn/array casts.
    if plain.params.iter().any(|param| param.ty != HirType::Erased)
        || plain.return_type != HirType::Erased
    {
        return Err(builder.unsupported(id,
            "a generic function value whose open kernel needs concrete argument or result storage"));
    }
    let called = if builder.raises {
        let raising_name = format!("{plain_name}{RAISING_SUFFIX}");
        if kernels.iter().any(|func| func.name == raising_name) {
            raising_name
        } else {
            // Existing copy eligibility is authoritative. Do not make the gate
            // optimistic merely because a dispatcher could name a new kernel.
            let ordinary = builder.wrapper_callee_that_raises(id, info,
                Callee::Direct(plain_name.clone()))?;
            let Callee::Direct(name) = ordinary else {
                return Err(builder.unsupported(id, "a generic source kernel with no direct entry"));
            };
            if name != plain_name {
                return Err(builder.unsupported(id,
                    "a generic function value whose raising source kernel could not be compiled"));
            }
            name
        }
    } else { plain_name };
    let origin = builder.origin(id);
    let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
    let receiver = builder.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
    builder.this = Some(receiver);
    builder.in_closure = true;
    builder.layouts.push(builder.closure_layout(index, Vec::new()));
    let mut params = vec![Param {
        name: "this".to_owned(), shape: ParamShape::Ordinary, ty: receiver_ty,
        origin: origin.clone(), known: Facts::TOP,
    }];
    let mut args = Vec::new();
    for (at, param) in plain.params.iter().enumerate() {
        if param.shape != ParamShape::Ordinary {
            return Err(builder.unsupported(id,
                "a generic function value with an open rest or destructured parameter"));
        }
        let position = u32::try_from(at + 1).unwrap_or(u32::MAX);
        args.push(builder.push(OpKind::Param(position), HirType::Erased, param.origin.clone()));
        params.push(Param { known: Facts::TOP, ..param.clone() });
    }
    dispatch_contexts(builder, info, &base, generics, kernels, &args, &origin)?;
    let names_a_raising_copy = called.ends_with(RAISING_SUFFIX);
    let answered = builder.push(OpKind::Call {
        callee: Callee::Direct(called), args, frame: None,
    }, HirType::Erased, origin.clone());
    if names_a_raising_copy {
        builder.returns = HirType::Erased;
        builder.emit_the_raise_test(&origin);
    }
    builder.terminate(Terminator::Return(Some(answered)));
    Ok(builder.finish(closure_names(index).1, params, HirType::Erased, origin, false))
}


fn dispatch_contexts(
    builder: &mut FuncBuilder<'_>, info: &ClosureInfo, base: &str,
    generics: &GenericFunctions, kernels: &[Func], args: &[ValueId], origin: &Origin,
) -> Result<(), Diagnostic> {
    for context in generics.value_contexts.get(&info.node).into_iter().flatten() {
        let plain_name = format!("{base}{}", context.instance.suffix);
        let Some(plain) = kernels.iter().find(|func| func.name == plain_name) else { continue; };
        let kernel = if builder.raises {
            let raising_name = format!("{plain_name}{RAISING_SUFFIX}");
            if let Some(raising) = kernels.iter().find(|func| func.name == raising_name) { raising }
            else {
                let Ok(Callee::Direct(name)) = builder.wrapper_callee_that_raises(info.node, info,
                    Callee::Direct(plain_name.clone())) else { continue; };
                if name != plain_name { continue; }
                plain
            }
        } else { plain };
        if kernel.params.len() != args.len() { continue; }
        let mut evidence = Vec::new();
        for receiving in &context.receiving {
            let Some(TypeKind::Function(signature)) = builder.snapshot.types.get(receiving.0 as usize)
                .map(|record| &record.kind) else { continue; };
            let Some(signature) = builder.snapshot.signatures.get(signature.0 as usize) else { continue; };
            if signature.parameters.len() != args.len()
                || representation(builder.snapshot, signature.return_type).as_ref() != Some(&kernel.return_type)
                || (kernel.return_type != HirType::Erased && builder.admits_absence(signature.return_type)) {
                continue;
            }
            let guards: Option<Vec<_>> = signature.parameters.iter()
                .map(|parameter| guard(builder.snapshot, parameter.ty, 0)).collect();
            let Some(guards) = guards else { continue; };
            if !guards.iter().zip(&kernel.params).all(|(guard, param)|
                guard_carries(guard, &param.ty)) || evidence.contains(&guards) { continue; }
            evidence.push(guards.clone());
            let next_context = builder.new_block();
            for (value, guard) in args.iter().zip(&guards) {
                let accepted = builder.new_block();
                emit_guard(builder, info.node, *value, guard, [accepted, next_context], origin)?;
                builder.switch_to(accepted);
            }
            // Every read-back is dominated by an actual tag/class/value test.
            let call_args = args.iter().zip(&kernel.params).map(|(value, param)| {
                if param.ty == HirType::Erased { *value }
                else { builder.push(OpKind::Unerase { value: *value }, param.ty.clone(), origin.clone()) }
            }).collect();
            let answered = builder.push(OpKind::Call {
                callee: Callee::Direct(kernel.name.clone()), args: call_args, frame: None,
            }, kernel.return_type.clone(), origin.clone());
            if kernel.name.ends_with(RAISING_SUFFIX) {
                builder.returns = HirType::Erased;
                builder.emit_the_raise_test(origin);
            }
            let erased = if kernel.return_type == HirType::Erased { answered }
                else { builder.push(OpKind::Erase { value: answered, absent: Absent::Impossible },
                    HirType::Erased, origin.clone()) };
            builder.terminate(Terminator::Return(Some(erased)));
            builder.switch_to(next_context);
        }
    }
    Ok(())
}

fn guard_carries(guard: &Guard, ty: &HirType) -> bool {
    if *ty == HirType::Erased { return true; }
    match guard {
        Guard::Scalar(tag, _) => match ty {
            HirType::Float { bits: 64 } => *tag == crate::hir::tags::NUMBER,
            HirType::Bool => *tag == crate::hir::tags::BOOLEAN,
            HirType::Managed(ManagedType::String) => *tag == crate::hir::tags::STRING,
            HirType::Managed(ManagedType::Symbol) => *tag == crate::hir::tags::SYMBOL,
            HirType::BigInt => *tag == crate::hir::tags::BIGINT,
            _ => false,
        },
        Guard::Class(class) => *ty == HirType::Managed(ManagedType::Object(*class)),
        Guard::Any(guards) => guards.iter().all(|guard| guard_carries(guard, ty)),
    }
}

fn branch(builder: &mut FuncBuilder<'_>, cond: ValueId, targets: [BlockId; 2]) {
    builder.terminate(Terminator::Branch {
        cond, then_target: targets[0], then_args: Vec::new(),
        else_target: targets[1], else_args: Vec::new(),
    });
}

fn emit_guard(
    builder: &mut FuncBuilder<'_>, id: NodeId, value: ValueId, guard: &Guard,
    targets: [BlockId; 2], origin: &Origin,
) -> Result<(), Diagnostic> {
    match guard {
        Guard::Scalar(tag, literal) => {
            let unsigned = HirType::Int { bits: 32, signed: false };
            let observed = builder.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
            let wanted = builder.push(OpKind::ConstInt(i128::from(*tag)), unsigned, origin.clone());
            let matches = builder.push(OpKind::Binary { op: BinOp::Eq, lhs: observed, rhs: wanted },
                HirType::Bool, origin.clone());
            if let Some(literal) = literal {
                let at_literal = builder.new_block();
                branch(builder, matches, [at_literal, targets[1]]);
                builder.switch_to(at_literal);
                let (ty, kind) = match literal {
                    LiteralValue::Number(number) => (HirType::NUMBER, OpKind::ConstFloat(*number)),
                    LiteralValue::Boolean(boolean) => (HirType::Bool, OpKind::ConstBool(*boolean)),
                    LiteralValue::String(string) => (HirType::Managed(ManagedType::String), OpKind::ConstString(string.clone())),
                    LiteralValue::BigInt(digits) => (HirType::BigInt,
                        OpKind::ConstInt(super::parse_bigint(digits)
                            .ok_or_else(|| builder.unsupported(id,
                                "a BigInt literal guard outside the signed 128-bit profile"))?)),
                };
                let actual = builder.push(OpKind::Unerase { value }, ty.clone(), origin.clone());
                let expected = builder.push(kind, ty.clone(), origin.clone());
                let equal = {
                    let equal = builder.push(OpKind::Binary { op: BinOp::Eq, lhs: actual, rhs: expected },
                        HirType::Bool, origin.clone());
                    if let LiteralValue::Number(number) = literal
                        && *number == 0.0 {
                        // Literal facts may distinguish signed zero. Equality
                        // alone does not, and a reciprocal alone also accepts
                        // a tiny nonzero whose reciprocal overflows.
                        let one = builder.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
                        let reciprocal = builder.push(OpKind::Binary { op: BinOp::Div, lhs: one, rhs: actual },
                            HirType::NUMBER, origin.clone());
                        let sign = builder.push(OpKind::ConstFloat(1.0 / *number), HirType::NUMBER, origin.clone());
                        let same_sign = builder.push(OpKind::Binary { op: BinOp::Eq, lhs: reciprocal, rhs: sign },
                            HirType::Bool, origin.clone());
                        builder.bool_join(equal, same_sign, false, origin)
                    } else { equal }
                };
                branch(builder, equal, targets);
            } else { branch(builder, matches, targets); }
        }
        Guard::Class(class) => {
            let classes = builder.classes_under(*class);
            for class in &classes { builder.layout_of(id, *class)?; }
            let actual = builder.push(OpKind::InstanceOf { value, classes }, HirType::Bool, origin.clone());
            branch(builder, actual, targets);
        }
        Guard::Any(guards) => {
            for (at, guard) in guards.iter().enumerate() {
                let failed = if at + 1 == guards.len() { targets[1] } else { builder.new_block() };
                emit_guard(builder, id, value, guard, [targets[0], failed], origin)?;
                if at + 1 != guards.len() { builder.switch_to(failed); }
            }
        }
    }
    Ok(())
}
