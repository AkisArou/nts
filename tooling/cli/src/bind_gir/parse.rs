//! GIR XML into [`super::model`]. Reads what is there and decides nothing.

use anyhow::{Context, Result, anyhow, bail};
use camino::{Utf8Path, Utf8PathBuf};
use roxmltree::Node;

use super::model::{
    ArrayRef, Callable, CallableKind, Callback, Class, Direction, Enum, Member, Namespace, Param, Property,
    Record, Repository, Scope, Signal, Signature, Transfer, TypeRef,
};

const CORE: &str = "http://www.gtk.org/introspection/core/1.0";
const C: &str = "http://www.gtk.org/introspection/c/1.0";
const GLIB: &str = "http://www.gtk.org/introspection/glib/1.0";

/// Load `name-version` and every namespace it includes, transitively, from
/// the first directory in `search` that has each file.
pub(crate) fn repository(root: &str, search: &[Utf8PathBuf]) -> Result<Repository> {
    let mut repository = Repository::default();
    let root = split(root)?;
    let mut pending = vec![root.clone()];
    while let Some((name, version)) = pending.pop() {
        if repository.namespaces.contains_key(&name) || repository.missing.contains(&name) {
            continue;
        }
        let file = format!("{name}-{version}.gir");
        let Some(path) = search.iter().map(|dir| dir.join(&file)).find(|path| path.exists()) else {
            // The namespace asked for must exist. One it merely includes may
            // not -- `cairo-1.0.gir` ships separately on some systems -- and
            // then the functions naming its types are refused as unknown,
            // which is a count in the report rather than no binding at all.
            if name == root.0 {
                bail!(
                    "no `{file}` in {}; install the package that ships it, or pass `--gir-dir`",
                    search.iter().map(|dir| dir.as_str()).collect::<Vec<_>>().join(", ")
                );
            }
            repository.missing.insert(name);
            continue;
        };
        let namespace = namespace(&path)?;
        repository.files.push(path);
        pending.extend(namespace.includes.iter().cloned());
        repository.namespaces.insert(name, namespace);
    }
    Ok(repository)
}

fn split(spec: &str) -> Result<(String, String)> {
    spec.split_once('-')
        .map(|(name, version)| (name.to_owned(), version.to_owned()))
        .ok_or_else(|| anyhow!("`{spec}` is not `Name-Version`, as in `Gtk-4.0`"))
}

