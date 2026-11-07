import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "data" / "raw"

RAW_AR_FILE = RAW_DIR / "prague_khutbahs_ar.json"
RAW_CS_FILE = RAW_DIR / "prague_khutbahs_cs.json"

AR_API_BASE = "https://mosque.islam.cz/wp-json/wp/v2"
CS_API_BASE = "https://islam.cz/wp-json/wp/v2"


def wp_get(url: str) -> tuple[list | dict, dict]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) khutbah-cs/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        headers = {k.lower(): v for k, v in resp.headers.items()}
        data = json.loads(resp.read().decode("utf-8"))
        return data, headers


def fetch_category_id(api_base: str, slug: str) -> int:
    encoded_slug = urllib.parse.quote(slug)
    data, _ = wp_get(f"{api_base}/categories?slug={encoded_slug}")
    if data and isinstance(data, list):
        return int(data[0]["id"])
    raise ValueError(f"Could not find category slug '{slug}' on {api_base}")


def fetch_all_posts(api_base: str, category_id: int | None = None, max_pages: int = 20) -> list[dict]:
    posts = []
    page = 1
    cat_param = f"categories={category_id}&" if category_id is not None else ""
    while page <= max_pages:
        url = (
            f"{api_base}/posts?{cat_param}"
            f"per_page=50&page={page}&_fields=id,date,link,title,content,categories"
        )
        try:
            batch, headers = wp_get(url)
        except Exception as e:
            print(f"  Stopped at page {page}: {e}")
            break

        if not batch:
            break

        posts.extend(batch)
        total_pages = int(headers.get("x-wp-totalpages", 1))
        print(f"  Fetched page {page}/{min(total_pages, max_pages)} ({len(batch)} posts)")
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.25)

    return posts


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    force_ar = "--force-ar" in sys.argv

    if RAW_AR_FILE.exists() and not force_ar:
        print(f"Skipping Arabic download: {RAW_AR_FILE.name} exists (use --force-ar to re-download).")
    else:
        print("Downloading ALL Arabic posts from mosque.islam.cz -> data/raw/prague_khutbahs_ar.json ...")
        ar_posts = fetch_all_posts(AR_API_BASE, category_id=None, max_pages=20)
        with RAW_AR_FILE.open("w", encoding="utf-8") as f:
            json.dump(ar_posts, f, ensure_ascii=False, indent=2)
        print(f"✅ Saved {len(ar_posts)} raw Arabic posts to {RAW_AR_FILE}")

    if RAW_CS_FILE.exists():
        print(f"Skipping Czech download: {RAW_CS_FILE.name} already exists.")
    else:
        print("Downloading Czech Khutbahs -> data/raw/prague_khutbahs_cs.json ...")
        cs_cat_id = fetch_category_id(CS_API_BASE, "patecni-kazani")
        cs_posts = fetch_all_posts(CS_API_BASE, category_id=cs_cat_id, max_pages=20)
        with RAW_CS_FILE.open("w", encoding="utf-8") as f:
            json.dump(cs_posts, f, ensure_ascii=False, indent=2)
        print(f"✅ Saved {len(cs_posts)} raw Czech posts to {RAW_CS_FILE}")


if __name__ == "__main__":
    main()
