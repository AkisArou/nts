//! Select and lower intrinsics and global/static builtin entry routes.

use super::{
    BinOp, Diagnostic, FuncBuilder, HirType, NodeId, NumericBuiltin, OpKind, UnOp, ValueId, syntax,
};

/// Which `lib.d.ts` name an `instanceof` names, where it is one this compiler
/// answers without a class. See [`FuncBuilder::instanceof_builtin`].
#[derive(Clone, Copy)]
pub(super) enum Builtin {
    Array,
    Object,
    Function,
    /// A name nothing a compiled program holds can be an instance of, so the
    /// answer is `false` whatever the operand.
    Never,
}

/// The `Math` member a name spells.
fn math_member(member: &str) -> Option<Intrinsic> {
    Some(match member {
        "floor" => Intrinsic::Unary(UnOp::Floor),
        "ceil" => Intrinsic::Unary(UnOp::Ceil),
        "trunc" => Intrinsic::Unary(UnOp::Trunc),
        "round" => Intrinsic::Unary(UnOp::Round),
        "abs" => Intrinsic::Unary(UnOp::Abs),
        "sqrt" => Intrinsic::Unary(UnOp::Sqrt),
        "min" => Intrinsic::Binary(BinOp::Min),
        "max" => Intrinsic::Binary(BinOp::Max),
        "pow" => Intrinsic::BinaryCall("nts_math_pow"),
        "atan2" => Intrinsic::BinaryCall("nts_math_atan2"),
        "hypot" => Intrinsic::BinaryCall("nts_math_hypot"),
        // Exact, so not `APPROXIMATED`: the 32-bit multiply every string hash
        // (FNV, Murmur) is written with.
        "imul" => Intrinsic::BinaryCall("nts_math_imul"),
        "sign" => Intrinsic::UnaryCall("nts_math_sign"),
        "fround" => Intrinsic::UnaryCall("nts_math_fround"),
        "cbrt" => Intrinsic::UnaryCall("nts_math_cbrt"),
        "exp" => Intrinsic::UnaryCall("nts_math_exp"),
        "expm1" => Intrinsic::UnaryCall("nts_math_expm1"),
        "log" => Intrinsic::UnaryCall("nts_math_log"),
        "log2" => Intrinsic::UnaryCall("nts_math_log2"),
        "log10" => Intrinsic::UnaryCall("nts_math_log10"),
        "log1p" => Intrinsic::UnaryCall("nts_math_log1p"),
        "sin" => Intrinsic::UnaryCall("nts_math_sin"),
        "cos" => Intrinsic::UnaryCall("nts_math_cos"),
        "tan" => Intrinsic::UnaryCall("nts_math_tan"),
        "asin" => Intrinsic::UnaryCall("nts_math_asin"),
        "acos" => Intrinsic::UnaryCall("nts_math_acos"),
        "atan" => Intrinsic::UnaryCall("nts_math_atan"),
        "sinh" => Intrinsic::UnaryCall("nts_math_sinh"),
        "cosh" => Intrinsic::UnaryCall("nts_math_cosh"),
        "tanh" => Intrinsic::UnaryCall("nts_math_tanh"),
        // `Math.random` is absent on purpose: it is the one member of this
        // family that no differential can check, because two runs of the
        // same program disagree by design.
        _ => return None,
    })
}

/// Primitive conversions and symbol creation. Initialization analysis uses the
/// same classification as lowering; with primitive inputs none calls user code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PrimitiveBuiltin {
    Symbol,
    String,
    Boolean,
    Number,
    BigInt,
}

pub(super) fn primitive_builtin(name: &str) -> Option<PrimitiveBuiltin> {
    match name {
        "Symbol" => Some(PrimitiveBuiltin::Symbol),
        "String" => Some(PrimitiveBuiltin::String),
        "Boolean" => Some(PrimitiveBuiltin::Boolean),
        "Number" => Some(PrimitiveBuiltin::Number),
        "BigInt" => Some(PrimitiveBuiltin::BigInt),
        _ => None,
    }
}

/// The global function a name spells, for the two that are numeric predicates.
fn global_predicate(name: &str) -> Option<Intrinsic> {
    Some(match name {
        "isNaN" => Intrinsic::NotANumber,
        "isFinite" => Intrinsic::UnaryCall("nts_is_finite"),
        _ => return None,
    })
}

