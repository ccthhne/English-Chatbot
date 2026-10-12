import time
import os
import json
from openai import OpenAI


# ============================================================
# CONFIG
# ============================================================
MODEL_NAME = "moonshotai/kimi-k3"

SYSTEM_PROMPT = """
Bạn là một AI English Tutor dành cho người Việt Nam.

Quy tắc:
1. Luôn trả lời bằng tiếng Việt.
2. Giải thích rõ ràng, chính xác và dễ hiểu.
3. Khi đưa ví dụ tiếng Anh, phải kèm giải thích bằng tiếng Việt.
4. Với câu hỏi sửa lỗi ngữ pháp, hãy nói ĐÚNG hoặc SAI trước.
5. Với câu hỏi so sánh từ vựng, hãy chỉ ra sự khác nhau trực tiếp.
6. Khi được yêu cầu tạo bài tập, không đưa đáp án.
7. Không tiết lộ suy nghĩ nội bộ hoặc chain-of-thought.
"""


# ============================================================
# TEST CASES
# ============================================================

TESTS = [
    ("Vocabulary", "Từ 'accurate' nghĩa là gì? Cho tôi ví dụ."),
    ("Word Comparison", "Sự khác nhau giữa 'believe' và 'trust' là gì?"),
    ("Word Comparison", "Có câu 'I believe you' không? Câu này có đúng và tự nhiên không?"),
    ("Grammar", "Giải thích thì hiện tại hoàn thành và cách sử dụng của nó."),
    ("Grammar Correction", "Câu 'I have went to school yesterday' có đúng không? Nếu sai hãy sửa và giải thích."),
    ("Translation", "Dịch câu 'Tôi đã học tiếng Anh được 3 năm' sang tiếng Anh và giải thích cách dùng thì."),
    ("Pronunciation", "Từ 'comfortable' phát âm như thế nào? Cho tôi IPA và cách đọc gần đúng cho người Việt."),
    ("Exercise", "Hãy tạo cho tôi 5 bài tập về sự khác nhau giữa 'say' và 'tell'. Không đưa đáp án."),
    ("Conversation", "Hãy đóng vai một người bạn nước ngoài và nói chuyện với tôi bằng tiếng Anh ở trình độ B1."),
    ("Context", "Tôi thường nhầm giữa 'borrow' và 'lend'. Hãy giải thích thật dễ hiểu.")
]


# ============================================================
# INIT CLIENT
# ============================================================

client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.environ["NVIDIA_API_KEY"]
)

print("========================================")
print("NVIDIA NIM BENCHMARK")
print("========================================")
print("Model:", MODEL_NAME)
print("Total tests:", len(TESTS))


# ============================================================
# BENCHMARK
# ============================================================

results = []

for index, (category, question) in enumerate(TESTS, start=1):

    print("\n")
    print("============================================================")
    print(f"TEST {index} - {category}")
    print("============================================================")

    print("\nQUESTION:")
    print(question)

    print("\nGenerating...")

    start_time = time.perf_counter()

    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question}
        ],
        max_tokens=512,
        temperature=0.7
    )

    end_time = time.perf_counter()

    generation_time = end_time - start_time
    answer = response.choices[0].message.content or ""
    output_words = len(answer.split())

    print("\nANSWER:")
    print(answer)

    print("\n--- Statistics ---")
    print(f"Generation time: {generation_time:.2f} seconds")
    print(f"Approx words: {output_words}")

    results.append({
        "test": index,
        "category": category,
        "question": question,
        "answer": answer,
        "generation_time": generation_time,
        "output_words": output_words
    })


# ============================================================
# SAVE RESULTS
# ============================================================

output_path = "data/results_nvidia.json"

with open(output_path, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"\nResults saved to {output_path}")


# ============================================================
# SUMMARY
# ============================================================

print("\n\n")
print("============================================================")
print("BENCHMARK FINISHED")
print("============================================================")

for result in results:
    print(
        f"Test {result['test']:02d} | "
        f"{result['category']:<20} | "
        f"{result['generation_time']:.2f}s | "
        f"{result['output_words']} words"
    )

total_time = sum(r["generation_time"] for r in results)
total_words = sum(r["output_words"] for r in results)

print("\n")
print("============================================================")
print("OVERALL STATISTICS")
print("============================================================")
print(f"Total time: {total_time:.2f} seconds")
print(f"Total words: {total_words}")
print(f"Average time per test: {total_time/len(results):.2f} seconds")
print("============================================================")