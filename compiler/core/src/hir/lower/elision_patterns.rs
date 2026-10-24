//! An array pattern of elisions over a value whose type says nothing about it.
//!
//! `function f([,]: any)` steps whatever iterator the caller's value has, once
//! per elision, and the language decides what that is at run time: an array, a
//! string, a `Map`, a generator, an object of the program's own with a
//! `[Symbol.iterator]`, or nothing iterable at all. An erased value carries the
//! answer in its tag and its class, so the pattern asks, in that order.

use nts_semantic_schema::{NodeId, TypeId, syntax};

use super::{
    BinOp, BlockId, Diagnostic, FuncBuilder, HirType, ManagedType, Native, OpKind, Origin,
    PatternScope, Terminator, ValueId, abstract_generator_kind,
};
use crate::hir::{GeneratorKind, SYNTHETIC_GENERATOR_FRAMES, tags};

/// Whether `pattern` is an array pattern of elisions and nothing else: `[,]`,
/// `[, ,]`. It binds no name, so stepping is all it does -- and stepping is
/// what tells the iterables apart.
///
/// `[]` is not one: it takes no step at all, and the JVM lane holds it.
pub(super) fn elisions_only(probe: &FuncBuilder<'_>, pattern: NodeId) -> bool {
    if probe.kind_of(pattern) != Some(syntax::ARRAY_BINDING_PATTERN) {
        return false;
    }
    let elements = probe.children(pattern);
    !elements.is_empty()
        && elements.iter().all(|element| {
            probe.kind_of(*element) == Some(syntax::BINDING_ELEMENT)
                && probe.children(*element).is_empty()
        })
}

/// Whether `pattern` takes [`FuncBuilder::step_what_arrived`]: elisions over a
/// value whose type says nothing. Asked by the throwing analysis, before
/// anything is lowered: the dispatch throws a `TypeError` the source never
/// wrote, and a `try` around a call to the function needs its raising copy to
/// catch it.
pub(super) fn steps_what_arrives(probe: &FuncBuilder<'_>, pattern: NodeId) -> bool {
    elisions_only(probe, pattern)
        && (probe.type_of(pattern) == Some(HirType::Erased)
            || probe
                .syntactic_parent(pattern)
                .is_some_and(|parameter| takes_any_iterable(probe, parameter)))
}

/// Whether `parameter` is an elision pattern nothing annotates:
/// `function f([,])`, unchecked JavaScript's commonest spelling.
///
/// Its checker type is the pattern's own `[any?]` -- the same type id an
/// explicit `[any?]` has, so the type cannot tell the two apart -- and a
/// caller is free to pass any iterable: test262's `ary-ptrn-elision-exhausted`
/// passes a generator to every kind of function and method. Represented as
/// the array that type names, a generator arrived where an array was wanted.
/// So the declaration decides: such a parameter is erased, in the function
/// (`lower_param_binding`) and at every direct call (`parameter_representation`),
/// and [`FuncBuilder::step_what_arrived`] steps what came.
///
/// Not with a default, whose own path erases the parameter already, and not a
/// rest, which collects rather than steps.
pub(super) fn takes_any_iterable(probe: &FuncBuilder<'_>, parameter: NodeId) -> bool {
    if probe.kind_of(parameter) != Some(syntax::PARAMETER)
        || probe.annotated(parameter)
        || probe.default_of(parameter).is_some()
    {
        return false;
    }
    let children = probe.children(parameter);
    !children
        .iter()
        .any(|child| probe.kind_of(*child) == Some(syntax::DOT_DOT_DOT_TOKEN))
        && children.iter().any(|child| elisions_only(probe, *child))
}

