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

base = f"https://github.com/jaswin-dev/MusicLoverPlayer-desktop/releases/download/{tag}/"

def rewrite_url(match):
    filename = match.group(2).strip().strip("'\"")
    return match.group(1) + base + pathlib.PurePosixPath(filename).name

text = metadata_path.read_text(encoding="utf-8")
text = re.sub(r"(?m)^([ \t]*(?:-[ \t]*)?url:[ \t]*)([^ \t\r\n#]+)", rewrite_url, text)
text = re.sub(
    r"(?m)^(path:[ \t]*)([^ \t\r\n#]+)",
    lambda m: m.group(1) + base + pathlib.PurePosixPath(m.group(2).strip().strip("'\"")).name,
    text,
)
version_pattern = r"(?m)^version:[ \t]*['\"]?" + re.escape(version) + r"['\"]?[ \t]*$"
if not re.search(version_pattern, text):
    raise SystemExit("The Electron update metadata version does not match the workflow version")

metadata_path.write_text(text, encoding="utf-8")
print(f"Prepared {metadata_path} for {platform_key} ({version})")
