//! Recognize thenables and emit the jobs that assimilate and resolve them.

use super::{
    Absent, AsyncResult, Callee, ClosureInfo, ClosureSource, Diagnostic, Facts, Field, Func,
    FuncBuilder, Hierarchy, HirType, ManagedType, MemberKey, NodeId, OpKind, Origin, PAIR, Param,
    ParamShape, SemanticSnapshot, Terminator, TypeId, TypeKind, ValueId, binding_thens,
    closure_names, closure_type, erased_promise, in_a_slot, instantiation_suffix,
    is_anonymous_shape, is_generic_function, named, parameters_of, signature_key, syntax,
};

/// Which `then` a [`ClosureSource::Job`] calls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Then {
    /// A class's own method, through the ordinary dispatch: a subclass that
    /// overrides it is the one called.
    Method(TypeId),
    /// The function a binding's `then` names with `@ntsCall`, called with
    /// the thenable as its first argument. The job's node is the function.
    ///
    /// A binding's type -- a Windows Runtime `IAsyncOperation<T>` -- is a
    /// foreign handle, which has no class a run-time test could ask for: two
    /// specialisations are one handle type. So such a job is chosen from the
    /// *checker's* type at the resolve site, statically, and is never a
    /// candidate of the `instanceof` chain.
    Function,
}