impl FuncBuilder<'_> {
    /// `[,]` over an erased value: one step per elision of whichever iterator
    /// arrived.
    ///
    /// - **A built-in iterable** -- an array, a string, a `Map`, a `Set`, a
    ///   typed array -- takes no step: its steps have no effect anything can
    ///   observe, which is the argument the stepping path makes for an array.
    /// - **A generator** steps through its resumption slot, unerased to the
    ///   abstract `Generator<T, …>` its frame extends: the walk a parameter
    ///   declared as one already takes. `suspend` adds the frames to the test
    ///   once it has made them.
    /// - **An object of the program's own with a `[Symbol.iterator]`** stops
    ///   by name. Its steps call its own `next`, which the implicit-call
    ///   analysis does not know this site reaches; a refusal instead would
    ///   refuse every such pattern in a program that merely declares one.
    /// - **Anything else** is not iterable, and the pattern throws the
    ///   `TypeError` `GetIterator` does -- `null` and `undefined` included,
    ///   where [`Self::require_object_coercible`] has not already thrown it.
    ///
    /// Every arm but the first can throw, which is why
    /// [`steps_what_arrives`] puts the function in the throwing set.
    pub(super) fn step_what_arrived(
        &mut self,
        pattern: NodeId,
        value: ValueId,
        scope: PatternScope,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(pattern);
        let done = self.new_block();
        let builtin = self.a_builtin_iterable(value, &origin);
        self.branch_to(builtin, done);
        for generator in self.synchronous_generators() {
            let is = self.push(
                OpKind::InstanceOf {
                    value,
                    classes: vec![generator],
                    by_layout: false,
                },
                HirType::Bool,
                origin.clone(),
            );
            let stepping = self.new_block();
            let next = self.new_block();
            self.terminate(Terminator::Branch {
                cond: is,
                then_target: stepping,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(stepping);
            let frame = self.push(
                OpKind::unerase(value),
                HirType::Managed(ManagedType::Object(generator)),
                origin.clone(),
            );
            self.bind_array_pattern_by_stepping(pattern, frame, scope)?;
            if !self.is_terminated() {
                self.terminate(Terminator::Jump {
                    target: done,
                    args: Vec::new(),
                });
            }
            self.switch_to(next);
        }
        let iterables = self.own_iterables();
        if !iterables.is_empty() {
            let is = self.push(
                OpKind::InstanceOf {
                    value,
                    classes: iterables,
                    by_layout: false,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.stop_when(
                pattern,
                is,
                "an array pattern stepping an object through its own `[Symbol.iterator]`",
            );
        }
        self.throw_provided_error(pattern, "TypeError", "the value is not iterable")?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: done,
                args: Vec::new(),
            });
        }
        self.switch_to(done);
        Ok(())
    }

    /// Jump to `target` where `condition` holds, and carry on in a new block
    /// where it does not.
    fn branch_to(&mut self, condition: ValueId, target: BlockId) {
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: condition,
            then_target: target,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(carry_on);
    }

    /// Whether an erased value is one of the built-in iterables, through the
    /// tests `instanceof` already makes and a string's tag.
    fn a_builtin_iterable(&mut self, value: ValueId, origin: &Origin) -> ValueId {
        let unsigned = HirType::Int {
            bits: 32,
            signed: false,
        };
        let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
        let string = self.push(
            OpKind::ConstInt(i128::from(tags::STRING)),
            unsigned,
            origin.clone(),
        );
        let mut any = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: tag,
                rhs: string,
            },
            HirType::Bool,
            origin.clone(),
        );
        for native in [Native::Array, Native::Map, Native::Set, Native::TypedArray] {
            let is = self.native_test(native, value, origin);
            any = self.bool_join(any, is, true, origin);
        }
        any
    }

    /// Each synchronous `Generator<T, …>` a frame of this program extends, in
    /// type order so one program emits one chain.
    fn synchronous_generators(&self) -> Vec<TypeId> {
        let mut generators: Vec<TypeId> = self
            .generators
            .values()
            .filter_map(|index| {
                let frame = TypeId(SYNTHETIC_GENERATOR_FRAMES + u32::try_from(*index).ok()?);
                self.generator_declared(frame)
            })
            .filter(|declared| {
                abstract_generator_kind(self.snapshot, *declared) == Some(GeneratorKind::Sync)
            })
            .collect();
        generators.sort_unstable_by_key(|ty| ty.0);
        generators.dedup();
        generators
    }

    /// The program's own classes and object literals declaring a
    /// `[Symbol.iterator]`.
    fn own_iterables(&self) -> Vec<TypeId> {
        let mut owners: Vec<TypeId> = self
            .hierarchy
            .name
            .keys()
            .copied()
            .filter(|ty| !self.hierarchy.faces.contains(ty))
            .chain(self.hierarchy.literal_methods.owners())
            .filter(|ty| self.symbol_property_name(*ty, "iterator").is_some())
            .collect();
        owners.sort_unstable_by_key(|ty| ty.0);
        owners.dedup();
        owners
    }
}
