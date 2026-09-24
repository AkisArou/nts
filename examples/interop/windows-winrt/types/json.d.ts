// Written by hand from `Windows.Foundation.UniversalApiContract.winmd`, until
// `bind-winmd` writes Windows Runtime namespaces: `IJsonValueStatics` (IID
// 5F6B544A-2F53-48E1-91A3-F78B50A6345C) and `IJsonValue` (IID
// A3219ECB-F0B3-4DCD-BEEE-19D48CD3ED1E), whose first six slots are
// `IInspectable`'s.
declare module "winrt:Windows.Data.Json" {
  import type { c_double } from "c:types";
  import type { ComClass, HString } from "winrt:types";

  export interface IJsonValueMethods {
    /**
     * @ntsVtable 7 Stringify
     * @ntsHresult
     */
    Stringify(this: IJsonValue): HString;
    /**
     * @ntsVtable 9 GetNumber
     * @ntsHresult
     */
    GetNumber(this: IJsonValue): c_double;
  }
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;

  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
}
