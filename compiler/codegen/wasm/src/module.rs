//! One lowering walk requests every function, import and global by semantic
//! key; the assembler assigns indices only after lowering is complete.
//!
//! Nothing is declared in advance, so nothing the program does not use reaches
//! the module, and no index base is computed by hand. A `Func` or `Global`
//! symbol exists only because the `Builder` interned it, and the assembler
//! refuses a raw index-bearing instruction, so an index nothing requested
//! cannot be encoded.

use crate::{
    BoundaryType, EmitError, Emitted, FunctionExport, GlobalExport, InfiniteBound,
    InstructionOrigin, Manifest, NumberBound, NumberGuard, Parameter, body, demand, error::Failure,
    gc, ir, refuse, types::Physical,
};
use nts_core::hir::{Func as HirFunc, HirType, ParamShape, Program, ValueId};
use nts_diagnostics::Diagnostic;
use rustc_hash::FxHashMap;
use std::collections::{BTreeMap, BTreeSet};
use wasm_encoder::{
    CodeSection, ConstExpr, ElementSection, Elements, EntityType, ExportKind, ExportSection,
    FunctionSection, GlobalSection, GlobalType, ImportSection, Instruction as I, Module, NameMap,
    NameSection, TypeSection, ValType,
};

/// A function the builder interned; its index is assigned at assembly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Func(u32);

/// A global the builder interned; its index is assigned at assembly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Global(u32);

/// Every function the module can contain, named by what it means.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum FuncKey {
    Program(String),
    Numeric(crate::helpers::Helper),
    String(crate::strings::Helper),
    Erased(crate::erased::Helper),
    Host(&'static str),
    InputDecline,
    InstanceOf,
    ArrayGrow(u32),
    ArrayCopy(u32, crate::array_copy::Helper),
    ArrayLookup(u32, crate::array_lookup::Helper),
    Thunk(crate::callables::Face, u32, u32),
    Raising(crate::raising::Helper),
    Throw(crate::raising::Throw),
}

/// Every global the module can contain, named by what it means.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum GlobalKey {
    Literal(String),
    Singleton(crate::erased::Singleton),
    Descriptor(u32),
    StaticClosure(u32),
    Raising(crate::raising::Slot),
    Program(u32),
}

#[derive(Debug)]
enum FuncKind {
    Import {
        module: &'static str,
        builtin: bool,
    },
    /// `None` while the body is being generated.
    Defined(Option<ir::Function>),
}

#[derive(Debug)]
struct FuncEntry {
    name: String,
    params: Vec<Physical>,
    result: Option<Physical>,
    ty: u32,
    kind: FuncKind,
}

#[derive(Debug)]
enum GlobalKind {
    Import { module: &'static str, field: String },
    Defined(ir::Code),
}

#[derive(Debug)]
struct GlobalEntry {
    ty: GlobalType,
    kind: GlobalKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Signature {
    params: Vec<Physical>,
    result: Option<Physical>,
}

#[derive(Debug)]
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

#[derive(Debug)]
enum Export {
    Func(Func),
    Global(Global),
}

/// Interns the module's contents during the single lowering walk.
#[derive(Debug)]
pub(crate) struct Builder<'p> {
    pub(crate) program: &'p Program,
    pub(crate) types: &'p gc::Plan,
    pub(crate) raising_results: &'p BTreeMap<String, BTreeSet<ValueId>>,
    signatures: Types,
    funcs: Vec<FuncEntry>,
    func_keys: BTreeMap<FuncKey, Func>,
    globals: Vec<GlobalEntry>,
    global_keys: BTreeMap<GlobalKey, Global>,
    /// Globals whose initializers are being built: a request for one of them
    /// is a dependency cycle, which no constant expression can express.
    building: BTreeSet<GlobalKey>,
    constants: Vec<crate::StringConstant>,
    exports: Vec<(String, Export)>,
}

pub(crate) fn index(i: usize) -> u32 {
    u32::try_from(i).expect("a wasm module index fits u32")
}

impl<'p> Builder<'p> {
    pub(crate) fn new(
        program: &'p Program,
        types: &'p gc::Plan,
        raising_results: &'p BTreeMap<String, BTreeSet<ValueId>>,
    ) -> Self {
        Self {
            program,
            types,
            raising_results,
            signatures: Types::new(types),
            funcs: Vec::new(),
            func_keys: BTreeMap::new(),
            globals: Vec::new(),
            global_keys: BTreeMap::new(),
            building: BTreeSet::new(),
            constants: Vec::new(),
            exports: Vec::new(),
        }
    }

