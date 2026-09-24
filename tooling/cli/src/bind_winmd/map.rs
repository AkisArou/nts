//! Every TypeScript decision, made by walking the metadata's type beside the
//! C type the headers gave: the metadata says what a parameter means, the
//! header says what it is, and a disagreement between them is a refusal.

use std::collections::{BTreeMap, BTreeSet};

use windows_metadata::{Type, Value};

use super::ctype::CType;
use super::facts::{self, Facts, Questions};
use super::read::{Kind, Model, Name};

/// C `long`/`unsigned long` in TypeScript: 32 bits on Windows, so a `number`
/// (`c_long32`), where portable code's `c_long` is a `bigint`. A `DWORD` flag
/// is then an ordinary number, and a `CEnum` over one is well formed.
const LONG: (&str, &str) = ("c_long32", "long");
const ULONG: (&str, &str) = ("c_ulong32", "unsigned long");

/// A declaration a namespace's module carries.
#[derive(Debug, Clone)]
pub(crate) enum TypeDecl {
    /// `export type NAME = <ts>;` -- a handle, a scalar typedef, a callback.
    Alias { name: String, ts: String, uses: BTreeSet<Name> },
    /// A struct or union with its fields' emitted C spellings.
    Record { name: String, ts: String, c: String, fields: Vec<(String, String)>, uses: BTreeSet<Name> },
    Enum { name: String, members: Vec<(String, String)> },
}

impl TypeDecl {
    pub(crate) fn uses(&self) -> Option<&BTreeSet<Name>> {
        match self {
            Self::Alias { uses, .. } | Self::Record { uses, .. } => Some(uses),
            Self::Enum { .. } => None,
        }
    }

    pub(crate) fn name(&self) -> &str {
        match self {
            Self::Alias { name, .. } | Self::Record { name, .. } | Self::Enum { name, .. } => name,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Function {
    pub(crate) name: String,
    pub(crate) library: String,
    pub(crate) documentation: Option<String>,
    /// `(name, TypeScript)`.
    pub(crate) parameters: Vec<(String, String)>,
    pub(crate) result: String,
    /// The C function type nts will emit a call through, for the check.
    pub(crate) c_type: String,
    /// Parameters the callee reads or writes during the call only.
    pub(crate) no_escape: Vec<String>,
    /// The named types it depends on, `(namespace, name)`.
    pub(crate) uses: BTreeSet<Name>,
}

#[derive(Debug, Clone)]
pub(crate) struct Constant {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) ts: String,
}

/// One namespace's module.
#[derive(Debug, Default)]
pub(crate) struct Binding {
    pub(crate) namespace: String,
    pub(crate) module: String,
    pub(crate) types: Vec<TypeDecl>,
    pub(crate) functions: Vec<Function>,
    pub(crate) constants: Vec<Constant>,
    /// `(declaration, why)` for everything read and not bound.
    pub(crate) refused: Vec<(String, String)>,
    /// `(record name, record C spelling, field, field C spelling)`, for the check.
    pub(crate) field_checks: Vec<(String, String, String, String)>,
    /// The `c:types` names the module imports.
    pub(crate) brands: Vec<&'static str>,
}

pub(crate) fn module_of(namespace: &str) -> String {
    format!("c:{namespace}")
}

/// The questions the model raises, asked.
pub(crate) fn ask(model: &Model, headers: &[String], clang_args: &[String]) -> anyhow::Result<Facts> {
    let mut fields = Vec::new();
    let mut typedefs = Vec::new();
    for ((_, name), info) in &model.types {
        match &info.kind {
            Kind::Struct { fields: members, nested: false, .. } => {
                typedefs.push(name.as_str());
                for (field, _) in members {
                    fields.push((name.as_str(), field.as_str()));
                }
            }
            Kind::Typedef { .. } | Kind::Delegate { .. } => typedefs.push(name.as_str()),
            _ => {}
        }
    }
    let questions = Questions {
        functions: model.functions.iter().map(|function| function.name.as_str()).collect(),
        fields,
        typedefs,
    };
    facts::resolve(headers, clang_args, &questions)
}

/// How a type is being used, which decides nullability and strings.
///
/// Four independent facts, three of them the metadata's own attributes on a
/// parameter, so four flags and not an enum of their combinations.
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Copy, Default)]
struct Use {
    optional: bool,
    constant: bool,
    output: bool,
    /// A struct field or a pointee: never a lent string, and a handle may be null.
    stored: bool,
}

