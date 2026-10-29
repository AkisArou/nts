//! Project native tables onto their readers without changing logical dispatch.
//!
//! Every surviving selector keeps a distinct column. For every layout, its
//! body or null keeps the logical table's behavior. Only unused-receiver
//! constant getters may share a native body; complete identical rows share
//! storage. In particular an
//! erased or structural receiver missing a method cannot acquire another body.
//! Co-filled selector sharing needs a stronger receiver proof and is deferred.

use std::collections::{BTreeMap, BTreeSet};

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Callee, Func, HirType, Layout, ManagedType, OpKind, Program};

mod default_getters;

/// One whole-program mapping, consumed by both native backends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeDispatch {
    /// Logical selector to native column; `None` means no native reader.
    pub columns: Vec<Option<u32>>,
    /// The width every nonempty native row has.
    pub width: u32,
    /// Bodies whose only references were in omitted table columns.
    omitted_bodies: FxHashSet<String>,
    /// Only proven table-only constant getters may change their native target.
    aliases: BTreeMap<String, String>,
    /// Full rows are interned, including every absent entry.
    rows: Vec<Vec<Option<String>>>,
    layout_rows: BTreeMap<String, Option<usize>>,
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

    pub(super) fn validate_rows(&self, program: &Program) -> Result<(), String> {
        let aliases = default_getters::aliases(program, &self.columns);
        if aliases != self.aliases {
            return Err("native body aliases lack their prepared constant-getter proof".to_owned());
        }
        let (rows, layouts) = intern_rows(program, &self.columns, self.width, &aliases)?;
        if rows != self.rows || layouts != self.layout_rows {
            return Err("native rows differ from their complete logical projection".to_owned());
        }
        Ok(())
    }
}

impl Program {
    /// Every function a dispatch can call without naming it: each layout's
    /// table rows, and the default an interface field's selector calls on a
    /// class with no row (`interface_access::Plan::default_for`).
    ///
    /// One answer for every pass that has to keep such a function's
    /// convention fixed. Five of them derived it from the rows alone, and a
    /// default reached through no row had its return narrowed to `i32` under a
    /// selector declared `f64`.
    pub fn dispatch_targets(&self) -> impl Iterator<Item = &str> {
        self.layouts
            .iter()
            .flat_map(|layout| layout.methods.iter().flatten().map(String::as_str))
            .chain(self.interface_access.defaults().map(|(_, body)| body))
    }

