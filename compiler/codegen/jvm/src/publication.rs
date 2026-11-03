//! One reservation per binary identity, before any class is serialized.
use super::{
    JvmProgram, callable_root, constructed_interfaces, hierarchy, identity_class,
    interface_instance, lambda_adapter, object_class, program_class, program_origin,
    shadowed_layout, split_faces, types, uniform_entries, view_subclass, widen,
};
use nts_core::hir::{ClassIdentity, Layout, ViewClass};
use nts_diagnostics::Diagnostic;
use nts_jvm_emitter::Class;
use nts_semantic_schema::TypeId;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
enum ViewDeclaration {
    Named(u32),
    Anonymous(TypeId),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Owner {
    Program,
    Layout(usize),
    Face(usize),
    Identity {
        layout: usize,
        declaration: u32,
    },
    View {
        declaration: ViewDeclaration,
        element: Option<String>,
        base: Option<String>,
    },
    Callable,
    InterfaceInstance(usize),
    Lambda {
        base: String,
        interface: &'static str,
        call: String,
    },
}

enum Factory<'a> {
    Program,
    Layout(&'a Layout),
    Face(&'a Layout),
    Identity(&'a Layout, &'a ClassIdentity),
    View(&'a ViewClass),
    Callable(Vec<(String, String)>),
    InterfaceInstance(&'a Layout),
    Lambda {
        base: String,
        interface: &'static str,
        call: String,
    },
}

struct Request<'a> {
    name: String,
    owner: Owner,
    factory: Factory<'a>,
}

pub(super) struct Plan<'a, 'p> {
    package: &'a str,
    program: &'a JvmProgram<'p>,
    by_name: FxHashMap<String, usize>,
    requests: Vec<Request<'a>>,
    conflicts: Vec<Diagnostic>,
}

impl<'a, 'p> Plan<'a, 'p> {
    pub(super) fn new(package: &'a str, program: &'a JvmProgram<'p>) -> Self {
        let mut plan = Self {
            package,
            program,
            by_name: FxHashMap::default(),
            requests: Vec::new(),
            conflicts: Vec::new(),
        };
        plan.reserve(program_class(package), Owner::Program, Factory::Program);
        for (index, layout) in program.layouts.iter().enumerate() {
            if nts_core::hir::runtime::is_foreign_layout_name(&layout.name)
                || shadowed_layout(program, layout)
            {
                continue;
            }
            plan.reserve(
                types::class_name(package, layout),
                Owner::Layout(index),
                Factory::Layout(layout),
            );
            if program.is_split(layout) {
                plan.reserve(
                    split_faces::interface_name(package, layout),
                    Owner::Face(index),
                    Factory::Face(layout),
                );
            }
            for class in hierarchy::identities(program, layout) {
                plan.reserve(
                    types::identity_class_name(package, layout, class),
                    Owner::Identity {
                        layout: index,
                        declaration: class.symbol,
                    },
                    Factory::Identity(layout, class),
                );
            }
        }
        for view in &program.view_classes {
            let declaration = view
                .source
                .as_ref()
                .map_or(ViewDeclaration::Anonymous(view.class), |source| {
                    ViewDeclaration::Named(source.symbol)
                });
            plan.reserve(
                types::view_class_name(package, view),
                Owner::View {
                    declaration,
                    element: types::view_class(&view.element).map(str::to_owned),
                    base: types::view_parent_class(package, program, view),
                },
                Factory::View(view),
            );
        }
        let entries = uniform_entries(package, program);
        if !entries.is_empty()
            || program
                .layouts
                .iter()
                .any(|layout| types::is_callable_storage(program, layout))
        {
            plan.reserve(
                types::callable_class(package),
                Owner::Callable,
                Factory::Callable(entries),
            );
        }
        for (index, layout) in constructed_interfaces(program) {
            plan.reserve(
                types::instance_class(package, program, layout),
                Owner::InterfaceInstance(index),
                Factory::InterfaceInstance(layout),
            );
        }
        plan
    }

    fn reserve(&mut self, name: String, owner: Owner, factory: Factory<'a>) {
        if let Some(index) = self.by_name.get(&name) {
            let previous = &self.requests[*index].owner;
            if previous != &owner {
                self.conflicts.push(Diagnostic::error("NTS4004", format!(
                    "JVM class identity `{name}` has different publication owners: {previous:?} and {owner:?}"
                ), program_origin(self.program).location));
            }
            return;
        }
        self.by_name.insert(name.clone(), self.requests.len());
        self.requests.push(Request {
            name,
            owner,
            factory,
        });
    }

    pub(super) fn lambda(&mut self, base: String, interface: &'static str, call: String) {
        self.reserve(
            format!("{base}$Lambda"),
            Owner::Lambda {
                base: base.clone(),
                interface,
                call: call.clone(),
            },
            Factory::Lambda {
                base,
                interface,
                call,
            },
        );
    }

    pub(super) fn materialize(
        self,
        widening: &widen::Plan,
        handed_to: &FxHashMap<TypeId, Vec<String>>,
        reactions: &FxHashSet<TypeId>,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Result<Output, Vec<Diagnostic>> {
        if !self.conflicts.is_empty() {
            return Err(self.conflicts);
        }
        let mut classes = Vec::new();
        let origin = program_origin(self.program);
        for request in self.requests {
            #[cfg(test)]
            if !matches!(request.factory, Factory::Program) {
                tests::note_build();
            }
            let result = match request.factory {
                Factory::Program => continue,
                Factory::Layout(layout) => object_class(
                    self.package,
                    self.program,
                    layout,
                    widening,
                    handed_to,
                    reactions,
                ),
                Factory::Face(layout) => split_faces::interface_class(
                    self.program,
                    self.package,
                    widening,
                    layout,
                    &origin,
                )
                .map(Some),
                Factory::Identity(layout, class) => {
                    identity_class(self.package, self.program, layout, class).map(Some)
                }
                Factory::View(view) => view_subclass(self.package, self.program, view).map(Some),
                Factory::Callable(entries) => {
                    callable_root(self.package, self.program, entries).map(Some)
                }
                Factory::InterfaceInstance(layout) => {
                    interface_instance(self.package, self.program, layout).map(Some)
                }
                Factory::Lambda {
                    base,
                    interface,
                    call,
                } => lambda_adapter(self.package, self.program, &base, interface, &call, &origin)
                    .map(Some),
            };
            match result {
                Ok(Some(class)) => {
                    if class.binary_name != request.name {
                        return Err(vec![Diagnostic::error(
                            "NTS4004",
                            format!(
                                "JVM publisher for `{}` produced `{}`",
                                request.name, class.binary_name
                            ),
                            origin.location,
                        )]);
                    }
                    classes.push(class);
                }
                Ok(None) => {}
                Err(diagnostic) => diagnostics.push(diagnostic),
            }
        }
        Ok(Output {
            classes,
            program: program_class(self.package),
        })
    }
}

pub(super) struct Output {
    classes: Vec<Class>,
    program: String,
}

impl Output {
    pub(super) fn classes(&self) -> &[Class] {
        &self.classes
    }

    pub(super) fn finish(mut self, class: Class) -> Vec<Class> {
        assert_eq!(
            class.binary_name, self.program,
            "the reserved program identity"
        );
        self.classes.push(class);
        self.classes
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::Plan;
    use crate::{DEFAULT_PACKAGE, JvmProgram, view_subclass, widen};
    use nts_core::hir::{HirType, NamedClassSource, Program, ViewClass};
    use nts_semantic_schema::TypeId;
    use rustc_hash::{FxHashMap, FxHashSet};
    use std::cell::Cell;

    thread_local! { static BUILDS: Cell<usize> = const { Cell::new(0) }; }
    pub(super) fn note_build() {
        BUILDS.with(|count| count.set(count.get() + 1));
    }

    fn views() -> Program {
        Program {
            view_classes: [1, 2]
                .into_iter()
                .map(|class| ViewClass {
                    class: TypeId(class),
                    name: "Buffer".to_owned(),
                    source: Some(NamedClassSource {
                        symbol: 7,
                        module: "nts-workspace:///buffer/main.ts".to_owned(),
                        scopes: vec!["Buffer".to_owned()],
                    }),
                    element: HirType::Int {
                        bits: 8,
                        signed: false,
                    },
                    base: None,
                    species: None,
                })
                .collect::<Vec<_>>()
                .into(),
            ..Program::default()
        }
    }

    #[test]
    fn one_declaration_and_physical_instantiation_build_once() {
        let source = views();
        let program = JvmProgram::new(&source);
        let classes: Vec<_> = program
            .view_classes
            .iter()
            .map(|view| view_subclass(DEFAULT_PACKAGE, &program, view).unwrap())
            .collect();
        assert_eq!(classes.len(), 2, "the control really builds both requests");
        assert_eq!(classes[0].binary_name, classes[1].binary_name);
        assert_eq!(
            classes[0].bytes, classes[1].bytes,
            "same declaration/physical facts independently produce the same class"
        );
        BUILDS.with(|count| count.set(0));
        let mut diagnostics = Vec::new();
        let published = Plan::new(DEFAULT_PACKAGE, &program)
            .materialize(
                &widen::Plan::empty(),
                &FxHashMap::default(),
                &FxHashSet::default(),
                &mut diagnostics,
            )
            .unwrap();
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert_eq!(published.classes().len(), 1);
        assert_eq!(
            BUILDS.with(Cell::get),
            1,
            "the second request must not serialize another class"
        );
        assert_eq!(published.classes()[0].bytes, classes[0].bytes);
    }

    #[test]
    fn different_declarations_conflict_before_building_even_if_bytes_match() {
        let mut source = views();
        source.view_classes[1].source.as_mut().unwrap().symbol = 8;
        let program = JvmProgram::new(&source);
        BUILDS.with(|count| count.set(0));
        let mut diagnostics = Vec::new();
        let conflicts = Plan::new(DEFAULT_PACKAGE, &program)
            .materialize(
                &widen::Plan::empty(),
                &FxHashMap::default(),
                &FxHashSet::default(),
                &mut diagnostics,
            )
            .err()
            .expect("two semantic declarations cannot own one name");
        assert_eq!(
            BUILDS.with(Cell::get),
            0,
            "no factory runs after a reservation conflict"
        );
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].code, "NTS4004");
        assert!(
            conflicts[0].message.contains("Buffer")
                && conflicts[0]
                    .message
                    .contains("different publication owners")
        );
    }

    #[test]
    fn distinct_physical_view_instantiations_keep_distinct_classes() {
        let mut source = views();
        source.view_classes[1].element = HirType::Int {
            bits: 16,
            signed: false,
        };
        let program = JvmProgram::new(&source);
        BUILDS.with(|count| count.set(0));
        let mut diagnostics = Vec::new();
        let published = Plan::new(DEFAULT_PACKAGE, &program)
            .materialize(
                &widen::Plan::empty(),
                &FxHashMap::default(),
                &FxHashSet::default(),
                &mut diagnostics,
            )
            .unwrap();
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        assert_eq!(published.classes().len(), 2);
        assert_eq!(BUILDS.with(Cell::get), 2);
        assert_ne!(
            published.classes()[0].binary_name,
            published.classes()[1].binary_name
        );
    }
}