    fn push(
        &mut self,
        key: FuncKey,
        name: String,
        params: Vec<Physical>,
        result: Option<Physical>,
        kind: FuncKind,
    ) -> Func {
        let ty = self.signatures.intern(Signature {
            params: params.clone(),
            result,
        });
        self.push_typed(key, name, ty, params, result, kind)
    }

    fn push_typed(
        &mut self,
        key: FuncKey,
        name: String,
        ty: u32,
        params: Vec<Physical>,
        result: Option<Physical>,
        kind: FuncKind,
    ) -> Func {
        let id = Func(index(self.funcs.len()));
        self.funcs.push(FuncEntry {
            name,
            params,
            result,
            ty,
            kind,
        });
        self.func_keys.insert(key, id);
        id
    }

    /// Whether lowering requested this function.
    pub(crate) fn has(&self, key: &FuncKey) -> bool {
        self.func_keys.contains_key(key)
    }

    /// An imported function, typed by its physical signature.
    pub(crate) fn import(
        &mut self,
        key: FuncKey,
        module: &'static str,
        field: &str,
        params: Vec<Physical>,
        result: Option<Physical>,
        builtin: bool,
    ) -> Func {
        if let Some(id) = self.func_keys.get(&key) {
            return *id;
        }
        self.push(
            key,
            field.into(),
            params,
            result,
            FuncKind::Import { module, builtin },
        )
    }

    /// A module-local helper. Its body is generated on the first request and
    /// may request further symbols. The key is interned before the body is
    /// generated, so a request for the helper from inside its own body
    /// resolves to itself instead of recursing.
    pub(crate) fn helper(
        &mut self,
        key: FuncKey,
        name: impl Into<String>,
        params: Vec<Physical>,
        result: Option<Physical>,
        body: impl FnOnce(&mut Self) -> Result<ir::Function, Failure>,
    ) -> Result<Func, Failure> {
        if let Some(id) = self.func_keys.get(&key) {
            return Ok(*id);
        }
        let id = self.push(key, name.into(), params, result, FuncKind::Defined(None));
        let function = body(self)?;
        self.funcs[id.0 as usize].kind = FuncKind::Defined(Some(function));
        Ok(id)
    }

    /// A module-local function whose type is a planned GC function type, such
    /// as a typed callable entry that `call_ref` must match exactly.
    pub(crate) fn helper_typed(
        &mut self,
        key: FuncKey,
        name: impl Into<String>,
        ty: u32,
        body: impl FnOnce(&mut Self) -> Result<ir::Function, Failure>,
    ) -> Result<Func, Failure> {
        if let Some(id) = self.func_keys.get(&key) {
            return Ok(*id);
        }
        let id = self.push_typed(
            key,
            name.into(),
            ty,
            Vec::new(),
            None,
            FuncKind::Defined(None),
        );
        let function = body(self)?;
        self.funcs[id.0 as usize].kind = FuncKind::Defined(Some(function));
        Ok(id)
    }

