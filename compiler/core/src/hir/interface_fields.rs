//! A field read or written through an interface, on an object whose class
//! holds the field elsewhere, stops by name (`docs/interfaces-by-shape.md`,
//! Part 0).
//!
//! An interface's fields are only where a class happens to declare them.
//! `class Green implements Channel { extra; level }` holds `level` second, and
//! an access through `Channel` names `Channel`'s index -- 0, which on a `Green`
//! is `extra`. The store landed in `extra` and the read answered it, silently
//! (`tooling/conformance/outcomes/a-field-through-an-interface-its-classes-order-differently`).
//! Where the class is known the access is through the class, and a call that
//! knows it gets a copy of its callee for it (record 0294). This is where it is
//! lost: a value of the interface's type out of an `unknown`, or out of the
//! erased join of two classes.
//!
//! So such an access tests the object's class first, against the classes
//! implementing the interface that disagree with it about the field, and one
//! of those stops naming the field. A stop and not a `TypeError`: the object
//! is a `Channel` in JavaScript's terms, and it is this compiler that cannot
//! read it there. Part 2 replaces the stop with a getter or setter the class
//! fills. Only the access is tested, not the cast that made the value, so a
//! program that calls a `Green`'s methods through `Channel` and never touches
//! the field it disagrees about runs as it did.
//!
//! After lowering, because which classes exist and how they are laid out is a
//! whole-program fact (record 0255), and after the copies that give a call its
//! class, so an access a copy made through the class is not tested. Only the
//! classes the program declares as implementing the interface are tested: one
//! that satisfies it by shape alone is Part 1's to find.

use rustc_hash::{FxHashMap, FxHashSet};

use super::fields::{LayoutIndex, shares_storage};
use super::{
    Absent, Block, BlockId, Callee, Func, HirType, Layout, ManagedType, Op, OpKind, Program,
    Terminator, TypeId, ValueId,
};

/// The classes that hold an interface's field somewhere other than the
/// interface does, keyed by the interface's layout and the field's index.
type Misfits = FxHashMap<(usize, u32), Vec<TypeId>>;

/// Test every field access through an interface that some class implementing
/// it lays out otherwise, returning how many were tested.
pub fn guard(program: &mut Program) -> usize {
    let index = LayoutIndex::build(program);
    let misfits = misfits(program, &index);
    if misfits.is_empty() {
        return 0;
    }
    let Program { funcs, layouts, .. } = program;
    funcs
        .iter_mut()
        .map(|func| guard_func(func, layouts, &index, &misfits))
        .sum()
}

/// For each interface field, the classes whose fields up to it are not the
/// interface's ([`shares_storage`]), which is when a pointer to one is not a
/// pointer to the other at that field's offset.
fn misfits(program: &Program, index: &LayoutIndex) -> Misfits {
    let mut misfits = Misfits::default();
    for (at, class) in program.layouts.iter().enumerate() {
        for face in implemented(program, index, at) {
            let interface = &program.layouts[face];
            for field in 0..interface.fields.len() {
                let field = u32::try_from(field).unwrap_or(u32::MAX);
                if !shares_storage(interface, class, field) {
                    misfits
                        .entry((face, field))
                        .or_default()
                        .extend(class.types.iter().copied());
                }
            }
        }
    }
    for classes in misfits.values_mut() {
        classes.sort_unstable();
        classes.dedup();
    }
    misfits
}

/// The layouts of the interfaces a class implements, its own and every base's:
/// a subclass of a class that disagrees with an interface disagrees too, and
/// the class test compares descriptors, so it has to name the subclass.
fn implemented(program: &Program, index: &LayoutIndex, at: usize) -> Vec<usize> {
    let mut faces = Vec::new();
    let mut layout = Some(at);
    // A base chain is acyclic in any program the checker accepted; the bound is
    // so that one that was not cannot hang the compiler.
    for _ in 0..program.layouts.len() {
        let Some(current) = layout else {
            break;
        };
        let current = &program.layouts[current];
        faces.extend(
            current
                .interfaces
                .iter()
                .filter_map(|face| index.of_class(*face)),
        );
        layout = program.base_layout(current);
    }
    faces.retain(|face| *face != at);
    faces.sort_unstable();
    faces.dedup();
    faces
}