struct Mapper<'a> {
    model: &'a Model,
    facts: &'a Facts,
    /// The declarations each type became, by namespace, as they are needed.
    declared: BTreeMap<Name, Option<TypeDecl>>,
    brands: BTreeSet<&'static str>,
}

/// The TypeScript and emitted-C spellings of a type.
struct Spelled {
    ts: String,
    c: String,
    uses: BTreeSet<Name>,
}

fn scalar(c: &str) -> Option<(&'static str, &'static str)> {
    Some(match c {
        "char" => ("c_char", "char"),
        "signed char" => ("c_int8", "int8_t"),
        "unsigned char" => ("c_uint8", "uint8_t"),
        "short" => ("c_int16", "int16_t"),
        "unsigned short" => ("c_uint16", "uint16_t"),
        "int" => ("c_int", "int"),
        "unsigned int" => ("c_uint", "unsigned int"),
        "long" => LONG,
        "unsigned long" => ULONG,
        "long long" => ("c_int64", "int64_t"),
        "unsigned long long" => ("c_uint64", "uint64_t"),
        "float" => ("c_float", "float"),
        "double" => ("c_double", "double"),
        "_Bool" => ("boolean", "bool"),
        _ => return None,
    })
}

/// A metadata scalar's width in bytes, on Windows.
fn width_of_meta(meta: &Type) -> Option<u32> {
    Some(match meta {
        Type::Bool | Type::I8 | Type::U8 => 1,
        Type::Char | Type::I16 | Type::U16 => 2,
        Type::I32 | Type::U32 | Type::F32 => 4,
        Type::I64 | Type::U64 | Type::F64 | Type::ISize | Type::USize => 8,
        _ => return None,
    })
}

/// A C scalar's width in bytes, on Win64 (LLP64).
fn width_of_c(name: &str) -> Option<u32> {
    Some(match name {
        "char" | "signed char" | "unsigned char" | "_Bool" => 1,
        "short" | "unsigned short" => 2,
        "int" | "unsigned int" | "long" | "unsigned long" | "float" => 4,
        "long long" | "unsigned long long" | "double" => 8,
        _ => return None,
    })
}

fn nullable(ts: String, yes: bool) -> String {
    if yes { format!("{ts} | null") } else { ts }
}

