//! Emission-owned native symbols, authenticated by lowering's producer carriers.

use nts_core::hir::native::{Family, Function, GObjectThunk, GType};
use nts_core::hir::{Callee, OpKind, Program};
use rustc_hash::FxHashMap;
use std::borrow::Cow;

/// One immutable program's generated native symbols. Authored/runtime symbols
/// never enter the table. Pointer keys refer to descriptors owned by `Program`,
/// which remains borrowed for the table's entire lifetime.
#[derive(Debug)]
pub struct NativeSymbols<'a> {
    functions: FxHashMap<*const Function, String>,
    gtypes: FxHashMap<&'a str, String>,
}

impl<'a> NativeSymbols<'a> {
    #[must_use]
    pub fn new(program: &'a Program) -> Self {
        let gtypes: FxHashMap<_, _> = program
            .foreign_classes
            .iter()
            .filter(|class| class.family == Family::GObject)
            .map(|class| {
                (
                    class.name.as_str(),
                    format!("__nts_gobject_type_{}", class.name),
                )
            })
            .collect();
        let mut functions = FxHashMap::default();
        let mut producers = FxHashMap::default();
        // Stable source order; hash iteration never determines a symbol.
        // Typed producer payloads share an entry. GLib property spelling uses
        // '-' canonically and accepts '_' as the same separator; preserve that
        // equivalence instead of emitting duplicate property helpers.
        for op in program.funcs.iter().flat_map(|func| &func.values) {
            let OpKind::Call {
                callee: Callee::Native(target),
                ..
            } = &op.kind
            else {
                continue;
            };
            if let Some(thunk) = &target.thunk {
                functions
                    .entry(std::ptr::from_ref(target.as_ref()))
                    .or_insert_with(|| {
                        let key = match thunk {
                            GObjectThunk::Property {
                                operation,
                                kind,
                                name,
                            } if name.contains('_') => Cow::Owned(GObjectThunk::Property {
                                operation: *operation,
                                kind: *kind,
                                name: name.replace('_', "-"),
                            }),
                            _ => Cow::Borrowed(thunk),
                        };
                        let ordinal = producers.len();
                        producers
                            .entry(key)
                            .or_insert_with_key(|key| match key.as_ref() {
                                GObjectThunk::Type { class } => gtypes
                                    .get(class.as_str())
                                    .expect("a generated GType belongs to a program class")
                                    .clone(),
                                _ => format!("__{}_{ordinal}", key.symbol()),
                            })
                            .clone()
                    });
            }
        }
        Self { functions, gtypes }
    }

    /// The exact source descriptor supplies ownership; its spelling does not.
    #[must_use]
    pub fn function<'b>(&'b self, target: &'b Function) -> &'b str {
        if target.thunk.is_none() {
            return &target.name;
        }
        self.functions
            .get(&std::ptr::from_ref(target))
            .expect("a source native producer is in the emission index")
    }

    #[must_use]
    pub fn class_gtype(&self, class: &str) -> Option<&str> {
        self.gtypes.get(class).map(String::as_str)
    }

    #[must_use]
    pub fn gtype<'b>(&'b self, gtype: &'b GType) -> Option<&'b str> {
        match gtype {
            GType::Declared(name) => Some(name),
            GType::ProgramClass(class) => self.class_gtype(class),
        }
    }
}
