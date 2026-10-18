//! What the metadata says, read into plain data and deciding nothing about
//! TypeScript: which functions a namespace has, what each parameter means,
//! and every type they reach.

use std::collections::{BTreeMap, BTreeSet};

use windows_metadata::reader::{
    HasAttributes, Index, MethodDef, MethodParam, TypeCategory, TypeDef,
};
use windows_metadata::{Type, TypeName, Value};

/// A metadata type name, `(namespace, name)`.
pub(crate) type Name = (String, String);

pub(crate) fn name_of(type_name: &TypeName) -> Name {
    (type_name.namespace.clone(), type_name.name.clone())
}

#[derive(Debug, Clone)]
pub(crate) struct Parameter {
    pub(crate) name: String,
    pub(crate) ty: Type,
    /// `[Optional]`: the API documents NULL as meaningful here.
    pub(crate) optional: bool,
    /// `[Const]`: the callee does not write through it.
    pub(crate) constant: bool,
    /// `[Out]` without `[In]`: the callee writes the storage.
    pub(crate) output: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct Function {
    pub(crate) namespace: String,
    pub(crate) name: String,
    /// The DLL it is imported from: `USER32.dll`.
    pub(crate) library: String,
    pub(crate) parameters: Vec<Parameter>,
    pub(crate) result: Type,
    /// The documentation page, whose path names the header.
    pub(crate) documentation: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct Constant {
    pub(crate) namespace: String,
    pub(crate) name: String,
    pub(crate) ty: Type,
    pub(crate) value: Value,
}

/// One declared vtable entry, in metadata order. Inherited entries stay in
/// the parent interface rather than being copied into this list.
#[derive(Debug, Clone)]
pub(crate) struct Method {
    pub(crate) name: String,
    pub(crate) parameters: Vec<Parameter>,
    pub(crate) result: Type,
    pub(crate) documentation: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct Interface {
    /// Absent or malformed `GuidAttribute` stays absent; no IID is guessed.
    pub(crate) iid: Option<String>,
    /// Classic COM's base is the first `InterfaceImpl` row.
    pub(crate) parent: Option<Name>,
    pub(crate) methods: Vec<Method>,
}

#[derive(Debug, Clone)]
pub(crate) enum Kind {
    /// `[NativeTypedef]`: a C typedef over `value` -- a handle, `BOOL`, `PWSTR`.
    /// `parent` is `[AlsoUsableFor]`: the handle it is also, as `HBRUSH` is an
    /// `HGDIOBJ` and `HWND` a `HANDLE`.
    Typedef {
        value: Type,
        parent: Option<Name>,
    },
    Struct {
        fields: Vec<(String, Type)>,
        union: bool,
        nested: bool,
    },
    Enum {
        members: Vec<(String, Value)>,
    },
    /// A C function pointer type: `WNDPROC`, with its parameters' names.
    Delegate {
        parameters: Vec<(String, Type)>,
        result: Type,
    },
    /// A classic COM interface, read before its header-checked emission.
    Interface(Interface),
    /// Something this binder does not read.
    Other,
}

#[derive(Debug, Clone)]
pub(crate) struct TypeInfo {
    pub(crate) kind: Kind,
}

#[derive(Debug, Default)]
pub(crate) struct Model {
    pub(crate) functions: Vec<Function>,
    pub(crate) constants: Vec<Constant>,
    pub(crate) types: BTreeMap<Name, TypeInfo>,
}

fn documentation(row: &impl HasAttributes<'static>) -> Option<String> {
    row.find_attribute("DocumentationAttribute")
        .and_then(|attribute| {
            attribute
                .value()
                .into_iter()
                .find_map(|(_, value)| match value {
                    Value::Utf8(text) => Some(text),
                    _ => None,
                })
        })
}

/// Param rows name their signature position (one-based); sequence zero is
/// the return value, and a missing row must not shift every later argument.
fn parameters(method: MethodDef<'static>, types: &[Type]) -> Vec<Parameter> {
    let rows: BTreeMap<_, _> = method
        .params()
        .filter(|row| row.sequence() > 0)
        .map(|row| (usize::from(row.sequence()), row))
        .collect();
    types
        .iter()
        .enumerate()
        .map(|(at, ty)| {
            let row = rows.get(&(at + 1));
            Parameter {
                name: row.map_or_else(|| format!("p{at}"), |row| row.name().to_owned()),
                ty: ty.clone(),
                optional: row.is_some_and(MethodParam::is_optional),
                constant: row.is_some_and(|row| row.has_attribute("ConstAttribute")),
                output: row.is_some_and(|row| {
                    let flags = row.flags();
                    flags.contains(windows_metadata::ParamAttributes::Out)
                        && !flags.contains(windows_metadata::ParamAttributes::In)
                }),
            }
        })
        .collect()
}

/// Every function and constant of `namespaces`, and the types they reach.
///
/// **The W form only.** Where a function has both an `A` (ANSI code page) and a
/// `W` (UTF-16) form, the metadata marks them, and only `W` is read: an ANSI
/// string is not UTF-8 unless the process opted into it, so a TypeScript
/// `string` has no honest crossing to one.
pub(crate) fn read(index: &'static Index, namespaces: &[String]) -> Model {
    let mut model = Model::default();
    let mut wanted: Vec<Name> = Vec::new();
    for namespace in namespaces {
        for apis in index.get(namespace, "Apis") {
            for method in apis.methods() {
                if method.has_attribute("AnsiAttribute") {
                    continue;
                }
                let Some(import) = method.impl_map() else {
                    continue;
                };
                let signature = method.signature(&[]);
                let parameters = parameters(method, &signature.types);
                for parameter in &parameters {
                    reach(&parameter.ty, &mut wanted);
                }
                reach(&signature.return_type, &mut wanted);
                model.functions.push(Function {
                    namespace: namespace.clone(),
                    name: method.name().to_owned(),
                    library: import.import_scope().name().to_owned(),
                    parameters,
                    result: signature.return_type.clone(),
                    documentation: documentation(&method),
                });
            }
            for field in apis.fields() {
                let Some(constant) = field.constant() else {
                    continue;
                };
                let ty = field.ty();
                reach(&ty, &mut wanted);
                model.constants.push(Constant {
                    namespace: namespace.clone(),
                    name: field.name().to_owned(),
                    ty,
                    value: constant.value(),
                });
            }
        }
    }
    let mut seen: BTreeSet<Name> = BTreeSet::new();
    while let Some(name) = wanted.pop() {
        if !seen.insert(name.clone()) {
            continue;
        }
        let Some(def) = index.get(&name.0, &name.1).next() else {
            continue;
        };
        let info = describe(index, def, &mut wanted);
        model.types.insert(name, info);
    }
    model
}

fn describe(index: &'static Index, def: TypeDef<'static>, wanted: &mut Vec<Name>) -> TypeInfo {
    let kind = match def.category() {
        TypeCategory::Struct if def.has_attribute("NativeTypedefAttribute") => {
            let value = def.fields().next().map_or(Type::Void, |field| field.ty());
            reach(&value, wanted);
            // The metadata names the parent handle and not its namespace:
            // the one that declares a typedef of that name, found once.
            let parent = def
                .find_attribute("AlsoUsableForAttribute")
                .and_then(|attribute| {
                    attribute
                        .value()
                        .into_iter()
                        .find_map(|(_, value)| match value {
                            Value::Utf8(name) => Some(name),
                            _ => None,
                        })
                });
            let parent = parent.and_then(|name| {
                let namespace = index
                    .types()
                    .find(|candidate| {
                        candidate.name() == name
                            && candidate.has_attribute("NativeTypedefAttribute")
                    })?
                    .namespace()
                    .to_owned();
                Some((namespace, name))
            });
            if let Some(parent) = &parent {
                wanted.push(parent.clone());
            }
            Kind::Typedef { value, parent }
        }
        TypeCategory::Struct => {
            let fields: Vec<(String, Type)> = def
                .fields()
                .map(|field| (field.name().to_owned(), field.ty()))
                .collect();
            for (_, ty) in &fields {
                reach(ty, wanted);
            }
            let union = def
                .flags()
                .contains(windows_metadata::TypeAttributes::ExplicitLayout);
            Kind::Struct {
                fields,
                union,
                nested: index.nested(def).next().is_some(),
            }
        }
        TypeCategory::Enum => {
            let members = def
                .fields()
                .filter_map(|field| {
                    field
                        .constant()
                        .map(|constant| (field.name().to_owned(), constant.value()))
                })
                .collect();
            Kind::Enum { members }
        }
        TypeCategory::Delegate => {
            let invoke = def.methods().find(|method| method.name() == "Invoke");
            match invoke {
                Some(invoke) => {
                    let signature = invoke.signature(&[]);
                    for ty in &signature.types {
                        reach(ty, wanted);
                    }
                    reach(&signature.return_type, wanted);
                    let names = invoke
                        .params()
                        .filter(|p| p.sequence() > 0)
                        .map(|p| p.name().to_owned());
                    let parameters = names
                        .chain((signature.types.len()..).map(|at| format!("p{at}")))
                        .zip(signature.types.iter().cloned())
                        .collect();
                    Kind::Delegate {
                        parameters,
                        result: signature.return_type.clone(),
                    }
                }
                None => Kind::Other,
            }
        }
        TypeCategory::Interface => Kind::Interface(interface(def, wanted)),
        _ => Kind::Other,
    };
    TypeInfo { kind }
}

fn interface(def: TypeDef<'static>, wanted: &mut Vec<Name>) -> Interface {
    let parent = def.interface_impls().next().and_then(|row| {
        if let Type::ClassName(parent) = row.interface(&[]) {
            Some(name_of(&parent))
        } else {
            None
        }
    });
    if let Some(parent) = &parent {
        wanted.push(parent.clone());
    }
    let methods = def
        .methods()
        .map(|method| {
            let signature = method.signature(&[]);
            for ty in &signature.types {
                reach(ty, wanted);
            }
            reach(&signature.return_type, wanted);
            Method {
                name: method.name().to_owned(),
                parameters: parameters(method, &signature.types),
                result: signature.return_type,
                documentation: documentation(&method),
            }
        })
        .collect();
    Interface {
        iid: super::iid::from_attribute(def),
        parent,
        methods,
    }
}

/// The type names `ty` mentions, onto `wanted`.
fn reach(ty: &Type, wanted: &mut Vec<Name>) {
    match ty {
        Type::ClassName(name) | Type::ValueName(name) => wanted.push(name_of(name)),
        Type::Array(inner)
        | Type::RefMut(inner)
        | Type::RefConst(inner)
        | Type::ArrayFixed(inner, _)
        | Type::PtrMut(inner, _)
        | Type::PtrConst(inner, _) => reach(inner, wanted),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    //! Tiny ECMA-335 metadata files exercise the reader without an installed SDK.
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::{Interface, Kind, Model, read};
    use windows_metadata::reader::{File, Index};
    use windows_metadata::writer::{
        self, AttributeType, HasAttribute, MemberRefParent, TypeDefOrRef,
    };
    use windows_metadata::{
        MethodAttributes, MethodImplAttributes, ParamAttributes, Signature, Type, TypeAttributes,
        TypeName, Value,
    };

    const NS: &str = "Windows.Win32.ReaderTest";

    fn named(name: &str) -> Type {
        Type::ClassName(TypeName::named(NS, name))
    }

    fn attribute(file: &mut writer::File, owner: HasAttribute, name: &str, values: Vec<Value>) {
        let attr = file.TypeRef("Windows.Win32.Foundation.Metadata", name);
        let ctor = file.MemberRef(
            ".ctor",
            &Signature {
                types: values.iter().map(Value::ty).collect(),
                ..Signature::default()
            },
            MemberRefParent::TypeRef(attr),
        );
        file.Attribute(
            owner,
            AttributeType::MemberRef(ctor),
            &values
                .into_iter()
                .map(|value| (String::new(), value))
                .collect::<Vec<_>>(),
        );
    }

    fn interface(
        file: &mut writer::File,
        name: &str,
        parent: Option<&str>,
        guid: Option<u32>,
    ) -> writer::TypeDef {
        let def = file.TypeDef(
            NS,
            name,
            TypeDefOrRef::default(),
            TypeAttributes::Public | TypeAttributes::Interface | TypeAttributes::Abstract,
        );
        if let Some(parent) = parent {
            file.InterfaceImpl(def, &named(parent));
        }
        if let Some(first) = guid {
            attribute(
                file,
                HasAttribute::TypeDef(def),
                "GuidAttribute",
                vec![
                    Value::U32(first),
                    Value::U16(0),
                    Value::U16(0),
                    Value::U8(0xC0),
                    Value::U8(0),
                    Value::U8(0),
                    Value::U8(0),
                    Value::U8(0),
                    Value::U8(0),
                    Value::U8(0),
                    Value::U8(0x46),
                ],
            );
        }
        def
    }

    type ParamRow<'a> = (&'a str, u16, ParamAttributes, bool);

    fn method(
        file: &mut writer::File,
        name: &str,
        result: Type,
        types: Vec<Type>,
        rows: &[ParamRow],
    ) {
        file.MethodDef(
            name,
            &Signature {
                return_type: result,
                types,
                ..Signature::default()
            },
            MethodAttributes::Public | MethodAttributes::Virtual | MethodAttributes::Abstract,
            MethodImplAttributes(0),
        );
        for (name, sequence, flags, constant) in rows {
            let row = file.Param(name, *sequence, *flags);
            if *constant {
                attribute(file, HasAttribute::Param(row), "ConstAttribute", Vec::new());
            }
        }
    }

    fn model() -> Model {
        let mut file = writer::File::new("classic-com-reader");
        interface(&mut file, "IUnknown", None, Some(0));
        method(&mut file, "QueryInterface", Type::I32, Vec::new(), &[]);
        method(&mut file, "AddRef", Type::U32, Vec::new(), &[]);
        method(&mut file, "Release", Type::U32, Vec::new(), &[]);
        interface(&mut file, "IBase", Some("IUnknown"), Some(1));
        method(
            &mut file,
            "Use",
            Type::I32,
            vec![
                Type::PtrMut(
                    Box::new(Type::ValueName(TypeName::named("ReaderTypes", "Payload"))),
                    1,
                ),
                Type::PtrMut(Box::new(named("IOut")), 2),
                Type::PtrMut(Box::new(Type::I32), 1),
            ],
            &[
                ("return_value", 0, ParamAttributes::Out, true),
                (
                    "input",
                    1,
                    ParamAttributes::In | ParamAttributes::Optional,
                    true,
                ),
                ("output", 2, ParamAttributes::Out, false),
                (
                    "inout",
                    3,
                    ParamAttributes::In | ParamAttributes::Out,
                    false,
                ),
            ],
        );
        let derived = interface(&mut file, "IDerived", Some("IBase"), Some(2));
        file.InterfaceImpl(derived, &named("ISecond"));
        // Deliberately non-alphabetical: declaration order determines the slots.
        method(
            &mut file,
            "Zeta",
            Type::U32,
            vec![Type::I32, Type::U32],
            &[("second", 2, ParamAttributes::Out, false)],
        );
        method(&mut file, "Alpha", Type::Void, Vec::new(), &[]);
        interface(&mut file, "IOut", Some("IUnknown"), Some(3));
        interface(&mut file, "IWithIid", Some("IUnknown"), Some(4));
        interface(&mut file, "IWithoutIid", Some("IUnknown"), None);
        let malformed = interface(&mut file, "IMalformedIid", Some("IUnknown"), None);
        attribute(
            &mut file,
            HasAttribute::TypeDef(malformed),
            "GuidAttribute",
            vec![Value::Utf8("wrong".into())],
        );
        let value_type = file.TypeRef("System", "ValueType");
        file.TypeDef(
            "ReaderTypes",
            "Payload",
            TypeDefOrRef::TypeRef(value_type),
            TypeAttributes::Public,
        );
        let object = file.TypeRef("System", "Object");
        file.TypeDef(
            NS,
            "Apis",
            TypeDefOrRef::TypeRef(object),
            TypeAttributes::Public,
        );
        for name in ["IDerived", "IWithIid", "IWithoutIid", "IMalformedIid"] {
            let entry = file.MethodDef(
                name,
                &Signature {
                    return_type: named(name),
                    ..Signature::default()
                },
                MethodAttributes::Public | MethodAttributes::Static,
                MethodImplAttributes(0),
            );
            file.ImplMap(
                entry,
                windows_metadata::PInvokeAttributes(0),
                name,
                "reader.dll",
            );
        }
        let index = Index::new(vec![
            File::new(file.into_stream()).expect("valid fixture metadata"),
        ])
        .leak();
        read(index, &[NS.to_owned()])
    }

    fn com<'a>(model: &'a Model, name: &str) -> &'a Interface {
        let info = model
            .types
            .get(&(NS.to_owned(), name.to_owned()))
            .expect(name);
        let Kind::Interface(interface) = &info.kind else {
            panic!("{name} is not an interface")
        };
        interface
    }

    #[test]
    fn iunknown_has_its_real_iid_and_three_ordered_entries() {
        let model = model();
        let root = com(&model, "IUnknown");
        assert_eq!(
            root.iid.as_deref(),
            Some("00000000-0000-0000-C000-000000000046")
        );
        assert_eq!(root.parent, None);
        assert_eq!(
            root.methods
                .iter()
                .map(|m| m.name.as_str())
                .collect::<Vec<_>>(),
            ["QueryInterface", "AddRef", "Release"]
        );
        assert_eq!(root.methods[1].result, Type::U32);
    }

    #[test]
    fn inheritance_reaches_the_first_base_and_preserves_own_method_order() {
        let model = model();
        let derived = com(&model, "IDerived");
        assert_eq!(derived.parent, Some((NS.to_owned(), "IBase".to_owned())));
        assert_eq!(
            derived
                .methods
                .iter()
                .map(|m| m.name.as_str())
                .collect::<Vec<_>>(),
            ["Zeta", "Alpha"]
        );
        assert_eq!(
            com(&model, "IBase").parent,
            Some((NS.to_owned(), "IUnknown".to_owned()))
        );
        assert_eq!(com(&model, "IBase").methods.len(), 1);
        assert!(
            !model
                .types
                .contains_key(&(NS.to_owned(), "ISecond".to_owned()))
        );
        assert!(
            model
                .types
                .contains_key(&("ReaderTypes".to_owned(), "Payload".to_owned()))
        );
        assert!(
            model
                .types
                .contains_key(&(NS.to_owned(), "IOut".to_owned()))
        );
    }

    #[test]
    fn method_parameters_keep_optional_const_out_and_inout_meaning() {
        let model = model();
        let parameters = &com(&model, "IBase").methods[0].parameters;
        assert_eq!(
            parameters.len(),
            3,
            "the return Param row is not an argument"
        );
        assert_eq!(parameters[0].name, "input");
        assert!(parameters[0].optional && parameters[0].constant && !parameters[0].output);
        assert_eq!(parameters[1].name, "output");
        assert!(!parameters[1].optional && !parameters[1].constant && parameters[1].output);
        assert_eq!(parameters[2].name, "inout");
        assert!(!parameters[2].output, "In|Out is not an output-only slot");
        assert_eq!(parameters[1].ty, Type::PtrMut(Box::new(named("IOut")), 2));
    }

    #[test]
    fn a_missing_param_row_does_not_shift_later_arguments() {
        let model = model();
        let parameters = &com(&model, "IDerived").methods[0].parameters;
        assert_eq!(parameters.len(), 2);
        assert_eq!(parameters[0].name, "p0");
        assert_eq!(parameters[0].ty, Type::I32);
        assert!(!parameters[0].output);
        assert_eq!(parameters[1].name, "second");
        assert_eq!(parameters[1].ty, Type::U32);
        assert!(parameters[1].output);
    }

    #[test]
    fn an_absent_or_malformed_iid_is_never_invented() {
        let model = model();
        assert_eq!(
            com(&model, "IWithIid").iid.as_deref(),
            Some("00000004-0000-0000-C000-000000000046")
        );
        assert_eq!(com(&model, "IWithoutIid").iid, None);
        assert_eq!(com(&model, "IMalformedIid").iid, None);
    }
}
