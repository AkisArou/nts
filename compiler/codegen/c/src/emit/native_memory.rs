//! Native payloads have no managed header. C independently checks the shared
//! layout calculator on every emitted definition.
use super::{CodeWriter, Diagnostic, Origin, Program, Func, OpKind, HirType, value_name, native_prototype, native_function_type, layout_of, c_type_of, c_identifier, return_c_type, static_closure_name, Spelling};
use nts_core::hir::Callee;
use nts_codegen_common::symbols::bridge_name;
use nts_core::hir::native::{NativeAbi, Pointee, Type};

/// Whether this program needs a type one of its bindings' headers defines.
///
/// The includes exist to supply *struct definitions*, so a program that names
/// no header-backed struct gets none -- which matters because an include is not
/// free here. `<stdlib.h>` declares `div`, a name a TypeScript program is
/// entitled to export, and the C compiler would then have two incompatible
/// declarations of it. Including only what a layout needs keeps that collision
/// confined to programs that actually describe a C struct, where the alternative
/// is worse: this file defining its own copy of a type a header also defines.
#[must_use]
pub(super) fn needs_headers(program: &Program) -> bool {
    nts_codegen_common::native::layouts(program)
        .is_ok_and(|layouts| layouts.structs.values().any(|layout| layout.from_header()))
}

pub(super) fn types(writer: &mut CodeWriter, origin: &Origin, program: &Program, abi: NativeAbi) -> Result<(), Diagnostic> {
    let layouts = nts_codegen_common::native::layouts(program)
        .map_err(|why| Diagnostic::error("NTS2006", why, origin.location))?;
    for (name, kind) in &layouts.tags {
        // An anonymous record has no tag to declare. Its name here is one this
        // compiler invented for the TypeScript side and for diagnostics, and
        // emitting it would declare a second, unrelated type.
        // A typedef-named record has no tag either, so there is nothing to
        // forward-declare: `__sigset_t;` is not a declaration and
        // `struct __sigset_t;` declares a *different*, incomplete type that the
        // header never defines. The header is included and provides it.
        if layouts
            .structs
            .get(name)
            .is_some_and(|record| record.untagged() || record.spelled_bare())
        {
            continue;
        }
        writer.line(origin, format!("{} {name};", kind.keyword()));
    }
    // One typedef per distinct element reached through a packed member. They
    // are what makes a load through such a pointer defined rather than merely
    // usual: reducing a type's alignment is the only way C offers to say that
    // the address may be any address.
    let mut unaligned: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for value in program.funcs.iter().flat_map(|func| &func.values) {
        if let HirType::NativePointer(pointee @ Pointee::Unaligned(_)) = &value.ty
            && let Pointee::Unaligned(inner) = pointee
        {
            unaligned.insert(inner.unaligned_definition());
        }
    }
    for definition in unaligned {
        writer.line(origin, definition);
    }
    // Definition order matters now that a member can be a struct stored inline:
    // C wants a *complete* type for that, and a forward declaration is not one.
    // `layouts.structs` is keyed by name, so emitting in map order put
    // `itimerval` before the `timeval` it contains and produced a translation
    // unit that says `field has incomplete type`.
    //
    // A pointer member needs no such ordering -- that is the whole reason C can
    // have recursive types -- so only inline members constrain this, and a cycle
    // among those is a type C cannot express. The schema already refuses to
    // build one, so an unorderable set here would mean the two disagree; it is
    // reported rather than silently truncated.
    let mut ordered: Vec<&std::sync::Arc<nts_core::hir::native::Record>> = Vec::new();
    let mut placed: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
    // A struct whose binding named a header is complete before this file says
    // anything: the include is above. It is placed first so that one of ours
    // containing it inline is orderable, and it is never defined below.
    for layout in layouts.structs.values() {
        // Anonymous records are placed and never emitted: the header defines
        // them and nothing here can name them. They are still *placed* so that
        // a record holding one is orderable.
        if layout.from_header() || layout.untagged() {
            placed.insert(layout.name.as_str());
            ordered.push(layout);
        }
    }
    while placed.len() < layouts.structs.len() {
        let before = placed.len();
        for layout in layouts.structs.values() {
            if placed.contains(layout.name.as_str()) { continue; }
            let ready = layout.fields.iter().all(|field| match &field.ty {
                Pointee::Record(inner) => placed.contains(inner.name.as_str()),
                _ => true,
            });
            if ready {
                placed.insert(layout.name.as_str());
                ordered.push(layout);
            }
        }
        if placed.len() == before {
            return Err(Diagnostic::error(
                "NTS2006",
                "native structs contain each other by value, which C cannot lay out",
                origin.location,
            ));
        }
    }
    for layout in ordered {
        let shape = nts_core::hir::layout::native_place(layout, abi)
            .ok_or_else(|| Diagnostic::error("NTS2006", "native struct has no C layout", origin.location))?;
        // Asserted for every native struct, whether defined here or included.
        // For one of ours both sides come from a single field list and this
        // only checks the arithmetic; for a header's, the C compiler answers
        // about the real type, which makes it the strongest check emitted.
        if layout.untagged() {
            // Nothing can be asserted about it either: `sizeof` and `offsetof`
            // both need a type name. What is checkable is the *enclosing*
            // record, whose size and whose members' offsets are asserted, and
            // which is where a wrong layout for this one shows up.
            continue;
        }
        if layout.from_header() {
            layout_asserts(writer, origin, layout, &shape);
            continue;
        }
        if let Some(field) = layout.fields.iter().find(|field| {
            matches!(&field.ty, Pointee::Record(inner) if inner.untagged())
        }) {
            return Err(Diagnostic::error(
                "NTS2006",
                format!(
                    "`{}` is defined by this program and holds `{}`, a record no header names: \
                     an anonymous record can only be a member of one a header defines",
                    layout.name, field.name
                ),
                origin.location,
            ));
        }
        writer.line(origin, format!("{} {} {{", layout.kind.keyword(), layout.name));
        for field in &layout.fields {
            // C spells an array's length in the *declarator*, after the name:
            // `uint8_t bytes[8]`, never `uint8_t[8] bytes`. A type spelling
            // alone cannot carry it, which is why it is written here and why
            // `Pointee::Array::c_type` answers with the element.
            // A bit-field's width lives in the declarator too, and dropping it
            // is not a spelling difference: `uint8_t p; unsigned int q;` packed
            // is five bytes and so is `uint8_t p : 6; unsigned int q : 30;`, so
            // the `sizeof` assert passes over a struct whose members are in
            // entirely different places. Only the record this program *invents*
            // is emitted here -- one the binding names a header for is included
            // rather than defined, which is why `struct iphdr` was right while
            // this was wrong.
            let suffix = match &field.ty {
                Pointee::Array { length, .. } => format!("[{length}]"),
                Pointee::Bits { width, .. } => format!(" : {width}"),
                // `T name[]`, and the brackets are the whole declaration: a
                // flexible array member has no extent to write between them.
                Pointee::Flexible(_) => "[]".to_owned(),
                _ => String::new(),
            };
            writer.line(origin, format!("    {} {}{suffix};", field.ty.c_type(), field.name));
        }
        // The attribute goes after the closing brace, where it applies to the
        // type being defined. `__attribute__((packed))` is not ISO C, and there
        // is no ISO spelling of this: a packed struct is a compiler extension
        // both clang and gcc have, and a binding describing one has to say so
        // or describe a different type.
        writer.line(origin, if layout.packed { "} __attribute__((packed));" } else { "};" });
        layout_asserts(writer, origin, layout, &shape);
    }
    Ok(())
}

