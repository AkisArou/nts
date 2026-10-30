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

pub(crate) fn implementation_names(program: &Program) -> FxHashMap<&str, String> {
    // Program's method inventory: source bodies and their public/SAM
    // overloads, plus the constructor, class initializer and launcher. Layout
    // members live in other classes and therefore in other namespaces.
    let mut reserved: FxHashSet<_> = program
        .funcs
        .iter()
        .map(|func| body::method_name(&func.name))
        .chain([
            "<init>".to_owned(),
            "<clinit>".to_owned(),
            "main".to_owned(),
        ])
        .collect();
    let mut names = FxHashMap::default();
    for func in &program.funcs {
        let public = body::method_name(&func.name);
        let name = if needs_bridge(func) {
            let base = format!("{public}$nts$uint32");
            // N+1 distinct candidates against N reserved names must contain
            // a free name. Reserve it before considering the next body.
            (0..=reserved.len())
                .find_map(|suffix| {
                    let candidate = if suffix == 0 {
                        base.clone()
                    } else {
                        format!("{base}${suffix}")
                    };
                    reserved.insert(candidate.clone()).then_some(candidate)
                })
                .unwrap_or_else(|| {
                    unreachable!("N+1 method names cannot all occur in N reservations")
                })
        } else {
            public
        };
        names.insert(func.name.as_str(), name);
    }
    names
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
