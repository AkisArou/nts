// Hand-written. The Windows Runtime's half of `c:types`: what makes a handle a
// COM object the program counts, and a string a WinRT `HSTRING`.
//
// `ComClass<"IJsonValue">` is `Class<"IJsonValue">` with one brand beside it:
// the same chain and upcasts, and under the reference-counting provider the
// compiler adds and drops references where the program takes and loses them
// (`IUnknown::AddRef`/`Release`). A Windows Runtime method hands back an
// object the caller owns, which is released once the program is done with it;
// a binding never declares `AddRef`, `Release` or `QueryInterface`.
//
// A method is called through its interface's table, not a symbol:
//
//     /**
//      * @ntsVtable 9 GetNumber
//      * @ntsHresult
//      */
//     GetNumber(this: IJsonValue): c_double;
//
// is slot 9 of `IJsonValue`, whose C function returns an HRESULT and writes
// the `double` through one more parameter. A failed HRESULT is thrown as an
// `Error` with the system's text for it. A static of a runtime class is
// called on the class's activation factory:
//
//     /**
//      * @ntsVtable 6 Parse
//      * @ntsHresult
//      * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
//      */
//     export function Parse(input: HString): IJsonValue;
//
// One tag to a line. The slot and the method name are both the metadata's, and the compiler
// refuses a declaration whose name is not the method its slot is said to be.
declare module "winrt:types" {
  import type { CArray, CEnum, Class, ClassChain, c_int64, c_uint8, c_uint16, c_uint32, Struct } from "c:types";

  export type ComClass<Tag extends string, Parent extends ClassChain | null = null> = Class<Tag, Parent> & {
    readonly __com: true;
  };

  // Any Windows Runtime object, as the metadata's `Object` is: what a
  // `PropertySet` holds, or a boxed value. `QueryInterface` is how one
  // becomes something more particular.
  export type IInspectable = ComClass<"IInspectable">;
  // What a method taking an object takes: the object, or a string, number,
  // boolean, numeric typed array or array of strings, which is boxed into an
  // `IPropertyValue` for the call, as the Windows Runtime's JavaScript
  // projection boxed one -- `button.content = "Press"`. What a method
  // answering an object answers is the same set, unboxed: an `IPropertyValue`
  // of an `Int32Array` is one, and of `HSTRING`s a `string[]`.
  export type Inspectable =
    | IInspectable
    | string
    | number
    | boolean
    | Uint8Array
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array
    | string[];

  // A `string` as the Windows Runtime's `HSTRING`: made for the call and
  // deleted after it, and a returned one copied into a `string` and deleted.
  // The brand is optional, so any `string` passes.
  export type HString = string & { readonly __c_hstring?: true };
  // A `string[]` as the Windows Runtime's array of `HSTRING`s, where a call
  // takes one (`Counted<HStrings, ...>`): each string lent for the call, as an
  // `HString` argument is, and all of them given back after it.
  export type HStrings = readonly string[] & { readonly __c_strings?: "hstring" };

  // A struct holding a string -- `TypeName { Name: HSTRING; Kind }` -- as a
  // plain object, as the Windows Runtime's JavaScript projection held one:
  // `frame.navigate({ name: "App.MainPage", kind: TypeKind.metadata })`.
  // Never storage, since its strings are HSTRINGs nobody would own: an
  // argument is copied into the struct for the call, each string made for
  // it and deleted after; a result is copied out into a new object, each
  // string copied and deleted. `T` is the struct's layout.
  //
  // One object type rather than an intersection of the fields and the
  // marker, which is what a value's layout is read from.
  export type Copied<T extends Struct<object, string>> = Flat<
    ([T] extends [Struct<infer F, string>] ? { [K in keyof F]: CopiedField<F[K]> } : never) & {
      readonly __c_copied?: T;
    }
  >;
  type Flat<O> = { [K in keyof O]: O[K] };
  // An array of structs where a call takes one (`Counted<CopiedArray<T>,
  // ...>`): an array of plain objects, each copied into a block of the
  // structs for the call, and the block freed after it. `SetDragRectangles`
  // takes one. A struct holding a string is refused here: each would lend an
  // `HSTRING`, one per element, for the call.
  export type CopiedArray<T extends Struct<object, string>> = readonly Copied<T>[] & { readonly __c_records?: T };
  // A number field is a `number` whatever C's width is, as `Fields<T>` writes
  // one -- except an enum, which keeps its members. The enum's own marker
  // decides, since a C scalar's brand matches the `CEnum` pattern too.
  type CopiedField<V> = [V] extends [Struct<object, string>]
    ? Copied<V>
    : [V] extends [HString]
      ? string
      : [V] extends [number]
        ? "__c_enum" extends keyof V
          ? V extends CEnum<infer E, number>
            ? E
            : number
          : number
        : V;

  // A TypeScript function where the Windows Runtime takes a delegate: a COM
  // object made for the call, whose `Invoke` calls the function and whose
  // interface is `IID`. The function may capture, and lives as long as the
  // object: a source that keeps the delegate -- an event's `add_` -- keeps it.
  // `Invoke` answers S_OK; a function that throws ends the process by name,
  // as any callback does.
  //
  // Agile, as C++/WinRT's delegates are: a source calls it on whatever thread
  // it completes on. The function still runs on the thread that made it --
  // a call from another is carried there, with its objects held across, and
  // so is the last release -- so it runs after the source's call returns.
  export type Delegate<F extends (...args: never[]) => void, IID extends string> = F & {
    readonly __c_closure?: "delegate";
    readonly __c_iid?: IID;
  };

  // An event a class raises, as `addEventListener` takes its listener: the
  // delegate, and the event it is for -- `"<IID> <add> <remove>"`, the
  // interface declaring the event and its `add_` and `remove_` slots. The
  // runtime keeps the token `add_` answers, by object and listener, for
  // `removeEventListener` to give back. One object beside `F`, as
  // `Delegate`'s is, not `Delegate<F, IID>` and a second: a closure's markers
  // are read from one part.
  export type Event<F extends (...args: never[]) => void, IID extends string, Slots extends string> = F & {
    readonly __c_closure?: "delegate";
    readonly __c_iid?: IID;
    readonly __c_event?: Slots;
  };

  // What an event's `add_` answers and its `remove_` takes: a struct of one
  // `int64`, which both calling conventions pass exactly as the integer.
  export type EventRegistrationToken = c_int64;

  // `System.Guid`, which the metadata names and no `.winmd` defines: a
  // struct, crossing as the others do (`ByValue<Guid>`), laid out as C's
  // `GUID`.
  export type Guid = Struct<{ Data1: c_uint32; Data2: c_uint16; Data3: c_uint16; Data4: CArray<c_uint8, 8> }, "System_Guid">;
}
