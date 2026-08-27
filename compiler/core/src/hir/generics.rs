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
