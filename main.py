import csv
import html as html_lib
import os
import re
import random
import json
import sqlite3
import anyio
from functools import lru_cache
from collections import Counter

import spacy
import textstat
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from groq import Groq
from cefrpy import CEFRAnalyzer

# ============================================================
# CONFIG
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("Chưa có GROQ_API_KEY")

client   = Groq(api_key=GROQ_API_KEY)
analyzer = CEFRAnalyzer()
nlp      = spacy.load("en_core_web_sm")

MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")

# POS bỏ qua khi tính level từ vựng
SKIP_POS = {"DET", "ADP", "CCONJ", "SCONJ", "PUNCT", "SPACE", "PART", "PRON", "NUM"}

# Numeric mapping
CEFR_NUMERIC = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
CEFR_REVERSE = {v: k for k, v in CEFR_NUMERIC.items()}

# ============================================================
# HẰNG SỐ PHƯƠNG PHÁP ĐÁNH GIÁ CEFR
# ============================================================
# Triết lý: mọi thành phần đều đo "trần có bằng chứng", rồi mới tổng hợp.
# - Từ vựng: level cao nhất có ít nhất MIN_HARD_WORDS từ đạt được
#           (1 từ đơn lẻ có thể là học vẹt/ngẫu nhiên → không đủ bằng chứng)
# - Ngữ pháp: max điểm các câu (1 cấu trúc khó xuất hiện đã là bằng chứng năng lực)
# Nguồn từ vựng: CEFR-J Wordlist v1.5 (Yukio Tono, TUFS) + Octanove C1/C2 (CC BY-SA 4.0)
# Nguồn ngữ pháp: English Grammar Profile, Cambridge (dùng phi thương mại)

# Trọng số đánh giá toàn văn (hiệu chỉnh thủ công — xem báo cáo đồ án)
W_GRAMMAR, W_VOCAB, W_READABILITY = 0.40, 0.35, 0.25
# Số từ tối thiểu cùng đạt một level để công nhận level đó cho văn bản
MIN_HARD_WORDS = 2
# Số từ chấm điểm được tối thiểu để đánh giá toàn văn (ít hơn → báo thiếu dữ liệu)
MIN_SCORED_WORDS = 5

# Thư mục data/ chứa mọi file dữ liệu (JSON, CSV, DB). Tìm ở data/ trước,
# fallback về thư mục gốc để tương thích với bản deploy cũ.
def _data_path(*names):
    base = os.path.dirname(__file__)
    for n in names:
        p = os.path.join(base, "data", n)
        if os.path.exists(p):
            return p
    return os.path.join(base, names[0])


# Load Zenodo dataset (word + POS → continuous score 1.0–6.0)
_ZENODO_PATH = _data_path("WordsTeachersAverage.csv")
ZENODO: dict[tuple, float] = {}
if os.path.exists(_ZENODO_PATH):
    with open(_ZENODO_PATH, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                ZENODO[(row["Word"].lower(), row["PoS"].upper())] = float(row["Teachers Avg"])
            except Exception:
                pass
else:
    print("[WARN] Không tìm thấy WordsTeachersAverage.csv — flashcard & lookup sẽ fallback sang CEFR-J/Octanove.")

# Precompute trung bình theo lemma (tránh quét toàn dict mỗi lần tra từ)
_lemma_scores: dict[str, list[float]] = {}
for (_w, _p), _s in ZENODO.items():
    _lemma_scores.setdefault(_w, []).append(_s)
ZENODO_LEMMA_AVG: dict[str, float] = {w: sum(v) / len(v) for w, v in _lemma_scores.items()}

# ── CEFR-J Wordlist: từ vựng curated, trích dẫn được ──────────────────────
# Nguồn: CEFR-J Vocabulary Profile v1.5 — Yukio Tono, Tokyo University of Foreign Studies
#        (dùng free cho nghiên cứu/đồ án, cần trích dẫn trong báo cáo)
#      + Octanove Vocabulary Profile C1/C2 v1.0 (CC BY-SA 4.0)
# File CSV đặt cùng thư mục với main.py.
CEFRJ: dict[tuple, float] = {}
for _fn in ("cefrj-vocab-1.5.csv", "octanove-c1c2-1.0.csv"):
    _path = _data_path(_fn)
    if os.path.exists(_path):
        with open(_path, encoding="utf-8") as _f:
            for _row in csv.DictReader(_f):
                try:
                    _lv = _row["CEFR"].strip().upper()
                    if _lv in CEFR_NUMERIC:
                        CEFRJ[(_row["headword"].lower().strip(),
                               _row["pos"].strip().lower())] = float(CEFR_NUMERIC[_lv])
                except Exception:
                    pass

# Precompute CEFR-J trung bình theo lemma (phòng từ điển chỉ liệt kê 1 POS,
# vd "routine" có trong CEFR-J dưới dạng noun nhưng spaCy tag là ADJ)
_cefrj_lemma_scores: dict[str, list[float]] = {}
for (_w, _p), _s in CEFRJ.items():
    _cefrj_lemma_scores.setdefault(_w, []).append(_s)
CEFRJ_LEMMA: dict[str, float] = {w: sum(v) / len(v) for w, v in _cefrj_lemma_scores.items()}

# Map tag spaCy (universal) → tag POS của CEFR-J
CEFRJ_POS_MAP = {
    "NOUN": "noun", "VERB": "verb", "ADJ": "adjective", "ADV": "adverb",
    "DET": "determiner", "ADP": "preposition", "CCONJ": "conjunction",
    "SCONJ": "conjunction", "PRON": "pronoun", "NUM": "number",
    "INTJ": "interjection",
}

def _cefrj_pos(pos: str, lemma: str) -> str | None:
    """Map (spaCy POS, lemma) → POS tag của CEFR-J."""
    pos = (pos or "").upper()
    if pos == "AUX":
        if lemma == "be":   return "be-verb"
        if lemma == "do":   return "do-verb"
        if lemma == "have": return "have-verb"
        return "modal auxiliary"  # can/could/may/might/must/shall/should/will/would
    return CEFRJ_POS_MAP.get(pos)

# ── Dictionary DB ──────────────────────────────────────────
_DICT_PATH = _data_path("dictionary.db")
_dict_conn: sqlite3.Connection | None = None

def get_dict_conn() -> sqlite3.Connection | None:
    global _dict_conn
    if _dict_conn is None and os.path.exists(_DICT_PATH):
        _dict_conn = sqlite3.connect(_DICT_PATH, check_same_thread=False)
        _dict_conn.row_factory = sqlite3.Row
    return _dict_conn

_dict_vi_words: set[str] | None = None

def _words_with_vi_meaning() -> set[str]:
    """Cache set các từ tiếng Anh có nghĩa Việt trong dictionary.db
    (DB đã gộp từ điển gốc + Hồ Ngọc Đức từ anhviet109K.txt)."""
    global _dict_vi_words
    if _dict_vi_words is None:
        _dict_vi_words = set()
        conn = get_dict_conn()
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("""
                    SELECT DISTINCT LOWER(w.word)
                    FROM words w
                    WHERE w.lang_code = 'en'
                      AND EXISTS (
                        SELECT 1 FROM word_definitions wd
                        JOIN definitions d ON wd.definition_id = d.id
                        WHERE wd.word_id = w.id AND d.definition_lang = 'vi'
                      )
                """)
                _dict_vi_words = {r[0] for r in cur.fetchall() if r[0]}
            except Exception:
                pass
    return _dict_vi_words

SYSTEM_PROMPT = """
Bạn là English Tutor dành cho người Việt Nam.

Quy tắc:
1. Luôn trả lời bằng tiếng Việt.
2. Giải thích rõ ràng, chính xác và dễ hiểu.
3. Khi đưa ví dụ tiếng Anh, kèm giải thích bằng tiếng Việt.
4. Với câu hỏi sửa lỗi ngữ pháp, nói ĐÚNG hoặc SAI trước rồi giải thích.
5. Với câu hỏi so sánh từ vựng, chỉ ra sự khác nhau trực tiếp.
6. Khi được yêu cầu tạo bài tập, không đưa đáp án ngay.
7. Khi giải thích từ vựng, nêu CEFR level nếu có thể.
8. Ưu tiên ví dụ thực tế, ngắn gọn.
"""

CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
CEFR_COLORS = {
    "A1": "#22c55e", "A2": "#84cc16", "B1": "#eab308",
    "B2": "#f97316", "C1": "#ef4444", "C2": "#a855f7",
}
CEFR_DESC = {
    "A1": "Beginner", "A2": "Elementary", "B1": "Intermediate",
    "B2": "Upper-Intermediate", "C1": "Advanced", "C2": "Proficient",
}

WORD_PATTERN = re.compile(r"\b[A-Za-z]+(?:[''\-][A-Za-z]+)*\b")

# ============================================================
# FASTAPI SETUP
# ============================================================

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ============================================================
# MODELS
# ============================================================

class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []
    detect_words: bool = True
    doc_id: int | None = None  # 08/10/2026: hỏi đáp theo tài liệu đã tải lên


class CEFRRequest(BaseModel):
    text: str

class FullCEFRRequest(BaseModel):
    text: str

class WordRequest(BaseModel):
    word: str
    lemma: str | None = None


# ============================================================
# ROUTES
# ============================================================

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    # 12/10/2026: nhúng sẵn số liệu level Oxford 3000/5000 vào trang —
    # bấm vào Oxford là thấy ngay, không "Đang tải..." ngay cả lần đầu.
    return templates.TemplateResponse(request=request, name="index.html", context={
        "oxford_preload": {
            "3000": _oxford_levels_summary("3000"),
            "5000": _oxford_levels_summary("5000"),
        },
    })


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in req.history:
        role = item.get("role")
        content = item.get("content", "")
        if role in {"user", "assistant"} and content.strip():
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": req.message})

    # Gợi ý từ vựng IELTS theo chủ đề (04/10/2026): nếu câu hỏi của user
    # nhắc tới 1 chủ đề có trong kho (vd "cho tôi từ vựng chủ đề Môi trường"),
    # bơm vài từ mẫu vào system prompt để bot gợi ý từ THẬT thay vì bịa.
    # Không đổi SYSTEM_PROMPT gốc nên không ảnh hưởng code của Claude kia.
    _topic = _match_ielts_topic(req.message)
    if _topic:
        messages[0] = {"role": "system",
                       "content": messages[0]["content"] + _ielts_topic_context(_topic)}

    # Hỏi đáp theo tài liệu đã tải lên (08/10/2026): có doc_id -> bắt buộc đăng nhập
    # (tài liệu gắn theo tài khoản), lấy top-3 chunk liên quan nhất nhét vào system
    # prompt. Không có doc_id -> chat thường giữ nguyên 100%.
    if req.doc_id:
        _duser = _require_user(request)
        _dchunks = _get_doc_chunks(req.doc_id, _duser["id"])
        _dtop = _top_doc_chunks(_dchunks, req.message) if _dchunks else []
        if _dtop:
            _dctx = "\n\n".join(f"[đoạn {i + 1}]\n{c}" for i, c in _dtop)
            messages[0] = {"role": "system", "content":
                messages[0]["content"] +
                "\n\nTÀI LIỆU THAM KHẢO của người học (chỉ dùng thông tin trong "
                "các đoạn dưới đây để trả lời; nếu câu hỏi không có đáp án trong "
                "tài liệu, trả lời đúng câu 'Nội dung này không có trong tài liệu "
                "bạn đã tải lên.' và không bịa thêm; khi dùng thông tin từ đoạn "
                "nào, ghi [đoạn N] ở cuối câu):\n\n" + _dctx}

    # Detect từ khó B2/C1/C2 trong câu hỏi của user
    detected_words = []
    if req.detect_words:
        doc = nlp(req.message)
        seen = set()
        for token in doc:
            if (
                token.is_alpha
                and token.pos_ not in SKIP_POS
                and len(token.text) > 2
            ):
                lemma = token.lemma_.lower()
                if lemma in seen:
                    continue
                level = get_unified_level(lemma, token.pos_)
                if level in ("B2", "C1", "C2"):
                    seen.add(lemma)
                    detected_words.append({
                        "word":  token.text,
                        "lemma": lemma,
                        "level": level,
                        "color": CEFR_COLORS[level],
                        "desc":  CEFR_DESC[level],
                    })
        detected_words = detected_words[:5]

    def generate():
        # Gửi detected words trước
        if detected_words:
            yield f"data: {json.dumps({'words': detected_words})}\n\n"

        try:
            stream = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                max_tokens=8192,
                temperature=0.7,
                stream=True,
            )
            for chunk in stream:
                delta = getattr(chunk.choices[0].delta, "content", None)
                if delta:
                    yield f"data: {json.dumps({'content': delta})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )



@app.post("/api/cefr")
async def analyze_cefr(req: CEFRRequest):
    text = req.text.strip()
    if not text:
        return {"error": "Vui lòng nhập đoạn văn bản."}

    doc    = nlp(text)
    tokens = [m.group(0) for m in WORD_PATTERN.finditer(text)]
    if not tokens:
        return {"error": "Không tìm thấy từ tiếng Anh nào."}

    normalized = [t.lower() for t in tokens]

    # Lemma + POS map từ spaCy
    lemma_map: dict[str, str] = {}
    pos_map: dict[str, str] = {}
    for t in doc:
        if not t.is_punct:
            lemma_map[t.text.lower()] = t.lemma_.lower()
            pos_map[t.text.lower()] = t.pos_

    # Tra level: MỘT nguồn duy nhất (CEFR-J → Zenodo → cefrpy),
    # dùng lemma trước, fallback về surface form
    word_levels: dict[str, str | None] = {}
    for w in set(normalized):
        lemma = lemma_map.get(w, w)
        pos = pos_map.get(w, "")
        word_levels[w] = get_unified_level(lemma, pos) or get_unified_level(w, pos)

    occurrence_counts = Counter(
        word_levels[w] for w in normalized if word_levels[w] in CEFR_LEVELS
    )

    total     = len(tokens)
    known     = sum(occurrence_counts.values())
    unknown   = total - known
    known_pct = round(known / total * 100) if total else 0

    # ── Mức trần từ vựng: level cao nhất có đủ từ ủng hộ (chỉ content words) ──
    # (thay top-20%: với văn bản ngắn top_n=1 nên 1 từ lạ quyết định tất cả)
    content_scores = []
    for token in doc:
        if token.is_punct or token.pos_ in SKIP_POS or token.ent_type_:
            continue
        lv = word_levels.get(token.text.lower())
        if lv in CEFR_LEVELS:
            content_scores.append(float(CEFR_NUMERIC[lv]))
    vocab_level, _vocab_score = _ceiling_level(content_scores)

    highlighted = build_highlighted(text, word_levels, lemma_map)

    distribution = []
    for lv in CEFR_LEVELS:
        cnt = occurrence_counts[lv]
        pct = round(cnt / known * 100) if known else 0
        distribution.append({"level": lv, "desc": CEFR_DESC[lv],
                              "color": CEFR_COLORS[lv], "count": cnt, "pct": pct})

    return {
        "total": total, "known": known, "unknown": unknown, "known_pct": known_pct,
        "vocab_level": vocab_level,
        "vocab_color": CEFR_COLORS[vocab_level],
        "vocab_desc":  CEFR_DESC[vocab_level],
        "distribution": distribution,
        "highlighted":  highlighted,
    }


