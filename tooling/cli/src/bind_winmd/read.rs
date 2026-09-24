//! What the metadata says, read into plain data and deciding nothing about
//! TypeScript: which functions a namespace has, what each parameter means,
//! and every type they reach.

use std::collections::{BTreeMap, BTreeSet};

use windows_metadata::reader::{HasAttributes, Index, TypeCategory, TypeDef};
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

#[derive(Debug, Clone)]
pub(crate) enum Kind {
    /// `[NativeTypedef]`: a C typedef over `value` -- a handle, `BOOL`, `PWSTR`.
    Typedef { value: Type },
    Struct { fields: Vec<(String, Type)>, union: bool, nested: bool },
    Enum { members: Vec<(String, Value)> },
    /// A C function pointer type: `WNDPROC`, with its parameters' names.
    Delegate { parameters: Vec<(String, Type)>, result: Type },
    /// A COM interface, which is W2's.
    Interface,
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
    row.find_attribute("DocumentationAttribute").and_then(|attribute| {
        attribute.value().into_iter().find_map(|(_, value)| match value {
            Value::Utf8(text) => Some(text),
            _ => None,
        })
    })
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
                let Some(import) = method.impl_map() else { continue };
                let signature = method.signature(&[]);
                let mut parameters = Vec::new();
                let rows: Vec<_> = method.params().filter(|p| p.sequence() > 0).collect();
                for (row, ty) in rows.iter().zip(signature.types.iter()) {
                    let flags = row.flags();
                    parameters.push(Parameter {
                        name: row.name().to_owned(),
                        ty: ty.clone(),
                        optional: row.is_optional(),
                        constant: row.has_attribute("ConstAttribute"),
                        output: flags.contains(windows_metadata::ParamAttributes::Out)
                            && !flags.contains(windows_metadata::ParamAttributes::In),
                    });
                    reach(&ty.clone(), &mut wanted);
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
                let Some(constant) = field.constant() else { continue };
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
        let Some(def) = index.get(&name.0, &name.1).next() else { continue };
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
            Kind::Typedef { value }
        }
        TypeCategory::Struct => {
            let fields: Vec<(String, Type)> = def.fields().map(|field| (field.name().to_owned(), field.ty())).collect();
            for (_, ty) in &fields {
                reach(ty, wanted);
            }
            let union = def.flags().contains(windows_metadata::TypeAttributes::ExplicitLayout);
            Kind::Struct { fields, union, nested: index.nested(def).next().is_some() }
        }
        TypeCategory::Enum => {
            let members = def
                .fields()
                .filter_map(|field| field.constant().map(|constant| (field.name().to_owned(), constant.value())))
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
                    let names = invoke.params().filter(|p| p.sequence() > 0).map(|p| p.name().to_owned());
                    let parameters = names.chain((signature.types.len()..).map(|at| format!("p{at}")))
                        .zip(signature.types.iter().cloned())
                        .collect();
                    Kind::Delegate { parameters, result: signature.return_type.clone() }
                }
                None => Kind::Other,
            }
        }
        TypeCategory::Interface => Kind::Interface,
        _ => Kind::Other,
    };
    TypeInfo { kind }
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
