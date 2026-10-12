# English Chatbot — Web học tiếng Anh cho người Việt

Đồ án: web app học tiếng Anh với chatbot AI (Groq), phân tích trình độ CEFR,
flashcard, bài đọc song ngữ, bài học ngữ pháp AI và luyện nghe VOA.

## Tính năng chính

- **Chatbot AI** streaming (Groq) — hỏi đáp, chấm câu, giải thích
- **Phân tích CEFR** — đánh giá trình độ từ vựng/ngữ pháp theo khung A1–C2
- **Flashcard** — từ đã tra, Oxford 3000/5000, TOEIC, IELTS
- **Bài đọc song ngữ** — 42 bài VOA, hover tra từ
- **Ngữ pháp AI** — 56 chủ đề A1–C2, sinh bài tại chỗ + cache
- **Luyện nghe** — 156 bài VOA Learning English (giọng người thật), trắc nghiệm + chép chính tả

## Cài đặt

Yêu cầu: Python 3.10+, key Groq API (miễn phí tại console.groq.com).

```bash
# 1. Clone repo
git clone https://github.com/ccthhne/English-Chatbot.git
cd English-Chatbot

# 2. Tạo môi trường ảo và cài thư viện
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate    # macOS/Linux
pip install -r requirements.txt
python -m spacy download en_core_web_sm

# 3. Đặt API key (Windows PowerShell)
$env:GROQ_API_KEY = "gsk_..."

# 4. Tạo từ điển (chạy 1 lần, vài phút)
python import_avdict.py

# 5. Chạy server
uvicorn main:app --reload
```

Mở trình duyệt: http://127.0.0.1:8000

## Nghe offline (tùy chọn)

Mặc định app phát audio từ URL VOA (cần mạng). Để nghe offline,
tải 6 file ZIP audio trong thư mục Google Drive của project,
giải nén vào `static/audio/` (giữ nguyên cấu trúc thư mục con).

## Cấu trúc thư mục

```
├── main.py              # Backend FastAPI
├── requirements.txt
├── templates/index.html # Giao diện
├── static/              # CSS, JS, JSON bài học
│   └── audio/           # MP3 nghe offline (không commit lên Git, xem .gitignore)
├── data/                # JSON từ vựng, ngữ pháp, collocation...
│   └── *.db             # Tự tạo khi chạy (không commit)
├── benchmark/           # Thử nghiệm chọn model
└── pregen_grammar.py    # Tool sinh sẵn bài ngữ pháp (tùy chọn)
```

## Ghi chú

- File nặng (`.venv/`, `static/audio/`, `*.db`, `*.zip`) đã loại khỏi repo
  qua `.gitignore`; xem `README` mục Cài đặt để tái tạo.
- Không commit API key — luôn đặt qua biến môi trường `GROQ_API_KEY`.
