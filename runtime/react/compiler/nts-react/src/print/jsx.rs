//! JSX, lowered to React 19's automatic runtime as TypeScript's
//! `--jsx react-jsx` emit lowers it (tsgo's `jsxtransforms/jsx.go`), because
//! nts compiles calls and not JSX.
//!
//! - `<div a="x" key={k}>{child}</div>` is `_jsx("div", { a: "x", children: child }, k)`.
//! - More than one child, or one spread child, is `_jsxs` with a children array.
//! - A `key` after a spread attribute falls back to `_createElement` from
//!   `react`, whose props object then carries the key.
//! - JSX text is trimmed line by line and its HTML entities decoded, from
//!   the source text where there is one ([`crate::jsx_text`]).

use std::collections::BTreeSet;
use std::fmt::Write as _;

use react_compiler_ast::expressions::Expression;
use react_compiler_ast::jsx::{
    JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement, JSXElementName,
    JSXExpressionContainerExpr, JSXFragment, JSXMemberExprObject, JSXMemberExpression,
};

use crate::jsx_text::{fixup_whitespace, is_formatting};

use super::{ASSIGN, Printer, quote};

/// The runtime functions a lowered file calls, by the local names it imports
/// them under.
#[derive(Debug, Default)]
pub(super) struct JsxImports {
    /// From `react/jsx-runtime`, as import specifiers; sorted by name as
    /// TypeScript sorts them.
    runtime: BTreeSet<&'static str>,
    /// `createElement`, from `react`.
    create_element: bool,
    /// A class component's descriptor was written ([`super::class`]).
    pub(super) class_type: bool,
}

impl JsxImports {
    /// The import declarations to put first in the file, as TypeScript emits
    /// them: the runtime's names, then `createElement` from `react`.
    pub(super) fn declarations(&self) -> String {
        let mut out = String::new();
        let mut runtime = self.runtime.clone();
        if self.class_type {
            runtime.insert("ClassComponentType as _ClassComponentType");
        }
        if !runtime.is_empty() {
            let names: Vec<&str> = runtime.iter().copied().collect();
            let _ = writeln!(out, "import {{ {} }} from \"react/jsx-runtime\";", names.join(", "));
        }
        if self.create_element {
            out.push_str("import { createElement as _createElement } from \"react\";\n");
        }
        out
    }
}

