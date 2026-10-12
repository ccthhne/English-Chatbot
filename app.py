import html
import os
import re
from collections import Counter
from functools import lru_cache
from typing import Any

import gradio as gr
from cefrpy import CEFRAnalyzer
from groq import Groq


# ============================================================
# CONFIG
# ============================================================

MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise RuntimeError(
        "Chưa tìm thấy GROQ_API_KEY. "
        "Hãy đặt biến môi trường GROQ_API_KEY trước khi chạy app."
    )

client = Groq(api_key=GROQ_API_KEY)
analyzer = CEFRAnalyzer()

SYSTEM_PROMPT = """
Bạn là English Tutor dành cho người Việt Nam.

Quy tắc:
1. Luôn trả lời bằng tiếng Việt.
2. Giải thích rõ ràng, chính xác và dễ hiểu.
3. Khi đưa ví dụ tiếng Anh, kèm giải thích bằng tiếng Việt.
4. Với câu hỏi sửa lỗi ngữ pháp, nói ĐÚNG hoặc SAI trước rồi giải thích.
5. Với câu hỏi so sánh từ vựng, chỉ ra sự khác nhau trực tiếp.
6. Khi được yêu cầu tạo bài tập, không đưa đáp án ngay.
7. Khi giải thích một từ vựng tiếng Anh, nếu có thể hãy nêu CEFR level.
8. Ưu tiên ví dụ thực tế, ngắn và phù hợp với người học tiếng Anh.
9. Không trả lời lan man nếu câu hỏi đơn giản.
"""

CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")

CEFR_COLORS = {
    "A1": "#22c55e",
    "A2": "#84cc16",
    "B1": "#eab308",
    "B2": "#f97316",
    "C1": "#ef4444",
    "C2": "#a855f7",
}

CEFR_DESC = {
    "A1": "Beginner",
    "A2": "Elementary",
    "B1": "Intermediate",
    "B2": "Upper-Intermediate",
    "C1": "Advanced",
    "C2": "Proficient",
}

WORD_PATTERN = re.compile(r"\b[A-Za-z]+(?:[''\-][A-Za-z]+)*\b")

EXAMPLE_PROMPTS = [
    "Từ 'accurate' nghĩa là gì và CEFR level bao nhiêu?",
    "Khác nhau giữa 'believe' và 'trust'?",
    "Sửa câu: I have went to school yesterday.",
    "Dịch: Tôi đã học tiếng Anh được 3 năm.",
]


# ============================================================
# CHAT
# ============================================================

def build_llm_messages(history: list[dict[str, Any]], message: str) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in history:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})
    return messages


def stream_chat(
    message: str,
    history: list[dict[str, Any]],
    sessions: list[list[dict[str, Any]]],
    current_session_index: int | None,
):
    if not message or not message.strip():
        yield history, sessions, current_session_index
        return

    history = list(history or [])
    working_history = history + [
        {"role": "user", "content": message},
        {"role": "assistant", "content": ""},
    ]
    yield working_history, sessions, current_session_index

    try:
        stream = client.chat.completions.create(
            model=MODEL,
            messages=build_llm_messages(history, message),
            max_tokens=8192,
            temperature=0.7,
            stream=True,
        )
        answer = ""
        for chunk in stream:
            delta = getattr(chunk.choices[0].delta, "content", None)
            if delta:
                answer += delta
                working_history[-1]["content"] = answer
                yield working_history, sessions, current_session_index

        if not answer.strip():
            answer = "Xin lỗi, tôi chưa nhận được nội dung trả lời từ model."
            working_history[-1]["content"] = answer

    except Exception as exc:
        working_history[-1]["content"] = (
            "Không thể kết nối tới model.\n\n"
            f"`{type(exc).__name__}: {exc}`"
        )

    saved_history = [dict(item) for item in working_history]

    if current_session_index is None:
        sessions = list(sessions or [])
        sessions.append(saved_history)
        current_session_index = len(sessions) - 1
    else:
        sessions = list(sessions or [])
        if 0 <= current_session_index < len(sessions):
            sessions[current_session_index] = saved_history
        else:
            sessions.append(saved_history)
            current_session_index = len(sessions) - 1

    yield saved_history, sessions, current_session_index


def new_chat(
    history: list[dict[str, Any]],
    sessions: list[list[dict[str, Any]]],
):
    return [], sessions or [], None, build_history_html(sessions or [], None)


