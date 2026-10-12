# English Chatbot

Đồ án web học tiếng Anh cho người Việt.

## Tính năng

- Chatbot AI (Groq): hỏi đáp, chấm câu, giải thích ngữ pháp
- Phân tích trình độ CEFR (A1–C2) cho từ vựng và ngữ pháp
- Flashcard: từ đã tra, Oxford 3000/5000, TOEIC, IELTS
- Bài đọc song ngữ: 42 bài VOA, hover để tra từ
- Ngữ pháp: 56 chủ đề từ A1 đến C2
- Luyện nghe: 156 bài VOA Learning English, làm trắc nghiệm hoặc chép chính tả

## Cài đặt

Cần Python 3.10+ và key Groq API (đăng ký miễn phí tại console.groq.com).

```bash
git clone https://github.com/ccthhne/English-Chatbot.git
cd English-Chatbot

python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

Đặt API key (PowerShell):

```powershell
$env:GROQ_API_KEY = "gsk_..."
```

Tạo từ điển (chạy một lần duy nhất):

```bash
python import_avdict.py
```

Chạy server:

```bash
uvicorn main:app --reload
```

Mở trình duyệt: http://127.0.0.1:8000
