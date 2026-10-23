//! Every TypeScript decision, made by walking the metadata's type beside the
//! C type the headers gave: the metadata says what a parameter means, the
//! header says what it is, and a disagreement between them is a refusal.

use std::collections::{BTreeMap, BTreeSet};

use windows_metadata::{Type, Value};

use super::facts::{self, Facts, Questions};
use super::read::{Kind, Model, Name};
use crate::bind_header::ctype::CType;

/// C `long`/`unsigned long` in TypeScript: 32 bits on Windows, so a `number`
/// (`c_long32`), where portable code's `c_long` is a `bigint`. A `DWORD` flag
/// is then an ordinary number, and a `CEnum` over one is well formed.
const LONG: (&str, &str) = ("c_long32", "long");
const ULONG: (&str, &str) = ("c_ulong32", "unsigned long");

/// A declaration a namespace's module carries.
#[derive(Debug, Clone)]
pub(crate) enum TypeDecl {
    /// `export type NAME = <ts>;` -- a handle, a scalar typedef, a callback.
    Alias {
        name: String,
        ts: String,
        /// Documentation lines, where the type alone does not say enough.
        doc: Vec<String>,
        uses: BTreeSet<Name>,
    },
    /// A struct or union with its fields' emitted C spellings.
    Record {
        name: String,
        ts: String,
        c: String,
        layout: facts::RecordLayout,
        fields: Vec<(String, String)>,
        uses: BTreeSet<Name>,
    },
    Interface {
        name: String,
        iid: String,
        tag: String,
        /// Nearest parent first; method surfaces are flattened explicitly.
        bases: Vec<Name>,
        methods: Vec<ComMethod>,
        /// Only the base chain: each method carries its own dependencies.
        uses: BTreeSet<Name>,
    },
    Enum {
        name: String,
        members: Vec<(String, String)>,
        /// The C spelling nts emits for the integer it crosses as, which
        /// is the type the check compares member values in.
        c: String,
        /// The header gives it as an enum type (`enum TAG`, or a typedef
        /// of an anonymous enum), so its enumerators are in the header
        /// for the check to hold each member's value against.
        header_enum: bool,
    },
}

impl TypeDecl {
    pub(crate) fn uses(&self) -> Option<&BTreeSet<Name>> {
        match self {
            Self::Alias { uses, .. } | Self::Record { uses, .. } | Self::Interface { uses, .. } => {
                Some(uses)
            }
            Self::Enum { .. } => None,
        }
    }