    /// Native code, without bodies made unreferenced by table projection.
    /// Logical declarations remain available for signatures and JVM emission.
    /// If a body is wrongly omitted, a surviving reference fails compilation
    /// or linking as an undefined symbol; it cannot silently call another body.
    pub fn native_funcs(&self) -> impl Iterator<Item = &Func> {
        self.funcs.iter().filter(|func| {
            self.native_dispatch.as_ref().is_none_or(|table| {
                !table.omitted_bodies.contains(&func.name)
                    && !table.aliases.contains_key(&func.name)
            })
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
    pub fn native_methods<'a>(
        &'a self,
        layout: &'a Layout,
    ) -> Result<Vec<Option<&'a str>>, String> {
        let Some(table) = &self.native_dispatch else {
            return Ok(layout.methods.iter().map(Option::as_deref).collect());
        };
        let Some(index) = self.native_table_index(layout)? else {
            return Ok(Vec::new());
        };
        table
            .rows
            .get(index)
            .map(|row| row.iter().map(Option::as_deref).collect())
            .ok_or_else(|| format!("native row {index} is absent"))
    }

    /// One stable row identity for both native emitters. Raw HIR keeps its
    /// per-layout tables; a prepared empty row needs no table at all.
    pub fn native_table_index(&self, layout: &Layout) -> Result<Option<usize>, String> {
        let Some(table) = &self.native_dispatch else {
            return Ok(None);
        };
        table
            .layout_rows
            .get(&layout.name)
            .copied()
            .ok_or_else(|| format!("layout `{}` has no native row", layout.name))
    }
}

type Rows = Vec<Vec<Option<String>>>;
type LayoutRows = BTreeMap<String, Option<usize>>;

fn intern_rows(
    program: &Program,
    columns: &[Option<u32>],
    width: u32,
    aliases: &BTreeMap<String, String>,
) -> Result<(Rows, LayoutRows), String> {
    if width as usize > columns.len() {
        return Err("native dispatch width exceeds its selector map".to_owned());
    }
    let mut projected = BTreeMap::new();
    let mut distinct = BTreeSet::new();
    for layout in &program.layouts {
        let mut row = vec![None; width as usize];
        for (selector, body) in layout.methods.iter().enumerate() {
            let Some(Some(column)) = columns.get(selector) else {
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
            *entry = body
                .as_ref()
                .map(|name| aliases.get(name).unwrap_or(name).clone());
        }
        if row.iter().any(Option::is_some) {
            distinct.insert(row.clone());
        }
        projected.insert(layout.name.clone(), row);
    }
    let indexes: BTreeMap<_, _> = distinct
        .into_iter()
        .enumerate()
        .map(|(index, row)| (row, index))
        .collect();
    let layouts = projected
        .into_iter()
        .map(|(name, row)| {
            let index = indexes.get(&row).copied();
            (name, index)
        })
        .collect();
    let rows = indexes.into_keys().collect();
    Ok((rows, layouts))
}

/// After every pass that shapes functions or layouts. Sorting the readers
/// makes the plan independent of function, layout and hash iteration order.
///
/// Public because the rows are a projection of the layouts, interned by
/// function name: whatever rewrites the layouts' rows after preparation must
/// project them again, or `verify` rightly reports the stale copy.
pub fn plan(program: &mut Program) {
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
    let aliases = default_getters::aliases(program, &columns);
    let mut table = NativeDispatch {
        columns,
        width: u32::try_from(readers.len()).unwrap_or(u32::MAX),
        omitted_bodies: FxHashSet::default(),
        aliases,
        rows: Vec::new(),
        layout_rows: BTreeMap::new(),
    };
    if let Ok((rows, layouts)) = intern_rows(program, &table.columns, table.width, &table.aliases) {
        table.rows = rows;
        table.layout_rows = layouts;
    }
    table.omitted_bodies = omitted_bodies(program, &table);
    program.native_dispatch = Some(table);
}

/// A conservative emission view, not another whole-program DCE. Only unread
/// table bodies and their callees can be omitted; unrelated functions stay.
/// Projected rows, public/foreign entries and printing keep their bodies, and
/// a walk keeps direct callees and targets codegen names inside native bridges.
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
    // A selector's default is called only by a dispatch through that
    // selector. Where no surviving call reads it, the default is as
    // unreferenced as an omitted column's rows, and C rejects an unused
    // static (`benchmarks/cases/in-narrowing`, -Werror,-Wunused-function).
    //
    // **One body can serve two selectors** -- a getter's and its raising
    // twin's -- so it is unreferenced only when *none* of them is read.
    // Asked per selector, an unread raising twin dropped `aborted`'s default
    // while the ordinary selector still called it, and five runtime modules
    // named an undeclared function.
    let read = |selector: u32| {
        table
            .columns
            .get(selector as usize)
            .is_some_and(Option::is_some)
    };
    let mut serves: FxHashMap<&str, bool> = FxHashMap::default();
    for (selector, body) in program.interface_access.defaults() {
        *serves.entry(body).or_default() |= read(selector);
    }
    candidates.extend(
        serves
            .into_iter()
            .filter(|(_, read)| !read)
            .map(|(body, _)| body),
    );
    let by_name: FxHashMap<&str, &Func> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), func))
        .collect();
    let layouts = super::fields::LayoutIndex::build(program);
    // A removed uniform entry can be the only caller of a non-table helper,
    // such as the written closure's raising body. Include those descendants
    // before rooting the unrelated code; any real use below keeps them back.
    let candidates = follow_calls(
        program,
        &by_name,
        &layouts,
        candidates.into_iter().collect(),
    );
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
    pending.extend(program.printing_functions());
    let kept = follow_calls(program, &by_name, &layouts, pending);
    candidates
        .difference(&kept)
        .map(|name| (*name).to_owned())
        .collect()
}