impl Mapper<'_> {
    fn brand(&mut self, name: &'static str) -> &'static str {
        if name != "boolean" {
            self.brands.insert(name);
        }
        name
    }

    fn spell(&mut self, meta: &Type, c: &CType, how: Use) -> Result<Spelled, String> {
        let none = BTreeSet::new;
        match meta {
            Type::Void => match c {
                CType::Void => Ok(Spelled { ts: "void".into(), c: "void".into(), uses: none() }),
                other => Err(format!("`void` in the metadata and `{}` in the header", other.spelled())),
            },
            Type::Bool | Type::Char | Type::I8 | Type::U8 | Type::I16 | Type::U16 | Type::I32 | Type::U32
            | Type::I64 | Type::U64 | Type::F32 | Type::F64 | Type::ISize | Type::USize => {
                let CType::Scalar(name) = c else {
                    return Err(format!("a scalar in the metadata and `{}` in the header", c.spelled()));
                };
                // The header decides the C type -- `int` or `long`, signed or
                // not -- but not the width: two sources disagreeing on how
                // many bytes a parameter is are describing different
                // parameters, and taking either silently is a guess.
                if let (Some(meta_bytes), Some(c_bytes)) = (width_of_meta(meta), width_of_c(name))
                    && meta_bytes != c_bytes
                {
                    return Err(format!("{meta_bytes} bytes in the metadata and `{name}` ({c_bytes} bytes) in the header"));
                }
                let (brand, emitted) = scalar(name).ok_or_else(|| format!("`{name}`, a C scalar this binder does not spell"))?;
                Ok(Spelled { ts: self.brand(brand).into(), c: emitted.into(), uses: none() })
            }
            Type::PtrMut(inner, depth) | Type::PtrConst(inner, depth) => {
                let CType::Pointer { to, constant } = c else {
                    return Err(format!("a pointer in the metadata and `{}` in the header", c.spelled()));
                };
                let pointee = if *depth > 1 {
                    match meta {
                        Type::PtrMut(..) => Type::PtrMut(inner.clone(), depth - 1),
                        _ => Type::PtrConst(inner.clone(), depth - 1),
                    }
                } else {
                    (**inner).clone()
                };
                let target = if matches!(pointee, Type::Void) {
                    Spelled { ts: "void".into(), c: "void".into(), uses: none() }
                } else {
                    self.spell(&pointee, to, Use { stored: true, ..Use::default() })?
                };
                let wrapper = if *constant { "ConstPtr" } else { "Ptr" };
                self.brands.insert(wrapper);
                let c_spelled = if target.c.ends_with(')') && target.c.contains("(*)") {
                    return Err("a pointer to a function pointer".into());
                } else if *constant && target.c.ends_with('*') {
                    // `const HWND *` is `struct HWND__ *const *`: the handles
                    // are read-only, not what they point at.
                    format!("{} const *", target.c)
                } else {
                    format!("{}{} *", if *constant { "const " } else { "" }, target.c)
                };
                Ok(Spelled {
                    ts: nullable(format!("{wrapper}<{}>", target.ts), how.optional || how.stored),
                    c: c_spelled,
                    uses: target.uses,
                })
            }
            Type::ArrayFixed(inner, count) => {
                let CType::Array(element, _) = c else {
                    return Err("a fixed array in the metadata and not in the header".into());
                };
                let element = self.spell(inner, element, Use { stored: true, ..Use::default() })?;
                self.brands.insert("CArray");
                Ok(Spelled { ts: format!("CArray<{}, {count}>", element.ts), c: format!("{}[{count}]", element.c), uses: element.uses })
            }
            Type::ValueName(type_name) | Type::ClassName(type_name) => {
                let name = super::read::name_of(type_name);
                self.named(&name, c, how)
            }
            Type::String | Type::Object | Type::Array(_) | Type::Generic(..) | Type::RefMut(_) | Type::RefConst(_) => {
                Err("a managed type, which Win32 metadata does not use for a C API".into())
            }
        }
    }

    fn named(&mut self, name: &Name, c: &CType, how: Use) -> Result<Spelled, String> {
        let Some(info) = self.model.types.get(name) else {
            return Err(format!("`{}`, a type the metadata does not define", name.1));
        };
        match &info.kind {
            // A typedef the metadata says points at UTF-16 characters.
            Kind::Typedef { value: Type::PtrMut(unit, 1) | Type::PtrConst(unit, 1) } if **unit == Type::Char => {
                self.utf16(&name.1, c, how)
            }
            Kind::Typedef { .. } if matches!(name.1.as_str(), "PSTR" | "PCSTR") => Ok(self.narrow(c, how)),
            Kind::Typedef { .. } => self.typedef(name, c, how),
            Kind::Enum { members } => self.enumeration(name, members, c),
            Kind::Struct { nested: true, .. } => Err(format!("`{}`, a struct with a nested anonymous member", name.1)),
            Kind::Struct { fields, union, .. } => self.record(name, fields, *union, c, how),
            Kind::Delegate { parameters, result } => self.delegate(name, parameters, result, c, how),
            Kind::Interface => Err(format!("`{}`, a COM interface (W2)", name.1)),
            Kind::Other => Err(format!("`{}`, a kind of type this binder does not read", name.1)),
        }
    }

    /// `PWSTR`: a lent `Utf16String` where the callee only reads it during the
    /// call, and a pointer to UTF-16 units otherwise.
    fn utf16(&mut self, simple: &str, c: &CType, how: Use) -> Result<Spelled, String> {
        let CType::Pointer { to, constant: const_in_header } = c else {
            return Err(format!("`{simple}` is not a pointer in the header"));
        };
        if **to != CType::Scalar("unsigned short".into()) {
            return Err(format!("`{simple}` does not point at 16-bit units in the header"));
        }
        // The header decides `const`: the metadata writes `PWSTR` for
        // members the header declares `LPCWSTR` (`WNDCLASSEXW.lpszClassName`).
        let read_only = *const_in_header || how.constant;
        if read_only && !how.output && !how.stored {
            self.brands.insert("Utf16String");
            return Ok(Spelled { ts: nullable("Utf16String".into(), how.optional), c: "const uint16_t *".into(), uses: BTreeSet::new() });
        }
        let (wrapper, c_spelled) = if *const_in_header { ("ConstPtr", "const uint16_t *") } else { ("Ptr", "uint16_t *") };
        self.brands.insert(wrapper);
        self.brands.insert("c_uint16");
        Ok(Spelled {
            ts: nullable(format!("{wrapper}<c_uint16>"), how.optional || how.stored),
            c: c_spelled.into(),
            uses: BTreeSet::new(),
        })
    }

    /// `PSTR`: ANSI code-page text, which a `string` has no honest crossing
    /// to, so a pointer to `char`.
    fn narrow(&mut self, c: &CType, how: Use) -> Spelled {
        let const_in_header = matches!(c, CType::Pointer { constant: true, .. });
        let (wrapper, c_spelled) = if const_in_header { ("ConstPtr", "const char *") } else { ("Ptr", "char *") };
        self.brands.insert(wrapper);
        self.brands.insert("c_char");
        Spelled { ts: nullable(format!("{wrapper}<c_char>"), how.optional || how.stored), c: c_spelled.into(), uses: BTreeSet::new() }
    }

    /// A handle (`struct HWND__ *`, or `void *` for `HANDLE`) or a scalar
    /// typedef (`BOOL`, `WPARAM`).
    fn typedef(&mut self, name: &Name, c: &CType, how: Use) -> Result<Spelled, String> {
        let simple = name.1.as_str();
        let (ts, nullable_ok, c_spelled) = match c {
            CType::Pointer { to, .. } => match &**to {
                CType::Record { tag, .. } => {
                    self.brands.insert("Opaque");
                    (format!("Opaque<\"{tag}\">"), true, format!("struct {tag} *"))
                }
                CType::Void => {
                    self.brands.insert("Opaque");
                    self.brands.insert("Erased");
                    (format!("Erased<Opaque<\"{simple}\">>"), true, "void *".into())
                }
                other => {
                    let pointer = CType::Pointer { to: Box::new(other.clone()), constant: false };
                    return Err(format!("`{simple}`, a typedef of `{}`", pointer.spelled()));
                }
            },
            CType::Scalar(scalar_name) => {
                let (brand, emitted) =
                    scalar(scalar_name).ok_or_else(|| format!("`{scalar_name}`, a C scalar this binder does not spell"))?;
                (self.brand(brand).into(), false, emitted.into())
            }
            other => return Err(format!("`{simple}`, a typedef of `{}`", other.spelled())),
        };
        self.declared.insert(name.clone(), Some(TypeDecl::Alias { name: simple.into(), ts, uses: BTreeSet::new() }));
        Ok(Spelled {
            ts: nullable(simple.into(), nullable_ok && (how.optional || how.stored)),
            c: c_spelled,
            uses: BTreeSet::from([name.clone()]),
        })
    }

    /// An enum: a `const enum` of its members, crossing as the scalar the
    /// header gives it.
    fn enumeration(&mut self, name: &Name, members: &[(String, Value)], c: &CType) -> Result<Spelled, String> {
        let simple = name.1.as_str();
        let CType::Scalar(scalar_name) = c else {
            return Err(format!("`{simple}`, an enum the header spells `{}`", c.spelled()));
        };
        let (brand, emitted) = scalar(scalar_name).ok_or_else(|| format!("`{scalar_name}`, a C scalar this binder does not spell"))?;
        let brand = self.brand(brand);
        self.brands.insert("CEnum");
        let members = members.iter().filter_map(|(member, value)| number(value).map(|v| (member.clone(), v))).collect();
        self.declared.insert(name.clone(), Some(TypeDecl::Enum { name: simple.into(), members }));
        Ok(Spelled { ts: format!("CEnum<{simple}, {brand}>"), c: emitted.into(), uses: BTreeSet::from([name.clone()]) })
    }

    /// A struct or union, through a pointer or as a member: Win32's own habit.
    /// By value is a calling-convention question this binder does not answer yet.
    fn record(&mut self, name: &Name, fields: &[(String, Type)], union: bool, c: &CType, how: Use) -> Result<Spelled, String> {
        let simple = name.1.as_str();
        if !how.stored {
            return Err(format!("`{simple}` passed by value"));
        }
        // A tag the header wrote (`struct tagMSG`), or the typedef's own name
        // where the struct is anonymous: clang prints `typedef struct { ... }
        // FLASHWINFO` as `struct FLASHWINFO`, a tag no header declares, so a
        // tag equal to the typedef is spelled bare.
        let tag = match c {
            CType::Record { tag, .. } if tag != simple => Some(tag.clone()),
            _ => None,
        };
        let keyword = if union { "union" } else { "struct" };
        let c_spelled = tag.as_ref().map_or_else(|| simple.to_owned(), |tag| format!("{keyword} {tag}"));
        let mut uses = BTreeSet::from([name.clone()]);
        if !self.declared.contains_key(name) {
            // Declared before its members are, so a member pointing back at
            // this record finds it in progress instead of recursing.
            self.declared.insert(name.clone(), None);
            let mut members = Vec::new();
            let mut member_uses = BTreeSet::new();
            for (field, meta) in fields {
                let spelled = self
                    .facts
                    .fields
                    .get(&(simple.to_owned(), field.clone()))
                    .cloned()
                    .ok_or_else(|| format!("`{simple}.{field}`, a field the headers did not answer for"))
                    .and_then(|field_c| self.spell(meta, &field_c, Use { stored: true, ..Use::default() }).map_err(|why| format!("`{simple}.{field}`: {why}")));
                match spelled {
                    Ok(spelled) => {
                        member_uses.extend(spelled.uses);
                        members.push((field.clone(), spelled.ts, spelled.c));
                    }
                    Err(why) => {
                        self.declared.remove(name);
                        return Err(why);
                    }
                }
            }
            let shape = if union { "Union" } else { "Struct" };
            self.brands.insert(shape);
            let body = members.iter().map(|(field, ts, _)| format!("{field}: {ts}")).collect::<Vec<_>>().join("; ");
            let ts = if let Some(tag) = &tag {
                format!("{shape}<{{ {body} }}, \"{tag}\">")
            } else {
                self.brands.insert("Typedef");
                format!("Typedef<{shape}<{{ {body} }}, \"{simple}\">>")
            };
            uses.extend(member_uses.iter().cloned());
            member_uses.remove(name);
            let fields = members.into_iter().map(|(field, _, c)| (field, c)).collect();
            self.declared.insert(name.clone(), Some(TypeDecl::Record { name: simple.into(), ts, c: c_spelled.clone(), fields, uses: member_uses }));
        }
        Ok(Spelled { ts: simple.into(), c: c_spelled, uses })
    }

    /// A callback type: a function type alias, crossing as the C function
    /// pointer the header declares.
    fn delegate(&mut self, name: &Name, parameters: &[(String, Type)], result: &Type, c: &CType, how: Use) -> Result<Spelled, String> {
        let simple = name.1.as_str();
        let CType::Pointer { to, .. } = c else { return Err(format!("`{simple}` is not a function pointer in the header")) };
        let CType::Function { result: c_result, parameters: c_parameters, variadic: false } = &**to else {
            return Err(format!("`{simple}` is not a function pointer in the header"));
        };
        if c_parameters.len() != parameters.len() {
            return Err(format!("`{simple}` has {} parameters in the metadata and {} in the header", parameters.len(), c_parameters.len()));
        }
        let mut uses = BTreeSet::from([name.clone()]);
        let mut list = Vec::new();
        let mut c_list = Vec::new();
        for ((parameter, meta), c_parameter) in parameters.iter().zip(c_parameters) {
            let spelled = self.spell(meta, c_parameter, Use::default())?;
            uses.extend(spelled.uses);
            list.push(format!("{}: {}", super::emit::safe(parameter), spelled.ts));
            c_list.push(spelled.c);
        }
        let returned = self.spell(result, c_result, Use::default())?;
        uses.extend(returned.uses);
        let mut own = uses.clone();
        own.remove(name);
        self.declared.insert(
            name.clone(),
            Some(TypeDecl::Alias { name: simple.into(), ts: format!("({}) => {}", list.join(", "), returned.ts), uses: own }),
        );
        let c_spelled = format!("{} (*)({})", returned.c, if c_list.is_empty() { "void".into() } else { c_list.join(", ") });
        Ok(Spelled { ts: nullable(simple.into(), how.optional || how.stored), c: c_spelled, uses })
    }
}

