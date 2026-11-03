//! Java entry values and the existing internal word ABI.
use nts_core::hir::{Func, HirType, Program};
use nts_diagnostics::Diagnostic;
use nts_jvm_emitter::code::Code;
use nts_jvm_emitter::{Body, Kind, Pool, VType, descriptor, insn};

use crate::{JvmProgram, body, types};
use rustc_hash::{FxHashMap, FxHashSet};

pub(crate) fn unsigned32(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Int {
            bits: 32,
            signed: false
        }
    )
}

pub(crate) fn needs_bridge(func: &Func) -> bool {
    func.exported
        && (func.params.iter().any(|param| unsigned32(&param.ty)) || unsigned32(&func.return_type))
}

pub(crate) fn published(program: &Program) -> FxHashSet<&str> {
    program
        .public_api
        .iter()
        .map(|(emitted, _)| emitted.as_str())
        .chain(
            program
                .public_namespaces
                .iter()
                .flat_map(|(_, members)| members.iter().map(|(_, emitted)| emitted.as_str())),
        )
        .collect()
}

pub(crate) fn implementation_names<'a>(
    program: &'a Program,
    published: &FxHashSet<&str>,
) -> FxHashMap<&'a str, String> {
    // Public Java entries retain their authored spelling. Every other body
    // uses its program-unique source identity in the reserved member namespace.
    // Function order and unrelated insertions cannot rename an existing body.
    program
        .funcs
        .iter()
        .map(|func| {
            let name = if func.name == nts_core::hir::lower::MODULE_INIT {
                crate::generated_members::MODULE_INIT.to_owned()
            } else if (func.exported || published.contains(func.name.as_str()))
                && !needs_bridge(func)
            {
                body::method_name(&func.name)
            } else {
                crate::generated_members::body(&func.name)
            };
            (func.name.as_str(), name)
        })
        .collect()
}

pub(crate) fn implementation_name<'p>(program: &'p JvmProgram<'_>, func: &Func) -> &'p str {
    program.implementation_name(func)
}

fn signature(
    package: &str,
    program: &JvmProgram<'_>,
    func: &Func,
    internal: &str,
) -> Option<String> {
    let shape = types::Shape::packaged(program, package);
    let mut parameters: Vec<String> = descriptor::parameters(internal)?
        .into_iter()
        .map(str::to_owned)
        .collect();
    let mut at = 0;
    for param in &func.params {
        if unsigned32(&param.ty) {
            *parameters.get_mut(at)? = types::entry_descriptor(shape, &param.ty)?;
        }
        at += crate::optional::parameters(shape, &param.ty)?.len();
    }
    let result = if unsigned32(&func.return_type) {
        types::entry_descriptor(shape, &func.return_type)?
    } else {
        internal.rsplit_once(')')?.1.to_owned()
    };
    let parameters: Vec<_> = parameters.iter().map(String::as_str).collect();
    Some(descriptor::method(&parameters, &result))
}

pub(crate) fn bridge(
    package: &str,
    program: &JvmProgram<'_>,
    func: &Func,
    internal: &str,
    name: &str,
    pool: &mut Pool,
) -> Result<Option<(String, Body)>, Diagnostic> {
    if !needs_bridge(func) {
        return Ok(None);
    }
    let public = signature(package, program, func, internal)
        .ok_or_else(|| body::refuse(func, "a Java entry with an unreadable signature"))?;
    let parameters = descriptor::parameters(&public)
        .ok_or_else(|| body::refuse(func, "a Java entry with unreadable parameters"))?;
    let locals = parameters
        .iter()
        .map(|param| descriptor::verification_type(param))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| body::refuse(func, "a Java entry with unrepresentable parameters"))?;
    let slots: u16 = locals.iter().map(VType::slots).sum();
    if slots > 255 {
        return Err(body::refuse(
            func,
            "a Java entry exceeding the JVM's 255 parameter-slot limit",
        ));
    }
    let internal_parameters = descriptor::parameters(internal)
        .ok_or_else(|| body::refuse(func, "an implementation with unreadable parameters"))?;
    let mut code = Code::new(locals.clone(), slots);
    let mut at = 0;
    for ((public, internal), local) in parameters.iter().zip(internal_parameters).zip(&locals) {
        let kind = match local {
            VType::Integer => Kind::Int,
            VType::Long => Kind::Long,
            VType::Float => Kind::Float,
            VType::Double => Kind::Double,
            _ => Kind::Ref,
        };
        code.load(&func.origin, kind, at);
        if *public == "J" && internal == "I" {
            code.convert(&func.origin, insn::L2I, Kind::Long, Kind::Int);
        }
        at += local.slots();
    }
    code.invoke_static(
        &func.origin,
        pool,
        &body::program_class(package),
        name,
        internal,
    );
    if unsigned32(&func.return_type) {
        code.invoke_static(
            &func.origin,
            pool,
            "java/lang/Integer",
            "toUnsignedLong",
            "(I)J",
        );
        code.ret(&func.origin, Some(Kind::Long));
    } else {
        let result = internal.rsplit_once(')').map_or("V", |(_, result)| result);
        let kind = match result {
            "V" => None,
            "J" => Some(Kind::Long),
            "F" => Some(Kind::Float),
            "D" => Some(Kind::Double),
            "Z" | "I" | "B" | "S" | "C" => Some(Kind::Int),
            _ => Some(Kind::Ref),
        };
        code.ret(&func.origin, kind);
    }
    let rendered = code
        .finish(pool)
        .map_err(|error| body::refuse(func, &format!("a Java entry bridge: {error}")))?;
    Ok(Some((public, rendered)))
}