/// The size, alignment and offsets this program believes, put to the C compiler.
fn layout_asserts(
    writer: &mut CodeWriter,
    origin: &Origin,
    layout: &nts_core::hir::native::Record,
    shape: &nts_core::hir::layout::Placement,
) {
    let tag = if layout.spelled_bare() {
        layout.name.clone()
    } else {
        format!("{} {}", layout.kind.keyword(), layout.name)
    };
    writer.line(origin, format!("_Static_assert(sizeof({tag}) == {}u, \"native struct size\");", shape.size));
    writer.line(origin, format!("_Static_assert(_Alignof({tag}) == {}u, \"native struct alignment\");", shape.align));
    for (field, offset) in layout.fields.iter().zip(&shape.offsets) {
        // Illegal on a bit-field, as in the witness. See `witness`.
        if matches!(field.ty, nts_core::hir::native::Pointee::Bits { .. }) {
            continue;
        }
        writer.line(origin, format!("_Static_assert(offsetof({tag}, {}) == {offset}u, \"native field offset\");", field.name));
    }
}

pub(super) fn operation(func: &Func, kind: &OpKind, result: &HirType, name: &str, origin: &Origin, abi: NativeAbi) -> Result<String, Diagnostic> {
    Ok(match *kind {
        OpKind::NativeLocal { .. } => format!("memset({name}_storage, 0, sizeof {name}_storage); {name} = {name}_storage;"),
        OpKind::NativeMalloc { bytes } => {
            let HirType::NativePointer(element) = result else { return Err(Diagnostic::error("NTS2006", "malloc needs a native layout", origin.location)); };
            let minimum = nts_core::hir::layout::native_shape(element, abi).ok_or_else(|| Diagnostic::error("NTS2006", "malloc needs a native layout", origin.location))?.size;
            let call = format!("nts_native_malloc({}, {minimum});", value_name(bytes));
            // Like an ordinary effectful call, an ignored allocation result
            // needs no C local. Keep the call even when its value is unused.
            if name.is_empty() { call } else { format!("{name} = {call}") }
        },
        OpKind::NativeFree { pointer } => format!("free({});", value_name(pointer)),
        // `*d = *s`, which is C's own aggregate assignment: the compiler picks
        // how to move the bytes and knows the type's alignment. A `memcpy` with
        // `sizeof` would be equivalent and would restate a size this file has
        // already asserted against the C compiler -- two derivations of one
        // number, which is the shape this lane keeps removing.
        OpKind::NativeCopy { destination, source } => {
            format!("*{} = *{};", value_name(destination), value_name(source))
        }
        OpKind::NativeLoad { pointer, index } => format!("{name} = {}[{}];", value_name(pointer), value_name(index)),
        OpKind::NativeStore { pointer, index, value } => format!("{}[{}] = {};", value_name(pointer), value_name(index), value_name(value)),
        OpKind::NativeIndexAddress { pointer, index } => format!("{name} = {} + {};", value_name(pointer), value_name(index)),
        // `p->ihl`, and nothing else. C already knows where the bits are --
        // the record comes from the header this program includes -- so the
        // mask and shift are the C compiler's to write, not this emitter's.
        // Reading it as a *value* is the only form available: `&p->ihl` is not
        // an expression, which is why this is its own op rather than an address
        // followed by a load.
        // `p->ihl = v`. The C compiler masks and shifts, as it does for the
        // read: the record is the header's and the bits are where it put them.
        OpKind::NativeBitStore { pointer, field, value } => {
            let member = bit_member(func, pointer, field, origin)?;
            format!("{}->{member} = {};", value_name(pointer), value_name(value))
        }
        OpKind::NativeBitLoad { pointer, field } => {
            let member = bit_member(func, pointer, field, origin)?;
            format!("{name} = {}->{member};", value_name(pointer))
        }
        OpKind::NativeFieldAddress { pointer, field } => {
            // Through a view as well: a record reached behind a packed member
            // is still a record, and its members still need addresses.
            let HirType::NativePointer(view) = &func.value(pointer).ty else {
                return Err(Diagnostic::error("NTS2006", "field address without a native struct", origin.location));
            };
            let through_packing = matches!(view, Pointee::Unaligned(_));
            let Pointee::Record(layout) = view.viewed() else {
                return Err(Diagnostic::error("NTS2006", "field address without a native struct", origin.location));
            };
            let field_index = field;
            let field = layout.fields.get(field as usize)
                .ok_or_else(|| Diagnostic::error("NTS2006", "invalid native field index", origin.location))?;
            // An array member is already an address: `p->name` decays to a
            // pointer to its first element, and `&p->name` is a pointer to the
            // *array*, which is a different type C will not assign across.
            match &field.ty {
                // An array member is already an address: `p->name` decays to a
                // pointer to its first element, and `&p->name` is a pointer to
                // the *array*, which is a different type C will not assign
                // across. Below the arithmetic arm, which handles an array of
                // its own when the enclosing record needs offsets.
                // `&p->member` on a **packed** record is `taking address of
                // packed member`, which clang reports because the result has
                // the member's type and not its alignment. Reached by byte
                // arithmetic instead -- the offset is one this file already
                // asserts against the C compiler -- so no address of a packed
                // member is ever taken, and the pointer's own type says what
                // may be read through it.
                // Byte arithmetic when the type at either end has no spelling
                // to reach through: a packed member (whose address may not be
                // taken as its own type) or an anonymous record (which has no
                // type at all). Same expression, two reasons.
                _ if layout.packed || through_packing || layout.untagged() => {
                    let shape = nts_core::hir::layout::native_place(layout, abi).ok_or_else(|| {
                        Diagnostic::error("NTS2006", "native struct has no C layout", origin.location)
                    })?;
                    let offset = shape.offsets.get(field_index as usize).ok_or_else(|| {
                        Diagnostic::error("NTS2006", "invalid native field index", origin.location)
                    })?;
                    // An array member is at the same address and has a
                    // different type: `p->name` decays to a pointer to its
                    // first element, so that is what this points at. The
                    // unaligned typedef is only for a packed member -- an
                    // anonymous record's members sit wherever the record does,
                    // which is wherever its enclosing member sits.
                    let spelled = match (&field.ty, layout.packed || through_packing) {
                        (Pointee::Array { element, .. } | Pointee::Flexible(element), _) => element.pointer_type(),
                        (other, true) => {
                            Pointee::Unaligned(Box::new(other.clone())).pointer_type()
                        }
                        (other, false) => other.pointer_type(),
                    };
                    format!(
                        "{name} = ({spelled})((char *){} + {offset});",
                        value_name(pointer)
                    )
                }
                // An array member of an ordinary record is already an address:
                // `p->name` decays to a pointer to its first element, while
                // `&p->name` is a pointer to the *array* -- a different type C
                // will not assign across. Below the arithmetic arm, which
                // spells an array of its own when the enclosing record needs
                // offsets rather than a member name.
                // A flexible array member is the same: `p->name` decays to a
                // pointer to its first element, and `&p->name` is `T (*)[]`,
                // which C will not assign to a `T *`.
                Pointee::Array { .. } | Pointee::Flexible(_) => {
                    format!("{name} = {}->{};", value_name(pointer), field.name)
                }
                // A member whose *type* is anonymous: the member has a name,
                // so `&p->member` is written as C writes it, and the result is
                // held as `char *` because nothing can name what it points at.
                Pointee::Record(inner) if inner.untagged() => {
                    format!("{name} = (char *)&{}->{};", value_name(pointer), field.name)
                }
                _ => format!("{name} = &{}->{};", value_name(pointer), field.name),
            }
        }
        _ => unreachable!("only native memory operations are routed here"),
    })
}

