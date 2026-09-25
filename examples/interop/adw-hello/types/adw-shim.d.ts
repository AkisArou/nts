// Hand-written: the shim's own declaration. libadwaita's and GTK's come from
// `types/gir`, which `nts build` generates from GIR.
/**
 * @ntsHeader "adw.h"
 */
declare module "c:adw-shim" {
  export function adw_log(line: string): void;
}
