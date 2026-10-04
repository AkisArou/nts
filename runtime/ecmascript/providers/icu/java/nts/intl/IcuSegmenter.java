package nts.intl;

import com.ibm.icu.text.BreakIterator;
import com.ibm.icu.util.ULocale;

/** Configured rules and independent text cursors; JS semantics stay in TS. */
public final class IcuSegmenter {
    private final BreakIterator iterator;

    public IcuSegmenter(String tag, int granularity) {
        IcuVersions.verify();
        ULocale locale = ULocale.forLanguageTag(tag);
        switch (granularity) {
            case 0: iterator = BreakIterator.getCharacterInstance(locale); break;
            case 1: iterator = BreakIterator.getWordInstance(locale); break;
            case 2: iterator = BreakIterator.getSentenceInstance(locale); break;
            default: throw new IllegalArgumentException("Invalid segmentation granularity");
        }
    }
    private IcuSegmenter(BreakIterator iterator) { this.iterator = iterator; }

    public IcuSegmenter forText(String input) {
        BreakIterator cursor = iterator.clone();
        cursor.setText(input);
        cursor.first();
        return new IcuSegmenter(cursor);
    }
    public int next() { return iterator.next(); }
    public int previous() { return iterator.previous(); }
    public int following(int index) { return iterator.following(index); }
    public int ruleStatus() { return iterator.getRuleStatus(); }
}