/// A numeric constant as TypeScript source, or `None` for anything else.
pub(crate) fn number(value: &Value) -> Option<String> {
    Some(match value {
        Value::I8(v) => v.to_string(),
        Value::U8(v) => v.to_string(),
        Value::I16(v) => v.to_string(),
        Value::U16(v) => v.to_string(),
        Value::I32(v) => v.to_string(),
        Value::U32(v) => v.to_string(),
        Value::I64(v) => v.to_string(),
        Value::U64(v) => v.to_string(),
        _ => return None,
    })
}

fn constant_brand(meta: &Type) -> Option<&'static str> {
    Some(match meta {
        Type::I8 => "c_int8",
        Type::U8 => "c_uint8",
        Type::I16 => "c_int16",
        Type::U16 => "c_uint16",
        Type::I32 => "c_int",
        Type::U32 => "c_uint",
        _ => return None,
    })
}

/// Every namespace's module: the ones asked for, and each one owning a type
/// they reach.
pub(crate) fn bindings(model: &Model, facts: &Facts) -> Vec<Binding> {
    let mut mapper = Mapper { model, facts, declared: BTreeMap::new(), brands: BTreeSet::new() };
    let mut by_namespace: BTreeMap<String, Binding> = BTreeMap::new();
    let entry = |by: &mut BTreeMap<String, Binding>, namespace: &str| {
        by.entry(namespace.to_owned())
            .or_insert_with(|| Binding { namespace: namespace.to_owned(), module: module_of(namespace), ..Binding::default() });
    };
    for function in &model.functions {
        entry(&mut by_namespace, &function.namespace);
        match map_function(&mut mapper, function) {
            Ok(bound) => by_namespace.get_mut(&function.namespace).expect("inserted").functions.push(bound),
            Err(why) => by_namespace.get_mut(&function.namespace).expect("inserted").refused.push((function.name.clone(), why)),
        }
    }
    for constant in &model.constants {
        entry(&mut by_namespace, &constant.namespace);
        let binding = by_namespace.get_mut(&constant.namespace).expect("inserted");
        match (constant_brand(&constant.ty), number(&constant.value)) {
            (Some(brand), Some(value)) => {
                mapper.brands.insert(brand);
                binding.constants.push(Constant { name: constant.name.clone(), value, ts: brand.to_owned() });
            }
            _ => binding.refused.push((constant.name.clone(), "a constant that is not a plain integer".into())),
        }
    }
    // Each type declared where the metadata puts it.
    for (name, decl) in std::mem::take(&mut mapper.declared) {
        let Some(decl) = decl else { continue };
        entry(&mut by_namespace, &name.0);
        let binding = by_namespace.get_mut(&name.0).expect("inserted");
        if let TypeDecl::Record { name: record, c, fields, .. } = &decl {
            for (field, field_c) in fields {
                binding.field_checks.push((record.clone(), c.clone(), field.clone(), field_c.clone()));
            }
        }
        binding.types.push(decl);
    }
    let brands = mapper.brands;
    by_namespace
        .into_values()
        .map(|mut binding| {
            binding.types.sort_by(|a, b| a.name().cmp(b.name()));
            binding.brands = brands.iter().copied().collect();
            binding
        })
        .collect()
}

