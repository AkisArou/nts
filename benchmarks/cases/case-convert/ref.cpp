// What a C++ programmer writes: `std::tolower` over the bytes.
//
// Correct here only because the case is ASCII, and that is why the case is
// ASCII -- `std::tolower` is one byte to one byte in the C locale, while
// JavaScript's mapping can change a character's width (`ÿ` to `Ÿ`) and its
// length (`ß` to `SS`). Doing it properly in C++ means ICU, which is a
// different program rather than a reference for this one.
//
// So this column is what the loop costs when the conversion is a byte table:
// a floor, and a fair one for the path nts actually takes here.
#include <cctype>
#include <cstdint>
#include <string>
#include <vector>
#include "harness.h"

static std::int32_t convert(std::int32_t seed) {
    const std::string base =
        "The Quick Brown Fox Jumps Over The Lazy Dog " + std::to_string(seed);
    std::vector<std::string> inputs;
    for (int i = 0; i < 16; i++) {
        inputs.push_back(base + std::to_string(i));
    }

    std::int32_t total = 0;
    for (std::int32_t round = 0; round < 64; round++) {
        const std::string &s = inputs[static_cast<std::size_t>(round % 16)];
        std::string lower(s.size(), '\0');
        std::string upper(s.size(), '\0');
        for (std::size_t i = 0; i < s.size(); i++) {
            lower[i] = static_cast<char>(
                std::tolower(static_cast<unsigned char>(s[i])));
            upper[i] = static_cast<char>(
                std::toupper(static_cast<unsigned char>(s[i])));
        }
        total = total + static_cast<std::int32_t>(lower.size()) +
                static_cast<std::int32_t>(upper.size());
        total = total + static_cast<std::int32_t>(static_cast<unsigned char>(lower[0])) +
                static_cast<std::int32_t>(static_cast<unsigned char>(upper[0]));
    }
    return total;
}

double bench_run(void) {
    volatile std::int32_t seed = 3;
    return static_cast<double>(convert(seed));
}
