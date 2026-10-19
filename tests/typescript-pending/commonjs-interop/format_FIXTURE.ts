// A CommonJS module exporting a function merged with a namespace, for export-equals-merged.ts.
function format(value: number, options?: format.Options): string {
  return value.toFixed(options?.digits ?? format.defaultDigits);
}
namespace format {
  export interface Options {
    digits?: number;
  }
  export const defaultDigits = 2;
}
export = format;