pub(super) fn helpers(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    if program.funcs.iter().any(|f| f.values.iter().any(|v| matches!(v.kind, OpKind::NativeMalloc { .. }))) {
        writer.line(origin, "extern void *malloc(size_t); ");
        writer.line(origin, "static inline void *nts_native_malloc(double bytes, size_t minimum) {");
        writer.line(origin, "    if (!(bytes >= (double)minimum && bytes <= 9007199254740991.0) || trunc(bytes) != bytes) return NULL;");
        writer.line(origin, "    return malloc((size_t)bytes);");
        writer.line(origin, "}");
    }
    if program.funcs.iter().any(|f| f.values.iter().any(|v| matches!(v.kind, OpKind::NativeFree { .. }))) {
        writer.line(origin, "extern void free(void *);");
    }
}

/// What this program believes about foreign types and functions, in a form that
/// a translation unit including the real headers can refuse.
///
/// The assertions in `program.c` do check the layout calculator against C's --
/// but for the struct *this program declared*, since both sides are computed
/// from one field list. They cannot notice that the declaration disagrees with
/// the library it names. This carries the same claims to where the real
/// declarations are visible, and adds the two that layout numbers cannot
/// express:
///
/// - `_Generic` over the **address** of each field. A field's own qualifiers do
///   not survive lvalue conversion -- a `const int` member answers `int` -- so
///   the value form accepts a declaration that silently drops the `const`.
/// - the prototype, because an incompatible redeclaration is an error. A call
///   expression that merely compiles is not the same check: the arguments of
///   `poll(p, n, t)` convert, so a wrong parameter width still builds.
///
/// Size, alignment and offsets do not settle it on their own. Changing a
/// field's signedness, or its pointee to another type of the same width, moves
/// none of those numbers, so a witness built only from them passes a schema
/// that is wrong about every value read through it.
///
/// There are no `#include` lines for the bindings. Which header declares
/// `poll`, under which target, sysroot and defines, is the consumer's fact and
/// not this program's; inventing one here would assert something nobody told
/// us. `<stddef.h>` is not an exception to that -- `offsetof` is the assertion
/// mechanism itself, not a binding.
///
/// Only foreign declarations appear. A layout this program invented names
/// nothing outside it, so there is no header to ask about it, and naming it
/// here would make the witness fail for a disagreement that cannot exist.
///
/// # Errors
///
/// If a native layout has no C placement. `types` reports that first for the
/// same layouts; this cannot be the only place it is noticed.
pub(super) fn witness(writer: &mut CodeWriter, origin: &Origin, program: &Program, abi: NativeAbi) -> Result<bool, Diagnostic> {
    let layouts = nts_codegen_common::native::layouts(program)
        .map_err(|why| Diagnostic::error("NTS2006", why, origin.location))?;
    let mut wrote = false;
    for layout in layouts.structs.values() {
        // An anonymous record cannot be asked about: `sizeof` and `offsetof`
        // both want a type name and it has none. Its members' *positions* are
        // still checked, through the enclosing record's own offsets.
        // `from_header`, not merely `foreign`. A tag the declaration authored
        // without naming a header is a type **this program defines** -- nothing
        // here includes a definition of it, so `sizeof(struct pair)` is an
        // incomplete type and the whole file fails to compile. That has been
        // true since the witness existed and no example reached it, because
        // every example that authors a tag also names the header it came from.
        //
        // Nothing is lost by skipping them: the witness exists to compare this
        // program's description against a header's, and for these there is no
        // header to compare against. `program.c` still asserts their size and
        // offsets against its own definition, which is the only claim available.
        if !layout.from_header() || layout.untagged() { continue; }
        let placed = nts_core::hir::layout::native_place(layout, abi)
            .ok_or_else(|| Diagnostic::error("NTS2006", "native struct has no C layout", origin.location))?;
        // `__sigset_t`, not `struct __sigset_t`: a typedef-named record has
        // no tag to write, and every assertion below names the type.
        let tag = if layout.spelled_bare() {
            layout.name.clone()
        } else {
            format!("{} {}", layout.kind.keyword(), layout.name)
        };
        writer.line(origin, format!("_Static_assert(sizeof({tag}) == {}u, \"{} size\");", placed.size, layout.name));
        writer.line(origin, format!("_Static_assert(_Alignof({tag}) == {}u, \"{} alignment\");", placed.align, layout.name));
        for (field, offset) in layout.fields.iter().zip(placed.offsets) {
            // A bit-field can be asked **neither** question. `offsetof` on one
            // is "cannot compute offset of bit-field" and `&` on one does not
            // exist, so both lines below would be errors in a file whose whole
            // job is to compile. What still covers it is the `sizeof` and
            // `_Alignof` above: a run of bit-fields allocated at the wrong
            // positions changes the size of the record holding them, which is
            // what the three probe structs in `tests/native_bitfields.rs` were
            // written to pin. Its *position* is checked by running -- see the
            // bit-field section of docs/native-operations.md.
            if matches!(field.ty, Pointee::Bits { .. }) {
                continue;
            }
            writer.line(origin, format!(
                "_Static_assert(offsetof({tag}, {}) == {offset}u, \"{}.{} offset\");",
                field.name, layout.name, field.name));
            // The address of a member, spelled as its own type. An array's is
            // `T (*)[N]` -- a pointer to the array, not to an element -- and
            // writing `T *` there would assert something true of a decayed
            // value and not of the member, which is what is being checked.
            // `_Generic` on a member whose type is anonymous has nothing to
            // name. The offset assert above still stands -- the *member* has a
            // name even where its type does not -- so its position is checked
            // and only its identity is not.
            if matches!(&field.ty, Pointee::Record(inner) if inner.untagged()) {
                continue;
            }
            let address = match &field.ty {
                Pointee::Array { element, length } => {
                    format!("{} (*)[{length}]", element.c_type())
                }
                // `T (*)[]` -- a pointer to an array of unknown bound, which is
                // a type C has and `_Generic` accepts. Checked against the real
                // `struct cmsghdr` before it was written.
                Pointee::Flexible(element) => format!("{} (*)[]", element.c_type()),
                // A member holding a callback: its address is a pointer to a
                // function pointer, and the typedef that would spell it lives
                // in `program.h`, which this file must not include. Written
                // out, the way the prototypes here already are.
                Pointee::Pointer(pointee) => match &**pointee {
                    Pointee::FnPointer(signature) => signature.anonymous_pointer(),
                    _ => field.ty.pointer_type(),
                },
                other => other.pointer_type(),
            };
            writer.line(origin, format!(
                "_Static_assert(_Generic(&((({tag} *)0)->{}), {address}: 1, default: 0), \"{}.{} type\");",
                field.name, layout.name, field.name));
        }
        wrote = true;
    }
    // Per symbol: whether a header was named, the prototype for one that has
    // none, and the function type the header's declaration must have.
    let mut declared: std::collections::BTreeMap<&str, (bool, String, String)> =
        std::collections::BTreeMap::new();
    let mut opaque: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
    for func in &program.funcs {
        for op in func.blocks.iter().flat_map(|block| &block.ops).map(|value| &func.values[value.0 as usize]) {
            let OpKind::Call { callee: Callee::Native(target), .. } = &op.kind else { continue };
            // An Objective-C message has no C declaration to compare against:
            // its header is Objective-C, which a C witness cannot include.
            // Checking a selector's types against the class is the ObjC
            // witness's job (the Apple lane's A3), not this file's.
            if !witnessable(target) { continue; }
            for ty in target.parameters.iter().chain(std::iter::once(&target.result)) {
                collect_opaque_tags(ty, &mut opaque);
            }
            // **Every** declarator in parentheses, `int (poll)(...);`: the
            // same declaration, and one no function-like macro of that name can
            // expand. The witness includes the header, and a header may define
            // any function as a macro too -- GLib 2.78's `g_free` is one, and
            // the bare `void g_free(void *);` expanded into a syntax error the
            // first time a binding freed a string with it. For every name and
            // not a list of known ones, because such a list goes stale the
            // first time a library adds a macro nobody here has met.
            declared.entry(target.name.as_str()).or_insert_with(|| {
                (
                    target.declared_at.is_some(),
                    native_prototype(&format!("({})", target.name), target, Spelling::Expanded),
                    native_function_type(target, Spelling::Expanded),
                )
            });
        }
    }
    // **A forward declaration for every opaque tag a prototype names.**
    //
    // `pointee_is_foreign` lets an opaque pointee through on the stated ground
    // that it "names one the declaration authored -- a header defines it or the
    // witness will say so". What the witness actually says when no header does
    // is `-Wvisibility`: *declaration of 'struct Counter' will not be visible
    // outside of this function*, a complaint about C scoping rather than a
    // disagreement about anything, and the file does not compile.
    //
    // `examples/interop/c-from-ts` binds an opaque `struct Counter` and is the
    // one example of sixteen whose `build.sh` has no `-fsyntax-only` line, so
    // its witness had been emitted and compiled by nothing for as long as it
    // existed. The build lane found it by adding the check.
    //
    // A forward declaration is the right answer rather than a workaround: an
    // opaque type is reached only through a pointer, which is exactly what
    // `struct X;` licenses, and it stays legal where a header *does* define the
    // struct -- a tag may be declared any number of times before it is
    // completed. So this costs nothing in the case that already worked.
    for tag in &opaque {
        writer.line(origin, format!("struct {tag};"));
        wrote = true;
    }
    for (name, (names_a_header, prototype, function_type)) in &declared {
        // **The probe goes above the declaration, and that is the whole of
        // it.** Re-declaring a prototype checks it against the header's own --
        // `fsync(void)` against `fsync(int)` is `conflicting types for 'fsync'`
        // -- but only when the header declares it at all. Name the wrong header
        // and there is nothing to conflict with: our `extern` is simply a new
        // declaration, clang accepts it, and the witness passes having compared
        // the prototype against nothing.
        //
        // Demonstrated 2026-09-15 rather than reasoned about: `getpid` under
        // `@ntsHeader stdio.h` emitted `#include <stdio.h>` and
        // `extern int getpid(void);`, and `-Wall -Wextra -Werror` was clean. A
        // check whose answer cannot depend on its input is not a check.
        //
        // `sizeof(&f)` needs `f` to be a declared identifier and evaluates
        // nothing, so it fails exactly when the named headers do not declare
        // the symbol. It must precede the `extern` below, because that line
        // would otherwise supply the declaration the probe is looking for and
        // the check would pass for every header in the world.
        //
        // Safe on this population, checked rather than assumed: all 29 libc
        // entry points these bindings reach -- including `ceil`, `fabs`,
        // `copysign` and `ldexp`, which headers routinely define as macros --
        // compile clean under `-Wall -Wextra -Werror`.
        //
        // Only where a header was named. An example's own C -- `c:counter` in
        // `c-from-ts`, whose module carries no `@ntsHeader` at all -- has
        // nothing for the prototype to be checked against, and there the
        // `extern` is a self-sufficient declaration rather than a claim about
        // somebody else's header. Probing those would fail every one of them
        // for having no header to look in, which is not a disagreement about
        // anything. `declared_at` is the same provenance the record assertions
        // filter on.
        if *names_a_header {
            writer.line(origin, format!(
                "_Static_assert(sizeof(&{name}) > 0, \"a named header declares {name}\");"));
            // **Compared, not re-declared.** A second declaration was the
            // first form of this check -- `fsync(void)` against `fsync(int)`
            // is `conflicting types` -- and it asks the question in a way that
            // can itself be wrong: Windows headers declare every Win32 entry
            // point `__declspec(dllimport)`, a re-declaration without it is
            // `-Winconsistent-dllimport`, and at `-Werror` that refused every
            // Win32 binding for a disagreement about nothing. `__typeof__`
            // reads the declaration the header made, whatever its attributes,
            // and `__builtin_types_compatible_p` is C's own compatibility rule,
            // the one a conflicting re-declaration applies.
            //
            // A function-like macro of the same name does not expand here: it
            // is not followed by `(`.
            writer.line(origin, format!(
                "_Static_assert(__builtin_types_compatible_p(__typeof__({name}), {function_type}), \"the header declares {name} as the binding does\");"));
        } else {
            writer.line(origin, format!("extern {prototype}"));
        }
        wrote = true;
    }
    Ok(wrote)
}

