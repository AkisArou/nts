//! Predeclare every callable/type/import, then emit complete bodies and validate.

use crate::{
    BoundaryType, EmitError, Emitted, FunctionExport, GlobalExport, InfiniteBound, Manifest,
    NumberBound, NumberGuard, Parameter, body, gc, helpers::Helper, refuse, types::Physical,
};
use nts_core::hir::{BinOp, Func, HirType, OpKind, ParamShape, Program, UnOp};
use nts_diagnostics::Diagnostic;
use rustc_hash::FxHashMap;
use std::collections::{BTreeMap, BTreeSet};
use wasm_encoder::{
    CodeSection, ConstExpr, EntityType, ExportKind, ExportSection, FunctionSection, GlobalSection,
    GlobalType, ImportSection, Module, NameMap, NameSection, TypeSection,
};

#[derive(Debug)]
pub(crate) struct Symbols<'a> {
    pub(crate) functions: FxHashMap<&'a str, u32>,
    pub(crate) helpers: BTreeMap<Helper, u32>,
    pub(crate) types: &'a gc::Plan,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Signature {
    params: Vec<Physical>,
    result: Option<Physical>,
}

#[derive(Debug, Default)]
struct Types {
    section: TypeSection,
    ids: FxHashMap<Signature, u32>,
    next: u32,
}

impl Types {
    fn new(plan: &gc::Plan) -> Self {
        Self {
            section: plan.encode(),
            ids: FxHashMap::default(),
            next: plan.count(),
        }
    }

    fn intern(&mut self, signature: Signature) -> u32 {
        if let Some(id) = self.ids.get(&signature) {
            return *id;
        }
        let id = self.next;
        self.next += 1;
        self.section.ty().function(
            signature.params.iter().map(|s| s.wasm()),
            signature.result.map(Physical::wasm),
        );
        self.ids.insert(signature, id);
        id
    }
}

pub(crate) fn index(i: usize) -> u32 {
    u32::try_from(i).expect("a wasm module index fits u32")
}