    pub(crate) fn name(&self) -> &str {
        match self {
            Self::Alias { name, .. }
            | Self::Record { name, .. }
            | Self::Enum { name, .. }
            | Self::Interface { name, .. } => name,
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
    /// Only reviewed text parameters also accept a resource atom.
    pub(crate) resource_parameters: Vec<usize>,
    pub(crate) result: String,
    /// A checked HRESULT call whose trailing typed slot is compiler-owned.
    pub(crate) hresult: bool,
    pub(crate) com_output: Option<ComOutput>,
    /// The C function type nts will emit a call through, for the check.
    pub(crate) c_type: String,
    /// Parameters the callee reads or writes during the call only.
    pub(crate) no_escape: Vec<String>,
    /// The named types it depends on, `(namespace, name)`.
    pub(crate) uses: BTreeSet<Name>,
}

/// A checked signature uses exactly the same parameter/result mapping as a
/// free function. HRESULT changes only the projected result, never the ABI.
#[derive(Debug, Clone)]
pub(crate) struct ComMethod {
    pub(crate) signature: Function,
    pub(crate) slot: u32,
}

#[derive(Debug, Clone)]
pub(crate) struct ComOutput {
    pub(crate) parameter: String,
    /// Preserve the metadata fact; projecting pure Out does not invent it.
    pub(crate) retval: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct Constant {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) ts: String,
    /// Require an actual header value; resource pointer bits are never guessed.
    pub(crate) header_required: bool,
    /// Named handle types, which must survive the header check too.
    pub(crate) uses: BTreeSet<Name>,
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
pub(crate) fn ask(
    model: &Model,
    headers: &[Vec<String>],
    clang_args: &[String],
) -> anyhow::Result<Facts> {
    let mut fields = Vec::new();
    let mut typedefs = Vec::new();
    let mut records = Vec::new();
    // CINTERFACE exposes each interface's full inherited vtable as an ordinary
    // C struct. Its fields use the same type resolver as every other record.
    let vtables: Vec<_> = model
        .types
        .iter()
        .filter_map(|(name, info)| {
            if !matches!(info.kind, Kind::Interface(_)) {
                return None;
            }
            let mut methods = Vec::new();
            let mut next = Some(name);
            let mut seen = BTreeSet::new();
            while let Some(name) = next {
                if !seen.insert(name) {
                    break;
                }
                let Some(Kind::Interface(interface)) = model.types.get(name).map(|info| &info.kind)
                else {
                    break;
                };
                methods.extend(&interface.methods);
                next = interface.parent.as_ref();
            }
            Some((format!("{}Vtbl", name.1), methods))
        })
        .collect();
    let field_slots: Vec<_> = vtables
        .iter()
        .flat_map(|(record, methods)| {
            methods
                .iter()
                .map(move |method| (record.as_str(), method.name.as_str()))
        })
        .collect();
    fields.extend(field_slots.iter().copied());
    for ((_, name), info) in &model.types {
        match &info.kind {
            Kind::Struct {
                fields: members,
                union,
                nested: false,
                ..
            } => {
                records.push(facts::RecordQuestion {
                    name,
                    union: *union,
                    fields: members.iter().map(|(field, _)| field.as_str()).collect(),
                });
                typedefs.push(name.as_str());
                for (field, _) in members {
                    fields.push((name.as_str(), field.as_str()));
                }
            }
            Kind::Typedef { .. } | Kind::Delegate { .. } | Kind::Interface(_) => {
                typedefs.push(name.as_str());
            }
            _ => {}
        }
    }
    let questions = Questions {
        records,
        functions: model
            .functions
            .iter()
            .map(|function| function.name.as_str())
            .collect(),
        fields,
        field_slots,
        typedefs,
    };
    facts::resolve(headers, clang_args, &questions)
}

/// How a type is being used, which decides nullability and strings.
///
/// Independent facts, three of them the metadata's own attributes on a
/// parameter, so flags and not an enum of their combinations.
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Copy, Default)]
struct Use {
    optional: bool,
    constant: bool,
    output: bool,
    /// A struct field or a pointee: never a lent string, and a handle may be null.
    stored: bool,
    /// An argument or the result of a bound function itself, where a record
    /// crosses by value. Never a callback's: the compiler refuses a record by
    /// value there, so the binding does too.
    direct: bool,
    /// Text that can be an integer resource atom instead
    /// (`resource-params.json`): never a lent string, which would read
    /// through the atom, but the header's own pointer.
    atom: bool,
}

struct Mapper<'a> {
    model: &'a Model,
    facts: &'a Facts,
    resources: &'a super::resource_params::Policy,
    /// The declarations each type became, by namespace, as they are needed.
    declared: BTreeMap<Name, Option<TypeDecl>>,
    brands: BTreeSet<&'static str>,
    record_refusals: BTreeMap<Name, String>,
    method_refusals: BTreeMap<Name, String>,
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
        "signed char" => ("Int8", "int8_t"),
        "unsigned char" => ("Uint8", "uint8_t"),
        "short" => ("Int16", "int16_t"),
        "unsigned short" => ("Uint16", "uint16_t"),
        "int" => ("c_int", "int"),
        "unsigned int" => ("c_uint", "unsigned int"),
        "long" => LONG,
        "unsigned long" => ULONG,
        "long long" => ("BigInt64", "int64_t"),
        "unsigned long long" => ("BigUint64", "uint64_t"),
        "float" => ("Float32", "float"),
        "double" => ("Float64", "double"),
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

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn spell(&mut self, meta: &Type, c: &CType, how: Use) -> Result<Spelled, String> {
        let none = BTreeSet::new;
        match meta {
            Type::Void => match c {
                CType::Void => Ok(Spelled {
                    ts: "void".into(),
                    c: "void".into(),
                    uses: none(),
                }),
                other => Err(format!(
                    "`void` in the metadata and `{}` in the header",
                    other.spelled()
                )),
            },
            Type::Bool
            | Type::Char
            | Type::I8
            | Type::U8
            | Type::I16
            | Type::U16
            | Type::I32
            | Type::U32
            | Type::I64
            | Type::U64
            | Type::F32
            | Type::F64
            | Type::ISize
            | Type::USize => {
                let CType::Scalar(name) = c else {
                    return Err(format!(
                        "a scalar in the metadata and `{}` in the header",
                        c.spelled()
                    ));
                };
                // The header decides the C type -- `int` or `long`, signed or
                // not -- but not the width: two sources disagreeing on how
                // many bytes a parameter is are describing different
                // parameters, and taking either silently is a guess.
                if let (Some(meta_bytes), Some(c_bytes)) = (width_of_meta(meta), width_of_c(name))
                    && meta_bytes != c_bytes
                {
                    return Err(format!(
                        "{meta_bytes} bytes in the metadata and `{name}` ({c_bytes} bytes) in the header"
                    ));
                }
                let (brand, emitted) = scalar(name)
                    .ok_or_else(|| format!("`{name}`, a C scalar this binder does not spell"))?;
                Ok(Spelled {
                    ts: self.brand(brand).into(),
                    c: emitted.into(),
                    uses: none(),
                })
            }
            Type::PtrMut(inner, depth) | Type::PtrConst(inner, depth) => {
                let CType::Pointer { to, constant } = c else {
                    return Err(format!(
                        "a pointer in the metadata and `{}` in the header",
                        c.spelled()
                    ));
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
                    Spelled {
                        ts: "void".into(),
                        c: "void".into(),
                        uses: none(),
                    }
                } else {
                    self.spell(
                        &pointee,
                        to,
                        Use {
                            stored: true,
                            ..Use::default()
                        },
                    )?
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
                    ts: nullable(
                        format!("{wrapper}<{}>", target.ts),
                        how.optional || how.stored,
                    ),
                    c: c_spelled,
                    uses: target.uses,
                })
            }
            Type::ArrayFixed(inner, count) => {
                let CType::Array(element, _) = c else {
                    return Err("a fixed array in the metadata and not in the header".into());
                };
                let element = self.spell(
                    inner,
                    element,
                    Use {
                        stored: true,
                        ..Use::default()
                    },
                )?;
                self.brands.insert("CArray");
                Ok(Spelled {
                    ts: format!("CArray<{}, {count}>", element.ts),
                    c: format!("{}[{count}]", element.c),
                    uses: element.uses,
                })
            }
            Type::ValueName(type_name) | Type::ClassName(type_name) => {
                let name = super::read::name_of(type_name);
                self.named(&name, c, how)
            }
            Type::String
            | Type::Object
            | Type::Array(_)
            | Type::Generic(..)
            | Type::RefMut(_)
            | Type::RefConst(_) => {
                Err("a managed type, which Win32 metadata does not use for a C API".into())
            }
        }
    }

    fn named(&mut self, name: &Name, c: &CType, how: Use) -> Result<Spelled, String> {
        if name.1 == "Guid" {
            return self.guid(c, how);
        }
        let Some(info) = self.model.types.get(name) else {
            return Err(format!("`{}`, a type the metadata does not define", name.1));
        };
        match &info.kind {
            // A typedef the metadata says points at UTF-16 characters.
            Kind::Typedef {
                value: Type::PtrMut(unit, 1) | Type::PtrConst(unit, 1),
                ..
            } if **unit == Type::Char => self.utf16(&name.1, c, how),
            Kind::Typedef { .. } if matches!(name.1.as_str(), "PSTR" | "PCSTR") => {
                Ok(self.narrow(c, how))
            }
            Kind::Typedef { parent, .. } => self.typedef(name, parent.as_ref(), c, how),
            Kind::Enum { members } => self.enumeration(name, members, c),
            Kind::Struct { nested: true, .. } => Err(format!(
                "`{}`, a struct with a nested anonymous member",
                name.1
            )),
            Kind::Struct { fields, union, .. } => self.record(name, fields, *union, c, how),
            Kind::Delegate { parameters, result } => {
                self.delegate(name, parameters, result, c, how)
            }
            Kind::Interface(_) => self.interface(name, c, how),
            Kind::Other => Err(format!(
                "`{}`, a kind of type this binder does not read",
                name.1
            )),
        }
    }

    /// Resolve the first-base chain from metadata alone. Counts include methods
    /// that cannot be projected: refusing one must never renumber later slots.
    fn interface_chain(&self, name: &Name) -> Result<(Vec<Name>, u32), String> {
        let mut bases = Vec::new();
        let mut seen = BTreeSet::from([name.clone()]);
        let mut current = name;
        let mut inherited = 0_u32;
        loop {
            let Some(Kind::Interface(interface)) = self.model.types.get(current).map(|i| &i.kind)
            else {
                return Err(format!(
                    "`{}`, a base not defined as a COM interface",
                    current.1
                ));
            };
            if interface.iid.is_none() {
                return Err(format!(
                    "`{}`, a COM interface with no GuidAttribute",
                    current.1
                ));
            }
            if let Some(parent) = &interface.parent {
                if !seen.insert(parent.clone()) {
                    return Err(format!("`{}`, a cyclic COM base chain", parent.1));
                }
                bases.push(parent.clone());
                current = parent;
            } else {
                if interface.iid.as_deref() != Some("00000000-0000-0000-C000-000000000046")
                    || interface
                        .methods
                        .iter()
                        .map(|m| m.name.as_str())
                        .collect::<Vec<_>>()
                        != ["QueryInterface", "AddRef", "Release"]
                {
                    return Err(format!(
                        "`{}`, a COM base chain without IUnknown",
                        current.1
                    ));
                }
                return Ok((bases, inherited));
            }
            if let Some(Kind::Interface(parent)) = self.model.types.get(current).map(|i| &i.kind) {
                inherited = inherited
                    .checked_add(
                        u32::try_from(parent.methods.len()).map_err(|_| "too many COM methods")?,
                    )
                    .ok_or("too many COM methods")?;
            }
        }
    }

    fn interface(&mut self, name: &Name, c: &CType, how: Use) -> Result<Spelled, String> {
        let (bases, first) = self.interface_chain(name)?;
        if how.stored {
            return Err(format!(
                "`{}`, typed COM storage and out slots await an ownership contract",
                name.1
            ));
        }
        let Some(CType::Record { tag, union: false }) = self.facts.typedefs.get(&name.1) else {
            return Err(format!(
                "`{}`, no interface record declared by the headers asked",
                name.1
            ));
        };
        let expected = CType::Pointer {
            to: Box::new(CType::Record {
                tag: tag.clone(),
                union: false,
            }),
            constant: false,
        };
        if c != &expected {
            return Err(format!(
                "`{}`, an interface pointer in metadata and `{}` in the header",
                name.1,
                c.spelled()
            ));
        }
        let ts = if how.optional {
            format!("{} | null", name.1)
        } else {
            name.1.clone()
        };
        let spelled = Spelled {
            ts,
            c: expected.spelled(),
            uses: BTreeSet::from([name.clone()]),
        };
        if self.declared.contains_key(name) {
            return Ok(spelled);
        }
        // Self-referential input parameters are allowed; the metadata base
        // graph was already checked before installing this recursion guard.
        self.declared.insert(name.clone(), None);
        let result = self.declare_interface(name, tag.clone(), bases, first);
        if result.is_err() {
            self.declared.remove(name);
        }
        result?;
        Ok(spelled)
    }

    fn declare_interface(
        &mut self,
        name: &Name,
        tag: String,
        bases: Vec<Name>,
        first: u32,
    ) -> Result<(), String> {
        for base in &bases {
            let record = self
                .facts
                .typedefs
                .get(&base.1)
                .ok_or_else(|| format!("`{}`, no base interface header fact", base.1))?;
            self.interface(
                base,
                &CType::Pointer {
                    to: Box::new(record.clone()),
                    constant: false,
                },
                Use::default(),
            )?;
        }
        let Kind::Interface(interface) = &self.model.types[name].kind else {
            unreachable!()
        };
        let iid = interface.iid.clone().expect("chain checked the IID");
        let own = interface.methods.clone();
        let is_root = bases.is_empty();
        // Every inherited entry must also occupy the same slot in the derived
        // header's table. A different base with the same method count cannot
        // silently lend it the wrong inherited Methods surface.
        for base in &bases {
            let (_, base_first) = self.interface_chain(base)?;
            let Kind::Interface(parent) = &self.model.types[base].kind else {
                unreachable!()
            };
            for (index, method) in parent.methods.iter().enumerate() {
                let slot = base_first + u32::try_from(index).map_err(|_| "too many COM methods")?;
                self.method_slot(name, &method.name, slot)
                    .map_err(|why| format!("inherited `{}.{}`: {why}", base.1, method.name))?;
            }
        }
        let mut methods = Vec::new();
        for (index, method) in own.iter().enumerate() {
            let slot = first
                .checked_add(u32::try_from(index).map_err(|_| "too many COM methods")?)
                .ok_or("too many COM methods")?;
            let bound = self.map_method(name, method, slot);
            match bound {
                Ok(bound) if !is_root => methods.push(bound),
                Ok(_) => {}
                Err(why) if is_root => return Err(format!("IUnknown.{}: {why}", method.name)),
                Err(why) => {
                    self.method_refusals
                        .insert((name.0.clone(), format!("{}.{}", name.1, method.name)), why);
                }
            }
        }
        self.declared.insert(
            name.clone(),
            Some(TypeDecl::Interface {
                name: name.1.clone(),
                iid,
                tag,
                uses: bases.iter().cloned().collect(),
                bases,
                methods,
            }),
        );
        Ok(())
    }

    fn method_slot(&self, interface: &Name, method: &str, slot: u32) -> Result<(), String> {
        let key = (format!("{}Vtbl", interface.1), method.to_owned());
        let header_slot = self.facts.field_slots.get(&key).ok_or_else(|| {
            format!(
                "`{}.{}`, no vtable slot declared by the headers asked",
                key.0, key.1
            )
        })?;
        if *header_slot != slot {
            return Err(format!(
                "vtable slot {slot} in metadata and {header_slot} in the header"
            ));
        }
        Ok(())
    }

    fn map_method(
        &mut self,
        interface: &Name,
        method: &super::read::Method,
        slot: u32,
    ) -> Result<ComMethod, String> {
        self.method_slot(interface, &method.name, slot)?;
        let key = (format!("{}Vtbl", interface.1), method.name.clone());
        let Some(CType::Pointer { to, .. }) = self.facts.fields.get(&key).cloned() else {
            return Err(format!(
                "`{}.{}`, no method declared by the headers asked",
                key.0, key.1
            ));
        };
        let CType::Function {
            result,
            parameters,
            variadic,
        } = *to
        else {
            return Err("the header field is not a function pointer".into());
        };
        let Some((this, parameters)) = parameters.split_first() else {
            return Err("the header method has no This parameter".into());
        };
        let record = self
            .facts
            .typedefs
            .get(&interface.1)
            .ok_or("no interface record header fact")?;
        if *this
            != (CType::Pointer {
                to: Box::new(record.clone()),
                constant: false,
            })
        {
            return Err("its This parameter disagrees with the interface header".into());
        }
        let function = super::read::Function {
            namespace: interface.0.clone(),
            name: method.name.clone(),
            library: String::new(),
            documentation: method.documentation.clone(),
            parameters: method.parameters.clone(),
            attributes: method.attributes.clone(),
            result: method.result.clone(),
        };
        let mut signature =
            map_signature(self, &function, &result, parameters, variadic, Some(this))?;
        let hresult = is_hresult(&method.result);
        if hresult {
            signature.hresult = true;
            if signature.com_output.is_none() {
                signature.result = "void".into();
            }
        }
        // IUnknown is owned by the compiler. Do not bind, rename or project
        // its three methods as user methods (including raw void** QueryInterface).
        Ok(ComMethod { signature, slot })
    }

    fn interface_slot<'b>(&self, ty: &'b Type) -> Option<(&'b Type, usize)> {
        let (Type::PtrMut(inner, depth) | Type::PtrConst(inner, depth)) = ty else {
            return None;
        };
        let (Type::ClassName(name) | Type::ValueName(name)) = &**inner else {
            return None;
        };
        matches!(
            self.model
                .types
                .get(&super::read::name_of(name))
                .map(|info| &info.kind),
            Some(Kind::Interface(_))
        )
        .then_some((inner.as_ref(), *depth))
    }

    /// The only typed writable interface slot this slice projects. Everything
    /// else still goes through `spell()`, which refuses explicit typed storage.
    fn com_output(
        &mut self,
        function: &super::read::Function,
        parameters: &[CType],
    ) -> Result<Option<(usize, Spelled, ComOutput)>, String> {
        let slots: Vec<_> = function
            .parameters
            .iter()
            .enumerate()
            .filter_map(|(at, parameter)| {
                self.interface_slot(&parameter.ty)
                    .map(|(inner, depth)| (at, parameter, inner, depth))
            })
            .collect();
        let Some(&(at, parameter, inner, depth)) = slots.first() else {
            return Ok(None);
        };
        if slots.len() != 1 || function.parameters.iter().filter(|p| p.output).count() > 1 {
            return Err("typed COM projection requires exactly one output slot".into());
        }
        if !parameter.output {
            return Err("typed COM projection requires an output-only slot".into());
        }
        if parameter.optional {
            return Err("typed COM projection requires a required slot; optional caller storage remains refused".into());
        }
        if at + 1 != function.parameters.len() {
            return Err("typed COM projection requires the trailing parameter".into());
        }
        if parameter.constant {
            return Err("typed COM output is const in metadata".into());
        }
        if depth != 1 || !matches!(parameter.ty, Type::PtrMut(..)) {
            return Err(
                "typed COM projection requires one mutable pointer to the interface pointer".into(),
            );
        }
        // ComOutPtr is an optional extra fact. Pure COM [out] already
        // transfers +1; failed output is cleared generically before adoption.
        marker(&parameter.attributes, "ComOutPtrAttribute")?;

        for unsupported in [
            "DoNotReleaseAttribute",
            "IgnoreIfReturnAttribute",
            "NativeArrayInfoAttribute",
            "MemorySizeAttribute",
            "FreeWithAttribute",
            "RAIIFreeAttribute",
            "RetainedAttribute",
            "ReservedAttribute",
        ] {
            if parameter.attributes.contains_key(unsupported) {
                return Err(format!("typed COM output has unsupported {unsupported}"));
            }
        }
        if function
            .attributes
            .contains_key("CanReturnErrorsAsSuccessAttribute")
        {
            return Err("typed COM output has CanReturnErrorsAsSuccessAttribute".into());
        }
        if !is_hresult(&function.result) {
            return Err("typed COM projection requires an HRESULT result".into());
        }
        let retval = marker(&parameter.attributes, "RetValAttribute")?;
        let CType::Pointer {
            to,
            constant: false,
        } = &parameters[at]
        else {
            return Err("typed COM output is not writable pointer storage in the header".into());
        };
        // Nullability of the returned value is distinct from the required slot.
        // The metadata carries no non-null postcondition, so never promise one.
        let result = self
            .spell(
                inner,
                to,
                Use {
                    optional: true,
                    direct: true,
                    ..Use::default()
                },
            )
            .map_err(|why| format!("typed COM output/header: {why}"))?;
        Ok(Some((
            at,
            result,
            ComOutput {
                parameter: parameter.name.clone(),
                retval,
            },
        )))
    }

    /// `System.Guid`, which the metadata names and no `.winmd` defines:
    /// the one `Guid` of `winrt:types`, crossed by value as there, with
    /// the header's struct spelling (`struct _GUID`) as its C type.
    fn guid(&mut self, c: &CType, how: Use) -> Result<Spelled, String> {
        if !how.stored && !how.direct {
            return Err("`Guid` passed by value to or from a callback".into());
        }
        let CType::Record { tag, .. } = c else {
            return Err(format!(
                "`Guid` in the metadata and `{}` in the header",
                c.spelled()
            ));
        };
        self.brands.insert("Guid");
        let ts = if how.stored {
            "Guid".to_owned()
        } else {
            self.brands.insert("ByValue");
            "ByValue<Guid>".to_owned()
        };
        Ok(Spelled {
            ts,
            c: format!("struct {tag}"),
            uses: BTreeSet::new(),
        })
    }

    /// `PWSTR`: a lent `Utf16String` where the callee only reads it during the
    /// call, and a pointer to UTF-16 units otherwise.
    fn utf16(&mut self, simple: &str, c: &CType, how: Use) -> Result<Spelled, String> {
        let CType::Pointer {
            to,
            constant: const_in_header,
        } = c
        else {
            return Err(format!("`{simple}` is not a pointer in the header"));
        };
        if **to != CType::Scalar("unsigned short".into()) {
            return Err(format!(
                "`{simple}` does not point at 16-bit units in the header"
            ));
        }
        // The header decides `const`: the metadata writes `PWSTR` for
        // members the header declares `LPCWSTR` (`WNDCLASSEXW.lpszClassName`).
        let read_only = *const_in_header || how.constant;
        if read_only && !how.output && !how.stored && !how.atom {
            self.brands.insert("Utf16String");
            return Ok(Spelled {
                ts: nullable("Utf16String".into(), how.optional),
                c: "const uint16_t *".into(),
                uses: BTreeSet::new(),
            });
        }
        let (wrapper, c_spelled) = if *const_in_header {
            ("ConstPtr", "const uint16_t *")
        } else {
            ("Ptr", "uint16_t *")
        };
        self.brands.insert(wrapper);
        self.brands.insert("Uint16");
        Ok(Spelled {
            ts: nullable(format!("{wrapper}<Uint16>"), how.optional || how.stored),
            c: c_spelled.into(),
            uses: BTreeSet::new(),
        })
    }

    /// `PSTR`: ANSI code-page text, which a `string` has no honest crossing
    /// to, so a pointer to `char`.
    fn narrow(&mut self, c: &CType, how: Use) -> Spelled {
        let const_in_header = matches!(c, CType::Pointer { constant: true, .. });
        let (wrapper, c_spelled) = if const_in_header {
            ("ConstPtr", "const char *")
        } else {
            ("Ptr", "char *")
        };
        self.brands.insert(wrapper);
        self.brands.insert("c_char");
        Spelled {
            ts: nullable(format!("{wrapper}<c_char>"), how.optional || how.stored),
            c: c_spelled.into(),
            uses: BTreeSet::new(),
        }
    }

    /// A handle (`struct HWND__ *`, or `void *` for `HANDLE`) or a scalar
    /// typedef (`BOOL`, `WPARAM`).
    ///
    /// **A handle is a `Class`**, so that the metadata's `[AlsoUsableFor]` is
    /// the hierarchy TypeScript's own assignability checks: `HBRUSH` is
    /// `Class<"HBRUSH__", HGDIOBJ>`, and passes where `DeleteObject` takes an
    /// `HGDIOBJ`, with no cast. The C side is the header's: a struct pointer,
    /// or `void *` (`Erased`) where the header erases it.
    ///
    /// **Where the header makes the two one type, so does the binding.** The
    /// metadata says an `HINSTANCE` is usable for an `HMODULE`; mingw spells
    /// both `struct HINSTANCE__ *`, so C also takes an `HMODULE` for an
    /// `HINSTANCE`, and `wc.hInstance = GetModuleHandleW(null)` is how every
    /// Win32 program starts. Such a handle is an alias of its parent.
    fn typedef(
        &mut self,
        name: &Name,
        parent: Option<&Name>,
        c: &CType,
        how: Use,
    ) -> Result<Spelled, String> {
        let simple = name.1.as_str();
        let mut uses = BTreeSet::from([name.clone()]);
        // The parent is declared first, and only when it maps: a handle
        // whose parent does not is still a handle, with no parent.
        let mut same_in_c = false;
        let parent_ts = parent.and_then(|parent| {
            let parent_c = self.facts.typedefs.get(&parent.1)?.clone();
            self.typedef(parent, None, &parent_c, Use::default()).ok()?;
            same_in_c = parent_c == *c
                && matches!(c, CType::Pointer { to, .. } if matches!(**to, CType::Record { .. }));
            Some(parent.1.clone())
        });
        let class = |tag: &str| match &parent_ts {
            Some(parent) => format!("Class<\"{tag}\", {parent}>"),
            None => format!("Class<\"{tag}\">"),
        };
        let (ts, nullable_ok, c_spelled) = match c {
            CType::Pointer { to, .. } => match &**to {
                CType::Record { tag, .. } if same_in_c => (
                    parent_ts.clone().unwrap_or_default(),
                    true,
                    format!("struct {tag} *"),
                ),
                CType::Record { tag, .. } => {
                    self.brands.insert("Class");
                    (class(tag), true, format!("struct {tag} *"))
                }
                CType::Void => {
                    self.brands.insert("Class");
                    self.brands.insert("Erased");
                    (format!("Erased<{}>", class(simple)), true, "void *".into())
                }
                other => {
                    let pointer = CType::Pointer {
                        to: Box::new(other.clone()),
                        constant: false,
                    };
                    return Err(format!("`{simple}`, a typedef of `{}`", pointer.spelled()));
                }
            },
            CType::Scalar(scalar_name) => {
                let (brand, emitted) = scalar(scalar_name).ok_or_else(|| {
                    format!("`{scalar_name}`, a C scalar this binder does not spell")
                })?;
                (self.brand(brand).into(), false, emitted.into())
            }
            other => return Err(format!("`{simple}`, a typedef of `{}`", other.spelled())),
        };
        let own_uses: BTreeSet<Name> = parent
            .filter(|_| parent_ts.is_some())
            .cloned()
            .into_iter()
            .collect();
        uses.extend(own_uses.iter().cloned());
        self.declared.insert(
            name.clone(),
            Some(TypeDecl::Alias {
                name: simple.into(),
                ts,
                doc: Vec::new(),
                uses: own_uses,
            }),
        );
        Ok(Spelled {
            ts: nullable(simple.into(), nullable_ok && (how.optional || how.stored)),
            c: c_spelled,
            uses,
        })
    }

    /// An enum: a `const enum` of its members, crossing as the scalar the
    /// header gives it -- plainly spelled, or the one integer a tagged
    /// `enum TAG` is compatible with, which `facts` asked clang for.
    fn enumeration(
        &mut self,
        name: &Name,
        members: &[(String, Value)],
        c: &CType,
    ) -> Result<Spelled, String> {
        let simple = name.1.as_str();
        let (scalar_name, header_enum) = match c {
            CType::Scalar(scalar_name) => (scalar_name.as_str(), false),
            CType::Enum(tag) => match self.facts.enums.get(tag) {
                Some(scalar_name) => (scalar_name.as_str(), true),
                None => {
                    return Err(format!(
                        "`{simple}`, an enum the header spells `{}`",
                        c.spelled()
                    ));
                }
            },
            _ => {
                return Err(format!(
                    "`{simple}`, an enum the header spells `{}`",
                    c.spelled()
                ));
            }
        };
        let (brand, emitted) = scalar(scalar_name)
            .ok_or_else(|| format!("`{scalar_name}`, a C scalar this binder does not spell"))?;
        let brand = self.brand(brand);
        self.brands.insert("CEnum");
        let members = members
            .iter()
            .filter_map(|(member, value)| number(value).map(|v| (member.clone(), v)))
            .collect();
        // One enum spelling at any use site puts every member's value
        // under the header check; a plainer spelling elsewhere does not
        // lift it back out.
        let header_enum = header_enum
            || matches!(
                self.declared.get(name),
                Some(Some(TypeDecl::Enum {
                    header_enum: true,
                    ..
                }))
            );
        self.declared.insert(
            name.clone(),
            Some(TypeDecl::Enum {
                name: simple.into(),
                members,
                c: emitted.into(),
                header_enum,
            }),
        );
        Ok(Spelled {
            ts: format!("CEnum<{simple}, {brand}>"),
            c: emitted.into(),
            uses: BTreeSet::from([name.clone()]),
        })
    }

    fn record_layout(
        &self,
        simple: &str,
        union: bool,
    ) -> Result<(facts::RecordLayout, bool), String> {
        let layout = *self
            .facts
            .records
            .get(simple)
            .ok_or_else(|| format!("`{simple}`, no complete record layout from the headers"))?;
        let packed = !layout.natural_matches;
        if packed && (!layout.packed_matches || union) {
            let why = format!(
                "`{simple}`, header layout size {}/alignment {} is not expressible: natural ({}/{}), Packed ({}/{}){}",
                layout.size,
                layout.align,
                layout.natural_size,
                layout.natural_align,
                layout.packed_size,
                layout.packed_align,
                if union {
                    "; Packed applies to structs only"
                } else {
                    ""
                }
            );
            return Err(why);
        }
        Ok((layout, packed))
    }

    /// A struct or union, through a pointer or as a member, or by value as a
    /// function's own argument or result (`WindowFromPoint(POINT)`):
    /// `ByValue<POINT>`, whose calling convention is the backend's to follow.
    fn record(
        &mut self,
        name: &Name,
        fields: &[(String, Type)],
        union: bool,
        c: &CType,
        how: Use,
    ) -> Result<Spelled, String> {
        let simple = name.1.as_str();
        if !how.stored && !how.direct {
            return Err(format!("`{simple}` passed by value to or from a callback"));
        }
        let (layout, packed) = self.record_layout(simple, union).inspect_err(|why| {
            self.record_refusals.insert(name.clone(), why.clone());
        })?;
        // A tag the header wrote (`struct tagMSG`), or the typedef's own name
        // where the struct is anonymous: clang prints `typedef struct { ... }
        // FLASHWINFO` as `struct FLASHWINFO`, a tag no header declares, so a
        // tag equal to the typedef is spelled bare.
        let tag = match c {
            CType::Record { tag, .. } if tag != simple => Some(tag.clone()),
            _ => None,
        };
        let keyword = if union { "union" } else { "struct" };
        let c_spelled = tag
            .as_ref()
            .map_or_else(|| simple.to_owned(), |tag| format!("{keyword} {tag}"));
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
                    .ok_or_else(|| {
                        format!("`{simple}.{field}`, a field the headers did not answer for")
                    })
                    .and_then(|field_c| {
                        self.spell(
                            meta,
                            &field_c,
                            Use {
                                stored: true,
                                ..Use::default()
                            },
                        )
                        .map_err(|why| format!("`{simple}.{field}`: {why}"))
                    });
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
            let shape = self.brand(if union { "Union" } else { "Struct" });
            let body = members
                .iter()
                .map(|(field, ts, _)| format!("{field}: {ts}"))
                .collect::<Vec<_>>()
                .join("; ");
            let ts = if let Some(tag) = &tag {
                format!("{shape}<{{ {body} }}, \"{tag}\">")
            } else {
                self.brands.insert("Typedef");
                format!("Typedef<{shape}<{{ {body} }}, \"{simple}\">>")
            };
            let ts = if packed {
                self.brands.insert("Packed");
                format!("Packed<{ts}>")
            } else {
                ts
            };
            uses.extend(member_uses.iter().cloned());
            member_uses.remove(name);
            let fields = members
                .into_iter()
                .map(|(field, _, c)| (field, c))
                .collect();
            self.declared.insert(
                name.clone(),
                Some(TypeDecl::Record {
                    name: simple.into(),
                    ts,
                    c: c_spelled.clone(),
                    layout,
                    fields,
                    uses: member_uses,
                }),
            );
        }
        if how.stored {
            return Ok(Spelled {
                ts: simple.into(),
                c: c_spelled,
                uses,
            });
        }
        self.brands.insert("ByValue");
        Ok(Spelled {
            ts: format!("ByValue<{simple}>"),
            c: c_spelled,
            uses,
        })
    }

    /// A callback type: a function type alias, crossing as the C function
    /// pointer the header declares.
    fn delegate(
        &mut self,
        name: &Name,
        parameters: &[(String, Type)],
        result: &Type,
        c: &CType,
        how: Use,
    ) -> Result<Spelled, String> {
        let simple = name.1.as_str();
        let CType::Pointer { to, .. } = c else {
            return Err(format!(
                "`{simple}` is not a function pointer in the header"
            ));
        };
        let CType::Function {
            result: c_result,
            parameters: c_parameters,
            variadic: false,
        } = &**to
        else {
            return Err(format!(
                "`{simple}` is not a function pointer in the header"
            ));
        };
        if c_parameters.len() != parameters.len() {
            return Err(format!(
                "`{simple}` has {} parameters in the metadata and {} in the header",
                parameters.len(),
                c_parameters.len()
            ));
        }
        let mut uses = BTreeSet::from([name.clone()]);
        let mut list = Vec::new();
        let mut c_list = Vec::new();
        let mut atoms = Vec::new();
        let mut pages = Vec::new();
        for ((parameter, meta), c_parameter) in parameters.iter().zip(c_parameters) {
            let page = self.resources.callback_atom(name, parameter);
            if page.is_some() && !super::resource_params::utf16_type(self.model, meta) {
                return Err(format!(
                    "`{simple}.{parameter}` can be an integer resource atom (resource-params.json), but the metadata does not make it UTF-16 text"
                ));
            }
            let how = Use {
                atom: page.is_some(),
                ..Use::default()
            };
            let spelled = self.spell(meta, c_parameter, how)?;
            if let Some(page) = page {
                atoms.push(format!("`{parameter}`"));
                if !pages.contains(&page) {
                    pages.push(page);
                }
            }
            uses.extend(spelled.uses);
            list.push(format!("{}: {}", super::emit::safe(parameter), spelled.ts));
            c_list.push(spelled.c);
        }
        let returned = self.spell(result, c_result, Use::default())?;
        uses.extend(returned.uses);
        let mut own = uses.clone();
        own.remove(name);
        // Nothing in a `ConstPtr` says it may not be text, or that the
        // pointer is only lent, so the alias says both.
        let mut doc = Vec::new();
        if !atoms.is_empty() {
            doc.push(format!(
                "{}: an integer resource atom when `(pointerBits(p) >> 16n) === 0n` (`c:memory`), the atom its low 16 bits; otherwise NUL-terminated UTF-16. Borrowed for the callback's duration.",
                atoms.join(", ")
            ));
            doc.extend(pages.iter().map(|page| format!("@see {page}")));
        }
        self.declared.insert(
            name.clone(),
            Some(TypeDecl::Alias {
                name: simple.into(),
                ts: format!("({}) => {}", list.join(", "), returned.ts),
                doc,
                uses: own,
            }),
        );
        let c_spelled = format!(
            "{} (*)({})",
            returned.c,
            if c_list.is_empty() {
                "void".into()
            } else {
                c_list.join(", ")
            }
        );
        Ok(Spelled {
            ts: nullable(simple.into(), how.optional || how.stored),
            c: c_spelled,
            uses,
        })
    }

    fn constant(&mut self, constant: &super::read::Constant) -> Option<Constant> {
        match (
            constant_brand(self.model, &constant.ty),
            number(&constant.value),
        ) {
            (Some(brand), Some(value)) => {
                self.brands.insert(brand);
                Some(Constant {
                    name: constant.name.clone(),
                    value,
                    ts: brand.to_owned(),
                    header_required: false,
                    uses: BTreeSet::new(),
                })
            }
            _ => self
                .resource_constant(constant)
                .or_else(|| self.handle_constant(constant)),
        }
    }

    /// An integer with the representation of MAKEINTRESOURCE: a UTF-16
    /// pointer whose high bits are zero. No handle or function name list.
    fn resource_constant(&mut self, constant: &super::read::Constant) -> Option<Constant> {
        let value = match &constant.value {
            Value::ISize(v) => v.to_string(),
            Value::USize(v) => v.to_string(),
            Value::I8(_)
            | Value::U8(_)
            | Value::I16(_)
            | Value::U16(_)
            | Value::I32(_)
            | Value::U32(_)
            | Value::I64(_)
            | Value::U64(_) => number(&constant.value)?,
            _ => return None,
        };
        value.parse::<u16>().ok()?;
        if !super::resource_params::utf16_type(self.model, &constant.ty) {
            return None;
        }
        let Type::ValueName(name) = &constant.ty else {
            return None;
        };
        if !matches!(self.facts.typedefs.get(&name.name), Some(CType::Pointer { to, .. })
            if **to == CType::Scalar("unsigned short".into()))
        {
            return None;
        }
        self.brands.extend(["ConstPtr", "Uint16"]);
        Some(Constant {
            name: constant.name.clone(),
            ts: nullable("ConstPtr<Uint16>".into(), value == "0"),
            value,
            header_required: true,
            uses: BTreeSet::new(),
        })
    }

    /// An integer the metadata types as a native handle. Character pointers
    /// and callbacks do not have this representation: their integer atoms
    /// need a separate projection rather than becoming handles.
    fn handle_constant(&mut self, constant: &super::read::Constant) -> Option<Constant> {
        let value = match &constant.value {
            Value::ISize(v) => v.to_string(),
            Value::USize(v) => v.to_string(),
            Value::I8(_)
            | Value::U8(_)
            | Value::I16(_)
            | Value::U16(_)
            | Value::I32(_)
            | Value::U32(_)
            | Value::I64(_)
            | Value::U64(_) => number(&constant.value)?,
            _ => return None,
        };
        let (Type::ValueName(type_name) | Type::ClassName(type_name)) = &constant.ty else {
            return None;
        };
        let name = super::read::name_of(type_name);
        if !matches!(self.model.types.get(&name)?.kind, Kind::Typedef { .. }) {
            return None;
        }
        let c = self.facts.typedefs.get(&name.1)?;
        let CType::Pointer { to, .. } = c else {
            return None;
        };
        if !matches!(**to, CType::Record { .. } | CType::Void) {
            return None;
        }
        let spelled = self
            .named(
                &name,
                c,
                Use {
                    optional: value == "0",
                    ..Use::default()
                },
            )
            .ok()?;
        Some(Constant {
            name: constant.name.clone(),
            value,
            ts: spelled.ts,
            header_required: false,
            uses: spelled.uses,
        })
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
        // The exact value C holds: an f32 widened, not its shortest
        // decimal (`0.1f32` is 0.10000000149011612 as a double).
        Value::F32(v) if v.is_finite() => f64::from(*v).to_string(),
        Value::F64(v) if v.is_finite() => v.to_string(),
        Value::EnumValue(_, inner) => return number(inner),
        _ => return None,
    })
}