@app.post("/api/word")
async def lookup_word(req: WordRequest):
    conn = get_dict_conn()
    if not conn:
        return {"found": False, "word": req.word, "error": "Từ điển chưa được tải."}

    original = req.word.strip()
    base     = (req.lemma or original).lower().strip()
    cur      = conn.cursor()

    def query_db(word: str) -> list:
        cur.execute("""
            SELECT w.word, d.definition, d.pos, p.ipa
            FROM words w
            LEFT JOIN word_definitions wd ON w.id = wd.word_id
            LEFT JOIN definitions d ON wd.definition_id = d.id AND d.definition_lang = 'vi'
            LEFT JOIN pronunciations p ON w.id = p.word_id
            WHERE LOWER(w.word) = ? AND w.lang_code = 'en'
            ORDER BY d.pos, wd.id LIMIT 8
        """, (word,))
        return cur.fetchall()

    def spacy_lemma(word: str) -> str:
        """Từ gốc bằng spaCy — xử lý cả bất quy tắc (children→child,
        went→go, better→good, leaves→leaf) mà rule-based không làm được."""
        try:
            doc = nlp(word)
            if doc and doc[0].lemma_:
                return doc[0].lemma_.lower().strip()
        except Exception:
            pass
        return word

    def candidates(word: str) -> list[str]:
        """Các dạng biến thể rule-based — chỉ dùng khi spaCy không rút gọn được.
        Có guard độ dài để không cắt nhầm từ ngắn (his→hi, red→re)."""
        c = []
        # surprisingly → surprising → surprise
        if word.endswith("ly") and len(word) > 4:
            base2 = word[:-2]
            c.append(base2)
            if base2.endswith(("ab", "ib")):
                c.append(base2 + "le")       # considerably→considerable
            if base2.endswith("ing"):
                c.append(base2[:-3] + "e")   # surprisingly→surprise
            if base2.endswith("i"):
                c.append(base2[:-1] + "y")   # happily→happy
        # running → run, taking → take
        if word.endswith("ing") and len(word) > 5:
            c.append(word[:-3])
            c.append(word[:-3] + "e")
            if len(word) > 6:
                c.append(word[:-4])          # running→run (phụ âm đôi)
        # studied → study
        if word.endswith("ied") and len(word) > 4:
            c.append(word[:-3] + "y")
        # walked → walk (elif để không đè lên ied)
        elif word.endswith("ed") and len(word) > 4:
            c.append(word[:-2])
            c.append(word[:-1])
        # watches → watch, cats → cat (guard: his/is/as không bị cắt)
        if word.endswith("es") and len(word) > 4:
            c.append(word[:-2])
        if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
            c.append(word[:-1])
        return c

    _STUB_HINTS = ("số nhiều của", "plural of", "quá khứ của", "past tense",
                   "past participle", "phân từ", "hiện tại của", "so sánh của")

    def _is_stub(rows: list) -> bool:
        """Mục chỉ là tham chiếu chéo (vd 'Số nhiều của hand') —
        không đủ nghĩa cho người học, phải tìm tiếp từ gốc."""
        defs = [(r[1] or "").strip().lower() for r in rows if r[1]]
        return bool(defs) and all(any(h in d for h in _STUB_HINTS) for d in defs)

    lemma = spacy_lemma(base)
    ordered: list[str] = []
    if " " in base:
        # Cụm từ (phrasal verb, 08/10/2026): thử khớp NGUYÊN CỤM trước ("give up"),
        # rồi tới cụm đã lemmatize từ đầu ("gave up" -> "give up").
        # Bắt buộc vì spacy_lemma chỉ lấy lemma của token đầu ("gave up" -> "give")
        # nên thứ tự cũ (lemma trước) sẽ trả nhầm từ đơn "give".
        _parts = base.split()
        _phrase_lemma = " ".join([spacy_lemma(_parts[0])] + _parts[1:])
        for cand in (base, _phrase_lemma):
            if cand and cand not in ordered:
                ordered.append(cand)
    # Thứ tự ưu tiên: TỪ GỐC TRƯỚC (hands→hand, grew→grow như popup từ điển),
    # rồi mới tới dạng người dùng bấm và các biến thể rule-based.
    for cand in ([lemma] if lemma != base else []) + [base] + candidates(base):
        if cand and cand not in ordered:
            ordered.append(cand)

    rows: list = []
    matched_lemma: str = base  # từ thực sự tìm thấy trong DB
    stub_fallback: tuple | None = None
    for candidate in ordered:
        r = query_db(candidate)
        if not r:
            continue
        if _is_stub(r):
            if stub_fallback is None:
                stub_fallback = (r, candidate)
            continue  # bỏ qua stub, tìm tiếp mục đầy đủ hơn
        rows, matched_lemma = r, candidate
        break
    if not rows and stub_fallback:
        rows, matched_lemma = stub_fallback
    if not rows:
        return {"found": False, "word": original}

    def _expand_hw_abbrev(text: str, headword: str) -> str:
        """Từ điển HND viết tắt từ đầu mục bằng chữ cái đầu + '.' (vd mục 'in'
        ghi 'i. fact' thay cho 'in fact'). Bung ra cho dễ đọc. Chỉ áp dụng khi
        headword là 1 từ đơn (10/10/2026)."""
        hw = (headword or "").strip().lower()
        if not hw or " " in hw or not text or not hw[0].isalpha():
            return text
        return re.sub(r"\b" + hw[0] + r"\.\s+", hw + " ", text, flags=re.IGNORECASE)

    # Gom nghĩa theo POS
    meanings: dict[str, list[str]] = {}
    ipa = None
    for row in rows:
        if row[3] and not ipa:
            ipa = row[3]
        pos  = row[2] or ""
        defn = _expand_hw_abbrev(row[1], matched_lemma)
        if defn:
            meanings.setdefault(pos, [])
            if defn not in meanings[pos]:
                meanings[pos].append(defn)

    pos_map = {
        "N": "Danh từ", "V": "Động từ", "A": "Tính từ", "Adj": "Tính từ",
        "Av": "Trạng từ", "Adv": "Trạng từ", "O": "Thán từ", "Interj": "Thán từ",
        "P": "Giới từ", "Prep": "Giới từ", "C": "Liên từ", "Conj": "Liên từ",
        "D": "Định từ", "Det": "Định từ", "Art": "Mạo từ",
        "Pron": "Đại từ", "Num": "Số từ", "Aux": "Trợ động từ",
    }

    # Trả TẤT CẢ nhóm POS (không giới hạn 3) để popup hiện đủ vai trò của từ
    # như popup mẫu (vd "the": Mạo từ + Trạng từ). Mỗi nhóm tối đa 4 nghĩa.
    formatted = [{"pos": pos_map.get(p, p), "definitions": defs[:4]}
                 for p, defs in meanings.items()]

    # Uu tien nghia pho bien + nhan "hiem" (06/10/2026):
    # neu tu co trong du lieu bien soan (TOEIC/IELTS/topic), dua nghia khop
    # nhat len dau; nghia lech xa thi gan nhan hiem de nguoi hoc khong nham
    # (vd "mall": "trung tam mua sam" len dau, "bua ta" nhan hiem).
    def _tok(s: str) -> set:
        return set(re.findall(r"[a-zA-Z\u00e0-\u1ef9\u00c0-\u1ef80-9]+", s.lower()))
    def _jaccard(a: str, b: str) -> float:
        ta, tb = _tok(a), _tok(b)
        return (len(ta & tb) / len(ta | tb)) if (ta or tb) else 0.0
    common_meaning = COMMON_MEANINGS.get((matched_lemma or "").lower(), "")
    rare_set: set = set()
    primary_text = ""
    if common_meaning:
        if not formatted:
            formatted = [{"pos": "", "definitions": [common_meaning]}]
            primary_text = common_meaning
        else:
            scored = [(_jaccard(common_meaning, d), gi, di)
                      for gi, g in enumerate(formatted)
                      for di, d in enumerate(g["definitions"])]
            best_score = -1.0
            if scored:
                scored.sort(key=lambda x: -x[0])
                best_score, best_gi, best_di = scored[0]
            if best_score >= 0.25:
                best_def_text = formatted[best_gi]["definitions"][best_di]
                grp = formatted.pop(best_gi)
                grp["definitions"].pop(best_di)
                grp["definitions"].insert(0, best_def_text)
                formatted.insert(0, grp)
                primary_text = best_def_text
            else:
                # 10/10/2026: từ điển thiếu hẳn nghĩa phổ biến (vd "mall" thiếu
                # "trung tâm mua sắm") -> chèn nghĩa biên soạn lên đầu thay vì
                # chỉ reorder (trước đây trường hợp này bị bỏ qua, nghĩa hiếm
                # "búa tạ" thắng tie-break và hiện lên đầu).
                formatted[0]["definitions"].insert(0, common_meaning)
                primary_text = common_meaning
        for g in formatted:
            for d in g["definitions"]:
                if d == primary_text:
                    continue
                if _jaccard(common_meaning, d) < 0.15:
                    rare_set.add((g["pos"], d))
    # gan nhan hiem + giu backward-compat (definitions la str)
    for g in formatted:
        new_defs = []
        for d in g["definitions"]:
            new_defs.append({"text": d, "rare": (g["pos"], d) in rare_set})
        g["definitions"] = new_defs
    # Nghia chinh — hien thi noi bat nhu popup tu dien
    primary = None
    if formatted and formatted[0]["definitions"]:
        primary = {"pos": formatted[0]["pos"],
                   "definition": formatted[0]["definitions"][0]["text"]}
    try:
        cefr = get_unified_level(matched_lemma)
    except Exception:
        cefr = None

    return {"found": True, "word": original, "lemma": matched_lemma, "ipa": ipa,
            "cefr": cefr, "primary": primary, "meanings": formatted}


@app.get("/api/flashcard-words")
async def flashcard_words(level: str = "B2", count: int = 15):
    """Trả về danh sách từ ngẫu nhiên theo CEFR level (Oxford, fallback Zenodo/CEFR-J/Octanove) + nghĩa từ dictionary.db."""
    level = level.upper().strip()
    count = max(1, min(count, 50))
    if level not in CEFR_LEVELS:
        return {"error": f"Level không hợp lệ. Dùng: {', '.join(CEFR_LEVELS)}"}

    # ── 1. Lấy danh sách từ theo level ──
    # Nguồn chính: Oxford 3000/5000 (level chuẩn OUP, 05/10/2026).
    # Fallback: Zenodo (điểm giáo viên), rồi CEFR-J + Octanove
    # khi thiếu WordsTeachersAverage.csv hoặc level đó không có từ.
    # Dedup: mỗi từ chỉ lấy 1 lần (bỏ qua POS khác nhau)
    seen_words: set[str] = set()
    candidates: list[str] = []
    for word, score in OXFORD_LEVELS.items():
        # Bỏ cụm từ (Oxford 5000 có mục như "any more")
        if " " in word or "/" in word:
            continue
        if _score_to_cefr(score) == level:
            seen_words.add(word)
            candidates.append(word)

    if not candidates:
        for (word, pos), score in ZENODO.items():
            if word in seen_words:
                continue
            if _score_to_cefr(score) == level:
                seen_words.add(word)
                candidates.append(word)

    if not candidates:
        for (word, pos), score in CEFRJ.items():
            if word in seen_words:
                continue
            # Bỏ cụm từ (CEFR-J có mục như "turn to", "percent/per cent")
            if " " in word or "/" in word:
                continue
            if _score_to_cefr(score) == level:
                seen_words.add(word)
                candidates.append(word)

    if not candidates:
        return {"error": f"Không tìm thấy từ nào ở level {level}"}

    # Chỉ giữ từ có nghĩa Việt trong dictionary.db (loại từ rác như "cless")
    vi_words = _words_with_vi_meaning()
    if vi_words:
        candidates = [w for w in candidates if w.lower() in vi_words]

    if not candidates:
        return {"error": f"Không tìm thấy từ nào ở level {level} có nghĩa tiếng Việt"}

    sample_size = min(len(candidates), count)
    sampled = random.sample(candidates, sample_size)

    # ── 2. Lookup nghĩa + IPA từ dictionary.db ──
    conn = get_dict_conn()
    results = []

    for word in sampled:
        if len(results) >= count:
            break

        if conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT w.word, d.definition, d.pos, p.ipa
                FROM words w
                LEFT JOIN word_definitions wd ON w.id = wd.word_id
                LEFT JOIN definitions d ON wd.definition_id = d.id AND d.definition_lang = 'vi'
                LEFT JOIN pronunciations p ON w.id = p.word_id
                WHERE LOWER(w.word) = ? AND w.lang_code = 'en'
                ORDER BY d.pos, wd.id LIMIT 6
            """, (word,))
            rows = cur.fetchall()
        else:
            rows = []

        # Gom nghĩa theo POS
        pos_map = {
            "N": "Danh từ", "V": "Động từ", "A": "Tính từ", "Adj": "Tính từ",
            "Av": "Trạng từ", "Adv": "Trạng từ", "O": "Thán từ", "Interj": "Thán từ",
            "P": "Giới từ", "Prep": "Giới từ", "C": "Liên từ", "Conj": "Liên từ",
            "D": "Định từ", "Det": "Định từ", "Art": "Mạo từ",
            "Pron": "Đại từ", "Num": "Số từ", "Aux": "Trợ động từ",
        }
        meanings: dict[str, list[str]] = {}
        ipa = None
        for row in rows:
            if row[3] and not ipa:
                ipa = row[3]
            pos  = row[2] or ""
            defn = row[1]
            if defn:
                meanings.setdefault(pos, [])
                if defn not in meanings[pos]:
                    meanings[pos].append(defn)

        formatted_meanings = [
            {"pos": pos_map.get(p, p), "definitions": defs[:2]}
            for p, defs in list(meanings.items())[:2]
        ]

        _tp = _tatoeba_first(word)
        results.append({
            "word":        word,
            "level":       level,
            "color":       CEFR_COLORS[level],
            "ipa":         ipa,
            # meanings rỗng → frontend sẽ fallback sang Free Dictionary API
            "meanings":    formatted_meanings,
            "has_vi":      len(formatted_meanings) > 0,
            # ví dụ Tatoeba nhét sẵn -> thẻ hiện ngay, không fetch từng thẻ
            "tatoeba_en":  _tp.get("en", ""),
            "tatoeba_vi":  _tp.get("vi", ""),
        })

    return {"level": level, "count": len(results), "words": results}


# ============================================================
# DỮ LIỆU IELTS / TOEIC (thêm 04/10/2026)
# ------------------------------------------------------------
# Nguồn: Google Sheets cộng đồng — từ vựng IELTS Speaking (482),
# thành ngữ IELTS (300), từ vựng TOEIC 300-450 (596),
# Oxford 3000/5000 gộp (4.955 từ có level chuẩn OUP).
# File JSON đặt trong thư mục data/ cùng cấp main.py,
# load MỘT LẦN lúc khởi động, không đọc lại mỗi request.
# ============================================================

def _load_json(*names):
    for name in names:
        # thử data/name trước, rồi name (fallback bản deploy cũ)
        for path in (_data_path(name), os.path.join(os.path.dirname(__file__), name)):
            if os.path.exists(path):
                try:
                    with open(path, encoding="utf-8") as f:
                        return json.load(f)
                except Exception as e:
                    print(f"[WARN] Lỗi đọc {name}: {e}")
                    return None
    print(f"[WARN] Không tìm thấy {names[0]} (đã thử: {names})")
    return None


def _as_list(data):
    """Chuẩn hoá JSON về list các mục từ vựng."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("words", "items", "data"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


