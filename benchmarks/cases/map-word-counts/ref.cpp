// What a C++ programmer writes for a word count: `std::unordered_map` keyed by
// `std::string`, updated with `counts[w] += 1` -- one lookup per update, which
// is what the TypeScript's read and write sharing one entry is measured
// against.
//
// **`double` values, not `int32_t`.** The TypeScript is `Map<string, number>`,
// and nts holds each value in an erased `f64` payload; a narrower value would
// be a discount the types do not give. The keys are the strings the program
// built once, as the TypeScript's vocabulary is.
//
// `find` stands for the second pass's `?? 0` and for the last pass's read of a
// word that is there.
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>
#include "harness.h"

static const std::vector<std::string> &vocabulary() {
    static const std::vector<std::string> words = [] {
        std::vector<std::string> built;
        for (int i = 0; i < 96; i++) {
            built.push_back("word" + std::to_string(i));
        }
        return built;
    }();
    return words;
}

static std::int32_t map_word_counts(std::int32_t seed) {
    const std::vector<std::string> &words = vocabulary();
    std::unordered_map<std::string, double> counts;
    const std::int32_t s = seed & 1023;
    const std::int32_t rounds = 509 + s;
    for (std::int32_t i = 0; i < rounds; i++) {
        counts[words[static_cast<std::size_t>((i * 13 + s) & 63)]] += 1.0;
    }
    std::int32_t total = 0;
    for (std::int32_t i = 0; i < rounds; i++) {
        const auto found = counts.find(words[static_cast<std::size_t>((i * 7 + s) % 96)]);
        total = total + (found == counts.end() ? 0 : static_cast<std::int32_t>(found->second));
    }
    for (std::int32_t i = 0; i < 64; i++) {
        const auto found = counts.find(words[static_cast<std::size_t>(i)]);
        const double n = found == counts.end() ? 0.0 : found->second;
        total = total + static_cast<std::int32_t>(n * static_cast<double>(i + 1));
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(map_word_counts(seed));
}
