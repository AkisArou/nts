//! Permission to read a narrow field requires a write before publication.
//!
//! The checker permits definite-assignment assertions and constructor calls
//! that expose fields before their writes. Allocator zero is not JavaScript's
//! undefined. This proof licenses accessors only; it does not repair the
//! representation of an unproven field or bless an existing direct read.

use nts_semantic_schema::DeclarationModifiers as Modifiers;
use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    FuncBuilder, NodeId, PropertyRecord, SemanticSnapshot, TypeId, children_that_run,
    declares_a_class, instance_type_of, interfaces, is_static_member, parameters_of, syntax,
    the_constructor_declared_by,
};

#[derive(Debug, Default)]
pub(super) struct Ready {
    declarations: FxHashSet<NodeId>,
}

impl Ready {
    pub(super) fn collect(probe: &FuncBuilder<'_>) -> Self {
        let classes: FxHashMap<TypeId, NodeId> = probe
            .snapshot
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| matches!(node.kind, super::NodeKind::Syntax(kind) if declares_a_class(kind)))
            .filter_map(|(at, _)| {
                let node = NodeId(u32::try_from(at).ok()?);
                Some((instance_type_of(probe.snapshot, node)?, node))
            })
            .collect();
        let exposes: FxHashMap<_, _> = classes
            .values()
            .map(|class| (*class, class_exposes(probe, *class)))
            .collect();
        let mut ready = Self::default();
        for (&ty, &class) in &classes {
            if base_exposes(probe.snapshot, ty, &classes, &exposes) {
                continue;
            }
            ready.class(probe, class);
        }
        ready
    }

    pub(super) fn contains(&self, property: &PropertyRecord) -> bool {
        property
            .declaration
            .is_some_and(|declaration| self.declarations.contains(&declaration))
    }

    fn class(&mut self, probe: &FuncBuilder<'_>, class: NodeId) {
        let mut pending = FxHashMap::default();
        let mut exposed = false;
        for field in probe.children(class) {
            if probe.kind_of(field) != Some(syntax::PROPERTY_DECLARATION)
                || is_static_member(probe.snapshot, field)
            {
                continue;
            }
            let Some(name) = probe.member_name(field) else {
                continue;
            };
            // A property declaration has modifiers, name, ?/!, annotation, initializer.
            // A ! token is not an initializer, unlike a variable declaration's
            // last non-type child. Ask the encoded slots rather than guessing.
            let initializer = probe.child_slots::<5>(field).and_then(|slots| slots[4]);
            if let Some(initializer) = initializer {
                exposed |= exposes_receiver(probe, initializer);
                if !exposed {
                    self.declarations.insert(field);
                }
            } else {
                pending.insert(name, field);
            }
        }
        let Some(constructor) = the_constructor_declared_by(probe, class) else {
            return;
        };
        for parameter in parameters_of(probe, constructor) {
            let initializer = probe.default_of(parameter);
            exposed |= initializer.is_some_and(|at| contains_receiver(probe, at));
        }
        if !exposed {
            for parameter in parameters_of(probe, constructor) {
                if parameter_property(probe, parameter) {
                    self.declarations.insert(parameter);
                }
            }
        }
        let body = probe
            .children(constructor)
            .into_iter()
            .find(|at| probe.kind_of(*at) == Some(syntax::BLOCK));
        for statement in body.into_iter().flat_map(|at| probe.children(at)) {
            exposed |= exposes_receiver(probe, statement);
            if exposed {
                break;
            }
            if let Some(name) = unconditional_write(probe, statement)
                && let Some(field) = pending.remove(&name)
            {
                self.declarations.insert(field);
            }
        }
    }
}

fn parameter_property(probe: &FuncBuilder<'_>, at: NodeId) -> bool {
    let modifiers = probe.node(at).modifiers;
    [
        Modifiers::PUBLIC,
        Modifiers::PRIVATE,
        Modifiers::PROTECTED,
        Modifiers::READONLY,
    ]
    .iter()
    .any(|modifier| modifiers.contains(*modifier))
}

fn unconditional_write(probe: &FuncBuilder<'_>, statement: NodeId) -> Option<String> {
    if probe.kind_of(statement) != Some(syntax::EXPRESSION_STATEMENT) {
        return None;
    }
    let expression = *probe.children(statement).first()?;
    if probe.kind_of(expression) != Some(syntax::BINARY_EXPRESSION) {
        return None;
    }
    let children = probe.children(expression);
    let [left, operator, _] = children.as_slice() else {
        return None;
    };
    if probe.kind_of(*operator) != Some(syntax::EQUALS_TOKEN) {
        return None;
    }
    let (receiver, name) = probe.member_access(*left)?;
    (probe.kind_of(receiver) == Some(syntax::THIS_KEYWORD)).then_some(name)
}

