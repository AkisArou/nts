package nts.intl;

import com.ibm.icu.text.NumberingSystem;
import com.ibm.icu.text.Collator;
import com.ibm.icu.text.DateTimePatternGenerator;
import com.ibm.icu.lang.UScript;
import com.ibm.icu.util.Calendar;
import com.ibm.icu.util.TimeZone;
import com.ibm.icu.util.LocaleMatcher;
import com.ibm.icu.util.ULocale;
import java.util.Arrays;

/** CLDR data operations; shared TypeScript owns ECMA-402 locale semantics. */
public final class IcuLocaleData {
    private final ULocale[] available;
    private final LocaleMatcher matcher;

    public IcuLocaleData() {
        IcuVersions.verify();
        available = ULocale.getAvailableLocales();
        matcher = LocaleMatcher.builder().setSupportedULocales(Arrays.asList(available))
            .setNoDefaultLocale().build();
    }

    public String canonicalize(String tag) {
        return ULocale.createCanonical(ULocale.forLanguageTag(tag)).toLanguageTag();
    }
    public String maximize(String tag) {
        return ULocale.addLikelySubtags(ULocale.createCanonical(ULocale.forLanguageTag(tag))).toLanguageTag();
    }
    public String minimize(String tag) {
        return ULocale.minimizeSubtags(ULocale.createCanonical(ULocale.forLanguageTag(tag))).toLanguageTag();
    }
    public String defaultLocale() { return ULocale.createCanonical(ULocale.getDefault()).toLanguageTag(); }
    public int availableCount() { return available.length; }
    public String availableLocale(int index) { return ULocale.createCanonical(available[index]).toLanguageTag(); }
    public String bestFit(String tag) {
        ULocale matched = matcher.getBestMatch(ULocale.forLanguageTag(tag));
        return matched == null ? null : ULocale.createCanonical(matched).toLanguageTag();
    }
    public String defaultNumberingSystem(String locale) {
        return NumberingSystem.getInstance(ULocale.forLanguageTag(locale)).getName();
    }
    public boolean hasNumberingSystem(String name) {
        NumberingSystem system = NumberingSystem.getInstanceByName(name);
        return system != null && !system.isAlgorithmic() && system.getRadix() == 10;
    }
    public String canonicalType(String key, String value) {
        String canonical = ULocale.toUnicodeLocaleType(key, value);
        return canonical == null ? value : canonical;
    }
    public String[] calendarValues(String tag) { return calendars(tag, true); }
    public String[] availableCalendars(String tag) { return calendars(tag, false); }
    private String[] calendars(String tag, boolean commonlyUsed) {
        String[] values = Calendar.getKeywordValuesForLocale("calendar", ULocale.forLanguageTag(tag), commonlyUsed);
        for (int index = 0; index < values.length; index++) values[index] = canonicalType("ca", values[index]);
        return values;
    }
    public String[] collationValues(String tag) {
        String[] values = Collator.getKeywordValuesForLocale("collation", ULocale.forLanguageTag(tag), false);
        for (int index = 0; index < values.length; index++) values[index] = canonicalType("co", values[index]);
        return values;
    }
    public String hourCycle(String tag) {
        switch (DateTimePatternGenerator.getInstance(ULocale.forLanguageTag(tag)).getDefaultHourCycle()) {
            case HOUR_CYCLE_11: return "h11";
            case HOUR_CYCLE_12: return "h12";
            case HOUR_CYCLE_23: return "h23";
            case HOUR_CYCLE_24: return "h24";
            default: throw new IllegalStateException("Unrecognized ICU hour cycle");
        }
    }
    public String[] timeZones(String region) {
        return TimeZone.getAvailableIDs(TimeZone.SystemTimeZoneType.CANONICAL_LOCATION, region, null).toArray(new String[0]);
    }
    public String[] timeZoneNames() { return TimeZone.getAvailableIDs(); }
    public String canonicalTimeZone(String name) {
        boolean[] system = { false };
        String canonical = TimeZone.getCanonicalID(name, system);
        return system[0] ? canonical : null;
    }
    public String defaultTimeZoneIdentifier() { return TimeZone.getDefault().getID(); }
    public int textDirection(String script) {
        int code = UScript.getCodeFromName(script);
        if (code < 0 || code == UScript.UNKNOWN || code == UScript.COMMON || code == UScript.INHERITED) return -1;
        return UScript.isRightToLeft(code) ? 1 : 0;
    }
    public int weekData(String region) {
        Calendar calendar = Calendar.getInstance(TimeZone.GMT_ZONE, ULocale.forLanguageTag("und-" + region));
        int data = calendar.getFirstDayOfWeek();
        for (int day = 1; day <= 7; day++)
            if (calendar.getDayOfWeekType(day) != Calendar.WEEKDAY) data |= 1 << (day + 2);
        return data;
    }
}
