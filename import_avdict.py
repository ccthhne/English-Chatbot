#!/usr/bin/env python3
"""
Import từ điển Anh-Việt (Hồ Ngọc Đức, raw TXT từ
yenthanh132/avdict-database-sqlite-converter) vào dictionary.db (schema kiểu minhqnd).

- Chỉ THÊM từ chưa có nghĩa tiếng Việt, không ghi đè dữ liệu cũ.
- Gộp các entry trùng headword.
- Giữ cụm động từ 2 từ (verb + particle, vd "give up") từ dòng "!" — app tra longest-match.
- POS giữ nguyên tên tiếng Việt ("danh từ", "tính từ", ...), endpoint tự hiển thị đúng.

Cách dùng:
    python3 import_avdict.py --txt anhviet109K.txt --db dictionary.db
    python3 import_avdict.py --txt anhviet109K.txt --db dictionary.db --dry-run   # chỉ đếm, không ghi
    python3 import_avdict.py --txt anhviet109K.txt --db dictionary.db --limit 100  # thử với 100 từ

Nguồn dữ liệu: Từ điển Anh-Việt của Hồ Ngọc Đức (http://www.informatik.uni-leipzig.de/~duc/Dict/)
"""
import argparse
import re
import sqlite3
import sys

# ── 1. Parse raw TXT ──────────────────────────────────────────
# @headword /ipa/
# *  từ loại
# - nghĩa tiếng Việt
# =ví dụ tiếng Anh+ nghĩa tiếng Việt (bỏ qua ở bản này)

PARTICLES = {
    # tiểu từ (particle) điển hình của phrasal verb
    "up", "down", "out", "off", "in", "on", "away", "back", "over", "through",
    "along", "around", "forward", "behind", "aside", "together",
    "apart", "across", "ahead", "forth", "onto", "into", "about",
    # giới từ hay gặp trong phrasal verb (verb + preposition: look after, deal with...)
    "after", "for", "with", "at", "by", "upon", "to", "of",
    # tân ngữ phản thân (enjoy oneself...)
    "oneself", "itself", "himself", "herself", "themselves", "it",
}

def normalize_phrase(ph):
    """'to give up' -> 'give up'; lowercase, gọn khoảng trắng."""
    ph = ph.strip().lower()
    ph = re.sub(r"^to\s+", "", ph)
    ph = re.sub(r"\s+", " ", ph)
    return ph

def keep_entry(w):
    """Từ đơn: giữ như cũ. Cụm: chỉ giữ verb + particle 2 từ (phrasal verb)."""
    if not w:
        return False
    if " " not in w:
        return True
    parts = w.split()
    return (len(parts) == 2 and parts[1] in PARTICLES
            and re.fullmatch(r"[a-z]+", parts[0]) is not None)

