//! Class components, described for the native build (runtime/react/
//! CLASS-COMPONENTS.md): nts has no class objects, so the reconciler cannot
//! construct a class from a value or read its statics through one. Each class
//! component gets a descriptor as its last member,
//!
//! ```ts
//! static readonly $$type = new _ClassComponentType("Counter", (props, context) => new Counter(...), 384, false, { ... });
//! ```
//!
//! which names the class wherever upstream read it through a value, and a JSX
//! tag that is a class lowers to `Counter.$$type` ([`Printer::jsx_tag`]).
//!
//! A class component is a class whose `extends` is `Component` or
//! `PureComponent` from `react`, or another class component in the same file.
//! One extending a class component from another file is not recognised: its
//! JSX then names a class with no `$$type`, which fails to typecheck rather
//! than running wrongly.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use react_compiler_ast::declarations::{ImportSpecifier, ModuleExportName};
use react_compiler_ast::expressions::Expression;
use react_compiler_ast::statements::{ClassDeclaration, Statement};
use react_compiler_ast::File;
use rustc_hash::{FxHashMap, FxHashSet};
use serde_json::Value;

/// The lifecycle methods whose presence the reconciler asks about, in the
/// order of their bits (shared/ReactClassComponentType.ts).
const LIFECYCLES: [&str; 13] = [
    "shouldComponentUpdate",
    "componentWillMount",
    "UNSAFE_componentWillMount",
    "componentWillReceiveProps",
    "UNSAFE_componentWillReceiveProps",
    "componentWillUpdate",
    "UNSAFE_componentWillUpdate",
    "componentDidMount",
    "componentDidUpdate",
    "componentWillUnmount",
    "getSnapshotBeforeUpdate",
    "componentDidCatch",
    "getChildContext",
];

/// The statics the descriptor carries, and how each is passed: the reconciler
/// holds props and state erased, so a typed static is adapted.
const STATICS: [&str; 5] = ["contextType", "getDerivedStateFromProps", "getDerivedStateFromError", "defaultProps", "displayName"];

/// A class component declared earlier in the file, for a class extending it.
#[derive(Debug, Clone)]
struct Known {
    pure: bool,
    statics: BTreeSet<String>,
    /// Whether its constructor takes the context: React passes it as the
    /// second argument, and a class declaring `constructor(props)` takes one.
    takes_context: bool,
    /// Whether it has a state type to merge `setState`'s partial state into.
    has_state: bool,
}

/// The class components of one file, found in order.
#[derive(Debug, Default)]
pub(super) struct ClassComponents {
    /// Local names of `Component` (false) and `PureComponent` (true) from `react`.
    bases: FxHashMap<String, bool>,
    /// Local names `react` is imported under as a whole: `React.Component`.
    namespaces: FxHashSet<String>,
    known: FxHashMap<String, Known>,
}

/// What a class extends.
enum Base {
    React { pure: bool },
    Class { name: String, known: Known },
}

impl ClassComponents {
    pub(super) fn new(original: &File) -> Self {
        let mut found = Self::default();
        for statement in &original.program.body {
            let Statement::ImportDeclaration(import) = statement else { continue };
            if import.source.value != "react" {
                continue;
            }
            for specifier in &import.specifiers {
                match specifier {
                    ImportSpecifier::ImportSpecifier(named) => {
                        if let ModuleExportName::Identifier(imported) = &named.imported
                            && let Some(pure) = react_base(&imported.name)
                        {
                            found.bases.insert(named.local.name.clone(), pure);
                        }
                    }
                    ImportSpecifier::ImportDefaultSpecifier(d) => {
                        found.namespaces.insert(d.local.name.clone());
                    }
                    ImportSpecifier::ImportNamespaceSpecifier(n) => {
                        found.namespaces.insert(n.local.name.clone());
                    }
                }
            }
        }
        found
    }

    fn base(&self, class: &ClassDeclaration) -> Option<Base> {
        match class.super_class.as_deref()? {
            Expression::Identifier(id) => {
                if let Some(&pure) = self.bases.get(&id.name) {
                    return Some(Base::React { pure });
                }
                self.known.get(&id.name).map(|known| Base::Class { name: id.name.clone(), known: known.clone() })
            }
            Expression::MemberExpression(member) if !member.computed => match (member.object.as_ref(), member.property.as_ref()) {
                (Expression::Identifier(object), Expression::Identifier(property)) if self.namespaces.contains(&object.name) => {
                    react_base(&property.name).map(|pure| Base::React { pure })
                }
                _ => None,
            },
            _ => None,
        }
    }

