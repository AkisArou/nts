package nts.intl;

import com.ibm.icu.text.Collator;
import com.ibm.icu.text.RuleBasedCollator;
import com.ibm.icu.util.ULocale;

/** Reused ICU comparison primitive. Shared TypeScript resolves JS options. */
public final class IcuCollator {
    private final RuleBasedCollator collator;

    public IcuCollator(String locale, int sensitivity, boolean punctuation, boolean numeric, int caseFirst) {
        IcuVersions.verify();
        if (sensitivity < 0 || sensitivity > 3 || caseFirst < 0 || caseFirst > 2)
            throw new IllegalArgumentException("Invalid collator configuration");
        collator = (RuleBasedCollator)Collator.getInstance(ULocale.forLanguageTag(locale));
        collator.setStrength(sensitivity == 0 || sensitivity == 2 ? Collator.PRIMARY : sensitivity == 1 ? Collator.SECONDARY : Collator.TERTIARY);
        collator.setCaseLevel(sensitivity == 2);
        collator.setAlternateHandlingShifted(punctuation);
        collator.setMaxVariable(Collator.ReorderCodes.PUNCTUATION);
        collator.setNumericCollation(numeric);
        if (caseFirst == 2) collator.setLowerCaseFirst(true);
        else collator.setUpperCaseFirst(caseFirst == 1);
        collator.setDecomposition(Collator.CANONICAL_DECOMPOSITION);
    }
    public int compare(String one, String two) { return collator.compare(one, two); }

    public static int defaults(String locale) {
        IcuVersions.verify();
        RuleBasedCollator collator = (RuleBasedCollator)Collator.getInstance(ULocale.forLanguageTag(locale));
        int strength = collator.getStrength();
        int sensitivity = strength == Collator.PRIMARY ? (collator.isCaseLevel() ? 2 : 0) : strength == Collator.SECONDARY ? 1 : 3;
        int caseFirst = collator.isUpperCaseFirst() ? 1 : collator.isLowerCaseFirst() ? 2 : 0;
        return sensitivity | (collator.isAlternateHandlingShifted() ? 4 : 0) | (caseFirst << 3);
    }
}
