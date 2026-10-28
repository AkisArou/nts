// Original ast-types 0.16.1 declarations, MIT; arbitrary values are unknown.
export type Fork = {
    use<T>(plugin: Plugin<T>): T;
};
export type Plugin<T> = (fork: Fork) => T;
export type Omit<T, K> = Pick<T, Exclude<keyof T, K>>;
type Deep = boolean | ((type: Type<unknown>, value: unknown) => void);
export type Type<T> = ArrayType<T> | IdentityType<T> | ObjectType<T> | OrType<T> | PredicateType<T>;
export interface AnyType {
    toString(): string;
    check(value: unknown, deep?: Deep): boolean;
    assert(value: unknown, deep?: Deep): boolean;
    arrayOf(): AnyType;
}
declare abstract class BaseType<T> {
    abstract toString(): string;
    abstract check(value: unknown, deep?: Deep): value is T;
    assert(value: unknown, deep?: Deep): value is T;
    arrayOf(): Type<T[]>;
}
declare class ArrayType<T> extends BaseType<T> {
    readonly elemType: Type<T extends (infer E)[] ? E : never>;
    readonly kind: "ArrayType";
    constructor(elemType: Type<T extends (infer E)[] ? E : never>);
    toString(): string;
    check(value: unknown, deep?: Deep): value is T;
}
declare class IdentityType<T> extends BaseType<T> {
    readonly value: T;
    readonly kind: "IdentityType";
    constructor(value: T);
    toString(): string;
    check(value: unknown, deep?: Deep): value is T;
}
declare class ObjectType<T> extends BaseType<T> {
    readonly fields: Field<unknown>[];
    readonly kind: "ObjectType";
    constructor(fields: Field<unknown>[]);
    toString(): string;
    check(value: unknown, deep?: Deep): value is T;
}
declare class OrType<T> extends BaseType<T> {
    readonly types: Type<unknown>[];
    readonly kind: "OrType";
    constructor(types: Type<unknown>[]);
    toString(): string;
    check(value: unknown, deep?: Deep): value is T;
}
declare class PredicateType<T> extends BaseType<T> {
    readonly name: string;
    readonly predicate: (value: unknown, deep?: Deep) => boolean;
    readonly kind: "PredicateType";
    constructor(name: string, predicate: (value: unknown, deep?: Deep) => boolean);
    toString(): string;
    check(value: unknown, deep?: Deep): value is T;
}
export declare abstract class Def<T = unknown> {
    readonly type: Type<T>;
    readonly typeName: string;
    baseNames: string[];
    ownFields: {
        [name: string]: Field<unknown>;
    };
    allSupertypes: {
        [name: string]: Def<unknown>;
    };
    supertypeList: string[];
    allFields: {
        [name: string]: Field<unknown>;
    };
    fieldNames: string[];
    finalized: boolean;
    buildable: boolean;
    buildParams: string[];
    constructor(type: Type<T>, typeName: string);
    isSupertypeOf(that: Def<unknown>): boolean;
    checkAllFields(value: unknown, deep?: unknown): boolean;
    abstract check(value: unknown, deep?: unknown): boolean;
    bases(...supertypeNames: string[]): this;
    abstract build(...buildParams: string[]): this;
    abstract field(name: string, type: unknown, defaultFn?: Function, hidden?: boolean): this;
    abstract finalize(): void;
}
declare class Field<T> {
    readonly name: string;
    readonly type: Type<T>;
    readonly defaultFn?: Function | undefined;
    readonly hidden: boolean;
    constructor(name: string, type: Type<T>, defaultFn?: Function | undefined, hidden?: boolean);
    toString(): string;
    getValue(obj: {
        [key: string]: unknown;
    }): unknown;
}
type FieldType<T> = Field<T>;
export { FieldType as Field };
export interface ASTNode {
    type: string;
}
export interface Builder {
    (...args: unknown[]): ASTNode;
    from(obj: {
        [param: string]: unknown;
    }): ASTNode;
}
export default function typesPlugin(_fork: Fork): {
    Type: {
        or(...types: unknown[]): Type<unknown>;
        from<T>(value: unknown, name?: string): Type<T>;
        def(typeName: string): Def;
        hasDef(typeName: string): boolean;
    };
    builtInTypes: {
        string: Type<string>;
        function: Type<Function>;
        array: Type<unknown[]>;
        object: Type<{
            [key: string]: unknown;
        }>;
        RegExp: Type<RegExp>;
        Date: Type<Date>;
        number: Type<number>;
        boolean: Type<boolean>;
        null: Type<null>;
        undefined: Type<undefined>;
        BigInt: Type<BigInt>;
    };
    getSupertypeNames: (typeName: string) => string[];
    computeSupertypeLookupTable: (candidates: unknown) => {
        [typeName: string]: unknown;
    };
    builders: import("./gen/builders").builders;
    defineMethod: (name: unknown, func?: Function) => Function;
    getBuilderName: (typeName: unknown) => unknown;
    getStatementBuilderName: (typeName: unknown) => unknown;
    namedTypes: import("./gen/namedTypes").NamedTypes;
    getFieldNames: (object: unknown) => string[];
    getFieldValue: (object: unknown, fieldName: unknown) => unknown;
    eachField: (object: unknown, callback: (name: unknown, value: unknown) => unknown, context?: unknown) => void;
    someField: (object: unknown, callback: (name: unknown, value: unknown) => unknown, context?: unknown) => boolean;
    finalize: () => void;
};