    /// The `$$type` member for `class`, when it is a class component; the
    /// runtime's class is imported as `runtime`.
    pub(super) fn describe(&mut self, class: &ClassDeclaration, runtime: &str) -> Option<String> {
        let name = class.id.as_ref()?.name.clone();
        let base = self.base(class)?;
        let members: Vec<Value> = class.body.body.iter().map(react_compiler_ast::common::RawNode::parse_value).collect();
        let member = |m: &Value, key: &str| m.get(key).and_then(Value::as_str).map(str::to_owned);
        let is_static = |m: &Value| m.get("static").and_then(Value::as_bool) == Some(true);

        let mut own = 0u32;
        let mut named = Vec::new();
        // The methods `invoke` calls, with how many parameters each declares.
        let mut calls: Vec<(u32, String, u64)> = Vec::new();
        let mut statics = BTreeSet::new();
        let mut constructor_parameters = None;
        let mut declares_state = false;
        for m in &members {
            let kind = member(m, "memberKind").unwrap_or_default();
            if kind == "constructor" {
                constructor_parameters = m.get("parameters").and_then(Value::as_u64);
                continue;
            }
            let Some(member_name) = member(m, "name") else { continue };
            if !is_static(m) && member_name == "state" {
                declares_state = true;
            }
            if is_static(m) {
                if STATICS.contains(&member_name.as_str()) {
                    statics.insert(member_name);
                }
                continue;
            }
            let function = kind == "method" || m.get("functionValued").and_then(Value::as_bool) == Some(true);
            let parameters = m.get("parameters").and_then(Value::as_u64).unwrap_or(0);
            if let Some(bit) = LIFECYCLES.iter().position(|l| *l == member_name)
                && function
            {
                own |= 1 << bit;
                calls.push((1 << bit, member_name.clone(), parameters));
                named.push(member_name);
            } else if member_name == "render" && function {
                calls.insert(0, (RENDER, member_name, parameters));
            }
        }

        let (pure, inherited_statics, inherited_context, inherited_state, lifecycles) = match &base {
            Base::React { pure } => (*pure, BTreeSet::new(), true, false, own.to_string()),
            Base::Class { name: parent, known } => {
                (known.pure, known.statics.clone(), known.takes_context, known.has_state, format!("{parent}.$$type.lifecycles | {own}"))
            }
        };
        statics.extend(inherited_statics);
        let takes_context = constructor_parameters.map_or(inherited_context, |n| n >= 2);
        // `Component<Props, State>` names a state type, as does a `state` member.
        let state_argument = class
            .super_type_parameters
            .as_ref()
            .and_then(|raw| raw.parse_value().get("params").and_then(Value::as_array).map(Vec::len))
            .is_some_and(|n| n >= 2);
        let has_state = state_argument || declares_state || inherited_state;
        self.known.insert(name.clone(), Known { pure, statics: statics.clone(), takes_context, has_state });
        let invoke = invoke_closure(&name, &calls, match &base {
            Base::React { .. } => None,
            Base::Class { name: parent, .. } => Some(parent.as_str()),
        });
        let merge = if has_state {
            format!("(prev, partial) => ({{ ...(prev as {name}[\"state\"]), ...(partial as Partial<{name}[\"state\"]>) }})")
        } else {
            "null".to_owned()
        };

        let props = format!("props as ConstructorParameters<typeof {name}>[0]");
        let create = if takes_context {
            format!("(props, context) => new {name}({props}, context)")
        } else {
            format!("(props) => new {name}({props})")
        };
        let mask_comment = if named.is_empty() { String::new() } else { format!("/* {} */ ", named.join(" | ")) };
        let statics_text: Vec<String> = statics.iter().map(|s| static_entry(&name, s)).collect();
        let statics_text = if statics_text.is_empty() { "{}".to_owned() } else { format!("{{ {} }}", statics_text.join(", ")) };
        Some(format!(
            "\n  // The descriptor the native build holds for this class (written by the React stage).\n  static readonly $$type = new {runtime}(\n    {},\n    {create},\n    {invoke},\n    {merge},\n    {mask_comment}{lifecycles},\n    {pure},\n    {statics_text},\n  );\n",
            quote_ascii(&name),
        ))
    }
}

/// What `invoke` is called with to render: shared/ReactClassComponentType.ts's `Render`.
const RENDER: u32 = 1 << 13;

/// The descriptor's `invoke`: each method `calls` names, called on the
/// instance as the class it is, with as many of the erased arguments as it
/// declares, each as the type it declares. What the class does not define
/// is its parent's to answer, for a class extending another class component.
fn invoke_closure(class: &str, calls: &[(u32, String, u64)], parent: Option<&str>) -> String {
    let mut out = format!("(instance, lifecycle, _a, _b, _c) => {{\n      const self = instance as {class};\n      switch (lifecycle) {{\n");
    for (bit, method, parameters) in calls {
        let arguments: Vec<String> = ["_a", "_b", "_c"]
            .iter()
            .take(usize::try_from(*parameters).unwrap_or(0).min(3))
            .enumerate()
            .map(|(index, argument)| format!("{argument} as Parameters<{class}[\"{method}\"]>[{index}]"))
            .collect();
        let _ = write!(out, "        case {bit}:\n          return self.{method}({});\n", arguments.join(", "));
    }
    out.push_str("      }\n");
    match parent {
        Some(parent) => {
            let _ = writeln!(out, "      return {parent}.$$type.invoke(instance, lifecycle, _a, _b, _c);");
        }
        None => out.push_str("      return undefined;\n"),
    }
    out.push_str("    }");
    out
}

/// `Component` is a component base, and `PureComponent` a pure one.
fn react_base(name: &str) -> Option<bool> {
    match name {
        "Component" => Some(false),
        "PureComponent" => Some(true),
        _ => None,
    }
}

/// One static, as the descriptor takes it: the class's own, adapted where
/// its parameters are typed.
fn static_entry(class: &str, name: &str) -> String {
    let parameter = |index: usize| format!("Parameters<typeof {class}.{name}>[{index}]");
    match name {
        "getDerivedStateFromProps" => format!(
            "{name}: (props, state) => {class}.{name}(props as {}, state as {})",
            parameter(0),
            parameter(1)
        ),
        "getDerivedStateFromError" => format!("{name}: (error) => {class}.{name}(error as {})", parameter(0)),
        _ => format!("{name}: {class}.{name}"),
    }
}

fn quote_ascii(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_owned())
}
