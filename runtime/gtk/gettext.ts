// GJS's `gettext` module, for a GTK program written as GJS writes one:
//
//   import { gettext as _, ngettext } from "gettext";
//
// The same exports, each what GJS's is (its modules/script/_gettext.js):
// GLib's `g_dgettext` family, with no domain for the program's own
// (`textdomain`), and libc's choice of catalogue and locale. A program
// reaches it through runtime/gtk/tsconfig.json, which maps the bare name
// here, as React's native base config maps its packages.
/// <reference path="./libintl.d.ts" />
import { g_dcgettext, g_dgettext, g_dngettext, g_dpgettext2 } from "c:GLib-2.0";
import { bind_textdomain_codeset, bindtextdomain, textdomain } from "c:libintl";
import { setlocale } from "c:locale";
import { stringFrom } from "c:memory";
import type { AsNumber, c_ulong } from "@nts/scalars";

/**
 * The count a plural form is chosen for: C's `unsigned long`, which is what
 * `g_dngettext` reads it as. A caller passes a count it can show is one -- a
 * literal, a length -- and any other is refused where it is passed, rather
 * than reaching C as something it never meant.
 */
export type Count = AsNumber<c_ulong>;

/** `setlocale`'s categories, glibc's `LC_*` values. */
export enum LocaleCategory {
  CTYPE = 0,
  NUMERIC = 1,
  TIME = 2,
  COLLATE = 3,
  MONETARY = 4,
  MESSAGES = 5,
  ALL = 6,
}

// The three below are exported under libc's names, as GJS's are, and
// compiled under names of their own: a compiled function is its C symbol,
// and these call libc's of the same name.

/** Set the locale of `category`, `""` for the environment's; the locale set, or `null`. */
function setLocale(category: LocaleCategory, locale: string | null): string | null {
  return stringFrom(setlocale(category, locale));
}

/** The domain `gettext` translates in: the program's own catalogue. */
function textDomain(domain: string): void {
  textdomain(domain);
}

/** Where `domain`'s catalogues are, read as UTF-8, as GJS reads them. */
function bindTextDomain(domain: string, location: string): void {
  bindtextdomain(domain, location);
  bind_textdomain_codeset(domain, "UTF-8");
}

export { bindTextDomain as bindtextdomain, setLocale as setlocale, textDomain as textdomain };

export function gettext(msgid: string): string {
  return g_dgettext(null, msgid);
}

export function dgettext(domain: string | null, msgid: string): string {
  return g_dgettext(domain, msgid);
}

export function dcgettext(domain: string | null, msgid: string, category: LocaleCategory): string {
  return g_dcgettext(domain, msgid, category);
}

/** `msgid` for one of `n`, and `msgid_plural` for any other count, translated. */
export function ngettext(msgid: string, msgid_plural: string, n: Count): string {
  return g_dngettext(null, msgid, msgid_plural, n);
}

export function dngettext(domain: string | null, msgid: string, msgid_plural: string, n: Count): string {
  return g_dngettext(domain, msgid, msgid_plural, n);
}

/** `msgid` translated in `context`, which tells two uses of one text apart. */
export function pgettext(context: string, msgid: string): string {
  return g_dpgettext2(null, context, msgid);
}

export function dpgettext(domain: string | null, context: string, msgid: string): string {
  return g_dpgettext2(domain, context, msgid);
}

/** The translating functions of one domain, a library's rather than the program's. */
export interface Domain {
  gettext(msgid: string): string;
  ngettext(msgid: string, msgid_plural: string, n: Count): string;
  pgettext(context: string, msgid: string): string;
}

export function domain(name: string): Domain {
  return {
    gettext: (msgid) => g_dgettext(name, msgid),
    ngettext: (msgid, msgid_plural, n) => g_dngettext(name, msgid, msgid_plural, n),
    pgettext: (context, msgid) => g_dpgettext2(name, context, msgid),
  };
}

export default {
  LocaleCategory,
  setlocale: setLocale,
  textdomain: textDomain,
  bindtextdomain: bindTextDomain,
  gettext,
  dgettext,
  dcgettext,
  ngettext,
  dngettext,
  pgettext,
  dpgettext,
  domain,
};
