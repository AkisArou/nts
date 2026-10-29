//! Coupled optional values: split primitive locals and arguments, packed small
//! returns, and one typed caller scratch per full-width kind per activation.
//! A reference uses one private singleton, disjoint from Java null.
use crate::{
    body::{Emitter, Placed, refuse},
    types,
};
use nts_core::hir::possibly_undefined::{Payload, Transport};
use nts_core::hir::{Func, HirType, OpKind, ValueId};
use nts_diagnostics::Diagnostic;
use nts_jvm_emitter::{Compare, Kind, Pool, VType, code::Code, insn};
use nts_semantic_schema::Origin;
use rustc_hash::FxHashMap;

const UNDEFINED: &str = "nts/rt/NtsUndefinedReference";

pub(crate) fn reference(payload: &HirType) -> bool {
    matches!(payload, HirType::BigInt)
        || matches!(payload,HirType::Managed(kind) if !matches!(kind,nts_core::hir::ManagedType::Region))
}
pub(crate) fn split(ty: &HirType) -> bool {
    matches!(ty, HirType::PossiblyUndefined(payload) if !reference(payload))
}
fn transport(payload: &HirType) -> Option<Transport> {
    let transport = Payload::new(payload.clone()).ok()?.jvm_return_transport();
    (transport != Transport::Unsupported).then_some(transport)
}
pub(crate) fn returns(payload: &HirType) -> Option<String> {
    Some(
        match transport(payload)? {
            Transport::ReferenceNiche => "Ljava/lang/Object;",
            Transport::PackedWord { bits: 32 } => "I",
            Transport::PackedWord { .. } => "J",
            Transport::CallerScratch => "Z",
            _ => return None,
        }
        .to_owned(),
    )
}
pub(crate) fn parameters(shape: types::Shape<'_>, ty: &HirType) -> Option<Vec<String>> {
    let HirType::PossiblyUndefined(payload) = ty else {
        return Some(vec![types::descriptor(shape, ty)?]);
    };
    transport(payload)?;
    if reference(payload) {
        Some(vec!["Ljava/lang/Object;".to_owned()])
    } else {
        Some(vec![types::descriptor(shape, payload)?, "Z".to_owned()])
    }
}
pub(crate) fn scratch_element(ty: &HirType) -> Option<&'static str> {
    let HirType::PossiblyUndefined(payload) = ty else {
        return None;
    };
    if transport(payload)? != Transport::CallerScratch {
        return None;
    }
    Some(if matches!(**payload, HirType::Float { .. }) {
        "D"
    } else {
        "J"
    })
}
#[derive(Debug)]
pub(crate) struct Storage {
    pub flags: Vec<Option<u16>>,
    pub first_free: u16,
    pub out: Option<u16>,
    arrays: FxHashMap<&'static str, u16>,
    packed: Option<u16>,
    copy_flags: FxHashMap<u32, u16>,
}
impl Storage {
    pub(crate) fn new(values: usize) -> Self {
        Self {
            flags: vec![None; values],
            first_free: 0,
            out: None,
            arrays: FxHashMap::default(),
            packed: None,
            copy_flags: FxHashMap::default(),
        }
    }
}
fn singleton(code: &mut Code, pool: &mut Pool, origin: &Origin) {
    code.get_static(origin, pool, UNDEFINED, "INSTANCE", "Ljava/lang/Object;");
}
impl Emitter<'_> {
    fn optional_local(&mut self, vtype: VType) -> Result<u16, Diagnostic> {
        let slot = self.max_locals;
        self.max_locals = slot
            .checked_add(vtype.slots())
            .ok_or_else(|| refuse(self.func, "optional values exceed the JVM local-slot limit"))?;
        self.locals.push(vtype);
        Ok(slot)
    }
    pub(crate) fn reserve_optional_storage(&mut self) -> Result<(), Diagnostic> {
        let mut arrays = [false; 2];
        let mut packed = false;
        let mut flags = vec![];
        for &block in &self.order {
            let block = &self.func.blocks[block.0 as usize];
            for &id in &block.ops {
                let op = self.func.value(id);
                if let OpKind::Call { .. } = op.kind {
                    if let Some(element) = scratch_element(&op.ty) {
                        arrays[usize::from(element == "D")] = true;
                    } else if split(&op.ty) {
                        packed = true;
                    }
                }
            }
            for (target, args) in nts_codegen_common::destruct::outgoing(&block.terminator) {
                for copy in nts_codegen_common::edge_copies(
                    &self.func.blocks[target.0 as usize].params,
                    &args,
                ) {
                    if let nts_codegen_common::Copy::Save { temp, from } = copy
                        && split(self.ty(from))
                        && !flags.contains(&temp)
                    {
                        flags.push(temp);
                    }
                }
            }
        }
        for (at, element) in ["J", "D"].into_iter().enumerate() {
            if arrays[at] {
                let slot = self.optional_local(VType::Object(format!("[{element}")))?;
                self.optional.arrays.insert(element, slot);
            }
        }
        if packed {
            self.optional.packed = Some(self.optional_local(VType::Long)?);
        }
        for temp in flags {
            let slot = self.optional_local(VType::Integer)?;
            self.optional.copy_flags.insert(temp, slot);
        }
        Ok(())
    }
    pub(crate) fn initialize_optional_scratch(&self, code: &mut Code, pool: &mut Pool) {
        let origin = &self.func.origin;
        // Stable bytecode order; FxHashMap iteration is not a serialization order.
        for element in ["J", "D"] {
            if let Some(&slot) = self.optional.arrays.get(element) {
                code.const_int(origin, pool, 1);
                code.new_array(origin, pool, element);
                code.store(origin, Kind::Ref, slot);
            }
        }
    }
    fn flag_slot(&self, value: ValueId) -> Result<u16, Diagnostic> {
        self.optional.flags[value.0 as usize].ok_or_else(|| {
            refuse(
                self.func,
                "an optional primitive without its defined component",
            )
        })
    }
    pub(crate) fn copy_optional_flag(
        &self,
        code: &mut Code,
        _pool: &mut Pool,
        to: ValueId,
        from: ValueId,
    ) -> Result<(), Diagnostic> {
        if split(self.ty(to)) {
            let o = &self.func.value(to).origin;
            code.load(o, Kind::Int, self.flag_slot(from)?);
            code.store(o, Kind::Int, self.flag_slot(to)?);
        }
        Ok(())
    }
    pub(crate) fn save_optional_flag(
        &self,
        code: &mut Code,
        _pool: &mut Pool,
        temp: u32,
        from: ValueId,
    ) -> Result<(), Diagnostic> {
        if split(self.ty(from)) {
            let o = &self.func.value(from).origin;
            code.load(o, Kind::Int, self.flag_slot(from)?);
            code.store(o, Kind::Int, self.optional.copy_flags[&temp]);
        }
        Ok(())
    }
    pub(crate) fn restore_optional_flag(
        &self,
        code: &mut Code,
        temp: u32,
        to: ValueId,
    ) -> Result<(), Diagnostic> {
        if split(self.ty(to)) {
            let o = &self.func.value(to).origin;
            code.load(o, Kind::Int, self.optional.copy_flags[&temp]);
            code.store(o, Kind::Int, self.flag_slot(to)?);
        }
        Ok(())
    }
    pub(crate) fn optional_operation(
        &self,
        code: &mut Code,
        pool: &mut Pool,
        id: ValueId,
    ) -> Result<Placed, Diagnostic> {
        let op = self.func.value(id);
        let o = &op.origin;
        match op.kind {
            OpKind::Optional { defined, payload } => {
                self.load(code, pool, payload)?;
                if split(&op.ty) {
                    code.store(
                        o,
                        self.kind_of(id)?,
                        self.slot(id).ok_or_else(|| {
                            refuse(self.func, "an optional result without payload storage")
                        })?,
                    );
                    self.load(code, pool, defined)?;
                    code.store(o, Kind::Int, self.flag_slot(id)?);
                } else {
                    let slot = self.slot(id).ok_or_else(|| {
                        refuse(self.func, "an optional reference without storage")
                    })?;
                    code.store(o, Kind::Ref, slot);
                    self.load(code, pool, defined)?;
                    let done = code.label();
                    code.branch_zero(o, Compare::Ne, done);
                    singleton(code, pool, o);
                    code.store(o, Kind::Ref, slot);
                    code.bind(done);
                }
                Ok(Placed::Stored)
            }
            OpKind::OptionalDefined(source) => {
                if split(self.ty(source)) {
                    code.load(o, Kind::Int, self.flag_slot(source)?);
                } else {
                    let slot = self.scratch.ok_or_else(|| {
                        refuse(self.func, "an optional test without boolean scratch")
                    })?;
                    code.const_int(o, pool, 0);
                    code.store(o, Kind::Int, slot);
                    self.load(code, pool, source)?;
                    singleton(code, pool, o);
                    let done = code.label();
                    code.branch_ref(o, true, done);
                    code.const_int(o, pool, 1);
                    code.store(o, Kind::Int, slot);
                    code.bind(done);
                    code.load(o, Kind::Int, slot);
                }
                Ok(Placed::OnStack)
            }
            OpKind::OptionalPayload(source) => {
                self.load(code, pool, source)?;
                if !split(self.ty(source)) {
                    let descriptor = types::descriptor(self.shape, &op.ty).ok_or_else(|| {
                        refuse(self.func, "an optional payload without a JVM form")
                    })?;
                    code.check_cast(o, pool, &descriptor);
                }
                Ok(Placed::OnStack)
            }
            OpKind::ConstUndefined => {
                if split(&op.ty) {
                    code.const_int(o, pool, 0);
                    code.store(o, Kind::Int, self.flag_slot(id)?);
                    let kind = self.kind_of(id)?;
                    match kind {
                        Kind::Long => code.const_long(o, pool, 0),
                        Kind::Float => code.const_float(o, pool, 0.0),
                        Kind::Double => code.const_double(o, pool, 0.0),
                        _ => code.const_int(o, pool, 0),
                    }
                } else {
                    singleton(code, pool, o);
                }
                Ok(Placed::OnStack)
            }
            _ => Err(refuse(self.func, "an unsupported optional operation")),
        }
    }
    pub(crate) fn optional_return(
        &self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
    ) -> Result<bool, Diagnostic> {
        let HirType::PossiblyUndefined(payload) = &self.func.return_type else {
            return Ok(false);
        };
        let o = &self.func.value(value).origin;
        match transport(payload).ok_or_else(|| {
            refuse(
                self.func,
                "an optional native pointer has no JVM representation",
            )
        })? {
            Transport::ReferenceNiche => {
                self.load(code, pool, value)?;
                code.ret(o, Some(Kind::Ref));
            }
            Transport::CallerScratch => {
                let defined = self.flag_slot(value)?;
                code.load(o, Kind::Int, defined);
                let done = code.label();
                code.branch_zero(o, Compare::Eq, done);
                code.load(
                    o,
                    Kind::Ref,
                    self.optional.out.ok_or_else(|| {
                        refuse(self.func, "an optional return without caller scratch")
                    })?,
                );
                code.const_int(o, pool, 0);
                self.load(code, pool, value)?;
                code.array_store(
                    o,
                    scratch_element(&self.func.return_type).expect("scratch return"),
                );
                code.bind(done);
                code.load(o, Kind::Int, defined);
                code.ret(o, Some(Kind::Int));
            }
            Transport::PackedWord { bits } => {
                self.load(code, pool, value)?;
                let payload_bits = if matches!(**payload, HirType::Bool) {
                    1
                } else {
                    match **payload {
                        HirType::Int { bits, .. } | HirType::Float { bits } => bits,
                        _ => unreachable!(),
                    }
                };
                if matches!(**payload, HirType::Float { bits: 32 }) {
                    code.invoke_static(o, pool, "java/lang/Float", "floatToRawIntBits", "(F)I");
                }
                let kind = if bits == 64 {
                    code.convert(o, insn::I2L, Kind::Int, Kind::Long);
                    Kind::Long
                } else {
                    Kind::Int
                };
                let mask = (1_i64 << payload_bits) - 1;
                if kind == Kind::Long {
                    code.const_long(o, pool, mask);
                } else {
                    code.const_int(o, pool, i32::try_from(mask).expect("narrow mask"));
                }
                code.bitwise(o, insn::AND, kind);
                code.load(o, Kind::Int, self.flag_slot(value)?);
                if kind == Kind::Long {
                    code.convert(o, insn::I2L, Kind::Int, Kind::Long);
                }
                code.const_int(o, pool, i32::from(payload_bits));
                code.shift(o, insn::SHL, kind);
                code.bitwise(o, insn::OR, kind);
                code.ret(o, Some(kind));
            }
            _ => {
                return Err(refuse(
                    self.func,
                    "an optional return transport without a JVM form",
                ));
            }
        }
        Ok(true)
    }
    pub(crate) fn optional_direct_call(
        &self,
        code: &mut Code,
        pool: &mut Pool,
        id: ValueId,
        target: &Func,
        args: &[ValueId],
    ) -> Result<Placed, Diagnostic> {
        let result = &self.func.value(id).ty;
        let o = &self.func.value(id).origin;
        for (index, (&arg, param)) in args.iter().zip(&target.params).enumerate() {
            // Signature compatibility is checked by the core verifier. Do not
            // treat an equal Java carrier as proof that payload types agree.
            self.assignable_types(self.ty(arg), &param.ty)?;
            self.string_argument(code, pool, target, index, arg)?;
            if split(&param.ty) {
                code.load(o, Kind::Int, self.flag_slot(arg)?);
            }
        }
        if let Some(element) = scratch_element(&target.return_type) {
            code.load(o, Kind::Ref, self.optional.arrays[element]);
        }
        let descriptor = crate::body::signature(self.shape.package, self.program, target)
            .ok_or_else(|| refuse(self.func, "an optional call without a complete descriptor"))?;
        code.invoke_static(
            o,
            pool,
            &crate::body::program_class(self.shape.package),
            &crate::body::method_name(&target.name),
            &descriptor,
        );
        if let Some(placed) = self.string_result(code, target, id)? {
            return Ok(placed);
        }
        if let HirType::PossiblyUndefined(payload) = result {
            self.optional_call_result(code, pool, id, payload, o)
        } else {
            Ok(if matches!(result, HirType::Void) {
                Placed::Stored
            } else {
                Placed::OnStack
            })
        }
    }
    fn optional_call_result(
        &self,
        code: &mut Code,
        pool: &mut Pool,
        id: ValueId,
        payload: &HirType,
        o: &Origin,
    ) -> Result<Placed, Diagnostic> {
        let Some(slot) = self.slot(id) else {
            return Err(refuse(self.func, "an optional call without result storage"));
        };
        match transport(payload)
            .ok_or_else(|| refuse(self.func, "an optional call result without transport"))?
        {
            Transport::ReferenceNiche => return Ok(Placed::OnStack),
            Transport::CallerScratch => {
                let flag = self.flag_slot(id)?;
                code.store(o, Kind::Int, flag);
                code.load(o, Kind::Int, flag);
                let done = code.label();
                code.branch_zero(o, Compare::Eq, done);
                let element = scratch_element(self.ty(id)).expect("scratch call");
                code.load(o, Kind::Ref, self.optional.arrays[element]);
                code.const_int(o, pool, 0);
                code.array_load(o, element);
                code.store(o, self.kind_of(id)?, slot);
                code.bind(done);
            }
            Transport::PackedWord { bits } => {
                let temp = self.optional.packed.ok_or_else(|| {
                    refuse(
                        self.func,
                        "a packed optional call without temporary storage",
                    )
                })?;
                if bits == 32 {
                    code.convert(o, insn::I2L, Kind::Int, Kind::Long);
                }
                let kind = Kind::Long;
                code.store(o, kind, temp);
                let payload_bits = if matches!(payload, HirType::Bool) {
                    1
                } else {
                    match *payload {
                        HirType::Int { bits, .. } | HirType::Float { bits } => bits,
                        _ => unreachable!(),
                    }
                };
                code.load(o, kind, temp);
                code.const_int(o, pool, i32::from(payload_bits));
                code.shift(o, insn::USHR, kind);
                if kind == Kind::Long {
                    code.convert(o, insn::L2I, Kind::Long, Kind::Int);
                }
                code.store(o, Kind::Int, self.flag_slot(id)?);
                code.load(o, kind, temp);
                if kind == Kind::Long {
                    code.convert(o, insn::L2I, Kind::Long, Kind::Int);
                }
                match *payload {
                    HirType::Float { bits: 32 } => {
                        code.invoke_static(o, pool, "java/lang/Float", "intBitsToFloat", "(I)F");
                    }
                    HirType::Int {
                        bits: 8,
                        signed: true,
                    } => code.convert(o, insn::I2B, Kind::Int, Kind::Int),
                    HirType::Int {
                        bits: 16,
                        signed: true,
                    } => code.convert(o, insn::I2S, Kind::Int, Kind::Int),
                    HirType::Bool | HirType::Int { bits: 8 | 16, .. } => {
                        code.const_int(o, pool, (1_i32 << payload_bits) - 1);
                        code.bitwise(o, insn::AND, Kind::Int);
                    }
                    _ => {}
                }
                code.store(o, self.kind_of(id)?, slot);
            }
            _ => {
                return Err(refuse(
                    self.func,
                    "an optional call transport without a JVM form",
                ));
            }
        }
        Ok(Placed::Stored)
    }
}