IELTS_SPEAKING = _as_list(_load_json("ielts_speaking_vocab.json"))
IELTS_IDIOMS   = _as_list(_load_json("ielts_idioms.json"))
# Tu vung bo sung theo 8 chu de (06/10/2026): 842 tu tu pipeline mining
# tu dien Ho Ngoc Duc + Oxford, da review thu cong, co VD song ngu.
TOPIC_EXTRA    = _as_list(_load_json("topic_vocab_extra.json"))

# Nghia pho bien tu du lieu da bien soan (06/10/2026): TOEIC 3 band, IELTS
# speaking, topic bo sung. Dung de uu tien nghia thong dung trong popup
# tra tu (vd "mall" -> "trung tam mua sam" thay vi "bua ta").
COMMON_MEANINGS: dict[str, str] = {}
for _f in ("toeic_300_450.json", "toeic_450_650.json", "toeic_650_800.json",
           "ielts_speaking_vocab.json", "topic_vocab_extra.json"):
    for _w in _as_list(_load_json(_f)):
        _wl = str(_w.get("word", "")).lower().strip()
        _m = str(_w.get("meaning", "")).strip()
        if _wl and _m and _wl not in COMMON_MEANINGS:
            COMMON_MEANINGS[_wl] = _m
# Cum tu thong dung AI hay dich sai -> ghi de cung (06/10/2026)
_COMMON_FIXES = {
    "extra bed": "giường phụ",
    "late checkout": "trả phòng muộn",
    "room service": "dịch vụ phòng",
    "check-in": "đăng ký nhận phòng",
    "check-out": "đăng ký trả phòng",
    "cancellation policy": "chính sách hủy đặt phòng",
}
for _k, _v in _COMMON_FIXES.items():
    COMMON_MEANINGS.setdefault(_k, _v)
print(f"[DATA] Common meanings: {len(COMMON_MEANINGS)}")
TOEIC_BASIC    = _as_list(_load_json("toeic_300_450.json"))
# TOEIC theo band (06/10/2026): B1 450-650 (297 từ mới), B2 650-800 (300 từ mới).
# Nguồn: Google Sheets cộng đồng (nyanenglish.com), cùng schema với toeic_300_450.json.
TOEIC_B1       = _as_list(_load_json("toeic_450_650.json"))
TOEIC_B2       = _as_list(_load_json("toeic_650_800.json"))

# Ví dụ song ngữ soạn sẵn cho 300 idiom (04/10/2026) — hiện thẳng ở flashcard,
# khỏi gọi dictionaryapi.dev (vốn không có idiom) -> người học không phải đợi
IDIOM_EXAMPLES: dict = _load_json("ielts_idiom_examples.json") or {}

# Cặp câu song ngữ Anh–Việt từ Tatoeba (07/10/2026): 23.157 cặp, CC-BY 2.0 FR.
# Dùng cho mục "Câu ví dụ" trong popup tra từ + mặt sau flashcard.
# Build: downloads.tatoeba.org (per-language vie/eng + links), join 3 pass, dedup.
TATOEBA_PAIRS = _as_list(_load_json("tatoeba_en_vi.json"))
_TATOEBA_INDEX: dict[str, list[int]] = {}
_tatoeba_tok_re = re.compile(r"[a-zA-Z]+(?:'[a-z]+)?")
for _i, _p in enumerate(TATOEBA_PAIRS):
    for _tok in set(_tatoeba_tok_re.findall(str(_p.get("en", "")).lower())):
        _lst = _TATOEBA_INDEX.setdefault(_tok, [])
        if len(_lst) < 12:
            _lst.append(_i)
print(f"[DATA] Tatoeba pairs: {len(TATOEBA_PAIRS)}")

# Collocations từ SyntagNet (08/10/2026): word -> [[collocate, freq], ...],
# xếp theo tần suất đồng xuất hiện trong 23k câu Tatoeba (build offline 1 lần).
# Nguồn: x-englishwordnet/syntagnet, CC BY-NC-SA 4.0 — frontend ghi attribution.
# Data gốc chỉ có quan hệ động từ–danh từ; tính từ–danh từ (heavy rain) không có.
# Collocations: MỘT file gộp duy nhất (build 09/10/2026, xem /tmp/build_full.py) —
# tier "curated" (466 cụm biên soạn tay, ưu tiên trước) > "attested" (2.397 cặp có
# bằng chứng trong 23.157 câu Tatoeba, kèm ví dụ thật EN+VI) > "lexical" (52.314
# cặp còn lại, có nghĩa Việt từ từ điển Anh-Việt, không bịa ví dụ).
# Entry: {col, vi, freq, tier, en, vi_ex, curated?}
_COLLOC_FULL: dict = _load_json("collocations_full.json") or {}
_COLLOC_SOURCE = "SyntagNet (CC BY-NC-SA 4.0); biên soạn thủ công"
print(f"[DATA] Collocations: {len(_COLLOC_FULL)} headwords")

# WordNet qua NLTK (07/10/2026): đồng nghĩa / trái nghĩa tiếng Anh.
# Lazy-load + try/except: thiếu nltk hoặc dữ liệu wordnet thì endpoint trả rỗng,
# app vẫn chạy bình thường. License: Princeton WordNet License (ghi trong báo cáo).
_WN = None
_WN_TRIED = False
def _get_wordnet():
    """Trả về nltk.corpus.wordnet hoặc None nếu không khả dụng."""
    global _WN, _WN_TRIED
    if _WN_TRIED:
        return _WN
    _WN_TRIED = True
    try:
        import nltk
        from nltk.corpus import wordnet as wn
        try:
            wn.synsets("test")
        except LookupError:
            nltk.download("wordnet", quiet=True)
        _WN = wn
        print("[DATA] WordNet sẵn sàng")
    except Exception as e:
        print(f"[WARN] WordNet không khả dụng: {e}")
        _WN = None
    return _WN

# Oxford 3000/5000 gộp (05/10/2026): 4.955 từ unique, level chuẩn OUP (A1-C1).
# Dùng làm tầng tra cứu CEFR + nguồn level cho flashcard ngẫu nhiên.
# Nguồn: PDF chính thức Oxford Learner's Dictionaries (© OUP).
OXFORD_LEVELS: dict[str, float] = {}
_oxford_raw = _load_json("oxford_levels.json") or {}
for _w, _lv in _oxford_raw.items():
    _lv = str(_lv).strip().upper()
    if _lv in CEFR_NUMERIC:
        _w = str(_w).lower().strip()
        if _w and (_w not in OXFORD_LEVELS):
            OXFORD_LEVELS[_w] = float(CEFR_NUMERIC[_lv])
# Oxford 3000 goc (06/10/2026): danh sach 2.967 tu cot loi OUP (mirror PDF chinh thuc).
# Dung de tach "Oxford 3000" vs "Oxford 5000 nang cao" cho tab Flashcard.
# Nguon: github.com/minjikim1013/the_oxford_3000_cefr (mirror OUP).
OXFORD_3000: set[str] = set()
_oxford3000_raw = _load_json("oxford_3000.json") or []
OXFORD_3000 = {str(w).lower().strip() for w in _oxford3000_raw if str(w).strip()}
print(f"[DATA] IELTS speaking: {len(IELTS_SPEAKING)} | idioms: {len(IELTS_IDIOMS)} "
      f"| TOEIC: {len(TOEIC_BASIC)}+{len(TOEIC_B1)}+{len(TOEIC_B2)} | idiom examples: {len(IDIOM_EXAMPLES)} "
      f"| Oxford: {len(OXFORD_LEVELS)} | Oxford3000: {len(OXFORD_3000)} | TopicExtra: {len(TOPIC_EXTRA)}")

# Nhom chu de hien thi o tab Flashcard (06/10/2026): gop 18 topic IELTS
# thanh 6 nhom theo anh mau user gui.
TOPIC_GROUPS: dict[str, dict] = {
    "du-lich": {
        "title": "Du l\u1ecbch", "desc": "T\u1eeb v\u1ef1ng ch\u1ee7 \u0111\u1ec1 du l\u1ecbch, giao th\u00f4ng, kh\u00e1ch s\u1ea1n.",
        "icon": "ri-plane-line", "color": "#0ea5e9", "level": "B1",
        "topics": ["Du l\u1ecbch"],
    },
    "kinh-doanh": {
        "title": "Kinh doanh", "desc": "T\u1eeb v\u1ef1ng ch\u1ee7 \u0111\u1ec1 kinh doanh, c\u00f4ng s\u1edf, t\u00e0i ch\u00ednh.",
        "icon": "ri-briefcase-line", "color": "#f59e0b", "level": "B1",
        "topics": ["Kinh doanh", "C\u00f4ng vi\u1ec7c"],
    },
    "doi-song": {
        "title": "\u0110\u1eddi s\u1ed1ng h\u1eb1ng ng\u00e0y",
        "desc": "T\u1eeb v\u1ef1ng gia \u0111\u00ecnh, nh\u00e0 c\u1eeda, qu\u1ea7n \u00e1o, \u0111\u1ed3 d\u00f9ng.",
        "icon": "ri-home-smile-line", "color": "#84cc16", "level": "B1",
        "topics": ["Nh\u00e0 c\u1eeda", "Mua s\u1eafm", "Th\u1eddi trang", "Th\u00e0nh ph\u1ed1", "Quan h\u1ec7",
                   "T\u00ednh c\u00e1ch", "Th\u1eddi ti\u1ebft", "Phim & S\u00e1ch",
                   "\u00c2m nh\u1ea1c",
                   "Đời sống hằng ngày"],
    },
    "giao-duc": {
        "title": "Gi\u00e1o d\u1ee5c",
        "desc": "T\u1eeb v\u1ef1ng tr\u01b0\u1eddng h\u1ecdc, h\u1ecdc t\u1eadp, gi\u00e1o d\u1ee5c.",
        "icon": "ri-graduation-cap-line", "color": "#6366f1", "level": "B1",
        "topics": ["Gi\u00e1o d\u1ee5c"],
    },
    "moi-truong": {
        "title": "M\u00f4i tr\u01b0\u1eddng",
        "desc": "T\u1eeb v\u1ef1ng m\u00f4i tr\u01b0\u1eddng, thi\u00ean nhi\u00ean, kh\u00ed h\u1eadu.",
        "icon": "ri-earth-line", "color": "#16a34a", "level": "B1",
        "topics": ["M\u00f4i tr\u01b0\u1eddng"],
    },
    "cong-nghe": {
        "title": "C\u00f4ng ngh\u1ec7", "desc": "T\u1eeb v\u1ef1ng m\u00e1y t\u00ednh, internet, c\u00f4ng ngh\u1ec7.",
        "icon": "ri-computer-line", "color": "#8b5cf6", "level": "B1",
        "topics": ["C\u00f4ng ngh\u1ec7"],
    },
    "suc-khoe": {
        "title": "S\u1ee9c kh\u1ecfe", "desc": "T\u1eeb v\u1ef1ng s\u1ee9c kh\u1ecfe, y t\u1ebf, c\u01a1 th\u1ec3.",
        "icon": "ri-heart-pulse-line", "color": "#ef4444", "level": "B1",
        "topics": ["S\u1ee9c kh\u1ecfe", "Th\u1ec3 thao"],
    },
    "am-thuc": {
        "title": "\u1ea8m th\u1ef1c", "desc": "T\u1eeb v\u1ef1ng \u0111\u1ed3 \u0103n, n\u1ea5u n\u01b0\u1edbng, th\u1ee9c u\u1ed1ng.",
        "icon": "ri-restaurant-line", "color": "#f97316", "level": "B1",
        "topics": ["\u1ea8m th\u1ef1c"],
    },
}


@app.get("/api/flashcard-ielts")
async def flashcard_ielts(kind: str = "speaking", topic: str = "", count: int = 15,
                          band: str = "all"):
    """Flashcard theo bộ từ vựng IELTS/TOEIC.
    kind: toeic (3 band: 300-450/A2, 450-650/B1, 650-800/B2) | speaking (482 từ / 18 chủ đề)
    | idiom (300 thành ngữ).
    topic: lọc theo chủ đề (chỉ áp dụng cho speaking/idiom), "" = tất cả.
    band: chỉ áp dụng cho kind=toeic — "300-450" | "450-650" | "650-800" | "all"."""
    count = max(1, min(count, 50))
    toeic_bands = {"300-450": TOEIC_BASIC, "450-650": TOEIC_B1, "650-800": TOEIC_B2}
    if kind == "toeic":
        src = toeic_bands.get(band) if band != "all" else (TOEIC_BASIC + TOEIC_B1 + TOEIC_B2)
        if src is None:
            return {"error": "band không hợp lệ. Dùng: 300-450 | 450-650 | 650-800 | all"}
    else:
        src = {"speaking": IELTS_SPEAKING, "idiom": IELTS_IDIOMS}.get(kind)
        if src is None:
            return {"error": "kind không hợp lệ. Dùng: toeic | speaking | idiom"}
    items = [w for w in src if not topic or w.get("topic") == topic]
    if not items:
        return {"error": "Không có từ nào cho lựa chọn này"}
    sampled = random.sample(items, min(len(items), count))
    band_level = {"300-450": "A2", "450-650": "B1", "650-800": "B2"}
    level_of = {"toeic": "A2", "speaking": "B1", "idiom": "B2"}
    lv = level_of[kind]
    words = []
    for w in sampled:
        _tp = _tatoeba_first(w.get("word", ""))
        meaning = (w.get("meaning") or "").strip()
        wlv = (w.get("cefr") or "").strip() or (band_level.get(band) if kind == "toeic" and band != "all" else lv)
        if wlv not in CEFR_COLORS: wlv = lv
        words.append({
            "word":       w.get("word", ""),
            "ipa":        (w.get("ipa") or "").strip("/"),
            "meanings":   ([{"pos": w.get("pos", ""),
                             "definitions": [meaning]}] if meaning else []),
            "has_vi":     bool(meaning),
            "topic":      w.get("topic", ""),
            "level":      wlv,
            "color":      CEFR_COLORS.get(wlv, "#6366f1"),
            # Ví dụ song ngữ có sẵn -> hiện thẳng, khỏi gọi API ngoài:
            # TOEIC lấy từ JSON gốc, idiom lấy từ ielts_idiom_examples.json
            "example_en": w.get("example", "") or IDIOM_EXAMPLES.get(w.get("word", ""), {}).get("en", ""),
            "example_vi": w.get("example_vi", "") or IDIOM_EXAMPLES.get(w.get("word", ""), {}).get("vi", ""),
            "tatoeba_en": _tp.get("en", ""),
            "tatoeba_vi": _tp.get("vi", ""),
        })
    return {"kind": kind, "topic": topic, "total": len(items),
            "count": len(words), "words": words}