fn signature(func: &Func, plan: &gc::Plan) -> Result<Signature, Diagnostic> {
    let params = func
        .params
        .iter()
        .map(|p| {
            plan.value_slot(&p.ty)
                .map_err(|why| refuse(func, &p.origin, why))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let result = plan
        .slot(&func.return_type)
        .map_err(|why| refuse(func, &func.origin, why))?;
    Ok(Signature { params, result })
}

fn helper_set(program: &Program) -> BTreeSet<Helper> {
    let mut result = BTreeSet::new();
    for func in &program.funcs {
        if func.abstract_declaration {
            continue;
        }
        for block in nts_codegen_common::block_order(func) {
            for id in &func.blocks[block.0 as usize].ops {
                if let Some(helper) = helper_for(func, *id) {
                    result.insert(helper);
                }
            }
        }
    }
    result
}

fn helper_for(func: &Func, id: nts_core::hir::ValueId) -> Option<Helper> {
    match func.value(id).kind {
        OpKind::Unary { op, operand } => match op {
            UnOp::Round => Some(Helper::Round),
            UnOp::ToInt32 | UnOp::ToUint32 => {
                matches!(func.value(operand).ty, HirType::Float { .. }).then_some(Helper::ToInt32)
            }
            UnOp::Neg
            | UnOp::Not
            | UnOp::Abs
            | UnOp::Floor
            | UnOp::Ceil
            | UnOp::Trunc
            | UnOp::Sqrt
            | UnOp::Truthy => None,
        },
        OpKind::Binary { op, lhs, rhs } => match op {
            BinOp::Rem => {
                matches!(func.value(id).ty, HirType::Float { .. }).then_some(Helper::Remainder)
            }
            BinOp::BitAnd
            | BinOp::BitOr
            | BinOp::BitXor
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::UShr => (matches!(func.value(lhs).ty, HirType::Float { .. })
                || matches!(func.value(rhs).ty, HirType::Float { .. }))
            .then_some(Helper::ToInt32),
            BinOp::Add
            | BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
            | BinOp::Eq
            | BinOp::Ne
            | BinOp::Concat
            | BinOp::Min
            | BinOp::Max => None,
        },
        OpKind::NativeLoad { .. }
        | OpKind::NativeStore { .. }
        | OpKind::NativeLocal { .. }
        | OpKind::ObjcClass { .. }
        | OpKind::ObjcSelector { .. }
        | OpKind::NativeSizeOf(_)
        | OpKind::NativeMalloc { .. }
        | OpKind::NativeFree { .. }
        | OpKind::NativeIndexAddress { .. }
        | OpKind::NativeFieldAddress { .. }
        | OpKind::NativeBitLoad { .. }
        | OpKind::NativeBitStore { .. }
        | OpKind::NativeCopy { .. }
        | OpKind::NativeBridge { .. }
        | OpKind::NativeBlock { .. }
        | OpKind::DelegateInvoke { .. }
        | OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::DispatchSlot(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::ConstTemplate { .. }
        | OpKind::Erase { .. }
        | OpKind::TagOf { .. }
        | OpKind::Unerase { .. }
        | OpKind::Convert(_)
        | OpKind::Call { .. }
        | OpKind::Return(_)
        | OpKind::ArrayNew { .. }
        | OpKind::Length(_)
        | OpKind::ArrayGet { .. }
        | OpKind::Retain(_)
        | OpKind::Release(_)
        | OpKind::StringUnitAt { .. }
        | OpKind::GlobalGet(_)
        | OpKind::GlobalSet { .. }
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ObjectNew { .. }
        | OpKind::CellReady { .. }
        | OpKind::ClosureStatic
        | OpKind::InstanceOf { .. }
        | OpKind::FieldGet { .. }
        | OpKind::SharedFieldGet { .. }
        | OpKind::OpenFieldGet { .. }
        | OpKind::OpenFieldSet { .. }
        | OpKind::FieldSet { .. }
        | OpKind::Await { .. }
        | OpKind::Yield { .. }
        | OpKind::Suspend { .. }
        | OpKind::PromiseSubscribe { .. }
        | OpKind::ArraySet { .. } => None,
    }
}

pub(crate) fn emit(program: &Program) -> Result<Emitted, EmitError> {
    preflight(program)?;
    let funcs: Vec<_> = program
        .funcs
        .iter()
        .filter(|f| !f.abstract_declaration)
        .collect();
    emit_funcs(program, &funcs)
}

fn preflight(program: &Program) -> Result<(), EmitError> {
    if let Some((name, _)) = program.public_namespaces.first() {
        return Err(EmitError::UnsupportedSurface {
            name: name.clone(),
            reason: "public namespace objects are outside M1a".to_owned(),
        });
    }
    if let Some(class) = program.foreign_classes.first() {
        return Err(EmitError::UnsupportedSurface {
            name: class.name.clone(),
            reason: "foreign class registration is outside wasm".to_owned(),
        });
    }
    Ok(())
}

fn emit_funcs(program: &Program, funcs: &[&Func]) -> Result<Emitted, EmitError> {
    let plan = gc::Plan::build(program)?;
    let signatures = funcs
        .iter()
        .map(|func| signature(func, &plan))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|d| EmitError::Declined(vec![d]))?;
    let helpers = helper_set(program);
    let mut types = Types::new(&plan);
    let mut imports = ImportSection::new();
    let mut symbols = Symbols {
        functions: FxHashMap::default(),
        helpers: BTreeMap::new(),
        types: &plan,
    };
    let required_imports = scalar_imports(&helpers, &mut types, &mut imports, &mut symbols)?;
    let mut functions = FunctionSection::new();
    let mut names = NameMap::new();
    for (i, (func, sig)) in funcs.iter().zip(signatures).enumerate() {
        let id = imports.len() + index(i);
        if symbols.functions.insert(&func.name, id).is_some() {
            return Err(EmitError::InvalidWasm(format!(
                "duplicate function `{}`",
                func.name
            )));
        }
        functions.function(types.intern(sig));
        names.append(id, &func.name);
    }
    for helper in helpers.iter().filter(|h| !h.imported()) {
        let (params, result) = helper.signature();
        let id = imports.len() + functions.len();
        functions.function(types.intern(Signature {
            params: params.iter().copied().map(Physical::Scalar).collect(),
            result: Some(Physical::Scalar(result)),
        }));
        symbols.helpers.insert(*helper, id);
        names.append(id, &format!("nts.{}", helper.name()));
    }
    let globals = globals(program, &plan)?;
    let mut exports = ExportSection::new();
    let mut manifest = manifest(program, funcs, &symbols, required_imports, &mut exports)?;
    if plan.requires_gc() {
        manifest.features.push("gc".into());
    }
    let mut code = CodeSection::new();
    let mut routes = Vec::new();
    let mut origins = Vec::new();
    let mut declines = Vec::new();
    for func in funcs {
        match body::emit(func, symbols.functions[func.name.as_str()], &symbols) {
            Ok((function, route, marks)) => {
                code.function(&function);
                routes.push(route);
                origins.extend(marks);
            }
            Err(EmitError::Declined(diagnostics)) => declines.extend(diagnostics),
            Err(error) => return Err(error),
        }
    }
    if !declines.is_empty() {
        return Err(EmitError::Declined(declines));
    }
    for helper in &helpers {
        if let Some(function) = helper.body() {
            code.function(&function);
        }
    }
    let bytes = encode(
        &types.section,
        &imports,
        &functions,
        &globals,
        &exports,
        &code,
        &names,
    );
    crate::validate(&bytes)?;
    Ok(Emitted {
        bytes,
        manifest: Manifest {
            functions: routes,
            ..manifest
        },
        origins,
    })
}

fn scalar_imports(
    helpers: &BTreeSet<Helper>,
    types: &mut Types,
    imports: &mut ImportSection,
    symbols: &mut Symbols<'_>,
) -> Result<Vec<crate::Import>, EmitError> {
    let mut required_imports = Vec::new();
    for helper in helpers.iter().filter(|h| h.imported()) {
        let (params, result) = helper.signature();
        let ty = types.intern(Signature {
            params: params.iter().copied().map(Physical::Scalar).collect(),
            result: Some(Physical::Scalar(result)),
        });
        let id = imports.len();
        imports.import("nts:host/v1", helper.name(), EntityType::Function(ty));
        symbols.helpers.insert(*helper, id);
        required_imports.push(
            crate::Import::function(
                "nts:host/v1",
                helper.name(),
                &params
                    .iter()
                    .copied()
                    .map(Physical::Scalar)
                    .collect::<Vec<_>>(),
                Some(Physical::Scalar(result)),
            )
            .map_err(EmitError::InvalidWasm)?,
        );
    }
    Ok(required_imports)
}

fn encode(
    types: &TypeSection,
    imports: &ImportSection,
    functions: &FunctionSection,
    globals: &GlobalSection,
    exports: &ExportSection,
    code: &CodeSection,
    names: &NameMap,
) -> Vec<u8> {
    let mut module = Module::new();
    module.section(types);
    if !imports.is_empty() {
        module.section(imports);
    }
    module.section(functions);
    module.section(globals);
    module.section(exports);
    module.section(code);
    let mut name_section = NameSection::new();
    name_section.functions(names);
    module.section(&name_section);
    module.finish()
}

fn globals(program: &Program, plan: &gc::Plan) -> Result<GlobalSection, EmitError> {
    let mut section = GlobalSection::new();
    for global in &program.globals {
        let result = (|| {
            let slot = plan.value_slot(&global.ty)?;
            let initial = match slot {
                Physical::Scalar(_) => initial(global.initial, &global.ty)?,
                Physical::Reference(reference) => ConstExpr::ref_null(reference.heap_type),
            };
            section.global(
                GlobalType {
                    val_type: slot.wasm(),
                    mutable: true,
                    shared: false,
                },
                &initial,
            );
            Ok::<_, String>(())
        })();
        if let Err(why) = result {
            return Err(EmitError::Declined(vec![Diagnostic::error(
                "NTS5001",
                format!("wasm declines global `{}`: {why}", global.name),
                global.origin.location,
            )]));
        }
    }
    Ok(section)
}

#[allow(
    clippy::float_cmp,
    reason = "a boolean initial value is exactly zero or one"
)]
fn initial(value: f64, ty: &HirType) -> Result<ConstExpr, String> {
    match ty {
        HirType::Bool if value == 0.0 || value == 1.0 => {
            Ok(ConstExpr::i32_const(i32::from(value == 1.0)))
        }
        HirType::Bool => Err(format!("noncanonical boolean initial value {value}")),
        HirType::Float { bits: 64 } => Ok(ConstExpr::f64_const(value.into())),
        HirType::Float { bits: 32 } =>
        {
            #[allow(clippy::cast_possible_truncation, reason = "HIR selected f32 storage")]
            Ok(ConstExpr::f32_const((value as f32).into()))
        }
        HirType::Int { bits, signed } => {
            let limit = 2_f64.powi(i32::from(*bits) - i32::from(*signed));
            if !value.is_finite()
                || value.fract() != 0.0
                || (value == 0.0 && value.is_sign_negative())
                || value < if *signed { -limit } else { 0.0 }
                || value >= limit
            {
                return Err(format!("initial value {value} does not fit {ty:?}"));
            }
            #[allow(
                clippy::cast_possible_truncation,
                reason = "the integer range and integrality were checked"
            )]
            let integer = value as i128;
            if *bits <= 32 {
                let raw = u32::try_from(integer.rem_euclid(1_i128 << 32))
                    .map_err(|_| "global integer encoding")?;
                Ok(ConstExpr::i32_const(i32::from_ne_bytes(raw.to_ne_bytes())))
            } else {
                let raw = u64::try_from(integer.rem_euclid(1_i128 << 64))
                    .map_err(|_| "global integer encoding")?;
                Ok(ConstExpr::i64_const(i64::from_ne_bytes(raw.to_ne_bytes())))
            }
        }
        HirType::Void
        | HirType::Never
        | HirType::NativePointer(_)
        | HirType::BigInt
        | HirType::Erased
        | HirType::Managed(_)
        | HirType::Float { .. } => Err(format!("initial value of type {ty:?}")),
    }
}