fn map_function(mapper: &mut Mapper, function: &super::read::Function) -> Result<Function, String> {
    let Some(CType::Function { result, parameters, variadic }) = mapper.facts.functions.get(&function.name).cloned() else {
        return Err(mapper.facts.unanswered.get(&function.name).cloned().unwrap_or_else(|| "not declared by <windows.h>".into()));
    };
    if variadic {
        return Err("variadic".into());
    }
    if parameters.len() != function.parameters.len() {
        return Err(format!(
            "{} parameters in the metadata and {} in the header",
            function.parameters.len(),
            parameters.len()
        ));
    }
    let mut typescript = Vec::new();
    let mut c_list = Vec::new();
    let mut uses = BTreeSet::new();
    let mut no_escape = Vec::new();
    for (parameter, c) in function.parameters.iter().zip(&parameters) {
        let how = Use { optional: parameter.optional, constant: parameter.constant, output: parameter.output, stored: false };
        let spelled = mapper.spell(&parameter.ty, c, how).map_err(|why| format!("parameter `{}`: {why}", parameter.name))?;
        // A pointer Win32 reads or writes during the call: the metadata's
        // `[In]`/`[Out]` is that contract, and no Win32 API it marks so keeps
        // the address. A lent string is released after the call anyway.
        if matches!(parameter.ty, Type::PtrMut(..) | Type::PtrConst(..)) {
            no_escape.push(parameter.name.clone());
        }
        uses.extend(spelled.uses);
        typescript.push((parameter.name.clone(), spelled.ts));
        c_list.push(spelled.c);
    }
    let returned = mapper
        .spell(&function.result, &result, Use { optional: true, ..Use::default() })
        .map_err(|why| format!("the result: {why}"))?;
    uses.extend(returned.uses);
    let c_type = format!("{} (*)({})", returned.c, if c_list.is_empty() { "void".into() } else { c_list.join(", ") });
    Ok(Function {
        name: function.name.clone(),
        library: function.library.clone(),
        documentation: function.documentation.clone(),
        parameters: typescript,
        result: returned.ts,
        c_type,
        no_escape,
        uses,
    })
}