/// Whether every struct this type names is one a header defines.
///
/// A prototype mentioning a layout invented for this program would name a tag
/// no header declares, and the witness would fail to compile for a reason that
/// is not a disagreement about anything.
/// Every opaque struct tag a type names, including through a function pointer.
///
/// The witness has to declare these before it mentions them; see the loop that
/// writes them out for why a forward declaration is the whole of what an opaque
/// type needs.
fn collect_opaque_tags<'a>(ty: &'a Type, into: &mut std::collections::BTreeSet<&'a str>) {
    match ty {
        Type::Pointer(pointee) => collect_opaque_pointee(pointee, into),
        Type::FnPointer(signature) => {
            for ty in signature
                .parameters
                .iter()
                .chain(std::iter::once(&*signature.result))
            {
                collect_opaque_tags(ty, into);
            }
        }
        // A record by value is a complete type the header defines, not a
        // forward-declared tag.
        Type::Scalar(_) | Type::Bool | Type::Void | Type::Managed(_) | Type::Erased
        | Type::BigInt | Type::Record(_) => {}
    }
}

fn collect_opaque_pointee<'a>(
    pointee: &'a Pointee,
    into: &mut std::collections::BTreeSet<&'a str>,
) {
    match pointee {
        Pointee::Opaque(name) => {
            into.insert(name.as_str());
        }
        Pointee::FnPointer(signature) => {
            for ty in signature
                .parameters
                .iter()
                .chain(std::iter::once(&*signature.result))
            {
                collect_opaque_tags(ty, into);
            }
        }
        Pointee::Pointer(inner) | Pointee::Const(inner) | Pointee::Unaligned(inner)
        | Pointee::Flexible(inner) => collect_opaque_pointee(inner, into),
        Pointee::Array { element, .. } => collect_opaque_pointee(element, into),
        Pointee::Scalar(_) | Pointee::Void | Pointee::Bits { .. } | Pointee::Record(_) => {}
    }
}

