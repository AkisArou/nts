package nts.intl;

import com.ibm.icu.number.FormattedNumber;
import com.ibm.icu.number.LocalizedNumberFormatter;
import com.ibm.icu.number.NumberFormatter;
import com.ibm.icu.text.ConstrainedFieldPosition;
import com.ibm.icu.text.NumberFormat;
import com.ibm.icu.util.ULocale;
import java.math.BigDecimal;
import java.text.Format;
import java.util.Arrays;

/** ICU skeleton primitive. TS owns ECMA-402 options and formatToParts. */
public final class IcuNumberFormatter {
    private final LocalizedNumberFormatter formatter;
    private final ConstrainedFieldPosition position = new ConstrainedFieldPosition();
    private int[] spans = new int[48];
    private int count;

    public IcuNumberFormatter(String locale, String skeleton) {
        IcuVersions.verify();
        formatter = NumberFormatter.forSkeleton(skeleton).locale(ULocale.forLanguageTag(locale));
    }

    // A formatter's scratch is borrowed until its next format call; one realm
    // owns that formatter. Returned strings and JS parts own their storage.
    public String format(double value, boolean fields) { return finish(formatter.format(value), fields); }
    public String formatDecimal(String value, boolean fields) { return finish(formatter.format(new BigDecimal(value)), fields); }
    public int fieldCount() { return count; }
    public int field(int index) { return spans[index * 3]; }
    public int start(int index) { return spans[index * 3 + 1]; }
    public int end(int index) { return spans[index * 3 + 2]; }

    private String finish(FormattedNumber number, boolean fields) {
        count = 0;
        if (fields) {
            position.reset();
            while (number.nextPosition(position)) {
                int field = fieldCode(position.getField());
                if (field < 0) continue;
                if ((count + 1) * 3 > spans.length) spans = Arrays.copyOf(spans, spans.length * 2);
                spans[count * 3] = field;
                spans[count * 3 + 1] = position.getStart();
                spans[count * 3 + 2] = position.getLimit();
                count++;
            }
        }
        return number.toString();
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
