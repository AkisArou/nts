# The source revision is also a parent Git submodule pin. gclient resolves
# Chromium's DEPS, including CIPD packages, without moving that source pin.
solutions = [
    {
        "name": "src",
        "url": "https://chromium.googlesource.com/chromium/src.git",
        "managed": False,
        "custom_deps": {},
        "custom_vars": {},
    },
]
target_os = ["linux"]