/// Whether the witness checks this function: a C function (not a message)
/// whose every parameter and result names only what a header defines.
fn witnessable(target: &nts_core::hir::native::Function) -> bool {
    target.send.is_none()
        && target.parameters.iter().chain(std::iter::once(&target.result)).all(names_only_foreign)
}

/// Whether the witness compares this function's type with a named header's
/// declaration, which is what lets `program.c` call it through that
/// declaration instead of one of its own (`external_prototypes`).
pub(super) fn witnessed_against_a_header(target: &nts_core::hir::native::Function) -> bool {
    target.declared_at.is_some() && witnessable(target)
}

fn names_only_foreign(ty: &Type) -> bool {
    match ty {
        Type::Pointer(pointee) => pointee_is_foreign(pointee),
        Type::Scalar(_) | Type::Bool | Type::Void => true,
        // A function pointer names whatever its own signature names, so it is
        // witnessable exactly when every part of that signature is.
        Type::FnPointer(signature) => signature
            .parameters
            .iter()
            .chain(std::iter::once(&*signature.result))
            .all(names_only_foreign),
        Type::Record(layout) => layout.foreign(),
        Type::Managed(_) | Type::Erased | Type::BigInt => false,
    }
}

fn pointee_is_foreign(pointee: &Pointee) -> bool {
    match pointee {
        // None of these names a struct this program invented: a scalar and
        // `void` name no struct at all, and an opaque tag names one the
        // declaration authored -- a header defines it or the witness will say so.
        //
        // A bit-field joins them because its storage unit is a scalar. What the
        // witness cannot do *about* one is a separate matter: `offsetof` and
        // `&` are both illegal on a bit-field, so its position is checked by
        // running rather than by asserting -- see the bit-field section of
        // docs/native-operations.md.
        Pointee::Scalar(_) | Pointee::Opaque(_) | Pointee::Void | Pointee::Bits { .. } => true,
        // Witnessable exactly when every part of its signature is, which is
        // the same rule `Type::FnPointer` follows one level up.
        Pointee::FnPointer(signature) => signature
            .parameters
            .iter()
            .chain(std::iter::once(&*signature.result))
            .all(names_only_foreign),
        Pointee::Record(layout) => layout.foreign(),
        Pointee::Pointer(inner)
        | Pointee::Const(inner)
        | Pointee::Unaligned(inner)
        | Pointee::Flexible(inner)
        | Pointee::Array { element: inner, .. } => pointee_is_foreign(inner),
    }
}