def _extract_text(content: Any) -> str:
    """Safely extract plain text from a message content field.

    Gradio 6 may store content as a string OR as a list of
    dicts like [{"type": "text", "text": "..."}].
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                parts.append(str(block.get("text", block.get("content", ""))))
            else:
                parts.append(str(block))
        return " ".join(parts)
    return str(content)


def session_title(history: list[dict[str, Any]]) -> str:
    for item in history or []:
        if item.get("role") == "user":
            text = _extract_text(item.get("content", "")).strip().replace("\n", " ")
            if text:
                return text[:48] + ("…" if len(text) > 48 else "")
    return "Cuộc trò chuyện mới"


def build_history_html(sessions: list[list[dict[str, Any]]], current_index: int | None) -> str:
    if not sessions:
        return '<div class="hist-empty">Chưa có cuộc trò chuyện nào.</div>'
    items = []
    for index in range(len(sessions) - 1, -1, -1):
        title = session_title(sessions[index])
        active_class = " hist-active" if index == current_index else ""
        items.append(
            f'<div class="hist-item{active_class}" '
            f'onclick="selectSession({index})" '
            f'data-index="{index}">'
            f'<i class="ri-chat-3-line"></i>'
            f'<span>{html.escape(title)}</span>'
            f'</div>'
        )
    return "".join(items)


def save_session_ui(sessions, current_index):
    return build_history_html(sessions, current_index)


def load_session(selected_index, sessions):
    if selected_index is None:
        return [], None
    try:
        selected_index = int(selected_index)
    except (TypeError, ValueError):
        return [], None
    if not 0 <= selected_index < len(sessions or []):
        return [], None
    return sessions[selected_index], selected_index


# ============================================================
# CEFR
# ============================================================

@lru_cache(maxsize=5000)
def get_word_level(word: str) -> str | None:
    try:
        level = analyzer.get_average_word_level_CEFR(word.lower())
        if level is None:
            return None
        level = str(level).strip().upper()
        return level if level in CEFR_LEVELS else None
    except Exception:
        return None


def make_highlighted_text(text, token_levels):
    parts = []
    cursor = 0
    for match in WORD_PATTERN.finditer(text):
        parts.append(html.escape(text[cursor:match.start()]))
        original = match.group(0)
        normalized = original.lower()
        level = token_levels.get(normalized)
        if level in CEFR_COLORS:
            color = CEFR_COLORS[level]
            parts.append(
                f'<span class="word-chip" style="--cefr-color:{color}">'
                f'{html.escape(original)}<sup>{level}</sup></span>'
            )
        else:
            parts.append(html.escape(original))
        cursor = match.end()
    parts.append(html.escape(text[cursor:]))
    return "".join(parts)


def analyze_cefr(text: str) -> str:
    text = text or ""
    if not text.strip():
        return """
        <div class="empty-state">
            <div class="empty-icon"><i class="ri-file-text-line"></i></div>
            <div class="empty-title">Chưa có dữ liệu</div>
            <div class="empty-text">Nhập một đoạn tiếng Anh rồi bấm "Phân tích".</div>
        </div>"""

    matches = list(WORD_PATTERN.finditer(text))
    if not matches:
        return """
        <div class="empty-state">
            <div class="empty-icon"><i class="ri-search-line"></i></div>
            <div class="empty-title">Không tìm thấy từ tiếng Anh</div>
            <div class="empty-text">Hãy nhập một đoạn văn có các từ tiếng Anh.</div>
        </div>"""

    tokens = [m.group(0) for m in matches]
    normalized_tokens = [t.lower() for t in tokens]
    token_levels = {w: get_word_level(w) for w in set(normalized_tokens)}
    occurrence_counts = Counter(
        token_levels[w] for w in normalized_tokens if token_levels[w] in CEFR_LEVELS
    )

    total_words = len(tokens)
    known_words = sum(occurrence_counts.values())
    unknown_words = total_words - known_words
    known_pct = (known_words / total_words * 100) if total_words else 0

    dominant_level = (
        max(CEFR_LEVELS, key=lambda lv: occurrence_counts[lv]) if known_words else None
    )
    highlighted = make_highlighted_text(text, token_levels)

    distribution_html = []
    for level in CEFR_LEVELS:
        count = occurrence_counts[level]
        pct = (count / known_words * 100) if known_words else 0
        color = CEFR_COLORS[level]
        distribution_html.append(f"""
        <div class="dist-row">
            <div class="dist-label">
                <span class="cefr-dot" style="background:{color}"></span>
                <strong>{level}</strong>
                <span>{CEFR_DESC[level]}</span>
            </div>
            <div class="dist-track"><div class="dist-fill" style="width:{pct:.1f}%;background:{color}"></div></div>
            <div class="dist-value">{count} · {pct:.0f}%</div>
        </div>""")

    if dominant_level:
        hero_color = CEFR_COLORS[dominant_level]
        hero_level = dominant_level
        hero_desc = CEFR_DESC[dominant_level]
        hero_explain = "Mức xuất hiện nổi bật trong vốn từ của đoạn văn."
    else:
        hero_color = "#94a3b8"
        hero_level = "N/A"
        hero_desc = "Chưa xác định"
        hero_explain = "Không đủ từ có CEFR level để tạo profile."

    return f"""
    <div class="cefr-result">
        <section class="level-hero" style="--hero-color:{hero_color}">
            <div>
                <div class="eyebrow">VOCABULARY PROFILE</div>
                <div class="hero-level">{hero_level}</div>
                <div class="hero-desc">{hero_desc}</div>
                <div class="hero-note">{hero_explain}</div>
            </div>
            <div class="hero-ring">
                <span>{known_pct:.0f}%</span>
                <small>recognized</small>
            </div>
        </section>
        <section class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">{total_words}</div>
                <div class="metric-label"><i class="ri-text"></i> Tổng từ</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">{unknown_words}</div>
                <div class="metric-label"><i class="ri-question-line"></i> Không nhận diện</div>
            </div>
        </section>
        <section class="result-section">
            <div class="section-heading">
                <h3><i class="ri-bar-chart-2-line"></i> Phân bố CEFR</h3>
                <p>Phân bố theo số lần xuất hiện của từ.</p>
            </div>
            <div class="distribution">{"".join(distribution_html)}</div>
        </section>
        <section class="result-section">
            <div class="section-heading">
                <h3><i class="ri-markup-line"></i> Văn bản đã phân tích</h3>
                <p>Di chuột vào từ để nhìn rõ level.</p>
            </div>
            <div class="highlight-box">{highlighted}</div>
        </section>
        <div class="cefr-disclaimer">
            <i class="ri-information-line"></i>
            <span><strong>Lưu ý:</strong> kết quả hiện tại là <b>phân tích từ vựng theo CEFR</b>,
            chưa phải bài đánh giá CEFR đầy đủ cho Reading, Writing, Listening và Speaking.</span>
        </div>
    </div>"""


# ============================================================
# CSS
# ============================================================

CSS = r"""
:root {
    --bg: #0b0d12;
    --panel: #11151d;
    --panel-2: #151a23;
    --border: #242b38;
    --border-soft: #1a202b;
    --text: #e8edf5;
    --muted: #8a94a6;
    --muted-2: #5f697a;
    --accent: #7c6cff;
    --accent-2: #6557e8;
    --user-bg: #1e2433;
    --bot-bg: #13171f;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { min-height: 100%; }

body {
    margin: 0;
    background: var(--bg) !important;
    color: var(--text) !important;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
}

.gradio-container {
    max-width: none !important;
    width: 100% !important;
    min-height: 100vh !important;
    padding: 0 !important;
    margin: 0 !important;
    background: var(--bg) !important;
}

footer { display: none !important; }

/* ── Sidebar ── */
#app-sidebar {
    background: #0d1016 !important;
    border-right: 1px solid var(--border-soft) !important;
}

