//! Declaration facts for C memory remain separate from TypeScript flow types.
//!
//! These controls describe syntax and checker identities. They grant no C
//! layout, lifetime, mutation-effect or runtime ownership authority.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::num::NonZeroU16;

use nts_frontend_ts::Frontend;
use nts_semantic_schema::{
    Accessor, DeclarationModifiers, LiteralValue, MemberKind, NodeId, PropertyRecord,
    SemanticSnapshot, TypeId, TypeKind,
};

const DECLARATIONS: &str = r"
export interface Kind<T> { readonly type?: T }
export type c_ulong = number & { readonly __c_ulong?: true };
export declare const c_ulong: Kind<c_ulong>;
export declare class Point {
    private __brand: void;
    static readonly type?: Point;
    constructor(init?: { x?: number; y?: number });
    get x(): number;
    set x(value: number);
    get y(): number;
    set y(value: number);
}
export declare class Rect {
    private __brand: void;
    constructor();
    get a(): Point;
    get b(): Point;
    get name(): CArray<number, 65>;
}
export declare class Ref<T> {
    private __brand: T;
    constructor(kind: Kind<T>, initial: T);
    get value(): T;
    set value(value: T);
}
export declare class CArray<T, N extends number = number> {
    private __brand: T;
    constructor(kind: Kind<T>, length: number);
    readonly length: N;
    [index: number]: T;
}
export type CFunction<F extends (...args: any[]) => any> = F & {
    readonly __foreign: unique symbol;
};
export declare class Handle<T> {
    private __brand: T;
    constructor(value: T);
    readonly value: T;
    close(): void;
    static from<T>(token: number): Handle<T>;
}
export declare function rewrite(out: Ref<Point | null>): void;
export declare function findCallback(): CFunction<(n: number) => number> | null;
";

const MAIN: &str = r"
import { Point, Rect, Ref, CArray, Handle, c_ulong, rewrite, findCallback } from './memory.js';
export const point = new Point({ x: 1 });
export const rect = new Rect();
export const scalarRef = new Ref(c_ulong, 0);
export const points = new CArray(Point, 2);
export const handle = new Handle('context');
export const callback = findCallback();
export function nested(r: Rect) { r.a.x = 3; return r.name[0]; }
export function stale(ref: Ref<Point | null>) {
    const beforeGuard = ref.value;
    if (ref.value !== null) {
        rewrite(ref);
        const afterCWrite = ref.value;
        return afterCWrite.x;
    }
    return 0;
}
export function ordinary(box: { value: Point | null }) {
    if (box.value !== null) {
        const ordinaryNarrowed = box.value;
        return ordinaryNarrowed.x;
    }
    return 0;
}
export namespace decoy {
    export class Ref<T> { constructor(public value: T) {} }
    export function read(ref: Ref<Point | null>) { return ref.value; }
}
";

fn snapshot() -> crate::scratch::ScratchValue<SemanticSnapshot> {
    static SNAPSHOT: crate::scratch::SharedScratch<SemanticSnapshot> =
        crate::scratch::SharedScratch::new();
    SNAPSHOT.get(|| {
        let root = crate::scratch::ScratchDir::path_in_target("nts-c-memory-contracts");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("memory.d.ts"), DECLARATIONS).unwrap();
        std::fs::write(root.join("main.ts"), MAIN).unwrap();
        std::fs::write(root.join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"es2022","module":"esnext","moduleResolution":"bundler","noEmit":true,"types":[]},"files":["main.ts","memory.d.ts"]}"#).unwrap();
        let snapshot = Frontend::new(root.as_path())
            .with_checkers(NonZeroU16::MIN)
            .snapshot(&root.join("tsconfig.json"))
            .unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        Some(root.hold(snapshot))
    }).expect("owned memory-contract snapshot")
}

fn named_type(snapshot: &SemanticSnapshot, name: &str) -> TypeId {
    let types: Vec<_> = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node.text.as_ref().and_then(|s| s.as_utf8()) == Some(name))
        .filter_map(|(index, _)| {
            snapshot
                .node_types
                .get(&NodeId(u32::try_from(index).unwrap()))
                .copied()
        })
        .collect();
    assert!(!types.is_empty(), "no type for {name}");
    assert!(types.iter().all(|ty| *ty == types[0]), "{name}: {types:?}");
    types[0]
}

fn property<'a>(snapshot: &'a SemanticSnapshot, ty: TypeId, name: &str) -> &'a PropertyRecord {
    let TypeKind::Object { properties } = &snapshot.types[ty.0 as usize].kind else {
        panic!(
            "{ty:?} is not an object: {:?}",
            snapshot.types[ty.0 as usize]
        );
    };
    properties.iter().find(|p| p.name.is_name(name)).unwrap()
}

#[test]
fn struct_brands_and_accessor_mutability_are_owned_declaration_facts() {
    let owned = snapshot();
    let snapshot = &*owned;
    let point = named_type(snapshot, "point");
    let rect = named_type(snapshot, "rect");
    for ty in [point, rect] {
        let brand = property(snapshot, ty, "__brand");
        let declaration = brand.declaration.expect("brand declaration is captured");
        assert!(
            snapshot.nodes[declaration.0 as usize]
                .modifiers
                .contains(DeclarationModifiers::PRIVATE)
        );
        assert!(brand.own);
    }
    assert_eq!(
        property(snapshot, point, "x").kind,
        MemberKind::Accessor(Accessor::GetSet)
    );
    assert!(!property(snapshot, point, "x").readonly);
    for name in ["a", "b", "name"] {
        let member = property(snapshot, rect, name);
        assert!(member.own && member.readonly);
        assert_eq!(member.kind, MemberKind::Accessor(Accessor::Get));
    }
    assert_eq!(property(snapshot, rect, "a").ty, point);
    assert!(
        !property(snapshot, point, "x").readonly,
        "nested contents remain writable"
    );
}