/// The C name of the bridge for one function reached through one signature.
///
/// Both halves are in it because neither alone identifies the bridge: the same
/// function can be handed to two callbacks with different C signatures, and two
/// functions can share one signature.
/// The typedefs and definitions the program's `NativeBridge` operations need.
///
/// A bridge is a real C function with the foreign signature that calls the
/// compiled one, which is the only honest way across: a TypeScript function
/// value is a managed closure object, and C wants something it can call.
///
/// Emitted from a walk of the operations rather than from a list built at
/// lowering, so the set cannot drift from the uses.
///
/// # Errors
///
/// If a bridge's closure has no method, if the function it names is not in this
/// program, or if the foreign signature and the compiled function disagree
/// about arity.
pub(super) fn bridges(writer: &mut CodeWriter, origin: &Origin, program: &Program) -> Result<bool, Diagnostic> {
    let refuse = |why: &str| Diagnostic::error("NTS2006", why.to_owned(), origin.location);
    // The receiver: the static closure's name, or `None` when it arrives as
    // the context parameter.
    #[allow(clippy::type_complexity)]
    let mut wanted: std::collections::BTreeMap<String, (std::sync::Arc<nts_core::hir::native::FnPointer>, &Func, Option<String>, bool)> =
        std::collections::BTreeMap::new();
    for func in &program.funcs {
        for op in func.blocks.iter().flat_map(|block| &block.ops).map(|value| &func.values[value.0 as usize]) {
            let OpKind::NativeBridge { closure, signature, context, once } = &op.kind else { continue };
            let layout = layout_of(program, &func.values[closure.0 as usize].ty, origin)?;
            let target = layout
                .methods
                .first()
                .and_then(|method| method.as_deref())
                .ok_or_else(|| refuse(&format!(
                    "a callback bridge whose closure publishes no function (layout `{}`, {} method slot(s))",
                    layout.name,
                    layout.methods.len()
                )))?;
            let compiled = program
                .funcs
                .iter()
                .find(|candidate| candidate.name == target)
                .ok_or_else(|| refuse("a callback bridge naming a function this program does not define"))?;
            // The closure's call method takes the closure as its first
            // parameter -- that is how every call through one works -- so the
            // bridge supplies it and the foreign signature describes the rest.
            // With a context, the foreign signature's last parameter *is* that
            // receiver. And the compiled function may take *fewer* than C
            // passes -- `() => count++` is a perfectly good handler for a signal
            // that passes the instance -- so C's extra trailing arguments are
            // accepted and dropped. More than C passes is the mismatch.
            let foreign = signature.parameters.len() - usize::from(*context);
            if compiled.params.is_empty() || compiled.params.len() - 1 > foreign {
                return Err(refuse("a callback bridge whose foreign signature and compiled function disagree about arity"));
            }
            wanted.insert(
                bridge_name(target, signature, *once),
                (signature.clone(), compiled, (!*context).then(|| static_closure_name(layout)), *once),
            );
        }
    }
    if wanted.is_empty() {
        return Ok(false);
    }
    for (name, (signature, compiled, receiver, once)) in &wanted {
        let mut parameters = Vec::new();
        // The receiver is the static closure itself -- one immortal object per
        // closure with no captured state -- or, for a bridge with a context,
        // the last parameter, which is the closure C was lent and hands back.
        let last = signature.parameters.len().saturating_sub(1);
        let mut arguments = match receiver {
            Some(receiver) => vec![format!("&{receiver}")],
            None => vec![format!(
                "({})a{last}",
                c_type_of(program, &compiled.params[0].ty, &compiled.params[0].origin)?
            )],
        };
        for (at, ty) in signature.parameters.iter().enumerate() {
            let slot = format!("a{at}");
            parameters.push(format!("{} {slot}", ty.c_type()));
            if receiver.is_none() && at == last {
                continue;
            }
            // Passed by C and not taken by the compiled function.
            if at + 1 >= compiled.params.len() {
                continue;
            }
            // The compiled function takes the managed representation -- a
            // `number` is a `double` there and an `int` here -- so each argument
            // is converted on the way in and the result on the way out. C's own
            // conversions do the work; what this supplies is the target type,
            // which is the compiled function's and not the foreign one's.
            let want = c_type_of(program, &compiled.params[at + 1].ty, &compiled.params[at + 1].origin)?;
            arguments.push(format!("({want}){slot}"));
        }
        let parameters = if parameters.is_empty() { "void".to_owned() } else { parameters.join(", ") };
        let call = format!("{}({})", c_identifier(&compiled.name), arguments.join(", "));
        let result = signature.result.c_type();
        // `nts_callback_enter` around the call, so a `throw` inside it stops
        // here instead of jumping past the C frames that called us. They belong
        // to a library that knows nothing about a non-local jump, and a C
        // function pointer's signature has no error channel to deliver one
        // through -- inventing a return value would be worse than stopping,
        // since a comparator answering 0 because it failed sorts wrongly and
        // says nothing.
        // A once-bridge gives the closure back after its one call: C passes
        // nothing that would, and will not call it again.
        let unlend = if *once { format!(" nts_closure_unlend(a{last});") } else { String::new() };
        let body = if matches!(&*signature.result, nts_core::hir::native::Type::Void) {
            format!("nts_callback_enter(); {call};{unlend} nts_callback_leave();")
        } else {
            let _ = return_c_type(program, &compiled.return_type, &compiled.origin)?;
            format!(
                "nts_callback_enter(); {result} r = ({result}){call};{unlend} nts_callback_leave(); return r;"
            )
        };
        writer.line(origin, format!("static {result} {name}({parameters}) {{ {body} }}"));
    }
    Ok(true)
}

