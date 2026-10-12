//! Predeclare every callable/type/import, then emit complete bodies and validate.

use crate::{
    BoundaryType, EmitError, Emitted, FunctionExport, GlobalExport, InfiniteBound, Manifest,
    NumberBound, NumberGuard, Parameter, body, gc, helpers::Helper, refuse, requirements, strings,
    types::Physical,
};
use nts_core::hir::{Func, HirType, ParamShape, Program};
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
    pub(crate) strings: BTreeMap<strings::Helper, u32>,
    pub(crate) literals: FxHashMap<&'a str, u32>,
    pub(crate) global_base: u32,
    pub(crate) host: BTreeMap<&'static str, u32>,
    pub(crate) erased_globals: Option<crate::erased::Globals>,
    pub(crate) erased: BTreeMap<crate::erased::Helper, u32>,
    pub(crate) input_decline: Option<u32>,
    pub(crate) descriptor_base: u32,
    pub(crate) instance_of: Option<u32>,
    pub(crate) array_grow: BTreeMap<u32, u32>,
    pub(crate) thunks: BTreeMap<(u32, u32), u32>,
    pub(crate) static_closures: BTreeMap<u32, crate::callables::Static>,
}

impl<'a> Symbols<'a> {
    fn required_features(&self) -> Vec<String> {
        let mut features = Vec::new();
        if self.types.requires_gc() {
            features.push("gc".into());
        }
        if !self.thunks.is_empty() {
            features.push("function-references".into());
        }
        features
    }
    fn new(plan: &'a gc::Plan, resources: &requirements::Requirements) -> Result<Self, EmitError> {
        let descriptor_base = index(resources.literals.len())
            + if plan.erased.is_some() {
                crate::erased::SINGLETONS
            } else {
                0
            };
        let static_base = descriptor_base + index(plan.objects.descriptors.len());
        let static_closures = crate::callables::statics(resources, plan, static_base)?;
        Ok(Self {
            functions: FxHashMap::default(),
            helpers: BTreeMap::new(),
            types: plan,
            strings: BTreeMap::new(),
            literals: FxHashMap::default(),
            global_base: static_base + index(static_closures.len()),
            descriptor_base,
            instance_of: None,
            array_grow: BTreeMap::new(),
            thunks: BTreeMap::new(),
            static_closures,
            host: BTreeMap::new(),
            erased: BTreeMap::new(),
            input_decline: None,
            erased_globals: plan
                .erased
                .map(|_| crate::erased::Globals::new(index(resources.literals.len()))),
        })
    }
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

fn signature(func: &Func, plan: &gc::Plan) -> Result<Signature, EmitError> {
    let params = func
        .params
        .iter()
        .map(|p| {
            plan.value_slot(&p.ty)
                .map_err(|failure| failure.at(&func.name, &p.origin))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let result = plan
        .slot(&func.return_type)
        .map_err(|failure| failure.at(&func.name, &func.origin))?;
    Ok(Signature { params, result })
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
    let resources = requirements::build(program);
    let plan = gc::Plan::with_resources(program, &resources)?;
    let signatures = funcs
        .iter()
        .map(|func| signature(func, &plan))
        .collect::<Result<Vec<_>, _>>()?;
    let helpers = &resources.numeric;
    let mut types = Types::new(&plan);
    let mut imports = ImportSection::new();
    let mut symbols = Symbols::new(&plan, &resources)?;
    let thunks = crate::callables::plan(program, &plan, &resources)?;
    let mut required_imports = scalar_imports(helpers, &mut types, &mut imports, &mut symbols)?;
    required_imports.extend(host_imports(
        &resources,
        &mut types,
        &mut imports,
        &mut symbols,
    )?);
    let builtins = string_imports(&resources, &mut types, &mut imports, &mut symbols)?;
    let imported_functions = imports.len();
    let constants = literal_imports(
        &resources,
        &mut imports,
        &mut symbols,
        &mut required_imports,
    );
    let mut functions = FunctionSection::new();
    let mut names = NameMap::new();
    for (i, (func, sig)) in funcs.iter().zip(signatures).enumerate() {
        let id = imported_functions + index(i);
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
        let id = imported_functions + functions.len();
        functions.function(types.intern(Signature {
            params: params.iter().copied().map(Physical::Scalar).collect(),
            result: Some(Physical::Scalar(result)),
        }));
        symbols.helpers.insert(*helper, id);
        names.append(id, &format!("nts.{}", helper.name()));
    }
    declare_string_adapters(
        &resources,
        &mut types,
        &mut functions,
        &mut names,
        &mut symbols,
        imported_functions,
    );
    declare_managed_adapters(
        &resources,
        &mut types,
        &mut functions,
        &mut names,
        &mut symbols,
        imported_functions,
    );
    declare_thunks(
        &thunks,
        &mut functions,
        &mut names,
        &mut symbols,
        imported_functions,
    );
    let globals = globals(program, &symbols)?;
    let mut exports = ExportSection::new();
    let mut manifest = manifest(program, funcs, &symbols, required_imports, &mut exports)?;
    manifest.builtins = builtins;
    manifest.constants = constants;
    manifest.features = symbols.required_features();
    let bodies = bodies(funcs, &resources, &symbols, &thunks)?;
    let bytes = encode(
        &types.section,
        &imports,
        &functions,
        &globals,
        &exports,
        &bodies,
        &names,
    );
    crate::validate(&bytes)?;
    Ok(Emitted {
        bytes,
        manifest: Manifest {
            functions: bodies.routes,
            ..manifest
        },
        origins: bodies.origins,
    })
}

fn declare_thunks(
    thunks: &[crate::callables::Thunk],
    functions: &mut FunctionSection,
    names: &mut NameMap,
    symbols: &mut Symbols<'_>,
    imported_functions: u32,
) {
    for thunk in thunks {
        let id = imported_functions + functions.len();
        functions.function(thunk.signature);
        symbols.thunks.insert((thunk.physical, thunk.slot), id);
        names.append(
            id,
            &format!("closure.entry<{},{}>", thunk.physical, thunk.slot),
        );
    }
}

fn declare_managed_adapters(
    resources: &requirements::Requirements,
    types: &mut Types,
    functions: &mut FunctionSection,
    names: &mut NameMap,
    symbols: &mut Symbols<'_>,
    imported_functions: u32,
) {
    for helper in &resources.erased {
        let (params, result) = helper.signature();
        let id = imported_functions + functions.len();
        functions.function(types.intern(Signature {
            params,
            result: Some(result),
        }));
        symbols.erased.insert(*helper, id);
        names.append(id, helper.name());
    }
    if resources.instance_of {
        let id = imported_functions + functions.len();
        functions.function(types.intern(Signature {
            params: vec![
                Physical::Reference(wasm_encoder::RefType::ANYREF),
                Physical::Scalar(crate::types::Slot::I32),
            ],
            result: Some(Physical::Scalar(crate::types::Slot::I32)),
        }));
        symbols.instance_of = Some(id);
        names.append(id, crate::objects::INSTANCE);
    }
    for array in symbols
        .types
        .arrays
        .values()
        .filter(|a| resources.grow_arrays.contains(&a.ty))
    {
        let id = imported_functions + functions.len();
        functions.function(types.intern(Signature {
            params: vec![
                Physical::Reference(wasm_encoder::RefType {
                    nullable: true,
                    heap_type: wasm_encoder::HeapType::Concrete(array.wrapper),
                }),
                Physical::Scalar(crate::types::Slot::I32),
            ],
            result: None,
        }));
        symbols.array_grow.insert(array.wrapper, id);
        names.append(id, &format!("array.grow<{:?}>", array.element));
    }
}

struct Bodies {
    code: CodeSection,
    elements: wasm_encoder::ElementSection,
    routes: Vec<crate::FunctionRoute>,
    origins: Vec<crate::InstructionOrigin>,
}

fn bodies(
    funcs: &[&Func],
    resources: &requirements::Requirements,
    symbols: &Symbols<'_>,
    thunks: &[crate::callables::Thunk],
) -> Result<Bodies, EmitError> {
    let mut code = CodeSection::new();
    let mut routes = Vec::new();
    let mut origins = Vec::new();
    let mut declines = Vec::new();
    for func in funcs {
        match body::emit(func, symbols.functions[func.name.as_str()], symbols) {
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
    for helper in &resources.numeric {
        if let Some(function) = helper.body() {
            code.function(&function);
        }
    }
    for helper in resources.strings.iter().filter(|h| !h.builtin()) {
        let function = helper
            .body(symbols)
            .map_err(|error| EmitError::Invariant {
                function: helper.name().into(),
                reason: error.to_string(),
            })?
            .ok_or_else(|| EmitError::Invariant {
                function: helper.name().into(),
                reason: "missing helper body".into(),
            })?;
        code.function(&function);
    }
    for helper in &resources.erased {
        let function = helper.body(symbols).map_err(|error| EmitError::Invariant {
            function: helper.name().into(),
            reason: error.to_string(),
        })?;
        code.function(&function);
    }
    if resources.instance_of {
        let root = symbols.types.root.ok_or_else(|| EmitError::Invariant {
            function: crate::objects::INSTANCE.into(),
            reason: "missing object root".into(),
        })?;
        code.function(&crate::objects::instance_body(root));
    }
    for &wrapper in symbols.array_grow.keys() {
        let array = &symbols.types.arrays[&wrapper];
        let function =
            crate::arrays::grow_body(array, symbols).map_err(|error| EmitError::Invariant {
                function: format!("array.grow<{:?}>", array.element),
                reason: error.to_string(),
            })?;
        code.function(&function);
    }
    for thunk in thunks {
        let function =
            crate::callables::thunk_body(thunk, symbols).map_err(|error| EmitError::Invariant {
                function: format!("closure.entry<{},{}>", thunk.physical, thunk.slot),
                reason: error.to_string(),
            })?;
        code.function(&function);
    }
    Ok(Bodies {
        elements: {
            let mut section = wasm_encoder::ElementSection::new();
            if !symbols.thunks.is_empty() {
                section.declared(wasm_encoder::Elements::Functions(
                    symbols.thunks.values().copied().collect::<Vec<_>>().into(),
                ));
            }
            section
        },
        code,
        routes,
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

fn host_imports(
    resources: &requirements::Requirements,
    types: &mut Types,
    imports: &mut ImportSection,
    symbols: &mut Symbols<'_>,
) -> Result<Vec<crate::Import>, EmitError> {
    let mut records = Vec::new();
    for service in &resources.host {
        let (params, result) = service.signature();
        let id = imports.len();
        let ty = types.intern(Signature {
            params: params.clone(),
            result: Some(result),
        });
        imports.import("nts:host/v1", service.name, EntityType::Function(ty));
        symbols.host.insert(service.name, id);
        records.push(
            crate::Import::function("nts:host/v1", service.name, &params, Some(result))
                .map_err(EmitError::InvalidWasm)?,
        );
    }
    if resources.input_contract {
        let params = [strings::STRING];
        let ty = types.intern(Signature {
            params: params.to_vec(),
            result: None,
        });
        symbols.input_decline = Some(imports.len());
        imports.import(
            "nts:host/v1",
            crate::contract::IMPORT,
            EntityType::Function(ty),
        );
        records.push(
            crate::Import::function("nts:host/v1", crate::contract::IMPORT, &params, None)
                .map_err(EmitError::InvalidWasm)?,
        );
    }
    Ok(records)
}

fn string_imports(
    resources: &requirements::Requirements,
    types: &mut Types,
    imports: &mut ImportSection,
    symbols: &mut Symbols<'_>,
) -> Result<Vec<crate::Import>, EmitError> {
    let mut builtins = Vec::new();
    for helper in resources.strings.iter().filter(|h| h.builtin()) {
        let (params, result) = helper.signature();
        let ty = types.intern(Signature {
            params: params.clone(),
            result: Some(result),
        });
        let id = imports.len(); // All imports so far are functions.
        imports.import("wasm:js-string", helper.name(), EntityType::Function(ty));
        symbols.strings.insert(*helper, id);
        builtins.push(
            crate::Import::function("wasm:js-string", helper.name(), &params, Some(result))
                .map_err(EmitError::InvalidWasm)?,
        );
    }
    Ok(builtins)
}

fn literal_imports<'a>(
    resources: &'a requirements::Requirements,
    imports: &mut ImportSection,
    symbols: &mut Symbols<'a>,
    required: &mut Vec<crate::Import>,
) -> Vec<crate::StringConstant> {
    resources
        .literals
        .iter()
        .enumerate()
        .map(|(at, value)| {
            let symbol = format!("s{at}");
            imports.import(
                "nts:constants",
                &symbol,
                EntityType::Global(GlobalType {
                    val_type: strings::STRING.wasm(),
                    mutable: false,
                    shared: false,
                }),
            );
            symbols.literals.insert(value.as_str(), index(at));
            required.push(crate::Import {
                module: "nts:constants".into(),
                name: symbol.clone(),
                ty: crate::ImportType::Global {
                    ty: crate::ValueType::Externref { nullable: true },
                    mutable: false,
                },
            });
            crate::StringConstant {
                symbol,
                value: value.clone(),
            }
        })
        .collect()
}

fn declare_string_adapters(
    resources: &requirements::Requirements,
    types: &mut Types,
    functions: &mut FunctionSection,
    names: &mut NameMap,
    symbols: &mut Symbols<'_>,
    imported_functions: u32,
) {
    for helper in resources.strings.iter().filter(|h| !h.builtin()) {
        let (params, result) = helper.signature();
        let id = imported_functions + functions.len();
        functions.function(types.intern(Signature {
            params,
            result: Some(result),
        }));
        symbols.strings.insert(*helper, id);
        names.append(id, helper.name());
    }
}

fn encode(
    types: &TypeSection,
    imports: &ImportSection,
    functions: &FunctionSection,
    globals: &GlobalSection,
    exports: &ExportSection,
    bodies: &Bodies,
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
    if !bodies.elements.is_empty() {
        module.section(&bodies.elements);
    }
    module.section(&bodies.code);
    let mut name_section = NameSection::new();
    name_section.functions(names);
    module.section(&name_section);
    module.finish()
}

fn globals(program: &Program, symbols: &Symbols<'_>) -> Result<GlobalSection, EmitError> {
    let mut section = GlobalSection::new();
    if let Some(types) = symbols.types.erased {
        crate::erased::globals(types, &mut section);
    }
    crate::objects::globals(symbols.types, &mut section).map_err(|error| EmitError::Invariant {
        function: "object descriptors".into(),
        reason: error.to_string(),
    })?;
    crate::callables::globals(symbols, &mut section).map_err(|error| EmitError::Invariant {
        function: "static closures".into(),
        reason: error.to_string(),
    })?;
    for global in &program.globals {
        let result = (|| {
            let slot = symbols.types.value_slot(&global.ty)?;
            let initial = match slot {
                Physical::Scalar(_) => initial(global.initial, &global.ty)?,
                Physical::Reference(_) if global.ty == HirType::Erased => {
                    let values = symbols.erased_globals.ok_or_else(|| {
                        crate::error::Failure::Invariant("missing erased global initializer".into())
                    })?;
                    ConstExpr::global_get(values.for_tag(crate::erased::UNDEFINED)?)
                }
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
            Ok::<_, crate::error::Failure>(())
        })();
        if let Err(failure) = result {
            return Err(failure.at(&format!("global {}", global.name), &global.origin));
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
            initialized_global(program, index(*at), global, published)?;
            section.export(
                published,
                ExportKind::Global,
                symbols.global_base + index(*at),
            );
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

fn initialized_global(
    program: &Program,
    at: u32,
    global: &nts_core::hir::Global,
    published: &str,
) -> Result<(), EmitError> {
    if global.deferred && !program.global_is_initialized(at) {
        return Err(EmitError::Declined(vec![Diagnostic::error(
            "NTS5001",
            format!(
                "wasm declines `{published}`: its module initializer did not initialize the global"
            ),
            global.origin.location,
        )]));
    }
    Ok(())
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