/// How a refused constant's metadata type is named in the refusal
/// ledger, so a reader can tell a pointer sentinel (`HWND_BROADCAST`)
/// from a float or a string without re-reading the winmd.
fn constant_type_name(meta: &Type) -> String {
    match meta {
        Type::ValueName(type_name) | Type::ClassName(type_name) => {
            format!("`{}`", type_name.name)
        }
        Type::PtrMut(..) | Type::PtrConst(..) => "a pointer".into(),
        Type::String => "a string".into(),
        Type::F32 | Type::F64 => "a float".into(),
        Type::Bool => "a boolean".into(),
        Type::I64 | Type::U64 => "a 64-bit integer".into(),
        Type::ISize | Type::USize => "a pointer-sized integer".into(),
        other => format!("{other:?}"),
    }
}

fn constant_value_kind(value: &Value) -> &'static str {
    match value {
        Value::Bool(_) => "a boolean",
        Value::U8(_)
        | Value::I8(_)
        | Value::U16(_)
        | Value::I16(_)
        | Value::U32(_)
        | Value::I32(_)
        | Value::U64(_)
        | Value::I64(_)
        | Value::USize(_)
        | Value::ISize(_) => "an integer",
        Value::F32(_) | Value::F64(_) => "a float",
        Value::Utf8(_) | Value::Utf16(_) => "a string",
        Value::TypeName(_) => "a type name",
        Value::EnumValue(..) => "an enum value",
    }
}

