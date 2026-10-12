#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sinh sẵn TOÀN BỘ bài ngữ pháp vào data/grammar_lessons/ — chạy 1 lần duy nhất.
Sau đó mở bài nào cũng hiện ngay tức thì, không đợi AI, offline vẫn đọc được.

Cách dùng (chạy trong thư mục E:\\english_chatbot, server đang chạy):
    python pregen_grammar.py                  # sinh tất cả 54 chủ đề
    python pregen_grammar.py --only A1        # chỉ sinh level A1
    python pregen_grammar.py --only A1,A2     # chỉ sinh A1 + A2
    python pregen_grammar.py --refresh        # sinh lại cả những bài đã có
    python pregen_grammar.py --base http://localhost:8000

Yêu cầu:
  - Server đang chạy (uvicorn), GROQ_API_KEY đã cấu hình.
  - Bài nào đã có file cache thì bỏ qua (trừ khi dùng --refresh).
  - Lỗi bài nào thì ghi nhận và tiếp tục, cuối buổi in danh sách để chạy lại.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOPICS_FILE = os.path.join(BASE_DIR, "data", "grammar_topics.json")
OUT_DIR = os.path.join(BASE_DIR, "data", "grammar_lessons")


def post_lesson(base, topic_id, timeout=300):
    """Gọi endpoint sinh bài, trả về (ok, info)."""
    req = urllib.request.Request(
        base.rstrip("/") + "/api/generate-grammar-lesson",
        data=json.dumps({"topic_id": topic_id}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            d = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    if d.get("error") or not d.get("lesson"):
        return False, d.get("error", "không rõ lỗi")
    return True, "cached" if d.get("cached") else "mới"


def main():
    ap = argparse.ArgumentParser(description="Sinh sẵn toàn bộ bài ngữ pháp.")
    ap.add_argument("--only", default="",
                    help="Chỉ sinh level chỉ định, vd: A1 hoặc A1,A2 (mặc định: tất cả)")
    ap.add_argument("--refresh", action="store_true",
                    help="Sinh lại cả những bài đã có file cache")
    ap.add_argument("--base", default="http://localhost:8000",
                    help="Địa chỉ server (mặc định: http://localhost:8000)")
    ap.add_argument("--delay", type=float, default=1.0,
                    help="Nghỉ giữa các request, giây (mặc định: 1.0)")
    args = ap.parse_args()

    if not os.path.exists(TOPICS_FILE):
        print(f"[LỖI] Không thấy {TOPICS_FILE}")
        print("       Chạy script trong thư mục E:\\english_chatbot (nơi có thư mục data\\)")
        sys.exit(1)

    with open(TOPICS_FILE, encoding="utf-8") as f:
        topics = json.load(f)["topics"]

    only = {lv.strip().upper() for lv in args.only.split(",") if lv.strip()}
    if only:
        topics = [t for t in topics if str(t.get("level", "")).upper() in only]
    if not topics:
        print("[LỖI] Không có chủ đề nào khớp. Kiểm tra lại --only.")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    # Kiểm tra server có chạy không
    try:
        urllib.request.urlopen(args.base.rstrip("/") + "/api/grammar-topics",
                               timeout=10).read()
    except Exception as e:
        print(f"[LỖI] Không kết nối được server {args.base}")
        print("       Hãy chạy server trước (uvicorn), rồi chạy lại script.")
        sys.exit(1)

    print(f"Sinh {len(topics)} bài ngữ pháp qua {args.base} ...")
    print("-" * 60)
    ok = skip = fail = 0
    failed_ids = []
    t0 = time.time()
    for i, t in enumerate(topics, 1):
        tid = t["id"]
        cpath = os.path.join(OUT_DIR, tid + ".json")
        if os.path.exists(cpath) and not args.refresh:
            print(f"[{i:>2}/{len(topics)}] {tid:<28} bỏ qua (đã có)")
            skip += 1
            continue
        good, info = post_lesson(args.base, tid)
        # xác minh file cache thực sự được ghi
        if good and not os.path.exists(cpath):
            good, info = False, "API báo ok nhưng không thấy file cache"
        if good:
            ok += 1
            print(f"[{i:>2}/{len(topics)}] {tid:<28} OK ({info})")
        else:
            fail += 1
            failed_ids.append(tid)
            print(f"[{i:>2}/{len(topics)}] {tid:<28} LỖI: {str(info)[:80]}")
        time.sleep(args.delay)

    mins = (time.time() - t0) / 60
    print("-" * 60)
    print(f"XONG trong {mins:.1f} phút: {ok} bài mới, {skip} bỏ qua, {fail} lỗi.")
    if failed_ids:
        print("Các bài lỗi, chạy lại sau:")
        for tid in failed_ids:
            print(f"  - {tid}")
        print("Gợi ý: python pregen_grammar.py  (tự bỏ qua bài đã xong)")
    else:
        print("Mở tab Bài học AI > Ngữ pháp: bài nào cũng hiện ngay, không đợi AI.")


if __name__ == "__main__":
    main()