/// A child as the call passes it; formatting and empty containers pass
/// nothing, and are not here.
enum Child<'c> {
    /// Text, trimmed and decoded.
    Text(String),
    Expression(&'c Expression),
    Spread(&'c Expression),
    Element(&'c JSXElement),
    Fragment(&'c JSXFragment),
}

/// Whether the call is `_jsxs`: more than one child, or one spread.
fn is_static(children: &[Child]) -> bool {
    children.len() > 1 || matches!(children, [Child::Spread(_)])
}

impl Printer<'_> {
    pub(super) fn jsx_lower_element(&mut self, element: &JSXElement) {
        let opening = &element.opening_element;
        if key_after_spread(&opening.attributes) {
            self.jsx_create_element(element);
            return;
        }
        // The first `key` is the call's third argument, and not a prop.
        let key_at = opening.attributes.iter().position(
            |attribute| matches!(attribute, JSXAttributeItem::JSXAttribute(a) if matches!(&a.name, JSXAttributeName::JSXIdentifier(n) if n.name == "key")),
        );
        let key = key_at.and_then(|at| match &opening.attributes[at] {
            JSXAttributeItem::JSXAttribute(a) => Some(a),
            JSXAttributeItem::JSXSpreadAttribute(_) => None,
        });
        let attributes: Vec<&JSXAttributeItem> =
            opening.attributes.iter().enumerate().filter(|(at, _)| Some(*at) != key_at).map(|(_, attribute)| attribute).collect();
        let children = self.jsx_children_lowered(&element.children);
        self.jsx_call(&children);
        self.jsx_tag(&opening.name);
        self.write(", ");
        self.jsx_props(&attributes, &children);
        if let Some(key) = key {
            self.write(", ");
            self.jsx_attribute_value(key);
        }
        self.write(")");
    }

    pub(super) fn jsx_lower_fragment(&mut self, fragment: &JSXFragment) {
        let children = self.jsx_children_lowered(&fragment.children);
        self.jsx_call(&children);
        self.jsx_imports.runtime.insert("Fragment as _Fragment");
        self.write("_Fragment, ");
        self.jsx_props(&[], &children);
        self.write(")");
    }

    /// `_jsx(` or, for static children, `_jsxs(`.
    fn jsx_call(&mut self, children: &[Child]) {
        if is_static(children) {
            self.jsx_imports.runtime.insert("jsxs as _jsxs");
            self.write("_jsxs(");
        } else {
            self.jsx_imports.runtime.insert("jsx as _jsx");
            self.write("_jsx(");
        }
    }

    /// `_createElement(tag, props | null, ...children)`: the form a `key`
    /// after a spread needs, since the key must then come from the props.
    fn jsx_create_element(&mut self, element: &JSXElement) {
        self.jsx_imports.create_element = true;
        self.write("_createElement(");
        self.jsx_tag(&element.opening_element.name);
        self.write(", ");
        let attributes: Vec<&JSXAttributeItem> = element.opening_element.attributes.iter().collect();
        if attributes.is_empty() {
            self.write("null");
        } else {
            self.jsx_props(&attributes, &[]);
        }
        for child in &self.jsx_children_lowered(&element.children) {
            self.write(", ");
            self.jsx_child(child);
        }
        self.write(")");
    }

    /// A tag: an intrinsic name as a string, `a:b` as a string, anything else
    /// as the expression it names.
    fn jsx_tag(&mut self, name: &JSXElementName) {
        match name {
            JSXElementName::JSXIdentifier(i) if is_intrinsic(&i.name) => self.write(&quote(&i.name.encode_utf16().collect::<Vec<_>>())),
            JSXElementName::JSXIdentifier(i) => {
                let name = self.name(&i.base, &i.name).to_owned();
                self.write(&name);
                self.jsx_class_type(i.base.node_id);
            }
            JSXElementName::JSXMemberExpression(m) => {
                self.jsx_member_tag(m);
                self.jsx_class_type(m.base.node_id);
            }
            JSXElementName::JSXNamespacedName(n) => {
                let text = format!("{}:{}", n.namespace.name, n.name.name);
                self.write(&quote(&text.encode_utf16().collect::<Vec<_>>()));
            }
        }
    }

    /// A tag that is a class names its descriptor, the class's `$$type`
    /// ([`super::class`]): the checker types a class value as `typeof C`.
    fn jsx_class_type(&mut self, node: Option<u32>) {
        if node.and_then(|node| self.types.type_at(node)).is_some_and(|ty| ty.starts_with("typeof ")) {
            self.write(".$$type");
        }
    }

    fn jsx_member_tag(&mut self, member: &JSXMemberExpression) {
        match member.object.as_ref() {
            JSXMemberExprObject::JSXIdentifier(i) => {
                let name = self.name(&i.base, &i.name).to_owned();
                self.write(&name);
            }
            JSXMemberExprObject::JSXMemberExpression(inner) => self.jsx_member_tag(inner),
        }
        let _ = write!(self.out, ".{}", member.property.name);
    }

    /// The props object: attributes in order, an object-literal spread
    /// inlined, then `children` if there are any.
    fn jsx_props(&mut self, attributes: &[&JSXAttributeItem], children: &[Child]) {
        if attributes.is_empty() && children.is_empty() {
            self.write("{}");
            return;
        }
        self.write("{ ");
        let mut first = true;
        let mut separate = |printer: &mut Self| {
            if !std::mem::take(&mut first) {
                printer.write(", ");
            }
        };
        for attribute in attributes {
            match attribute {
                JSXAttributeItem::JSXSpreadAttribute(spread) => match spread.argument.as_ref() {
                    // `{...{ a: 1 }}` is the attributes it spells, as tsgo inlines it.
                    Expression::ObjectExpression(object) if !has_proto(object) => {
                        for property in &object.properties {
                            separate(self);
                            self.object_member(property);
                        }
                    }
                    other => {
                        separate(self);
                        self.write("...");
                        self.expression(other, ASSIGN);
                    }
                },
                JSXAttributeItem::JSXAttribute(a) => {
                    separate(self);
                    self.jsx_attribute_name(&a.name);
                    self.write(": ");
                    self.jsx_attribute_value(a);
                }
            }
        }
        if !children.is_empty() {
            separate(self);
            self.write("children: ");
            if is_static(children) {
                self.write("[");
                for (at, child) in children.iter().enumerate() {
                    if at > 0 {
                        self.write(", ");
                    }
                    self.jsx_child(child);
                }
                self.write("]");
            } else {
                self.jsx_child(&children[0]);
            }
        }
        self.write(" }");
    }

    fn jsx_attribute_name(&mut self, name: &JSXAttributeName) {
        match name {
            JSXAttributeName::JSXIdentifier(i) if is_identifier(&i.name) => self.write(&i.name),
            JSXAttributeName::JSXIdentifier(i) => self.write(&quote(&i.name.encode_utf16().collect::<Vec<_>>())),
            JSXAttributeName::JSXNamespacedName(n) => {
                let text = format!("{}:{}", n.namespace.name, n.name.name);
                self.write(&quote(&text.encode_utf16().collect::<Vec<_>>()));
            }
        }
    }

    /// An attribute's value: `true` when absent, a string with its entities
    /// decoded, an expression, or a lowered element.
    fn jsx_attribute_value(&mut self, attribute: &JSXAttribute) {
        match &attribute.value {
            None => self.write("true"),
            Some(JSXAttributeValue::StringLiteral(s)) => {
                // Decoded already, as TypeScript would decode the source.
                let value = s.value.to_string_lossy();
                self.write(&quote(&value.encode_utf16().collect::<Vec<_>>()));
            }
            Some(JSXAttributeValue::JSXExpressionContainer(c)) => match &c.expression {
                JSXExpressionContainerExpr::Expression(e) => self.expression(e, ASSIGN),
                JSXExpressionContainerExpr::JSXEmptyExpression(_) => self.write("true"),
            },
            Some(JSXAttributeValue::JSXElement(e)) => self.jsx_lower_element(e),
            Some(JSXAttributeValue::JSXFragment(f)) => self.jsx_lower_fragment(f),
        }
    }

    /// The children a call passes, in order: tsgo's `GetSemanticJsxChildren`,
    /// with text trimmed. A text is read from the source where its span
    /// names one, since TypeScript trims before it decodes.
    fn jsx_children_lowered<'c>(&self, children: &'c [JSXChild]) -> Vec<Child<'c>> {
        children
            .iter()
            .filter_map(|child| match child {
                JSXChild::JSXText(t) => {
                    let (text, decode) = self.jsx_spelling(&t.base, &t.value).map_or_else(|| (t.value.clone(), false), |spelling| (spelling, true));
                    (!is_formatting(&text)).then(|| Child::Text(fixup_whitespace(&text, decode)))
                }
                JSXChild::JSXExpressionContainer(c) => match &c.expression {
                    JSXExpressionContainerExpr::Expression(e) => Some(Child::Expression(e)),
                    JSXExpressionContainerExpr::JSXEmptyExpression(_) => None,
                },
                JSXChild::JSXSpreadChild(s) => Some(Child::Spread(&s.expression)),
                JSXChild::JSXElement(e) => Some(Child::Element(e)),
                JSXChild::JSXFragment(f) => Some(Child::Fragment(f)),
            })
            .collect()
    }

    fn jsx_child(&mut self, child: &Child) {
        match child {
            Child::Text(text) => self.write(&quote(&text.encode_utf16().collect::<Vec<_>>())),
            Child::Spread(expression) => {
                self.write("...");
                self.expression(expression, ASSIGN);
            }
            Child::Expression(expression) => self.expression(expression, ASSIGN),
            Child::Element(element) => self.jsx_lower_element(element),
            Child::Fragment(fragment) => self.jsx_lower_fragment(fragment),
        }
    }
}