fn constant_brand(model: &Model, meta: &Type) -> Option<&'static str> {
    // A named scalar typedef (`HRESULT` over `i32`) brands as what it
    // is over: following the chain here keeps the constant, where
    // refusing it would lose a value the metadata states plainly.
    let mut current = meta;
    let mut visited: Vec<super::read::Name> = Vec::new();
    loop {
        match current {
            Type::ValueName(type_name) | Type::ClassName(type_name) => {
                let name = super::read::name_of(type_name);
                if visited.contains(&name) {
                    return None;
                }
                visited.push(name.clone());
                let info = model.types.get(&name)?;
                match &info.kind {
                    super::read::Kind::Typedef { value, .. } => current = value,
                    _ => return None,
                }
            }
            Type::I8 => return Some("Int8"),
            Type::U8 => return Some("Uint8"),
            Type::I16 => return Some("Int16"),
            Type::U16 => return Some("Uint16"),
            Type::I32 => return Some("c_int"),
            Type::U32 => return Some("c_uint"),
            Type::F32 => return Some("Float32"),
            Type::F64 => return Some("Float64"),
            _ => return None,
        }
    }
}

fn namespace_binding(namespace: &str) -> Binding {
    Binding {
        namespace: namespace.to_owned(),
        module: module_of(namespace),
        ..Binding::default()
    }
}