def parse_avdict(path):
    entries = {}  # word -> {"ipa": str, "senses": [(pos, [defs])]} (dict giữ đúng thứ tự xuất hiện)
    word, ipa, pos = None, "", ""
    senses = []  # list of [pos, [defs]]
    phrase, phrase_senses = None, []  # cụm từ từ dòng "!" (vd "!to give up")

    def flush():
        nonlocal word, ipa, pos, senses
        if word and any(d for _, ds in senses for d in ds):
            e = entries.setdefault(word, {"ipa": "", "senses": []})
            if ipa and not e["ipa"]:
                e["ipa"] = ipa
            e["senses"].extend(senses)
        word, ipa, pos, senses = None, "", "", []

    def flush_phrase():
        nonlocal phrase, phrase_senses
        if phrase and any(d for _, ds in phrase_senses for d in ds):
            key = normalize_phrase(phrase)
            if keep_entry(key):
                e = entries.setdefault(key, {"ipa": "", "senses": []})
                # chống trùng nghĩa khi cùng cụm xuất hiện nhiều lần trong TXT
                seen = {d for _, ds in e["senses"] for d in ds}
                for ppos, ds in phrase_senses:
                    new_ds = [d for d in ds if d not in seen]
                    if new_ds:
                        e["senses"].append([ppos, new_ds])
                        seen.update(new_ds)
        phrase, phrase_senses = None, []

    with open(path, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip():
                continue
            if line.startswith("@"):
                flush_phrase()
                flush()
                m = re.match(r"@(.+?)(?:\s*/(.*?)/\s*)?$", line.strip())
                if not m:
                    continue
                word = m.group(1).strip().lower()
                ipa = (m.group(2) or "").strip()
                pos, senses = "", []
            elif line.startswith("!") and word:
                # cụm từ thuộc headword hiện tại: nghĩa "-" sau nó là của cụm, KHÔNG phải của từ đơn
                flush_phrase()
                phrase = line[1:].strip()
                phrase_senses = [["cụm động từ", []]]
            elif line.startswith("*") and word:
                flush_phrase()
                pos = line[1:].strip().split(",")[0].strip()
                senses.append([pos, []])
            elif line.startswith("-") and word:
                d = line[1:].strip()
                if not d:
                    continue
                if phrase:
                    if not phrase_senses:
                        phrase_senses.append(["cụm động từ", []])
                    phrase_senses[-1][1].append(d)
                else:
                    if not senses:
                        senses.append([pos, []])
                    senses[-1][1].append(d)
            # dòng "=" (ví dụ song ngữ): bỏ qua ở bản import này
    flush_phrase()
    flush()
    return list(entries.items())


# ── 2. Import vào dictionary.db ───────────────────────────────

REQUIRED = {
    "words": {"id", "word", "lang_code"},
    "word_definitions": {"word_id", "definition_id"},
    "definitions": {"id", "definition", "pos", "definition_lang"},
    "pronunciations": {"word_id", "ipa"},
}

def check_schema(conn):
    problems = []
    for table, cols in REQUIRED.items():
        info = conn.execute(f"PRAGMA table_info({table})").fetchall()
        if not info:
            problems.append(f"thiếu bảng '{table}'")
            continue
        have = {r[1] for r in info}
        missing = cols - have
        if missing:
            problems.append(f"bảng '{table}' thiếu cột: {', '.join(sorted(missing))}")
    return problems


def main():
    ap = argparse.ArgumentParser(description="Import từ điển Anh-Việt (Hồ Ngọc Đức) vào dictionary.db")
    ap.add_argument("--txt", required=True, help="đường dẫn anhviet109K.txt")
    ap.add_argument("--db", required=True, help="đường dẫn dictionary.db")
    ap.add_argument("--dry-run", action="store_true", help="chỉ đếm, không ghi")
    ap.add_argument("--limit", type=int, default=0, help="giới hạn số từ (để thử)")
    ap.add_argument("--refresh", action="store_true",
                    help="xóa nghĩa Việt cũ và import lại từ TXT (để khôi phục nhãn lĩnh vực như '(sân khấu)')")
    args = ap.parse_args()

    print("Đang parse", args.txt, "...")
    parsed = parse_avdict(args.txt)
    # từ đơn giữ như cũ; cụm chỉ giữ phrasal verb (verb + particle)
    parsed = [(w, e) for w, e in parsed if keep_entry(w)]
    if args.limit:
        parsed = parsed[:args.limit]
    print(f"  → {len(parsed)} từ đơn có nghĩa")

    conn = sqlite3.connect(args.db)
    problems = check_schema(conn)
    if problems:
        print("Schema dictionary.db không khớp, dừng lại:")
        for p in problems:
            print("  -", p)
        sys.exit(1)

    added_words = added_defs = skipped = 0
    cur = conn.cursor()

    # Preload 1 lần để không SELECT từng từ (nhanh hơn nhiều với 100K từ)
    existing_ids = {
        r[0]: r[1]
        for r in cur.execute("SELECT word, id FROM words WHERE lang_code = 'en'")
    }
    vi_word_ids = {
        r[0]
        for r in cur.execute(
            """SELECT DISTINCT wd.word_id FROM word_definitions wd
               JOIN definitions d ON wd.definition_id = d.id
               WHERE d.definition_lang = 'vi'"""
        )
    }

    for w, e in parsed:
        word_id = existing_ids.get(w)
        if word_id is not None and word_id in vi_word_ids:
            if not args.refresh:
                skipped += 1
                continue
            # --refresh: xóa nghĩa Việt cũ để import lại (khôi phục nhãn lĩnh vực)
            if not args.dry_run:
                old_ids = [r[0] for r in cur.execute(
                    """SELECT d.id FROM definitions d
                       JOIN word_definitions wd ON wd.definition_id = d.id
                       WHERE wd.word_id = ? AND d.definition_lang = 'vi'""",
                    (word_id,))]
                for oid in old_ids:
                    cur.execute("DELETE FROM word_definitions WHERE definition_id = ?", (oid,))
                    cur.execute("DELETE FROM definitions WHERE id = ?", (oid,))
            else:
                skipped += 1  # dry-run: chỉ đếm như bình thường
                continue

        if args.dry_run:
            added_words += 1
            added_defs += sum(len(ds) for _, ds in e["senses"])
            continue

        if not word_id:
            cur.execute("INSERT INTO words (word, lang_code) VALUES (?, 'en')", (w,))
            word_id = cur.lastrowid
            existing_ids[w] = word_id
            added_words += 1

        for pos, defs in e["senses"]:
            for d in defs:
                cur.execute(
                    "INSERT INTO definitions (definition, pos, definition_lang) VALUES (?, ?, 'vi')",
                    (d, pos),
                )
                def_id = cur.lastrowid
                cur.execute(
                    "INSERT INTO word_definitions (word_id, definition_id) VALUES (?, ?)",
                    (word_id, def_id),
                )
                added_defs += 1

        if e["ipa"]:
            has_ipa = cur.execute(
                "SELECT 1 FROM pronunciations WHERE word_id = ? LIMIT 1", (word_id,)
            ).fetchone()
            if not has_ipa:
                cur.execute(
                    "INSERT INTO pronunciations (word_id, ipa) VALUES (?, ?)",
                    (word_id, e["ipa"]),
                )

    if not args.dry_run:
        conn.commit()
    conn.close()

    mode = "refresh" if args.refresh else "thêm mới"
    print(f"Xong ({mode}): {added_words} từ mới / {added_defs} nghĩa, bỏ qua {skipped} từ.")


if __name__ == "__main__":
    main()
