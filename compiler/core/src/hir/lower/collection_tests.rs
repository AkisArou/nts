//! Exact answers and operation counts for program-wide lowering collections.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::cell::Cell;

use super::{ClosureInfo, ClosureSource, Field, HirType, Layout, NodeId, Program, TypeId};

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Counts {
    pub closure_copies: usize,
    pub derived_elements: usize,
    pub layout_candidates: usize,
    pub name_candidates: usize,
}

thread_local! {
    static COUNTS: Cell<Counts> = Cell::new(Counts {
        closure_copies: 0, derived_elements: 0,
        layout_candidates: 0, name_candidates: 0,
    });
}

pub(super) fn note(change: impl FnOnce(&mut Counts)) {
    COUNTS.with(|cell| {
        let mut counts = cell.get();
        change(&mut counts);
        cell.set(counts);
    });
}

fn reset() {
    COUNTS.with(|cell| cell.set(Counts::default()));
}

fn counts() -> Counts {
    COUNTS.with(Cell::get)
}

fn layout(name: &str, ty: u32, field: &str) -> Layout {
    Layout {
        name: name.to_owned(),
        types: vec![TypeId(ty)],
        fields: vec![Field {
            name: field.to_owned(),
            ty: HirType::NUMBER,
            written: None,
            declared_by: None,
            readonly: false,
        }],
        methods: Vec::new(),
        base: None,
        interfaces: Vec::new(),
    }
}

/// The scan before indexing. Keep this independent of the indexed answer.
fn old_find(existing: &[Layout], incoming: &Layout) -> Option<usize> {
    existing.iter().position(|known| {
        known.types.iter().any(|ty| incoming.types.contains(ty))
            || (super::may_merge(&known.name, &incoming.name)
                && known.same_shape(&incoming.fields, &incoming.methods, incoming.base))
    })
}

fn old_name(existing: &[Layout], name: &str, own: Option<TypeId>) -> String {
    let collision = existing
        .iter()
        .any(|known| known.name == name && known.types.first().copied() != own);
    match (collision, own) {
        (true, Some(ty)) => format!("{name}{}", ty.0),
        _ => name.to_owned(),
    }
}

fn old_collect(program: &mut Program, incoming: Vec<Layout>) {
    for mut layout in incoming {
        if let Some(at) = old_find(&program.layouts, &layout) {
            let known = &mut program.layouts[at];
            if let Some((kept, discarded)) =
                super::one_type_two_orders(&known.fields, &layout.fields)
            {
                program.disputed_layouts.push(super::super::DisputedLayout {
                    name: known.name.clone(),
                    kept,
                    discarded,
                });
            }
            for ty in layout.types {
                if !known.types.contains(&ty) {
                    known.types.push(ty);
                }
            }
            if super::generated_name(&known.name) && !super::generated_name(&layout.name) {
                let own = known.types.first().copied();
                let name = old_name(&program.layouts, &layout.name, own);
                if let Some(at) = program
                    .layouts
                    .iter()
                    .position(|known| known.types.first().copied() == own)
                {
                    program.layouts[at].name = name;
                }
            }
        } else {
            layout.name = old_name(
                &program.layouts,
                &layout.name,
                layout.types.first().copied(),
            );
            program.layouts.push(layout);
        }
    }
}

fn assert_programs_equal(expected: &Program, actual: &Program) {
    assert_eq!(
        format!("{:?}", expected.layouts),
        format!("{:?}", actual.layouts)
    );
    assert_eq!(
        format!("{:?}", expected.disputed_layouts),
        format!("{:?}", actual.disputed_layouts),
    );
}

#[test]
fn the_first_shape_match_wins_over_a_later_type_match() {
    let first = layout("First", 1, "value");
    let later = layout("Later", 2, "other");
    let incoming = layout("Incoming", 2, "value");
    let mut expected = Program {
        layouts: vec![first, later],
        ..Program::default()
    };
    assert_eq!(old_find(&expected.layouts, &incoming), Some(0));
    let mut actual = Program {
        layouts: expected.layouts.clone(),
        ..Program::default()
    };
    old_collect(&mut expected, vec![incoming.clone()]);
    super::collect_layouts(&mut actual, vec![incoming]);
    assert_programs_equal(&expected, &actual);
}

#[test]
fn rename_preserves_owner_exemption_and_the_single_suffix() {
    let rows = vec![layout("Options", 1, "a"), layout("Options7", 2, "b")];
    for own in [None, Some(TypeId(1)), Some(TypeId(7))] {
        assert_eq!(
            super::unshared_layout_name_for(&rows, "Options", own),
            old_name(&rows, "Options", own)
        );
    }
    assert_eq!(old_name(&rows, "Options", Some(TypeId(7))), "Options7");
    let mut expected = Program {
        layouts: rows.clone(),
        ..Program::default()
    };
    let mut actual = Program {
        layouts: rows,
        ..Program::default()
    };
    for incoming in [layout("Type5", 5, "c"), layout("Options", 7, "c")] {
        old_collect(&mut expected, vec![incoming.clone()]);
        super::collect_layouts(&mut actual, vec![incoming]);
        assert_programs_equal(&expected, &actual);
    }
    assert_eq!(actual.layouts[2].name, "Options5");
}

struct Random(u32);