    /// Declare a program function. Bodies are lowered afterwards, so direct
    /// and mutually recursive calls all resolve to declared symbols.
    fn declare(&mut self, func: &HirFunc) -> Result<(), EmitError> {
        let key = FuncKey::Program(func.name.clone());
        if self.func_keys.contains_key(&key) {
            return Err(EmitError::InvalidWasm(format!(
                "duplicate function `{}`",
                func.name
            )));
        }
        let params = func
            .params
            .iter()
            .map(|p| {
                self.types
                    .value_slot(&p.ty)
                    .map_err(|failure| failure.at(&func.name, &p.origin))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let result = self
            .types
            .slot(&func.return_type)
            .map_err(|failure| failure.at(&func.name, &func.origin))?;
        self.push(
            key,
            func.name.clone(),
            params,
            result,
            FuncKind::Defined(None),
        );
        Ok(())
    }

    /// A program function, declared before any body is lowered.
    pub(crate) fn program_func(&self, name: &str) -> Result<Func, Failure> {
        self.func_keys
            .get(&FuncKey::Program(name.to_owned()))
            .copied()
            .ok_or_else(|| Failure::Invariant(format!("unresolved direct callee `{name}`")))
    }

    fn define(&mut self, id: Func, function: ir::Function) {
        self.funcs[id.0 as usize].kind = FuncKind::Defined(Some(function));
    }

    /// A global. Its initializer is built first, so every global it reads is
    /// interned, and therefore indexed, before it.
    pub(crate) fn global(
        &mut self,
        key: GlobalKey,
        make: impl FnOnce(&mut Self) -> Result<(GlobalType, ir::Code), Failure>,
    ) -> Result<Global, Failure> {
        if let Some(id) = self.global_keys.get(&key) {
            return Ok(*id);
        }
        if !self.building.insert(key.clone()) {
            return Err(Failure::Invariant(format!(
                "global {key:?} depends on itself"
            )));
        }
        let built = make(self);
        self.building.remove(&key);
        let (ty, init) = built?;
        let id = Global(index(self.globals.len()));
        self.globals.push(GlobalEntry {
            ty,
            kind: GlobalKind::Defined(init),
        });
        self.global_keys.insert(key, id);
        Ok(id)
    }

    /// An immutable string literal, supplied by the host at instantiation, so
    /// reading one makes no call.
    pub(crate) fn literal(&mut self, text: &str) -> Global {
        let key = GlobalKey::Literal(text.to_owned());
        if let Some(id) = self.global_keys.get(&key) {
            return *id;
        }
        let symbol = format!("s{}", self.constants.len());
        self.constants.push(crate::StringConstant {
            symbol: symbol.clone(),
            value: text.to_owned(),
        });
        let id = Global(index(self.globals.len()));
        self.globals.push(GlobalEntry {
            ty: GlobalType {
                val_type: crate::strings::STRING.wasm(),
                mutable: false,
                shared: false,
            },
            kind: GlobalKind::Import {
                module: "nts:constants",
                field: symbol,
            },
        });
        self.global_keys.insert(key, id);
        id
    }

    pub(crate) fn export_func(&mut self, name: &str, func: Func) {
        self.exports.push((name.to_owned(), Export::Func(func)));
    }

    pub(crate) fn export_global(&mut self, name: &str, global: Global) {
        self.exports.push((name.to_owned(), Export::Global(global)));
    }
}

pub(crate) fn emit(program: &Program) -> Result<Emitted, EmitError> {
    preflight(program)?;
    let demand = demand::build(program);
    let plan = gc::Plan::with_resources(program, &demand)?;
    let funcs: Vec<_> = program
        .funcs
        .iter()
        .filter(|f| !f.abstract_declaration)
        .collect();
    let mut m = Builder::new(program, &plan, &demand.raising_results);
    for func in &funcs {
        m.declare(func)?;
    }
    let mut manifest = manifest(program, &funcs, &mut m)?;
    let mut routes = Vec::new();
    let mut declines = Vec::new();
    for func in &funcs {
        match body::lower(func, &mut m) {
            Ok((function, route)) => {
                let id = m
                    .program_func(&func.name)
                    .map_err(|f| f.at(&func.name, &func.origin))?;
                m.define(id, function);
                routes.push(route);
            }
            Err(EmitError::Declined(diagnostics)) => declines.extend(diagnostics),
            Err(error) => return Err(error),
        }
    }
    if !declines.is_empty() {
        return Err(EmitError::Declined(declines));
    }
    manifest.activation =
        crate::raising::exports(&mut m).map_err(|error| EmitError::Invariant {
            function: "activation exports".into(),
            reason: error.to_string(),
        })?;
    let assembled = assemble(m)?;
    manifest.imports = assembled.imports;
    manifest.builtins = assembled.builtins;
    manifest.constants = assembled.constants;
    manifest.features = assembled.features;
    manifest.functions = routes;
    Ok(Emitted {
        bytes: assembled.bytes,
        manifest,
        origins: assembled.origins,
    })
}

fn preflight(program: &Program) -> Result<(), EmitError> {
    if let Some((_, name)) = program
        .public_api
        .iter()
        .find(|(_, name)| name.starts_with(crate::raising::PREFIX))
    {
        return Err(EmitError::UnsupportedSurface {
            name: name.clone(),
            reason: "reserved Wasm activation export prefix".into(),
        });
    }
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

/// A program global, created on its first read, write or export.
pub(crate) fn program_global(m: &mut Builder<'_>, at: u32) -> Result<Global, Failure> {
    m.global(GlobalKey::Program(at), |m| {
        let global = m
            .program
            .globals
            .get(at as usize)
            .ok_or_else(|| Failure::Invariant(format!("no program global {at}")))?;
        let slot = m.types.value_slot(&global.ty)?;
        let mut init = ir::Code::default();
        match slot {
            Physical::Scalar(_) => init.instruction(&initial(global.initial, &global.ty)?),
            Physical::Reference(_) if global.ty == HirType::Erased => {
                let undefined = crate::erased::singleton(m, crate::erased::Singleton::Undefined)?;
                init.global_get(undefined);
            }
            Physical::Reference(reference) => {
                init.instruction(&I::RefNull(reference.heap_type));
            }
        }
        Ok((
            GlobalType {
                val_type: slot.wasm(),
                mutable: true,
                shared: false,
            },
            init,
        ))
    })
}

#[allow(
    clippy::float_cmp,
    reason = "a boolean initial value is exactly zero or one"
)]
fn initial(value: f64, ty: &HirType) -> Result<I<'static>, Failure> {
    match ty {
        HirType::Bool if value == 0.0 || value == 1.0 => Ok(I::I32Const(i32::from(value == 1.0))),
        HirType::Bool => Err(format!("noncanonical boolean initial value {value}").into()),
        HirType::Float { bits: 64 } => Ok(I::F64Const(value.into())),
        HirType::Float { bits: 32 } =>
        {
            #[allow(clippy::cast_possible_truncation, reason = "HIR selected f32 storage")]
            Ok(I::F32Const((value as f32).into()))
        }
        HirType::Int { bits, signed } => {
            let limit = 2_f64.powi(i32::from(*bits) - i32::from(*signed));
            if !value.is_finite()
                || value.fract() != 0.0
                || (value == 0.0 && value.is_sign_negative())
                || value < if *signed { -limit } else { 0.0 }
                || value >= limit
            {
                return Err(format!("initial value {value} does not fit {ty:?}").into());
            }
            #[allow(
                clippy::cast_possible_truncation,
                reason = "the integer range and integrality were checked"
            )]
            let integer = value as i128;
            if *bits <= 32 {
                let raw = u32::try_from(integer.rem_euclid(1_i128 << 32))
                    .map_err(|_| Failure::Invariant("global integer encoding".into()))?;
                Ok(I::I32Const(i32::from_ne_bytes(raw.to_ne_bytes())))
            } else {
                let raw = u64::try_from(integer.rem_euclid(1_i128 << 64))
                    .map_err(|_| Failure::Invariant("global integer encoding".into()))?;
                Ok(I::I64Const(i64::from_ne_bytes(raw.to_ne_bytes())))
            }
        }
        HirType::Void
        | HirType::Never
        | HirType::NativePointer(_)
        | HirType::BigInt
        | HirType::Erased
        | HirType::Managed(_)
        | HirType::Float { .. } => Err(format!("initial value of type {ty:?}").into()),
    }
}

