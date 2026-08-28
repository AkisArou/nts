//! One copy of a generic class per instantiation.
//!
//! # Why a copy rather than an erasure
//!
//! `hir::monomorphize` already makes one clone of a function per closure class,
//! "for the same reason and with the same result" as a C++ template. A generic
//! class is the same decision one level up: `Vector<Body>` and `Vector<double>`
//! want different field widths, different element loads and different dispatch,
//! and a single erased copy would have to box both.
//!
//! # What the checker gives, and what it does not
//!
//! A generic class arrives as *two or more* object types with one declaring
//! symbol:
//!
//! ```text
//! #1  `Box` args[T]       Object { items: Array(T),      first: () => T      }
//! #10 `Box` args[number]  Object { items: Array(number), first: () => number }
//! ```
//!
//! So the **properties are already substituted** and an instantiation's layout
//! needs no work at all. What is missing is the bodies: the AST inside a generic
//! method is shared by every instantiation, so `type_of` on a node in `first`
//! answers `T` whichever copy is being lowered.
//!
//! Zipping the declaration's arguments — which are its own type parameters —
//! against an instantiation's gives the map from `T` to `number` that the bodies
//! need. That map is the whole of what this module computes.

use nts_semantic_schema::{SemanticSnapshot, SymbolId, TypeId, TypeKind};
use rustc_hash::FxHashMap;

use super::lower::{Substitution, representation};

/// One instantiation of one generic class.
#[derive(Debug, Clone)]
pub struct Instantiation {
    /// The instantiated object type. Its properties are the layout.
    pub ty: TypeId,
    /// What each of the declaration's type parameters stands for here.
    pub substitution: Substitution,
}

/// Every instantiation of every generic type, by the symbol that declares it.
///
/// Types this compiler cannot represent are left out rather than reported: a
/// generic class instantiated at something unrepresentable is refused where it
/// is *used*, which names the use rather than a type the reader never wrote.
#[must_use]
pub fn instantiations(snapshot: &SemanticSnapshot) -> FxHashMap<SymbolId, Vec<Instantiation>> {
    // Every generic object type, grouped by what declares it. A type with no
    // arguments is not generic and a type with no symbol has no declaration to
    // group under.
    let mut groups: FxHashMap<SymbolId, Vec<TypeId>> = FxHashMap::default();
    for (index, record) in snapshot.types.iter().enumerate() {
        let ty = TypeId(u32::try_from(index).unwrap_or(u32::MAX));
        let Some(symbol) = record.symbol else {
            continue;
        };
        if !matches!(record.kind, TypeKind::Object { .. })
            || !snapshot.type_arguments.contains_key(&ty)
        {
            continue;
        }
        groups.entry(symbol).or_default().push(ty);
    }

    let mut found: FxHashMap<SymbolId, Vec<Instantiation>> = FxHashMap::default();
    for (symbol, members) in groups {
        // The declaration is the one whose arguments are its own type
        // parameters. Everything else in the group was made from it.
        let Some(&declaration) = members.iter().find(|ty| {
            arguments(snapshot, **ty)
                .iter()
                .all(|arg| is_parameter(snapshot, *arg))
        }) else {
            continue;
        };
        let parameters = arguments(snapshot, declaration);

        let mut instances = Vec::new();
        for ty in members {
            if ty == declaration {
                continue;
            }
            let concrete = arguments(snapshot, ty);
            if concrete.len() != parameters.len() {
                continue;
            }
            // An argument that is still a type parameter is a *use* inside
            // another generic — `Box<T>` written in a generic function — and not
            // an instantiation this can emit a copy for.
            let mut substitution = Substitution::default();
            let mut usable = true;
            for (parameter, argument) in parameters.iter().zip(&concrete) {
                match representation(snapshot, *argument) {
                    Some(ty) if !is_parameter(snapshot, *argument) => {
                        substitution.insert(*parameter, ty);
                    }
                    _ => usable = false,
                }
            }
            if usable {
                instances.push(Instantiation { ty, substitution });
            }
        }
        // Sorted, so one compiler on one input emits its copies in one order.
        instances.sort_by_key(|instance| instance.ty.0);
        if !instances.is_empty() {
            found.insert(symbol, instances);
        }
    }
    found
}