#[test]
fn kind_constructors_and_fixed_c_array_arguments_keep_their_types() {
    let owned = snapshot();
    let snapshot = &*owned;
    let scalar_ref = named_type(snapshot, "scalarRef");
    let scalar_args = &snapshot.type_arguments[&scalar_ref];
    assert_eq!(scalar_args.len(), 1);
    assert_eq!(property(snapshot, scalar_ref, "value").ty, scalar_args[0]);

    let points = named_type(snapshot, "points");
    let point_args = &snapshot.type_arguments[&points];
    assert_eq!(point_args[0], named_type(snapshot, "point"));
    assert_eq!(
        snapshot.types[point_args[1].0 as usize].kind,
        TypeKind::Number
    );
    assert_eq!(snapshot.index_signatures[&points][0].value, point_args[0]);

    let fixed = property(snapshot, named_type(snapshot, "rect"), "name").ty;
    let fixed_args = &snapshot.type_arguments[&fixed];
    assert_eq!(
        snapshot.types[fixed_args[1].0 as usize].kind,
        TypeKind::Literal(LiteralValue::Number(65.0))
    );
    assert_eq!(property(snapshot, fixed, "length").ty, fixed_args[1]);
    assert!(property(snapshot, fixed, "length").readonly);
}

#[test]
fn foreign_callable_and_handle_arguments_remain_inspectable() {
    let owned = snapshot();
    let snapshot = &*owned;
    let handle = named_type(snapshot, "handle");
    let arguments = &snapshot.type_arguments[&handle];
    assert_eq!(arguments.len(), 1);
    assert_eq!(property(snapshot, handle, "value").ty, arguments[0]);
    assert!(property(snapshot, handle, "value").readonly);

    let callback = named_type(snapshot, "callback");
    let TypeKind::Union(parts) = &snapshot.types[callback.0 as usize].kind else {
        panic!("nullable CFunction must retain its union");
    };
    assert!(
        parts
            .iter()
            .any(|ty| snapshot.types[ty.0 as usize].kind == TypeKind::Null)
    );
    let foreign = parts
        .iter()
        .find(|ty| {
            matches!(
                snapshot.types[ty.0 as usize].kind,
                TypeKind::Intersection(_)
            )
        })
        .unwrap();
    let TypeKind::Intersection(parts) = &snapshot.types[foreign.0 as usize].kind else {
        unreachable!()
    };
    assert!(
        parts
            .iter()
            .any(|ty| matches!(snapshot.types[ty.0 as usize].kind, TypeKind::Function(_)))
    );
}

#[test]
fn a_stale_ref_flow_read_stays_distinct_from_its_declared_member_type() {
    let owned = snapshot();
    let snapshot = &*owned;
    let before = named_type(snapshot, "beforeGuard");
    let after = named_type(snapshot, "afterCWrite");
    assert!(matches!(
        snapshot.types[before.0 as usize].kind,
        TypeKind::Union(_)
    ));
    assert_eq!(
        after,
        named_type(snapshot, "point"),
        "TS retains the narrowing across rewrite(ref)"
    );
    assert_ne!(before, after);
    assert_eq!(
        named_type(snapshot, "ordinaryNarrowed"),
        after,
        "ordinary narrowing is still captured"
    );

    let refs: Vec<_> = snapshot
        .types
        .iter()
        .enumerate()
        .filter(|(_, record)| {
            record
                .symbol
                .is_some_and(|id| snapshot.symbols[id.0 as usize].name.is_name("Ref"))
        })
        .filter_map(|(index, _)| {
            let id = TypeId(u32::try_from(index).unwrap());
            snapshot
                .type_arguments
                .get(&id)
                .filter(|args| args.first() == Some(&before))
                .map(|_| id)
        })
        .collect();
    assert_eq!(
        refs.len(),
        2,
        "native Ref and same-spelled source decoy remain separate"
    );
    let native = refs
        .iter()
        .find(|ty| property(snapshot, **ty, "value").kind == MemberKind::Accessor(Accessor::GetSet))
        .unwrap();
    let declared = property(snapshot, *native, "value");
    assert_eq!(
        declared.ty, before,
        "declared member type never inherits a use-site narrowing"
    );
    assert!(declared.declaration.is_some());
    let read_types: Vec<_> = snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| {
            node.symbol.is_some_and(|id| {
                snapshot.symbols[id.0 as usize]
                    .declarations
                    .contains(&declared.declaration.unwrap())
            })
        })
        .filter_map(|(index, _)| {
            snapshot
                .node_types
                .get(&NodeId(u32::try_from(index).unwrap()))
        })
        .collect();
    assert!(
        read_types.contains(&&before),
        "unnarrowed read keeps the same member identity"
    );
    assert!(
        read_types.contains(&&after),
        "narrowed read keeps the same member identity"
    );
    let symbols: Vec<_> = refs
        .iter()
        .map(|ty| snapshot.types[ty.0 as usize].symbol.unwrap())
        .collect();
    assert_ne!(
        symbols[0], symbols[1],
        "spelling never supplies C-memory identity"
    );
}
