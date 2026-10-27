// What a C++ programmer writes: `std::tolower` / `std::toupper` over
// the bytes, as in `case-convert`'s reference. Honest here because the
// text is ASCII, and already in the case each call asks for, so the
// column prices the same no-change scan the TypeScript row does.
#include <cctype>
#include <cstdint>
#include <string>
#include <vector>
#include "harness.h"

static std::int32_t convert(std::int32_t seed) {
    std::vector<std::string> lowers;
    std::vector<std::string> uppers;
    for (int i = 0; i < 16; i++) {
        lowers.push_back("the quick brown fox jumps over the lazy dog " +
                         std::to_string(seed) + std::to_string(i));
        uppers.push_back("THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG " +
                         std::to_string(seed) + std::to_string(i));
    }

    std::int32_t total = 0;
    for (std::int32_t round = 0; round < 64; round++) {
        const std::string &lo = lowers[static_cast<std::size_t>(round % 16)];
        const std::string &up = uppers[static_cast<std::size_t>(round % 16)];
        std::string lower(lo.size(), '\0');
        std::string upper(up.size(), '\0');
        for (std::size_t i = 0; i < lo.size(); i++) {
            lower[i] = static_cast<char>(
                std::tolower(static_cast<unsigned char>(lo[i])));
        }
        for (std::size_t i = 0; i < up.size(); i++) {
            upper[i] = static_cast<char>(
                std::toupper(static_cast<unsigned char>(up[i])));
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