/// What resolving a promise with an instance of one class does.
///
/// The specification's promise resolve function reads `then` off the value at
/// run time and, where it is callable, queues `NewPromiseResolveThenableJob`
/// -- which is how `await x` and `return x` and `resolve(x)` all come to call a
/// thenable's `then`. The program is closed, so which classes answer that
/// question is known before anything is lowered. [`thenables`] is the one
/// census of it, and every resolve site reads its answer rather than deriving
/// one.
///
/// **What a site does with a candidate depends on whether it proves the
/// value is one.** A site whose static type is the class or below it resolves
/// only with instances of it, and refuses at compile time where the answer is
/// not a plain [`Self::Job`]. A site that merely *could* receive one -- an
/// erased value, or a class below the static type -- decides when the value
/// arrives, as the specification's own `Get(x, "then")` does. Refusing those
/// would refuse every `await` of an `unknown` in a program that declares one
/// awkward `then` anywhere.
#[derive(Clone, Debug)]
pub(super) enum Thenable {
    /// Resolved through the job at this closure index.
    Job(usize),
    /// A job exists, and `then` can throw. See [`RAISING_THEN`]: refused where
    /// a site proves it, and where it is merely possible the job runs and a
    /// throw ends the program by name through the uncaught path.
    Raises(usize),
    /// A `then` no job can call, and why: refused where a site proves it, and
    /// where it is merely possible, a named stop (`nts_refused`) if one
    /// arrives.
    Refused(&'static str),
}

/// Why a `then` that can throw is refused where a site proves it reaches one.
///
/// A throw from `then` rejects the promise, so the job must catch it -- and
/// only a plain function has a raising copy to catch a throw through, which
/// is the same line a `try` around a call to such a method is refused at.
const RAISING_THEN: &str = "a thenable whose `then` can throw: the job must reject with what it throws, and a \
                            method has no raising copy to catch it through";

/// The census's two tables: the classes a resolve site tests for at run
/// time, and the binding `then`s it finds from the checker's type.
#[derive(Clone, Debug, Default)]
pub(super) struct Thenables {
    /// By the class that declares `then`.
    pub(super) classes: rustc_hash::FxHashMap<TypeId, Thenable>,
    /// By the `@ntsCall` method signature a binding declares `then` with.
    pub(super) signatures: rustc_hash::FxHashMap<NodeId, Thenable>,
}

/// A thenable job's fields: the thenable, and the promise it resolves.
fn thenable_job_fields(thenable: HirType) -> Vec<Field> {
    vec![
        Field {
            name: ("thenable".to_owned()).into(),
            ty: thenable,
            readonly: true,
            declared_by: None,
            written: None,
        },
        Field {
            name: ("promise".to_owned()).into(),
            ty: erased_promise(),
            readonly: true,
            declared_by: None,
            written: None,
        },
    ]
}

/// A module job's one field: the import's promise.
pub(super) fn module_job_fields(promise: HirType) -> Vec<Field> {
    vec![Field {
        name: ("promise".to_owned()).into(),
        ty: promise,
        readonly: true,
        declared_by: None,
        written: None,
    }]
}

/// A resolving function's fields: the promise, and which pair it is.
fn resolving_function_fields() -> Vec<Field> {
    vec![
        Field {
            name: ("promise".to_owned()).into(),
            ty: erased_promise(),
            readonly: true,
            declared_by: None,
            written: None,
        },
        Field {
            name: ("pair".to_owned()).into(),
            ty: PAIR,
            readonly: true,
            declared_by: None,
            written: None,
        },
    ]
}

/// Every class a promise can be resolved with through its `then`, and the
/// closures that do it: for each, a [`ClosureSource::Job`] and the
/// [`ClosureSource::Resolving`] pair it hands `then`, appended to `closures`.
///
/// Classes that *declare* `then` only. A subclass that inherits one is an
/// instance of the class that declared it, whose job dispatches -- so it needs
/// no job of its own, and one that overrides `then` declares it.
pub(super) fn thenables(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    hierarchy: &Hierarchy,
    throwing: &rustc_hash::FxHashSet<u32>,
    closures: &mut Vec<ClosureInfo>,
) -> Thenables {
    let mut found = rustc_hash::FxHashMap::default();
    // Sorted, so one compiler on one input numbers the closures one way.
    let mut classes: Vec<TypeId> = hierarchy
        .name
        .keys()
        .copied()
        .filter(|class| !hierarchy.faces.contains(class))
        .collect();
    classes.sort_unstable_by_key(|class| class.0);
    for class in classes {
        let Some(TypeKind::Object { properties }) = snapshot
            .types
            .get(class.0 as usize)
            .map(|record| &record.kind)
        else {
            continue;
        };
        let Some(then) = properties
            .iter()
            .find(|property| property.name.is_name("then"))
        else {
            continue;
        };
        let answer = match then.kind {
            nts_semantic_schema::MemberKind::Method
                if hierarchy.declares_itself(class, &MemberKey::named("then")) =>
            {
                match then.declaration {
                    Some(method) => {
                        class_thenable(snapshot, probe, class, method, throwing, closures)
                    }
                    None => Thenable::Refused("a thenable whose `then` has no declaration to call"),
                }
            }
            // Inherited: the declaring class's job covers it.
            nts_semantic_schema::MemberKind::Method => continue,
            // **Refused rather than skipped**, because skipping is a wrong
            // answer: the specification calls a `then` whatever kind of member
            // holds it, and a site resolving with one of these would fulfil
            // with the object where node calls it.
            nts_semantic_schema::MemberKind::Accessor(_) => Thenable::Refused(
                "a thenable whose `then` is an accessor, which a job would have to run to find the function it calls",
            ),
            nts_semantic_schema::MemberKind::Field => Thenable::Refused(
                "a thenable whose `then` is a field holding a function, which a job would call through the field rather than a method",
            ),
        };
        found.insert(class, answer);
    }
    let signatures = binding_thenables(snapshot, probe, throwing, closures);
    Thenables {
        classes: found,
        signatures,
    }
}

/// Every `then` a binding declares with `@ntsCall`, by its signature, and
/// the job for the function it names.
///
/// A Windows Runtime async operation is the case this is for: its binding
/// declares `then` on each specialisation, naming a function the binder
/// wrote beside it that subscribes `Completed` -- so `await operation` is the
/// operation itself awaited, as C# awaits it, rather than a second name for
/// it that returns a promise. In source order, so the closures are numbered
/// one way.
fn binding_thenables(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    throwing: &rustc_hash::FxHashSet<u32>,
    closures: &mut Vec<ClosureInfo>,
) -> rustc_hash::FxHashMap<NodeId, Thenable> {
    let mut found = rustc_hash::FxHashMap::default();
    for at in 0..snapshot.nodes.len() {
        let signature = NodeId(u32::try_from(at).unwrap_or(u32::MAX));
        if probe.kind_of(signature) != Some(syntax::METHOD_SIGNATURE)
            || probe.member_name(signature).as_deref() != Some("then")
        {
            continue;
        }
        let Some(name) = probe
            .node(signature)
            .native
            .as_ref()
            .and_then(|native| native.call.clone())
        else {
            continue;
        };
        let mut named = (0..snapshot.nodes.len())
            .map(|at| NodeId(u32::try_from(at).unwrap_or(u32::MAX)))
            .filter(|node| {
                probe.kind_of(*node) == Some(syntax::FUNCTION_DECLARATION)
                    && probe.has_a_body(*node)
                    && probe.declared_name(*node).as_deref() == Some(name.as_str())
            });
        let answer = match (named.next(), named.next()) {
            (Some(function), None) => {
                let callbacks: Vec<NodeId> =
                    parameters_of(probe, function).into_iter().skip(1).collect();
                thenable_job(
                    snapshot,
                    Then::Function,
                    function,
                    &callbacks,
                    throwing,
                    closures,
                )
            }
            (None, _) => Thenable::Refused(
                "a binding's `then` whose @ntsCall names a function this program does not define",
            ),
            (Some(_), Some(_)) => Thenable::Refused(
                "a binding's `then` whose @ntsCall names a function this program defines twice",
            ),
        };
        found.insert(signature, answer);
    }
    found
}

/// The job for one class's `then`, and its resolving functions, or why there
/// can be none.
fn class_thenable(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    class: TypeId,
    method: NodeId,
    throwing: &rustc_hash::FxHashSet<u32>,
    closures: &mut Vec<ClosureInfo>,
) -> Thenable {
    // Each refusal says which gap it is, because they are cleared by different
    // work, and a reader clearing one must not take the sentence for another.
    if named(snapshot, class).is_none() || is_anonymous_shape(snapshot, class) {
        // Literals of one shape share a layout, and `instanceof` is a test of
        // the layout -- so it could not say whose `then` to call.
        return Thenable::Refused(
            "an object literal with a `then` method, whose layout another literal of the same shape can share",
        );
    }
    if !instantiation_suffix(snapshot, class).is_empty() {
        return Thenable::Refused(
            "a thenable generic class: its `then` has a copy per instantiation, and the job is one per declaration",
        );
    }
    let callbacks = parameters_of(probe, method);
    thenable_job(
        snapshot,
        Then::Method(class),
        method,
        &callbacks,
        throwing,
        closures,
    )
}

/// The job that calls `then` -- a method, or a binding's function -- and the
/// resolving functions it hands it, or why there can be none. `parameters`
/// are the callbacks: all of a method's, and a function's after its receiver.
fn thenable_job(
    snapshot: &SemanticSnapshot,
    calls: Then,
    declaration: NodeId,
    parameters: &[NodeId],
    throwing: &rustc_hash::FxHashSet<u32>,
    closures: &mut Vec<ClosureInfo>,
) -> Thenable {
    if is_generic_function(snapshot, declaration) {
        return Thenable::Refused(
            "a thenable whose `then` is generic: a job calls one copy of it, and which copy a generic method needs is \
             chosen at a call site the job does not have",
        );
    }
    // Whether `then` can throw, which a job cannot catch: see `RAISING_THEN`.
    let symbol = snapshot
        .symbols
        .iter()
        .position(|record| record.declarations.contains(&declaration))
        .and_then(|at| u32::try_from(at).ok());
    let raises = symbol.is_some_and(|symbol| throwing.contains(&symbol));
    if parameters.len() > 2 {
        return Thenable::Refused(
            "a thenable whose `then` takes more than the two callbacks a job passes it",
        );
    }
    // Each parameter is the resolving function it will be handed, so each has
    // to be typed as a function: the resolving function's signature is that
    // type's, which is what makes the call `then` makes the call it built.
    let is_function = |parameter: &NodeId| {
        snapshot
            .node_types
            .get(parameter)
            .is_some_and(|ty| signature_key(snapshot, *ty).is_some())
    };
    if !parameters.iter().all(is_function) {
        return Thenable::Refused(
            "a thenable whose `then` takes a callback not typed as a function",
        );
    }
    let job = closures.len();
    let mut next = job + 1;
    let mut resolving = |at: usize| {
        parameters.get(at).map(|_| {
            let index = next;
            next += 1;
            index
        })
    };
    let resolve = resolving(0);
    let reject = resolving(1);
    closures.push(ClosureInfo {
        source: ClosureSource::Job {
            calls,
            resolve,
            reject,
        },
        ..ClosureInfo::as_written(declaration)
    });
    for (parameter, rejects) in parameters.iter().zip([false, true]) {
        closures.push(ClosureInfo {
            source: ClosureSource::Resolving { rejects },
            ..ClosureInfo::as_written(*parameter)
        });
    }
    if raises {
        Thenable::Raises(job)
    } else {
        Thenable::Job(job)
    }
}

impl FuncBuilder<'_> {
    /// `NewPromiseResolveThenableJob`: `x.then(resolve, reject)`, where `x` is
    /// the thenable a promise was resolved with.
    ///
    /// Its fields are the thenable and the promise, which the resolve site
    /// wrote. The resolving functions are made here, when the job runs rather
    /// than when it was queued, because that is where the specification makes
    /// them -- and their pair is the promise's `nts_promise_pair` now, which is
    /// the one after the use that queued this.
    pub(super) fn lower_thenable_job(
        &mut self,
        index: usize,
        declaration: NodeId,
        calls: Then,
        resolving: [Option<usize>; 2],
    ) -> Result<Func, Diagnostic> {
        let (_, name) = closure_names(index);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(declaration);
        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        let params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let thenable_ty = self.thenable_type(index)?;
        self.layouts
            .push(self.closure_layout(index, thenable_job_fields(thenable_ty.clone())));
        let thenable = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 0,
            },
            thenable_ty,
            origin.clone(),
        );
        let promise = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 1,
            },
            erased_promise(),
            origin.clone(),
        );
        let pair = self.runtime_call("nts_promise_pair", vec![promise], PAIR, origin.clone());

        // What `then` is called as, and its parameters' types after the
        // thenable: a method's own, or the named function's after its
        // receiver, which is where the thenable goes.
        let (callee, receiver_param, parameters, returns) = match calls {
            Then::Method(class) => {
                let (parameters, returns) = self.method_signature(declaration)?;
                (
                    self.callee_for(declaration, class, "then")?,
                    None,
                    parameters,
                    returns,
                )
            }
            Then::Function => {
                let function = self
                    .qualified
                    .get(&declaration)
                    .cloned()
                    .or_else(|| self.declared_name(declaration))
                    .ok_or_else(|| {
                        self.unsupported(declaration, "an @ntsCall function with no name")
                    })?;
                let mut types = Vec::new();
                for parameter in parameters_of(self, declaration) {
                    types.push(self.type_of(parameter).ok_or_else(|| {
                        self.unrepresentable(parameter, "an @ntsCall function parameter")
                    })?);
                }
                let returns = self.return_type_of(declaration)?;
                let receiver_param = (!types.is_empty()).then(|| types.remove(0));
                (Callee::Direct(function), receiver_param, types, returns)
            }
        };
        let mut args = vec![match receiver_param {
            Some(ty) => self.coerce(thenable, &ty, declaration)?,
            None => thenable,
        }];
        for (function, parameter) in resolving.into_iter().flatten().zip(&parameters) {
            let object = self.resolving_function(function, promise, pair, &origin);
            args.push(self.coerce(object, parameter, declaration)?);
        }
        for ty in parameters.iter().chain([&returns]) {
            self.materialize(declaration, ty)?;
        }
        // For a method, the ordinary dispatch, so a subclass that overrides
        // `then` is the one called: the job is per declaring class, and the
        // value may be below it.
        self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            returns,
            origin.clone(),
        );
        self.terminate(Terminator::Return(None));
        Ok(self.finish(name, params, HirType::Void, origin, false))
    }

    /// What a job holds its thenable as: an instance of the class whose
    /// `then` it calls, or what the named function takes as its receiver.
    /// Both sides of the job's layout ask this, so they agree by construction.
    fn thenable_type(&self, job: usize) -> Result<HirType, Diagnostic> {
        let info = &self.closures[job];
        match info.source {
            ClosureSource::Job {
                calls: Then::Method(class),
                ..
            } => Ok(HirType::Managed(ManagedType::Object(class))),
            ClosureSource::Job {
                calls: Then::Function,
                ..
            } => parameters_of(self, info.node)
                .first()
                .and_then(|receiver| self.type_of(*receiver))
                .ok_or_else(|| {
                    self.unsupported(
                        info.node,
                        "an @ntsCall `then` function that takes no receiver",
                    )
                }),
            _ => Err(self.unsupported(info.node, "a thenable job that is not one")),
        }
    }

    /// One of a promise's resolving functions, as a value: the closure a job
    /// hands `then`.
    fn resolving_function(
        &mut self,
        index: usize,
        promise: ValueId,
        pair: ValueId,
        origin: &Origin,
    ) -> ValueId {
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(closure_type(index))),
            origin.clone(),
        );
        self.field_set(object, 0, promise, origin);
        self.field_set(object, 1, pair, origin);
        self.layouts
            .push(self.closure_layout(index, resolving_function_fields()));
        self.used_closures.push(index);
        object
    }

    /// A resolving function's body: if its pair is unspent, resolve the promise
    /// with what it was called with, or reject it.
    ///
    /// Its signature is the `then` parameter's function type, exactly: `then`
    /// calls it as that type says, directly once specialisation has seen it and
    /// through the closure slot otherwise, and a body built from its own
    /// opinion of the signature would be called with somebody else's. So the
    /// parameters are the type's, the first is the value, and it returns what
    /// the type returns -- `undefined` of it.
    ///
    /// Resolving is `settle`, the one resolve procedure, recursively: a
    /// thenable handed to `onFulfilled` is resolved through its own job, as the
    /// specification does.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn lower_resolving_function(
        &mut self,
        index: usize,
        parameter: NodeId,
        rejects: bool,
    ) -> Result<Func, Diagnostic> {
        let (_, name) = closure_names(index);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(parameter);
        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        let mut params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        self.layouts
            .push(self.closure_layout(index, resolving_function_fields()));
        let function = self.snapshot.node_types.get(&parameter).copied();
        let Some((arguments, returned)) = function.and_then(|ty| signature_key(self.snapshot, ty))
        else {
            return Err(
                self.unsupported(parameter, "a thenable's callback not typed as a function")
            );
        };
        let mut values = Vec::new();
        for (at, argument) in arguments.iter().enumerate() {
            // As `lower_param` types a parameter, so the call `then` makes and
            // this signature agree: a `void` one is erased, see `in_a_slot`.
            let ty = self.represent(*argument).map(in_a_slot).ok_or_else(|| {
                self.unrepresentable(parameter, "a thenable callback's parameter")
            })?;
            self.materialize(parameter, &ty)?;
            let position = u32::try_from(at + 1).unwrap_or(u32::MAX);
            values.push(self.push(OpKind::Param(position), ty.clone(), origin.clone()));
            params.push(Param {
                name: if at == 0 {
                    if rejects { "reason" } else { "value" }.to_owned()
                } else {
                    format!("unused{at}")
                },
                shape: ParamShape::Ordinary,
                ty,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
        }
        let returns = self
            .represent(returned)
            .ok_or_else(|| self.unrepresentable(parameter, "a thenable callback's result"))?;
        let answers = match returns {
            HirType::Void => false,
            HirType::Erased => true,
            _ => {
                return Err(self.unsupported(
                    parameter,
                    "a thenable's callback declared to return something other than `void` or `unknown`, which \
                     a resolving function has no value of",
                ));
            }
        };

        let promise = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 0,
            },
            erased_promise(),
            origin.clone(),
        );
        let pair = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 1,
            },
            PAIR,
            origin.clone(),
        );
        let live = self.runtime_call(
            "nts_promise_claim",
            vec![promise, pair],
            HirType::Bool,
            origin.clone(),
        );
        let settles = self.new_block();
        let join = self.new_block();
        self.terminate(Terminator::Branch {
            cond: live,
            then_target: settles,
            then_args: Vec::new(),
            else_target: join,
            else_args: Vec::new(),
        });
        self.switch_to(settles);
        let value = values.first().copied();
        if rejects {
            self.reject_with(parameter, promise, value)?;
        } else {
            // **At what `then` delivers**: this function's own parameter type,
            // which `check_delivery` held the promise's payload to at the
            // resolve site. So the promise is settled as a promise of that
            // type is -- a counted handle boxed, a number as a number -- and
            // the reader at the `await`, chosen from the same type, reads it.
            // Settling through the tag instead would store a handle as an
            // erased handle where that reader expects the box.
            //
            // **Except a thenable delivered**, which is resolved in turn
            // through its own job: what finally arrives is decided by *its*
            // `then`, not by this parameter's type, so the promise is held
            // erased and the reader asks the tag -- the same step aside
            // `check_delivery` makes.
            let delivered = value.map_or(HirType::Void, |value| {
                self.values[value.0 as usize].ty.clone()
            });
            let payload = if self.thenable_candidates(&delivered).is_empty() {
                delivered
            } else {
                HirType::Erased
            };
            // A promise is never absent.
            let erased = self.erased(promise, Absent::Impossible, &origin);
            let promise = self.push(
                OpKind::unerase(erased),
                HirType::Managed(ManagedType::Promise(Box::new(payload.clone()))),
                origin.clone(),
            );
            self.settle(
                parameter,
                &AsyncResult {
                    promise,
                    payload,
                    written: None,
                },
                value,
            )?;
        }
        self.terminate(Terminator::Jump {
            target: join,
            args: Vec::new(),
        });
        self.switch_to(join);
        let answer =
            answers.then(|| self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone()));
        self.terminate(Terminator::Return(answer));
        Ok(self.finish(name, params, returns, origin, false))
    }

    pub(super) fn settled_promise(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        rejecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Promise` this compiler can settle"))?;
        let HirType::Managed(ManagedType::Promise(payload)) = ty.clone() else {
            return Err(self.unrepresentable(id, "a `Promise.resolve` result"));
        };
        let value = match arguments {
            [] => None,
            [only] => Some(self.lower_expression(*only)?),
            // `Promise.resolve(v, extra)` is not a thing the signature admits,
            // so reaching here means the shape is not what this reads.
            _ => return Err(self.unsupported(id, "a `Promise` call with this many arguments")),
        };
        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), ty, origin);
        if rejecting {
            // Through `reject_with`, which is the one place that knows an
            // erased reason takes a different helper. This was the fourth copy
            // of that decision and the second that got it wrong.
            self.reject_with(id, promise, value)?;
            return Ok(promise);
        }
        let result = AsyncResult {
            promise,
            payload: *payload,
            written: None,
        };
        self.settle(id, &result, value)?;
        Ok(promise)
    }

    /// The thenable half of the resolve procedure. Where `value` can be an
    /// instance of a class that declares `then`, ask which, and queue that
    /// class's job instead of fulfilling. `None` where its type rules every
    /// thenable out, which is almost everywhere and costs nothing.
    ///
    /// **A test per candidate, most-derived first**, each an `InstanceOf` of
    /// the class and everything under it, and a value none of them matches is
    /// fulfilled as before. A type that declares `then` itself is a candidate
    /// like any other rather than a jump straight to its job, because a
    /// reference of that type can still be `null`, which is not a thenable.
    ///
    /// A candidate the census refused refuses *here*, at the site that reaches
    /// it: the census knows why and the site knows whether, and a site that
    /// did not ask would fulfil with the object where node calls its `then`.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn settle_through_thenables(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: ValueId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        // A binding's thenable first, from the checker's type: see
        // `Then::Function` for why no run-time test could choose it.
        if let Some(job) = self.binding_thenable(id)? {
            self.check_delivery(id, job, &result.payload)?;
            let origin = self.origin(id);
            self.queue_thenable_job(id, job, value, result.promise, &origin)?;
            return Ok(Some(self.push(
                OpKind::ConstUndefined,
                HirType::Void,
                origin,
            )));
        }
        let candidates = self.thenable_candidates(&self.values[value.0 as usize].ty.clone());
        if candidates.is_empty() {
            return Ok(None);
        }
        // Where the static type is the class or below it, every value that is
        // not null is an instance: the site proves it. See `Thenable`.
        let declared = match self.values[value.0 as usize].ty {
            HirType::Managed(ManagedType::Object(declared)) => Some(declared),
            _ => None,
        };
        let mut arms = Vec::new();
        for class in candidates {
            let proven =
                declared.is_some_and(|declared| self.hierarchy.descends_from(declared, class));
            let arm = match self.thenables.classes.get(&class) {
                Some(Thenable::Raises(_)) if proven => {
                    return Err(
                        self.unsupported(id, &format!("resolving a promise with {RAISING_THEN}"))
                    );
                }
                Some(Thenable::Refused(reason)) if proven => {
                    return Err(self.unsupported(id, &format!("resolving a promise with {reason}")));
                }
                Some(Thenable::Job(job) | Thenable::Raises(job)) => Ok(*job),
                Some(Thenable::Refused(reason)) => Err(*reason),
                None => continue,
            };
            if let Ok(job) = arm {
                self.check_delivery(id, job, &result.payload)?;
            }
            arms.push((class, arm));
        }
        let origin = self.origin(id);
        // A reference of a thenable's type can still be `null`, which is no
        // thenable: its own node says which absence it is.
        let erased = self.erased_from(value, id, &origin);
        let join = self.new_block();
        for (class, arm) in arms {
            let classes = self.classes_under(class);
            let test = self.push(
                OpKind::InstanceOf {
                    value: erased,
                    classes,
                    by_layout: false,
                },
                HirType::Bool,
                origin.clone(),
            );
            let hit = self.new_block();
            let miss = self.new_block();
            self.terminate(Terminator::Branch {
                cond: test,
                then_target: hit,
                then_args: Vec::new(),
                else_target: miss,
                else_args: Vec::new(),
            });
            self.switch_to(hit);
            match arm {
                Ok(job) => {
                    let thenable = self.push(
                        OpKind::unerase(erased),
                        HirType::Managed(ManagedType::Object(class)),
                        origin.clone(),
                    );
                    self.queue_thenable_job(id, job, thenable, result.promise, &origin)?;
                    self.terminate(Terminator::Jump {
                        target: join,
                        args: Vec::new(),
                    });
                }
                // A value no job can resolve arrived, where the type only
                // allowed it: stop, naming why, rather than fulfil with it.
                Err(reason) => {
                    let what = self.push(
                        OpKind::ConstString(format!("resolving a promise with {reason}").into()),
                        HirType::Managed(ManagedType::String),
                        origin.clone(),
                    );
                    self.runtime_call("nts_refused", vec![what], HirType::Void, origin.clone());
                    self.terminate(Terminator::Unreachable);
                }
            }
            self.switch_to(miss);
        }
        // **The miss is fulfilled through the tag**, not through `fulfil`.
        // The payload was typed for what `then` delivers -- `await box` is a
        // `number` -- and a value that is not a thenable is not that: where
        // the static type declares `then`, it is only the `null` the type
        // admits. So it is resolved as an erased value is, under its own tag.
        // Where the payload can hold it, the typed reader at the `await` reads
        // it; where the checker's type said it could not arrive, that reader's
        // assertion names it rather than reading a null as a number.
        let promise = self.erased(result.promise, Absent::Impossible, &origin);
        let promise = self.push(OpKind::unerase(promise), erased_promise(), origin.clone());
        self.runtime_call(
            "nts_promise_resolve_value",
            vec![promise, erased],
            HirType::Void,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: join,
            args: Vec::new(),
        });
        self.switch_to(join);
        Ok(Some(self.push(
            OpKind::ConstUndefined,
            HirType::Void,
            origin,
        )))
    }

    /// Refuse where a thenable would resolve this promise with something its
    /// payload cannot hold.
    ///
    /// The payload is the checker's, and the checker reads `then` from the
    /// *static* type: `await held` with `held: Base` is typed `Base`, and a
    /// `Derived` that declares `then(onFulfilled: (value: number) => ...)`
    /// resolves it with a number. Node answers the number. Here the slot is a
    /// `Base` pointer, so the honest answer is to say so rather than to read a
    /// number's bits as one.
    ///
    /// What `then` delivers is its first callback's first parameter, which is
    /// the resolving function's signature. An erased payload holds anything,
    /// and two references share a reader; anything else must be the same
    /// representation.
    fn check_delivery(&self, id: NodeId, job: usize, payload: &HirType) -> Result<(), Diagnostic> {
        let ClosureSource::Job {
            resolve: Some(resolve),
            ..
        } = self.closures[job].source
        else {
            // A `then` with no `onFulfilled` never fulfils anything.
            return Ok(());
        };
        let delivered = self
            .snapshot
            .node_types
            .get(&self.closures[resolve].node)
            .and_then(|ty| signature_key(self.snapshot, *ty))
            .and_then(|(parameters, _)| parameters.first().copied())
            .and_then(|ty| self.represent(ty))
            .map(in_a_slot);
        let Some(delivered) = delivered else {
            return Ok(());
        };
        // A thenable delivered is resolved in turn, through its own job, so
        // what finally arrives is decided there -- and the reader at the
        // `await` asks its tag, which is where a mismatch then says so.
        if !self.thenable_candidates(&delivered).is_empty() {
            return Ok(());
        }
        // The resolving function settles at what it delivers, so the reader
        // here must read that: the same type, a reference beside a reference,
        // or an erased payload's tag -- except a native handle, which a
        // promise of one holds boxed and an erased reader would hand back as
        // the box.
        // A `void` payload is read by nothing, so anything may arrive in it.
        let holds = match (payload, &delivered) {
            (HirType::Void, _) => true,
            (_, HirType::NativePointer(_)) => payload == &delivered,
            (HirType::Erased, _) | (HirType::Managed(_), HirType::Managed(_)) => true,
            (payload, delivered) => payload == delivered,
        };
        if holds {
            return Ok(());
        }
        Err(self.unsupported(
            id,
            &format!(
                "resolving a promise typed to settle with {payload:?} through a thenable whose `then` delivers \
                 {delivered:?}, which the checker typed from a class above the one declaring `then`",
            ),
        ))
    }

    /// The thenable classes a value of this type can be an instance of, most
    /// derived first: those below it, and the one above it that declares
    /// `then` if it inherits one. Everything, for an erased value.
    pub(super) fn thenable_candidates(&self, ty: &HirType) -> Vec<TypeId> {
        let related = |class: &TypeId, to: TypeId| {
            self.hierarchy.descends_from(*class, to) || self.hierarchy.descends_from(to, *class)
        };
        let mut found: Vec<TypeId> = match ty {
            HirType::Erased => self.thenables.classes.keys().copied().collect(),
            HirType::Managed(ManagedType::Object(declared))
                if declared.0 < crate::hir::SYNTHETIC_TYPE_FLOOR =>
            {
                self.thenables
                    .classes
                    .keys()
                    .copied()
                    .filter(|class| related(class, *declared))
                    .collect()
            }
            _ => Vec::new(),
        };
        let depth = |class: TypeId| self.hierarchy.ancestors(class).count();
        found.sort_by_key(|class| (std::cmp::Reverse(depth(*class)), class.0));
        found
    }

    /// The job for a binding's `then`, where the value a resolve site
    /// resolves with has one in its checker type -- or the site's refusal,
    /// where the census could not make one.
    ///
    /// Static, because the type is all there is to ask: see `Then::Function`.
    /// So it is a proof, as a class at or above the static type is, and every
    /// answer that is not a plain job refuses here.
    pub(super) fn binding_thenable(&self, id: NodeId) -> Result<Option<usize>, Diagnostic> {
        if self.thenables.signatures.is_empty() {
            return Ok(None);
        }
        let Some(ty) = self
            .resolved_node(id)
            .and_then(|node| self.snapshot.node_types.get(&node).copied())
        else {
            return Ok(None);
        };
        let found = binding_thens::collect(self.snapshot, &self.thenables, ty)
            .map_err(|reason| self.unsupported(id, reason))?;
        let signature = match found {
            binding_thens::Found::None => return Ok(None),
            binding_thens::Found::One(signature, true) => signature,
            // A union that holds one: `IAsyncOperation<T> | null` is either
            // the operation or not, and which is a run-time question the
            // static choice cannot ask.
            _ => {
                return Err(self.unsupported(
                    id,
                    "resolving a promise with a value that may or may not be a binding's thenable, which is chosen \
                     from the type rather than tested for",
                ));
            }
        };
        match self.thenables.signatures.get(&signature) {
            Some(Thenable::Job(job)) => Ok(Some(*job)),
            Some(Thenable::Raises(_)) => {
                Err(self.unsupported(id, &format!("resolving a promise with {RAISING_THEN}")))
            }
            Some(Thenable::Refused(reason)) => {
                Err(self.unsupported(id, &format!("resolving a promise with {reason}")))
            }
            None => Ok(None),
        }
    }

    /// The node whose value a resolve site resolves with: what an `await`
    /// awaits and a `return` returns, the argument of `resolve(x)` or
    /// `Promise.resolve(x)`, and otherwise the site itself -- a concise
    /// `async` arrow's body is both.
    fn resolved_node(&self, id: NodeId) -> Option<NodeId> {
        match self.kind_of(id) {
            Some(syntax::AWAIT_EXPRESSION | syntax::RETURN_STATEMENT) => {
                self.children(id).first().copied()
            }
            Some(syntax::CALL_EXPRESSION) => self.arguments_of(id).first().copied(),
            _ => Some(id),
        }
    }

    /// Queue `NewPromiseResolveThenableJob` for `thenable`, to resolve
    /// `promise`: `HostEnqueuePromiseJob`, with the job the census made for its
    /// class.
    fn queue_thenable_job(
        &mut self,
        id: NodeId,
        job: usize,
        thenable: ValueId,
        promise: ValueId,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let thenable_ty = self.thenable_type(job)?;
        let thenable = self.coerce(thenable, &thenable_ty, id)?;
        // See `erased_promise`: the job holds the promise without its payload.
        let erased = self.erased(promise, Absent::Impossible, origin);
        let promise = self.push(OpKind::unerase(erased), erased_promise(), origin.clone());
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(closure_type(job))),
            origin.clone(),
        );
        self.field_set(object, 0, thenable, origin);
        self.field_set(object, 1, promise, origin);
        self.layouts
            .push(self.closure_layout(job, thenable_job_fields(thenable_ty)));
        self.used_closures.push(job);
        // Present whenever a class declares `then`, which is a superset of
        // there being a job -- see where the hierarchy numbers it.
        let Some(slot) = self.hierarchy.closure_slot else {
            return Err(self.unsupported(id, "a thenable job in a program with no closure slot"));
        };
        let slot = self.push(OpKind::DispatchSlot(slot), HirType::NUMBER, origin.clone());
        self.runtime_call(
            "nts_enqueue_job",
            vec![object, slot],
            HirType::Void,
            origin.clone(),
        );
        Ok(())
    }

    /// Settle an `async` function's promise and hand it back.
    ///
    /// The function's HIR return type is the promise, not the payload, so every
    /// `return` in the body becomes two steps: settle, then return the promise
    /// that was allocated on entry.
    ///
    /// Which `fulfill` depends on the payload's representation, which is the
    /// whole reason [`ManagedType::Promise`] carries one. The runtime stores a
    /// tagged union and the tag has to be right: a number written into the
    /// reference slot is a pointer the collector would follow.
    pub(super) fn settle_and_return(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        self.settle(id, result, value)?;
        self.terminate(Terminator::Return(Some(result.promise)));
        Ok(())
    }
}
