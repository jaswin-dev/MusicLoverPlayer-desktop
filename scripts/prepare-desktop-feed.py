import os
import pathlib
import re
import sys
from urllib.parse import quote

metadata_path = pathlib.Path(sys.argv[1])
version = os.environ["VERSION"]
platform_key = os.environ["PLATFORM_KEY"]
tag = os.environ["RELEASE_TAG"]

if not metadata_path.is_file():
    raise SystemExit(f"Electron update metadata not found: {metadata_path}")

release_base = f"https://github.com/jaswin-dev/MusicLoverPlayer-desktop/releases/download/{tag}/"
dist_dir = metadata_path.parent
extensions = {".exe", ".blockmap"} if platform_key == "windows-x64" else {".dmg", ".zip", ".blockmap"}
actual_assets = {
    item.name for item in dist_dir.iterdir()
    if item.is_file() and item.suffix.lower() in extensions
}
if not actual_assets:
    raise SystemExit(f"No installer assets found beside {metadata_path}")

def resolve_asset(value):
    value = value.strip().strip("'\"")
    basename = pathlib.PurePosixPath(value.split("?", 1)[0]).name
    basename = basename.replace("%20", " ")
    if basename in actual_assets:
        return basename

    suffix = pathlib.PurePosixPath(basename).suffix.lower()
    if suffix not in extensions:
        if platform_key == "windows-x64":
            suffix = ".exe"
        else:
            candidates = sorted(n for n in actual_assets if n.endswith((".dmg", ".zip")))
            if len(candidates) == 1:
                return candidates[0]

    matches = sorted(
        name for name in actual_assets
        if pathlib.PurePosixPath(name).suffix.lower() == suffix
        and version in name
    )
    if len(matches) == 1:
        return matches[0]

    raise SystemExit(
        f"Could not uniquely match metadata asset {value!r}. "
        f"Expected suffix {suffix!r}; available assets: {sorted(actual_assets)}"
    )

def rewrite(match):
    prefix, value = match.group(1), match.group(2).strip()
    actual = resolve_asset(value)
    return prefix + release_base + quote(actual, safe=".-_()")

# Capture the complete YAML scalar, including spaces in installer filenames.
text = re.sub(
    r"(?m)^([ \t]*(?:-[ \t]*)?url:[ \t]*)([^\r\n]+)",
    rewrite,
    metadata_path.read_text(encoding="utf-8"),
)
text = re.sub(r"(?m)^(path:[ \t]*)([^\r\n]+)", rewrite, text)

version_pattern = r"(?m)^version:[ \t]*['\"]?" + re.escape(version) + r"['\"]?[ \t]*$"
if not re.search(version_pattern, text):
    raise SystemExit("The Electron update metadata version does not match the workflow version")

metadata_path.write_text(text, encoding="utf-8")
print(f"Prepared {metadata_path} for {platform_key} ({version})")
