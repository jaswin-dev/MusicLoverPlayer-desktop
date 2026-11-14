import json, os, glob, hashlib, pathlib, platform
version=os.environ["VERSION"]
platform_name=os.environ["PLATFORM"]
runner=os.environ["RUNNER_OS"]
files=glob.glob("dist/*.dmg")+glob.glob("dist/*.zip")+glob.glob("dist/*.exe")
if runner=="macOS":
    files=[f for f in files if "arm64" in pathlib.Path(f).name]
    platform_key="mac-arm64"
elif runner=="Windows":
    files=[f for f in files if f.lower().endswith(".exe")]
    platform_key="windows-x64"
else:
    raise SystemExit("Unsupported desktop build runner")
if not files:
    raise SystemExit("No expected desktop installer was generated")
release_tag=f"desktop-v{version}-{platform_name.replace(' ','-')}"
assets=[]
for f in files:
    p=pathlib.Path(f)
    digest=hashlib.sha256(p.read_bytes()).hexdigest()
    ext=p.suffix.lower()
    assets.append({"name":p.name,"url":f"https://github.com/jaswin-dev/musiclover-updates/releases/download/{release_tag}/{p.name}","sha256":digest,"size":p.stat().st_size,"type":"installer" if ext in (".dmg",".exe") else "update-archive"})
manifest={"appId":"com.musiclover.player","appName":"MusicLover Player","platform":platform_key,"version":version,"releaseNotes":"MusicLover Player desktop update","mandatory":False,"publishedAt":__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),"assets":assets}
pathlib.Path("desktop-update/desktop-latest.json").write_text(json.dumps(manifest,indent=2)+"\n")
for asset in assets:
    print(f"Prepared {asset['name']} ({asset['size']} bytes)")
