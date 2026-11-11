//! Choose and lower foreign constructor routes and assign their construction properties.

use super::{
    BinOp, Callee, ConstructedSetter, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId,
    OpKind, SetProperty, Terminator, TypeId, TypeKind, ValueId, syntax,
};

impl FuncBuilder<'_> {
    /// `new GtkButton({ label: "Hi" })`, where the construct signature the
    /// call resolved to carries `@ntsConstruct gtk_button_new`: that function,
    /// then the setter each property's `@ntsSet` names, in the order the
    /// literal writes them -- the literal is known here, so no object is built
    /// and no property is tested for presence. `None` for any other `new`.
    ///
    /// Any further names are functions called with nothing, each answering
    /// the constructor's next argument, the rest left to its defaults:
    /// `@ntsConstruct GtkLabel_construct gtk_label_get_type` is
    /// `g_object_new_with_properties(gtk_label_get_type(), 0, NULL, NULL)`.
    pub(super) fn native_construct(&mut self, id: NodeId) -> Option<Result<ValueId, Diagnostic>> {
        if let Some(constructed) = self.gobject_new(id) {
            return Some(constructed);
        }
        let declaration = self.snapshot.call_targets.get(&id)?.callee?;
        if self.kind_of(declaration) != Some(syntax::CONSTRUCT_SIGNATURE) {
            return None;
        }
        if let Some(record) = self
            .snapshot
            .node_types
            .get(&id)
            .and_then(|ty| crate::hir::native::schema::boxed(self.snapshot, *ty))
        {
            return Some(self.new_boxed_record(id, &record));
        }
        let construct = self.node(declaration).native.as_ref()?.construct.clone()?;
        Some(self.lower_native_construct(id, &construct))
    }

    fn lower_native_construct(
        &mut self,
        id: NodeId,
        construct: &str,
    ) -> Result<ValueId, Diagnostic> {
        let construct = self.chosen_constructor(id, construct);
        // The head is `g_simple_action_new(name, parameter_type?)` whole,
        // spaces in its list included; a `GType` function may follow it.
        let (head, rest) = match (construct.find('('), construct.find(')')) {
            (Some(open), Some(close)) if open < close => {
                (&construct[..=close], &construct[close + 1..])
            }
            _ => construct
                .trim()
                .split_once(char::is_whitespace)
                .unwrap_or((construct.trim(), "")),
        };
        let head = head.trim();
        if head.is_empty() {
            return Err(self.unsupported(id, "@ntsConstruct naming no function"));
        }
        // `… with name names`: the construct-only properties a construction
        // by its `GType` can be given (`construct_with`).
        let (rest, with) = rest.split_once(" with ").unwrap_or((rest, ""));
        let with: Vec<&str> = with.split_whitespace().collect();
        let names = rest.split_whitespace();
        // `g_list_store_new(item_type)`: a class with construct-only
        // properties is made by the constructor that takes them, each the
        // literal's own; the rest are set as for any other.
        let (function, from): (&str, Vec<&str>) = match head.split_once('(') {
            Some((function, rest)) => (
                function,
                rest.trim_end_matches(')')
                    .split(',')
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .collect(),
            ),
            None => (head, Vec::new()),
        };
        let ty = self
            .snapshot
            .node_types
            .get(&id)
            .copied()
            .ok_or_else(|| self.unsupported(id, "a constructed handle with no type"))?;
        // The literal's values first, in the order it writes them -- the
        // literal is known here, so no object is built -- then the
        // constructor, then a setter for each value it did not take.
        let written = self.constructed_properties(id)?;
        if written
            .iter()
            .any(|property| with.contains(&property.name.as_str()))
        {
            let get_type = rest.split_whitespace().next().ok_or_else(|| {
                self.unsupported(id, "@ntsConstruct `with` and no `GType` function")
            })?;
            return self.construct_with(id, (function, get_type), &with, &written, ty);
        }
        let mut arguments = names
            .map(|name| self.call_foreign_named(id, name, Vec::new()).map(Some))
            .collect::<Result<Vec<_>, _>>()?;
        // `parameter_type?`: a nullable parameter, NULL where the literal
        // leaves it out.
        for name in &from {
            let (name, nullable) = name
                .strip_suffix('?')
                .map_or((*name, false), |name| (name, true));
            match written.iter().find(|written| written.name == name) {
                Some(written) => arguments.push(Some(written.value)),
                None if nullable => arguments.push(None),
                None => {
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "a handle constructed without `{name}`, which its constructor takes"
                        ),
                    ));
                }
            }
        }
        let from: Vec<&str> = from.iter().map(|name| name.trim_end_matches('?')).collect();
        let handle = self.call_foreign_named_absent(id, function, arguments)?;
        self.set_constructed(id, handle, ty, &written, &from)?;
        Ok(handle)
    }

    /// GJS's `new Gio.ThemedIcon({ name })`: a construct-only property has
    /// no setter, so the object is built with it -- `{C}_builder(type)`,
    /// `{C}_with_{name}(builder, value)` for each the literal writes of
    /// those the tag lists (`with`), then `{C}_build`, owned as the class's
    /// `{C}_construct` view is -- and the literal's other properties are set
    /// as for any construction. `view` is that view's name (`GThemedIcon_construct`)
    /// and the class's `GType` function.
    fn construct_with(
        &mut self,
        id: NodeId,
        (view, get_type): (&str, &str),
        with: &[&str],
        written: &[SetProperty],
        ty: TypeId,
    ) -> Result<ValueId, Diagnostic> {
        let class = view.strip_suffix("_construct").ok_or_else(|| {
            self.unsupported(
                id,
                "@ntsConstruct `with` on a constructor that is not a view",
            )
        })?;
        let object_type = self.call_foreign_named(id, get_type, Vec::new())?;
        let builder =
            self.call_foreign_named(id, &format!("{class}_builder"), vec![object_type])?;
        let mut given = Vec::new();
        for property in written
            .iter()
            .filter(|property| with.contains(&property.name.as_str()))
        {
            // A props object passed through gives it only where present,
            // which a build given it unconditionally would not be.
            if property.present.is_some() {
                return Err(self.unsupported(
                    id,
                    &format!("a construct-only property `{}` given through a props object rather than a literal", property.name),
                ));
            }
            self.call_foreign_named(
                id,
                &format!("{class}_with_{}", property.name),
                vec![builder, property.value],
            )?;
            given.push(property.name.as_str());
        }
        let handle = self.call_foreign_named(id, &format!("{class}_build"), vec![builder])?;
        self.set_constructed(id, handle, ty, written, &given)?;
        Ok(handle)
    }

    /// Of a binding's constructors (`g_simple_action_new(name,
    /// parameter_type?) | g_simple_action_new_stateful(name, parameter_type?,
    /// state)`), the one GJS would call: of those whose required properties
    /// the literal writes, the one taking the most of what it writes, the
    /// fewest-taking first on a tie. A props object passed through, whose
    /// keys are not known here, gets the first.
    fn chosen_constructor<'c>(&self, id: NodeId, construct: &'c str) -> &'c str {
        let alternatives: Vec<&str> = construct.split(" | ").collect();
        let [first, ..] = alternatives.as_slice() else {
            return construct;
        };
        if alternatives.len() == 1 {
            return construct;
        }
        let written: Vec<String> = match self.arguments_of(id).as_slice() {
            [literal] if self.kind_of(*literal) == Some(syntax::OBJECT_LITERAL_EXPRESSION) => self
                .children(*literal)
                .into_iter()
                .filter_map(|property| self.member_name(property))
                .collect(),
            _ => return first,
        };
        let taken = |alternative: &str| -> Vec<String> {
            alternative
                .split_once('(')
                .map(|(_, rest)| {
                    rest.trim_end()
                        .trim_end_matches(')')
                        .split(',')
                        .map(|name| name.trim().to_owned())
                        .filter(|name| !name.is_empty())
                        .collect()
                })
                .unwrap_or_default()
        };
        let mut best: Option<(&str, usize)> = None;
        for alternative in &alternatives {
            let names = taken(alternative);
            if !names
                .iter()
                .filter(|name| !name.ends_with('?'))
                .all(|name| written.contains(name))
            {
                continue;
            }
            let covered = names
                .iter()
                .filter(|name| written.contains(&name.trim_end_matches('?').to_owned()))
                .count();
            if best.is_none_or(|(_, most)| covered > most) {
                best = Some((alternative, covered));
            }
        }
        best.map_or(first, |(alternative, _)| alternative)
    }

    /// The properties a handle's `new` is given.
    ///
    /// A literal's, in the order it writes them -- `{ label }` names the
    /// local, and a computed name is refused -- each set unconditionally,
    /// with no object built. Or a props object passed through, GJS's
    /// `super(props)`: each property its type declares, read from it and set
    /// where it is not `undefined`, strictly -- `{ child: null }` sets `child`
    /// to null. A construct-only property a constructor takes is read
    /// whether or not it is there, as the type requires it to be.
    pub(super) fn constructed_properties(
        &mut self,
        id: NodeId,
    ) -> Result<Vec<SetProperty>, Diagnostic> {
        match self.arguments_of(id).as_slice() {
            [] => Ok(Vec::new()),
            [literal] if self.kind_of(*literal) == Some(syntax::OBJECT_LITERAL_EXPRESSION) => {
                let mut written = Vec::new();
                for property in self.children(*literal) {
                    let (name, value) = self.property_parts(property, None)?;
                    let name = name
                        .public_name()
                        .ok_or_else(|| {
                            self.unsupported(property, "a native property with a non-string key")
                        })?
                        .to_owned();
                    written.push(SetProperty {
                        name,
                        value,
                        node: property,
                        present: None,
                        unerase: None,
                    });
                }
                Ok(written)
            }
            [props] => self.passed_properties(*props),
            _ => Err(self.unsupported(id, "a handle constructed from more than one argument")),
        }
    }

    /// The properties of a props object passed to a construction, each with
    /// the test of whether it was given.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn passed_properties(&mut self, props: NodeId) -> Result<Vec<SetProperty>, Diagnostic> {
        let ty = *self
            .snapshot
            .node_types
            .get(&props)
            .ok_or_else(|| self.unsupported(props, "a props object with no type"))?;
        let Some(TypeKind::Object { properties }) = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| record.kind.clone())
        else {
            return Err(self.unsupported(props, "a props object whose type is not an object type"));
        };
        let object = self.lower_expression(props)?;
        let HirType::Managed(ManagedType::Object(represented)) = self.values[object.0 as usize].ty
        else {
            return Err(self.unsupported(
                props,
                "a props object that is not an object of the program's",
            ));
        };
        let layout = self.layout_of(props, represented)?;
        let origin = self.origin(props);
        let mut written = Vec::new();
        // The phantom members a binding marks its types with are not
        // properties: `__c_props`.
        for property in properties.iter().filter(|property| {
            !property
                .name
                .public_name()
                .is_some_and(|name| name.starts_with("__c_"))
        }) {
            let field = layout.index_of_key(&property.name).ok_or_else(|| {
                self.unsupported(
                    props,
                    &format!("a props object without a field for `{}`", property.name),
                )
            })?;
            let field_ty = layout.fields[field as usize].ty.clone();
            let value = self.push(
                OpKind::FieldGet { object, field },
                field_ty.clone(),
                origin.clone(),
            );
            let present = match field_ty {
                HirType::Erased => {
                    let unsigned = HirType::Int {
                        bits: 32,
                        signed: false,
                    };
                    let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
                    let undefined = self.push(
                        OpKind::ConstInt(i128::from(crate::hir::tags::UNDEFINED)),
                        unsigned,
                        origin.clone(),
                    );
                    Some(self.push(
                        OpKind::Binary {
                            op: BinOp::Ne,
                            lhs: tag,
                            rhs: undefined,
                        },
                        HirType::Bool,
                        origin.clone(),
                    ))
                }
                HirType::Managed(_) | HirType::NativePointer(_) if property.optional => {
                    let null = self.push(OpKind::ConstNull, field_ty, origin.clone());
                    Some(self.push(
                        OpKind::Binary {
                            op: BinOp::Ne,
                            lhs: value,
                            rhs: null,
                        },
                        HirType::Bool,
                        origin.clone(),
                    ))
                }
                _ => None,
            };
            // Read back where it was given, at the representation of what it is
            // when it is not `undefined`: an erased `sensitive?: boolean` is
            // the boolean the setter takes.
            let given = match self
                .snapshot
                .types
                .get(property.ty.0 as usize)
                .map(|record| &record.kind)
            {
                Some(TypeKind::Union(parts)) => {
                    let defined: Vec<TypeId> = parts
                        .iter()
                        .copied()
                        .filter(|part| {
                            !matches!(
                                self.snapshot
                                    .types
                                    .get(part.0 as usize)
                                    .map(|record| &record.kind),
                                Some(TypeKind::Undefined)
                            )
                        })
                        .collect();
                    // Each member's representation, where they share one --
                    // `boolean` is `true | false`, and an enum its members --
                    // as `present_of` reads a payload back.
                    let each: Option<Vec<HirType>> = defined
                        .iter()
                        .map(|part| self.represent_passed(*part))
                        .collect();
                    each.filter(|each| each.windows(2).all(|pair| pair[0] == pair[1]))
                        .and_then(|each| each.first().cloned())
                }
                _ => None,
            };
            let unerase = given.filter(|given| {
                self.values[value.0 as usize].ty == HirType::Erased && *given != HirType::Erased
            });
            written.push(SetProperty {
                name: property
                    .name
                    .public_name()
                    .ok_or_else(|| {
                        self.unsupported(props, "a native property with a non-string key")
                    })?
                    .to_owned(),
                value,
                node: props,
                present,
                unerase,
            });
        }
        Ok(written)
    }

    /// Each property a constructed handle was given and its constructor did
    /// not take (`except`), written through the setter its `@ntsSet` names.
    pub(super) fn set_constructed(
        &mut self,
        id: NodeId,
        handle: ValueId,
        ty: TypeId,
        written: &[SetProperty],
        except: &[&str],
    ) -> Result<(), Diagnostic> {
        for SetProperty {
            name,
            value,
            node,
            present,
            unerase,
        } in written
            .iter()
            .filter(|written| !except.contains(&written.name.as_str()))
        {
            let setter = self.constructed_setter(*node, handle, ty, name)?;
            let Some(present) = present else {
                self.write_constructed(id, handle, ty, &setter, *value)?;
                continue;
            };
            let (set, after) = (self.new_block(), self.new_block());
            self.terminate(Terminator::Branch {
                cond: *present,
                then_target: set,
                then_args: Vec::new(),
                else_target: after,
                else_args: Vec::new(),
            });
            self.switch_to(set);
            let value = match unerase {
                Some(want) => {
                    let origin = self.origin(*node);
                    self.push(OpKind::unerase(*value), want.clone(), origin)
                }
                None => *value,
            };
            self.write_constructed(id, handle, ty, &setter, value)?;
            if !self.is_terminated() {
                self.terminate(Terminator::Jump {
                    target: after,
                    args: Vec::new(),
                });
            }
            self.switch_to(after);
        }
        Ok(())
    }

    /// How a construction writes the property `name` of `ty`: a binding's
    /// property through the method its `@ntsSet` names -- asked first, so a
    /// property a subclass inherits from its base is written as the base
    /// declares it -- and a property of a class the program writes (`title:
    /// Property<string>`) through the field of its state, as `note.title =
    /// ...` writes it, so it notifies. Anything else is refused by name.
    fn constructed_setter(
        &mut self,
        node: NodeId,
        handle: ValueId,
        ty: TypeId,
        name: &str,
    ) -> Result<ConstructedSetter, Diagnostic> {
        let bound = crate::hir::native::schema::property(self.snapshot, ty, name)
            .and_then(|record| record.declaration)
            .and_then(|declaration| self.node(declaration).native.as_ref())
            .and_then(|native| native.set.clone());
        if let Some(method) = bound {
            return Ok(ConstructedSetter::Method(method));
        }
        // Only a registered property: a plain field of the state (`plain = 1`)
        // is the program's own, and a construction sets properties, as GJS's
        // does -- a props object typed wider than `Properties<T>` must not
        // reach it.
        if let Some(state) = self.state_of_type(ty)
            && self.property_notify_thunk(state.1, name).is_some()
            && let Some(place) = self.state_place(node, handle, state, name)?
        {
            return Ok(ConstructedSetter::Field(place));
        }
        Err(self.unsupported(
            node,
            &format!("a constructed property `{name}` that is neither a binding's (no @ntsSet names a method for it) nor one the class registers (`Property<T>`)"),
        ))
    }

    fn write_constructed(
        &mut self,
        id: NodeId,
        handle: ValueId,
        ty: TypeId,
        setter: &ConstructedSetter,
        value: ValueId,
    ) -> Result<(), Diagnostic> {
        match setter {
            ConstructedSetter::Method(method) => self
                .lower_accessor_on(id, handle, ty, method, Some(value))
                .map(|_| ()),
            ConstructedSetter::Field(place) => self.write_place(id, place, value),
        }
    }

    /// The function constructing the class a `new` builds, where a binding
    /// implements the class: `new URL(href, base)` is `nts:dom`'s `newURL`,
    /// declared beside the type it binds and named for it. One declaration
    /// per constructor overload and arity, as `append`'s arms are, chosen by
    /// the arguments as a delegated method's are ([`Self::delegated_method`]).
    ///
    /// The binding is read from the interface that names it
    /// (`/** @ntsBoundBy "nts:dom" URL */ interface URL {}`), which is where
    /// `bound_types` reads it too.
    pub(super) fn delegated_constructor(
        &self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Option<(NodeId, nts_semantic_schema::SignatureRecord)> {
        let built = *self.snapshot.node_types.get(&id)?;
        self.snapshot.bound_types.get(&built)?;
        let symbol = self.snapshot.types.get(built.0 as usize)?.symbol?;
        let (module, name) = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .find_map(|declaration| {
                (self.kind_of(*declaration) == Some(syntax::INTERFACE_DECLARATION))
                    .then(|| {
                        nts_semantic_schema::binding::parse(
                            self.node(*declaration)
                                .native
                                .as_deref()?
                                .bound_by
                                .as_deref()?,
                        )
                    })
                    .flatten()
            })?;
        let first = nts_semantic_schema::binding::declared_in(
            self.snapshot,
            module,
            &format!("new{name}"),
            syntax::FUNCTION_DECLARATION,
        )?;
        let TypeKind::Function(merged) = self
            .snapshot
            .types
            .get(self.snapshot.node_types.get(&first)?.0 as usize)?
            .kind
        else {
            return None;
        };
        let merged = &self.snapshot.signatures[merged.0 as usize];
        let overloads: Vec<NodeId> = self
            .name_node(first)
            .and_then(|name| self.node(name).symbol)
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(|| vec![first], |record| record.declarations.clone());
        let candidates: Vec<_> = overloads
            .into_iter()
            .map(|declaration| (declaration, self.overload_signature(declaration, merged)))
            .collect();
        // The construct signature the checker selected for this `new` is
        // what its arguments were checked against; `merged` here is the
        // binding's own constructor function, whose parameters would key
        // `record_holds` on the record's markers instead of the dictionary.
        let checked = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|target| self.snapshot.signatures.get(target.signature.0 as usize))
            .unwrap_or(merged);
        let at = self
            .shortest_fit(&candidates, checked, arguments)
            .unwrap_or(0);
        candidates.into_iter().nth(at)
    }

    /// A `new` of a class a binding implements, as a call of its constructor
    /// function ([`Self::delegated_constructor`]) at that overload's
    /// parameters.
    pub(super) fn lower_delegated_construction(
        &mut self,
        id: NodeId,
        (function, record): (NodeId, nts_semantic_schema::SignatureRecord),
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        self.refuse_dropped_arguments(function, &record, arguments)?;
        let name = nts_semantic_schema::binding::declared_name(self.snapshot, function)
            .unwrap_or_default()
            .to_owned();
        let callee = self.native_callee(id, Some(function), name, &record)?;
        let spread = self.spread_for(id, &record, arguments);
        let outer = self.delegated_signature.replace((id, record));
        let lowered = self.lower_call_arguments(id, &callee, arguments, None);
        self.delegated_signature = outer;
        self.dictionary_slots = spread;
        let (args, lent) = lowered?;
        self.finish_call(id, callee, args, lent, Some(function))
    }

    /// The type implementing `ty`, where a binding implements it -- through a
    /// `| null`, as the representation's own arm reads it.
    pub(super) fn delegated_type(&self, ty: TypeId) -> Option<TypeId> {
        if let Some(bound) = self.snapshot.bound_types.get(&ty) {
            return Some(*bound);
        }
        let TypeKind::Union(parts) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let is_null = |part: &&TypeId| {
            matches!(
                self.snapshot.types.get(part.0 as usize).map(|t| &t.kind),
                Some(TypeKind::Null)
            )
        };
        let [payload] = parts
            .iter()
            .filter(|part| !is_null(part))
            .collect::<Vec<_>>()[..]
        else {
            return None;
        };
        self.snapshot.bound_types.get(payload).copied()
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn lower_objc_new(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let Some(HirType::NativePointer(crate::hir::native::Pointee::Opaque(handle))) =
            self.type_of(id)
        else {
            return Ok(None);
        };
        if handle.family != crate::hir::native::Family::Objc {
            return Ok(None);
        }
        let Some(target) = self.snapshot.call_targets.get(&id).copied() else {
            return Err(self.unsupported(
                id,
                "a `new` of an Objective-C class the checker resolved to no constructor",
            ));
        };
        // The program's own constructor: `{Class}#new`, which makes the
        // instance. Only its own class's -- one inherited from a program
        // class would make that class's instance.
        if let Some(constructor) = target.callee.filter(|c| {
            self.kind_of(*c) == Some(syntax::CONSTRUCTOR) && self.objc_class_member(*c).is_none()
        }) {
            let declaring = self.node(constructor).parent.and_then(|mut at| {
                while self.kind_of(at).is_none() {
                    at = self.node(at).parent?;
                }
                Some(at)
            });
            let own = declaring
                .and_then(|class| crate::hir::native::objc_name(self.snapshot, class))
                .is_some_and(|name| name == handle.tag);
            if !own {
                return Err(self.unsupported(id, "a `new` of a class that inherits a constructor from a program's Objective-C class"));
            }
            let arguments = self.arguments_of(id);
            let args = self.lower_arguments(id, &arguments)?;
            let ty = HirType::NativePointer(crate::hir::native::Pointee::Opaque(handle.clone()));
            let origin = self.origin(id);
            return Ok(Some(self.push(
                OpKind::Call {
                    callee: Callee::Direct(format!("{}#new", handle.tag)),
                    args,
                    frame: None,
                },
                ty,
                origin,
            )));
        }
        let Some(constructor) = target
            .callee
            .filter(|c| self.objc_class_member(*c).is_some())
        else {
            return Err(self.unsupported(
                id,
                "a `new` of an Objective-C class whose constructor the binding does not declare",
            ));
        };
        let Some(selector) = self
            .node(constructor)
            .native
            .as_ref()
            .and_then(|n| n.selector.clone())
        else {
            return Err(self.unsupported(id, "an Objective-C constructor with no `@ntsSelector`"));
        };
        let Some(instance) = self.snapshot.node_types.get(&id).copied() else {
            return Err(self.unrepresentable(id, "a `new`"));
        };
        let arguments = self.arguments_of(id);
        let signature = self.snapshot.signatures[target.signature.0 as usize].clone();
        if let Some(factory) = selector.strip_prefix('+') {
            let mut sent = signature;
            sent.is_construct = false;
            sent.return_type = instance;
            let callee = self.native_callee_with(
                id,
                Some(constructor),
                factory.to_owned(),
                &sent,
                Some(factory.to_owned()),
                Some(handle.tag.clone()),
            )?;
            let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, None)?;
            return self
                .finish_call(id, callee, args, lent, Some(constructor))
                .map(Some);
        }
        let alloc = nts_semantic_schema::SignatureRecord {
            parameters: Vec::new(),
            return_type: instance,
            type_parameters: Vec::new(),
            is_construct: false,
            type_predicate: None,
            this_type: None,
        };
        let callee = self.native_callee_with(
            id,
            Some(constructor),
            "alloc".to_owned(),
            &alloc,
            Some("alloc".to_owned()),
            Some(handle.tag.clone()),
        )?;
        let allocated = self.finish_call(id, callee, Vec::new(), Vec::new(), Some(constructor))?;
        let mut init = signature;
        init.is_construct = false;
        init.return_type = instance;
        init.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: instance,
                optional: false,
                rest: false,
            },
        );
        let callee = self.native_callee_with(
            id,
            Some(constructor),
            selector.clone(),
            &init,
            Some(selector),
            None,
        )?;
        let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, Some(allocated))?;
        self.finish_call(id, callee, args, lent, Some(constructor))
            .map(Some)
    }
}