@app.get("/api/ielts-topics")
async def ielts_topics(kind: str = "speaking"):
    """Danh sách chủ đề của bộ từ vựng (để vẽ dropdown ở frontend)."""
    src = {"speaking": IELTS_SPEAKING, "idiom": IELTS_IDIOMS}.get(kind, [])
    topics = sorted({w.get("topic") for w in src if w.get("topic")})
    return {"kind": kind, "topics": topics}


# ============================================================
# TRANG CHỦ + FLASHCARD THEO CHỦ ĐỀ (06/10/2026)
# ============================================================

def _lookup_word_details(word: str):
    """Tra IPA + nghĩa Việt từ dictionary.db cho 1 từ. Trả về (ipa, meanings)."""
    conn = get_dict_conn()
    rows = []
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT w.word, d.definition, d.pos, p.ipa
                FROM words w
                LEFT JOIN word_definitions wd ON w.id = wd.word_id
                LEFT JOIN definitions d ON wd.definition_id = d.id AND d.definition_lang = 'vi'
                LEFT JOIN pronunciations p ON w.id = p.word_id
                WHERE LOWER(w.word) = ? AND w.lang_code = 'en'
                ORDER BY d.pos, wd.id LIMIT 6
            """, (word.lower(),))
            rows = cur.fetchall()
        except Exception:
            rows = []
    pos_map = {
        "N": "Danh từ", "V": "Động từ", "A": "Tính từ", "Adj": "Tính từ",
        "Av": "Trạng từ", "Adv": "Trạng từ", "O": "Thán từ", "Interj": "Thán từ",
        "P": "Giới từ", "Prep": "Giới từ", "C": "Liên từ", "Conj": "Liên từ",
        "D": "Định từ", "Det": "Định từ", "Art": "Mạo từ",
        "Pron": "Đại từ", "Num": "Số từ", "Aux": "Trợ động từ",
    }
    meanings: dict[str, list[str]] = {}
    ipa = None
    for row in rows:
        if row[3] and not ipa:
            ipa = row[3]
        pos = row[2] or ""
        defn = row[1]
        if defn:
            meanings.setdefault(pos, [])
            if defn not in meanings[pos]:
                meanings[pos].append(defn)
    formatted = [
        {"pos": pos_map.get(p, p), "definitions": defs[:2]}
        for p, defs in list(meanings.items())[:2]
    ]
    return ipa, formatted


@app.get("/api/oxford-deck")
async def oxford_deck(source: str = "3000", count: int = 15, level: str = ""):
    """Bo the Oxford theo nguon: 3000 (tu cot loi) | 5000 (2000 tu nang cao).
    Chi lay tu co nghia Viet trong dictionary.db (loai tu rac).
    level: loc theo trinh do CEFR (A1/A2/B1/B2/C1), "" = tat ca."""
    source = source.strip()
    count = max(1, min(count, 50))
    level = level.strip().upper()
    if source not in ("3000", "5000"):
        return {"error": "source khong hop le. Dung: 3000 | 5000"}
    if level and level not in ("A1", "A2", "B1", "B2", "C1"):
        return {"error": "level khong hop le. Dung: A1 | A2 | B1 | B2 | C1"}
    if source == "3000":
        candidates = [w for w in OXFORD_LEVELS if w in OXFORD_3000]
        title, lv_label = "Oxford 3000", "A1-B2"
    else:
        candidates = [w for w in OXFORD_LEVELS if w not in OXFORD_3000]
        title, lv_label = "Oxford 5000 nang cao", "B2-C1"
    vi_words = _words_with_vi_meaning()
    if vi_words:
        candidates = [w for w in candidates if w.lower() in vi_words]
    if level:
        candidates = [w for w in candidates if _score_to_cefr(OXFORD_LEVELS[w]) == level]
        lv_label = level
    if not candidates:
        return {"error": "Khong tim thay tu nao co nghia tieng Viet"}
    sampled = random.sample(candidates, min(len(candidates), count))
    results = []
    for word in sampled:
        ipa, meanings = _lookup_word_details(word)
        lv = _score_to_cefr(OXFORD_LEVELS[word])
        results.append({
            "word": word, "ipa": ipa, "meanings": meanings,
            "has_vi": len(meanings) > 0,
            "topic": title, "level": lv, "color": CEFR_COLORS.get(lv, "#6366f1"),
        })
    return {"source": source, "title": title, "level": lv_label,
            "total": len(candidates), "count": len(results), "words": results}


def _oxford_levels_summary(source):
    """Đếm từ Oxford theo từng trình độ CEFR (đã lọc từ có nghĩa Việt).
    12/10/2026: tách từ endpoint /api/oxford-levels để tái dùng khi nhúng
    sẵn dữ liệu vào trang chủ (Jinja) — vào Oxford là thấy ngay, không đợi."""
    source = (source or "").strip()
    if source not in ("3000", "5000"):
        return {"error": "source khong hop le. Dung: 3000 | 5000"}
    if source == "3000":
        candidates = [w for w in OXFORD_LEVELS if w in OXFORD_3000]
        title = "Oxford 3000"
        order = ["A1", "A2", "B1", "B2"]
    else:
        candidates = [w for w in OXFORD_LEVELS if w not in OXFORD_3000]
        title = "Oxford 5000 nang cao"
        order = ["B2", "C1"]
    vi_words = _words_with_vi_meaning()
    if vi_words:
        candidates = [w for w in candidates if w.lower() in vi_words]
    by_level = {}
    for w in candidates:
        lv = _score_to_cefr(OXFORD_LEVELS[w])
        by_level[lv] = by_level.get(lv, 0) + 1
    levels = [{"level": lv, "count": by_level.get(lv, 0)} for lv in order if by_level.get(lv, 0) > 0]
    return {"source": source, "title": title,
            "total": sum(by_level.values()), "levels": levels}


@app.get("/api/oxford-levels")
async def oxford_levels(source: str = "3000"):
    """So tu Oxford theo tung trinh do CEFR (da loc tu co nghia Viet).
    Dung cho trang chi tiet Oxford: hien thi A1/Beginner, A2/Elementary..."""
    return _oxford_levels_summary(source)

@app.get("/api/topic-words")
async def topic_words(group: str = "du-lich", count: int = 15):
    """Tu vung IELTS Speaking theo 6 nhom chu de hien thi (gop tu 18 topic goc)."""
    group = group.strip()
    count = max(1, min(count, 50))
    cfg = TOPIC_GROUPS.get(group)
    if not cfg:
        return {'error': 'Nhom khong hop le. Dung: ' + ', '.join(TOPIC_GROUPS)}
    items = ([w for w in IELTS_SPEAKING if w.get("topic") in cfg["topics"]] +
             [w for w in TOPIC_EXTRA if w.get("topic") in cfg["topics"]])
    if not items:
        return {"error": "Khong co tu nao cho nhom nay"}
    sampled = random.sample(items, min(len(items), count))
    words = []
    for w in sampled:
        _tp = _tatoeba_first(w.get("word", ""))
        meaning = (w.get("meaning") or "").strip()
        words.append({
            "word": w.get("word", ""),
            "ipa": (w.get("ipa") or "").strip("/"),
            "meanings": ([{"pos": "", "definitions": [meaning]}] if meaning else []),
            "has_vi": bool(meaning),
            "topic": w.get("topic", ""),
            "level": cfg["level"], "color": CEFR_COLORS.get(cfg["level"], "#6366f1"),
        })
    return {"group": group, "title": cfg["title"], "icon": cfg["icon"],
            "color": cfg["color"], "total": len(items),
            "count": len(words), "words": words}


@app.get("/api/random-vocab")
async def random_vocab():
    """1 tu ngau nhien co san vi du song ngu (cho the trang chu).
    Pool: TOEIC 3 band (A2/B1/B2) + Oxford C1."""
    all_toeic = TOEIC_BASIC + TOEIC_B1 + TOEIC_B2
    pool = [w for w in all_toeic if (w.get("example") or "").strip()
            and (w.get("example_vi") or "").strip()
            and (w.get("meaning") or "").strip()]
    pool = pool + _get_random_vocab_c1_pool()
    if not pool:
        return {"error": "Khong co tu nao co vi du song ngu"}
    w = random.choice(pool)
    wlv = (w.get("cefr") or "A2").strip()
    if wlv not in CEFR_COLORS: wlv = "A2"
    return {
        "word": w.get("word", ""),
        "pos": w.get("pos", ""),
        "ipa": (w.get("ipa") or "").strip("/"),
        "meaning": (w.get("meaning") or "").strip(),
        "example_en": (w.get("example") or "").strip(),
        "example_vi": (w.get("example_vi") or "").strip(),
        "level": wlv, "color": CEFR_COLORS.get(wlv, "#6366f1"),
    }


_RANDOM_VOCAB_C1_POOL = None

def _get_random_vocab_c1_pool():
    """Pool tu C1 (Oxford 3000/5000) cho /api/random-vocab.
    Nghia Viet: dictionary.db; vi du song ngu: Tatoeba.
    Chi giu tu co du nghia + vi du. Build 1 lan luc server khoi dong, cache lai."""
    global _RANDOM_VOCAB_C1_POOL
    if _RANDOM_VOCAB_C1_POOL is not None:
        return _RANDOM_VOCAB_C1_POOL
    pool = []
    try:
        vi_words = _words_with_vi_meaning() or set()
        n_c1 = n_vi = n_mean = n_ex = 0
        for w, score in OXFORD_LEVELS.items():
            if _score_to_cefr(score) != "C1":
                continue
            n_c1 += 1
            if w.lower() not in vi_words:
                continue
            n_vi += 1
            ipa, meanings = _lookup_word_details(w)
            if not meanings:
                continue
            n_mean += 1
            ex = _tatoeba_first(w)
            if not (ex.get("en") or "").strip():
                continue
            n_ex += 1
            first = meanings[0]
            defs = first.get("definitions") or []
            meaning = (defs[0] if defs else "").strip()
            if not meaning:
                continue
            pool.append({
                "word": w,
                "pos": first.get("pos", ""),
                "ipa": ipa or "",
                "meaning": meaning,
                "example": ex["en"].strip(),
                "example_vi": (ex.get("vi") or "").strip(),
                "cefr": "C1",
            })
        print(f"[DATA] random-vocab C1 debug: C1={n_c1} vi={n_vi} meaning={n_mean} tatoeba={n_ex} pool={len(pool)}", flush=True)
    except Exception as _e:
        print(f"[WARN] random-vocab C1 pool loi: {_e}", flush=True)
        pool = []
    _RANDOM_VOCAB_C1_POOL = pool
    return pool


# Pre-build pool C1 luc server khoi dong de request dau tien khong bi treo.
# (Dat o cuoi file de cac ham phu tro nhu _score_to_cefr da duoc dinh nghia.)


def _tatoeba_first(word: str) -> dict:
    """Cặp ví dụ Tatoeba đầu tiên của 1 từ — nhét sẵn vào deck flashcard để
    lật thẻ hiện ngay, không phải fetch từng thẻ (10/10/2026)."""
    w = (word or "").strip().lower()
    if not w:
        return {}
    for i in _TATOEBA_INDEX.get(w, []):
        p = TATOEBA_PAIRS[i]
        if (p.get("en") or "").strip():
            return {"en": p.get("en", ""), "vi": p.get("vi", "")}
    return {}


@app.get("/api/example-sentences")
async def example_sentences(word: str = "", count: int = 5):
    """Cặp câu song ngữ Anh–Việt chứa đúng từ word (khớp nguyên từ, không phân biệt
    hoa thường). Nguồn: Tatoeba (CC-BY 2.0 FR) — frontend ghi attribution."""
    w = word.strip().lower()
    if not w:
        return {"pairs": []}
    n = max(1, min(int(count or 5), 10))
    pairs = []
    seen_en = set()
    for i in _TATOEBA_INDEX.get(w, []):
        if len(pairs) >= n:
            break
        p = TATOEBA_PAIRS[i]
        en = (p.get("en") or "").strip().lower()
        if not en or en in seen_en:
            continue  # 10/10/2026: 1 câu EN nhiều bản dịch VI -> chỉ lấy 1
        seen_en.add(en)
        pairs.append({"en": p.get("en", ""), "vi": p.get("vi", "")})
    return {"pairs": pairs, "source": "Tatoeba (CC-BY 2.0 FR)"}


def _vi_gloss(word: str) -> str:
    """Nghĩa Việt đầu tiên của 1 từ từ dictionary.db (dùng cho chip đồng/trái nghĩa)."""
    _, meanings = _lookup_word_details(word)
    if meanings and meanings[0].get("definitions"):
        return meanings[0]["definitions"][0]
    return ""


@app.get("/api/word-relations")
async def word_relations(word: str = ""):
    """Đồng nghĩa / trái nghĩa từ WordNet (tiếng Anh), mỗi từ kèm nghĩa Việt tra từ
    dictionary.db. Tối đa 8 từ mỗi loại. Thiếu WordNet -> trả rỗng, không lỗi."""
    w = word.strip().lower()
    if not w:
        return {"synonyms": [], "antonyms": []}
    wn = _get_wordnet()
    if wn is None:
        return {"synonyms": [], "antonyms": [], "wordnet": False}
    syns: list[dict] = []
    ants: list[dict] = []
    seen_s, seen_a = {w}, {w}
    try:
        for syn in wn.synsets(w):
            for lemma in syn.lemmas():
                name = lemma.name().replace("_", " ").lower()
                if " " in name or name in seen_s:
                    continue
                seen_s.add(name)
                if len(syns) < 8:
                    syns.append({"word": name, "vi": _vi_gloss(name)})
                for ant in lemma.antonyms():
                    aname = ant.name().replace("_", " ").lower()
                    if " " in aname or aname in seen_a:
                        continue
                    seen_a.add(aname)
                    if len(ants) < 8:
                        ants.append({"word": aname, "vi": _vi_gloss(aname)})
            if len(syns) >= 8 and len(ants) >= 8:
                break
    except Exception as e:
        print(f"[WARN] word-relations({w}): {e}")
    return {"synonyms": syns, "antonyms": ants, "wordnet": True}


@app.get("/api/collocations")
async def collocations(word: str = "", count: int = 12):
    """Từ hay đi kèm (collocations) từ file gộp duy nhất collocations_full.json
    (build 09/10/2026). Thứ tự: curated (biên soạn tay) > attested (có ví dụ
    Tatoeba thật) > lexical. Mỗi collocate kèm nghĩa Việt; attested/curated kèm
    thêm ví dụ EN+VI. Nguồn: SyntagNet (CC BY-NC-SA 4.0) + biên soạn thủ công."""
    w = word.strip().lower()
    if not w:
        return {"collocations": [], "source": _COLLOC_SOURCE}
    n = max(1, min(int(count or 12), 30))
    items = _COLLOC_FULL.get(w) or _COLLOC_FULL.get(spacy_lemma(w)) or []
    out = []
    seen = {w}
    for e in items:
        c = e["col"]
        if c in seen or len(out) >= n:
            continue
        seen.add(c)
        out.append({"word": c, "vi": e.get("vi") or _vi_gloss(c),
                    "freq": e.get("freq"), "tier": e.get("tier"),
                    "curated": bool(e.get("curated")),
                    "en": e.get("en", ""), "vi_ex": e.get("vi_ex", "")})
    return {"collocations": out, "source": _COLLOC_SOURCE}


# ============================================================
# TÀI LIỆU CỦA TÔI (08/10/2026) — kiểu NotebookLM, section độc lập.
# - Upload .txt/.md/.pdf (text) qua POST /api/docs/upload (cần đăng nhập).
# - PDF parse bằng pypdf (pip install pypdf); PDF scan -> từ chối rõ ràng, KHÔNG OCR.
# - Chunk theo đoạn văn (~500 tokens), lưu JSON chunks trong data/users.db
#   (bảng user_docs, gắn theo tài khoản). Không động code cũ.
# - Hỏi đáp: /api/chat mở rộng thêm doc_id (tùy chọn) — top-3 chunk Jaccard
#   nhét vào system prompt; ngoài tài liệu -> bot báo không có dữ kiện.
# - Giới hạn 50.000 ký tự/file để tiết kiệm quota Groq.
# ============================================================
import io as _io
from fastapi import UploadFile as _UploadFile, File as _File

_DOCS_MAX_CHARS = 50000
_DOCS_CHUNK_TOKENS = 500
_DOCS_TOP_K = 3
_DOCS_TYPES = {".txt", ".md", ".pdf"}
_DOCS_MAX_UPLOAD = 10 * 1024 * 1024  # 10MB raw


def _init_docs_db():
    conn = _auth_conn()
    conn.execute("""
    CREATE TABLE IF NOT EXISTS user_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        chunks TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""")
    conn.commit()
    conn.close()


def _extract_doc_text(filename: str, data: bytes) -> str:
    """Trích text từ file upload. PDF scan -> từ chối rõ ràng (không OCR)."""
    ext = os.path.splitext(filename or "")[1].lower()
    if ext in (".txt", ".md"):
        return data.decode("utf-8", errors="replace")
    if ext == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            raise _HTTPException(
                status_code=400,
                detail="Chưa cài pypdf: chạy 'pip install pypdf' rồi restart server.")
        reader = PdfReader(_io.BytesIO(data))
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
        if len(text.strip()) < 100:
            raise _HTTPException(
                status_code=400,
                detail="File PDF này là dạng scan (ảnh), chưa hỗ trợ. "
                       "Hãy dùng PDF dạng text.")
        return text
    raise _HTTPException(status_code=400, detail="Chỉ nhận file .txt, .md, .pdf")


def _chunk_doc_text(text: str, max_tokens: int = _DOCS_CHUNK_TOKENS) -> list:
    """Cắt theo đoạn văn, mỗi chunk ~500 tokens (~2000 ký tự)."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, cur = [], ""
    for p in paras:
        if cur and len(cur) + len(p) + 2 > max_tokens * 4:
            chunks.append(cur)
            cur = p
        else:
            cur = (cur + "\n\n" + p) if cur else p
    if cur:
        chunks.append(cur)
    return chunks