fn namespace(path: &Utf8Path) -> Result<Namespace> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
    let document =
        roxmltree::Document::parse(&text).with_context(|| format!("parsing {path} as XML"))?;
    let repository = document.root_element();
    let element = child(repository, "namespace")
        .ok_or_else(|| anyhow!("{path} has no <namespace>"))?;
    let mut namespace = Namespace {
        name: attribute(element, "name").unwrap_or_default().to_owned(),
        version: attribute(element, "version").unwrap_or_default().to_owned(),
        symbol_prefix: c_attribute(element, "symbol-prefixes")
            .and_then(|prefixes| prefixes.split(',').next())
            .unwrap_or_default()
            .to_owned(),
        ..Namespace::default()
    };
    for node in repository.children().filter(Node::is_element) {
        match (node.tag_name().namespace(), node.tag_name().name()) {
            (Some(CORE), "include") => namespace.includes.push((
                attribute(node, "name").unwrap_or_default().to_owned(),
                attribute(node, "version").unwrap_or_default().to_owned(),
            )),
            (Some(CORE), "package") => {
                namespace.packages.extend(attribute(node, "name").map(str::to_owned));
            }
            (Some(C), "include") => {
                namespace.headers.extend(attribute(node, "name").map(str::to_owned));
            }
            _ => {}
        }
    }
    for node in element.children().filter(Node::is_element) {
        if node.tag_name().namespace() != Some(CORE) {
            continue;
        }
        match node.tag_name().name() {
            kind @ ("class" | "interface") => namespace.classes.push(Class {
                name: attribute(node, "name").unwrap_or_default().to_owned(),
                c_type: class_c_type(node),
                // An interface has no parent, and its first prerequisite is what
                // every instance of it also is -- `GObject` for `GFile` -- so it
                // is the parent a handle upcasts to.
                parent: attribute(node, "parent")
                    .or_else(|| node.children().find(|n| is(*n, "prerequisite")).and_then(|n| attribute(n, "name")))
                    .map(str::to_owned),
                interface: kind == "interface",
                is_abstract: attribute(node, "abstract") == Some("1"),
                implements: node
                    .children()
                    .filter(|n| is(*n, "implements"))
                    .filter_map(|n| attribute(n, "name"))
                    .map(str::to_owned)
                    .collect(),
                symbol_prefix: c_attribute(node, "symbol-prefix").map(str::to_owned),
                signals: signals(node),
                properties: properties(node),
                get_type: node.attribute((GLIB, "get-type")).map(str::to_owned),
                first_field: node.children().find(|n| is(*n, "field")).and_then(|field| {
                    let ty = child(field, "type")?;
                    Some(TypeRef::Named {
                        name: attribute(ty, "name").unwrap_or_default().to_owned(),
                        c_type: c_attribute(ty, "type").map(str::to_owned),
                    })
                }),
                callables: callables(node),
                type_struct: node.attribute((GLIB, "type-struct")).map(str::to_owned),
                vfuncs: vfuncs(node),
            }),
            "record" => namespace.records.push(Record {
                name: attribute(node, "name").unwrap_or_default().to_owned(),
                c_type: c_attribute(node, "type").map(str::to_owned),
                class_struct: node.attribute((GLIB, "is-gtype-struct-for")).is_some(),
                callables: callables(node),
                get_type: node.attribute((GLIB, "get-type")).map(str::to_owned),
            }),
            kind @ ("enumeration" | "bitfield") => namespace.enums.push(Enum {
                name: attribute(node, "name").unwrap_or_default().to_owned(),
                c_type: c_attribute(node, "type").map(str::to_owned),
                flags: kind == "bitfield",
                members: node
                    .children()
                    .filter(|n| is(*n, "member"))
                    .filter_map(|member| {
                        Some(Member {
                            name: attribute(member, "name")?.to_owned(),
                            c_identifier: c_attribute(member, "identifier")?.to_owned(),
                            value: attribute(member, "value")?.parse().ok()?,
                        })
                    })
                    .collect(),
            }),
            "callback" => namespace.callbacks.push(Callback {
                name: attribute(node, "name").unwrap_or_default().to_owned(),
                signature: signature(node),
            }),
            "function" => namespace.functions.push(callable(node, CallableKind::Function)),
            _ => {}
        }
    }
    Ok(namespace)
}

/// A class's `<glib:signal>` elements.
fn signals(class: Node<'_, '_>) -> Vec<Signal> {
    class
        .children()
        .filter(|n| n.tag_name().namespace() == Some(GLIB) && n.tag_name().name() == "signal")
        .map(|signal| Signal {
            name: attribute(signal, "name").unwrap_or_default().to_owned(),
            signature: signature(signal),
            detailed: attribute(signal, "detailed") == Some("1"),
        })
        .collect()
}

/// A class's C type. `GtkSnapshot` has no `c:type`: C declares it a typedef
/// of `GdkSnapshot`, and GIR leaves the attribute out. Its `glib:type-name`
/// is the same spelling, and the header says what struct is behind it.
fn class_c_type(class: Node<'_, '_>) -> Option<String> {
    c_attribute(class, "type").or_else(|| class.attribute((GLIB, "type-name"))).map(str::to_owned)
}

/// A class's `<virtual-method>` elements: its class struct's function
/// members, each named as its member is.
fn vfuncs(class: Node<'_, '_>) -> Vec<Callable> {
    class.children().filter(|n| is(*n, "virtual-method")).map(|n| callable(n, CallableKind::Method)).collect()
}

/// A class's `<property>` elements, each with the methods GIR says read and
/// write it.
fn properties(class: Node<'_, '_>) -> Vec<Property> {
    class
        .children()
        .filter(|n| is(*n, "property"))
        .filter_map(|property| {
            Some(Property {
                name: attribute(property, "name")?.to_owned(),
                getter: attribute(property, "getter").map(str::to_owned),
                setter: attribute(property, "setter").map(str::to_owned),
                construct_only: attribute(property, "construct-only") == Some("1")
                    && attribute(property, "writable") == Some("1"),
            })
        })
        .collect()
}

