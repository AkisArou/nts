//! One logical field's JVM components, shared by declarations and accesses.
//!
//! Primitive optionals keep their payload and a synthetic definedness field.
//! The flag is internal to the generated package, as are ordinary payload
//! fields: source bodies live in Program, not in the class holding the field.
use nts_core::hir::{HirType, Layout};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{hierarchy, optional, program::JvmProgram, types};
use nts_diagnostics::Diagnostic;
use nts_jvm_emitter::{Kind, Pool, VType, code::Code};
use nts_semantic_schema::Origin;

/// Physical names are allocated once, against all user fields of the owner.
/// An inherited field always asks its declaring owner for these names.
#[derive(Debug, Default)]
pub(crate) struct Names(FxHashMap<(usize, usize), String>);

impl Names {
    pub(crate) fn new(program: &JvmProgram<'_>) -> Self {
        let mut flags = FxHashMap::default();
        for (layout_at, layout) in program.layouts.iter().enumerate() {
            let inherited = hierarchy::inherited(program, layout);
            if !layout
                .fields
                .iter()
                .skip(inherited)
                .any(|field| optional::split(&field.ty))
            {
                continue;
            }
            let mut occupied: FxHashSet<_> = hierarchy::declared_names(program, layout)
                .into_iter()
                .collect();
            for (at, field) in layout.fields.iter().enumerate().skip(inherited) {
                if !optional::split(&field.ty) {
                    continue;
                }
                let mut name = format!("n$nts$defined${at}");
                while !occupied.insert(name.clone()) {
                    name.push('$');
                }
                flags.insert((layout_at, at), name);
            }
        }
        Self(flags)
    }

    pub(crate) fn flag(&self, program: &JvmProgram<'_>, owner: &Layout, at: usize) -> Option<&str> {
        self.0.get(&(program.index(owner)?, at)).map(String::as_str)
    }
}

/// The descriptor here describes the physical payload, not an optional call
/// result. Call/accessor transports remain the optional ABI's authority.
pub(crate) struct Field {
    pub(crate) owner: String,
    pub(crate) name: String,
    pub(crate) descriptor: String,
    pub(crate) ty: HirType,
    pub(crate) defined: Option<String>,
}

pub(crate) fn plan(
    program: &JvmProgram<'_>,
    package: &str,
    resolved: hierarchy::ResolvedField<'_>,
    widened: bool,
) -> Option<Field> {
    let owner = resolved.owner;
    let entry = resolved.field;
    let at = resolved.index;
    let ty = if widened {
        HirType::NUMBER
    } else {
        entry.ty.clone()
    };
    let payload = match &ty {
        HirType::PossiblyUndefined(payload) if optional::split(&ty) => {
            // A native pointer/region has no JVM optional transport even if its
            // bits could fit a primitive. Never emit a guessed field for it.
            optional::parameters(types::Shape::packaged(program, package), &ty)?;
            &**payload
        }
        _ => &ty,
    };
    Some(Field {
        owner: types::class_name(package, owner),
        name: resolved.name.to_owned(),
        descriptor: types::field_descriptor(types::Shape::packaged(program, package), payload)?,
        defined: if optional::split(&ty) {
            Some(program.field_defined_name(owner, at)?.to_owned())
        } else {
            None
        },
        ty,
    })
}

/// A field accessor has exactly the existing optional function ABI: split
/// setter parameters and a packed or caller-scratch getter result.
pub(crate) fn accessor_descriptor(
    shape: types::Shape<'_>,
    ty: &HirType,
    writes: bool,
) -> Option<String> {
    let parameters = if writes {
        optional::parameters(shape, ty)?
    } else {
        optional::scratch_element(ty)
            .map(|element| vec![format!("[{element}")])
            .unwrap_or_default()
    };
    let borrowed: Vec<_> = parameters.iter().map(String::as_str).collect();
    Some(nts_jvm_emitter::descriptor::method(
        &borrowed,
        &if writes {
            "V".to_owned()
        } else {
            types::return_descriptor(shape, ty)?
        },
    ))
}

/// A positional primitive optional accessor captures both fields before
/// returning through the same transport ordinary functions use.
pub(crate) fn accessor_body(
    shape: types::Shape<'_>,
    class: &str,
    storage: &Field,
    writes: bool,
    pool: &mut Pool,
    origin: &Origin,
) -> Result<nts_jvm_emitter::Body, Diagnostic> {
    let fail = |what: &str| Diagnostic::error("NTS4003", what, origin.location);
    let HirType::PossiblyUndefined(payload) = &storage.ty else {
        return Err(fail(
            "an optional accessor without a logical optional field",
        ));
    };
    let defined = storage
        .defined
        .as_deref()
        .ok_or_else(|| fail("an optional accessor without definedness storage"))?;
    let payload_kind =
        types::kind(payload).ok_or_else(|| fail("an optional field without a JVM kind"))?;
    let payload_vtype = types::vtype(shape, payload)
        .ok_or_else(|| fail("an optional field without a JVM verification type"))?;
    let scratch = optional::scratch_element(&storage.ty);
    let mut locals = vec![VType::Object(class.to_owned())];
    if writes {
        locals.push(payload_vtype.clone());
        locals.push(VType::Integer);
    } else if let Some(element) = scratch {
        locals.push(VType::Object(format!("[{element}")));
    }
    let parameters: u16 = locals.iter().map(VType::slots).sum();
    let payload_at = if writes { 1 } else { parameters };
    let defined_at = payload_at + payload_vtype.slots();
    if !writes {
        // Code's frame plan is explicit; stores do not extend it. Both
        // snapshot locals are assigned before the return's first branch.
        locals.push(payload_vtype);
        locals.push(VType::Integer);
    }
    let mut code = Code::new(locals, defined_at + 1);
    code.load(origin, Kind::Ref, 0);
    if writes {
        code.dup(origin);
        code.load(origin, payload_kind, payload_at);
        code.put_field(
            origin,
            pool,
            &storage.owner,
            &storage.name,
            &storage.descriptor,
        );
        code.load(origin, Kind::Int, defined_at);
        code.put_field(origin, pool, &storage.owner, defined, "Z");
        code.ret(origin, None);
    } else {
        code.dup(origin);
        code.get_field(
            origin,
            pool,
            &storage.owner,
            &storage.name,
            &storage.descriptor,
        );
        code.store(origin, payload_kind, payload_at);
        code.get_field(origin, pool, &storage.owner, defined, "Z");
        code.store(origin, Kind::Int, defined_at);
        optional::PrimitiveReturn {
            payload_type: payload,
            payload: payload_at,
            defined: defined_at,
            scratch: scratch.map(|_| 1),
        }
        .emit(&mut code, pool, origin)
        .map_err(fail)?;
    }
    code.finish(pool)
        .map_err(|error| fail(&format!("an optional field accessor: {error}")))
}