/// The public surface: exports, their logical boundary types and the module
/// initializer. It runs before any body is lowered, so a public-shape refusal
/// takes precedence over body refusals.
fn manifest(
    program: &Program,
    funcs: &[&HirFunc],
    m: &mut Builder<'_>,
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
            let id = m
                .program_func(emitted)
                .map_err(|failure| failure.at(&func.name, &func.origin))?;
            m.export_func(published, id);
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
            let ty = BoundaryType::from_hir(&global.ty).map_err(|why| {
                EmitError::Declined(vec![Diagnostic::error(
                    "NTS5001",
                    format!("wasm declines public global `{published}`: {why}"),
                    global.origin.location,
                )])
            })?;
            let id = program_global(m, index(*at)).map_err(|failure| {
                failure.at(&format!("global {}", global.name), &global.origin)
            })?;
            m.export_global(published, id);
            globals.push(GlobalExport {
                name: published.clone(),
                symbol: published.clone(),
                ty,
            });
        } else {
            return Err(surface_decline(program, published));
        }
    }
    let init = initializer(&definitions, &names, m)?;
    Ok(Manifest {
        abi: 2,
        host: "js".to_owned(),
        exports,
        globals,
        init,
        activation: None,
        imports: Vec::new(),
        builtins: Vec::new(),
        constants: Vec::new(),
        features: Vec::new(),
        functions: Vec::new(),
    })
}