fn arguments(snapshot: &SemanticSnapshot, ty: TypeId) -> Vec<TypeId> {
    snapshot
        .type_arguments
        .get(&ty)
        .cloned()
        .unwrap_or_default()
}

fn is_parameter(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    matches!(
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind),
        Some(TypeKind::TypeParameter { .. })
    )
}

/// One instantiation of one generic *function*.
#[derive(Debug, Clone)]
pub struct FunctionInstance {
    /// What each of the declaration's type parameters stands for here.
    pub substitution: Substitution,
    /// What the copy's name carries, so two copies do not collide.
    pub suffix: String,
}

/// Which copies of which generic functions to emit, and what each call names.
#[derive(Debug, Default)]
pub struct GenericFunctions {
    /// Copies to emit, by declaration node.
    pub copies: FxHashMap<nts_semantic_schema::NodeId, Vec<FunctionInstance>>,
    /// The suffix each *call site* appends to its callee's name.
    pub at_call: FxHashMap<nts_semantic_schema::NodeId, String>,
}

/// Every instantiation of every generic function, from the calls that make one.
///
/// # Why this is not the class version
///
/// A generic class arrives as one object type per instantiation, so
/// [`instantiations`] can find them by grouping types. A generic *function* has
/// no such type: what the checker gives is one **instantiated signature per call
/// site**, which `nts types` prints as
///
/// ```text
/// sig#2 <[TypeId(2)]> (xs: #3) -> #2      the declaration, generic
/// sig#3 (xs: #18) -> #8                   `first` at T = number
/// ```
///
/// So the instantiations are found at the calls, and the substitution is
/// recovered by matching the declaration's parameter types against the call's.
/// That is the same split the class version documents — what the checker
/// substitutes is the *signature*, and what it leaves alone is the body, whose
/// AST every copy shares.
#[must_use]
pub fn function_instantiations(snapshot: &SemanticSnapshot) -> GenericFunctions {
    let mut found = GenericFunctions::default();
    for (call, target) in &snapshot.call_targets {
        let Some(declaration) = target.callee else {
            continue;
        };
        let Some(generic) = declared_signature(snapshot, declaration) else {
            continue;
        };
        let Some(actual) = snapshot.signatures.get(target.signature.0 as usize) else {
            continue;
        };
        if generic.type_parameters.is_empty() || generic.parameters.len() != actual.parameters.len()
        {
            continue;
        }

        let mut substitution = Substitution::default();
        for (parameter, argument) in generic.parameters.iter().zip(&actual.parameters) {
            unify(snapshot, parameter.ty, argument.ty, &mut substitution);
        }
        unify(
            snapshot,
            generic.return_type,
            actual.return_type,
            &mut substitution,
        );

        // Every type parameter has to have been pinned down, and to something
        // this compiler can represent. One that was not is a call this cannot
        // emit a copy for, and it is refused where it is *written* rather than
        // here — which names the call rather than a type nobody wrote.
        if !generic
            .type_parameters
            .iter()
            .all(|parameter| substitution.contains_key(parameter))
        {
            continue;
        }
        let suffix = suffix_of(&generic.type_parameters, &substitution);
        found.at_call.insert(*call, suffix.clone());
        let copies = found.copies.entry(declaration).or_default();
        if !copies.iter().any(|copy| copy.suffix == suffix) {
            copies.push(FunctionInstance {
                substitution,
                suffix,
            });
        }
    }
    // Sorted, so one compiler on one input emits its copies in one order.
    for copies in found.copies.values_mut() {
        copies.sort_by(|a, b| a.suffix.cmp(&b.suffix));
    }
    found
}

