// GJS's `gettext` module, imported by GJS's name and translating from a
// catalogue build.sh compiles (po/eo.po), in one line:
//
//   Saluton pomo pomoj Malfermi Saluton Untranslated
//
// `_` and `ngettext` for one and for three, `pgettext` in its context, a
// `domain`'s own `gettext`, and a text the catalogue has not got (itself).
// With no catalogue bound -- the control build.sh runs -- every one is its
// msgid. The default export (`import Gettext from "gettext"`) typechecks and
// is not read here: a default import's member is not lowered yet.
import {
  LocaleCategory,
  bindtextdomain,
  domain,
  gettext as _,
  ngettext,
  pgettext,
  setlocale,
  textdomain,
} from "gettext";
import { g_getenv } from "c:GLib-2.0";

setlocale(LocaleCategory.ALL, "");
bindtextdomain("nts-gettext", g_getenv("NTS_GETTEXT_LOCALE") ?? "locale");
textdomain("nts-gettext");

console.log(
  [
    _("Hello"),
    ngettext("apple", "apples", 1),
    ngettext("apple", "apples", 3),
    pgettext("menu", "Open"),
    domain("nts-gettext").gettext("Hello"),
    _("Untranslated"),
  ].join(" "),
);
