package nts.intl;

import com.ibm.icu.text.DateTimePatternGenerator;
import com.ibm.icu.text.CurrencyDisplayNames;
import com.ibm.icu.text.DisplayContext;
import com.ibm.icu.text.LocaleDisplayNames;
import com.ibm.icu.util.ULocale;

/** Name data only; validation, canonical codes and fallback stay in shared TS. */
public final class IcuDisplayNames {
    private static final int[] FIELDS = {
        DateTimePatternGenerator.ERA, DateTimePatternGenerator.YEAR, DateTimePatternGenerator.QUARTER,
        DateTimePatternGenerator.MONTH, DateTimePatternGenerator.WEEK_OF_YEAR, DateTimePatternGenerator.WEEKDAY,
        DateTimePatternGenerator.DAY, DateTimePatternGenerator.DAYPERIOD, DateTimePatternGenerator.HOUR,
        DateTimePatternGenerator.MINUTE, DateTimePatternGenerator.SECOND, DateTimePatternGenerator.ZONE,
    };
    private final int type;
    private final LocaleDisplayNames names;
    private final DateTimePatternGenerator patterns;
    private final DateTimePatternGenerator.DisplayWidth width;
    private final CurrencyDisplayNames currencies;

    public IcuDisplayNames(String tag, int type, int style, boolean dialect) {
        IcuVersions.verify();
        if (type < 0 || type > 5 || style < 0 || style > 2) throw new IllegalArgumentException("Invalid display-name data request");
        ULocale locale = ULocale.forLanguageTag(tag);
        this.type = type;
        currencies = type == 3 ? CurrencyDisplayNames.getInstance(locale, true) : null;
        if (type == 5) {
            names = null;
            patterns = DateTimePatternGenerator.getInstance(locale);
            width = DateTimePatternGenerator.DisplayWidth.values()[style];
        } else {
            patterns = null;
            width = null;
            names = LocaleDisplayNames.getInstance(locale,
                dialect ? DisplayContext.DIALECT_NAMES : DisplayContext.STANDARD_NAMES,
                DisplayContext.CAPITALIZATION_FOR_STANDALONE,
                style == 0 ? DisplayContext.LENGTH_FULL : DisplayContext.LENGTH_SHORT,
                DisplayContext.NO_SUBSTITUTE);
        }
    }

    public String name(String code, int field) {
        if (type == 5) return field >= 0 && field < FIELDS.length ? patterns.getFieldDisplayName(FIELDS[field], width) : null;
        if (field != -1) return null;
        switch (type) {
            case 0: return names.localeDisplayName(ULocale.forLanguageTag(code));
            case 1: return names.regionDisplayName(code);
            case 2: return names.scriptDisplayName(code);
            // LocaleDisplayNames' currency path also substitutes codes on
            // Java. Query public no-substitution currency data first.
            case 3: return currencies == null || currencies.getName(code) == null ? null : names.keyValueDisplayName("currency", code);
            case 4:
                String legacy = ULocale.toLegacyType("calendar", code);
                return names.keyValueDisplayName("calendar", legacy == null ? code : legacy);
            default: throw new IllegalStateException("Unrecognized display-name type");
        }
    }
}