/// Every C function pointer typedef this program's foreign signatures need.
///
/// Separate from the bridge definitions and emitted much earlier, because a
/// *prototype* mentions the typedef: `int takes(NtsFn_int_int);` is a syntax
/// error before the typedef exists, and C reads it as an old-style parameter
/// list rather than reporting the missing name. The same ordering trap as an
/// inline struct member, in a different spelling.
///
/// Walked from the signatures rather than from a list built alongside them, so
/// a signature that reaches a prototype cannot fail to reach this.
pub(super) fn function_pointer_types(writer: &mut CodeWriter, origin: &Origin, program: &Program) {
    // Every signature a line of program.c can name: a native call's
    // parameters and result, and any *value* of function-pointer type. The
    // values matter on their own: an erased callback's bridge has the signature
    // C will call it with, and the call it is passed to takes a different one
    // (`GCallback`), so a walk over call types alone declared the value with a
    // name no line defined.
    let mut seen: std::collections::BTreeMap<String, std::sync::Arc<nts_core::hir::native::FnPointer>> =
        std::collections::BTreeMap::new();
    let mut note = |signature: &std::sync::Arc<nts_core::hir::native::FnPointer>| {
        seen.entry(signature.name.clone()).or_insert_with(|| signature.clone());
    };
    for func in &program.funcs {
        for value in &func.values {
            if let nts_core::hir::HirType::NativePointer(Pointee::FnPointer(signature)) = &value.ty {
                note(signature);
            }
            let nts_core::hir::OpKind::Call { callee: nts_core::hir::Callee::Native(target), .. } = &value.kind else {
                continue;
            };
            for ty in target.parameters.iter().chain(std::iter::once(&target.result)) {
                if let Type::FnPointer(signature) = ty {
                    note(signature);
                }
            }
        }
    }
    // And every one a *record* holds. A member is a use like a parameter is,
    // and the struct's own definition names the typedef -- so without this the
    // emitted `struct ops { int code; NtsFn_int_int run; };` referred to a
    // name no line declared and program.c did not compile.
    if let Ok(layouts) = nts_codegen_common::native::layouts(program) {
        for record in layouts.structs.values() {
            for field in &record.fields {
                // `Pointer(FnPointer)`: a member holding a callback is a
                // pointer to a function, so the signature is one level in.
                if let Pointee::Pointer(pointee) = &field.ty
                    && let Pointee::FnPointer(signature) = &**pointee
                {
                    note(signature);
                }
            }
        }
    }
    // **Every opaque tag a typedef mentions, declared first.** A struct tag
    // first seen inside a parameter list is scoped to that list -- clang says
    // "will not be visible outside of this function" -- so the typedef named a
    // different `struct _GObject` from every prototype that followed, and a
    // callback taking a handle was a type mismatch at each use. Repeating a
    // tag declaration is legal, so this does not ask what else declares it.
    let mut tags = std::collections::BTreeSet::new();
    for signature in seen.values() {
        for ty in signature.parameters.iter().chain(std::iter::once(&*signature.result)) {
            collect_opaque_tags(ty, &mut tags);
        }
    }
    for tag in tags {
        writer.line(origin, format!("struct {tag};"));
    }
    for signature in seen.values() {
        writer.line(origin, signature.typedef());
    }
}

/// The member name a bit-field op names, from the record its pointer points at.
fn bit_member(
    func: &Func,
    pointer: nts_core::hir::ValueId,
    field: u32,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    let HirType::NativePointer(view) = &func.value(pointer).ty else {
        return Err(Diagnostic::error(
            "NTS2006",
            "a bit-field through something that is not a native pointer",
            origin.location,
        ));
    };
    let Pointee::Record(layout) = view.viewed() else {
        return Err(Diagnostic::error(
            "NTS2006",
            "a bit-field through a pointer to something that is not a record",
            origin.location,
        ));
    };
    layout
        .fields
        .get(field as usize)
        .map(|member| member.name.clone())
        .ok_or_else(|| Diagnostic::error("NTS2006", "invalid native field index", origin.location))
}
