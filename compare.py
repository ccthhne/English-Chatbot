# ============================================================
# BENCHMARK RESULTS
# ============================================================

gemini_results = {
    "model": "Gemini 2.5 Flash",
    "tests": [
        {"test": 1, "category": "Vocabulary",         "time": 3.46,  "words": 163},
        {"test": 2, "category": "Word Comparison",    "time": 9.25,  "words": 602},
        {"test": 3, "category": "Word Comparison",    "time": 5.32,  "words": 280},
        {"test": 4, "category": "Grammar",            "time": 13.24, "words": 1220},
        {"test": 5, "category": "Grammar Correction", "time": 5.93,  "words": 386},
        {"test": 6, "category": "Translation",        "time": 8.73,  "words": 654},
        {"test": 7, "category": "Pronunciation",      "time": 15.35, "words": 286},
        {"test": 8, "category": "Exercise",           "time": 2.67,  "words": 205},
        {"test": 9, "category": "Conversation",       "time": 2.85,  "words": 254},
        {"test": 10,"category": "Context",            "time": 9.06,  "words": 452},
    ]
}

qwen06_results = {
    "model": "Qwen3-0.6B (GPU)",
    "tests": [
        {"test": 1, "category": "Vocabulary",         "time": 5.07,  "toks": 46,  "tps": 9.08},
        {"test": 2, "category": "Word Comparison",    "time": 10.07, "toks": 121, "tps": 12.01},
        {"test": 3, "category": "Word Comparison",    "time": 2.01,  "toks": 16,  "tps": 7.96},
        {"test": 4, "category": "Grammar",            "time": 8.92,  "toks": 117, "tps": 13.12},
        {"test": 5, "category": "Grammar Correction", "time": 5.74,  "toks": 75,  "tps": 13.07},
        {"test": 6, "category": "Translation",        "time": 8.29,  "toks": 114, "tps": 13.75},
        {"test": 7, "category": "Pronunciation",      "time": 6.52,  "toks": 68,  "tps": 10.42},
        {"test": 8, "category": "Exercise",           "time": 18.44, "toks": 230, "tps": 12.48},
        {"test": 9, "category": "Conversation",       "time": 2.43,  "toks": 22,  "tps": 9.04},
        {"test": 10,"category": "Context",            "time": 12.71, "toks": 117, "tps": 9.21},
    ]
}

qwen17_results = {
    "model": "Qwen3-1.7B (GPU/Kaggle T4)",
    "tests": [
        {"test": 1, "category": "Vocabulary",         "time": 16.69, "toks": 251, "tps": 15.04},
        {"test": 2, "category": "Word Comparison",    "time": 23.81, "toks": 388, "tps": 16.30},
        {"test": 3, "category": "Word Comparison",    "time": 13.72, "toks": 222, "tps": 16.18},
        {"test": 4, "category": "Grammar",            "time": 31.56, "toks": 512, "tps": 16.22},
        {"test": 5, "category": "Grammar Correction", "time": 15.51, "toks": 253, "tps": 16.31},
        {"test": 6, "category": "Translation",        "time": 13.81, "toks": 224, "tps": 16.22},
        {"test": 7, "category": "Pronunciation",      "time": 18.87, "toks": 307, "tps": 16.27},
        {"test": 8, "category": "Exercise",           "time": 21.62, "toks": 355, "tps": 16.42},
        {"test": 9, "category": "Conversation",       "time": 3.25,  "toks": 53,  "tps": 16.32},
        {"test": 10,"category": "Context",            "time": 23.63, "toks": 387, "tps": 16.38},
    ]
}


# ============================================================
# COMPUTE SUMMARY
# ============================================================

def summarize(data):
    tests = data["tests"]
    total_time = sum(t["time"] for t in tests)
    avg_time = total_time / len(tests)
    total_words = sum(t.get("words", t.get("toks", 0)) for t in tests)
    return {
        "model": data["model"],
        "total_time": round(total_time, 2),
        "avg_time": round(avg_time, 2),
        "total_output": total_words,
        "times": [t["time"] for t in tests],
        "outputs": [t.get("words", t.get("toks", 0)) for t in tests],
        "categories": [t["category"] for t in tests],
    }

gemini_s  = summarize(gemini_results)
qwen06_s  = summarize(qwen06_results)
qwen17_s  = summarize(qwen17_results)