_doc_tok_re = re.compile(r"[a-zA-Z]+(?:'[a-z]+)?")


def _doc_jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _top_doc_chunks(chunks: list, question: str,
                    k: int = _DOCS_TOP_K) -> list:
    """Top-k chunk liên quan nhất theo Jaccard similarity (giống COMMON_MEANINGS).
    Trả về [(index_gốc, chunk)] — index gốc để trích dẫn [đoạn N] ổn định."""
    qtoks = set(_doc_tok_re.findall(question.lower()))
    scored = []
    for i, c in enumerate(chunks):
        s = _doc_jaccard(qtoks, set(_doc_tok_re.findall(c.lower())))
        if s > 0:
            scored.append((s, i, c))
    scored.sort(reverse=True)
    return [(i, c) for _, i, c in scored[:k]]


def _get_doc_chunks(doc_id: int, user_id: int):
    """Chunk của tài liệu — None nếu không phải của user này."""
    conn = _auth_conn()
    row = conn.execute(
        "SELECT chunks FROM user_docs WHERE id = ? AND user_id = ?",
        (doc_id, user_id)).fetchone()
    conn.close()
    if not row:
        return None
    try:
        return json.loads(row[0])
    except Exception:
        return None


@app.post("/api/docs/upload")
async def docs_upload(request: Request, file: _UploadFile = _File(...)):
    user = _require_user(request)
    fname = (file.filename or "").strip()
    ext = os.path.splitext(fname)[1].lower()
    if ext not in _DOCS_TYPES:
        raise _HTTPException(status_code=400, detail="Chỉ nhận file .txt, .md, .pdf")
    data = await file.read()
    if len(data) > _DOCS_MAX_UPLOAD:
        raise _HTTPException(status_code=400, detail="File quá lớn (tối đa 10MB)")
    text = _extract_doc_text(fname, data)
    if len(text) > _DOCS_MAX_CHARS:
        raise _HTTPException(
            status_code=400,
            detail=f"File quá dài ({len(text):,} ký tự). "
                   f"Giới hạn {_DOCS_MAX_CHARS:,} ký tự/file.")
    if len(text.strip()) < 50:
        raise _HTTPException(status_code=400,
                             detail="File không có nội dung đọc được")
    chunks = _chunk_doc_text(text)
    conn = _auth_conn()
    cur = conn.execute(
        "INSERT INTO user_docs (user_id, filename, chunks, created_at) "
        "VALUES (?,?,?,?)",
        (user["id"], fname[:200], json.dumps(chunks, ensure_ascii=False),
         _dt.utcnow().isoformat()))
    doc_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"id": doc_id, "filename": fname, "chunks": len(chunks),
            "chars": len(text)}


@app.get("/api/docs")
async def docs_list(request: Request):
    user = _require_user(request)
    conn = _auth_conn()
    rows = conn.execute(
        "SELECT id, filename, chunks, created_at FROM user_docs "
        "WHERE user_id = ? ORDER BY id DESC", (user["id"],)).fetchall()
    conn.close()
    docs = []
    for r in rows:
        try:
            n = len(json.loads(r[2]))
        except Exception:
            n = 0
        docs.append({"id": r[0], "filename": r[1], "chunks": n,
                     "created_at": r[3]})
    return {"docs": docs}


@app.delete("/api/docs/{doc_id}")
async def docs_delete(request: Request, doc_id: int):
    user = _require_user(request)
    conn = _auth_conn()
    cur = conn.execute("DELETE FROM user_docs WHERE id = ? AND user_id = ?",
                       (doc_id, user["id"]))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise _HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    return {"ok": True}


# ============================================================
# ĐĂNG NHẬP (08/10/2026) — email + mật khẩu.
# - Mật khẩu băm bcrypt (cần: pip install bcrypt).
# - Phiên đăng nhập bằng token ngẫu nhiên, nhớ 30 ngày.
# - DB riêng data/users.db: users, sessions, user_words,
#   user_progress, password_resets. Không đụng dictionary.db.
# - Quên mật khẩu: gửi mail qua Gmail SMTP (cần SMTP_USER và
#   SMTP_APP_PASSWORD trong biến môi trường).
# ============================================================
import secrets as _secrets
import smtplib as _smtplib
from email.mime.text import MIMEText as _MIMEText
from datetime import datetime as _dt, timedelta as _td
from fastapi import HTTPException as _HTTPException

try:
    import bcrypt as _bcrypt
    _BCRYPT_OK = True
except ImportError:
    _BCRYPT_OK = False
    print("[WARN] Chưa có bcrypt — đăng nhập cần: pip install bcrypt")

_AUTH_DB = os.path.join(os.path.dirname(__file__), "data", "users.db")
_SESSION_DAYS = 30
_SMTP_USER = os.getenv("SMTP_USER", "").strip()
_SMTP_PASS = os.getenv("SMTP_APP_PASSWORD", "").strip()
_APP_URL = os.getenv("APP_URL", "http://localhost:8000").rstrip("/")


