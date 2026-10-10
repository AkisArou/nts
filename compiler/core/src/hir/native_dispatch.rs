//! Project native tables onto their readers without changing logical dispatch.
//!
//! Every surviving selector keeps a distinct column. For every layout, its
//! body or null remains exactly the logical table's entry. In particular an
//! erased or structural receiver missing a method cannot acquire another body.
//! Co-filled selector sharing needs a stronger receiver proof and is deferred.

use std::collections::BTreeSet;

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Callee, Func, HirType, Layout, ManagedType, OpKind, Printed, Program};

/// One whole-program mapping, consumed by both native backends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeDispatch {
    /// Logical selector to native column; `None` means no native reader.
    pub columns: Vec<Option<u32>>,
    /// The width every nonempty native row has.
    pub width: u32,
    /// Bodies whose only references were in omitted table columns.
    omitted_bodies: FxHashSet<String>,
}

impl NativeDispatch {
    /// An omitted or invalid column is never an identity fallback.
    #[must_use]
    pub fn column(&self, selector: u32) -> Option<u32> {
        self.columns
            .get(selector as usize)
            .copied()
            .flatten()
            .filter(|column| *column < self.width)
    }
}

impl Program {
    /// Native code, without bodies made unreferenced by table projection.
    /// Logical declarations remain available for signatures and JVM emission.
    /// If a body is wrongly omitted, a surviving reference fails compilation
    /// or linking as an undefined symbol; it cannot silently call another body.
    pub fn native_funcs(&self) -> impl Iterator<Item = &Func> {
        self.funcs.iter().filter(|func| {
            self.native_dispatch
                .as_ref()
                .is_none_or(|table| !table.omitted_bodies.contains(&func.name))
        })
    }

    /// Native position of a logical selector. Raw HIR has identity tables.
    #[must_use]
    pub fn native_column(&self, selector: u32) -> Option<u32> {
        self.native_dispatch
            .as_ref()
            .map_or(Some(selector), |table| table.column(selector))
    }

    /// The same projection for both native emitters. A row with no remaining
    /// body is emitted as no table, as an empty logical row already is.
    pub fn native_methods<'a>(&self, layout: &'a Layout) -> Result<Vec<Option<&'a str>>, String> {
        let Some(table) = &self.native_dispatch else {
            return Ok(layout.methods.iter().map(Option::as_deref).collect());
        };
        if table.width as usize > table.columns.len() {
            return Err("native dispatch width exceeds its selector map".to_owned());
        }
        let mut row = vec![None; table.width as usize];
        for (selector, body) in layout.methods.iter().enumerate() {
            let Some(Some(column)) = table.columns.get(selector) else {
                continue;
            };
            let Some(entry) = row.get_mut(*column as usize) else {
                return Err(format!(
                    "native dispatch column {column} is outside its row"
                ));
            };
            if body.is_some() && entry.is_some() {
                return Err(format!("two selectors occupy native column {column}"));
            }
            if body.is_some() {
                *entry = body.as_deref();
            }
        }
        Ok(row)
    }
}

/// After every pass that shapes functions or layouts. Sorting the readers
/// makes the plan independent of function, layout and hash iteration order.
pub(super) fn plan(program: &mut Program) {
    let mut readers = BTreeSet::from([super::closure_call_slot(program)]);
    for func in &program.funcs {
        for op in func
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .map(|v| func.value(*v))
        {
            match &op.kind {
                OpKind::Call {
                    callee: Callee::Virtual { slot, .. } | Callee::Closure { slot },
                    ..
                }
                | OpKind::PromiseSubscribe { slot, .. }
                | OpKind::DispatchSlot(slot) => {
                    readers.insert(*slot);
                }
                OpKind::NativeBridge { closure, .. } => {
                    if let HirType::Managed(ManagedType::Object(ty)) = func.value(*closure).ty
                        && let Some(layout) = program.layouts.iter().find(|l| l.types.contains(&ty))
                        && let Some(slot) = super::bridged_through_table(program, layout)
                    {
                        readers.insert(slot);
                    }
                }
                _ => {}
            }
        }
    }
    let size = readers.last().map_or(0, |slot| *slot as usize + 1);
    let mut columns = vec![None; size];
    for (column, selector) in readers.iter().enumerate() {
        columns[*selector as usize] = u32::try_from(column).ok();
    }
    let mut table = NativeDispatch {
        columns,
        width: u32::try_from(readers.len()).unwrap_or(u32::MAX),
        omitted_bodies: FxHashSet::default(),
    };
    table.omitted_bodies = omitted_bodies(program, &table);
    program.native_dispatch = Some(table);
}