fn map_interfaces(mapper: &mut Mapper<'_>, by_namespace: &mut BTreeMap<String, Binding>) {
    let model = mapper.model;
    for (name, info) in &model.types {
        if matches!(info.kind, Kind::Interface(_)) {
            by_namespace
                .entry(name.0.clone())
                .or_insert_with(|| Binding {
                    namespace: name.0.clone(),
                    module: module_of(&name.0),
                    ..Binding::default()
                });
            let c = mapper
                .facts
                .typedefs
                .get(&name.1)
                .cloned()
                .unwrap_or(CType::Void);
            if let Err(why) = mapper.interface(
                name,
                &CType::Pointer {
                    to: Box::new(c),
                    constant: false,
                },
                Use::default(),
            ) {
                by_namespace
                    .get_mut(&name.0)
                    .expect("inserted")
                    .refused
                    .push((name.1.clone(), why));
            }
        }
    }
}

/// Every namespace's module: the ones asked for, and each one owning a type
/// they reach.
pub(crate) fn bindings(
    model: &Model,
    facts: &Facts,
    resources: &super::resource_params::Policy,
) -> Vec<Binding> {
    let mut mapper = Mapper {
        model,
        facts,
        resources,
        declared: BTreeMap::new(),
        brands: BTreeSet::new(),
        record_refusals: BTreeMap::new(),
        method_refusals: BTreeMap::new(),
    };
    let mut by_namespace: BTreeMap<String, Binding> = BTreeMap::new();
    let entry = |by: &mut BTreeMap<String, Binding>, namespace: &str| {
        by.entry(namespace.to_owned())
            .or_insert_with(|| namespace_binding(namespace));
    };
    for function in &model.functions {
        entry(&mut by_namespace, &function.namespace);
        match map_function(&mut mapper, function) {
            Ok(bound) => by_namespace
                .get_mut(&function.namespace)
                .expect("inserted")
                .functions
                .push(bound),
            Err(why) => by_namespace
                .get_mut(&function.namespace)
                .expect("inserted")
                .refused
                .push((function.name.clone(), why)),
        }
    }
    for constant in &model.constants {
        entry(&mut by_namespace, &constant.namespace);
        let binding = by_namespace.get_mut(&constant.namespace).expect("inserted");
        let bound = mapper.constant(constant);
        if let Some(bound) = bound {
            binding.constants.push(bound);
        } else {
            binding.refused.push((
                constant.name.clone(),
                format!(
                    "a constant that is not a plain integer (metadata type {}, value {})",
                    constant_type_name(&constant.ty),
                    constant_value_kind(&constant.value),
                ),
            ));
        }
    }
    map_interfaces(&mut mapper, &mut by_namespace);
    for ((namespace, name), why) in std::mem::take(&mut mapper.record_refusals)
        .into_iter()
        .chain(std::mem::take(&mut mapper.method_refusals))
    {
        entry(&mut by_namespace, &namespace);
        by_namespace
            .get_mut(&namespace)
            .expect("inserted")
            .refused
            .push((name, why));
    }
    // Each type declared where the metadata puts it.
    for (name, decl) in std::mem::take(&mut mapper.declared) {
        let Some(decl) = decl else { continue };
        entry(&mut by_namespace, &name.0);
        let binding = by_namespace.get_mut(&name.0).expect("inserted");
        if let TypeDecl::Record {
            name: record,
            c,
            fields,
            ..
        } = &decl
        {
            for (field, field_c) in fields {
                binding.field_checks.push((
                    record.clone(),
                    c.clone(),
                    field.clone(),
                    field_c.clone(),
                ));
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
    let Some(CType::Function {
        result,
        parameters,
        variadic,
    }) = mapper.facts.functions.get(&function.name).cloned()
    else {
        return Err(mapper
            .facts
            .unanswered
            .get(&function.name)
            .cloned()
            .unwrap_or_else(|| "not declared by the headers asked".into()));
    };
    let mut bound = map_signature(mapper, function, &result, &parameters, variadic, None)?;
    for (at, parameter) in function.parameters.iter().enumerate() {
        if !mapper
            .resources
            .input_atom(&function.namespace, &function.name, &parameter.name)
        {
            continue;
        }
        if !matches!(&parameters[at], CType::Pointer { to, constant: true }
            if **to == CType::Scalar("unsigned short".into()))
            || !bound.parameters[at].1.starts_with("Utf16String")
        {
            return Err(format!(
                "resource parameter `{}` is not a const UTF-16 input in the header",
                parameter.name
            ));
        }
        bound.resource_parameters.push(at);
        mapper.brands.extend(["ConstPtr", "Uint16"]);
    }
    Ok(bound)
}

fn marker(attributes: &super::read::Attributes, name: &str) -> Result<bool, String> {
    let Some(values) = attributes.get(name) else {
        return Ok(false);
    };
    if values.len() != 1 || !values[0].is_empty() {
        return Err(format!("malformed {name} marker"));
    }
    Ok(true)
}

fn is_hresult(ty: &Type) -> bool {
    matches!(ty, Type::ValueName(n) | Type::ClassName(n) if n.namespace == "Windows.Win32.Foundation" && n.name == "HRESULT")
}

fn map_signature(
    mapper: &mut Mapper,
    function: &super::read::Function,
    result: &CType,
    parameters: &[CType],
    variadic: bool,
    receiver: Option<&CType>,
) -> Result<Function, String> {
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
    let mut projected = None;
    let mut typescript = Vec::new();
    let mut c_list: Vec<_> = receiver.into_iter().map(CType::spelled).collect();
    let mut uses = BTreeSet::new();
    let mut no_escape = Vec::new();
    for (at, (parameter, c)) in function.parameters.iter().zip(parameters).enumerate() {
        // Keep the existing traversal: even a later refusal must not erase
        // independent input declarations already reached by earlier parameters.
        if mapper.interface_slot(&parameter.ty).is_some() {
            projected = mapper.com_output(function, parameters)?;
            if receiver.is_none() && projected.is_some() {
                return Err("direct-C HRESULT status C spelling awaits compiler support (recorded in com_status.rs); typed output remains refused".into());
            }
        }

        if let Some((index, result, _)) = &projected
            && at == *index
        {
            uses.extend(result.uses.clone());
            c_list.push(format!("{} *", result.c));
            continue;
        }
        let how = Use {
            optional: parameter.optional,
            constant: parameter.constant,
            output: parameter.output,
            stored: false,
            direct: true,
            // A function's own atom input keeps its text signature and gains
            // pointer overloads (`resource_parameters`).
            atom: false,
        };
        let spelled = mapper
            .spell(&parameter.ty, c, how)
            .map_err(|why| format!("parameter `{}`: {why}", parameter.name))?;
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
        .spell(
            &function.result,
            result,
            Use {
                optional: true,
                direct: true,
                ..Use::default()
            },
        )
        .map_err(|why| format!("the result: {why}"))?;
    uses.extend(returned.uses);
    let c_type = format!(
        "{} (*)({})",
        returned.c,
        if c_list.is_empty() {
            "void".into()
        } else {
            c_list.join(", ")
        }
    );
    Ok(Function {
        name: function.name.clone(),
        library: function.library.clone(),
        documentation: function.documentation.clone(),
        parameters: typescript,
        resource_parameters: Vec::new(),
        result: projected
            .as_ref()
            .map_or(returned.ts, |(_, result, _)| result.ts.clone()),
        hresult: projected.is_some(),
        com_output: projected.map(|(_, _, output)| output),
        c_type,
        no_escape,
        uses,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::number;
    use std::fmt::Write as _;
    use windows_metadata::Value;

    const VALUES: &str = "Windows.Win32.Test.Values";
    const HANDLES: &str = "Windows.Win32.Test.Handles";

    fn handle_model(value: Value, pointee: super::CType) -> (super::Model, super::Facts) {
        use super::super::read::{Constant, Kind, TypeInfo};
        use windows_metadata::{Type, TypeName};

        let model = super::Model {
            constants: vec![Constant {
                namespace: VALUES.into(),
                name: "SENTINEL".into(),
                ty: Type::ValueName(TypeName::named(HANDLES, "TestHandle")),
                value,
            }],
            types: [(
                (HANDLES.into(), "TestHandle".into()),
                TypeInfo {
                    kind: Kind::Typedef {
                        value: Type::PtrMut(Box::new(Type::Void), 1),
                        parent: None,
                    },
                },
            )]
            .into(),
            ..super::Model::default()
        };
        let facts = super::Facts {
            typedefs: [(
                "TestHandle".into(),
                super::CType::Pointer {
                    to: Box::new(pointee),
                    constant: false,
                },
            )]
            .into(),
            ..super::Facts::default()
        };
        (model, facts)
    }

    #[test]
    fn handle_sentinels_keep_exact_values_nullability_and_foreign_type_imports() {
        use std::collections::BTreeMap;

        use super::{CType, bindings};

        for pointee in [
            CType::Void,
            CType::Record {
                tag: "TestHandle__".into(),
                union: false,
            },
        ] {
            for (value, expected, ts) in [
                (Value::I32(0), "0", "TestHandle | null"),
                (Value::I32(-1), "-1", "TestHandle"),
                (
                    Value::U64(9_007_199_254_740_993),
                    "9007199254740993",
                    "TestHandle",
                ),
            ] {
                let (model, facts) = handle_model(value, pointee.clone());
                let bindings = bindings(
                    &model,
                    &facts,
                    &super::super::resource_params::Policy::default(),
                );
                let values = bindings.iter().find(|b| b.namespace == VALUES).unwrap();
                assert!(values.refused.is_empty(), "{:?}", values.refused);
                assert_eq!(values.constants.len(), 1);
                let constant = &values.constants[0];
                assert_eq!(constant.value, expected);
                assert_eq!(constant.ts, ts);
                assert!(
                    constant
                        .uses
                        .contains(&(HANDLES.into(), "TestHandle".into()))
                );
                let owners: BTreeMap<_, _> = bindings
                    .iter()
                    .flat_map(|b| {
                        b.types
                            .iter()
                            .map(|t| (t.name().to_owned(), b.namespace.clone()))
                    })
                    .collect();
                let text = super::super::emit::render(values, "test", &owners).declarations;
                assert!(text.contains(&format!(
                    "import type {{ TestHandle }} from \"c:{HANDLES}\";"
                )));
                assert!(text.contains(&format!(
                    "/** @ntsConstant {expected} */\n  export const SENTINEL: {ts};"
                )));
            }
        }
    }

    #[test]
    fn a_float_or_a_character_pointer_does_not_become_a_handle_constant() {
        use super::{CType, bindings};

        // The float differs from the valid handle sentinel only in value kind;
        // the pointer differs only in the header's pointee.
        for (value, pointee) in [
            (Value::F64(1.0), CType::Void),
            (Value::I32(1), CType::Scalar("unsigned short".into())),
        ] {
            let (model, facts) = handle_model(value, pointee);
            let bindings = bindings(
                &model,
                &facts,
                &super::super::resource_params::Policy::default(),
            );
            let values = bindings.iter().find(|b| b.namespace == VALUES).unwrap();
            assert!(values.constants.is_empty());
            assert_eq!(values.refused.len(), 1);
            assert_eq!(values.refused[0].0, "SENTINEL");
        }
    }

    #[test]
    fn an_enum_the_header_spells_with_a_tag_crosses_as_its_compatible_integer() {
        use super::super::read::{Function, Kind, Parameter, TypeInfo};
        use super::{CType, TypeDecl, bindings};
        use windows_metadata::{Type, TypeName};

        let model = |facts: super::Facts| {
            let model = super::Model {
                functions: vec![Function {
                    namespace: VALUES.into(),
                    name: "UseKind".into(),
                    library: "TEST.dll".into(),
                    parameters: vec![Parameter {
                        name: "kind".into(),
                        ty: Type::ValueName(TypeName::named(VALUES, "TestEnum")),
                        flags: windows_metadata::ParamAttributes::In,
                        optional: false,
                        constant: false,
                        output: false,
                        attributes: std::collections::BTreeMap::new(),
                    }],
                    result: Type::Void,
                    documentation: None,
                    attributes: std::collections::BTreeMap::new(),
                }],
                types: [(
                    (VALUES.into(), "TestEnum".into()),
                    TypeInfo {
                        kind: Kind::Enum {
                            members: vec![
                                ("KIND_A".into(), Value::I32(0)),
                                ("KIND_B".into(), Value::I32(1)),
                            ],
                        },
                    },
                )]
                .into(),
                ..super::Model::default()
            };
            bindings(
                &model,
                &facts,
                &super::super::resource_params::Policy::default(),
            )
        };
        let facts = |enums: std::collections::BTreeMap<String, String>| super::Facts {
            functions: [(
                "UseKind".into(),
                CType::Function {
                    result: Box::new(CType::Void),
                    parameters: vec![CType::Enum("_TestEnum".into())],
                    variadic: false,
                },
            )]
            .into(),
            enums,
            ..super::Facts::default()
        };

        // With the header's compatible integer known, the function binds and
        // the enum is declared for the member-value check.
        let bindings = model(facts([("_TestEnum".into(), "int".into())].into()));
        let values = bindings.iter().find(|b| b.namespace == VALUES).unwrap();
        assert!(values.refused.is_empty(), "{:?}", values.refused);
        assert_eq!(values.functions.len(), 1);
        assert_eq!(
            values.functions[0].parameters[0].1,
            "CEnum<TestEnum, c_int>"
        );
        assert!(matches!(
            values.types.as_slice(),
            [TypeDecl::Enum {
                header_enum: true,
                ..
            }]
        ));

        // Without it the same signature keeps the existing refusal.
        let bindings = model(facts(std::collections::BTreeMap::new()));
        let values = bindings.iter().find(|b| b.namespace == VALUES).unwrap();
        assert!(values.functions.is_empty());
        assert_eq!(values.refused.len(), 1);
        assert_eq!(
            values.refused[0].1,
            "parameter `kind`: `TestEnum`, an enum the header spells `enum _TestEnum`"
        );
    }

    #[test]
    fn a_pointer_in_the_header_is_not_enough_without_a_native_typedef() {
        let (mut model, facts) = handle_model(Value::I32(1), super::CType::Void);
        model
            .types
            .get_mut(&(HANDLES.into(), "TestHandle".into()))
            .unwrap()
            .kind = super::Kind::Other;
        let bindings = super::bindings(
            &model,
            &facts,
            &super::super::resource_params::Policy::default(),
        );
        let values = bindings.iter().find(|b| b.namespace == VALUES).unwrap();
        assert!(values.constants.is_empty());
        assert_eq!(values.refused.len(), 1);
    }

    #[expect(
        clippy::too_many_lines,
        reason = "Complete metadata fixture for one-difference controls"
    )]
    fn com_model() -> super::Model {
        use super::super::read::{Interface, Kind, Method, Parameter, TypeInfo};
        use windows_metadata::{Type, TypeName};
        let named = |ns, name| Type::ValueName(TypeName::named(ns, name));
        let parameter = |name: &str, ty, optional, constant, output| Parameter {
            name: name.into(),
            ty,
            flags: windows_metadata::ParamAttributes::In,
            optional,
            constant,
            output,
            attributes: std::collections::BTreeMap::new(),
        };
        let method = |name: &str, parameters, result| Method {
            name: name.into(),
            parameters,
            result,
            documentation: None,
            attributes: std::collections::BTreeMap::new(),
        };
        let hresult = || named("Windows.Win32.Foundation", "HRESULT");
        let guid = || Type::PtrConst(Box::new(named("System", "Guid")), 1);
        let out = || Type::PtrMut(Box::new(Type::Void), 2);
        let interface = |iid: &str, parent: Option<&str>, methods| TypeInfo {
            kind: Kind::Interface(Interface {
                iid: Some(iid.into()),
                parent: parent.map(|name| (VALUES.into(), name.into())),
                methods,
            }),
        };
        super::Model {
            types: [
                (
                    (VALUES.into(), "IUnknown".into()),
                    interface(
                        "00000000-0000-0000-C000-000000000046",
                        None,
                        vec![
                            method(
                                "QueryInterface",
                                vec![
                                    parameter("iid", guid(), false, true, false),
                                    parameter("out", out(), false, false, true),
                                ],
                                hresult(),
                            ),
                            method("AddRef", vec![], Type::U32),
                            method("Release", vec![], Type::U32),
                        ],
                    ),
                ),
                (
                    (VALUES.into(), "IBase".into()),
                    interface(
                        "00000001-0000-0000-C000-000000000046",
                        Some("IUnknown"),
                        vec![method(
                            "GetAttributesOf",
                            vec![
                                parameter("count", Type::U32, false, false, false),
                                parameter(
                                    "items",
                                    Type::PtrConst(Box::new(Type::Void), 1),
                                    true,
                                    true,
                                    false,
                                ),
                                parameter(
                                    "attributes",
                                    Type::PtrMut(Box::new(Type::U32), 1),
                                    false,
                                    false,
                                    true,
                                ),
                            ],
                            hresult(),
                        )],
                    ),
                ),
                (
                    (VALUES.into(), "IDerived".into()),
                    interface(
                        "00000002-0000-0000-C000-000000000046",
                        Some("IBase"),
                        vec![
                            method(
                                "Open",
                                vec![
                                    parameter("iid", guid(), false, true, false),
                                    parameter("out", out(), false, false, true),
                                ],
                                hresult(),
                            ),
                            method("Count", vec![], Type::U32),
                            method(
                                "TypedOut",
                                vec![parameter(
                                    "out",
                                    Type::PtrMut(
                                        Box::new(Type::ClassName(TypeName::named(VALUES, "IBase"))),
                                        1,
                                    ),
                                    false,
                                    false,
                                    true,
                                )],
                                hresult(),
                            ),
                        ],
                    ),
                ),
                (
                    ("Windows.Win32.Foundation".into(), "HRESULT".into()),
                    TypeInfo {
                        kind: Kind::Typedef {
                            value: Type::I32,
                            parent: None,
                        },
                    },
                ),
            ]
            .into(),
            ..super::Model::default()
        }
    }

    fn com_header() -> String {
        let mut header = String::from(
            "typedef int HRESULT; struct _GUID { unsigned a; unsigned short b,c; unsigned char d[8]; };\n",
        );
        for name in ["IUnknown", "IBase", "IDerived"] {
            let _ = writeln!(header, "typedef struct {name} {name};");
        }
        for name in ["IUnknown", "IBase", "IDerived"] {
            let _ = write!(
                header,
                "typedef struct {name}Vtbl {{ HRESULT (*QueryInterface)({name} *,const struct _GUID *,void **); unsigned (*AddRef)({name} *); unsigned (*Release)({name} *);"
            );
            if name != "IUnknown" {
                let _ = write!(
                    header,
                    "HRESULT (*GetAttributesOf)({name} *,unsigned,const void *,unsigned *);"
                );
            }
            if name == "IDerived" {
                header += "HRESULT (*Open)(IDerived *,const struct _GUID *,void **); unsigned (*Count)(IDerived *); HRESULT (*TypedOut)(IDerived *,IBase **);";
            }
            let _ = writeln!(
                header,
                "}} {name}Vtbl; struct {name} {{ {name}Vtbl *lpVtbl; }};"
            );
        }
        header
    }

    fn assert_com_control(bound: &mut [super::Binding], headers: &[Vec<String>], args: &[String]) {
        use super::super::{check, emit};
        use super::TypeDecl;
        let binding = bound.iter().find(|b| b.namespace == VALUES).unwrap();
        let owners = bound
            .iter()
            .flat_map(|b| {
                b.types
                    .iter()
                    .map(|d| (d.name().into(), b.namespace.clone()))
            })
            .collect();
        let text = emit::render(binding, "test", &owners).declarations;
        assert!(
            text.contains("@ntsVtable 3 GetAttributesOf\n     * @ntsHresult"),
            "{text}"
        );
        assert!(text.contains("GetAttributesOf(this: IBase, count: c_uint, items: ConstPtr<void> | null, attributes: Ptr<c_uint>): void;"));
        assert!(text.contains("@ntsVtable 4 Open\n     * @ntsHresult"));
        assert!(text.contains(
            "Open(this: IDerived, iid: ConstPtr<Guid>, out: Ptr<Ptr<void> | null>): void;"
        ));
        assert!(text.contains("@ntsVia 00000002-0000-0000-C000-000000000046 IDerived"));
        assert!(text.contains("Count(this: IDerived): c_uint;"));
        assert!(text.contains("& IBaseMethods & IBaseMembers & IUnknownMethods & IUnknownMembers"));
        assert!(!text.contains("QueryInterface("));
        // The final check independently refuses a stale/mutated
        // signature, even after facts passed during mapping.
        for decl in &mut bound
            .iter_mut()
            .find(|b| b.namespace == VALUES)
            .unwrap()
            .types
        {
            if let TypeDecl::Interface { name, methods, .. } = decl
                && name == "IBase"
            {
                methods[0].signature.c_type =
                    "int (*)(IBase *, unsigned long long, const void *, unsigned *)".into();
            }
        }
        check::against_headers(bound, headers, args).unwrap();
        let binding = bound.iter().find(|b| b.namespace == VALUES).unwrap();
        assert!(
            binding
                .refused
                .iter()
                .any(|(n, w)| n == "IBase.GetAttributesOf"
                    && w.contains("disagrees with the header"))
        );
        assert!(
            emit::render(binding, "test", &owners)
                .declarations
                .contains("Count(this: IDerived): c_uint;")
        );
    }

    /// Same borrowed-interface callback as the Windows witness: the binder
    /// must reject a bad slot/signature before a program can call it.
    #[test]
    fn com_emission_checks_metadata_slots_signatures_and_explicit_out_slots() {
        use super::super::check;
        use super::bindings;
        let dir =
            std::env::temp_dir().join(format!("nts-winmd-com-emission-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("interfaces.h");
        let headers = vec![vec![path.to_str().unwrap().to_owned()]];
        for target in ["x86_64-w64-windows-gnu", "aarch64-w64-windows-gnu"] {
            let args = vec![format!("--target={target}")];
            for change in [
                "control",
                "slot",
                "signature",
                "missing",
                "iid",
                "base",
                "cycle",
            ] {
                let mut header = com_header();
                if change == "slot" {
                    header = header.replace(
                        "HRESULT (*GetAttributesOf)(IBase",
                        "void *hidden; HRESULT (*GetAttributesOf)(IBase",
                    );
                }
                if change == "signature" {
                    header = header.replace(
                        "(IBase *,unsigned,const",
                        "(IBase *,unsigned long long,const",
                    );
                }
                if change == "missing" {
                    header = header.replace("(*GetAttributesOf)(IBase", "(*Missing)(IBase");
                }
                std::fs::write(&path, header).unwrap();
                let mut model = com_model();
                if change == "iid" {
                    let super::Kind::Interface(i) = &mut model
                        .types
                        .get_mut(&(VALUES.into(), "IBase".into()))
                        .unwrap()
                        .kind
                    else {
                        unreachable!()
                    };
                    i.iid = None;
                }
                if change == "base" {
                    let super::Kind::Interface(i) = &mut model
                        .types
                        .get_mut(&(VALUES.into(), "IDerived".into()))
                        .unwrap()
                        .kind
                    else {
                        unreachable!()
                    };
                    i.parent = Some((VALUES.into(), "IUnknown".into()));
                }
                if change == "cycle" {
                    let super::Kind::Interface(i) = &mut model
                        .types
                        .get_mut(&(VALUES.into(), "IBase".into()))
                        .unwrap()
                        .kind
                    else {
                        unreachable!()
                    };
                    i.parent = Some((VALUES.into(), "IDerived".into()));
                }
                let facts = super::ask(&model, &headers, &args).unwrap();
                let mut bound = bindings(
                    &model,
                    &facts,
                    &super::super::resource_params::Policy::default(),
                );
                check::against_headers(&mut bound, &headers, &args).unwrap();
                let binding = bound.iter().find(|b| b.namespace == VALUES).unwrap();
                let refusal = |name: &str, reason: &str| {
                    binding
                        .refused
                        .iter()
                        .any(|(n, w)| n == name && w.contains(reason))
                };
                match change {
                    "slot" => assert!(refusal("IBase.GetAttributesOf", "slot 3 in metadata and 4")),
                    "signature" => {
                        assert!(refusal("IBase.GetAttributesOf", "4 bytes in the metadata"));
                    }
                    "missing" => assert!(refusal("IBase.GetAttributesOf", "no vtable slot")),
                    "iid" => assert!(refusal("IBase", "no GuidAttribute")),
                    "base" => assert!(refusal("IDerived.Open", "slot 3 in metadata and 4")),
                    "cycle" => assert!(refusal("IDerived", "cyclic COM base chain")),
                    _ => assert_com_control(&mut bound, &headers, &args),
                }
            }
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    /// `0.1f32` is not 0.1: the declared constant is the widened
    /// double C holds, never the f32's shortest decimal.
    #[test]
    fn a_float_constant_declares_the_exact_value() {
        assert_eq!(
            number(&Value::F32(0.1)).as_deref(),
            Some("0.10000000149011612")
        );
        assert_eq!(number(&Value::F64(0.1)).as_deref(), Some("0.1"));
        assert_eq!(number(&Value::F32(f32::INFINITY)), None);
    }

    /// Each refusal changes one ownership/header fact from the successful
    /// control; optional slots and mutable typed storage remain explicit gaps.
    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "One-difference COM projection matrix"
    )]
    fn com_output_projection_requires_one_proven_trailing_owned_interface() {
        use super::super::{check, emit, read};
        use windows_metadata::{Type, TypeName, Value};
        let dir = std::env::temp_dir().join(format!("nts-winmd-owned-out-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("interfaces.h");
        let headers = vec![vec![path.to_str().unwrap().to_owned()]];
        for target in ["x86_64-w64-windows-gnu", "aarch64-w64-windows-gnu"] {
            let args = vec![format!("--target={target}")];
            for change in [
                "control",
                "without-marker",
                "retval",
                "malformed-retval",
                "malformed-owner",
                "borrowed",
                "conditional",
                "optional",
                "inout",
                "const",
                "non-hresult",
                "not-last",
                "multiple",
                "depth",
                "header",
                "iid",
                "errors-as-success",
                "array",
            ] {
                let mut model = com_model();
                let read::Kind::Interface(interface) = &mut model
                    .types
                    .get_mut(&(VALUES.into(), "IDerived".into()))
                    .unwrap()
                    .kind
                else {
                    unreachable!()
                };
                let method = &mut interface.methods[2];
                let output = &mut method.parameters[0];
                output
                    .attributes
                    .insert("ComOutPtrAttribute".into(), vec![vec![]]);
                let mut header = com_header() + "HRESULT Make(IBase **);\n";
                let expected = match change {
                    "without-marker" => {
                        output.attributes.clear();
                        "ComOutPtr"
                    }
                    "retval" => {
                        output
                            .attributes
                            .insert("RetValAttribute".into(), vec![vec![]]);
                        ""
                    }
                    "malformed-retval" => {
                        output.attributes.insert(
                            "RetValAttribute".into(),
                            vec![vec![(String::new(), Value::I32(1))]],
                        );
                        "RetValAttribute"
                    }
                    "malformed-owner" => {
                        output.attributes.insert(
                            "ComOutPtrAttribute".into(),
                            vec![vec![(String::new(), Value::I32(1))]],
                        );
                        "ComOutPtr"
                    }
                    "borrowed" => {
                        output
                            .attributes
                            .insert("DoNotReleaseAttribute".into(), vec![vec![]]);
                        "DoNotRelease"
                    }
                    "conditional" => {
                        output.attributes.insert(
                            "IgnoreIfReturnAttribute".into(),
                            vec![vec![(String::new(), Value::Utf8("S_FALSE".into()))]],
                        );
                        "IgnoreIfReturn"
                    }
                    "optional" => {
                        output.optional = true;
                        "required"
                    }
                    "inout" => {
                        output.output = false;
                        "output-only"
                    }
                    "const" => {
                        output.constant = true;
                        "const"
                    }
                    "non-hresult" => {
                        method.result = Type::U32;
                        header = header
                            .replace("HRESULT (*TypedOut)", "unsigned (*TypedOut)")
                            .replace("HRESULT Make", "unsigned Make");
                        "HRESULT"
                    }
                    "not-last" | "multiple" => {
                        method.parameters.push(read::Parameter {
                            flags: windows_metadata::ParamAttributes::In,
                            name: "other".into(),
                            ty: Type::PtrMut(Box::new(Type::U32), 1),
                            optional: false,
                            constant: false,
                            output: change == "multiple",
                            attributes: std::collections::BTreeMap::new(),
                        });
                        header = header.replace("IBase **);", "IBase **,unsigned *);");
                        if change == "multiple" {
                            "one output"
                        } else {
                            "trailing"
                        }
                    }
                    "depth" => {
                        output.ty = Type::PtrMut(
                            Box::new(Type::ClassName(TypeName::named(VALUES, "IBase"))),
                            2,
                        );
                        header = header.replace("IBase **);", "IBase ***);");
                        "pointer"
                    }
                    "header" => {
                        header = header.replace("IBase **);", "const IBase **);");
                        "header"
                    }
                    "errors-as-success" => {
                        method
                            .attributes
                            .insert("CanReturnErrorsAsSuccessAttribute".into(), vec![vec![]]);
                        "CanReturnErrorsAsSuccess"
                    }
                    "array" => {
                        output
                            .attributes
                            .insert("NativeArrayInfoAttribute".into(), vec![vec![]]);
                        "NativeArrayInfo"
                    }
                    _ => "",
                };
                model.functions.push(read::Function {
                    namespace: VALUES.into(),
                    name: "Make".into(),
                    library: "fixture.dll".into(),
                    parameters: method.parameters.clone(),
                    result: method.result.clone(),
                    documentation: None,
                    attributes: method.attributes.clone(),
                });
                if change == "iid" {
                    let read::Kind::Interface(result) = &mut model
                        .types
                        .get_mut(&(VALUES.into(), "IBase".into()))
                        .unwrap()
                        .kind
                    else {
                        unreachable!()
                    };
                    result.iid = None;
                }
                std::fs::write(&path, header).unwrap();
                let facts = super::ask(&model, &headers, &args).unwrap();
                let mut bindings = super::bindings(
                    &model,
                    &facts,
                    &super::super::resource_params::Policy::default(),
                );
                check::against_headers(&mut bindings, &headers, &args).unwrap();
                let owners = bindings
                    .iter()
                    .flat_map(|b| {
                        b.types
                            .iter()
                            .map(|t| (t.name().to_owned(), b.namespace.clone()))
                    })
                    .collect();
                let binding = bindings.iter().find(|b| b.namespace == VALUES).unwrap();
                let text = emit::render(binding, "test", &owners).declarations;
                if matches!(change, "control" | "without-marker" | "retval") {
                    assert!(
                        text.contains("TypedOut(this: IDerived): IBase | null;"),
                        "{target} {text}"
                    );
                    assert!(!text.contains("function Make("), "{text}");
                    assert!(
                        binding
                            .refused
                            .iter()
                            .any(|(name, why)| name == "Make"
                                && why.contains("direct-C HRESULT status")),
                        "{:?}",
                        binding.refused
                    );
                    assert!(text.contains(if change == "retval" {
                        "Metadata RetVal: present."
                    } else {
                        "Metadata RetVal: absent."
                    }));
                    assert!(text.contains("@ntsHresult"));
                    assert!(!text.contains("Owned<"));
                    assert!(text.contains("Open(this: IDerived, iid: ConstPtr<Guid>, out: Ptr<Ptr<void> | null>): void;"));
                } else {
                    assert!(!text.contains("TypedOut("), "{target} {change}: {text}");
                    if change != "iid" {
                        assert!(
                            binding
                                .refused
                                .iter()
                                .any(|(name, why)| name == "IDerived.TypedOut"
                                    && why.contains(expected)),
                            "{target} {change}: {:?}",
                            binding.refused
                        );
                    }
                    assert!(
                        !text.contains("function Make("),
                        "{target} {change}: {text}"
                    );
                    assert!(
                        binding.refused.iter().any(|(n, w)| n == "Make"
                            && w.contains(if change == "iid" {
                                "GuidAttribute"
                            } else {
                                expected
                            })),
                        "{target} {change}: {:?}",
                        binding.refused
                    );
                }
            }
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn layout_model(namespace: &str, union: bool) -> super::Model {
        use super::super::read::{Function, Kind, Model, Parameter, TypeInfo};
        use windows_metadata::{Type, TypeName};
        let named = |name| Type::ValueName(TypeName::named(namespace, name));
        let record = |fields, union| TypeInfo {
            kind: Kind::Struct {
                fields,
                union,
                nested: false,
            },
        };
        let function = |name: &str, ty| Function {
            namespace: namespace.into(),
            name: name.into(),
            library: "fixture.dll".into(),
            parameters: vec![Parameter {
                flags: windows_metadata::ParamAttributes::In,
                name: "value".into(),
                ty: Type::PtrMut(Box::new(ty), 1),
                optional: false,
                constant: false,
                output: false,
                attributes: std::collections::BTreeMap::new(),
            }],
            result: Type::I32,
            documentation: None,
            attributes: std::collections::BTreeMap::new(),
        };
        Model {
            functions: vec![
                function("inspect", named("packet")),
                function("inspect_envelope", named("envelope")),
            ],
            types: [
                (
                    (namespace.into(), "packet".into()),
                    record(
                        vec![("byte".into(), Type::U8), ("word".into(), Type::U32)],
                        union,
                    ),
                ),
                (
                    (namespace.into(), "envelope".into()),
                    record(
                        vec![("body".into(), named("packet")), ("tail".into(), Type::U8)],
                        false,
                    ),
                ),
            ]
            .into(),
            ..Model::default()
        }
    }

    /// Only the pragma changes. Nested fields retain their header layout;
    /// pack(2) and packed unions are refused because Packed cannot express
    /// them through the shared native record layout contract.
    #[test]
    fn header_layout_selects_packed_without_changing_an_unpacked_control() {
        use super::super::{check, emit};
        let namespace = "Windows.Win32.LayoutTest";
        let dir = std::env::temp_dir().join(format!("nts-winmd-layout-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("layout.h");
        let headers = vec![vec![path.to_str().unwrap().to_owned()]];
        for target in ["x86_64-w64-windows-gnu", "aarch64-w64-windows-gnu"] {
            for (packing, union) in [(0, false), (1, false), (2, false), (1, true)] {
                let keyword = if union { "union" } else { "struct" };
                let pragma = if packing == 0 {
                    String::new()
                } else {
                    format!("#pragma pack(push,{packing})\n")
                };
                let pop = if packing == 0 {
                    ""
                } else {
                    "#pragma pack(pop)\n"
                };
                std::fs::write(&path, format!("{pragma}typedef {keyword} tag_packet {{ unsigned char byte; unsigned word; }} packet;\n{pop}typedef struct tag_envelope {{ packet body; unsigned char tail; }} envelope;\nint inspect(packet *); int inspect_envelope(envelope *);\n")).unwrap();
                let model = layout_model(namespace, union);
                let args = vec![format!("--target={target}")];
                let facts = super::ask(&model, &headers, &args).unwrap();
                let layout = &facts.records["packet"];
                let mut bindings = super::bindings(
                    &model,
                    &facts,
                    &super::super::resource_params::Policy::default(),
                );
                check::against_headers(&mut bindings, &headers, &args).unwrap();
                let binding = &bindings[0];
                if packing == 2 || union {
                    assert!(binding.types.is_empty());
                    assert!(binding.functions.is_empty());
                    assert!(
                        binding
                            .refused
                            .iter()
                            .any(|(n, w)| n == "inspect"
                                && w.contains("`packet`, header layout size"))
                    );
                } else {
                    let text = emit::render(
                        binding,
                        "test",
                        &[
                            ("packet".into(), namespace.into()),
                            ("envelope".into(), namespace.into()),
                        ]
                        .into(),
                    )
                    .declarations;
                    let expected = "Struct<{ byte: Uint8; word: c_uint }, \"tag_packet\">";
                    let expected = if packing == 1 {
                        format!("Packed<{expected}>")
                    } else {
                        expected.into()
                    };
                    assert!(
                        text.contains(&format!("export type packet = {expected};")),
                        "{text}"
                    );
                    assert!(text.contains("export type envelope = Struct<{ body: packet; tail: Uint8 }, \"tag_envelope\">;"));
                    assert_eq!(binding.functions.len(), 2);
                    assert_eq!(
                        (layout.size, layout.align),
                        if packing == 1 { (5, 1) } else { (8, 4) }
                    );
                    assert_eq!((layout.natural_size, layout.natural_align), (8, 4));
                    assert_eq!((layout.packed_size, layout.packed_align), (5, 1));
                    assert_eq!(layout.natural_matches, packing == 0);
                }
            }
        }
        // Equal size/alignment alone does not prove layout: permuting fields
        // preserves both while changing every member's offset.
        std::fs::write(&path, "typedef struct tag_packet { unsigned word; unsigned char byte; } packet; int inspect(packet *);\n").unwrap();
        let model = layout_model(namespace, false);
        let facts = super::ask(&model, &headers, &[]).unwrap();
        let layout = &facts.records["packet"];
        assert_eq!(
            (layout.size, layout.align),
            (layout.natural_size, layout.natural_align)
        );
        assert!(!layout.natural_matches);
        let bindings = super::bindings(
            &model,
            &facts,
            &super::super::resource_params::Policy::default(),
        );
        assert!(
            bindings[0]
                .refused
                .iter()
                .any(|(name, why)| name == "packet" && why.contains("is not expressible"))
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn incomplete_or_bitfield_records_have_named_refusals_without_layout_fallback() {
        let namespace = "Windows.Win32.LayoutTest";
        let dir = std::env::temp_dir().join(format!(
            "nts-winmd-layout-incomplete-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("layout.h");
        let headers = vec![vec![path.to_str().unwrap().to_owned()]];
        for target in ["x86_64-w64-windows-gnu", "aarch64-w64-windows-gnu"] {
            for field in ["unsigned word;", "unsigned word : 3;", "unsigned word[];"] {
                std::fs::write(&path, format!("typedef struct tag_packet {{ unsigned char byte; {field} }} packet; typedef struct tag_envelope {{ packet body; unsigned char tail; }} envelope; int inspect(packet *); int inspect_envelope(envelope *);\n")).unwrap();
                let model = layout_model(namespace, false);
                let facts = super::ask(&model, &headers, &[format!("--target={target}")]).unwrap();
                let bindings = super::bindings(
                    &model,
                    &facts,
                    &super::super::resource_params::Policy::default(),
                );
                let binding = &bindings[0];
                if field == "unsigned word;" {
                    assert!(facts.records.contains_key("packet"));
                    assert!(binding.types.iter().any(|decl| decl.name() == "packet"));
                    assert_eq!(
                        binding.refused,
                        [] as [(std::string::String, std::string::String); 0]
                    );
                } else {
                    assert!(
                        !facts.records.contains_key("packet"),
                        "{target} {field}: {:?}",
                        facts.records
                    );
                    assert!(facts.unanswered.contains_key("packet"));
                    assert!(!binding.types.iter().any(|decl| decl.name() == "packet"));
                    assert!(
                        !binding
                            .functions
                            .iter()
                            .any(|function| function.name == "inspect")
                    );
                    assert!(
                        binding.refused.iter().any(|(name, why)| name == "packet"
                            && why.contains("no complete record layout")),
                        "{:?}",
                        binding.refused
                    );
                }
            }
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
