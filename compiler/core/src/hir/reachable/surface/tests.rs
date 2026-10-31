use super::*;
use crate::hir::{Field, Global, Layout, SYNTHETIC_CLOSURES};
use nts_semantic_schema::Origin;

#[derive(Default, Debug)]
struct Counts([usize; 10]);

impl Observer for Counts {
    fn visit(&mut self, work: Work) {
        self.0[work as usize] += 1;
    }
}

fn object(id: u32) -> HirType {
    HirType::Managed(ManagedType::Object(TypeId(id)))
}

fn layout(types: Vec<TypeId>, fields: Vec<HirType>) -> Layout {
    Layout {
        name: format!("Record{}", types[0].0),
        types,
        fields: fields
            .into_iter()
            .enumerate()
            .map(|(index, ty)| Field {
                name: format!("field{index}").into(),
                ty,
                written: None,
                declared_by: None,
                readonly: true,
            })
            .collect(),
        methods: Vec::new(),
        interfaces: Vec::new(),
        base: None,
    }
}

fn publish(program: &mut Program, id: u32) {
    let name = format!("value{}", program.globals.len());
    program.public_api.push((name.clone(), name.clone()));
    program.globals.push(Global {
        name,
        ty: object(id),
        written: None,
        constant: true,
        initial: 0.0,
        exported: true,
        deferred: false,
        origin: Origin::source(nts_diagnostics::Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span::new(0, 0),
        }),
    });
}

fn cyclic_records(n: u32) -> Program {
    let mut program = Program::default();
    for index in 0..n {
        let record = index + 1;
        let alias = n + record;
        program.layouts.push(layout(
            vec![TypeId(record), TypeId(alias)],
            vec![
                object(SYNTHETIC_CLOSURES + index),
                HirType::Managed(ManagedType::Array(Box::new(object((index + 1) % n + 1)))),
                object(1),
            ],
        ));
        // Distinct roots, repeated roots and aliases share the same walk. The
        // array edge nests records into one cycle; every record also shares 1.
        for id in [record, record, alias] {
            publish(&mut program, id);
        }
    }
    program
}

#[test]
fn exported_shared_nested_and_cyclic_records_have_linear_actual_work() {
    for n in [16, 64, 256] {
        let program = cyclic_records(n);
        let mut counts = Counts::default();
        let found = observed(&program, &[], Roots::EntrySurface, &mut counts);
        assert_eq!(found.len(), n as usize);
        let expected = [0, 0, 3, 3, 1, 2, 7, 2, 1, 3].map(|factor| factor * n as usize);
        assert_eq!(counts.0, expected, "{n}: {counts:?}");
        println!(
            "surface_records n={n} visits={:?} total={}",
            counts.0,
            counts.0.iter().sum::<usize>()
        );
    }
}

#[test]
fn every_matching_layout_contributes_even_when_aliases_share_a_layout() {
    let mut program = Program {
        layouts: vec![
            layout(vec![TypeId(1), TypeId(2)], vec![object(SYNTHETIC_CLOSURES)]),
            layout(vec![TypeId(1)], vec![object(SYNTHETIC_CLOSURES + 1)]),
        ],
        ..Program::default()
    };
    publish(&mut program, 1);
    publish(&mut program, 2);
    let mut counts = Counts::default();
    let found = observed(&program, &[], Roots::EntrySurface, &mut counts);
    assert_eq!(
        found,
        FxHashSet::from_iter([TypeId(SYNTHETIC_CLOSURES), TypeId(SYNTHETIC_CLOSURES + 1)])
    );
    assert_eq!(counts.0[Work::LayoutEdge as usize], 3);
    assert_eq!(counts.0[Work::Layout as usize], 2);
    assert_eq!(counts.0[Work::Field as usize], 2);
}