fn follow_calls<'p>(
    program: &'p Program,
    by_name: &FxHashMap<&str, &'p Func>,
    layouts: &super::fields::LayoutIndex,
    mut pending: Vec<&'p str>,
) -> FxHashSet<&'p str> {
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
    kept
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, Func, Op, Printed, Terminator, ValueId};
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
            exact: rustc_hash::FxHashMap::default(),
            written_return: None,
            result_absent: crate::hir::Absent::Impossible,
            validation: None,
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
        assert_eq!(
            crate::hir::verify::operands(&func.values[0].kind),
            [] as [ValueId; 0]
        );
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

    fn default_getter(name: &str, owner: u32) -> Func {
        let mut func = internal(name);
        func.return_type = HirType::Erased;
        func.values[0].kind = OpKind::ConstUndefined;
        func.values[0].ty = HirType::Erased;
        func.params.push(super::super::Param {
            name: "this".to_owned(),
            ty: HirType::Managed(ManagedType::Object(TypeId(owner))),
            origin: func.origin.clone(),
            shape: super::super::ParamShape::Ordinary,
            known: super::super::facts::Facts::TOP,
            written: None,
        });
        func
    }

    fn default_program() -> Program {
        let mut second = row("two", &[(3, "defaultB"), (7, "other")]);
        second.types = vec![TypeId(2)];
        let mut program = Program {
            funcs: vec![
                function("reader", &[3, 7]),
                default_getter("defaultA", 1),
                default_getter("defaultB", 2),
                internal("other"),
            ],
            layouts: vec![
                row("one", &[(3, "defaultA"), (7, "other")]),
                second,
                row("missing", &[(7, "other")]),
            ],
            ..Program::default()
        };
        program.layouts[2].types = vec![TypeId(3)];
        program.interface_access.default_bodies = [
            ("defaultA".to_owned(), false),
            ("defaultB".to_owned(), false),
        ]
        .into();
        program
    }

    #[test]
    fn proven_default_getters_and_only_complete_identical_rows_share() {
        let mut program = default_program();
        let logical = program
            .layouts
            .iter()
            .map(|layout| layout.methods.clone())
            .collect::<Vec<_>>();
        plan(&mut program);
        let table = program.native_dispatch.as_ref().expect("plan");
        assert_eq!(
            table.aliases,
            [("defaultB".to_owned(), "defaultA".to_owned())].into()
        );
        assert_eq!(
            program
                .native_table_index(&program.layouts[0])
                .expect("row"),
            program
                .native_table_index(&program.layouts[1])
                .expect("row")
        );
        assert_ne!(
            program
                .native_table_index(&program.layouts[0])
                .expect("row"),
            program
                .native_table_index(&program.layouts[2])
                .expect("row")
        );
        let missing = program.native_methods(&program.layouts[2]).expect("row");
        assert_eq!(
            missing[program.native_column(3).expect("column") as usize],
            None
        );
        assert!(program.native_funcs().any(|func| func.name == "defaultA"));
        assert!(!program.native_funcs().any(|func| func.name == "defaultB"));
        assert_eq!(program.funcs.len(), 4, "JVM keeps all functions");
        for (layout, before) in program.layouts.iter().zip(logical) {
            assert_eq!(layout.methods, before);
        }
        assert!(super::super::verify::verify(&program).is_ok());
        let before = program.native_dispatch.clone();
        program.layouts.reverse();
        program.funcs.reverse();
        plan(&mut program);
        assert_eq!(program.native_dispatch, before, "row IDs are deterministic");
    }

    #[test]
    fn default_sharing_needs_the_role_body_proof_and_no_direct_or_public_entry() {
        for boundary in ["role", "read", "call", "public", "raising", "result"] {
            let mut program = default_program();
            match boundary {
                "role" => {
                    program.interface_access.default_bodies.remove("defaultB");
                }
                "read" => {
                    program.funcs[2].values[0].kind = OpKind::FieldGet {
                        object: ValueId(0),
                        field: 0,
                    };
                }
                "call" => {
                    call(&mut program.funcs[0], "defaultB");
                }
                "public" => {
                    program
                        .public_api
                        .push(("defaultB".to_owned(), "getter".to_owned()));
                }
                "raising" => {
                    program
                        .interface_access
                        .default_bodies
                        .insert("defaultB".to_owned(), true);
                }
                "result" => {
                    program.funcs[2].return_type = HirType::NUMBER;
                }
                _ => unreachable!(),
            }
            plan(&mut program);
            assert!(
                program
                    .native_dispatch
                    .as_ref()
                    .expect("plan")
                    .aliases
                    .is_empty(),
                "{boundary}"
            );
            assert!(
                program.native_funcs().any(|func| func.name == "defaultB"),
                "{boundary}"
            );
        }
    }

    #[test]
    fn verifier_rechecks_native_alias_permissions_and_every_null_entry() {
        for sabotage in ["effect", "direct", "role", "null", "target"] {
            let mut program = default_program();
            plan(&mut program);
            match sabotage {
                "effect" => {
                    program.funcs[2].values[0].kind = OpKind::Call {
                        callee: Callee::External("nts_refused".to_owned()),
                        args: Vec::new(),
                        frame: None,
                    };
                }
                "direct" => {
                    call(&mut program.funcs[0], "defaultB");
                }
                "role" => {
                    program.interface_access.default_bodies.clear();
                }
                "null" => {
                    let column = program.native_column(3).expect("column") as usize;
                    let row = program
                        .native_table_index(&program.layouts[2])
                        .expect("row")
                        .expect("index");
                    program.native_dispatch.as_mut().expect("plan").rows[row][column] =
                        Some("defaultA".to_owned());
                }
                "target" => {
                    program
                        .native_dispatch
                        .as_mut()
                        .expect("plan")
                        .aliases
                        .insert("defaultB".to_owned(), "other".to_owned());
                }
                _ => unreachable!(),
            }
            let errors = super::super::verify::verify(&program).expect_err("bad native plan");
            assert!(
                errors.iter().any(|error| matches!(
                    error,
                    super::super::verify::Invalid::InvalidNativeDispatch { .. }
                )),
                "{sabotage}: {errors:?}"
            );
        }
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
            // The second body is not a table entry: it is reached only from
            // the discarded entry, like a closure's written raising body.
            layouts: vec![row("entries", &[(3, "first")])],
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
