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
  import type { Class, ClassChain, c_int64 } from "c:types";

  export type ComClass<Tag extends string, Parent extends ClassChain | null = null> = Class<Tag, Parent> & {
    readonly __com: true;
  };

  // Any Windows Runtime object, as the metadata's `Object` is: what a
  // `PropertySet` holds, or a boxed value. `QueryInterface` is how one
  // becomes something more particular.
  export type IInspectable = ComClass<"IInspectable">;

  // A `string` as the Windows Runtime's `HSTRING`: made for the call and
  // deleted after it, and a returned one copied into a `string` and deleted.
  // The brand is optional, so any `string` passes.
  export type HString = string & { readonly __c_hstring?: true };

  // A TypeScript function where the Windows Runtime takes a delegate: a COM
  // object made for the call, whose `Invoke` calls the function and whose
  // interface is `IID`. The function may capture, and lives as long as the
  // object: a source that keeps the delegate -- an event's `add_` -- keeps it.
  // `Invoke` answers S_OK; a function that throws ends the process by name,
  // as any callback does.
  //
  // Not agile: called, or released for the last time, on another thread,
  // it ends the process by name.
  export type Delegate<F extends (...args: never[]) => void, IID extends string> = F & {
    readonly __c_closure?: "delegate";
    readonly __c_iid?: IID;
  };

  // What an event's `add_` answers and its `remove_` takes: a struct of one
  // `int64`, which both calling conventions pass exactly as the integer.
  export type EventRegistrationToken = c_int64;
}
