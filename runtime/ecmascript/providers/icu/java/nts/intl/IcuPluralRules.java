package nts.intl;

import com.ibm.icu.number.FormattedNumber;
import com.ibm.icu.number.LocalizedNumberFormatter;
import com.ibm.icu.number.LocalizedNumberRangeFormatter;
import com.ibm.icu.number.NumberFormatter;
import com.ibm.icu.number.NumberRangeFormatter;
import com.ibm.icu.number.UnlocalizedNumberFormatter;
import com.ibm.icu.text.PluralRules;
import com.ibm.icu.util.ULocale;
import java.math.BigDecimal;

/** Pinned plural data and number operands; TS owns the ECMA-402 contract. */
public final class IcuPluralRules {
    private final ULocale locale;
    private final PluralRules rules;
    private final UnlocalizedNumberFormatter positiveConfiguration, negativeConfiguration;
    private final LocalizedNumberFormatter positive, negative;
    private final boolean hasVariant;
    private final int categories;
    private LocalizedNumberRangeFormatter[] ranges;

    public IcuPluralRules(String locale, boolean ordinal, String skeleton, String negativeSkeleton) {
        IcuVersions.verify();
        this.locale = ULocale.forLanguageTag(locale);
        rules = PluralRules.forLocale(this.locale, ordinal ? PluralRules.PluralType.ORDINAL : PluralRules.PluralType.CARDINAL);
        positiveConfiguration = NumberFormatter.forSkeleton(skeleton);
        hasVariant = !negativeSkeleton.isEmpty();
        negativeConfiguration = hasVariant ? NumberFormatter.forSkeleton(negativeSkeleton) : positiveConfiguration;
        positive = positiveConfiguration.locale(this.locale);
        negative = hasVariant ? negativeConfiguration.locale(this.locale) : positive;
        int mask = 0;
        for (String category : rules.getKeywords()) mask |= 1 << categoryCode(category);
        categories = mask;
    }

    public int categories() { return categories; }
    public int select(double value, boolean negative) {
        if (!Double.isFinite(value)) return 5;
        return categoryCode(rules.select((negative ? this.negative : positive).format(value)));
    }
    public int selectDecimal(String value, boolean negative) {
        return categoryCode(rules.select((negative ? this.negative : positive).format(new BigDecimal(value))));
    }
    public int selectRange(String start, String end, boolean negativeStart, boolean negativeEnd) {
        Number first = rangeNumber(start);
        FormattedNumber from = (negativeStart ? negative : positive).format(first);
        int firstCategory = categoryCode(rules.select(from));
        if (start.equals(end) && (!hasVariant || negativeStart == negativeEnd)) return firstCategory;
        Number last = rangeNumber(end);
        if (ranges == null) ranges = new LocalizedNumberRangeFormatter[4];
        int key = hasVariant ? (negativeStart ? 1 : 0) + (negativeEnd ? 2 : 0) : 0;
        if (ranges[key] == null) {
            ranges[key] = (key == 0 || key == 3 ? NumberRangeFormatter.with()
                .numberFormatterBoth(key == 3 ? negativeConfiguration : positiveConfiguration) : NumberRangeFormatter.with()
                .numberFormatterFirst(key % 2 == 1 ? negativeConfiguration : positiveConfiguration)
                .numberFormatterSecond(key >= 2 ? negativeConfiguration : positiveConfiguration))
                .collapse(NumberRangeFormatter.RangeCollapse.NONE)
                .identityFallback(NumberRangeFormatter.RangeIdentityFallback.RANGE).locale(locale);
        }
        int rangeCategory = categoryCode(rules.select(ranges[key].formatRange(first, last)));
        // Identity cannot change the result when both branches have the same
        // category. Otherwise compare complete rounded strings, including sign
        // and notation; ICU's range identity flag is not this string contract.
        if (rangeCategory == firstCategory) return rangeCategory;
        FormattedNumber to = (negativeEnd ? negative : positive).format(last);
        return sameText(from, to) ? firstCategory : rangeCategory;
    }

    private static boolean sameText(FormattedNumber first, FormattedNumber last) {
        if (first.length() != last.length()) return false;
        for (int index = 0; index < first.length(); index++)
            if (first.charAt(index) != last.charAt(index)) return false;
        return true;
    }
    private static Number rangeNumber(String value) {
        if (value.equals("Infinity")) return Double.POSITIVE_INFINITY;
        if (value.equals("-Infinity")) return Double.NEGATIVE_INFINITY;
        if (value.equals("-0")) return -0.0;
        return new BigDecimal(value);
    }
    private static int categoryCode(String category) {
        switch (category) {
            case "zero": return 0;
            case "one": return 1;
            case "two": return 2;
            case "few": return 3;
            case "many": return 4;
            case "other": return 5;
            default: throw new IllegalStateException("Unknown ICU plural category: " + category);
        }
    }
}