fn base_exposes(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    classes: &FxHashMap<TypeId, NodeId>,
    exposes: &FxHashMap<NodeId, bool>,
) -> bool {
    let mut ty = ty;
    for _ in 0..64 {
        let Some(base) = snapshot.base_types.get(&ty).and_then(|bases| bases.first()) else {
            return false;
        };
        let Some(class) = classes.get(base) else {
            // An interface in base_types contributes no constructor. An
            // external class cannot vouch for initialization of derived fields.
            return snapshot
                .types
                .get(base.0 as usize)
                .and_then(|ty| ty.symbol)
                .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize))
                .is_none_or(|symbol| {
                    symbol
                        .flags
                        .contains(nts_semantic_schema::SymbolFlags::CLASS)
                });
        };
        if exposes.get(class).copied().unwrap_or(true) {
            return true;
        }
        ty = *base;
    }
    true
}

fn class_exposes(probe: &FuncBuilder<'_>, class: NodeId) -> bool {
    probe.children(class).into_iter().any(|member| {
        if probe.kind_of(member) == Some(syntax::CONSTRUCTOR) {
            return exposes_receiver(probe, probe.implementation_of(member));
        }
        probe.kind_of(member) == Some(syntax::PROPERTY_DECLARATION)
            && !is_static_member(probe.snapshot, member)
            && probe
                .child_slots::<5>(member)
                .and_then(|slots| slots[4])
                .is_some_and(|at| exposes_receiver(probe, at))
    })
}

fn contains_receiver(probe: &FuncBuilder<'_>, at: NodeId) -> bool {
    let mut nodes = Vec::new();
    probe.subtree(at, &mut nodes);
    nodes
        .into_iter()
        .any(|node| probe.kind_of(node) == Some(syntax::THIS_KEYWORD))
}

fn exposes_receiver(probe: &FuncBuilder<'_>, root: NodeId) -> bool {
    let mut pending = vec![root];
    while let Some(at) = pending.pop() {
        if matches!(
            probe.kind_of(at),
            Some(
                syntax::ARROW_FUNCTION
                    | syntax::FUNCTION_EXPRESSION
                    | syntax::FUNCTION_DECLARATION
                    | syntax::CLASS_DECLARATION
                    | syntax::CLASS_EXPRESSION
            )
        ) {
            continue;
        }
        if exposes_at(probe, at) {
            return true;
        }
        pending.extend(children_that_run(probe, at));
    }
    false
}

fn exposes_at(probe: &FuncBuilder<'_>, at: NodeId) -> bool {
    if matches!(
        probe.kind_of(at),
        Some(
            syntax::CALL_EXPRESSION
                | syntax::NEW_EXPRESSION
                | syntax::RETURN_STATEMENT
                | syntax::VARIABLE_DECLARATION
        )
    ) {
        return contains_receiver(probe, at);
    }
    if let Some((object, name)) = probe.member_access(at)
        && probe.kind_of(object) == Some(syntax::THIS_KEYWORD)
        && let Some(ty) = probe.snapshot.node_types.get(&object)
        && interfaces::property(probe.snapshot, *ty, &name).is_some_and(|property| {
            matches!(property.kind, nts_semantic_schema::MemberKind::Accessor(_))
        })
    {
        return true;
    }
    if probe.kind_of(at) == Some(syntax::BINARY_EXPRESSION)
        && let [left, operator, right] = probe.children(at).as_slice()
        && probe.kind_of(*operator) == Some(syntax::EQUALS_TOKEN)
        && contains_receiver(probe, *right)
    {
        return probe
            .member_access(*left)
            .is_none_or(|(object, _)| probe.kind_of(object) != Some(syntax::THIS_KEYWORD));
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_frontend_ts::{SemanticSource, TsgoApi};

    #[test]
    fn only_a_write_before_publication_licenses_the_field() {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
            eprintln!("SKIP field initialization: tsgo is not built");
            return;
        };
        let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/programs/accessor-initialization/tsconfig.json");
        let snapshot = TsgoApi::for_compilation(tsgo)
            .snapshot(&config)
            .unwrap_or_else(|error| panic!("snapshot failed: {error:?}"));
        let probe = FuncBuilder::probe(&snapshot);
        let ready = Ready::collect(&probe);
        for (class, expected) in [
            ("Initializer", true),
            ("Constructor", true),
            ("Parameter", true),
            ("Missing", false),
            ("EarlyCall", false),
            ("LateCall", true),
            ("Alias", false),
            ("Closure", true),
            ("EarlyClosure", false),
            ("Derived", false),
            ("QuietDerived", true),
        ] {
            let ty = snapshot
                .types
                .iter()
                .enumerate()
                .find_map(|(at, ty)| {
                    let symbol = ty.symbol?;
                    (snapshot.symbols[symbol.0 as usize].name == class
                        && matches!(ty.kind, nts_semantic_schema::TypeKind::Object { .. }))
                    .then(|| TypeId(u32::try_from(at).unwrap_or(u32::MAX)))
                })
                .unwrap_or_else(|| panic!("instance type missing: {class}"));
            let field = interfaces::property(&snapshot, ty, "value")
                .unwrap_or_else(|| panic!("field missing: {class}.value"));
            assert_eq!(ready.contains(field), expected, "{class}.value");
        }
    }
}
