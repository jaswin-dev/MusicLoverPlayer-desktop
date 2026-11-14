import os
import pathlib
import re
import sys

metadata_path = pathlib.Path(sys.argv[1])
version = os.environ["VERSION"]
platform_key = os.environ["PLATFORM_KEY"]
tag = os.environ["RELEASE_TAG"]

if not metadata_path.is_file():
    raise SystemExit(f"Electron update metadata not found: {metadata_path}")

release_base = f"https://github.com/jaswin-dev/MusicLoverPlayer-desktop/releases/download/{tag}/"
dist_dir = metadata_path.parent

# Resolve installer names from the actual build output. This avoids publishing
# metadata that points to a normalized name that does not exist in the release.
extensions = {".exe", ".blockmap"} if platform_key == "windows-x64" else {".dmg", ".zip", ".blockmap"}
actual_assets = {
    item.name for item in dist_dir.iterdir()
    if item.is_file() and item.suffix.lower() in extensions
}
if not actual_assets:
    raise SystemExit(f"No installer assets found beside {metadata_path}")

text = metadata_path.read_text(encoding="utf-8")

def resolve_asset(filename):
    basename = pathlib.PurePosixPath(filename.strip().strip("'\"")).name
    if basename in actual_assets:
        return basename
    suffix = pathlib.PurePosixPath(basename).suffix.lower()
    matches = sorted(
        name for name in actual_assets
        if pathlib.PurePosixPath(name).suffix.lower() == suffix and version in name
    )
    if len(matches) == 1:
        return matches[0]
    raise SystemExit(
        f"Could not uniquely match metadata asset {basename!r} to build output. "
        f"Available assets: {sorted(actual_assets)}"
    )

def rewrite_asset(match):
    filename = match.group(2).strip().strip("'\"")
    actual = resolve_asset(filename)
    return match.group(1) + release_base + actual

text = re.sub(r"(?m)^([ \t]*(?:-[ \t]*)?url:[ \t]*)([^ \t\r\n#]+)", rewrite_asset, text)
text = re.sub(r"(?m)^(path:[ \t]*)([^ \t\r\n#]+)", rewrite_asset, text)

version_pattern = r"(?m)^version:[ \t]*['\"]?" + re.escape(version) + r"['\"]?[ \t]*$"
if not re.search(version_pattern, text):
    raise SystemExit("The Electron update metadata version does not match the workflow version")

metadata_path.write_text(text, encoding="utf-8")
print(f"Prepared {metadata_path} for {platform_key} ({version})")