.sidebar-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 2px 18px;
}

.brand-mark {
    width: 34px; height: 34px;
    display: grid; place-items: center;
    border-radius: 10px;
    background: linear-gradient(135deg, #7c6cff, #9b8cff);
    color: white; font-size: 18px;
}

.brand-title { font-size: 15px; font-weight: 650; color: #f2f4f8; letter-spacing: -0.02em; }
.brand-subtitle { font-size: 11px; color: var(--muted-2); margin-top: 2px; }

.new-chat {
    width: 100%; border-radius: 9px !important;
    border: 1px solid var(--border) !important;
    background: transparent !important; color: var(--text) !important;
    font-size: 13px !important; font-weight: 550 !important;
}
.new-chat:hover { background: var(--panel-2) !important; border-color: #30394a !important; }

.sidebar-section-label {
    margin: 22px 4px 8px; font-size: 10px; font-weight: 700;
    color: var(--muted-2); text-transform: uppercase; letter-spacing: 0.11em;
}

.hist-list { display: flex; flex-direction: column; gap: 2px; }

.hist-item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-radius: 8px; cursor: pointer;
    font-size: 12px; color: var(--muted);
    transition: background 0.15s, color 0.15s;
    overflow: hidden; border: 1px solid transparent;
}
.hist-item i { flex-shrink: 0; font-size: 14px; color: var(--muted-2); }
.hist-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-item:hover { background: var(--panel-2); color: var(--text); }
.hist-item.hist-active {
    background: rgba(124,108,255,0.12); color: #a89aff;
    border-color: rgba(124,108,255,0.2);
}
.hist-item.hist-active i { color: #a89aff; }
.hist-empty { font-size: 11px; color: var(--muted-2); padding: 6px 4px; }

.sidebar-note {
    margin-top: auto; padding: 14px 4px 2px;
    color: var(--muted-2); font-size: 11px; line-height: 1.6;
    display: flex; gap: 5px; align-items: flex-start;
}
.sidebar-note i { flex-shrink: 0; margin-top: 1px; }

/* ── Header ── */
#main-shell { min-width: 0; height: 100vh; background: var(--bg); display: flex; flex-direction: column; }

.app-header {
    height: 54px; flex-shrink: 0;
    padding: 0 24px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid var(--border-soft);
    background: rgba(11,13,18,0.95);
}
.app-header-title { font-size: 14px; font-weight: 650; color: #f4f6f9; display: flex; align-items: center; gap: 8px; }
.app-header-title i { color: var(--accent); font-size: 18px; }
.app-header-meta { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.1); }

/* ── Tabs ── */
#workspace-tabs { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
#workspace-tabs > div:first-child { flex-shrink: 0; }
#workspace-tabs > .tabitem { flex: 1 1 0; min-height: 0; overflow: hidden; }

.tab-nav {
    padding: 8px 24px 0 !important;
    border-bottom: 1px solid var(--border-soft) !important;
    background: var(--bg) !important;
}
.tab-nav button {
    color: var(--muted) !important; background: transparent !important;
    border: none !important; font-size: 13px !important; font-weight: 550 !important;
    display: inline-flex !important; align-items: center !important; gap: 5px !important;
}
.tab-nav button.selected { color: var(--text) !important; }

/* ── Chat layout ── */
#chat-view {
    height: 100%;
    display: flex; flex-direction: column;
    overflow: hidden;
    position: relative;
}

/* Welcome screen — chiếm toàn bộ không gian khi không có chat */
#chat-welcome-wrap {
    flex: 1 1 0; min-height: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    text-align: center; padding: 40px 24px 0;
}
#chat-welcome-wrap.hidden { display: none !important; }

#chat-welcome .welcome-icon {
    width: 56px; height: 56px; margin: 0 auto 18px;
    display: grid; place-items: center;
    border: 1px solid #2a3241; border-radius: 18px;
    background: #121720; color: #8e84ff; font-size: 26px;
}
#chat-welcome h2 { margin: 0 0 8px; font-size: 22px; letter-spacing: -0.03em; }
#chat-welcome p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.7; max-width: 340px; }

