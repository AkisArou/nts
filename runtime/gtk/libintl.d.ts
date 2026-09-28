/**
 * GNU gettext's choice of catalogue, which the `gettext` module wraps
 * (gettext.ts): glibc's own, where GLib's `g_dgettext` family looks its
 * translations up. Each answers a `char *` into its own storage, which the
 * caller neither frees nor keeps: `stringFrom` (`c:memory`) copies one.
 *
 * @ntsHeader libintl.h
 */
declare module "c:libintl" {
  import type { Ptr, c_char } from "c:types";

  export function textdomain(domainname: string | null): Ptr<c_char> | null;
  export function bindtextdomain(domainname: string, dirname: string | null): Ptr<c_char> | null;
  export function bind_textdomain_codeset(domainname: string, codeset: string | null): Ptr<c_char> | null;
}

/**
 * The locale a program's messages, dates and numbers follow.
 *
 * @ntsHeader locale.h
 */
declare module "c:locale" {
  import type { CNumber, Ptr, c_char } from "c:types";

  export function setlocale(category: CNumber<"int">, locale: string | null): Ptr<c_char> | null;
}