/// The signature a function declaration declares, if it is one.
fn declared_signature(
    snapshot: &SemanticSnapshot,
    declaration: nts_semantic_schema::NodeId,
) -> Option<&nts_semantic_schema::SignatureRecord> {
    // The declaration's own type, which the checker records per node. Reading
    // it off the *name*'s symbol also works for a plain function and does not
    // for a generic one, whose symbol carries the declaration's type while the
    // node carries the signature.
    let ty = snapshot.node_types.get(&declaration).copied().or_else(|| {
        let node = snapshot.nodes.get(declaration.0 as usize)?;
        let name = node.children.iter().find_map(|child| {
            let child = snapshot.nodes.get(child.0 as usize)?;
            matches!(
                child.kind,
                nts_semantic_schema::NodeKind::Syntax(nts_semantic_schema::syntax::IDENTIFIER)
            )
            .then_some(child)
        })?;
        snapshot.symbols.get(name.symbol?.0 as usize)?.ty
    })?;
    let TypeKind::Function(signature) = snapshot.types.get(ty.0 as usize)?.kind else {
        return None;
    };
    snapshot.signatures.get(signature.0 as usize)
}

/// Recover `T = number` by matching a generic type against an instantiated one.
///
/// Structural and deliberately shallow: a type parameter binds to whatever
/// stands opposite it, and an array matches an array. Anything else contributes
/// nothing, which leaves the type parameter unbound and the call refused —
/// wrong only in being conservative.
fn unify(snapshot: &SemanticSnapshot, generic: TypeId, actual: TypeId, into: &mut Substitution) {
    if is_parameter(snapshot, generic) {
        if let Some(ty) = representation(snapshot, actual)
            && !is_parameter(snapshot, actual)
        {
            into.insert(generic, ty);
        }
        return;
    }
    let (Some(generic), Some(actual)) = (
        snapshot.types.get(generic.0 as usize),
        snapshot.types.get(actual.0 as usize),
    ) else {
        return;
    };
    if let (TypeKind::Array(inner), TypeKind::Array(against)) = (&generic.kind, &actual.kind) {
        unify(snapshot, *inner, *against, into);
    }
}

/// What one instantiation's copy is called.
///
/// The *machine* types rather than the source ones: `first<f64>` is the copy a
/// program needs, and two source types that share a representation want one
/// copy rather than two identical ones. `<` and `>` cannot appear in a
/// TypeScript identifier, so a copy's name cannot collide with a plain
/// function's — the same trick the class version uses.
fn suffix_of(parameters: &[TypeId], substitution: &Substitution) -> String {
    let spelled: Vec<String> = parameters
        .iter()
        .map(|parameter| {
            substitution
                .get(parameter)
                .map_or_else(|| "?".to_owned(), spell)
        })
        .collect();
    format!("<{}>", spelled.join(","))
}

/// A machine type, spelled the way `nts hir` spells it.
///
/// Short on purpose: this ends up in a C identifier, and `Float { bits: 64 }`
/// is both unreadable and full of characters that have to be escaped.
fn spell(ty: &super::HirType) -> String {
    use super::{HirType, ManagedType};
    match ty {
        HirType::Void => "void".to_owned(),
        HirType::Never => "never".to_owned(),
        HirType::Bool => "bool".to_owned(),
        HirType::Float { bits } => format!("f{bits}"),
        HirType::Int { bits, signed } => {
            format!("{}{bits}", if *signed { 'i' } else { 'u' })
        }
        HirType::Managed(ManagedType::String) => "str".to_owned(),
        HirType::Managed(ManagedType::Array(element)) => format!("[{}]", spell(element)),
        HirType::Managed(ManagedType::Object(id)) => format!("obj{}", id.0),
        HirType::Managed(ManagedType::Promise(payload)) => {
            format!("promise{}", spell(payload))
        }
    }
}

/// How many type parameters a function declaration has of its own.
#[must_use]
pub fn declared_type_parameters(
    snapshot: &SemanticSnapshot,
    declaration: nts_semantic_schema::NodeId,
) -> usize {
    declared_signature(snapshot, declaration).map_or(0, |signature| signature.type_parameters.len())
}