/* Chatbot messages */
#chatbot {
    flex: 1 1 0;
    min-height: 0 !important;
    border: none !important;
    background: transparent !important;
    overflow-y: auto !important;
}
/* Ẩn chatbot wrapper khi Gradio đánh dấu hidden */
#chatbot.hidden { display: none !important; }

/* Override Gradio bubble layout for clean chat UI */
#chatbot .bubble-wrap, #chatbot .wrap {
    max-width: 760px !important;
    margin: 0 auto !important;
    padding: 20px 20px 8px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 16px !important;
}

/* User message */
#chatbot .message.user {
    align-self: flex-end !important;
    max-width: 72% !important;
    background: var(--user-bg) !important;
    border: 1px solid #2a3344 !important;
    border-radius: 18px 18px 4px 18px !important;
    color: var(--text) !important;
    padding: 11px 16px !important;
    font-size: 14px !important;
    line-height: 1.65 !important;
}

/* Bot message */
#chatbot .message.bot {
    align-self: flex-start !important;
    max-width: 80% !important;
    background: var(--bot-bg) !important;
    border: 1px solid var(--border-soft) !important;
    border-radius: 4px 18px 18px 18px !important;
    color: #e0e6f0 !important;
    padding: 11px 16px !important;
    font-size: 14px !important;
    line-height: 1.78 !important;
}

#chatbot .message.bot .prose,
#chatbot .message.user .prose {
    font-size: 14px !important;
    line-height: 1.78 !important;
}

/* Hide default avatar icons that Gradio injects */
#chatbot .avatar-container { display: none !important; }
#chatbot .message-row { gap: 0 !important; }

