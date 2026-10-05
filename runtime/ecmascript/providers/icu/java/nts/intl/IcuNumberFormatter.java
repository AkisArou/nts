package nts.intl;

import com.ibm.icu.number.LocalizedNumberFormatter;
import com.ibm.icu.number.NumberFormatter;
import com.ibm.icu.number.NumberRangeFormatter;
import com.ibm.icu.number.LocalizedNumberRangeFormatter;
import com.ibm.icu.number.UnlocalizedNumberFormatter;
import com.ibm.icu.text.ConstrainedFieldPosition;
import com.ibm.icu.text.FormattedValue;
import com.ibm.icu.text.NumberFormat;
import com.ibm.icu.util.ULocale;
import java.math.BigDecimal;
import java.text.Format;
import java.util.Arrays;

/** ICU skeleton primitive. TS owns ECMA-402 options and formatToParts. */
public final class IcuNumberFormatter {
    private final LocalizedNumberFormatter positive, negative;
    private final UnlocalizedNumberFormatter positiveConfiguration, negativeConfiguration;
    private final ULocale locale;
    private LocalizedNumberRangeFormatter[] rangeFormatters;
    private final boolean hasVariant;
    private ConstrainedFieldPosition position;
    private int[] spans;
    private int count;

    public IcuNumberFormatter(String locale, String skeleton, String negativeSkeleton) {
        IcuVersions.verify();
        this.locale = ULocale.forLanguageTag(locale);
        positiveConfiguration = NumberFormatter.forSkeleton(skeleton);
        positive = positiveConfiguration.locale(this.locale);
        hasVariant = !negativeSkeleton.isEmpty();
        negativeConfiguration = hasVariant ? NumberFormatter.forSkeleton(negativeSkeleton) : positiveConfiguration;
        negative = hasVariant ? negativeConfiguration.locale(this.locale) : positive;
    }

    // A formatter's scratch is borrowed until its next format call; one realm
    // owns that formatter. Returned strings and JS parts own their storage.
    public String format(double value, boolean fields, boolean negative) { return finish((negative ? this.negative : positive).format(value), fields); }
    public String formatDecimal(String value, boolean fields, boolean negative) { return finish((negative ? this.negative : positive).format(new BigDecimal(value)), fields); }
    public String formatRange(String start, String end, boolean fields, boolean negativeStart, boolean negativeEnd) {
        if (rangeFormatters == null) rangeFormatters = new LocalizedNumberRangeFormatter[4];
        int key = hasVariant ? (negativeStart ? 1 : 0) + (negativeEnd ? 2 : 0) : 0;
        if (rangeFormatters[key] == null) {
            rangeFormatters[key] = (key == 0 || key == 3 ? NumberRangeFormatter.with()
                .numberFormatterBoth(key == 3 ? negativeConfiguration : positiveConfiguration) : NumberRangeFormatter.with()
                .numberFormatterFirst(key % 2 == 1 ? negativeConfiguration : positiveConfiguration)
                .numberFormatterSecond(key >= 2 ? negativeConfiguration : positiveConfiguration))
                .identityFallback(NumberRangeFormatter.RangeIdentityFallback.APPROXIMATELY).locale(locale);
        }
        return finish(rangeFormatters[key].formatRange(rangeNumber(start), rangeNumber(end)), fields);
    }
    public int fieldCount() { return count; }
    public int field(int index) { return spans[index * 3]; }
    public int start(int index) { return spans[index * 3 + 1]; }
    public int end(int index) { return spans[index * 3 + 2]; }

    private String finish(FormattedValue number, boolean fields) {
        count = 0;
        if (fields) {
            if (position == null) position = new ConstrainedFieldPosition();
            position.reset();
            while (number.nextPosition(position)) {
                int field = position.getField() == NumberRangeFormatter.SpanField.NUMBER_RANGE_SPAN
                    ? 14 + ((Integer) position.getFieldValue()).intValue() : fieldCode(position.getField());
                if (field < 0) continue;
                if (spans == null) spans = new int[48];
                else if ((count + 1) * 3 > spans.length) spans = Arrays.copyOf(spans, spans.length * 2);
                spans[count * 3] = field;
                spans[count * 3 + 1] = position.getStart();
                spans[count * 3 + 2] = position.getLimit();
                count++;
            }
        }
        return number.toString();
    }

    private static Number rangeNumber(String value) {
        if (value.equals("Infinity")) return Double.POSITIVE_INFINITY;
        if (value.equals("-Infinity")) return Double.NEGATIVE_INFINITY;
        if (value.equals("-0")) return -0.0;
        return new BigDecimal(value);
    }

    private static int fieldCode(Format.Field field) {
        if (field == NumberFormat.Field.INTEGER) return 0;
        if (field == NumberFormat.Field.FRACTION) return 1;
        if (field == NumberFormat.Field.DECIMAL_SEPARATOR) return 2;
        if (field == NumberFormat.Field.EXPONENT_SYMBOL) return 3;
        if (field == NumberFormat.Field.EXPONENT_SIGN) return 4;
        if (field == NumberFormat.Field.EXPONENT) return 5;
        if (field == NumberFormat.Field.GROUPING_SEPARATOR) return 6;
        if (field == NumberFormat.Field.CURRENCY) return 7;
        if (field == NumberFormat.Field.PERCENT) return 8;
        if (field == NumberFormat.Field.PERMILLE) return 9;
        if (field == NumberFormat.Field.SIGN) return 10;
        if (field == NumberFormat.Field.MEASURE_UNIT) return 11;
        if (field == NumberFormat.Field.COMPACT) return 12;
        if (field == NumberFormat.Field.APPROXIMATELY_SIGN) return 13;
        return -1;
    }
}