fn initializer(
    definitions: &FxHashMap<&str, &HirFunc>,
    names: &BTreeSet<String>,
    m: &mut Builder<'_>,
) -> Result<Option<String>, EmitError> {
    let Some(func) = definitions.get(nts_core::hir::lower::MODULE_INIT) else {
        return Ok(None);
    };
    if !func.params.is_empty() || !matches!(func.return_type, HirType::Void) {
        return Err(EmitError::InvalidWasm(
            "module initializer has a nonvoid ABI".to_owned(),
        ));
    }
    let mut symbol = "$nts.init".to_owned();
    while names.contains(&symbol) {
        symbol.push('$');
    }
    let id = m
        .program_func(&func.name)
        .map_err(|failure| failure.at(&func.name, &func.origin))?;
    m.export_func(&symbol, id);
    Ok(Some(symbol))
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

struct Assembled {
    bytes: Vec<u8>,
    origins: Vec<InstructionOrigin>,
    imports: Vec<crate::Import>,
    builtins: Vec<crate::Import>,
    constants: Vec<crate::StringConstant>,
    features: Vec<String>,
}

/// Final indices: imports precede definitions in each index space.
struct Indices {
    funcs: Vec<u32>,
    globals: Vec<u32>,
}

impl Indices {
    fn new(m: &Builder<'_>) -> Self {
        let mut funcs = vec![0; m.funcs.len()];
        let imported = m
            .funcs
            .iter()
            .enumerate()
            .filter(|(_, f)| matches!(f.kind, FuncKind::Import { .. }));
        let defined = m
            .funcs
            .iter()
            .enumerate()
            .filter(|(_, f)| matches!(f.kind, FuncKind::Defined(_)));
        for (next, (at, _)) in imported.chain(defined).enumerate() {
            funcs[at] = index(next);
        }
        let mut globals = vec![0; m.globals.len()];
        let imported = m
            .globals
            .iter()
            .enumerate()
            .filter(|(_, g)| matches!(g.kind, GlobalKind::Import { .. }));
        let defined = m
            .globals
            .iter()
            .enumerate()
            .filter(|(_, g)| matches!(g.kind, GlobalKind::Defined(_)));
        for (next, (at, _)) in imported.chain(defined).enumerate() {
            globals[at] = index(next);
        }
        Self { funcs, globals }
    }

    fn resolve(&self, inst: &ir::Inst) -> Result<I<'static>, Failure> {
        Ok(match inst {
            ir::Inst::Op(i) if ir::names_an_index(i) => {
                return Err(Failure::Invariant(format!(
                    "raw index-bearing instruction {i:?} bypassed the module symbols"
                )));
            }
            ir::Inst::Op(i) => i.clone(),
            ir::Inst::Call(f) => I::Call(self.funcs[f.0 as usize]),
            ir::Inst::RefFunc(f) => I::RefFunc(self.funcs[f.0 as usize]),
            ir::Inst::GlobalGet(g) => I::GlobalGet(self.globals[g.0 as usize]),
            ir::Inst::GlobalSet(g) => I::GlobalSet(self.globals[g.0 as usize]),
        })
    }
}

fn imports(
    m: &Builder<'_>,
) -> Result<(ImportSection, Vec<crate::Import>, Vec<crate::Import>), EmitError> {
    let mut section = ImportSection::new();
    let mut records = Vec::new();
    let mut builtins = Vec::new();
    for entry in &m.funcs {
        if let FuncKind::Import { module, builtin } = &entry.kind {
            section.import(module, &entry.name, EntityType::Function(entry.ty));
            let record = crate::Import::function(module, &entry.name, &entry.params, entry.result)
                .map_err(EmitError::InvalidWasm)?;
            if *builtin {
                builtins.push(record);
            } else {
                records.push(record);
            }
        }
    }
    for entry in &m.globals {
        if let GlobalKind::Import { module, field } = &entry.kind {
            section.import(module, field, EntityType::Global(entry.ty));
            records.push(crate::Import {
                module: (*module).into(),
                name: field.clone(),
                ty: crate::ImportType::Global {
                    ty: crate::ValueType::Externref { nullable: true },
                    mutable: false,
                },
            });
        }
    }
    Ok((section, records, builtins))
}

/// Encoded defined functions, their Origins and every `ref.func` target.
struct Encoded {
    functions: FunctionSection,
    code: CodeSection,
    names: NameMap,
    bodies: Vec<String>,
    origins: Vec<InstructionOrigin>,
    declared: BTreeSet<u32>,
}

