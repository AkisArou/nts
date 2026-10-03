package nts.intl;

import com.ibm.icu.util.Currency;

/** Currency metadata from the same pinned data as the formatter. */
public final class IcuNumberData {
    public IcuNumberData() { IcuVersions.verify(); }

    public int currencyDigits(String currency) {
        int digits = Currency.getInstance(currency).getDefaultFractionDigits();
        return digits >= 0 ? digits : 2;
    }
}