/// A conservative emission view, not another whole-program DCE. Only table
/// bodies can be omitted; every other function starts as a root. Projected
/// rows, public/foreign entries and printing keep their bodies, and a walk
/// keeps direct callees and the targets codegen names inside native bridges.
fn omitted_bodies(program: &Program, table: &NativeDispatch) -> FxHashSet<String> {
    let mut candidates = FxHashSet::default();
    let mut pending = Vec::new();
    for layout in &program.layouts {
        for (selector, body) in layout.methods.iter().enumerate() {
            let Some(body) = body.as_deref() else {
                continue;
            };
            if table.columns.get(selector).is_some_and(Option::is_some) {
                pending.push(body);
            } else {
                candidates.insert(body);
            }
        }
    }
    pending.extend(
        program
            .funcs
            .iter()
            .filter(|func| !candidates.contains(func.name.as_str()))
            .map(|func| func.name.as_str()),
    );
    pending.extend(super::reachable::root_names(
        program,
        super::reachable::Roots::EveryExport,
    ));
    // Class members are published under their owner's name, not their own.
    let published: FxHashSet<&str> = program
        .public_api
        .iter()
        .map(|(name, _)| name.as_str())
        .collect();
    pending.extend(program.funcs.iter().filter_map(|func| {
        func.name
            .split_once('#')
            .is_some_and(|(owner, _)| published.contains(owner))
            .then_some(func.name.as_str())
    }));
    pending.extend(
        program
            .printed
            .values()
            .filter_map(|printed| match printed {
                Printed::By(name) => Some(name.as_str()),
                _ => None,
            }),
    );
    let by_name: FxHashMap<&str, &Func> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), func))
        .collect();
    let layouts = super::fields::LayoutIndex::build(program);
    let mut kept = FxHashSet::default();
    while let Some(name) = pending.pop() {
        if !kept.insert(name) {
            continue;
        }
        let Some(func) = by_name.get(name) else {
            continue;
        };
        for op in func
            .blocks
            .iter()
            .flat_map(|b| &b.ops)
            .map(|v| func.value(*v))
        {
            match &op.kind {
                OpKind::Call {
                    callee: Callee::Direct(target),
                    ..
                }
                | OpKind::Suspend { resume: target, .. } => pending.push(target),
                OpKind::NativeBridge {
                    closure, bridging, ..
                } => {
                    pending.extend(bridging.converted.iter().map(|c| c.function.as_str()));
                    if let HirType::Managed(ManagedType::Object(ty)) = func.value(*closure).ty
                        && let Some(at) = layouts.of_class(ty)
                        && let Some(target) = program.layouts[at].closure_call()
                    {
                        pending.push(target);
                    }
                }
                _ => {}
            }
        }
    }
    candidates
        .difference(&kept)
        .map(|name| (*name).to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, Func, Op, Terminator, ValueId};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::{GeneratedReason, Origin, TypeId};

    fn function(name: &str, selectors: &[u32]) -> Func {
        let origin = Origin::generated(
            Location {
                file: SourceId(0),
                span: Span::new(0, 0),
            },
            GeneratedReason::AbiProjection,
        );
        let values: Vec<Op> = selectors
            .iter()
            .map(|slot| Op {
                kind: OpKind::DispatchSlot(*slot),
                ty: HirType::NUMBER,
                origin: origin.clone(),
            })
            .collect();
        Func {
            name: name.to_owned(),
            params: Vec::new(),
            return_type: HirType::NUMBER,
            blocks: vec![Block {
                params: Vec::new(),
                ops: (0..values.len())
                    .map(|v| ValueId(u32::try_from(v).expect("value")))
                    .collect(),
                terminator: Terminator::Return(Some(ValueId(
                    u32::try_from(values.len() - 1).expect("value"),
                ))),
            }],
            values,
            origin,
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
            obligations: Vec::new(),
            written_return: None,
            written_return_elements: Vec::new(),
        }
    }

    fn row(name: &str, entries: &[(usize, &str)]) -> Layout {
        let mut methods = vec![None; 10];
        for (at, body) in entries {
            methods[*at] = Some((*body).to_owned());
        }
        Layout {
            name: name.to_owned(),
            types: vec![TypeId(1)],
            fields: Vec::new(),
            interfaces: Vec::new(),
            base: None,
            methods,
        }
    }

    #[test]
    fn every_live_body_and_null_survives_on_every_row() {
        let mut program = Program {
            funcs: vec![function("read", &[3, 7])],
            layouts: vec![
                row("one", &[(2, "unused"), (3, "three"), (7, "seven")]),
                row("missing", &[(2, "unused"), (7, "other")]),
            ],
            ..Program::default()
        };
        let logical = program
            .layouts
            .iter()
            .map(|l| l.methods.clone())
            .collect::<Vec<_>>();
        plan(&mut program);
        assert_eq!(program.native_dispatch.as_ref().expect("plan").width, 3);
        assert_eq!(program.native_column(2), None);
        assert_ne!(program.native_column(3), program.native_column(7));
        for (layout, before) in program.layouts.iter().zip(logical) {
            assert_eq!(layout.methods, before, "logical rows stay unchanged");
            let native = program.native_methods(layout).expect("project");
            for selector in [0, 3, 7] {
                let column = program.native_column(selector).expect("column") as usize;
                assert_eq!(native[column], layout.methods[selector as usize].as_deref());
            }
        }
    }

    #[test]
    fn reader_order_does_not_choose_columns() {
        let mut program = Program {
            funcs: vec![function("a", &[9, 2]), function("b", &[5])],
            ..Program::default()
        };
        plan(&mut program);
        let before = program.native_dispatch.clone();
        program.funcs.reverse();
        plan(&mut program);
        assert_eq!(program.native_dispatch, before);
        assert_eq!(program.native_column(9), Some(3));
    }

    #[test]
    fn a_symbolic_slot_has_no_numeric_value_before_emission() {
        let mut func = function("slot", &[7]);
        let analysis = crate::hir::flow::analyze(&func);
        assert_eq!(analysis.get(ValueId(0)), crate::hir::facts::Facts::TOP);
        assert_eq!(crate::hir::fold::fold(&mut func, &analysis), 0);
        assert!(matches!(func.values[0].kind, OpKind::DispatchSlot(7)));
        assert!(crate::hir::verify::operands(&func.values[0].kind).is_empty());
    }

    #[test]
    fn an_unused_symbolic_slot_has_no_effect_to_keep() {
        let mut func = function("slot", &[3, 7]);
        assert_eq!(crate::hir::dce::eliminate(&mut func), 1);
        assert_eq!(func.blocks[0].ops, vec![ValueId(1)]);
    }

    #[test]
    fn the_verifier_rejects_an_omitted_live_column() {
        let mut program = Program {
            funcs: vec![function("slot", &[7])],
            ..Program::default()
        };
        plan(&mut program);
        assert!(crate::hir::verify::verify(&program).is_ok());
        program.native_dispatch.as_mut().expect("plan").columns[7] = None;
        let errors = crate::hir::verify::verify(&program).expect_err("missing reader");
        assert!(errors.iter().any(|error| matches!(
            error,
            crate::hir::verify::Invalid::MissingNativeColumn { slot: 7, .. }
        )));
    }

    fn internal(name: &str) -> Func {
        let mut func = function(name, &[0]);
        func.exported = false;
        func
    }

    fn call(func: &mut Func, target: &str) {
        func.values[0].kind = OpKind::Call {
            callee: Callee::Direct(target.to_owned()),
            args: Vec::new(),
            frame: None,
        };
    }

    #[test]
    fn emission_drops_only_unread_table_bodies_including_a_cycle() {
        let mut first = internal("first");
        let mut second = internal("second");
        call(&mut first, "second");
        call(&mut second, "first");
        let mut program = Program {
            funcs: vec![first, second, internal("other")],
            layouts: vec![row("entries", &[(3, "first"), (7, "second")])],
            ..Program::default()
        };
        assert_eq!(program.native_funcs().count(), 3, "raw HIR stays unchanged");
        plan(&mut program);
        assert_eq!(
            program
                .native_funcs()
                .map(|f| f.name.as_str())
                .collect::<Vec<_>>(),
            ["other"]
        );
        assert_eq!(program.funcs.len(), 3, "logical bodies stay unchanged");
    }

    #[test]
    fn emission_keeps_direct_public_printed_and_projected_bodies() {
        let mut caller = internal("caller");
        call(&mut caller, "direct");
        let mut exported = internal("exported");
        exported.exported = true;
        let names = ["direct", "published", "Class#member", "printed", "live"];
        let mut funcs = vec![caller, exported];
        funcs.extend(names.map(internal));
        funcs.push(function("reader", &[7]));
        let mut program = Program {
            funcs,
            layouts: vec![row(
                "entries",
                &[
                    (3, "direct"),
                    (4, "exported"),
                    (5, "published"),
                    (6, "Class#member"),
                    (7, "live"),
                    (8, "printed"),
                ],
            )],
            public_api: vec![
                ("published".to_owned(), "alias".to_owned()),
                ("Class".to_owned(), "Class".to_owned()),
            ],
            printed: [("entries".to_owned(), Printed::By("printed".to_owned()))].into(),
            ..Program::default()
        };
        plan(&mut program);
        assert_eq!(program.native_funcs().count(), program.funcs.len());
        assert_eq!(program.native_column(3), None);
    }

    #[test]
    fn emission_keeps_the_body_and_conversion_named_by_a_bridge() {
        let mut bridge = internal("bridge");
        bridge.values[0].ty = HirType::Managed(ManagedType::Object(TypeId(1)));
        bridge.values.push(Op {
            kind: OpKind::NativeBridge {
                closure: ValueId(0),
                signature: std::sync::Arc::new(super::super::native::FnPointer {
                    name: "callback".to_owned(),
                    parameters: Vec::new(),
                    result: Box::new(super::super::native::Type::Void),
                }),
                context: true,
                once: false,
                bridging: super::super::Bridging {
                    converted: vec![super::super::ConvertedParameter {
                        at: 0,
                        function: "convert".to_owned(),
                    }],
                    ..super::super::Bridging::default()
                },
            },
            ty: HirType::NUMBER,
            origin: bridge.origin.clone(),
        });
        bridge.blocks[0].ops.push(ValueId(1));
        let mut program = Program {
            funcs: vec![bridge, internal("callback"), internal("convert")],
            layouts: vec![row("entries", &[(3, "callback"), (7, "convert")])],
            ..Program::default()
        };
        plan(&mut program);
        assert_eq!(program.native_column(3), None);
        assert_eq!(program.native_funcs().count(), 3);
    }
}