fn code(m: &Builder<'_>, at: &Indices) -> Result<Encoded, EmitError> {
    let mut out = Encoded {
        functions: FunctionSection::new(),
        code: CodeSection::new(),
        names: NameMap::new(),
        bodies: Vec::new(),
        origins: Vec::new(),
        declared: BTreeSet::new(),
    };
    let order = m
        .funcs
        .iter()
        .enumerate()
        .filter(|(_, f)| matches!(f.kind, FuncKind::Import { .. }))
        .chain(
            m.funcs
                .iter()
                .enumerate()
                .filter(|(_, f)| matches!(f.kind, FuncKind::Defined(_))),
        );
    for (position, entry) in order {
        let index = at.funcs[position];
        // An import is already named by its import entry.
        let FuncKind::Defined(body) = &entry.kind else {
            continue;
        };
        out.names.append(index, &entry.name);
        let body = body.as_ref().ok_or_else(|| EmitError::Invariant {
            function: entry.name.clone(),
            reason: "requested function has no body".into(),
        })?;
        out.functions.function(entry.ty);
        let mut encoded = wasm_encoder::Function::new_with_locals_types(body.locals.clone());
        let mut marks = body.code.marks.iter().peekable();
        for (k, inst) in body.code.insts.iter().enumerate() {
            while let Some((_, origin)) = marks.next_if(|(mark, _)| *mark == k) {
                out.origins.push(InstructionOrigin {
                    function: index,
                    offset: encoded.byte_len(),
                    origin: origin.clone(),
                });
            }
            if let ir::Inst::RefFunc(f) = inst {
                out.declared.insert(at.funcs[f.0 as usize]);
            }
            let resolved = at.resolve(inst).map_err(|error| EmitError::Invariant {
                function: entry.name.clone(),
                reason: error.to_string(),
            })?;
            encoded.instruction(&resolved);
        }
        out.code.function(&encoded);
        out.bodies.push(entry.name.clone());
    }
    Ok(out)
}

fn globals(
    m: &Builder<'_>,
    at: &Indices,
    declared: &mut BTreeSet<u32>,
) -> Result<GlobalSection, EmitError> {
    let mut section = GlobalSection::new();
    for (position, entry) in m.globals.iter().enumerate() {
        let GlobalKind::Defined(init) = &entry.kind else {
            continue;
        };
        let mut expression = Vec::with_capacity(init.insts.len());
        for inst in &init.insts {
            if let ir::Inst::RefFunc(f) = inst {
                declared.insert(at.funcs[f.0 as usize]);
            }
            expression.push(at.resolve(inst).map_err(|error| EmitError::Invariant {
                function: format!("global {}", at.globals[position]),
                reason: error.to_string(),
            })?);
        }
        section.global(entry.ty, &ConstExpr::extended(expression));
    }
    Ok(section)
}

fn assemble(m: Builder<'_>) -> Result<Assembled, EmitError> {
    let at = Indices::new(&m);
    let (import_section, imports, builtins) = imports(&m)?;
    let mut code = code(&m, &at)?;
    let global_section = globals(&m, &at, &mut code.declared)?;
    let mut exports = ExportSection::new();
    for (name, export) in &m.exports {
        match export {
            Export::Func(f) => exports.export(name, ExportKind::Func, at.funcs[f.0 as usize]),
            Export::Global(g) => exports.export(name, ExportKind::Global, at.globals[g.0 as usize]),
        };
    }
    let mut elements = ElementSection::new();
    if !code.declared.is_empty() {
        elements.declared(Elements::Functions(
            std::mem::take(&mut code.declared)
                .into_iter()
                .collect::<Vec<_>>()
                .into(),
        ));
    }
    let mut module = Module::new();
    module.section(&m.signatures.section);
    if !import_section.is_empty() {
        module.section(&import_section);
    }
    module.section(&code.functions);
    module.section(&global_section);
    module.section(&exports);
    if !elements.is_empty() {
        module.section(&elements);
    }
    module.section(&code.code);
    let mut names = NameSection::new();
    names.functions(&code.names);
    module.section(&names);
    let bytes = module.finish();
    crate::validate_named(&bytes, &code.bodies)?;
    let mut features = Vec::new();
    if m.types.requires_gc() {
        features.push("gc".into());
    }
    if m.func_keys.keys().any(|k| matches!(k, FuncKey::Thunk(..))) {
        features.push("function-references".into());
    }
    Ok(Assembled {
        bytes,
        origins: code.origins,
        imports,
        builtins,
        constants: m.constants,
        features,
    })
}