impl Random {
    fn next(&mut self, limit: u32) -> u32 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        self.0 % limit
    }

    fn layout(&mut self) -> Layout {
        let names = [
            "Type5",
            "Frame",
            "Frame7",
            "TypeError",
            "Fn1__2",
            "Ctor_A",
            "java/A",
            "Tuple2",
            "Other",
        ];
        let name = names[usize::try_from(self.next(u32::try_from(names.len()).unwrap())).unwrap()];
        let mut row = layout(name, self.next(12), "x");
        row.types = (0..self.next(4)).map(|_| TypeId(self.next(12))).collect();
        row.base = (self.next(3) == 0).then(|| TypeId(self.next(4)));
        row.fields = (0..self.next(4))
            .map(|_| Field {
                name: format!("f{}", self.next(3)),
                ty: if self.next(2) == 0 {
                    HirType::NUMBER
                } else {
                    HirType::Bool
                },
                written: (self.next(3) == 0).then_some(super::super::native::Scalar::Int32),
                declared_by: (self.next(2) == 0).then(|| TypeId(self.next(4))),
                readonly: self.next(2) == 0,
            })
            .collect();
        row.methods = (0..self.next(3))
            .map(|_| (self.next(3) != 0).then(|| format!("call{}", self.next(3))))
            .collect();
        row.interfaces = (0..self.next(3)).map(|_| TypeId(self.next(4))).collect();
        row
    }
}

#[test]
fn randomized_aliases_shapes_and_rename_sequences_match_the_old_scan() {
    for seed in 0..256 {
        let mut random = Random(seed);
        let initial: Vec<_> = (0..random.next(9)).map(|_| random.layout()).collect();
        let mut expected = Program {
            layouts: initial.clone(),
            ..Program::default()
        };
        let mut actual = Program {
            layouts: initial,
            ..Program::default()
        };
        for _ in 0..24 {
            let incoming = random.layout();
            old_collect(&mut expected, vec![incoming.clone()]);
            super::collect_layouts(&mut actual, vec![incoming]);
            assert_programs_equal(&expected, &actual);
        }
    }
}

#[test]
fn layout_match_candidates_are_linear_for_distinct_layouts() {
    for n in [64_u32, 128, 256] {
        let mut program = Program::default();
        reset();
        for ty in 0..n {
            super::collect_layouts(
                &mut program,
                vec![layout(&format!("Frame{ty}"), ty, &format!("field{ty}"))],
            );
        }
        assert_eq!(program.layouts.len(), usize::try_from(n).unwrap());
        let visits = counts().layout_candidates;
        assert!(
            visits <= 3 * usize::try_from(n).unwrap(),
            "N={n}: {visits} candidates"
        );
    }
}

#[test]
fn name_candidates_are_linear_for_distinct_layouts() {
    for n in [64_u32, 128, 256] {
        let mut program = Program::default();
        reset();
        for ty in 0..n {
            super::collect_layouts(
                &mut program,
                vec![layout(&format!("Frame{ty}"), ty, &format!("field{ty}"))],
            );
        }
        let visits = counts().name_candidates;
        assert!(
            visits <= 3 * usize::try_from(n).unwrap(),
            "N={n}: {visits} candidates"
        );
    }
}

fn shared(n: u32) -> super::Shared {
    let closures: Vec<_> = (0..n)
        .map(|node| ClosureInfo {
            node: NodeId(node),
            captures: vec![super::Capture {
                symbol: node,
                readiness_only: false,
                settles: None,
                name: format!("capture{node}"),
                at: NodeId(node),
                forward: node % 3 == 0,
                by_reference: node % 2 == 0,
            }],
            refusal: None,
            source: ClosureSource::Authored,
            within: None,
            within_copy: None,
            retyped_captures: std::collections::BTreeMap::new(),
            reads_this: false,
        })
        .collect();
    super::Shared {
        module: super::ModuleScope::default(),
        hierarchy: super::Hierarchy::default(),
        closures: closures.into(),
        naming: super::Naming::default(),
        generics: super::super::generics::GenericFunctions::default(),
        structural: super::Structural::default(),
        class_instances: std::rc::Rc::default(),
        thenables: std::rc::Rc::default(),
    }
}

#[test]
fn builders_do_not_copy_the_closure_table() {
    let semantic = nts_semantic_schema::SemanticSnapshot::default();
    let snapshot = super::LoweringSnapshot::new(&semantic);
    let foreign = super::NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default);
    for n in [64_u32, 128, 256] {
        reset();
        let shared = shared(n);
        for _ in 0..n {
            let builder = shared.builder(&snapshot, foreign, super::Copy::default());
            assert_eq!(builder.closures.len(), usize::try_from(n).unwrap());
            assert!(
                std::ptr::eq(&builder.closures[0], &shared.closures[0]),
                "builders must read the same allocated table"
            );
        }
        assert_eq!(counts().closure_copies, 0, "N={n}: whole-table copies");
    }
}

#[test]
fn builders_derive_capture_views_once() {
    let semantic = nts_semantic_schema::SemanticSnapshot::default();
    let snapshot = super::LoweringSnapshot::new(&semantic);
    let foreign = super::NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default);
    for n in [64_u32, 128, 256] {
        reset();
        let shared = shared(n);
        for _ in 0..n {
            let builder = shared.builder(&snapshot, foreign, super::Copy::default());
            assert!(
                builder
                    .boxed
                    .iter()
                    .copied()
                    .eq((0..n).filter(|symbol| symbol % 2 == 0))
            );
            assert!(
                builder
                    .guarded
                    .iter()
                    .copied()
                    .eq((0..n).filter(|symbol| symbol % 3 == 0))
            );
        }
        let visited = counts().derived_elements;
        assert!(
            visited <= 2 * usize::try_from(n).unwrap(),
            "N={n}: {visited} derived elements"
        );
    }
}
