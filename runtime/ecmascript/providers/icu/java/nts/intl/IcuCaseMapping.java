package nts.intl;

import com.ibm.icu.lang.UCharacter;
import com.ibm.icu.util.ULocale;

/** Stateless public ICU casing primitive; locale selection belongs to shared TS. */
public final class IcuCaseMapping {
    private IcuCaseMapping() {}
    private static final ULocale TURKIC = ULocale.forLanguageTag("tr");
    private static final ULocale LITHUANIAN = ULocale.forLanguageTag("lt");
    private static final ULocale GREEK = ULocale.forLanguageTag("el");
    private static final ULocale ARMENIAN = ULocale.forLanguageTag("hy");

    public static String mapCase(String locale, String value, boolean upper) {
        IcuVersions.verify();
        // Shared TransformCase passes a root/tailoring language. Reuse those
        // immutable locale values rather than parse and allocate on each call.
        ULocale selected;
        switch (locale) {
            case "und": selected = ULocale.ROOT; break;
            case "tr": case "az": selected = TURKIC; break;
            case "lt": selected = LITHUANIAN; break;
            case "el": selected = GREEK; break;
            case "hy": selected = ARMENIAN; break;
            default: selected = ULocale.forLanguageTag(locale); break;
        }
        return upper ? UCharacter.toUpperCase(selected, value)
                     : UCharacter.toLowerCase(selected, value);
    }
}