/* Action buttons under messages */
#chatbot .message-buttons { opacity: 0.4; transition: opacity 0.15s; }
#chatbot .message-row:hover .message-buttons { opacity: 1; }

/* ── Composer ── */
.composer {
    flex-shrink: 0;
    max-width: 760px; width: 100%;
    margin: 0 auto;
    padding: 6px 20px 16px;
}

/* Quick-suggestion chips */
.suggestion-chips {
    display: flex; flex-wrap: wrap; gap: 6px;
    margin-bottom: 8px;
}
.chip {
    padding: 5px 11px;
    background: #13171f;
    border: 1px solid #252d3c;
    border-radius: 20px;
    font-size: 12px; color: var(--muted);
    cursor: pointer; transition: all 0.15s;
    white-space: nowrap;
}
.chip:hover { background: #1d2433; border-color: var(--accent); color: var(--text); }

.composer-label {
    font-size: 10px; font-weight: 700; color: var(--muted-2);
    text-transform: uppercase; letter-spacing: 0.09em;
    margin-bottom: 5px;
}

#message-row {
    gap: 8px !important;
    align-items: flex-end !important;
}

#message-box textarea {
    background: #141922 !important;
    border: 1px solid #293140 !important;
    color: var(--text) !important;
    border-radius: 14px !important;
    padding: 12px 14px !important;
    min-height: 48px !important;
    box-shadow: none !important;
    font-size: 14px !important;
    resize: none !important;
}
#message-box textarea:focus {
    border-color: #6257da !important;
    box-shadow: 0 0 0 3px rgba(124,108,255,0.10) !important;
}
#message-box textarea::placeholder { color: #687284 !important; }

#send-btn {
    min-width: 46px !important; width: 46px !important; height: 46px !important;
    border-radius: 12px !important;
    background: var(--accent) !important;
    border: none !important; color: white !important; font-size: 18px !important;
}
#send-btn:hover { background: var(--accent-2) !important; }

/* Hide default gradio examples block */
.gradio-container .examples { display: none !important; }

/* ── CEFR tab ── */
#cefr-view {
    height: 100%; overflow-y: auto;
    padding: 22px 24px 30px;
}
.cefr-shell { max-width: 1200px; margin: 0 auto; }

.cefr-intro { margin-bottom: 18px; }
.cefr-intro h1 {
    margin: 0 0 5px; font-size: 22px; letter-spacing: -0.03em;
    display: flex; align-items: center; gap: 9px;
}
.cefr-intro h1 i { color: var(--accent); }
.cefr-intro p { margin: 0; color: var(--muted); font-size: 13px; }

.cefr-grid {
    display: grid;
    grid-template-columns: minmax(300px, 0.85fr) minmax(0, 1.45fr);
    gap: 18px; align-items: start;
}

.cefr-input-card, .cefr-output-card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 14px;
}
.cefr-input-card { padding: 18px; position: sticky; top: 0; }
.cefr-output-card { padding: 18px; }

.cefr-input-card textarea {
    background: #0e1218 !important; border: 1px solid var(--border) !important;
    border-radius: 10px !important; color: var(--text) !important;
    line-height: 1.7 !important; box-shadow: none !important;
}
.cefr-input-card textarea:focus {
    border-color: #6257da !important;
    box-shadow: 0 0 0 3px rgba(124,108,255,0.08) !important;
}

.analyze-btn {
    width: 100%; margin-top: 10px;
    border-radius: 10px !important; background: var(--accent) !important;
    border: none !important; font-weight: 600 !important;
}
.clear-btn { margin-top: 8px; width: 100%; }

.input-caption {
    color: var(--muted-2); font-size: 11px; line-height: 1.55;
    margin-top: 12px; display: flex; align-items: flex-start; gap: 5px;
}
.input-caption i { flex-shrink: 0; margin-top: 1px; }

