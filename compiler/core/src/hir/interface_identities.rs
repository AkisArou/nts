//! Interface declaration identity survives structural storage sharing.

use std::collections::BTreeMap;

use nts_semantic_schema::{SemanticSnapshot, SymbolFlags, TypeId, TypeKind};
use rustc_hash::FxHashSet;

use super::{InterfaceIdentity, Program};

/// Record used instantiations of the hierarchy's semantic interfaces.
/// A class augmented by an interface remains a class; library interfaces that
/// represent provided classes (notably Error) are not hierarchy faces.
///
/// `original_types` is the input snapshot's type count, before
/// `instantiate::materialise` appended its own records. Only an original
/// decomposed Object with no `base_types` entry proves a root: the frontend
/// read its bases and the empty answer is the one case the snapshot leaves
/// out. A type materialisation made -- `Writer::instance`'s synthetic empty
/// Object above all -- never had its bases read, so its absence of an entry
/// proves nothing. Nor does a synthetic entry prove itself: `Writer`
/// writes partial base lists by design (a base it cannot substitute is
/// dropped, for the reason unsubstitutable properties are), so a synthetic
/// entry is published only where [`parents_of`] can prove it whole.
pub(super) fn collect(
    snapshot: &SemanticSnapshot,
    faces: &FxHashSet<TypeId>,
    original_types: usize,
    program: &mut Program,
) {
    let declared: FxHashSet<u32> = faces
        .iter()
        .filter_map(|ty| interface_symbol(snapshot, *ty))
        .collect();
    let declared_bases = declared_base_counts(snapshot, original_types);
    let mut identities: BTreeMap<u32, InterfaceIdentity> = BTreeMap::new();
    for ty in program.layouts.iter().flat_map(|layout| &layout.types) {
        let Some(symbol) = interface_symbol(snapshot, *ty) else {
            continue;
        };
        if !declared.contains(&symbol) {
            continue;
        }
        let parents = parents_of(snapshot, *ty, symbol, original_types, &declared_bases);
        let identity = identities
            .entry(symbol)
            .or_insert_with(|| InterfaceIdentity {
                symbol,
                name: snapshot.symbols[symbol as usize].name.to_string(),
                types: Vec::new(),
                names: BTreeMap::new(),
                parents: BTreeMap::new(),
            });
        identity.types.push(*ty);
        identity.names.insert(
            *ty,
            format!(
                "{}{}",
                identity.name,
                super::lower::instantiation_suffix(snapshot, *ty)
            ),
        );
        if let Some(parents) = parents {
            identity.parents.insert(*ty, parents);
        }
    }
    for identity in identities.values_mut() {
        identity.types.sort_unstable();
        identity.types.dedup();
    }
    program.interface_identities = identities.into_values().collect();
}

/// A type's published parents, or `None` for unknown ancestry.
///
/// An explicit `base_types` entry is its producer's evidence and is
/// published wherever it came from -- once it proves complete. A synthetic
/// instantiation's entry needs that proof: `Writer::instance` drops a base
/// it cannot substitute, so its list can be a prefix of the declaration's.
/// Completeness is the declaration's own base count, and a concrete
/// instantiation may not publish a base still written in the form's
/// parameters, which `settle_bases` leaves in place when substitution
/// fails. With no entry at all, only an original decomposed Object is a
/// proved root; an opaque `Structured` type or a materialised record is
/// unknown.
fn parents_of(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    symbol: u32,
    original_types: usize,
    declared_bases: &BTreeMap<u32, Option<usize>>,
) -> Option<Vec<TypeId>> {
    let original = (ty.0 as usize) < original_types;
    match snapshot.base_types.get(&ty) {
        Some(bases) => {
            if !original && declared_bases.get(&symbol).copied().flatten() != Some(bases.len()) {
                return None;
            }
            if !substituted(snapshot, ty, bases) {
                return None;
            }
            Some(bases.clone())
        }
        None => (original
            && snapshot
                .types
                .get(ty.0 as usize)
                .is_some_and(|record| matches!(record.kind, TypeKind::Object { .. })))
        .then(Vec::new),
    }
}

/// Whether every base is written at this instantiation, not at its form.
/// A type whose own arguments still mention parameters is itself a form
/// and may name form bases; a concrete one may not.
fn substituted(snapshot: &SemanticSnapshot, ty: TypeId, bases: &[TypeId]) -> bool {
    let mentions =
        |candidate: &TypeId| super::instantiate::mentions_a_parameter(snapshot, *candidate);
    let concrete = snapshot
        .type_arguments
        .get(&ty)
        .is_none_or(|arguments| arguments.iter().all(|argument| !mentions(argument)));
    !concrete || bases.iter().all(|base| !mentions(base))
}

