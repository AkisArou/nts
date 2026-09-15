# **Their file.** An existing C++ program that links us like any other library.
cmake_minimum_required(VERSION 3.20)
project(acme_tool CXX)

# Found through pkg-config, which is why the product declares `pkgConfig: true`.
# Without a `.pc` the consumer hard-codes a path, and a hard-coded path is how a
# library stops being redistributable.
find_package(PkgConfig REQUIRED)
pkg_check_modules(ACME REQUIRED IMPORTED_TARGET acme>=0.1)

add_executable(acme_tool src/main.cpp)
target_link_libraries(acme_tool PRIVATE PkgConfig::ACME)