/// tsgo's `hasKeyAfterPropsSpread`: a spread that is not an inlinable object
/// literal, followed by a `key`.
fn key_after_spread(attributes: &[JSXAttributeItem]) -> bool {
    let mut spread = false;
    for attribute in attributes {
        match attribute {
            JSXAttributeItem::JSXSpreadAttribute(s) => {
                let inlinable = matches!(s.argument.as_ref(), Expression::ObjectExpression(o) if !o.properties.iter().any(|p| matches!(p, react_compiler_ast::expressions::ObjectExpressionProperty::SpreadElement(_))));
                if !inlinable {
                    spread = true;
                }
            }
            JSXAttributeItem::JSXAttribute(a) if spread && matches!(&a.name, JSXAttributeName::JSXIdentifier(n) if n.name == "key") => return true,
            JSXAttributeItem::JSXAttribute(_) => {}
        }
    }
    false
}

fn has_proto(object: &react_compiler_ast::expressions::ObjectExpression) -> bool {
    object.properties.iter().any(|property| {
        matches!(property, react_compiler_ast::expressions::ObjectExpressionProperty::ObjectProperty(p)
            if !p.computed && match p.key.as_ref() {
                Expression::Identifier(i) => i.name == "__proto__",
                Expression::StringLiteral(s) => s.value == "__proto__",
                _ => false,
            })
    })
}

/// tsgo's `IsIntrinsicJsxName`: a lowercase first letter, or a dash.
fn is_intrinsic(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_lowercase()) || name.contains('-')
}

fn is_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_alphabetic() || c == '_' || c == '$') && chars.all(|c| c.is_alphanumeric() || c == '_' || c == '$')
}