/// Each symbol's declared base count, read from original types only --
/// the entries the frontend wrote whole. `None` where original records
/// of one symbol disagree, which proves nothing and publishes nothing
/// synthetic for that symbol.
fn declared_base_counts(
    snapshot: &SemanticSnapshot,
    original_types: usize,
) -> BTreeMap<u32, Option<usize>> {
    let mut counts: BTreeMap<u32, Option<usize>> = BTreeMap::new();
    for (at, record) in snapshot.types.iter().take(original_types).enumerate() {
        let Some(symbol) = record.symbol else {
            continue;
        };
        let Ok(at) = u32::try_from(at) else { continue };
        let Some(bases) = snapshot.base_types.get(&TypeId(at)) else {
            continue;
        };
        match counts.entry(symbol.0) {
            std::collections::btree_map::Entry::Vacant(slot) => {
                slot.insert(Some(bases.len()));
            }
            std::collections::btree_map::Entry::Occupied(mut slot) => {
                if *slot.get() != Some(bases.len()) {
                    slot.insert(None);
                }
            }
        }
    }
    counts
}

fn interface_symbol(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<u32> {
    let symbol = snapshot.types.get(ty.0 as usize)?.symbol?;
    let flags = snapshot.symbols.get(symbol.0 as usize)?.flags;
    (flags.contains(SymbolFlags::INTERFACE) && !flags.contains(SymbolFlags::CLASS))
        .then_some(symbol.0)
}

#[cfg(test)]
mod tests {
    use nts_semantic_schema::{
        SemanticSnapshot, SymbolFlags, SymbolId, SymbolRecord, TypeId, TypeKind, TypeRecord,
    };
    use rustc_hash::FxHashSet;

    use super::collect;
    use crate::hir::{Layout, Program};

    /// One generic declaration `Child<T> extends Root, Parent<T>`, its
    /// bases, a materialised `Child<number>` past the original types, and
    /// the records around them -- the smallest snapshot in which the
    /// proved-root, synthetic and opaque cases all occur.
    struct Fixture {
        snapshot: SemanticSnapshot,
        original_types: usize,
        root: TypeId,
        opaque: TypeId,
        parent_form: TypeId,
        parent_number: TypeId,
        child_form: TypeId,
        child_number: TypeId,
        synthetic: TypeId,
    }

    fn fixture() -> Fixture {
        let mut snapshot = SemanticSnapshot::default();
        for (name, flags) in [
            ("Root", SymbolFlags::INTERFACE),
            ("Opaque", SymbolFlags::INTERFACE),
            ("Parent", SymbolFlags::INTERFACE),
            ("Child", SymbolFlags::INTERFACE),
            ("Synthetic", SymbolFlags::INTERFACE),
            ("number", SymbolFlags::default()),
        ] {
            snapshot.symbols.push(SymbolRecord {
                builtin: None,
                name: name.to_string().into(),
                flags,
                declarations: Vec::new(),
                declaration_sites: Vec::new(),
                ty: None,
                aliased: None,
                owner: None,
                constructor_value: None,
                library: None,
            });
        }
        let object = |symbol: u32| TypeRecord {
            kind: TypeKind::Object {
                properties: Vec::new(),
            },
            symbol: Some(SymbolId(symbol)),
        };
        // Original types, as the frontend would have written them.
        let root = TypeId(0);
        let opaque = TypeId(1);
        let parameter = TypeId(2);
        let parent_form = TypeId(3);
        let child_form = TypeId(4);
        let number = TypeId(5);
        snapshot.types = vec![
            object(0),
            TypeRecord {
                kind: TypeKind::Structured,
                symbol: Some(SymbolId(1)),
            },
            TypeRecord {
                kind: TypeKind::TypeParameter {
                    name: "T".to_string(),
                    is_this: false,
                    constraint: None,
                },
                symbol: None,
            },
            object(2),
            object(3),
            TypeRecord {
                kind: TypeKind::Number,
                symbol: Some(SymbolId(5)),
            },
        ];
        snapshot.type_arguments.insert(parent_form, vec![parameter]);
        snapshot.type_arguments.insert(child_form, vec![parameter]);
        snapshot
            .base_types
            .insert(child_form, vec![root, parent_form]);
        let original_types = snapshot.types.len();
        // Materialised types, appended past the originals.
        let parent_number = TypeId(6);
        let child_number = TypeId(7);
        let synthetic = TypeId(8);
        snapshot.types.push(object(2));
        snapshot.types.push(object(3));
        snapshot.types.push(object(4));
        snapshot.type_arguments.insert(parent_number, vec![number]);
        snapshot.type_arguments.insert(child_number, vec![number]);
        Fixture {
            snapshot,
            original_types,
            root,
            opaque,
            parent_form,
            parent_number,
            child_form,
            child_number,
            synthetic,
        }
    }

    fn run(fixture: &Fixture) -> Program {
        let types = vec![
            fixture.root,
            fixture.opaque,
            fixture.parent_form,
            fixture.parent_number,
            fixture.child_form,
            fixture.child_number,
            fixture.synthetic,
        ];
        let faces: FxHashSet<TypeId> = types.iter().copied().collect();
        let mut program = Program {
            layouts: vec![Layout {
                types,
                name: String::new(),
                fields: Vec::new(),
                methods: Vec::new(),
                interfaces: Vec::new(),
                base: None,
            }],
            ..Program::default()
        };
        collect(
            &fixture.snapshot,
            &faces,
            fixture.original_types,
            &mut program,
        );
        program
    }

    fn parents(program: &Program, ty: TypeId) -> Option<&[TypeId]> {
        program
            .interface_identities
            .iter()
            .find_map(|identity| identity.parents.get(&ty))
            .map(Vec::as_slice)
    }

    fn known(program: &Program, ty: TypeId) -> bool {
        program
            .interface_identities
            .iter()
            .any(|identity| identity.types.contains(&ty))
    }

    #[test]
    fn an_original_object_without_bases_is_a_proved_root() {
        let fixture = fixture();
        let program = run(&fixture);
        assert_eq!(parents(&program, fixture.root), Some([].as_slice()));
        // The form keeps its declared bases in its own parameters.
        assert_eq!(
            parents(&program, fixture.child_form),
            Some([fixture.root, fixture.parent_form].as_slice())
        );
    }

    #[test]
    fn a_materialised_instantiation_publishes_its_complete_substituted_bases() {
        let mut fixture = fixture();
        fixture.snapshot.base_types.insert(
            fixture.child_number,
            vec![fixture.root, fixture.parent_number],
        );
        let program = run(&fixture);
        assert_eq!(
            parents(&program, fixture.child_number),
            Some([fixture.root, fixture.parent_number].as_slice())
        );
    }

    #[test]
    fn a_partial_synthetic_entry_is_not_published() {
        let mut fixture = fixture();
        // Writer::instance dropped the Parent base it could not substitute.
        fixture
            .snapshot
            .base_types
            .insert(fixture.child_number, vec![fixture.root]);
        let program = run(&fixture);
        assert!(known(&program, fixture.child_number));
        assert_eq!(parents(&program, fixture.child_number), None);
    }

    #[test]
    fn an_unsubstituted_form_base_is_not_published() {
        let mut fixture = fixture();
        fixture.snapshot.base_types.insert(
            fixture.child_number,
            vec![fixture.root, fixture.parent_form],
        );
        let program = run(&fixture);
        assert!(known(&program, fixture.child_number));
        assert_eq!(parents(&program, fixture.child_number), None);
    }

    #[test]
    fn a_symbol_with_no_original_entry_proves_no_synthetic_entry() {
        let mut fixture = fixture();
        // Parent's records carry no original base_types entry, so there is
        // no declared count to prove this synthetic entry against: unknown,
        // however plausible the list looks.
        fixture
            .snapshot
            .base_types
            .insert(fixture.parent_number, vec![fixture.root]);
        let program = run(&fixture);
        assert!(known(&program, fixture.parent_number));
        assert_eq!(parents(&program, fixture.parent_number), None);
    }

    #[test]
    fn synthetic_and_opaque_types_have_no_proved_root() {
        let fixture = fixture();
        let program = run(&fixture);
        // The synthetic empty Object is a known identity, but its missing
        // bases were never read, so it has no ancestry answer.
        assert!(known(&program, fixture.synthetic));
        assert_eq!(parents(&program, fixture.synthetic), None);
        assert!(known(&program, fixture.opaque));
        assert_eq!(parents(&program, fixture.opaque), None);
        // A materialised instantiation with no entry is likewise unknown,
        // even though its declaration's bases are on record.
        assert!(known(&program, fixture.child_number));
        assert_eq!(parents(&program, fixture.child_number), None);
    }
}
