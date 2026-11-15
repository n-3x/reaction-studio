#!/usr/bin/env python3
"""Download a public Instagram post using Instaloader as a fallback."""
import sys
from pathlib import Path

import instaloader
import requests


def main():
    shortcode, output = sys.argv[1:]
    loader = instaloader.Instaloader(quiet=True, request_timeout=20, max_connection_attempts=1)
    post = instaloader.Post.from_shortcode(loader.context, shortcode)
    if not post.is_video or not post.video_url:
        raise ValueError("This post does not contain a directly downloadable video.")
    target = Path(output)
    try:
        with requests.get(post.video_url, stream=True, timeout=(20, 30)) as response:
            response.raise_for_status()
            size = 0
            with target.open("wb") as dest:
                for chunk in response.iter_content(1024 * 1024):
                    size += len(chunk)
                    if size > 512 * 1024 * 1024:
                        raise ValueError("The reference video exceeds 512 MB.")
                    dest.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    print(target)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