fn manifest(
    program: &Program,
    funcs: &[&Func],
    symbols: &Symbols<'_>,
    imports: Vec<crate::Import>,
    section: &mut ExportSection,
) -> Result<Manifest, EmitError> {
    let mut exports = Vec::new();
    let mut globals = Vec::new();
    let mut names = BTreeSet::new();
    let definitions: FxHashMap<_, _> = funcs
        .iter()
        .map(|func| (func.name.as_str(), *func))
        .collect();
    let global_definitions: FxHashMap<_, _> = program
        .globals
        .iter()
        .enumerate()
        .map(|(at, global)| (global.name.as_str(), (at, global)))
        .collect();
    for (emitted, published) in &program.public_api {
        if !names.insert(published.clone()) {
            return Err(EmitError::InvalidWasm(format!(
                "duplicate published name `{published}`"
            )));
        }
        if let Some(func) = definitions.get(emitted.as_str()) {
            if func.params.iter().any(|p| p.shape != ParamShape::Ordinary) {
                return Err(EmitError::Declined(vec![refuse(
                    func,
                    &func.origin,
                    format!("optional/default/rest public boundary `{published}`"),
                )]));
            }
            section.export(
                published,
                ExportKind::Func,
                symbols.functions[emitted.as_str()],
            );
            let params = func
                .params
                .iter()
                .map(parameter)
                .collect::<Result<_, _>>()
                .map_err(|why| EmitError::Declined(vec![refuse(func, &func.origin, why)]))?;
            exports.push(FunctionExport {
                name: published.clone(),
                params,
                result: BoundaryType::from_hir(&func.return_type)
                    .map_err(|why| EmitError::Declined(vec![refuse(func, &func.origin, why)]))?,
            });
        } else if let Some((at, global)) = global_definitions.get(emitted.as_str()) {
            if global.deferred && !program.global_is_initialized(index(*at)) {
                return Err(EmitError::Declined(vec![Diagnostic::error(
                    "NTS5001",
                    format!(
                        "wasm declines `{published}`: its module initializer did not initialize the global"
                    ),
                    global.origin.location,
                )]));
            }
            section.export(published, ExportKind::Global, index(*at));
            globals.push(GlobalExport {
                name: published.clone(),
                symbol: published.clone(),
                ty: BoundaryType::from_hir(&global.ty).map_err(|why| {
                    EmitError::Declined(vec![Diagnostic::error(
                        "NTS5001",
                        format!("wasm declines public global `{published}`: {why}"),
                        global.origin.location,
                    )])
                })?,
            });
        } else {
            return Err(surface_decline(program, published));
        }
    }
    let mut init = None;
    if let Some(func) = definitions.get(nts_core::hir::lower::MODULE_INIT) {
        if !func.params.is_empty() || !matches!(func.return_type, HirType::Void) {
            return Err(EmitError::InvalidWasm(
                "module initializer has a nonvoid ABI".to_owned(),
            ));
        }
        let mut symbol = "$nts.init".to_owned();
        while names.contains(&symbol) {
            symbol.push('$');
        }
        section.export(
            &symbol,
            ExportKind::Func,
            symbols.functions[func.name.as_str()],
        );
        init = Some(symbol);
    }
    Ok(Manifest {
        abi: 2,
        host: "js".to_owned(),
        exports,
        globals,
        init,
        imports,
        builtins: Vec::new(),
        constants: Vec::new(),
        features: Vec::new(),
        functions: Vec::new(),
    })
}