.level-hero {
    display: flex; align-items: center; justify-content: space-between; gap: 18px;
    padding: 20px;
    border: 1px solid color-mix(in srgb, var(--hero-color) 26%, #2a3241);
    background: linear-gradient(135deg, color-mix(in srgb, var(--hero-color) 10%, #11151d), #11151d 60%);
    border-radius: 13px;
}
.eyebrow { color: var(--muted-2); font-size: 10px; font-weight: 750; letter-spacing: 0.12em; }
.hero-level { margin-top: 2px; font-size: 40px; font-weight: 750; letter-spacing: -0.05em; color: var(--hero-color); }
.hero-desc { margin-top: 2px; color: #dce2eb; font-size: 13px; font-weight: 600; }
.hero-note { margin-top: 8px; max-width: 440px; color: var(--muted); font-size: 11px; line-height: 1.55; }
.hero-ring {
    width: 90px; height: 90px; border-radius: 50%; flex: 0 0 auto;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    border: 7px solid color-mix(in srgb, var(--hero-color) 18%, #242b38);
    box-shadow: inset 0 0 0 2px #11151d;
}
.hero-ring span { font-size: 20px; font-weight: 750; }
.hero-ring small { color: var(--muted-2); font-size: 8px; letter-spacing: 0.05em; text-transform: uppercase; }

.metric-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 8px; margin-top: 10px; }
.metric-card { padding: 13px 14px; border: 1px solid var(--border); background: #10141b; border-radius: 10px; }
.metric-value { font-size: 20px; font-weight: 700; }
.metric-label { margin-top: 3px; color: var(--muted-2); font-size: 10px; display: flex; align-items: center; gap: 4px; }

.result-section { margin-top: 18px; }
.section-heading { margin-bottom: 10px; }
.section-heading h3 { margin: 0; font-size: 13px; font-weight: 650; display: flex; align-items: center; gap: 6px; }
.section-heading h3 i { color: var(--accent); font-size: 15px; }
.section-heading p { margin: 3px 0 0; color: var(--muted-2); font-size: 10px; }

.distribution { display: flex; flex-direction: column; gap: 9px; }
.dist-row { display: grid; grid-template-columns: 150px 1fr 72px; align-items: center; gap: 10px; }
.dist-label { display: flex; align-items: center; gap: 7px; font-size: 11px; }
.dist-label span:last-child { color: var(--muted-2); font-size: 10px; }
.cefr-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dist-track { height: 6px; border-radius: 999px; background: #202632; overflow: hidden; }
.dist-fill { height: 100%; border-radius: inherit; }
.dist-value { text-align: right; color: var(--muted); font-size: 10px; }

.highlight-box {
    padding: 15px 15px 17px; border: 1px solid var(--border); border-radius: 10px;
    background: #0d1117; font-size: 13px; line-height: 2.6; word-break: break-word;
}
.word-chip {
    --cefr-color: #94a3b8;
    color: var(--cefr-color);
    border: 1px solid color-mix(in srgb, var(--cefr-color) 42%, #2a3241);
    background: color-mix(in srgb, var(--cefr-color) 11%, #0d1117);
    border-radius: 5px; padding: 2px 6px; margin: 1px 2px; white-space: nowrap;
}
.word-chip sup { margin-left: 3px; font-size: 8px; font-weight: 700; opacity: 0.8; }

.cefr-disclaimer {
    margin-top: 15px; padding: 11px 12px;
    border: 1px solid #242b38; border-radius: 9px;
    color: var(--muted-2); font-size: 10px; line-height: 1.55;
    display: flex; align-items: flex-start; gap: 6px;
}
.cefr-disclaimer i { flex-shrink: 0; margin-top: 1px; font-size: 13px; }

.empty-state {
    min-height: 300px; display: grid; place-items: center;
    align-content: center; text-align: center; padding: 30px;
}
.empty-icon {
    width: 44px; height: 44px; margin: 0 auto 12px; display: grid; place-items: center;
    border-radius: 12px; border: 1px solid var(--border); background: #10141b; color: #7c6cff; font-size: 20px;
}
.empty-title { color: #e3e8ef; font-size: 14px; font-weight: 650; }
.empty-text { color: var(--muted-2); font-size: 11px; line-height: 1.6; margin-top: 5px; }

/* ── Responsive ── */
@media (max-width: 900px) {
    .cefr-grid { grid-template-columns: 1fr; }
    .cefr-input-card { position: static; }
}
@media (max-width: 640px) {
    .app-header { padding: 0 14px; }
    .app-header-meta { display: none; }
    .composer { padding-left: 12px; padding-right: 12px; }
    #cefr-view { padding: 14px 12px 24px; }
    .dist-row { grid-template-columns: 120px 1fr 58px; gap: 7px; }
    .level-hero { align-items: flex-start; }
    .hero-ring { width: 78px; height: 78px; }
    #chatbot .message.user { max-width: 88% !important; }
    #chatbot .message.bot { max-width: 92% !important; }
}
"""

# ============================================================
# JS — chip click fills & submits the textbox



# ============================================================
# APP
# ============================================================

def make_chips_html(prompts):
    import json
    chips = "".join(
        f'<button class="chip" onclick="sendChip({json.dumps(p)})">{html.escape(p)}</button>'
        for p in prompts
    )
    return f'<div class="suggestion-chips">{chips}</div>'


with gr.Blocks(
    title="English Tutor",
    fill_width=True,
    fill_height=True,
) as app:

    # Inject Remixicon + helper JS qua script tag trong DOM
    gr.HTML("""
    <link id="remixicon-css" rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/remixicon@4.3.0/fonts/remixicon.css">
    <script>
    (function() {
        /* ── selectSession ── */
        window.selectSession = function(index) {
            var input = document.getElementById('session-trigger');
            if (!input) return;
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, String(index));
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };

        /* ── sendChip ── */
        window.sendChip = function(text) {
            var textarea = document.querySelector('#message-box textarea');
            if (!textarea) {
                setTimeout(function(){ window.sendChip(text); }, 200);
                return;
            }
            var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(textarea, text);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(function() {
                var btn = document.getElementById('send-btn');
                if (btn) btn.click();
            }, 300);
        };

        /* ── Toggle welcome/chatbot dựa theo DOM ── */
        function syncChatView() {
            var welcome = document.getElementById('chat-welcome');
            var chatbot = document.getElementById('chatbot');
            if (!welcome || !chatbot) return;
            /* Kiểm tra có tin nhắn nào trong chatbot chưa */
            var msgs = chatbot.querySelectorAll('.message');
            var hasMessages = msgs.length > 0;
            welcome.style.display = hasMessages ? 'none' : '';
        }

        /* Quan sát DOM thay đổi trong #chatbot */
        function startObserver() {
            var chatbot = document.getElementById('chatbot');
            if (!chatbot) {
                setTimeout(startObserver, 500);
                return;
            }
            syncChatView();
            var obs = new MutationObserver(syncChatView);
            obs.observe(chatbot, { childList: true, subtree: true });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserver);
        } else {
            startObserver();
        }
    })();
    </script>
    """)

    sessions_state = gr.State([])
    current_session_index = gr.State(None)

    # ── Sidebar ──────────────────────────────────────────────
    with gr.Sidebar(label="English Tutor", open=True, width=265, elem_id="app-sidebar"):
        gr.HTML("""
        <div class="sidebar-brand">
            <div class="brand-mark"><i class="ri-graduation-cap-fill"></i></div>
            <div>
                <div class="brand-title">English Tutor</div>
                <div class="brand-subtitle">Learn English with CEFR</div>
            </div>
        </div>
        """)

        new_chat_btn = gr.Button("+ Cuộc trò chuyện mới", elem_classes="new-chat")

        gr.HTML('<div class="sidebar-section-label">Lịch sử</div>')

        history_display = gr.HTML(
            '<div class="hist-empty">Chưa có cuộc trò chuyện nào.</div>',
            elem_classes="hist-list",
        )

        session_trigger = gr.Number(value=None, visible=False, elem_id="session-trigger")

        gr.HTML("""
        <div class="sidebar-note">
            <i class="ri-information-line"></i>
            Chatbot tập trung vào Vocabulary, Grammar, Translation
            và giải thích tiếng Anh bằng tiếng Việt.
        </div>
        """)

    # ── Main shell ───────────────────────────────────────────
    with gr.Column(elem_id="main-shell"):
        gr.HTML("""
        <div class="app-header">
            <div class="app-header-title">
                <i class="ri-graduation-cap-line"></i> English Tutor
            </div>
            <div class="app-header-meta">
                <span class="status-dot"></span> AI Tutor · CEFR
            </div>
        </div>
        """)

        with gr.Tabs(selected=0, elem_id="workspace-tabs"):

            # ── Chat tab ─────────────────────────────────────
            with gr.Tab("Chat", id="chat"):
                with gr.Column(elem_id="chat-view"):

                    # Welcome screen (hidden once chat starts)
                    chat_welcome = gr.HTML(
                        """
                        <div id="chat-welcome">
                            <div class="welcome-icon"><i class="ri-graduation-cap-line"></i></div>
                            <h2>Học tiếng Anh cùng AI</h2>
                            <p>Hỏi về từ vựng, ngữ pháp, dịch thuật,
                            cách dùng từ hoặc luyện tập theo trình độ của bạn.</p>
                        </div>
                        """,
                        visible=True,
                    )

                    chatbot = gr.Chatbot(
                        value=[],
                        layout="bubble",
                        height="100%",
                        show_label=False,
                        elem_id="chatbot",
                        autoscroll=True,
                        render_markdown=True,
                        visible=True,
                    )

                    # Composer
                    with gr.Column(elem_classes="composer"):
                        gr.HTML('<div class="composer-label"><i class="ri-lightbulb-line"></i>  Gợi ý câu hỏi</div>')
                        gr.HTML(make_chips_html(EXAMPLE_PROMPTS))

                        with gr.Row(elem_id="message-row"):
                            msg = gr.Textbox(
                                placeholder="Nhắn tin với English Tutor…",
                                show_label=False,
                                container=False,
                                lines=1,
                                max_lines=6,
                                elem_id="message-box",
                                scale=1,
                            )
                            send_btn = gr.Button(
                                "➤",
                                variant="primary",
                                elem_id="send-btn",
                                scale=0,
                                min_width=46,
                            )

            # ── CEFR tab ─────────────────────────────────────
            with gr.Tab("Phân tích CEFR", id="cefr"):
                with gr.Column(elem_id="cefr-view"):
                    with gr.Column(elem_classes="cefr-shell"):
                        gr.HTML("""
                        <div class="cefr-intro">
                            <h1><i class="ri-bar-chart-grouped-line"></i> Phân tích CEFR</h1>
                            <p>Xem mức độ từ vựng trong một đoạn tiếng Anh và phát hiện những từ nổi bật.</p>
                        </div>
                        """)

                        with gr.Row(elem_classes="cefr-grid"):
                            with gr.Column(elem_classes="cefr-input-card"):
                                text_input = gr.Textbox(
                                    label="Văn bản tiếng Anh",
                                    placeholder="Ví dụ:\nShe has been studying English for three years...",
                                    lines=14, max_lines=22, show_label=True,
                                )
                                analyze_btn = gr.Button(
                                    "Phân tích CEFR", variant="primary",
                                    elem_classes="analyze-btn",
                                )
                                gr.ClearButton(
                                    [text_input], value="Xóa văn bản",
                                    elem_classes="clear-btn",
                                )
                                gr.Examples(
                                    examples=[
                                        "She has been studying English for three years and her vocabulary is improving rapidly.",
                                        "The weather forecast was surprisingly accurate and the temperature was comfortable.",
                                        "I believe that trust is the foundation of every successful relationship.",
                                    ],
                                    inputs=text_input, label="Ví dụ", examples_per_page=3,
                                )
                                gr.HTML("""
                                <div class="input-caption">
                                    <i class="ri-information-line"></i>
                                    Phân tích tập trung vào <b>từ vựng</b>. CEFR đầy đủ cần
                                    đánh giá thêm nhiều kỹ năng và đặc trưng ngôn ngữ.
                                </div>""")

                            with gr.Column(elem_classes="cefr-output-card"):
                                cefr_output = gr.HTML("""
                                <div class="empty-state">
                                    <div class="empty-icon"><i class="ri-bar-chart-grouped-line"></i></div>
                                    <div class="empty-title">Kết quả sẽ xuất hiện ở đây</div>
                                    <div class="empty-text">Nhập văn bản và bấm "Phân tích CEFR".</div>
                                </div>""")

    # ── Events ───────────────────────────────────────────────

    chat_inputs  = [msg, chatbot, sessions_state, current_session_index]
    chat_outputs = [chatbot, sessions_state, current_session_index]

    def after_stream(sessions, idx):
        hist_html = save_session_ui(sessions, idx)
        return hist_html, ""   # history_display, msg clear

    # ── Send button ──
    send_btn.click(
        stream_chat, inputs=chat_inputs, outputs=chat_outputs, show_progress="minimal",
    ).then(
        after_stream,
        inputs=[sessions_state, current_session_index],
        outputs=[history_display, msg],
        queue=False,
    )

    # ── Enter to submit ──
    msg.submit(
        stream_chat, inputs=chat_inputs, outputs=chat_outputs, show_progress="minimal",
    ).then(
        after_stream,
        inputs=[sessions_state, current_session_index],
        outputs=[history_display, msg],
        queue=False,
    )

    # ── New chat ──
    new_chat_btn.click(
        new_chat,
        inputs=[chatbot, sessions_state],
        outputs=[chatbot, sessions_state, current_session_index, history_display],
        queue=False,
    )

    # ── Load session từ sidebar ──
    session_trigger.change(
        lambda idx, s: load_session(idx, s),
        inputs=[session_trigger, sessions_state],
        outputs=[chatbot, current_session_index],
        queue=False,
    )

    analyze_btn.click(
        analyze_cefr, inputs=text_input, outputs=cefr_output, show_progress="minimal",
    )


if __name__ == "__main__":
    app.queue().launch(css=CSS)