/// An access through an interface's field that some class holds elsewhere:
/// the object, the classes, the interface's layout, the field, and whether it
/// is a write.
struct Access<'m> {
    object: ValueId,
    classes: &'m [TypeId],
    face: usize,
    field: u32,
    writes: bool,
}

fn access<'m>(
    func: &Func,
    op: ValueId,
    index: &LayoutIndex,
    misfits: &'m Misfits,
) -> Option<Access<'m>> {
    let (object, field, writes) = match &func.values[op.0 as usize].kind {
        OpKind::FieldGet { object, field } => (*object, *field, false),
        OpKind::FieldSet { object, field, .. } => (*object, *field, true),
        _ => return None,
    };
    let face = index.of(&func.values[object.0 as usize].ty)?;
    let classes = misfits.get(&(face, field))?;
    Some(Access {
        object,
        classes,
        face,
        field,
        writes,
    })
}

/// Split each block before every such access: the class test ends the block,
/// one of the disagreeing classes goes to a block that stops by name, and
/// anything else goes on to the access and the rest of the block.
fn guard_func(
    func: &mut Func,
    layouts: &[Layout],
    index: &LayoutIndex,
    misfits: &Misfits,
) -> usize {
    let mut tested: FxHashSet<ValueId> = FxHashSet::default();
    let mut at = 0;
    while at < func.blocks.len() {
        let found = func.blocks[at]
            .ops
            .iter()
            .enumerate()
            .find_map(|(position, op)| {
                if tested.contains(op) {
                    return None;
                }
                access(func, *op, index, misfits).map(|access| (position, *op, access))
            });
        let Some((position, op, access)) = found else {
            at += 1;
            continue;
        };
        tested.insert(op);
        let origin = func.values[op.0 as usize].origin.clone();
        let interface = &layouts[access.face];
        let field = &interface.fields[access.field as usize].name;
        let message = format!(
            "`{field}` {} through `{face}` on an object whose class does not hold it where \
             `{face}` does, which is the only place this compiler {} it",
            if access.writes { "written" } else { "read" },
            if access.writes { "writes" } else { "reads" },
            face = interface.name,
        );
        let classes = access.classes.to_vec();
        let mut push = |kind: OpKind, ty: HirType| {
            let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
            func.values.push(Op {
                kind,
                ty,
                origin: origin.clone(),
            });
            id
        };
        let erased = push(
            OpKind::Erase {
                value: access.object,
                absent: Absent::Impossible,
            },
            HirType::Erased,
        );
        let misfit = push(
            OpKind::InstanceOf {
                value: erased,
                classes,
            },
            HirType::Bool,
        );
        let what = push(
            OpKind::ConstString(message),
            HirType::Managed(ManagedType::String),
        );
        let stop = push(
            OpKind::Call {
                callee: Callee::External("nts_refused".to_owned()),
                args: vec![what],
                frame: None,
            },
            HirType::Void,
        );
        let rest = BlockId(u32::try_from(func.blocks.len()).unwrap_or(u32::MAX));
        let refused = BlockId(rest.0 + 1);
        let block = &mut func.blocks[at];
        let after = block.ops.split_off(position);
        block.ops.extend([erased, misfit]);
        let terminator = std::mem::replace(
            &mut block.terminator,
            Terminator::Branch {
                cond: misfit,
                then_target: refused,
                then_args: Vec::new(),
                else_target: rest,
                else_args: Vec::new(),
            },
        );
        func.blocks.push(Block {
            params: Vec::new(),
            ops: after,
            terminator,
        });
        func.blocks.push(Block {
            params: Vec::new(),
            ops: vec![what, stop],
            terminator: Terminator::Unreachable,
        });
    }
    tested.len()
}