/// The value a namespace's named constant holds.
///
/// `Math` and `Number` between them, because both are namespaces of numbers
/// with no representation of their own, and the lowering asks the same question
/// of each.
pub(super) fn named_constant(namespace: &str, name: &str) -> Option<f64> {
    match namespace {
        "Math" => math_constant(name),
        "Number" => number_constant(name),
        _ => None,
    }
}

/// The value `Number`'s named constants hold.
///
/// The specification gives each as an exact `double`, so these are values and
/// not approximations -- `EPSILON` is 2^-52 and `MAX_SAFE_INTEGER` is 2^53 - 1,
/// both exactly representable. `Number.NaN` is here as well: it is a constant
/// like the rest, and the global `NaN` is the same value under a shorter name.
fn number_constant(name: &str) -> Option<f64> {
    Some(match name {
        "MAX_SAFE_INTEGER" => 9_007_199_254_740_991.0,
        "MIN_SAFE_INTEGER" => -9_007_199_254_740_991.0,
        "MAX_VALUE" => f64::MAX,
        // The smallest *subnormal*, which is what the specification says and is
        // not `f64::MIN_POSITIVE` -- that is the smallest normal, 2^-1022,
        // where this is 2^-1074. Four orders of magnitude apart in the exponent.
        "MIN_VALUE" => f64::from_bits(1),
        "EPSILON" => f64::EPSILON,
        "POSITIVE_INFINITY" => f64::INFINITY,
        "NEGATIVE_INFINITY" => f64::NEG_INFINITY,
        "NaN" => f64::NAN,
        _ => return None,
    })
}

/// The value `Math`'s named constants hold.
///
/// Spelled out rather than computed, because the specification gives each one
/// as the `double` nearest a mathematical constant and `M_PI` and friends are
/// not guaranteed to be that -- they are a POSIX extension, not C, and their
/// precision is the implementation's business. These are the digits node
/// prints.
fn math_constant(name: &str) -> Option<f64> {
    Some(match name {
        "PI" => std::f64::consts::PI,
        "E" => std::f64::consts::E,
        "LN2" => std::f64::consts::LN_2,
        "LN10" => std::f64::consts::LN_10,
        "LOG2E" => std::f64::consts::LOG2_E,
        "LOG10E" => std::f64::consts::LOG10_E,
        "SQRT2" => std::f64::consts::SQRT_2,
        "SQRT1_2" => std::f64::consts::FRAC_1_SQRT_2,
        _ => return None,
    })
}

