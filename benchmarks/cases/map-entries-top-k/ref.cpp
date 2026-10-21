// What a C++ programmer writes for the top k of a word count: an
// `std::unordered_map` copied into a vector of pairs, sorted, and the first k
// read.
//
// **The whole vector sorted, not `std::partial_sort`.** The TypeScript sorts
// every entry and then slices, and the row compares the idiom as written; a
// partial sort would be a different algorithm. `std::sort` against the
// TypeScript's stable sort is no discount: the order is total (count, then
// word), so stability never decides anything.
//
// **`double` counts**, because the TypeScript is `Map<string, number>` and
// nts holds each value in an f64. The pairs copy their words, as the
// TypeScript's pairs hold theirs; every word here fits the short-string
// buffer, so a copy is a few bytes and no allocation.
#include <algorithm>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>
#include "harness.h"

static const std::vector<std::string> &vocabulary() {
    static const std::vector<std::string> words = [] {
        std::vector<std::string> built;
        for (int i = 0; i < 256; i++) {
            built.push_back("word" + std::to_string(i));
        }
        return built;
    }();
    return words;
}

static std::int32_t top_words(std::int32_t seed) {
    const std::vector<std::string> &words = vocabulary();
    std::unordered_map<std::string, double> counts;
    const std::int32_t s = seed & 1023;
    const std::int32_t rounds = 1021 + s;
    std::int32_t state = 1 + s;
    for (std::int32_t i = 0; i < rounds; i++) {
        state = (state * 75 + 74) % 65537;
        const std::string &w =
            words[static_cast<std::size_t>(((state & 255) * ((state >> 8) & 255)) >> 8)];
        counts[w] += 1.0;
    }
    std::vector<std::pair<std::string, double>> entries(counts.begin(), counts.end());
    std::sort(entries.begin(), entries.end(), [](const auto &a, const auto &b) {
        if (a.second != b.second) {
            return a.second > b.second;
        }
        return a.first < b.first;
    });
    const std::size_t k = std::min<std::size_t>(16, entries.size());
    std::int32_t total = 0;
    for (std::size_t i = 0; i < k; i++) {
        total = total + static_cast<std::int32_t>(entries[i].second * static_cast<double>(i + 1)) +
                static_cast<std::int32_t>(entries[i].first.size()) * 1000;
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(top_words(seed));
}
