// What a C++ programmer writes for each of the three absences: a pointer that
// may be null, a `std::optional<double>`, and a small tagged struct for the one
// that has two of them.
//
// So this is representation against representation. C++ has no `undefined`, and
// spelling the two-absence case as a variant rather than pretending it away is
// what makes the column mean something.
#include <cstdint>
#include <cstring>
#include <optional>
#include "harness.h"

namespace {

enum class Which : std::uint8_t { Null, Undefined, Number };

struct Either {
    Which which;
    double value;
};

}  // namespace

static double absences(double seed) {
    const int n = 256 + static_cast<int>(seed);
    int total = 0;

    for (int i = 0; i < n; i++) {
        const char* text = i % 3 == 0 ? nullptr : (i % 2 == 0 ? "alpha" : "be");
        total = total + (text == nullptr ? 1 : static_cast<int>(std::strlen(text)));

        const std::optional<double> held =
            i % 5 == 0 ? std::optional<double>{} : std::optional<double>{static_cast<double>(i)};
        total = total + static_cast<int>(held.value_or(-1));

        Either either;
        if (i % 7 == 0) {
            either = Either{Which::Null, 0};
        } else if (i % 11 == 0) {
            either = Either{Which::Undefined, 0};
        } else {
            either = Either{Which::Number, static_cast<double>(i)};
        }
        total = total + (either.which == Which::Null      ? 2
                         : either.which == Which::Undefined ? 3
                                                            : 0);

        const bool flag = (i & 1) == 0;
        total = total + (flag ? 1 : 0) + (text != nullptr ? 1 : 0);
    }
    return total;
}

double bench_run(void) {
    volatile double seed = 3;
    return absences(seed);
}