fn surface_decline(program: &Program, name: &str) -> EmitError {
    let reason = program
        .uncompiled
        .iter()
        .find(|(at, _)| at == name)
        .map_or("public shape is outside M1a", |(_, reason)| reason.as_str());
    EmitError::UnsupportedSurface {
        name: name.to_owned(),
        reason: reason.to_owned(),
    }
}

fn parameter(p: &nts_core::hir::Param) -> Result<Parameter, String> {
    let ty = BoundaryType::from_hir(&p.ty)?;
    let facts = p.known;
    let guard = if matches!(ty, BoundaryType::Int { .. } | BoundaryType::Float { .. })
        && facts != nts_core::hir::facts::Facts::TOP
    {
        if facts.is_bottom() {
            return Err(format!(
                "public parameter `{}` has no possible inputs",
                p.name
            ));
        }
        Some(NumberGuard {
            minimum: bound(facts.lo),
            maximum: bound(facts.hi),
            whole: facts.whole,
            maybe_nan: facts.maybe_nan,
            maybe_negative_zero: facts.maybe_negative_zero,
        })
    } else {
        None
    };
    Ok(Parameter { ty, guard })
}

fn bound(value: f64) -> NumberBound {
    if value.is_finite() {
        NumberBound::Finite(value)
    } else if value.is_sign_negative() {
        NumberBound::Infinite(InfiniteBound::Negative)
    } else {
        NumberBound::Infinite(InfiniteBound::Positive)
    }
}