def _auth_conn():
    # 10/10/2026: tạo folder data/ trước khi mở DB (sqlite không tự tạo folder cha)
    os.makedirs(os.path.dirname(_AUTH_DB), exist_ok=True)
    conn = sqlite3.connect(_AUTH_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_auth_db():
    conn = _auth_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT DEFAULT '',
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_words (
        user_id INTEGER NOT NULL,
        lemma TEXT NOT NULL,
        word TEXT DEFAULT '',
        level TEXT DEFAULT '',
        color TEXT DEFAULT '',
        desc TEXT DEFAULT '',
        saved_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, lemma)
    );
    CREATE TABLE IF NOT EXISTS user_progress (
        user_id INTEGER NOT NULL,
        group_id TEXT NOT NULL,
        word TEXT NOT NULL,
        updated_at INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, group_id, word)
    );
    CREATE TABLE IF NOT EXISTS password_resets (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0
    );
    """)
    conn.commit()
    conn.close()


_init_auth_db()
# 10/10/2026: _init_docs_db() phải gọi SAU khi _auth_conn() đã được định nghĩa
# (trước đây gọi ở phía trên gây NameError khi import, server không khởi động được).
_init_docs_db()


def _hash_password(pw: str) -> str:
    return _bcrypt.hashpw(pw.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def _check_password(pw: str, h: str) -> bool:
    try:
        return _bcrypt.checkpw(pw.encode("utf-8"), h.encode("utf-8"))
    except Exception:
        return False


def _create_session(user_id: int) -> str:
    token = _secrets.token_urlsafe(32)
    now = _dt.utcnow()
    conn = _auth_conn()
    conn.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
                 (token, user_id, now.isoformat(), (now + _td(days=_SESSION_DAYS)).isoformat()))
    conn.commit()
    conn.close()
    return token


def _get_user_by_token(token: str):
    if not token:
        return None
    conn = _auth_conn()
    row = conn.execute(
        """SELECT u.id, u.email, u.name FROM sessions s
           JOIN users u ON s.user_id = u.id
           WHERE s.token = ? AND s.expires_at > ?""",
        (token, _dt.utcnow().isoformat())).fetchone()
    conn.close()
    return {"id": row[0], "email": row[1], "name": row[2]} if row else None


def _require_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    user = _get_user_by_token(token)
    if not user:
        raise _HTTPException(status_code=401, detail="Chưa đăng nhập")
    return user


def _valid_email(email: str) -> bool:
    email = email.strip()
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))


class RegisterRequest(BaseModel):
    email: str = ""
    password: str = ""
    name: str = ""


class LoginRequest(BaseModel):
    email: str = ""
    password: str = ""


class ForgotRequest(BaseModel):
    email: str = ""


class ResetPasswordRequest(BaseModel):
    token: str = ""
    new_password: str = ""


@app.post("/api/register")
async def register(req: RegisterRequest):
    if not _BCRYPT_OK:
        return {"error": "Server thiếu bcrypt — chạy: pip install bcrypt"}
    email = req.email.strip().lower()
    if not _valid_email(email):
        return {"error": "Email không hợp lệ"}
    if len(req.password) < 6:
        return {"error": "Mật khẩu tối thiểu 6 ký tự"}
    name = req.name.strip()[:50]
    conn = _auth_conn()
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        conn.close()
        return {"error": "Email này đã được đăng ký"}
    cur = conn.execute(
        "INSERT INTO users (email, password_hash, name, created_at) VALUES (?,?,?,?)",
        (email, _hash_password(req.password), name, _dt.utcnow().isoformat()))
    uid = cur.lastrowid
    conn.commit()
    conn.close()
    token = _create_session(uid)
    return {"ok": True, "token": token, "user": {"id": uid, "email": email, "name": name}}


@app.post("/api/login")
async def login(req: LoginRequest):
    if not _BCRYPT_OK:
        return {"error": "Server thiếu bcrypt — chạy: pip install bcrypt"}
    email = req.email.strip().lower()
    conn = _auth_conn()
    row = conn.execute("SELECT id, password_hash, name FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    if not row or not _check_password(req.password, row[1]):
        return {"error": "Email hoặc mật khẩu không đúng"}
    token = _create_session(row[0])
    return {"ok": True, "token": token, "user": {"id": row[0], "email": email, "name": row[2]}}


@app.post("/api/logout")
async def logout(request: Request):
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    if token:
        conn = _auth_conn()
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()
    return {"ok": True}


@app.get("/api/me")
async def me(request: Request):
    return {"user": _require_user(request)}


# ---- Từ đã lưu + tiến trình theo tài khoản ----

@app.get("/api/user/words")
async def user_words(request: Request):
    user = _require_user(request)
    conn = _auth_conn()
    rows = conn.execute(
        "SELECT word, lemma, level, color, desc, saved_at FROM user_words WHERE user_id = ?",
        (user["id"],)).fetchall()
    conn.close()
    return {"words": [
        {"word": r[0], "lemma": r[1], "level": r[2], "color": r[3], "desc": r[4], "savedAt": r[5]}
        for r in rows]}


@app.post("/api/user/words")
async def user_word_add(request: Request):
    """Thêm/cập nhật 1 từ đã lưu. Body: {word, lemma, level, color, desc}."""
    user = _require_user(request)
    d = await request.json()
    lemma = str(d.get("lemma", "")).strip().lower()
    if not lemma:
        return {"error": "Thiếu lemma"}
    conn = _auth_conn()
    conn.execute(
        """INSERT INTO user_words (user_id, lemma, word, level, color, desc, saved_at)
           VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id, lemma) DO UPDATE SET
           word=excluded.word, level=excluded.level, color=excluded.color, desc=excluded.desc""",
        (user["id"], lemma, str(d.get("word", "")), str(d.get("level", "")),
         str(d.get("color", "")), str(d.get("desc", "")), int(d.get("savedAt", 0) or 0)))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/user/words")
async def user_word_delete(request: Request, lemma: str = ""):
    user = _require_user(request)
    lemma = lemma.strip().lower()
    if lemma:
        conn = _auth_conn()
        conn.execute("DELETE FROM user_words WHERE user_id = ? AND lemma = ?", (user["id"], lemma))
        conn.commit()
        conn.close()
    return {"ok": True}


@app.post("/api/user/words/bulk")
async def user_words_bulk(request: Request):
    """Gộp danh sách từ localStorage lên server (dùng 1 lần khi đăng nhập)."""
    user = _require_user(request)
    d = await request.json()
    words = d.get("words") or []
    conn = _auth_conn()
    for w in words:
        lemma = str(w.get("lemma", "")).strip().lower()
        if not lemma:
            continue
        conn.execute(
            """INSERT INTO user_words (user_id, lemma, word, level, color, desc, saved_at)
               VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id, lemma) DO NOTHING""",
            (user["id"], lemma, str(w.get("word", "")), str(w.get("level", "")),
             str(w.get("color", "")), str(w.get("desc", "")), int(w.get("savedAt", 0) or 0)))
    conn.commit()
    conn.close()
    return {"ok": True, "count": len(words)}


@app.get("/api/user/progress")
async def user_progress(request: Request):
    """Tiến trình theo nhóm: {group_id: [words]}."""
    user = _require_user(request)
    conn = _auth_conn()
    rows = conn.execute(
        "SELECT group_id, word FROM user_progress WHERE user_id = ?", (user["id"],)).fetchall()
    conn.close()
    prog: dict[str, list[str]] = {}
    for g, w in rows:
        prog.setdefault(g, []).append(w)
    return {"progress": prog}


@app.post("/api/user/progress")
async def user_progress_add(request: Request):
    """Đánh dấu 1 từ đã thuộc trong nhóm. Body: {group, word}."""
    user = _require_user(request)
    d = await request.json()
    group = str(d.get("group", "")).strip()
    word = str(d.get("word", "")).strip()
    if not group or not word:
        return {"error": "Thiếu group/word"}
    import time as _time
    conn = _auth_conn()
    conn.execute(
        "INSERT INTO user_progress (user_id, group_id, word, updated_at) VALUES (?,?,?,?) "
        "ON CONFLICT(user_id, group_id, word) DO NOTHING",
        (user["id"], group, word, int(_time.time())))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/user/progress/bulk")
async def user_progress_bulk(request: Request):
    """Gộp topicProgress từ localStorage lên server (dùng 1 lần khi đăng nhập).
    Body: {progress: {group_id: {known: [words]} | [words]}}."""
    user = _require_user(request)
    d = await request.json()
    prog = d.get("progress") or {}
    import time as _time
    now = int(_time.time())
    conn = _auth_conn()
    n = 0
    for g, v in prog.items():
        words = v.get("known") if isinstance(v, dict) else v
        for w in (words or []):
            conn.execute(
                "INSERT INTO user_progress (user_id, group_id, word, updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT(user_id, group_id, word) DO NOTHING",
                (user["id"], str(g), str(w), now))
            n += 1
    conn.commit()
    conn.close()
    return {"ok": True, "count": n}


# ---- Quên mật khẩu qua Gmail SMTP ----

def _send_reset_email(to_email: str, link: str) -> bool:
    if not (_SMTP_USER and _SMTP_PASS):
        print("[WARN] Chưa cấu hình SMTP_USER / SMTP_APP_PASSWORD — không gửi được mail")
        return False
    try:
        msg = _MIMEText(
            "Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản English Chatbot.\n\n"
            f"Bấm vào link sau để đặt mật khẩu mới (hết hạn sau 1 giờ):\n{link}\n\n"
            "Nếu bạn không yêu cầu, hãy bỏ qua email này.")
        msg["Subject"] = "Đặt lại mật khẩu — English Chatbot"
        msg["From"] = _SMTP_USER
        msg["To"] = to_email
        with _smtplib.SMTP("smtp.gmail.com", 587) as s:
            s.starttls()
            s.login(_SMTP_USER, _SMTP_PASS)
            s.send_message(msg)
        return True
    except Exception as e:
        print(f"[WARN] Gửi mail thất bại: {e}")
        return False


@app.post("/api/forgot-password")
async def forgot_password(req: ForgotRequest):
    email = req.email.strip().lower()
    conn = _auth_conn()
    row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    # Luôn trả ok để không lộ email nào đã đăng ký
    if row:
        token = _secrets.token_urlsafe(32)
        exp = (_dt.utcnow() + _td(hours=1)).isoformat()
        conn.execute("INSERT INTO password_resets (token, user_id, expires_at, used) VALUES (?,?,?,0)",
                     (token, row[0], exp))
        conn.commit()
        _send_reset_email(email, f"{_APP_URL}/?reset={token}")
    conn.close()
    return {"ok": True}


@app.post("/api/reset-password")
async def reset_password(req: ResetPasswordRequest):
    if not _BCRYPT_OK:
        return {"error": "Server thiếu bcrypt"}
    if len(req.new_password) < 6:
        return {"error": "Mật khẩu tối thiểu 6 ký tự"}
    conn = _auth_conn()
    row = conn.execute(
        "SELECT user_id FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?",
        (req.token, _dt.utcnow().isoformat())).fetchone()
    if not row:
        conn.close()
        return {"error": "Link không hợp lệ hoặc đã hết hạn"}
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                 (_hash_password(req.new_password), row[0]))
    conn.execute("UPDATE password_resets SET used = 1 WHERE token = ?", (req.token,))
    # Đăng xuất mọi phiên cũ cho an toàn
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (row[0],))
    conn.commit()
    conn.close()
    return {"ok": True}


# ============================================================
# BÀI HỌC AI (05/10/2026) — học pattern standardize_lesson từ
# repo BaoHan1712/Chatbot_teach_English: AI sinh JSON bài học,
# backend chuẩn hóa + tự sinh bù phần thiếu, không bao giờ
# trả về bài lỗi. Chỉ tốn 1 Groq call khi user bấm sinh bài.
# ============================================================

class LessonRequest(BaseModel):
    topic: str = ""

LESSON_SYSTEM = (
    "You are an English teacher for Vietnamese learners. "
    "Generate a complete English lesson as JSON. "
    "Respond with ONLY valid JSON, no markdown, no explanation. "
    "Schema: {"
    '"topic": "lesson topic in Vietnamese", '
    '"vocabulary": [{"word": "", "pronunciation": "", "english_meaning": "", '
    '"vietnamese_meaning": "", "example": ""}], '
    '"example_sentences": [{"english": "", "translation": ""}], '
    '"conversation": [{"speaker": "A or B", "text": "", "translation": ""}], '
    '"exercises": ['
    '{"type": "fill_in_blank", "question": "sentence with _____", '
    '"options": ["a","b","c","d"], "answer": "correct word"}, '
    '{"type": "sentence_order", "scrambled": ["words","in","random","order"], '
    '"answer": "correct sentence"}, '
    '{"type": "make_sentence", "word": "", "example": "sample sentence"}'
    "]}. "
    "Rules: 8 vocabulary items (common words for the topic, IPA pronunciation, "
    "short English meaning, natural Vietnamese meaning, simple example sentence). "
    "Vietnamese meanings MUST be accurate and natural — translate phrases by meaning, "
    "not word-by-word (e.g. 'extra bed' = 'giường phụ', NOT 'bàn ngủ thêm'). "
    "4 example sentences with Vietnamese translations. "
    "6-turn dialogue (A/B alternating) about the topic with translations. "
    "3 fill_in_blank (4 options each, answer must be one of the options), "
    "3 sentence_order (5-8 words each), 3 make_sentence (use a vocabulary word). "
    "All Vietnamese must be natural, not word-by-word translation."
)


def _pick_str(d: dict, keys: list[str]) -> str:
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def standardize_lesson(ai_json: dict, topic: str) -> dict:
    """Chuẩn hóa JSON bài học AI trả về — chịu được key sai, kiểu sai,
    thiếu phần. Thiếu exercises thì tự sinh bù từ vocabulary."""
    if not isinstance(ai_json, dict):
        ai_json = {}
    lesson = {
        "topic": _pick_str(ai_json, ["topic"]) or topic,
        "vocabulary": [], "example_sentences": [],
        "conversation": [], "exercises": [],
    }

    # --- Vocabulary (tối đa 8) ---
    vocab = ai_json.get("vocabulary", [])
    if not isinstance(vocab, list):
        vocab = []
    for v in vocab[:8]:
        if isinstance(v, str):
            v = {"word": v}
        if not isinstance(v, dict):
            continue
        word = _pick_str(v, ["word"])
        if not word:
            continue
        vi_meaning = _pick_str(v, ["vietnamese_meaning", "vietnamese_definition", "translation", "meaning_vi"])
        # Ghi de bang nghia da bien soan (06/10/2026): du lieu TOEIC/IELTS/topic
        # dang tin cay hon AI (vd AI dich sai "extra bed" -> "ban ngu them").
        curated = COMMON_MEANINGS.get(word.lower().strip())
        if curated:
            vi_meaning = curated
        lesson["vocabulary"].append({
            "word": word,
            "pronunciation": _pick_str(v, ["pronunciation", "ipa", "phonetic"]),
            "english_meaning": _pick_str(v, ["english_meaning", "english_definition", "meaning", "definition"]),
            "vietnamese_meaning": vi_meaning,
            "example": _pick_str(v, ["example", "example_sentence", "sentence"]),
        })

    # --- Example sentences (tối đa 4) ---
    exs = ai_json.get("example_sentences", ai_json.get("examples", []))
    if not isinstance(exs, list):
        exs = []
    for e in exs[:4]:
        if isinstance(e, str):
            e = {"english": e}
        if not isinstance(e, dict):
            continue
        en = _pick_str(e, ["english", "sentence", "text"])
        if not en:
            continue
        lesson["example_sentences"].append({
            "english": en,
            "translation": _pick_str(e, ["translation", "vietnamese", "vietnamese_translation"]),
        })

    # --- Conversation (tối đa 8 lượt) ---
    conv = ai_json.get("conversation", ai_json.get("dialogue", []))
    if not isinstance(conv, list):
        conv = []
    for m in conv[:8]:
        if isinstance(m, str):
            # "A: ... B: ..." trong một string -> tách
            parts, cur_sp = [], "A"
            for seg in m.replace("A:", "\nA:").replace("B:", "\nB:").split("\n"):
                seg = seg.strip()
                if seg.startswith("A:"):
                    cur_sp, seg = "A", seg[2:].strip()
                elif seg.startswith("B:"):
                    cur_sp, seg = "B", seg[2:].strip()
                if seg:
                    parts.append((cur_sp, seg))
            for sp, tx in parts:
                lesson["conversation"].append({"speaker": sp, "text": tx, "translation": ""})
            continue
        if not isinstance(m, dict):
            continue
        tx = _pick_str(m, ["text", "dialogue", "sentence"])
        if not tx:
            continue
        sp = _pick_str(m, ["speaker"])
        lesson["conversation"].append({
            "speaker": sp if sp in ("A", "B") else ("A" if len(lesson["conversation"]) % 2 == 0 else "B"),
            "text": tx,
            "translation": _pick_str(m, ["translation", "vietnamese_translation", "vietnamese"]),
        })

    # --- Exercises ---
    raw_ex = ai_json.get("exercises", [])
    if not isinstance(raw_ex, list):
        raw_ex = []
    for ex in raw_ex:
        if not isinstance(ex, dict):
            continue
        t = _pick_str(ex, ["type", "exercise_type"])
        if t == "fill_in_blank":
            q = _pick_str(ex, ["question", "sentence"])
            opts = ex.get("options", ex.get("choices", []))
            if isinstance(opts, str):
                opts = [o.strip() for o in opts.split(",") if o.strip()]
            if not isinstance(opts, list):
                opts = []
            ans = _pick_str(ex, ["answer", "correct"])
            if ans and ans not in opts:
                opts.append(ans)
            if q and len(opts) >= 2 and ans:
                lesson["exercises"].append({
                    "type": "fill_in_blank", "question": q,
                    "options": opts[:4], "answer": ans})
        elif t == "sentence_order":
            scr = ex.get("scrambled", ex.get("words", []))
            if isinstance(scr, str):
                scr = scr.split()
            ans = _pick_str(ex, ["answer", "solution", "sentence"])
            if isinstance(scr, list) and len(scr) >= 3 and ans:
                lesson["exercises"].append({
                    "type": "sentence_order",
                    "scrambled": [str(w) for w in scr], "answer": ans})
        elif t == "make_sentence":
            w = _pick_str(ex, ["word", "words"])
            if w:
                lesson["exercises"].append({
                    "type": "make_sentence", "word": w,
                    "example": _pick_str(ex, ["example", "answer", "sample"])})

    # --- Tự sinh bù exercises từ vocabulary nếu thiếu ---
    by_type: dict[str, list] = {"fill_in_blank": [], "sentence_order": [], "make_sentence": []}
    for ex in lesson["exercises"]:
        by_type[ex["type"]].append(ex)
    vocab_words = [v["word"] for v in lesson["vocabulary"] if v["word"]]
    if len(by_type["fill_in_blank"]) < 3:
        for v in lesson["vocabulary"]:
            if len(by_type["fill_in_blank"]) >= 3 or not v["example"] or not v["word"]:
                continue
            wl = v["word"].lower()
            if wl not in v["example"].lower():
                continue
            q = v["example"].replace(v["word"], "_____").replace(
                v["word"].capitalize(), "_____")
            opts = [v["word"]] + [w for w in vocab_words if w != v["word"]][:3]
            by_type["fill_in_blank"].append({
                "type": "fill_in_blank", "question": q,
                "options": opts, "answer": v["word"]})
    if len(by_type["sentence_order"]) < 3:
        for v in lesson["vocabulary"]:
            if len(by_type["sentence_order"]) >= 3 or not v["example"]:
                continue
            words = v["example"].split()
            if len(words) < 4:
                continue
            by_type["sentence_order"].append({
                "type": "sentence_order",
                "scrambled": words, "answer": v["example"]})
    if len(by_type["make_sentence"]) < 3:
        for w in vocab_words:
            if len(by_type["make_sentence"]) >= 3:
                break
            if not any(e["word"] == w for e in by_type["make_sentence"]):
                by_type["make_sentence"].append({
                    "type": "make_sentence", "word": w, "example": ""})
    lesson["exercises"] = (by_type["fill_in_blank"][:3]
                           + by_type["sentence_order"][:3]
                           + by_type["make_sentence"][:3])
    return lesson


@app.post("/api/generate-lesson")
async def generate_lesson(req: LessonRequest):
    topic = (req.topic or "").strip()
    if not topic:
        return {"error": "Thiếu chủ đề bài học."}
    if len(topic) > 100:
        topic = topic[:100]
    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": LESSON_SYSTEM},
                {"role": "user", "content": f"Create an English lesson about: {topic}"},
            ],
            temperature=0.7,
            max_tokens=3000,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip()
        try:
            ai_json = json.loads(raw)
        except Exception:
            # Bóc JSON trong text nếu AI trả kèm chữ
            m = re.search(r"\{.*\}", raw, re.S)
            ai_json = json.loads(m.group(0)) if m else {}
        lesson = standardize_lesson(ai_json, topic)
        if not lesson["vocabulary"]:
            return {"error": "AI không sinh được bài học, thử chủ đề khác."}
        return {"lesson": lesson}
    except Exception as e:
        return {"error": f"Lỗi sinh bài học: {e}"}


class GradeRequest(BaseModel):
    word: str = ""
    sentence: str = ""


GRADE_SYSTEM = (
    "You are an English teacher for Vietnamese learners. "
    "Grade the student's sentence that must use the given word. "
    "Respond with ONLY valid JSON, no markdown: "
    '{"score": 0-10, "feedback_vi": "nhận xét ngắn bằng tiếng Việt", '
    '"corrected": "câu đã sửa (giữ nguyên nếu đúng)"}. '
    "Be encouraging but honest about errors."
)


@app.post("/api/grade-sentence")
async def grade_sentence(req: GradeRequest):
    word = (req.word or "").strip()
    sentence = (req.sentence or "").strip()
    if not word or not sentence:
        return {"error": "Thiếu từ hoặc câu."}
    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": GRADE_SYSTEM},
                {"role": "user", "content": f"Word: {word}\nSentence: {sentence}"},
            ],
            temperature=0.3,
            max_tokens=400,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip()
        try:
            data = json.loads(raw)
        except Exception:
            m = re.search(r"\{.*\}", raw, re.S)
            data = json.loads(m.group(0)) if m else {}
        score = data.get("score", 0)
        try:
            score = max(0, min(10, int(score)))
        except Exception:
            score = 0
        return {
            "score": score,
            "feedback_vi": str(data.get("feedback_vi", "")),
            "corrected": str(data.get("corrected", "")),
        }
    except Exception as e:
        return {"error": f"Lỗi chấm câu: {e}"}


# ============================================================
# NGỮ PHÁP (09/10/2026) — module bài học ngữ pháp:
# - data/grammar_topics.json: cây 40 chủ đề A1-B2.
# - POST /api/generate-grammar-lesson: AI (Groq) sinh bài theo schema
#   chuẩn — cấu trúc bài mẫu (quy tắc → ví dụ song ngữ → lỗi hay mắc
#   Sai/Đúng/Vì sao → tự kiểm → ghi nhớ nhanh) + mô hình Grammar-mastery
#   (MIT: quiz chẩn đoán gắn loại lỗi → luyện 3 cấp độ). Backend chuẩn
#   hóa defensive, KHÔNG tự bịa phần thiếu, cache file tĩnh
#   data/grammar_lessons/<id>.json để user duyệt trước khi dạy.
# - Luồng /api/generate-lesson (bài từ vựng) giữ nguyên 100%.
# ============================================================

_GRAMMAR_DIR = os.path.join(os.path.dirname(__file__), "data", "grammar_lessons")

GRAMMAR_SYSTEM = (
    "You are an English grammar teacher for Vietnamese learners at CEFR level {LEVEL}. "
    "Generate a complete grammar lesson as JSON about: {TOPIC_VI} ({TOPIC_EN}). "
    "Respond with ONLY valid JSON, no markdown, no explanation. "
    "Write ALL explanations in Vietnamese, clear and simple for {LEVEL} learners. "
    "Every English example MUST have a natural Vietnamese translation "
    "(translate by meaning, not word-by-word). "
    'Schema: {"topic": "tên chủ đề tiếng Việt", "level": "{LEVEL}", '
    '"intro": "2-4 câu tiếng Việt: khái niệm + nói khi nào dùng", '
    '"when_to_use": [{"case": "trường hợp dùng (tiếng Việt)", '
    '"examples": [{"en": "", "vi": ""}]}], '
    '"formula_table": {"headers": ["Dạng câu", "Nhóm 1", "Nhóm 2"], '
    '"rows": [["Khẳng định", "...", "..."]]}, '
    '"rules": [{"title": "Quy tắc 1 - ...", "explain": "giải thích tiếng Việt", '
    '"formula": "công thức (có thể rỗng)", "examples": [{"en": "", "vi": ""}]}], '
    '"context_examples": [{"en": "", "vi": "", "context": "ngữ cảnh dùng (tiếng Việt)"}], '
    '"signals": ["dấu hiệu nhận biết (tiếng Việt)"], '
    '"common_mistakes": [{"wrong": "câu sai", "correct": "câu đúng", '
    '"why": "vì sao, tiếng Việt, nêu quy tắc"}], '
    '"self_check": ["cách tự kiểm tra (tiếng Việt)"], '
    '"contrast": {"with": "điểm ngữ pháp dễ nhầm (tiếng Việt)", '
    '"table": {"headers": ["Dạng câu", "Chủ đề này", "Điểm kia"], "rows": [["Khẳng định", "...", "..."]]}}, '
    '"quick_ref": ["gạch đầu dòng tóm tắt (tiếng Việt)"], '
    '"diagnostic": [{"type": "mcq|fill|error", "error_type": "form|meaning|signal", '
    '"question": "câu hỏi hoặc câu sai cần sửa", "options": ["a","b","c"], '
    '"answer": "đáp án đúng", "explain_vi": "giải thích tiếng Việt"}], '
    '"practice_l1": [{"question": "câu có _____", "bank": ["gợi ý"], '
    '"answer": "", "hint_vi": ""}], '
    '"practice_l2": [{"question": "câu có _____", "answer": "", "hint_vi": ""}], '
    '"practice_l3": [{"task": "viết lại câu / đặt câu (tiếng Việt)", '
    '"answer": "", "why_vi": "vì sao đáp án này"}]}. '
    "Content rules: 4-7 rules; 4-6 when_to_use cases; 4-6 common_mistakes "
    "(real mistakes Vietnamese learners make, 'why' cites the rule); "
    "8-12 diagnostic questions mixing mcq/fill/error with error_type; "
    "4-6 practice_l1 (gap-fill WITH word bank), 4-6 practice_l2 (gap-fill, no bank), "
    "3-4 practice_l3 (rewrite/make sentence with why_vi). "
    "All example sentences short, natural, level-appropriate. Do NOT invent grammar rules."
)


class GrammarLessonRequest(BaseModel):
    topic_id: str = ""
    refresh: bool = False


def _grammar_topic(topic_id: str):
    d = _load_json("grammar_topics.json") or {}
    for t in d.get("topics", []) or []:
        if isinstance(t, dict) and t.get("id") == topic_id:
            return t
    return None


def _pick_ex(e: dict) -> dict | None:
    if not isinstance(e, dict):
        return None
    en = _pick_str(e, ["en", "english", "sentence", "text"])
    if not en:
        return None
    return {"en": en, "vi": _pick_str(e, ["vi", "vietnamese", "translation"])}


def standardize_grammar_lesson(ai_json: dict, meta: dict) -> dict:
    """Chuẩn hóa bài ngữ pháp AI sinh — defensive, KHÔNG tự bịa phần thiếu
    (thiếu phần nào frontend ẩn phần đó, tránh bịa quy tắc ngữ pháp)."""
    if not isinstance(ai_json, dict):
        ai_json = {}
    L = {
        "id": meta.get("id", ""), "topic": _pick_str(ai_json, ["topic"]) or meta.get("title", ""),
        "level": meta.get("level", ""), "intro": _pick_str(ai_json, ["intro"]),
        "when_to_use": [], "formula_table": {}, "rules": [], "context_examples": [],
        "signals": [], "common_mistakes": [], "self_check": [], "contrast": {},
        "quick_ref": [], "diagnostic": [], "practice_l1": [], "practice_l2": [],
        "practice_l3": [],
    }
    # --- when_to_use ---
    for c in (ai_json.get("when_to_use") or [])[:6]:
        if not isinstance(c, dict):
            continue
        exs = [_pick_ex(e) for e in (c.get("examples") or [])[:4]]
        case = _pick_str(c, ["case", "title"])
        if case:
            L["when_to_use"].append({"case": case, "examples": [e for e in exs if e]})
    # --- formula_table / contrast.table ---
    def _table(t):
        if not isinstance(t, dict):
            return {}
        h = [str(x) for x in (t.get("headers") or [])[:4]]
        rows = [[str(x) for x in (r or [])[:4]] for r in (t.get("rows") or [])[:6]]
        return {"headers": h, "rows": rows} if h and rows else {}
    L["formula_table"] = _table(ai_json.get("formula_table"))
    ct = ai_json.get("contrast") if isinstance(ai_json.get("contrast"), dict) else {}
    if _pick_str(ct, ["with"]):
        L["contrast"] = {"with": _pick_str(ct, ["with"]), "table": _table(ct.get("table"))}
    # --- rules ---
    for r in (ai_json.get("rules") or [])[:8]:
        if not isinstance(r, dict):
            continue
        title = _pick_str(r, ["title"])
        if not title:
            continue
        exs = [_pick_ex(e) for e in (r.get("examples") or [])[:4]]
        L["rules"].append({"title": title,
                           "explain": _pick_str(r, ["explain", "explanation"]),
                           "formula": _pick_str(r, ["formula"]),
                           "examples": [e for e in exs if e]})
    # --- context_examples ---
    for e in (ai_json.get("context_examples") or [])[:4]:
        p = _pick_ex(e)
        if p:
            p["context"] = _pick_str(e, ["context"]) if isinstance(e, dict) else ""
            L["context_examples"].append(p)
    # --- signals / self_check / quick_ref ---
    for key in ("signals", "self_check", "quick_ref"):
        vals = ai_json.get(key) or []
        L[key] = [str(x).strip() for x in vals[:8] if str(x).strip()]
    # --- common_mistakes ---
    for m in (ai_json.get("common_mistakes") or [])[:8]:
        if not isinstance(m, dict):
            continue
        w, c = _pick_str(m, ["wrong"]), _pick_str(m, ["correct"])
        if w and c:
            L["common_mistakes"].append(
                {"wrong": w, "correct": c, "why": _pick_str(m, ["why", "reason"])})
    # --- diagnostic ---
    for q in (ai_json.get("diagnostic") or [])[:12]:
        if not isinstance(q, dict):
            continue
        t = _pick_str(q, ["type"])
        if t not in ("mcq", "fill", "error"):
            continue
        ans = _pick_str(q, ["answer", "correct"])
        qq = _pick_str(q, ["question", "prompt"])
        if not qq or not ans:
            continue
        et = _pick_str(q, ["error_type"])
        item = {"type": t, "error_type": et if et in ("form", "meaning", "signal") else "meaning",
                "question": qq, "answer": ans,
                "explain_vi": _pick_str(q, ["explain_vi", "explanation"])}
        if t == "mcq":
            opts = q.get("options") or []
            if isinstance(opts, str):
                opts = [o.strip() for o in opts.split(",") if o.strip()]
            opts = [str(o) for o in opts if str(o).strip()][:4]
            if ans not in opts:
                opts.append(ans)
            if len(opts) < 2:
                continue
            item["options"] = opts
        L["diagnostic"].append(item)
    # --- practice ---
    for p in (ai_json.get("practice_l1") or [])[:6]:
        if not isinstance(p, dict):
            continue
        q, a = _pick_str(p, ["question"]), _pick_str(p, ["answer"])
        bank = [str(x) for x in (p.get("bank") or []) if str(x).strip()][:5]
        if q and a and len(bank) >= 2:
            L["practice_l1"].append({"question": q, "bank": bank, "answer": a,
                                    "hint_vi": _pick_str(p, ["hint_vi", "hint"])})
    for p in (ai_json.get("practice_l2") or [])[:6]:
        if not isinstance(p, dict):
            continue
        q, a = _pick_str(p, ["question"]), _pick_str(p, ["answer"])
        if q and a:
            L["practice_l2"].append({"question": q, "answer": a,
                                    "hint_vi": _pick_str(p, ["hint_vi", "hint"])})
    for p in (ai_json.get("practice_l3") or [])[:4]:
        if not isinstance(p, dict):
            continue
        t, a = _pick_str(p, ["task"]), _pick_str(p, ["answer"])
        if t and a:
            L["practice_l3"].append({"task": t, "answer": a,
                                    "why_vi": _pick_str(p, ["why_vi", "why"])})
    return L


@app.get("/api/grammar-topics")
async def grammar_topics():
    d = _load_json("grammar_topics.json") or {}
    return {"topics": d.get("topics", []) or []}


@app.post("/api/generate-grammar-lesson")
async def generate_grammar_lesson(req: GrammarLessonRequest):
    tid = (req.topic_id or "").strip()
    if not re.fullmatch(r"[a-z0-9-]+", tid):
        return {"error": "ID chủ đề không hợp lệ."}
    meta = _grammar_topic(tid)
    if not meta:
        return {"error": "Không tìm thấy chủ đề ngữ pháp."}
    os.makedirs(_GRAMMAR_DIR, exist_ok=True)
    cpath = os.path.join(_GRAMMAR_DIR, tid + ".json")
    if os.path.exists(cpath) and not req.refresh:
        try:
            with open(cpath, encoding="utf-8") as f:
                return {"lesson": json.load(f), "cached": True}
        except Exception:
            pass
    prompt = (GRAMMAR_SYSTEM.replace("{LEVEL}", str(meta.get("level", "")))
              .replace("{TOPIC_VI}", str(meta.get("title", "")))
              .replace("{TOPIC_EN}", str(meta.get("en", ""))))
    # 10/10/2026: Groq JSON mode thỉnh thoảng trả 400 json_validate_failed
    # (lỗi thoáng qua, thử lại thường được) -> tự thử lại tối đa 3 lần;
    # tăng max_tokens 6000->8000 để bài dài không bị cắt cụt gây JSON hỏng.
    lesson = None
    for attempt in range(3):
        try:
            # 11/10/2026: gọi Groq (client đồng bộ) trong thread riêng để không
            # chặn event loop — nếu không, trong lúc chờ AI mọi request khác
            # (kể cả GET /api/grammar-topics) đều phải xếp hàng chờ.
            resp = await anyio.to_thread.run_sync(
                lambda: client.chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": f"Generate the grammar lesson JSON for: {meta.get('title', '')}"},
                    ],
                    temperature=0.7,
                    max_tokens=8000,
                    response_format={"type": "json_object"},
                )
            )
            raw = (resp.choices[0].message.content or "").strip()
            try:
                ai_json = json.loads(raw)
            except Exception:
                m = re.search(r"\{.*\}", raw, re.S)
                ai_json = json.loads(m.group(0)) if m else {}
            cand = standardize_grammar_lesson(ai_json, meta)
            if cand["rules"]:
                lesson = cand
                break
            print(f"[WARN] grammar({tid}) lần {attempt + 1}: AI trả bài rỗng")
        except Exception as e:
            msg = str(e)
            print(f"[WARN] grammar({tid}) lần {attempt + 1}: {msg}")
            # 11/10/2026: dính trần Groq (429/rate limit) thì CHỜ 45s rồi mới thử
            # lại — retry ngay lập tức cũng dính 429 tiếp, vô ích.
            # Dùng anyio.sleep để không chặn event loop trong lúc chờ.
            if "429" in msg or "rate limit" in msg.lower():
                await anyio.sleep(45)
    if not lesson:
        return {"error": "AI đang bận, chưa soạn được bài. Bạn bấm Thử lại giúp mình nhé.",
                "retryable": True}
    lesson["reviewed"] = False
    with open(cpath, "w", encoding="utf-8") as f:
        json.dump(lesson, f, ensure_ascii=False)
    return {"lesson": lesson, "cached": False}


def _match_ielts_topic(text: str) -> str | None:
    """Tìm tên chủ đề IELTS xuất hiện trong câu hỏi của user (vd 'môi trường')."""
    t = (text or "").lower()
    for w in IELTS_SPEAKING:
        topic = (w.get("topic") or "").strip()
        if topic and topic.lower() in t:
            return topic
    return None


def _ielts_topic_context(topic: str, n: int = 8) -> str:
    """Lấy n từ vựng mẫu của chủ đề để bơm vào system prompt của chat."""
    vocab = [w for w in IELTS_SPEAKING if w.get("topic") == topic][:n]
    lines = [f"- {w.get('word','')} {w.get('ipa','')}: {w.get('meaning','')}"
             for w in vocab]
    return ("\n\n[BỘ TỪ VỰNG GỢI Ý — chủ đề '%s', chỉ dùng khi phù hợp, "
            "đừng liệt kê ồ ạt]\n%s" % (topic, "\n".join(lines)))


@app.post("/api/cefr-full")
async def analyze_cefr_full(req: FullCEFRRequest):
    text = req.text.strip()
    if not text:
        return {"error": "Vui lòng nhập đoạn văn."}

    doc = nlp(text)

    # ── 1. Từ vựng: mức trần có bằng chứng (KHÔNG dùng trung bình cộng) ──
    # Trung bình cộng bị từ dễ kéo xuống (câu C2 → B1). Mức trần đo đúng hơn,
    # và nhất quán với tab Phân tích từ vựng.
    word_scores = []
    for token in doc:
        if token.is_punct or token.pos_ in SKIP_POS or token.ent_type_:
            continue
        s = _get_word_score(token.lemma_, token.pos_)
        if s is not None:
            word_scores.append(s)

    if len(word_scores) < MIN_SCORED_WORDS:
        return {"error": "Văn bản quá ngắn hoặc có quá ít từ nhận diện được để đánh giá từ vựng."}
    vocab_level, vocab_score = _ceiling_level(word_scores)

    # ── 2. Ngữ pháp: spaCy dependency parsing ──
    # Triết lý: max qua các câu — 1 cấu trúc khó xuất hiện đã là bằng chứng năng lực.
    # (Không dùng trung bình: sẽ pha loãng bằng chứng.)
    grammar_score    = 2
    grammar_features: list[str] = []

    for sent in doc.sents:
        s_score, s_feats = _score_sentence_grammar(sent)
        grammar_score = max(grammar_score, s_score)
        grammar_features.extend(s_feats)

    grammar_level = _score_to_cefr(grammar_score)

    # ── 3. Độ phức tạp câu: textstat ──
    fk_grade         = textstat.flesch_kincaid_grade(text)
    flesch           = textstat.flesch_reading_ease(text)
    avg_sent_length  = textstat.avg_sentence_length(text)
    avg_syllables    = textstat.avg_syllables_per_word(text)

    if   fk_grade <= 2:  readability_score = 1
    elif fk_grade <= 4:  readability_score = 2
    elif fk_grade <= 6:  readability_score = 3
    elif fk_grade <= 9:  readability_score = 4
    elif fk_grade <= 11: readability_score = 5
    else:                readability_score = 6

    readability_level = _score_to_cefr(readability_score)

    # ── 4. Tổng hợp có trọng số ──
    # Ngữ pháp 40% | Từ vựng 35% | Độ phức tạp 25%
    # (trọng số hiệu chỉnh thủ công — xem báo cáo đồ án)
    final_score = grammar_score * W_GRAMMAR + vocab_score * W_VOCAB + readability_score * W_READABILITY
    final_score = max(1.0, min(6.0, final_score))
    final_level = _score_to_cefr(final_score)

    return {
        "final_level": final_level,
        "final_color": CEFR_COLORS[final_level],
        "final_desc":  CEFR_DESC[final_level],
        "final_score": round(final_score, 2),
        "components": {
            "grammar": {
                "level":    grammar_level,
                "score":    grammar_score,
                "color":    CEFR_COLORS[grammar_level],
                "features": list(set(grammar_features)) or ["Cấu trúc cơ bản (A2)"],
            },
            "vocabulary": {
                "level": vocab_level,
                "score": round(vocab_score, 2),
                "color": CEFR_COLORS[vocab_level],
            },
            "readability": {
                "level":              readability_level,
                "score":              readability_score,
                "color":              CEFR_COLORS[readability_level],
                "grade":              round(fk_grade, 1),
                "flesch":             round(flesch, 1),
                "avg_sentence_length": round(avg_sent_length, 1),
                "avg_syllables":      round(avg_syllables, 2),
            },
        },
    }


# ============================================================
# HELPERS
# ============================================================

def _get_word_score(lemma: str, pos: str) -> float | None:
    """
    Nguồn điểm từ vựng DUY NHẤT (thang 1.0–6.0) — mọi endpoint cùng gọi.
    Thứ tự ưu tiên:
      1. CEFR-J / Octanove (lemma, pos) — curated, trích dẫn được
      2. CEFR-J trung bình theo lemma (bỏ qua POS)
      3. Oxford 3000/5000 (headword → level chuẩn OUP, lấp 640 từ thiếu)
      4. Zenodo (lemma, POS) — điểm liên tục do giáo viên đánh giá
      5. Zenodo trung bình theo lemma (bỏ qua POS, đã precompute)
      6. cefrpy (fallback)
      7. Từ ghép có gạch nối → tách ra, lấy max thành phần (vd "socio-economic")
    """
    lemma = lemma.lower()
    pos = pos or ""

    # 1. CEFR-J / Octanove
    cpos = _cefrj_pos(pos, lemma)
    if cpos:
        score = CEFRJ.get((lemma, cpos))
        if score is not None:
            return score

    # 2. CEFR-J trung bình theo lemma (bỏ qua POS)
    score = CEFRJ_LEMMA.get(lemma)
    if score is not None:
        return score

    # 3. Oxford 3000/5000 — level chuẩn OUP theo headword (05/10/2026).
    # Lấp 640 từ CEFR-J/Octanove thiếu (vd born, cannot, internet ở A1;
    # 449 từ C1 như accelerate, accountable). Đặt sau CEFR-J (có POS
    # chính xác hơn) nhưng trước Zenodo (điểm trung bình giáo viên).
    score = OXFORD_LEVELS.get(lemma)
    if score is not None:
        return score

    # 4. Zenodo theo (lemma, POS)
    score = ZENODO.get((lemma, pos.upper()))
    if score is not None:
        return score

    # 5. Zenodo trung bình theo lemma
    score = ZENODO_LEMMA_AVG.get(lemma)
    if score is not None:
        return score

    # 6. Fallback cefrpy
    lv = get_word_level(lemma)
    if lv and lv in CEFR_NUMERIC:
        return float(CEFR_NUMERIC[lv])

    # 7. Từ ghép có gạch nối
    if "-" in lemma:
        parts = [_get_word_score(p, pos) for p in lemma.split("-") if p]
        parts = [s for s in parts if s is not None]
        if parts:
            return max(parts)

    return None


def _score_to_cefr(score: float) -> str:
    if score <= 1.5: return "A1"
    if score <= 2.5: return "A2"
    if score <= 3.5: return "B1"
    if score <= 4.5: return "B2"
    if score <= 5.5: return "C1"
    return "C2"


def get_unified_level(lemma: str, pos: str = "") -> str | None:
    """Nguồn DUY NHẤT cho CEFR level rời rạc của một từ — mọi endpoint cùng gọi."""
    score = _get_word_score(lemma or "", pos or "")
    return _score_to_cefr(score) if score is not None else None


def _ceiling_level(scores: list[float]) -> tuple[str, float]:
    """
    Mức "trần" từ vựng: level cao nhất có ít nhất MIN_HARD_WORDS từ đạt được.
    - Khắc phục trung bình cộng: không bị từ dễ kéo xuống (câu C2 → B1)
    - Khắc phục top-20% suy biến: với văn bản ngắn top_n=1 nên 1 từ lạ quyết định (câu B1 → C2)
    Trả về (level, điểm đại diện = trung bình các từ đạt level đó).
    """
    if not scores:
        return "A1", 1.0
    need = max(1, min(MIN_HARD_WORDS, len(scores)))
    # ngưỡng trên của từng band theo _score_to_cefr
    for level, lo in (("C2", 5.5), ("C1", 4.5), ("B2", 3.5), ("B1", 2.5), ("A2", 1.5)):
        supporting = [s for s in scores if s > lo]
        if len(supporting) >= need:
            return level, sum(supporting) / len(supporting)
    return "A1", 1.0


@lru_cache(maxsize=5000)
def get_word_level(word: str):
    try:
        level = analyzer.get_average_word_level_CEFR(word.lower())
        if level is None:
            return None
        level = str(level).strip().upper()
        return level if level in CEFR_LEVELS else None
    except Exception:
        return None


def _score_sentence_grammar(sent) -> tuple[int, list[str]]:
    """
    Chấm điểm ngữ pháp cho MỘT câu: khởi điểm A2, lấy max theo cấu trúc khó nhất.
    (Một cấu trúc khó xuất hiện đã là bằng chứng năng lực → dùng max, không average.)
    Nhãn level tham chiếu English Grammar Profile, Cambridge (dùng phi thương mại).
    """
    score = 2
    features: list[str] = []

    deps   = [t.dep_   for t in sent]
    tags   = [t.tag_   for t in sent]
    lemmas = [t.lemma_ for t in sent]

    # Mệnh đề phụ → B1+
    if "advcl" in deps or "relcl" in deps:
        score = max(score, 3)
        features.append("Mệnh đề phụ (B1+)")

    # Thì hoàn thành → B1+
    if "VBN" in tags and ("have" in lemmas or "has" in lemmas):
        score = max(score, 3)
        features.append("Thì hoàn thành (B1+)")

    # Bị động → B2+
    if "nsubjpass" in deps or "auxpass" in deps:
        score = max(score, 4)
        features.append("Câu bị động (B2+)")

    # Nhiều mệnh đề phụ → B2+
    if deps.count("advcl") + deps.count("relcl") >= 2:
        score = max(score, 4)
        features.append("Nhiều mệnh đề phụ (B2+)")

    # Câu điều kiện → B2+
    if any(t.lemma_ == "if" for t in sent) and "advcl" in deps:
        score = max(score, 4)
        features.append("Câu điều kiện (B2+)")

    # Cấu trúc nhượng bộ → B2+
    if any(t.lower_ in ("despite", "although", "whereas", "nevertheless",
                         "nonetheless", "even though") for t in sent):
        score = max(score, 4)
        features.append("Cấu trúc nhượng bộ (B2+)")

    # Danh hóa phức tạp → C1+
    if deps.count("prep") >= 3:
        score = max(score, 5)
        features.append("Cấu trúc danh hóa phức tạp (C1+)")

    # Đảo ngữ điều kiện → C1 (EGP: inversion = advanced)
    # vd "Had the committee not been..." (= If the committee had not been...)
    #    "Should you need..." / "Were she to open..."
    # Loại câu hỏi (tận cùng "?") để tránh nhầm câu hỏi đảo ngữ.
    if len(sent) > 2:
        t0, t1 = sent[0], sent[1]
        if (t0.pos_ == "AUX" and sent[-1].text != "?"
                and t1.pos_ in ("NOUN", "PROPN", "PRON", "DET")
                and (t0.lemma_ == "should"
                     or (t0.lemma_ in ("have", "be") and "VBN" in tags))):
            score = max(score, 5)
            features.append("Đảo ngữ điều kiện (C1)")

    # Cụm rút gọn nhượng bộ "far from + V-ing" → B2+
    # vd "far from mitigating socio-economic disparities"
    for i, t in enumerate(sent):
        if (t.lower_ == "from" and i >= 1 and sent[i - 1].lower_ == "far"
                and i + 1 < len(sent) and sent[i + 1].tag_ == "VBG"):
            score = max(score, 4)
            features.append('Cụm rút gọn "far from + V-ing" (B2+)')
            break

    return score, features


def build_highlighted(text: str, word_levels: dict, lemma_map: dict | None = None) -> str:
    import html
    if lemma_map is None:
        doc = nlp(text)
        lemma_map = {t.text.lower(): t.lemma_.lower() for t in doc if not t.is_punct}

    parts, cursor = [], 0
    for match in WORD_PATTERN.finditer(text):
        parts.append(html.escape(text[cursor:match.start()]))
        original = match.group(0)
        level    = word_levels.get(original.lower())
        lemma    = lemma_map.get(original.lower(), original.lower())
        if level in CEFR_COLORS:
            color = CEFR_COLORS[level]
            parts.append(
                f'<span class="word-chip" style="--c:{color}" '
                f'data-word="{html.escape(original)}" '
                f'data-lemma="{html.escape(lemma)}">'
                f'{html.escape(original)}<sup>{level}</sup></span>'
            )
        else:
            parts.append(html.escape(original))
        cursor = match.end()
    parts.append(html.escape(text[cursor:]))
    return "".join(parts)
# Pre-build pool C1 cho /api/random-vocab luc server khoi dong
# (de o cuoi file de _score_to_cefr va cac ham khac da duoc dinh nghia).
try:
    _c1pool = _get_random_vocab_c1_pool()
    print(f"[DATA] random-vocab C1 pool: {len(_c1pool)} tu", flush=True)
except Exception as _e:
    print(f"[WARN] random-vocab C1 pool build that bai: {_e}", flush=True)