/// A `Math` member the compiler implements directly.
#[derive(Debug, Clone, Copy)]
pub(super) enum Intrinsic {
    Unary(UnOp),
    Binary(BinOp),
    /// A one-argument call into the runtime, named here.
    UnaryCall(&'static str),
    /// A two-argument call into the runtime, named here.
    BinaryCall(&'static str),
    /// `Number.isNaN`, which is `x != x` rather than a call.
    ///
    /// Free, and it folds away entirely where the specializer has narrowed the
    /// operand to an integer -- which cannot be NaN, so the comparison is a
    /// constant `false` that the C compiler removes. A runtime call would have
    /// pinned the value to a `double` to pass it.
    NotANumber,
}

impl FuncBuilder<'_> {
    /// `Promise.resolve(v)` and `Promise.reject(e)`.
    ///
    /// `None` when the callee is not one of them, which is a different answer
    /// from `Some(Err(..))`: the second is one of these given something it
    /// cannot take, and it says so rather than falling through to a diagnostic
    /// about a member of `Promise` that does not exist.
    ///
    /// Already settled, which is not the same as synchronous. A reaction
    /// subscribed to one of these still runs on the microtask queue, one tick
    /// later, because running it inline would be a different observable order.
    /// That is the runtime's rule and this does not have to restate it.
    /// A static whose answer the checker's types already contain.
    ///
    /// `Array.isArray(x)` is a constant wherever the argument has a static
    /// type, and so is `Object.hasOwn(o, "k")` wherever the layout is known:
    /// there is nothing to ask at run time, because the question was settled
    /// when the type was. `Object.keys(o)` is the same fact one step further --
    /// the field names of a layout, which is a list the compiler is holding.
    ///
    /// Answered from the *checker's* type rather than from the representation,
    /// which is the whole subtlety. A `Uint8Array` is a `Managed(Array(u8))`
    /// here, and `Array.isArray(new Uint8Array(4))` is **false** in node -- a
    /// typed array is not an Array. Reading the representation would have
    /// answered `true` and been wrong in a way nothing else would catch.
    fn lower_decided_static(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(callee);
        let [object, member] = parts.as_slice() else {
            return None;
        };
        if self.kind_of(*object) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let global = self
            .node(*object)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)?;
        let name = self
            .node(*member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)?;

        match (global.as_str(), name.as_str(), arguments) {
            ("Array", "isArray", [argument]) => Some(self.decide_is_array(id, *argument)),
            // `ArrayBuffer.isView(x)`, which is the same question asked of a
            // different family and answered the same way: from the type where
            // the type knows, and from the descriptor where it does not.
            //
            // It is the one question a typed array and a `DataView` answer
            // together -- `instanceof` separates them and this does not -- so
            // the runtime side compares two descriptors rather than testing a
            // kind. `AnyView` is true by construction: it *is* the union.
            ("ArrayBuffer", "isView", [argument]) => Some(self.decide_is_view(id, *argument)),
            // `Array.from(xs)` where `xs` is already an array is a copy, which
            // is what `[...xs]` is and what `slice` already does. Twelve of the
            // twenty-two `Array.from` calls in `runtime/node` take one
            // argument; the ones that take a mapper, or something that is
            // iterable without being an array, are a different question and
            // fall through to being refused by name.
            ("Array", "from", [argument]) => Some(self.lower_array_from(id, *argument)),
            // The two-argument form is two features wearing one name. With an
            // iterable it is `map` fused into the walk, which the callback
            // machinery does for `xs.map(f)` and would have to do here; with
            // `{ length: n }` it is not an iteration at all -- an *array-like*
            // is read by index, and `Array.from({ length: 4 })` builds four
            // `undefined`s from an object that has no elements. Both are in
            // `runtime/node`, and neither is this.
            ("Array", "from", [argument, callback]) => {
                Some(self.lower_array_from_mapped(id, *argument, *callback))
            }
            // `Symbol.for(key)`: the one symbol for this key in this runtime.
            //
            // The registry is a *strong* reference and that is the
            // specification's own rule rather than an oversight -- a registered
            // symbol is reachable for the life of the runtime, which is exactly
            // what distinguishes `Symbol.for("a")` from `Symbol("a")`.
            ("Symbol", "for", [argument]) => Some(self.lower_symbol_for(id, *argument)),
            // `Symbol.keyFor(sym)`: the key a registered symbol was made under,
            // and `undefined` for one that was not registered.
            ("Symbol", "keyFor", [argument]) => Some(self.lower_symbol_key_for(id, *argument)),
            ("Object", "keys", [argument]) => Some(self.decide_object_keys(id, *argument)),
            ("Object", "values", [argument]) => {
                Some(self.decide_object_columns(id, *argument, false))
            }
            ("Object", "entries", [argument]) => {
                Some(self.decide_object_columns(id, *argument, true))
            }
            // `Object.create(null)` is a **dictionary**, and the refusal beside
            // this has said so all along: "a fixed layout has nowhere to put"
            // the prototype argument, and "`Object.create(null)` is a dictionary
            // and is a different, buildable thing". This builds it. Only the
            // `null` form: any other prototype is a real prototype and keeps
            // that refusal.
            ("Object", "create", [prototype]) => Some(self.decide_object_create(id, *prototype)),
            ("Object", "is", [left, right]) => Some(self.decide_object_is(id, *left, *right)),
            ("Object", "hasOwn", [argument, key]) => Some(self.decide_has_own(id, *argument, *key)),
            // `Object.assign(target, ...sources)` between dictionaries. React's
            // `cloneElement`, its class state merge and its props resolution are
            // all this shape, and it was 6 root refusals in that runtime.
            //
            // **Every arity**, because the argument list is written down. The
            // first version of this arm took two arguments and called three a
            // fold "the caller can write", which was wrong twice over: a fold
            // over three *named* sources is three calls and not a loop, and the
            // arm it refused into says "a global member with no definition here"
            // -- so `Object.assign({}, prevState, partialState)`, React's one
            // canonical state merge, read as an unimplemented member.
            ("Object", "assign", [target, sources @ ..]) => {
                Some(self.decide_object_assign(id, *target, sources))
            }
            // `BigInt.asIntN(64, v)`, which is how the profile reads a signed
            // 64-bit quantity back out of an unsigned one. A width and a value,
            // both already machine types here.
            ("BigInt", helper @ ("asIntN" | "asUintN"), [width, value]) => {
                let call = if helper == "asIntN" {
                    "nts_bigint_as_intn"
                } else {
                    "nts_bigint_as_uintn"
                };
                Some(self.decide_as_n(id, call, *width, *value))
            }
            _ => None,
        }
    }