fn callables(owner: Node<'_, '_>) -> Vec<Callable> {
    owner
        .children()
        .filter_map(|node| {
            let kind = match node.tag_name().name() {
                "method" => CallableKind::Method,
                "constructor" => CallableKind::Constructor,
                "function" => CallableKind::Function,
                _ => return None,
            };
            (node.tag_name().namespace() == Some(CORE)).then(|| callable(node, kind))
        })
        .collect()
}

fn callable(node: Node<'_, '_>, kind: CallableKind) -> Callable {
    Callable {
        name: attribute(node, "name").unwrap_or_default().to_owned(),
        c_identifier: c_attribute(node, "identifier").map(str::to_owned),
        kind,
        signature: signature(node),
        introspectable: attribute(node, "introspectable") != Some("0"),
        deprecated: attribute(node, "deprecated") == Some("1"),
        shadowed: attribute(node, "shadowed-by").is_some() || attribute(node, "moved-to").is_some(),
        // GIR's own pairing, or GLib's naming convention where it is absent.
        finish: node.attribute((GLIB, "finish-func")).map(str::to_owned).or_else(|| {
            attribute(node, "name").and_then(|name| name.strip_suffix("_async")).map(|base| format!("{base}_finish"))
        }),
    }
}

fn signature(node: Node<'_, '_>) -> Signature {
    let result = child(node, "return-value").map_or_else(
        || Param {
            name: String::new(),
            ty: TypeRef::Missing,
            direction: Direction::Out,
            transfer: Transfer::None,
            nullable: false,
            optional: false,
            caller_allocates: false,
            scope: None,
            closure: None,
            destroy: None,
        },
        |value| param(value, true),
    );
    let mut instance = None;
    let mut parameters = Vec::new();
    if let Some(list) = child(node, "parameters") {
        for item in list.children().filter(Node::is_element) {
            match item.tag_name().name() {
                "instance-parameter" => instance = Some(param(item, false)),
                "parameter" => parameters.push(param(item, false)),
                _ => {}
            }
        }
    }
    Signature { instance, parameters, result, throws: attribute(node, "throws") == Some("1") }
}

fn param(node: Node<'_, '_>, result: bool) -> Param {
    let ty = if let Some(ty) = child(node, "type") {
        TypeRef::Named {
            name: attribute(ty, "name").unwrap_or_default().to_owned(),
            c_type: c_attribute(ty, "type").map(str::to_owned),
        }
    } else if let Some(array) = child(node, "array") {
        let length = attribute(array, "length").and_then(|v| v.parse().ok());
        let fixed = attribute(array, "fixed-size").is_some();
        TypeRef::Array(ArrayRef {
            element: child(array, "type").and_then(|ty| attribute(ty, "name")).map(str::to_owned),
            c_type: c_attribute(array, "type").map(str::to_owned),
            length,
            // GIR's default: terminated unless it says otherwise, or gives the
            // extent another way.
            zero_terminated: match attribute(array, "zero-terminated") {
                Some(value) => value == "1",
                None => length.is_none() && !fixed,
            },
        })
    } else if child(node, "varargs").is_some() {
        TypeRef::Varargs
    } else {
        TypeRef::Missing
    };
    let direction = match attribute(node, "direction") {
        Some("out") => Direction::Out,
        Some("inout") => Direction::InOut,
        _ if result => Direction::Out,
        _ => Direction::In,
    };
    Param {
        name: attribute(node, "name").unwrap_or_default().to_owned(),
        ty,
        direction,
        transfer: match attribute(node, "transfer-ownership") {
            Some("full") => Transfer::Full,
            Some("container") => Transfer::Container,
            _ => Transfer::None,
        },
        nullable: attribute(node, "nullable") == Some("1")
            || attribute(node, "allow-none") == Some("1"),
        // `allow-none` is the older spelling, and meant both.
        optional: attribute(node, "optional") == Some("1") || attribute(node, "allow-none") == Some("1"),
        caller_allocates: attribute(node, "caller-allocates") == Some("1"),
        scope: match attribute(node, "scope") {
            Some("call") => Some(Scope::Call),
            Some("async") => Some(Scope::Async),
            Some("notified") => Some(Scope::Notified),
            Some("forever") => Some(Scope::Forever),
            _ => None,
        },
        closure: attribute(node, "closure").and_then(|v| v.parse().ok()),
        destroy: attribute(node, "destroy").and_then(|v| v.parse().ok()),
    }
}

