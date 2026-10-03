//! The source-site constants a program actually uses, shared by all emitters.
use super::{OpKind, Program};
use nts_semantic_schema::Origin;
use std::collections::BTreeMap;

#[derive(Debug)]
pub struct Object<'a> {
    pub site: u32,
    pub cooked: &'a [String],
    pub origin: &'a Origin,
}

/// Whether emitted code can encounter an immutable template object.
#[must_use]
pub fn present(program: &Program) -> bool {
    program.funcs.iter().any(|func| {
        func.blocks.iter().any(|block| {
            block.ops.iter().any(|value| {
                matches!(
                    func.values[value.0 as usize].kind,
                    OpKind::ConstTemplate { .. }
                )
            })
        })
    })
}

#[must_use]
pub fn objects(program: &Program) -> Vec<Object<'_>> {
    let mut objects = BTreeMap::new();
    for func in &program.funcs {
        for block in &func.blocks {
            for value in &block.ops {
                let op = &func.values[value.0 as usize];
                if let OpKind::ConstTemplate { site, cooked } = &op.kind {
                    objects.entry(*site).or_insert(Object {
                        site: *site,
                        cooked,
                        origin: &op.origin,
                    });
                }
            }
        }
    }
    objects.into_values().collect()
}