    /// The call forms that are not ordinary calls.
    ///
    /// Three kinds, and they are asked in this order because each is narrower
    /// than the last:
    ///
    /// `Math.floor(x)` and friends are *operations*. Lowering them as
    /// operations is what lets the analysis see that the result is a whole
    /// number, which is the entire reason an author writes `Math.floor` rather
    /// than a division.
    ///
    /// `Array.isArray(x)`, `Object.keys(o)` and `Object.hasOwn(o, "k")` are
    /// questions the *types* already answer, so they become constants.
    ///
    /// `Promise.resolve(v)` and `Promise.reject(e)` are constructors: each
    /// allocates a promise and settles it before anyone can subscribe.
    #[expect(
        clippy::too_many_lines,
        reason = "keep semantic text and key projection beside its existing dispatch"
    )]
    pub(super) fn lower_special_call(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.is_standard_array_constructor(callee) {
            return Some(self.lower_array_call(id, callee));
        }
        // `GtkStringObject.new("x")`: a C function as a static member of a
        // class value, which has no value to be a receiver.
        if self.kind_of(callee) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
            && let [target, member] = self.children(callee).as_slice()
            && let Some(declaration) = self.static_native(id, *target)
        {
            return Some(self.lower_static_native(id, declaration, *member, arguments));
        }
        // A declaration of a `GObject` class's, `@ntsIntrinsic gobject.*`
        // (`lower/gobject.rs`).
        if let Some(intrinsic) = self.gobject_intrinsic(id) {
            return Some(self.lower_gobject_intrinsic(id, intrinsic, arguments));
        }
        if let Some(decl) = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|target| target.callee)
            && self
                .node(decl)
                .native
                .as_ref()
                .and_then(|n| n.abi.as_deref())
                == Some("intrinsic")
            && !self.has_a_body(decl)
        {
            match self.declared_name(decl).as_deref() {
                Some("addrOf") => return Some(self.native_address_of(id, arguments)),
                Some(name @ ("local" | "sizeof" | "malloc" | "free" | "copy")) => {
                    return Some(self.native_storage(id, name, arguments));
                }
                Some("unsafeDowncast") => return Some(self.native_downcast(id, arguments)),
                Some("stringFrom") => return Some(self.native_string_from(id, arguments)),
                Some("pointerBits") => return Some(self.native_pointer_bits(id, arguments)),
                Some("bytesFrom") => return Some(self.native_bytes_from(id, arguments)),
                Some("selector") if self.in_objc_module(decl) => {
                    return Some(self.lower_selector(id, arguments));
                }
                _ => {}
            }
        }

        // `Number.parseInt` and `Number.parseFloat` before the intrinsic table,
        // because that table's entries all take exactly one argument and
        // `parseInt` takes a radix.
        //
        // Each is the same function object as its global in JavaScript, so both
        // reach the same helper rather than a second one -- and reaching a
        // *different* one is how two spellings of an operation come to disagree,
        // which this file has three comments about already.
        //
        // **`parseFloat` was missing and `parseInt` was not**, which is the
        // shape a table one entry short always has: thirteen of `Number`'s
        // fourteen members answered and the fourteenth said `a global member
        // with no definition here`. The pair is written here together so that a
        // reader adding one finds the other, which is the same argument
        // `lower_global_call` makes for keeping them adjacent two hundred lines
        // apart from the single-argument builtins.
        //
        // Only these two. `Number.isNaN` and `Number.isFinite` are **not** their
        // globals -- the whole reason those spellings exist is what they do to a
        // value that is not a number -- and aliasing them would be a silent
        // wrong answer rather than a missing one. They reach `Number`'s own
        // entries in `intrinsic_of`, which is correct because a `number` is all
        // that can arrive there.
        if self.kind_of(callee) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let parts = self.children(callee);
            if let [object, member] = parts.as_slice()
                && self
                    .node(*object)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    == Some("Number")
            {
                match self
                    .node(*member)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                {
                    Some("parseInt") => return Some(self.lower_parse_int(id, arguments)),
                    Some("parseFloat") => return Some(self.lower_parse_float(id, arguments)),
                    _ => {}
                }
            }
        }
        // `Uint8Array.of(…)` and `Uint8Array.from(xs)`, beside the `Number`
        // block above and before the intrinsic table, which is keyed on a fixed
        // pair of names and has nowhere to put a class family.
        if self.kind_of(callee) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let parts = self.children(callee);
            if let [object, member] = parts.as_slice()
                && let Some(class) = self
                    .node(*object)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
                && let Some(element) = crate::hir::builtin::typed_array_element(&class)
            {
                match self
                    .node(*member)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                {
                    Some("of") => {
                        return Some(self.lower_typed_array_of(id, &class, element, arguments));
                    }
                    Some("from") => {
                        return Some(self.lower_typed_array_from(id, &class, element, arguments));
                    }
                    _ => {}
                }
            }
        }
        if let Some(to_stderr) = self.console_method(callee) {
            return Some(self.lower_console(id, arguments, to_stderr));
        }
        if self.is_json_stringify(callee) {
            return Some(self.lower_json_stringify(id, arguments));
        }
        if let Some((intrinsic, builtin)) = self.intrinsic_of(callee) {
            return Some(self.lower_intrinsic(id, intrinsic, builtin, arguments));
        }
        if let Some(decided) = self.lower_decided_static(id, callee, arguments) {
            return Some(decided);
        }
        if let Some(settled) = self.lower_capability_call(id, callee, arguments) {
            return Some(settled);
        }
        self.lower_promise_static(id, callee, arguments)
    }

    /// The `Math` or `Number` member a callee names, if it names one.
    ///
    /// Recognized by shape rather than by symbol identity, which is a
    /// simplification: a program that shadowed the global `Math` with its own
    /// object would be mis-read. It cannot be shadowed by a *function* in the
    /// compiled program — that call would resolve to a direct target and never
    /// reach here — so the remaining case is an import named `Math` with
    /// matching method names.
    ///
    /// `docs/records/notebooks/any-unknown.md` describes the principled version: profiles that
    /// associate trusted *declaration identities* with a closed set of
    /// compiler-owned semantics, so the core never matches on a name at all.
    /// This is the shape that becomes.
    fn intrinsic_of(&self, callee: NodeId) -> Option<(Intrinsic, NumericBuiltin<'static>)> {
        let (object, member) = self.member_access(callee)?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let member = member.as_str();
        match self
            .node(object)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())?
        {
            "Math" => math_member(member).map(|intrinsic| (intrinsic, NumericBuiltin::Math)),
            // `Number`'s four predicates. The first two are `Number` only in
            // spelling: over a `number` they are exactly the global `isNaN`
            // and `isFinite`, because the whole difference the `Number.` forms
            // exist for is what they do to a value that is *not* a number,
            // and one cannot reach here.
            // `Number.parseInt` and the global are the same function object in
            // JavaScript, which is why this maps to the same helper rather than
            // to a second one.
            "Number" => Some((
                match member {
                    "isNaN" => Intrinsic::NotANumber,
                    "isFinite" => Intrinsic::UnaryCall("nts_is_finite"),
                    "isInteger" => Intrinsic::UnaryCall("nts_is_integer"),
                    "isSafeInteger" => Intrinsic::UnaryCall("nts_is_safe_integer"),
                    _ => return None,
                },
                NumericBuiltin::NumberPredicate,
            )),
            // Two functions rather than two names for one. `fromCharCode`
            // takes a UTF-16 code *unit* through `ToUint16` and always yields
            // one of them; `fromCodePoint` takes a code *point* and yields a
            // surrogate pair above 0xFFFF.
            "String" => Some((
                match member {
                    "fromCharCode" => Intrinsic::UnaryCall("nts_string_from_char_code"),
                    "fromCodePoint" => Intrinsic::UnaryCall("nts_string_from_code_point"),
                    _ => return None,
                },
                NumericBuiltin::StringFactory,
            )),
            _ => None,
        }
    }

    pub(super) fn lower_provided_builtin(
        &mut self,
        id: NodeId,
        name: &str,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        let primitive = primitive_builtin(name);
        // The globals convert their argument; the Number predicates do not.
        // Carry that semantic owner through intrinsic selection rather than
        // inferring conversion from the shared numeric helper signature.
        if let Some(intrinsic) = global_predicate(name) {
            return Some(self.lower_intrinsic(
                id,
                intrinsic,
                NumericBuiltin::GlobalPredicate,
                arguments,
            ));
        }
        // `parseInt(string, radix)`, whose second argument is optional -- so it
        // is read here rather than below, where every builtin takes exactly
        // one.
        //
        // It is not `Number(s)` with a radix. `Number("")` is 0 and
        // `parseInt("")` is NaN; `Number("12abc")` is NaN and `parseInt("12abc")`
        // is 12. Stopping at the first character the radix does not admit is
        // the whole of the difference, and `nts_parse_int` is where it lives.
        //
        // 14 sites across 6 modules, and `os.networkInterfaces` is behind one of
        // them through `getCIDR`.
        if name == "parseInt" {
            return Some(self.lower_parse_int(id, arguments));
        }
        // `parseFloat(string)`, beside `parseInt` because it is the same
        // operation with the radix fixed and the grammar widened -- and because
        // a reader looking for one will look here for the other.
        //
        // One argument, so it could have gone in the single-argument section
        // below. It is here because the *pair* is the thing: whatever is true of
        // stopping at the first character the grammar does not admit is true of
        // both, and splitting them put two halves of one behaviour two hundred
        // lines apart.
        if name == "parseFloat" {
            return Some(self.lower_parse_float(id, arguments));
        }
        // The four URI builtins, as one lowering with two flags. They are a
        // pair of pairs and the members of each pair differ only in a character
        // set, so four entry points would be four copies of the `URIError`
        // half -- which is the part with the edges in it.
        //
        // `decodeURIComponent` gates `querystring.parse`, and `parse` is what
        // six of `querystring`'s seven failing test files stop at.
        if let Some((encode, component)) = match name {
            "encodeURI" => Some((true, false)),
            "encodeURIComponent" => Some((true, true)),
            "decodeURI" => Some((false, false)),
            "decodeURIComponent" => Some((false, true)),
            _ => None,
        } {
            return Some(self.lower_uri(id, arguments, encode, component));
        }
        // The `timers` capability, which takes two arguments and so has to be
        // read before the single-argument builtins below.
        match name {
            "setTimeout" => return Some(self.lower_set_timer(id, arguments, false)),
            "setInterval" => return Some(self.lower_set_timer(id, arguments, true)),
            "clearTimeout" | "clearInterval" => {
                return Some(self.lower_clear_timer(id, arguments));
            }
            _ => {}
        }
        // `Symbol()` and `Symbol(description)`. The one builtin here that takes
        // *no* argument as well as one, so it is read before the single
        // argument is destructured below.
        //
        // Called rather than `new`-ed: `new Symbol()` is a TypeError in
        // JavaScript, and the checker rejects it, so there is no constructor
        // form to handle.
        if primitive == Some(PrimitiveBuiltin::Symbol) {
            return Some(self.lower_symbol_new(id, arguments));
        }
        let [argument] = arguments else {
            return None;
        };
        // `String(x)` is `ToString`, which is what `s + n` already needs. For a
        // number only -- `String(unknown)` is a general renderer and
        // `String({})` walks a prototype chain.
        if primitive == Some(PrimitiveBuiltin::String) {
            return Some(
                self.lower_expression(*argument)
                    .and_then(|value| self.as_string(*argument, value)),
            );
        }
        // `Boolean(x)` is `ToBoolean`, and `ToBoolean` is the test `if (x)`
        // already performs -- so it is that operation rather than a conversion
        // of its own, and it inherits whatever the truthiness rule already
        // knows about each representation. Nineteen sites in the profile, every
        // one of them turning an optional or an erased value into a flag to
        // store.
        if primitive == Some(PrimitiveBuiltin::Boolean) {
            let value = match self.lower_expression(*argument) {
                Ok(value) => value,
                Err(problem) => return Some(Err(problem)),
            };
            return Some(Ok(self.truthy(id, value)));
        }
        // `Number(x)`, the mirror of it and a much smaller job: the identity on
        // a number, and `ToNumber` on a boolean, which the specification gives
        // as 1 and 0. On a string it is a parse -- the same parse `parseFloat`
        // needs, and neither exists yet -- and on anything else it is `valueOf`
        // off a prototype chain.
        if primitive == Some(PrimitiveBuiltin::Number) {
            let value = match self.lower_expression(*argument) {
                Ok(value) => value,
                Err(problem) => return Some(Err(problem)),
            };
            return Some(self.coerce_explicit_number(id, *argument, value));
        }

        // `BigInt(x)`, the mirror of `Number(x)` and not quite its twin.
        //
        // The identity on a bigint, and `0n`/`1n` on a boolean, both of which a
        // C cast already is. On a *number* it is a conversion with a
        // precondition: the specification throws a `RangeError` when the value
        // is not an integer, so `BigInt(1.5)` is not `1n` and a cast would be a
        // wrong answer rather than a lossy one. `nts_bigint_from_number` checks
        // and refuses, the way an index past the end of an array does.
        //
        // On a string it is a parse, which `parseInt` would need too and
        // neither has; on anything else it is `valueOf` off a prototype chain.
        // Both are refused by name -- 22 sites in the node profile said only
        // "a builtin this compiler does not provide" before this existed.
        if primitive == Some(PrimitiveBuiltin::BigInt) {
            let value = match self.lower_expression(*argument) {
                Ok(value) => value,
                Err(problem) => return Some(Err(problem)),
            };
            let origin = self.origin(id);
            return Some(match self.values[value.0 as usize].ty {
                HirType::BigInt => Ok(value),
                HirType::Bool => Ok(self.push(OpKind::Convert(value), HirType::BigInt, origin)),
                HirType::Float { .. } | HirType::Int { .. } => Ok(self.runtime_call(
                    "nts_bigint_from_number",
                    vec![value],
                    HirType::BigInt,
                    origin,
                )),
                _ => Err(self.unsupported(id, "a conversion to bigint from this type")),
            });
        }
        None
    }

    fn lower_intrinsic(
        &mut self,
        id: NodeId,
        intrinsic: Intrinsic,
        builtin: NumericBuiltin<'_>,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Math` call"))?;
        let origin = self.origin(id);

        match (intrinsic, arguments) {
            (Intrinsic::Unary(op), [_]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let operand = values[0];
                Ok(self.push(OpKind::Unary { op, operand }, ty, origin))
            }
            // `Math.min(a, b, c)`, `Math.max(a)` and `Math.max()`.
            //
            // **Associative and exact**, which is what makes folding right here
            // and wrong for `Math.hypot` below: each step selects one of its
            // operands, so three arguments folded pairwise give the number the
            // specification's n-ary comparison gives -- including the `NaN`
            // that propagates out of any argument, and the `+0` that
            // `max(-0, +0)` answers.
            //
            // The empty call is that fold's identity: `Math.max()` is
            // `-Infinity` and `Math.min()` is `+Infinity`, which is what the
            // specification says and what a fold with no operands needs.
            //
            // **And every argument is converted, not assumed.** This comment used
            // to end "one argument is itself, which is `ToNumber(a)` where `a` is
            // already a number", and that last clause was the bug: nothing made it
            // so. `Math.max(1, obj)` folded a `Float` against a
            // `Managed(Object)` and reached the verifier as `OperandsDiffer` --
            // invalid HIR from a program test262 runs
            // (`Math/max/Math.max_each-element-coerced.js`), and
            // `outcomes/math-max-converts-every-argument` is the record.
            //
            // The builtin argument catalog now guards primitive ToNumber here.
            // It throws for Symbol/BigInt, and objects stop by name until their
            // ToPrimitive conversion is available.
            (Intrinsic::Binary(op @ (BinOp::Min | BinOp::Max)), args) => {
                let mut folded: Option<ValueId> = None;
                for operand in self.builtin_arguments(id, builtin, args)? {
                    folded = Some(match folded {
                        None => operand,
                        Some(lhs) => self.push(
                            OpKind::Binary {
                                op,
                                lhs,
                                rhs: operand,
                            },
                            ty.clone(),
                            origin.clone(),
                        ),
                    });
                }
                if let Some(value) = folded {
                    return Ok(value);
                }
                let identity = if matches!(op, BinOp::Max) {
                    f64::NEG_INFINITY
                } else {
                    f64::INFINITY
                };
                Ok(self.push(OpKind::ConstFloat(identity), ty, origin))
            }
            // Every other binary `Math` member, and on the same terms: the
            // specification converts both arguments with `ToNumber` and so does
            // this. `Math.pow(obj, 2)` had the same `OperandsDiffer` waiting in it.
            (Intrinsic::Binary(op), [_, _]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let (lhs, rhs) = (values[0], values[1]);
                Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
            }
            (Intrinsic::NotANumber, [_]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let operand = values[0];
                Ok(self.push(
                    OpKind::Binary {
                        op: BinOp::Ne,
                        lhs: operand,
                        rhs: operand,
                    },
                    ty,
                    origin,
                ))
            }
            (Intrinsic::UnaryCall(name), [_]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let operand = values[0];
                // A code point the helper will not accept throws before it is
                // reached. See `guard_code_point`.
                if name == "nts_string_from_code_point" {
                    self.guard_code_point(id, operand)?;
                }
                Ok(self.runtime_call(name, vec![operand], ty, origin))
            }
            (Intrinsic::BinaryCall(name), [_, _]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let (lhs, rhs) = (values[0], values[1]);
                Ok(self.runtime_call(name, vec![lhs, rhs], ty, origin))
            }
            // `String.fromCharCode` takes any number of code units and the
            // runtime offers one at a time, so the n-ary call is the fold.
            // Concatenation is associative and exact on strings, which is what
            // makes folding this one right where folding `Math.hypot` would
            // not be -- `sqrt(sqrt(a^2+b^2)^2+c^2)` is the same number only in
            // arithmetic that has no rounding.
            //
            // It is the shape real code uses, and refusing it stopped Node's
            // own UTF-8 decoder: a code point above the BMP is written
            // `fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff))`, which
            // is the surrogate pair, and there is no one-at-a-time spelling of
            // it that does not allocate the same two strings anyway.
            (Intrinsic::UnaryCall(name), [_, rest @ ..])
                if !rest.is_empty() && name == "nts_string_from_char_code" =>
            {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let operand = values[0];
                let mut folded = self.runtime_call(name, vec![operand], ty.clone(), origin.clone());
                for operand in values.into_iter().skip(1) {
                    let unit = self.runtime_call(name, vec![operand], ty.clone(), origin.clone());
                    // The *call* spelling of concatenation, not `BinOp::Concat`.
                    // The emitter renders both as `nts_concat`, but only a call
                    // carries `frame`: `hir::frame_capacity` reads a call's
                    // callee and a binary operator has nowhere to put storage.
                    //
                    // Each side here is exactly one code unit, so the pair is
                    // two and fits a frame slot -- which `flow::string_span`
                    // can now say, because it knows what `fromCharCode` returns.
                    // As a binop this was a heap allocation: three of the eight
                    // `node-utf8` makes per decoded string, for its three emoji.
                    folded = self.runtime_call(
                        "nts_concat",
                        vec![folded, unit],
                        ty.clone(),
                        origin.clone(),
                    );
                }
                Ok(folded)
            }
            // Only the arities selected above are admitted. A helper's f64
            // parameter is storage, not permission to reinterpret other calls.
            _ => Err(self.unsupported(id, "an intrinsic call with this many arguments")),
        }
    }
}