/// A non-nullable reference global type for an immutable GC constant.
pub(crate) const fn constant_type(heap: u32) -> GlobalType {
    GlobalType {
        val_type: ValType::Ref(wasm_encoder::RefType {
            nullable: false,
            heap_type: wasm_encoder::HeapType::Concrete(heap),
        }),
        mutable: false,
        shared: false,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::test_common::{F64, block, function, program, value};
    use nts_core::hir::{BinOp, ManagedType, OpKind, Terminator};

    /// Entries in the import, function, global and type sections.
    fn sections(bytes: &[u8]) -> [u32; 4] {
        let mut counts = [0; 4];
        for payload in wasmparser::Parser::new(0).parse_all(bytes) {
            match payload.unwrap() {
                wasmparser::Payload::ImportSection(s) => counts[0] = s.count(),
                wasmparser::Payload::FunctionSection(s) => counts[1] = s.count(),
                wasmparser::Payload::GlobalSection(s) => counts[2] = s.count(),
                wasmparser::Payload::TypeSection(s) => counts[3] = s.count(),
                _ => {}
            }
        }
        counts
    }

    #[test]
    fn a_raw_index_bearing_instruction_cannot_be_encoded() {
        // Fault injection: a body that names a function or global by raw
        // index bypasses the symbols. Assembly refuses it as an internal
        // error naming the function; the index is never encoded.
        for forged in [I::Call(0), I::GlobalGet(0), I::RefFunc(0)] {
            let p = program(vec![]);
            let plan = gc::Plan::build(&p).unwrap();
            let results = BTreeMap::new();
            let mut m = Builder::new(&p, &plan, &results);
            m.helper(
                FuncKey::Program("forged".into()),
                "forged",
                vec![],
                None,
                |_| {
                    let mut f = ir::Function::default();
                    f.instruction(&forged);
                    f.instruction(&I::End);
                    Ok(f)
                },
            )
            .unwrap();
            let error = assemble(m).map(|_| ()).unwrap_err();
            assert!(
                matches!(&error, EmitError::Invariant { function, .. } if function == "forged"),
                "{error}"
            );
            assert!(error.to_string().contains("bypassed the module symbols"));
            assert!(!error.to_string().contains("NTS5001"));
        }
    }

    #[test]
    fn a_scalar_program_contains_only_its_own_function() {
        let mut f = function("addHalf", &[F64], F64);
        let x = value(&mut f, OpKind::Param(0), F64);
        let half = value(&mut f, OpKind::ConstFloat(0.5), F64);
        let sum = value(
            &mut f,
            OpKind::Binary {
                op: BinOp::Add,
                lhs: x,
                rhs: half,
            },
            F64,
        );
        f.blocks
            .push(block(&[], &[x, half, sum], Terminator::Return(Some(sum))));
        let emitted = crate::emit(&program(vec![f])).unwrap();
        // No import, no global, no helper and no GC type: one function and
        // its one signature.
        assert_eq!(sections(&emitted.bytes), [0, 1, 0, 1]);
        let manifest = &emitted.manifest;
        assert!(manifest.imports.is_empty() && manifest.builtins.is_empty());
        assert!(manifest.constants.is_empty() && manifest.features.is_empty());
        assert!(manifest.activation.is_none());
    }

    #[test]
    fn a_string_program_imports_exactly_the_builtin_it_calls() {
        let string = HirType::Managed(ManagedType::String);
        let mut f = function("same", &[string.clone(), string.clone()], HirType::Bool);
        let a = value(&mut f, OpKind::Param(0), string.clone());
        let b = value(&mut f, OpKind::Param(1), string);
        let equal = value(
            &mut f,
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: a,
                rhs: b,
            },
            HirType::Bool,
        );
        f.blocks
            .push(block(&[], &[a, b, equal], Terminator::Return(Some(equal))));
        let emitted = crate::emit(&program(vec![f])).unwrap();
        let manifest = &emitted.manifest;
        let builtins: Vec<_> = manifest.builtins.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(builtins, ["equals"]);
        assert!(manifest.imports.is_empty() && manifest.constants.is_empty());
        // One builtin import, one defined function, no global, no GC type.
        assert_eq!(sections(&emitted.bytes)[..3], [1, 1, 0]);
    }
}