summaries = [gemini_s, qwen06_s, qwen17_s]


# ============================================================
# QUALITY SCORES (manual)
# ============================================================

quality = {
    "Gemini 2.5 Flash":          [5, 5, 5, 5, 5, 5, 5, 5, 4, 5],
    "Qwen3-0.6B (GPU)":          [3, 2, 3, 1, 2, 3, 2, 1, 3, 2],
    "Qwen3-1.7B (GPU/Kaggle T4)":[4, 3, 4, 3, 4, 4, 3, 2, 3, 3],
}

categories = [t["category"] for t in gemini_results["tests"]]


# ============================================================
# GENERATE HTML REPORT
# ============================================================

colors = {
    "Gemini 2.5 Flash":           "#4285F4",
    "Qwen3-0.6B (GPU)":           "#EA4335",
    "Qwen3-1.7B (GPU/Kaggle T4)": "#34A853",
}

html = f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Benchmark Report - English Chatbot</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  body {{ font-family: 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 20px; color: #333; }}
  h1 {{ text-align: center; color: #1a1a2e; }}
  h2 {{ color: #16213e; border-bottom: 2px solid #4285F4; padding-bottom: 8px; }}
  .container {{ max-width: 1100px; margin: auto; }}
  .card {{ background: white; border-radius: 12px; padding: 24px; margin-bottom: 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }}
  table {{ width: 100%; border-collapse: collapse; }}
  th {{ background: #1a1a2e; color: white; padding: 10px; text-align: left; }}
  td {{ padding: 10px; border-bottom: 1px solid #eee; }}
  tr:hover {{ background: #f9f9f9; }}
  .badge {{ display: inline-block; padding: 4px 10px; border-radius: 20px; color: white; font-size: 13px; }}
  .chart-row {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }}
  .subtitle {{ text-align: center; color: #666; margin-top: -10px; margin-bottom: 20px; }}
  .winner {{ background: #e8f5e9; font-weight: bold; }}
</style>
</head>
<body>
<div class="container">
  <h1>📊 Benchmark Report: English Chatbot</h1>
  <p class="subtitle">So sánh Gemini 2.5 Flash vs Qwen3-0.6B vs Qwen3-1.7B</p>

  <!-- SUMMARY TABLE -->
  <div class="card">
    <h2>📋 Tổng quan</h2>
    <table>
      <tr>
        <th>Model</th>
        <th>Tổng thời gian (s)</th>
        <th>Trung bình/test (s)</th>
        <th>Tổng output</th>
        <th>Chất lượng TB</th>
      </tr>
"""

for s in summaries:
    model = s["model"]
    q_scores = quality[model]
    avg_q = round(sum(q_scores) / len(q_scores), 2)
    color = colors[model]
    html += f"""
      <tr>
        <td><span class="badge" style="background:{color}">{model}</span></td>
        <td>{s['total_time']}s</td>
        <td>{s['avg_time']}s</td>
        <td>{s['total_output']}</td>
        <td>{'⭐' * round(avg_q)} ({avg_q}/5)</td>
      </tr>
"""

html += """
    </table>
  </div>

  <!-- CHARTS -->
  <div class="chart-row">
    <div class="card">
      <h2>⏱️ Thời gian phản hồi</h2>
      <canvas id="timeChart"></canvas>
    </div>
    <div class="card">
      <h2>📝 Độ dài output</h2>
      <canvas id="outputChart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>⭐ Chất lượng theo category</h2>
    <canvas id="qualityChart" height="80"></canvas>
  </div>

  <!-- DETAIL TABLE -->
  <div class="card">
    <h2>📄 Chi tiết từng test</h2>
    <table>
      <tr>
        <th>#</th>
        <th>Category</th>
        <th>Gemini (s)</th>
        <th>Qwen3-0.6B (s)</th>
        <th>Qwen3-1.7B (s)</th>
        <th>Model tốt nhất</th>
      </tr>
"""

for i in range(10):
    g_time  = gemini_results["tests"][i]["time"]
    q6_time = qwen06_results["tests"][i]["time"]
    q17_time= qwen17_results["tests"][i]["time"]
    cat     = categories[i]
    fastest = min(
        ("Gemini", g_time),
        ("Qwen3-0.6B", q6_time),
        ("Qwen3-1.7B", q17_time),
        key=lambda x: x[1]
    )
    html += f"""
      <tr>
        <td>{i+1}</td>
        <td>{cat}</td>
        <td>{g_time}s</td>
        <td>{q6_time}s</td>
        <td>{q17_time}s</td>
        <td><span class="badge" style="background:#34A853">{fastest[0]}</span></td>
      </tr>
"""

labels_js     = str(categories)
g_times_js    = str(gemini_s["times"])
q6_times_js   = str(qwen06_s["times"])
q17_times_js  = str(qwen17_s["times"])
g_out_js      = str(gemini_s["outputs"])
q6_out_js     = str(qwen06_s["outputs"])
q17_out_js    = str(qwen17_s["outputs"])
g_q_js        = str(quality["Gemini 2.5 Flash"])
q6_q_js       = str(quality["Qwen3-0.6B (GPU)"])
q17_q_js      = str(quality["Qwen3-1.7B (GPU/Kaggle T4)"])

html += f"""
    </table>
  </div>

  <!-- CONCLUSION -->
  <div class="card">
    <h2>🏆 Kết luận</h2>
    <table>
      <tr><th>Tiêu chí</th><th>Model tốt nhất</th><th>Lý do</th></tr>
      <tr class="winner"><td>Chất lượng</td><td>Gemini 2.5 Flash</td><td>Giải thích chính xác, chi tiết nhất</td></tr>
      <tr><td>Tốc độ</td><td>Qwen3-0.6B</td><td>Chạy local, không cần internet</td></tr>
      <tr><td>Cân bằng</td><td>Qwen3-1.7B</td><td>Chất lượng tốt hơn 0.6B, tốc độ ổn</td></tr>
      <tr class="winner"><td>Deploy chatbot</td><td>Gemini 2.5 Flash</td><td>Phù hợp nhất cho sản phẩm thực tế</td></tr>
    </table>
  </div>

</div>

<script>
const labels = {labels_js};

new Chart(document.getElementById('timeChart'), {{
  type: 'bar',
  data: {{
    labels: labels,
    datasets: [
      {{ label: 'Gemini 2.5 Flash',          data: {g_times_js},   backgroundColor: '#4285F4' }},
      {{ label: 'Qwen3-0.6B (GPU)',           data: {q6_times_js},  backgroundColor: '#EA4335' }},
      {{ label: 'Qwen3-1.7B (Kaggle T4)',     data: {q17_times_js}, backgroundColor: '#34A853' }},
    ]
  }},
  options: {{ responsive: true, plugins: {{ legend: {{ position: 'top' }} }} }}
}});

new Chart(document.getElementById('outputChart'), {{
  type: 'bar',
  data: {{
    labels: labels,
    datasets: [
      {{ label: 'Gemini 2.5 Flash',          data: {g_out_js},   backgroundColor: '#4285F4' }},
      {{ label: 'Qwen3-0.6B (GPU)',           data: {q6_out_js},  backgroundColor: '#EA4335' }},
      {{ label: 'Qwen3-1.7B (Kaggle T4)',     data: {q17_out_js}, backgroundColor: '#34A853' }},
    ]
  }},
  options: {{ responsive: true, plugins: {{ legend: {{ position: 'top' }} }} }}
}});

new Chart(document.getElementById('qualityChart'), {{
  type: 'line',
  data: {{
    labels: labels,
    datasets: [
      {{ label: 'Gemini 2.5 Flash',          data: {g_q_js},   borderColor: '#4285F4', fill: false, tension: 0.3 }},
      {{ label: 'Qwen3-0.6B (GPU)',           data: {q6_q_js},  borderColor: '#EA4335', fill: false, tension: 0.3 }},
      {{ label: 'Qwen3-1.7B (Kaggle T4)',     data: {q17_q_js}, borderColor: '#34A853', fill: false, tension: 0.3 }},
    ]
  }},
  options: {{ responsive: true, scales: {{ y: {{ min: 0, max: 5 }} }}, plugins: {{ legend: {{ position: 'top' }} }} }}
}});
</script>
</body>
</html>
"""

with open("benchmark_report.html", "w", encoding="utf-8") as f:
    f.write(html)

print("Báo cáo đã được tạo: benchmark_report.html")
print("\nTóm tắt:")
for s in summaries:
    model = s["model"]
    q_scores = quality[model]
    avg_q = round(sum(q_scores) / len(q_scores), 2)
    print(f"  {model}: avg {s['avg_time']}s/test | quality {avg_q}/5")