fn is(node: Node<'_, '_>, name: &str) -> bool {
    node.is_element() && node.tag_name().namespace() == Some(CORE) && node.tag_name().name() == name
}

fn child<'a, 'input>(node: Node<'a, 'input>, name: &str) -> Option<Node<'a, 'input>> {
    node.children().find(|n| is(*n, name))
}

fn attribute<'a>(node: Node<'a, '_>, name: &str) -> Option<&'a str> {
    node.attribute(name)
}

fn c_attribute<'a>(node: Node<'a, '_>, name: &str) -> Option<&'a str> {
    node.attribute((C, name))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    /// The shapes the mapper decides on, read from a GIR fragment written the
    /// way `Gtk-4.0.gir` writes them: a class with a parent, a method taking a
    /// notified callback with its `user_data` and destroy beside it, an enum.
    #[test]
    fn a_fragment_reads_as_the_model() {
        let dir = std::env::temp_dir().join(format!("nts-gir-parse-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("Demo-1.0.gir"),
            r#"<?xml version="1.0"?>
<repository version="1.2" xmlns="http://www.gtk.org/introspection/core/1.0"
            xmlns:c="http://www.gtk.org/introspection/c/1.0"
            xmlns:glib="http://www.gtk.org/introspection/glib/1.0">
  <package name="demo"/>
  <c:include name="demo/demo.h"/>
  <namespace name="Demo" version="1.0">
    <class name="Button" c:type="DemoButton" parent="Widget">
      <method name="on_tick" c:identifier="demo_button_on_tick">
        <return-value transfer-ownership="none"><type name="guint" c:type="guint"/></return-value>
        <parameters>
          <instance-parameter name="self"><type name="Button" c:type="DemoButton*"/></instance-parameter>
          <parameter name="callback" scope="notified" closure="1" destroy="2">
            <type name="Tick" c:type="DemoTick"/>
          </parameter>
          <parameter name="user_data" nullable="1"><type name="gpointer" c:type="gpointer"/></parameter>
          <parameter name="notify" scope="async"><type name="GLib.DestroyNotify" c:type="GDestroyNotify"/></parameter>
        </parameters>
      </method>
    </class>
    <enumeration name="Align" c:type="DemoAlign">
      <member name="fill" value="0" c:identifier="DEMO_ALIGN_FILL"/>
      <member name="end" value="-1" c:identifier="DEMO_ALIGN_END"/>
    </enumeration>
  </namespace>
</repository>"#,
        )
        .unwrap();
        let search = [camino::Utf8PathBuf::from_path_buf(dir).unwrap()];
        let repository = super::repository("Demo-1.0", &search).unwrap();
        let demo = &repository.namespaces["Demo"];
        assert_eq!(demo.headers, ["demo/demo.h"]);
        assert_eq!(demo.packages, ["demo"]);
        let button = &demo.classes[0];
        assert_eq!(button.parent.as_deref(), Some("Widget"));
        let method = &button.callables[0];
        assert_eq!(method.c_identifier.as_deref(), Some("demo_button_on_tick"));
        assert!(method.signature.instance.is_some());
        let callback = &method.signature.parameters[0];
        assert_eq!(callback.scope, Some(super::Scope::Notified));
        assert_eq!((callback.closure, callback.destroy), (Some(1), Some(2)));
        assert!(method.signature.parameters[1].nullable);
        let align = &demo.enums[0];
        assert_eq!(align.members[1].value, -1);
        assert_eq!(align.members[1].c_identifier, "DEMO_ALIGN_END");
    }
}
