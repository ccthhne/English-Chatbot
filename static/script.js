// ============================================================
// STATE
// ============================================================

let history = [];
let sessions = JSON.parse(localStorage.getItem('chatSessions') || '[]');
let currentSessionIndex = null;
let isStreaming = false;
let savedWords = JSON.parse(localStorage.getItem('savedWords') || '[]');

// ============================================================
// THEME SÁNG/TỐI (12/10/2026) — nút ở topbar, nhớ lựa chọn vào localStorage
// ============================================================
function initTheme() {
    let t = 'light';
    try { t = localStorage.getItem('appTheme') || 'light'; } catch (e) {}
    if (t !== 'dark' && t !== 'light') t = 'light';
    document.documentElement.setAttribute('data-theme', t);
    const ic = document.getElementById('themeIcon');
    if (ic) ic.className = t === 'dark' ? 'ri-moon-line' : 'ri-sun-line';
}
function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('appTheme', next); } catch (e) {}
    const ic = document.getElementById('themeIcon');
    if (ic) ic.className = next === 'dark' ? 'ri-moon-line' : 'ri-sun-line';
}

// Restore history sidebar on load
document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    if (sessions.length > 0) renderHistory();
    updateBookmarkCount();
    if (typeof refreshHomeTab === 'function') refreshHomeTab();
    // Auth: kiểm tra phiên cũ + xử lý link đặt lại mật khẩu (08/10/2026)
    checkAuthOnLoad();
    const rt = new URLSearchParams(location.search).get('reset');
    if (rt) {
        _pendingResetToken = rt;
        showAuthModal('reset');
        history.replaceState(null, '', location.pathname);
    }
});

// ============================================================
// WELCOME TITLE NGẪU NHIÊN
// ============================================================

const WELCOME_TITLES = [
    "Bắt đầu học tiếng Anh thôi?",
    "Hôm nay học từ mới nào?",
    "Luyện tiếng Anh cùng AI nhé!",
    "Từ vựng hôm nay là gì?",
    "Ngữ pháp nào đang làm bạn khó?",
    "Cùng nâng trình độ CEFR nào!",
    "English time? Let's go!",
    "Một từ mới mỗi ngày nhé!",
];

function setRandomTitle() {
    const el = document.getElementById('welcomeTitle');
    if (el) {
        el.textContent = WELCOME_TITLES[Math.floor(Math.random() * WELCOME_TITLES.length)];
    }
}

// Gọi ngay khi load
document.addEventListener('DOMContentLoaded', setRandomTitle);

// ============================================================
// TAB SWITCHING
// ============================================================

function switchTab(tab) {
    // Chưa đăng nhập thì chỉ được ở trang chủ (08/10/2026)
    if (tab !== 'home' && !isLoggedIn()) { showAuthModal(); return; }
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    document.getElementById(`tab-${tab}`).classList.add('active');
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

    const icons = { home: 'ri-home-line', chat: 'ri-chat-3-line', cefr: 'ri-bar-chart-grouped-line', flashcard: 'ri-layers-line', reading: 'ri-book-open-line', listening: 'ri-headphone-line', lesson: 'ri-sparkles-line', progress: 'ri-line-chart-line' };
    const titles = { home: 'Trang chủ', chat: 'Chat', cefr: 'Phân tích CEFR', flashcard: 'Flashcard', reading: 'Bài đọc', listening: 'Luyện nghe', lesson: 'Bài học AI', progress: 'Tiến bộ' };

    document.getElementById('topbarTitle').innerHTML = `
        <i class="${icons[tab]}"></i>
        <span>${titles[tab]}</span>
    `;

    if (tab === 'home') refreshHomeTab();
    if (tab === 'flashcard') refreshFlashcardTab();
    if (tab === 'reading') openReading();
    if (tab === 'listening') openListening();
    if (tab === 'progress') renderProgress();
}

// ============================================================
// AUTH (08/10/2026): đăng nhập email + mật khẩu để học.
// Token lưu localStorage, gửi kèm header Authorization: Bearer.
// Từ đã lưu / tiến trình đồng bộ lên server theo tài khoản.
// ============================================================
let authToken = localStorage.getItem('authToken') || '';
let authUser = null;
try { authUser = JSON.parse(localStorage.getItem('authUser') || 'null'); } catch (e) {}
let _pendingResetToken = '';

function authHeaders() {
    return authToken ? { 'Authorization': 'Bearer ' + authToken } : {};
}
function isLoggedIn() { return !!(authToken && authUser); }

function showAuthModal(view) {
    showAuthView(view || 'login');
    document.getElementById('authBackdrop').style.display = 'flex';
}
function hideAuthModal() {
    document.getElementById('authBackdrop').style.display = 'none';
}
function showAuthView(v) {
    ['Login', 'Register', 'Forgot', 'Reset'].forEach(x => {
        document.getElementById('auth' + x + 'View').style.display = (x.toLowerCase() === v) ? '' : 'none';
    });
    const titles = { login: 'Đăng nhập', register: 'Tạo tài khoản mới', forgot: 'Quên mật khẩu', reset: 'Đặt lại mật khẩu' };
    document.getElementById('authTitle').textContent = titles[v] || titles.login;
    const subs = { login: 'Đăng nhập để học', register: 'Tạo tài khoản để lưu từ vựng và đồng bộ tiến trình học.' };
    const subEl = document.getElementById('authSub');
    subEl.textContent = subs[v] || '';
    subEl.style.display = subs[v] ? '' : 'none';
}

function refreshAuthUI() {
    const logged = isLoggedIn();
    document.getElementById('authLoginBtn').style.display = logged ? 'none' : '';
    const ub = document.getElementById('authUserBtn');
    ub.style.display = logged ? '' : 'none';
    if (logged) document.getElementById('authUserName').textContent = authUser.name || authUser.email;
}

async function onAuthSuccess(token, user) {
    authToken = token;
    authUser = user;
    localStorage.setItem('authToken', token);
    localStorage.setItem('authUser', JSON.stringify(user));
    refreshAuthUI();
    hideAuthModal();
    await migrateLocalToServer();
}

async function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const err = document.getElementById('loginErr');
    err.textContent = '';
    if (!email || !password) { err.textContent = 'Nhập email và mật khẩu'; return; }
    try {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const d = await res.json();
        if (d.error) { err.textContent = d.error; return; }
        await onAuthSuccess(d.token, d.user);
    } catch (e) { err.textContent = 'Lỗi kết nối: ' + e.message; }
}

async function doRegister() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const err = document.getElementById('regErr');
    err.textContent = '';
    if (!email || !password) { err.textContent = 'Nhập email và mật khẩu'; return; }
    try {
        const res = await fetch('/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name })
        });
        const d = await res.json();
        if (d.error) { err.textContent = d.error; return; }
        await onAuthSuccess(d.token, d.user);
    } catch (e) { err.textContent = 'Lỗi kết nối: ' + e.message; }
}

async function doForgot() {
    const email = document.getElementById('forgotEmail').value.trim();
    const err = document.getElementById('forgotErr');
    const ok = document.getElementById('forgotOk');
    err.textContent = ''; ok.textContent = '';
    if (!email) { err.textContent = 'Nhập email đã đăng ký'; return; }
    try {
        await fetch('/api/forgot-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        ok.textContent = 'Đã gửi link đặt lại mật khẩu vào email của bạn (nếu email tồn tại).';
    } catch (e) { err.textContent = 'Lỗi kết nối: ' + e.message; }
}

async function doResetPassword() {
    const password = document.getElementById('resetPassword').value;
    const err = document.getElementById('resetErr');
    const ok = document.getElementById('resetOk');
    err.textContent = ''; ok.textContent = '';
    if (!password) { err.textContent = 'Nhập mật khẩu mới'; return; }
    try {
        const res = await fetch('/api/reset-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: _pendingResetToken, new_password: password })
        });
        const d = await res.json();
        if (d.error) { err.textContent = d.error; return; }
        ok.textContent = 'Đặt lại mật khẩu thành công. Hãy đăng nhập lại.';
        _pendingResetToken = '';
        setTimeout(() => showAuthView('login'), 1500);
    } catch (e) { err.textContent = 'Lỗi kết nối: ' + e.message; }
}

async function doLogout() {
    try { await fetch('/api/logout', { method: 'POST', headers: authHeaders() }); } catch (e) {}
    authToken = '';
    authUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    refreshAuthUI();
    switchTab('home');
}

async function checkAuthOnLoad() {
    if (!authToken) { refreshAuthUI(); return; }
    try {
        const res = await fetch('/api/me', { headers: authHeaders() });
        if (!res.ok) throw new Error('expired');
        const d = await res.json();
        authUser = d.user;
        localStorage.setItem('authUser', JSON.stringify(authUser));
    } catch (e) {
        authToken = '';
        authUser = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
    }
    refreshAuthUI();
}

// Đẩy dữ liệu localStorage lên server 1 lần khi đăng nhập, rồi kéo về hợp nhất (08/10/2026)
async function migrateLocalToServer() {
    try {
        const words = JSON.parse(localStorage.getItem('savedWords') || '[]');
        if (words.length) {
            await fetch('/api/user/words/bulk', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ words })
            });
        }
        const prog = JSON.parse(localStorage.getItem('topicProgress') || '{}');
        if (Object.keys(prog).length) {
            await fetch('/api/user/progress/bulk', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ progress: prog })
            });
        }
        const sw = await fetch('/api/user/words', { headers: authHeaders() }).then(r => r.json());
        if (sw.words) {
            savedWords = sw.words;
            localStorage.setItem('savedWords', JSON.stringify(savedWords));
        }
        const sp = await fetch('/api/user/progress', { headers: authHeaders() }).then(r => r.json());
        if (sp.progress) {
            const merged = {};
            for (const [g, ws] of Object.entries(sp.progress)) merged[g] = { known: ws };
            localStorage.setItem('topicProgress', JSON.stringify(merged));
        }
        if (typeof updateBookmarkCount === 'function') updateBookmarkCount();
        if (typeof renderSavedWordsPanel === 'function') renderSavedWordsPanel();
        if (typeof renderBrowse === 'function') renderBrowse();
    } catch (e) { /* đăng nhập vẫn ok, đồng bộ thử lại ở lần sau */ }
}

// Ghi từ đã lưu: localStorage + đồng bộ server (gọi sau mỗi lần đổi savedWords)
let _syncWordsTimer = null;
function persistSavedWords() {
    try { localStorage.setItem('savedWords', JSON.stringify(savedWords)); } catch (e) {}
    if (!isLoggedIn()) return;
    clearTimeout(_syncWordsTimer);
    _syncWordsTimer = setTimeout(async () => {
        try {
            await fetch('/api/user/words/bulk', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ words: savedWords })
            });
        } catch (e) {}
    }, 800);
}
function removeSavedWordServer(lemma) {
    if (!isLoggedIn() || !lemma) return;
    fetch('/api/user/words?lemma=' + encodeURIComponent(lemma), {
        method: 'DELETE', headers: authHeaders()
    }).catch(() => {});
}

// ============================================================
// CHAT
// ============================================================

function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function sendChip(btn) {
    const text = btn.textContent.trim();
    document.getElementById('msgInput').value = text;
    sendMessage();
}

async function sendMessage() {
    if (isStreaming) return;

    const input = document.getElementById('msgInput');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    input.style.height = 'auto';

    // 09/10/2026: đang ở chế độ hỏi đáp theo chủ đề ngữ pháp -> gắn ngữ cảnh
    // bài học vào message gửi đi (pattern như drawer bài đọc). Tin nhắn hiển thị
    // và history giữ nguyên câu user gõ.
    let sendText = message;
    if (chatGrammarTopic) {
        sendText = `[Ngữ cảnh — Chủ đề ngữ pháp "${chatGrammarTopic.title}":\n${chatGrammarTopic.ctx}]\n\n` +
            `Câu hỏi của người học về chủ đề trên: ${message}\n` +
            `(Hãy ưu tiên giải đáp trong phạm vi chủ đề ngữ pháp này, bằng tiếng Việt, kèm ví dụ. ` +
            `Nếu câu hỏi không liên quan đến chủ đề, trả lời ngắn gọn rồi nhẹ nhàng lái về chủ đề.)`;
    }

    // Show chat, hide welcome
    showChat();

    // Add user message
    appendMessage('user', message);
    history.push({ role: 'user', content: message });

    // Add bot typing
    const botId = appendBotTyping();

    // Disable send
    setSending(true);

    let detectedWords = [];

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            // Tài liệu đính kèm (08/10/2026): gửi doc_id khi có chip; kèm token để
            // backend xác thực chủ tài liệu. Không có doc_id -> chat thường như cũ.
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({ message: sendText, history: history.slice(0, -1), doc_id: chatDocId })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let answer = '';
        let buf = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop(); // giữ dòng chưa hoàn chỉnh

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6);
                if (data === '[DONE]') break;

                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        answer = `Lỗi: ${parsed.error}`;
                    } else if (parsed.words) {
                        detectedWords = parsed.words;
                    } else if (parsed.content) {
                        answer += parsed.content;
                    }
                    updateBotMessage(botId, answer);
                } catch {}
            }
        }

        if (!answer) answer = 'Xin lỗi, có lỗi xảy ra. Vui lòng thử lại.';
        history.push({ role: 'assistant', content: answer });
        updateBotMessage(botId, answer);
        saveSession();

    } catch (err) {
        updateBotMessage(botId, `Không thể kết nối tới server: ${err.message}`);
    } finally {
        setSending(false);
        scrollToBottom();
        if (detectedWords.length > 0) {
            showWordSuggestions(botId, detectedWords);
        }
    }
}

function showChat() {
    const welcome = document.getElementById('welcome');
    const messages = document.getElementById('chatMessages');
    const composerBottom = document.getElementById('composerBottom');
    if (welcome) welcome.classList.add('hidden');
    if (composerBottom) composerBottom.style.display = '';
    messages.classList.add('visible');
}

function appendMessage(role, content) {
    const wrap = getOrCreateWrap();

    if (role === 'user') {
        const div = document.createElement('div');
        div.className = 'msg-user';
        div.innerHTML = `<div class="msg-bubble">${escapeHtml(content)}</div>`;
        wrap.appendChild(div);
    }

    scrollToBottom();
}

function appendBotTyping() {
    const wrap = getOrCreateWrap();
    const id = 'bot-' + Date.now();
    const div = document.createElement('div');
    div.className = 'msg-bot';
    div.id = id;
    div.innerHTML = `
        <div class="msg-avatar"><i class="ri-graduation-cap-fill"></i></div>
        <div class="msg-bubble">
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    wrap.appendChild(div);
    scrollToBottom();
    return id;
}

function updateBotMessage(id, content) {
    const el = document.getElementById(id);
    if (!el) return;
    const bubble = el.querySelector('.msg-bubble');
    bubble.innerHTML = renderMarkdown(content);
    scrollToBottom();
}

function getOrCreateWrap() {
    const messages = document.getElementById('chatMessages');
    let wrap = messages.querySelector('.message-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'message-wrap';
        messages.appendChild(wrap);
    }
    return wrap;
}

function scrollToBottom() {
    const messages = document.getElementById('chatMessages');
    messages.scrollTop = messages.scrollHeight;
}

function setSending(val) {
    isStreaming = val;
    const btn = document.getElementById('sendBtn');
    btn.disabled = val;
}

// ============================================================
// SESSION HISTORY
// ============================================================

function saveSession() {
    if (history.length === 0) return;

    if (currentSessionIndex === null) {
        sessions.push([...history]);
        currentSessionIndex = sessions.length - 1;
    } else {
        sessions[currentSessionIndex] = [...history];
    }

    localStorage.setItem('chatSessions', JSON.stringify(sessions));
    renderHistory();
}

function renderHistory() {
    const list = document.getElementById('historyList');
    if (sessions.length === 0) {
        list.innerHTML = '<div class="history-empty">Chưa có cuộc trò chuyện nào</div>';
        return;
    }

    list.innerHTML = '';
    for (let i = sessions.length - 1; i >= 0; i--) {
        const session = sessions[i];
        const first = session.find(m => m.role === 'user');
        const title = first ? truncate(first.content, 32) : 'Cuộc trò chuyện';
        const isActive = i === currentSessionIndex;

        const item = document.createElement('div');
        item.className = `history-item ${isActive ? 'active' : ''}`;
        item.innerHTML = `
            <i class="ri-chat-1-line"></i>
            <span class="history-title">${escapeHtml(title)}</span>
            <button class="history-delete" onclick="deleteSession(event, ${i})" title="Xóa cuộc trò chuyện">
                <i class="ri-close-line"></i>
            </button>
        `;
        item.onclick = () => loadSession(i);
        list.appendChild(item);
    }
}

function deleteSession(e, index) {
    e.stopPropagation(); // không trigger loadSession

    sessions.splice(index, 1);
    localStorage.setItem('chatSessions', JSON.stringify(sessions));

    // Nếu đang xem session bị xóa → reset về màn welcome
    if (currentSessionIndex === index) {
        history = [];
        currentSessionIndex = null;

        const messages = document.getElementById('chatMessages');
        messages.innerHTML = '';
        messages.classList.remove('visible');

        const welcome = document.getElementById('welcome');
        if (welcome) welcome.classList.remove('hidden');

        const composerBottom = document.getElementById('composerBottom');
        if (composerBottom) composerBottom.style.display = 'none';

        setRandomTitle();
        const msgInput = document.getElementById('msgInput');
        if (msgInput) { msgInput.value = ''; msgInput.style.height = 'auto'; }

    } else if (currentSessionIndex !== null && index < currentSessionIndex) {
        // Session bị xóa nằm trước session hiện tại → index lùi 1
        currentSessionIndex--;
    }

    renderHistory();
}

function loadSession(index) {
    currentSessionIndex = index;
    history = [...sessions[index]];

    // Clear and rebuild chat
    const messages = document.getElementById('chatMessages');
    messages.innerHTML = '';
    showChat();

    const wrap = document.createElement('div');
    wrap.className = 'message-wrap';
    messages.appendChild(wrap);

    for (const msg of history) {
        if (msg.role === 'user') {
            const div = document.createElement('div');
            div.className = 'msg-user';
            div.innerHTML = `<div class="msg-bubble">${escapeHtml(msg.content)}</div>`;
            wrap.appendChild(div);
        } else if (msg.role === 'assistant') {
            const id = 'bot-' + Date.now() + Math.random();
            const div = document.createElement('div');
            div.className = 'msg-bot';
            div.id = id;
            div.innerHTML = `
                <div class="msg-avatar"><i class="ri-graduation-cap-fill"></i></div>
                <div class="msg-bubble">${renderMarkdown(msg.content)}</div>
            `;
            wrap.appendChild(div);
        }
    }

    renderHistory();
    scrollToBottom();
}

document.getElementById('btnNewChat').onclick = function () {
    if (history.length > 0) {
        saveSession();
    }

    history = [];
    currentSessionIndex = null;

    const messages = document.getElementById('chatMessages');
    messages.innerHTML = '';
    messages.classList.remove('visible');

    const welcome = document.getElementById('welcome');
    if (welcome) welcome.classList.remove('hidden');

    const composerBottom = document.getElementById('composerBottom');
    if (composerBottom) composerBottom.style.display = 'none';

    // Reset title ngẫu nhiên
    setRandomTitle();

    // Focus vào ô input welcome
    const msgInput = document.getElementById('msgInput');
    if (msgInput) { msgInput.value = ''; msgInput.style.height = 'auto'; msgInput.focus(); }

    renderHistory();
    switchTab('chat');
};

// ============================================================
// CEFR ANALYSIS
// ============================================================

function setCEFRExample(btn) {
    document.getElementById('cefrInput').value = btn.textContent.trim();
}

async function analyzeCEFR() {
    const text = document.getElementById('cefrInput').value.trim();
    if (!text) return;

    const output = document.getElementById('cefrOutput');
    output.innerHTML = `
        <div class="loading-overlay">
            <div class="spinner"></div>
            <span>Đang phân tích...</span>
        </div>
    `;

    try {
        const res = await fetch('/api/cefr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        const data = await res.json();

        if (data.error) {
            output.innerHTML = `<div class="cefr-empty"><div class="empty-title">${escapeHtml(data.error)}</div></div>`;
            return;
        }

        const distributionHtml = data.distribution.map(d => `
            <div class="dist-row">
                <div class="dist-label">
                    <span class="cefr-dot" style="background:${d.color}"></span>
                    <span class="cefr-lvl">${d.level}</span>
                    <span class="cefr-name">${d.desc}</span>
                </div>
                <div class="dist-track">
                    <div class="dist-fill" style="width:${d.pct}%;background:${d.color}"></div>
                </div>
                <div class="dist-value">${d.count} · ${d.pct}%</div>
            </div>
        `).join('');

        output.innerHTML = `
            <div class="cefr-result">
                <div class="level-hero" style="--hero-color:${data.vocab_color}">
                    <div class="hero-left">
                        <div class="eyebrow">VOCABULARY PROFILE</div>
                        <div class="hero-level">${data.vocab_level || 'N/A'}</div>
                        <div class="hero-desc">${data.vocab_desc || 'Chưa xác định'}</div>
                        <div class="hero-note">Dựa trên mức trần từ vựng: level cao nhất có ít nhất 2 từ đạt được (bỏ qua từ chức năng).</div>
                    </div>
                    <div class="hero-ring">
                        <span>${data.known_pct}%</span>
                        <small>recognized</small>
                    </div>
                </div>

                <div class="result-section">
                    <div class="section-heading">
                        <h3><i class="ri-bar-chart-2-line"></i> Phân bố CEFR</h3>
                        <p>Phân bố theo số lần xuất hiện của từ.</p>
                    </div>
                    <div class="distribution">${distributionHtml}</div>
                </div>

                <div class="result-section">
                    <div class="section-heading">
                        <h3><i class="ri-markup-line"></i> Văn bản đã phân tích</h3>
                        <p>Click vào từ được tô màu để xem nghĩa tiếng Việt.</p>
                    </div>
                    <div class="highlight-box">${data.highlighted}</div>
                </div>

                <div class="cefr-disclaimer">
                    <i class="ri-information-line"></i>
                    <span><strong>Lưu ý:</strong> Đây là phân tích từ vựng theo CEFR, chưa phải bài đánh giá CEFR đầy đủ cho Reading, Writing, Listening và Speaking.</span>
                </div>
            </div>
        `;

    } catch (err) {
        output.innerHTML = `<div class="cefr-empty"><div class="empty-title">Lỗi kết nối: ${escapeHtml(err.message)}</div></div>`;
    }
}

// ============================================================
// HELPERS
// ============================================================

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '…' : str;
}

function renderMarkdown(text) {
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Code block
    text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    // Heading 3
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    // Heading 2
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    // Heading 1
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // HR
    text = text.replace(/^---$/gm, '<hr>');
    // Unordered list
    text = text.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    // Ordered list
    text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // Paragraph
    text = text.replace(/\n{2,}/g, '</p><p>');
    text = '<p>' + text + '</p>';
    // Line break
    text = text.replace(/\n/g, '<br>');
    // Clean up empty paragraphs
    text = text.replace(/<p>\s*<\/p>/g, '');

    return text;
}
// ============================================================
// CEFR FULL ANALYSIS
// ============================================================

async function analyzeCEFRFull() {
    const text = document.getElementById('cefrInput').value.trim();
    if (!text) return;

    const output = document.getElementById('cefrOutput');
    output.innerHTML = `
        <div class="loading-overlay">
            <div class="spinner"></div>
            <span>Đang đánh giá toàn văn...</span>
        </div>
    `;

    try {
        const res = await fetch('/api/cefr-full', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        const data = await res.json();

        if (data.error) {
            output.innerHTML = `<div class="cefr-empty"><div class="empty-title">${escapeHtml(data.error)}</div></div>`;
            return;
        }

        const g = data.components.grammar;
        const v = data.components.vocabulary;
        const r = data.components.readability;

        const featuresHtml = g.features.map(f =>
            `<span style="background:${g.color}18;border:1px solid ${g.color}40;color:${g.color};
            padding:3px 10px;border-radius:12px;font-size:11px;font-weight:500">${escapeHtml(f)}</span>`
        ).join('');

        output.innerHTML = `
            <div class="cefr-result">

                <div class="level-hero" style="--hero-color:${data.final_color}">
                    <div class="hero-left">
                        <div class="eyebrow">OVERALL CEFR LEVEL</div>
                        <div class="hero-level">${data.final_level}</div>
                        <div class="hero-desc">${data.final_desc}</div>
                        <div class="hero-note">Đánh giá tổng hợp: ngữ pháp, từ vựng và độ phức tạp câu.</div>
                    </div>
                    <div class="hero-ring">
                        <span>${data.final_level}</span>
                        <small>overall</small>
                    </div>
                </div>

                <div class="metric-grid" style="grid-template-columns:repeat(3,1fr);margin-top:14px">
                    <div class="metric-card" style="border-top:3px solid ${g.color}">
                        <div class="metric-value" style="color:${g.color}">${g.level}</div>
                        <div class="metric-label"><i class="ri-code-s-slash-line"></i> Ngữ pháp</div>
                    </div>
                    <div class="metric-card" style="border-top:3px solid ${v.color}">
                        <div class="metric-value" style="color:${v.color}">${v.level}</div>
                        <div class="metric-label"><i class="ri-text"></i> Từ vựng</div>
                    </div>
                    <div class="metric-card" style="border-top:3px solid ${r.color}">
                        <div class="metric-value" style="color:${r.color}">${r.level}</div>
                        <div class="metric-label"><i class="ri-bar-chart-line"></i> Độ phức tạp</div>
                    </div>
                </div>

                <div class="result-section" style="margin-top:16px">
                    <div class="section-heading">
                        <h3><i class="ri-code-s-slash-line"></i> Đặc điểm ngữ pháp phát hiện</h3>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${featuresHtml || '<span style="color:var(--text-muted);font-size:12px">Cấu trúc cơ bản</span>'}</div>
                </div>

                <div class="result-section">
                    <div class="section-heading">
                        <h3><i class="ri-bar-chart-2-line"></i> Thống kê độ phức tạp</h3>
                    </div>
                    <div class="metric-grid" style="grid-template-columns:repeat(3,1fr)">
                        <div class="metric-card">
                            <div class="metric-value">${r.grade}</div>
                            <div class="metric-label"><i class="ri-graduation-cap-line"></i> Grade Level</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${r.avg_sentence_length}</div>
                            <div class="metric-label"><i class="ri-text-wrap"></i> Từ/câu TB</div>
                        </div>
                        <div class="metric-card">
                            <div class="metric-value">${r.avg_syllables}</div>
                            <div class="metric-label"><i class="ri-sound-module-line"></i> Âm tiết/từ TB</div>
                        </div>
                    </div>
                </div>

                <div class="result-section">
                    <div class="section-heading">
                        <h3><i class="ri-scales-line"></i> Trọng số đánh giá</h3>
                    </div>
                    <div class="distribution">
                        <div class="dist-row">
                            <div class="dist-label">
                                <span class="cefr-dot" style="background:${g.color}"></span>
                                <span class="cefr-lvl">Ngữ pháp</span>
                            </div>
                            <div class="dist-track"><div class="dist-fill" style="width:40%;background:${g.color}"></div></div>
                            <div class="dist-value">40%</div>
                        </div>
                        <div class="dist-row">
                            <div class="dist-label">
                                <span class="cefr-dot" style="background:${v.color}"></span>
                                <span class="cefr-lvl">Từ vựng</span>
                            </div>
                            <div class="dist-track"><div class="dist-fill" style="width:35%;background:${v.color}"></div></div>
                            <div class="dist-value">35%</div>
                        </div>
                        <div class="dist-row">
                            <div class="dist-label">
                                <span class="cefr-dot" style="background:${r.color}"></span>
                                <span class="cefr-lvl">Độ phức tạp</span>
                            </div>
                            <div class="dist-track"><div class="dist-fill" style="width:25%;background:${r.color}"></div></div>
                            <div class="dist-value">25%</div>
                        </div>
                    </div>
                </div>

                <div class="cefr-disclaimer">
                    <i class="ri-information-line"></i>
                    <span><strong>Lưu ý:</strong> Đánh giá dựa trên ngữ pháp (spaCy), từ vựng (Zenodo + cefrpy) và độ phức tạp câu (textstat). Không thay thế bài kiểm tra CEFR chính thức.</span>
                </div>

            </div>
        `;

    } catch (err) {
        output.innerHTML = `<div class="cefr-empty"><div class="empty-title">Lỗi: ${escapeHtml(err.message)}</div></div>`;
    }
}

// ============================================================
// WORD SUGGESTIONS (từ chat)
// ============================================================

function showWordSuggestions(botId, words) {
    if (!words || words.length === 0) return;
    const el = document.getElementById(botId);
    if (!el) return;

    const existing = el.querySelector('.word-suggestions');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.className = 'word-suggestions';
    div.style.cssText = `
        margin-top:12px;padding-top:12px;
        border-top:1px solid rgba(255,255,255,0.06);
        display:flex;flex-wrap:wrap;gap:8px;align-items:center;
    `;

    const label = document.createElement('span');
    label.style.cssText = 'font-size:11px;color:#4a5568;font-weight:600;width:100%;margin-bottom:2px';
    label.textContent = 'Từ khó phát hiện trong câu hỏi:';
    div.appendChild(label);

    words.forEach(w => {
        const alreadySaved = savedWords.some(s => s.lemma === w.lemma);
        const chip = document.createElement('div');
        chip.style.cssText = `
            display:inline-flex;align-items:center;gap:8px;
            background:${w.color}18;border:1px solid ${w.color}40;
            border-radius:10px;padding:6px 12px;font-size:13px;
        `;
        chip.innerHTML = `
            <span style="color:${w.color};font-weight:600">${escapeHtml(w.word)}</span>
            <span style="color:${w.color};opacity:0.7;font-size:11px">${w.level}</span>
            <button
                onclick="saveWordFromChat('${escapeHtml(w.word)}','${escapeHtml(w.lemma)}','${w.level}','${w.color}','${escapeHtml(w.desc)}',this)"
                style="background:${alreadySaved ? 'transparent' : w.color};
                       color:${alreadySaved ? w.color : 'white'};
                       border:1px solid ${w.color};border-radius:6px;
                       padding:3px 8px;font-size:11px;cursor:pointer;font-weight:500"
                ${alreadySaved ? 'disabled' : ''}
            >${alreadySaved ? '✓ Đã lưu' : '+ Lưu'}</button>
        `;
        div.appendChild(chip);
    });

    el.querySelector('.msg-bubble').appendChild(div);
    scrollToBottom();
}

function saveWordFromChat(word, lemma, level, color, desc, btn) {
    if (!isLoggedIn()) { showAuthModal(); return; }
    if (savedWords.some(s => s.lemma === lemma)) return;
    savedWords.push({ word, lemma, level, color, desc, savedAt: Date.now() });
    persistSavedWords();
    btn.textContent = '✓ Đã lưu';
    btn.style.background = 'transparent';
    btn.style.color = color;
    btn.disabled = true;
    updateBookmarkCount();
    renderSavedWordsPanel();
}

// ============================================================
// BOOKMARK PANEL
// ============================================================

function toggleBookmarkPanel() {
    if (!isLoggedIn()) { showAuthModal(); return; }
    const panel = document.getElementById('savedWordsPanel');
    const backdrop = document.getElementById('swpBackdrop');
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
        panel.classList.remove('open');
        backdrop.classList.remove('open');
    } else {
        renderSavedWordsPanel();
        panel.classList.add('open');
        backdrop.classList.add('open');
    }
}

function updateBookmarkCount() {
    const badge = document.getElementById('bookmarkCount');
    if (!badge) return;
    if (savedWords.length > 0) {
        badge.textContent = savedWords.length;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function renderSavedWordsPanel() {
    const list = document.getElementById('savedWordsList');
    if (!list) return;

    if (savedWords.length === 0) {
        list.innerHTML = `
            <div class="swp-empty">
                <i class="ri-bookmark-line"></i>
                <p>Chưa có từ nào được lưu</p>
                <span>Lưu từ khó từ chat hoặc từ tooltip khi phân tích CEFR</span>
            </div>`;
        return;
    }

    // Sắp xếp mới nhất lên trên
    const sorted = [...savedWords].sort((a, b) => b.savedAt - a.savedAt);

    list.innerHTML = sorted.map((w, i) => `
        <div class="swp-word-card" style="--card-color:${w.color}">
            <div class="swp-word-top">
                <span class="swp-word">${escapeHtml(w.word)}</span>
                <span class="swp-level" style="color:${w.color}">${escapeHtml(w.level)}</span>
                <button class="swp-delete" onclick="deleteWord('${escapeHtml(w.lemma)}')" title="Xóa">
                    <i class="ri-delete-bin-line"></i>
                </button>
            </div>
            ${w.desc ? `<div class="swp-desc">${escapeHtml(w.desc)}</div>` : ''}
            <div class="swp-audio">
                <button onclick="playAudio('${escapeHtml(w.lemma || w.word)}','us')" class="tip-audio-btn" title="Giọng Mỹ">🇺🇸</button>
                <button onclick="playAudio('${escapeHtml(w.lemma || w.word)}','gb')" class="tip-audio-btn" title="Giọng Anh">🇬🇧</button>
            </div>
        </div>
    `).join('');
}

function deleteWord(lemma) {
    savedWords = savedWords.filter(w => w.lemma !== lemma);
    persistSavedWords();
    removeSavedWordServer(lemma);
    updateBookmarkCount();
    renderSavedWordsPanel();
}

function saveWordFromTooltip(word, lemma, level, color, desc, btn, isStar) {
    if (!isLoggedIn()) { showAuthModal(); return; }
    if (savedWords.some(s => s.lemma === lemma)) return;
    const extra = window._readingSaveCtx || {};
    window._readingSaveCtx = null;
    savedWords.push({ word, lemma, level: level || '?', color, desc, savedAt: Date.now(), ...extra });
    persistSavedWords();
    if (isStar) {
        // Nút sao trên popup trắng: đổi sang sao vàng đầy
        btn.innerHTML = '<i class="ri-star-fill"></i>';
        btn.classList.add('starred');
        btn.title = 'Đã lưu';
    } else {
        btn.innerHTML = '<i class="ri-bookmark-fill"></i> Đã lưu';
        btn.classList.add('saved');
        btn.disabled = true;
    }
    updateBookmarkCount();
    renderSavedWordsPanel();
    // Nếu lưu từ module bài đọc: refresh highlight + tab Từ vựng
    if (extra.source === 'reading' && typeof renderReadingParas === 'function') {
        renderReadingParas();
        updateReadingVocabBadge();
        if (typeof readingTab !== 'undefined' && readingTab === 'vocab') renderReadingTab();
    }
}

// ============================================================
// PRONUNCIATION
// ============================================================

// Đọc bằng giọng tích hợp của trình duyệt (dùng cho cụm từ và khi không có file phát âm)
function speakTTS(text) {
    try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US'; u.rate = 0.9;
        speechSynthesis.speak(u);
    } catch (e) {}
}

function playAudio(word, accent) {
    const w = (word || '').toLowerCase().trim();
    if (!w) return;
    // 10/10/2026: cụm từ (có dấu cách) không có file phát âm Oxford/MW ->
    // dùng TTS của trình duyệt, tức thì, offline vẫn chạy.
    if (/\s/.test(w)) { speakTTS(word); return; }
    let fellBack = false;
    const useTTS = () => { if (!fellBack) { fellBack = true; speakTTS(word); } };
    const url = `https://ssl.gstatic.com/dictionary/static/sounds/oxford/${w}--_${accent}_1.mp3`;
    const audio = new Audio(url);
    audio.onerror = () => {
        // Fallback: thử Merriam-Webster, hết cách thì TTS (không im lặng)
        const fallback = `https://media.merriam-webster.com/audio/prons/en/us/mp3/${w[0]}/${w}.mp3`;
        const audio2 = new Audio(fallback);
        audio2.onerror = useTTS;
        audio2.play().catch(useTTS);
    };
    audio.play().catch(useTTS);
}

// ============================================================
// WORD TOOLTIP
// ============================================================

let _tipEl = null;
let _tipTimer = null;

function getTip() {
    if (!_tipEl) {
        _tipEl = document.createElement('div');
        _tipEl.className = 'word-tooltip';
        document.body.appendChild(_tipEl);
        _tipEl.addEventListener('mouseenter', () => clearTimeout(_tipTimer));
        _tipEl.addEventListener('mouseleave', hideTip);
    }
    return _tipEl;
}

function showTip(anchor, word, lemma, nextWords) {
    clearTimeout(_tipTimer);
    const tip = getTip();
    // 10/10/2026: seq chống race — bấm 2 từ liên tiếp thì kết quả async của từ
    // cũ (nghĩa/đồng nghĩa/ví dụ) không được đè lên tooltip của từ mới.
    const seq = tip._seq = (tip._seq || 0) + 1;
    tip._anchor = anchor;
    tip.innerHTML = '<div class="tip-loading"><div class="spinner-sm"></div><span>Đang tra...</span></div>';
    tip.classList.add('visible');
    positionTip();

    fetchMeaning(word, lemma, tip, nextWords, seq);
}

// Phrasal verb (08/10/2026): tập tiểu từ/giới từ để nhận biết cụm động từ.
// Chỉ thử tra cụm khi từ KẾ TIẾP là tiểu từ — tránh gọi API thừa cho từ đơn.
const PHRASAL_PARTICLES = new Set([
    'up','down','out','off','in','on','away','back','over','through','about',
    'along','around','forward','behind','aside','together','apart','across',
    'ahead','forth','onto','into','after','for','with','at','by','upon','to','of',
    'oneself','itself','himself','herself','themselves','it'
]);

// Lấy tối đa n từ đơn KẾ TIẾP cùng cấp DOM (dùng cho longest-match cụm từ)
function nextWordsOf(el, n, cls) {
    const out = [];
    let s = el ? el.nextElementSibling : null;
    while (s && out.length < n) {
        if (s.classList && s.classList.contains(cls) && s.dataset.w) out.push(s.dataset.w);
        s = s.nextElementSibling;
    }
    return out;
}

// Đặt vị trí tooltip: ưu tiên bên dưới từ, tự lật lên trên nếu không đủ chỗ
function positionTip() {
    const tip = getTip();
    const anchor = tip._anchor;
    if (!anchor) return;

    const gap = 6;
    const maxH = 380; // khớp max-height trong CSS
    const rect = anchor.getBoundingClientRect();

    tip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 340)) + 'px';
    tip.style.top = (rect.bottom + window.scrollY + gap) + 'px';

    const tipH = Math.min(tip.offsetHeight || maxH, maxH);
    if (rect.bottom + tipH + gap > window.innerHeight && rect.top - tipH - gap > 8) {
        tip.style.top = (rect.top + window.scrollY - tipH - gap) + 'px';
    }
}

function hideTip() {
    _tipTimer = setTimeout(() => {
        if (_tipEl) _tipEl.classList.remove('visible');
    }, 200);
}
function hideTipNow() {
    clearTimeout(_tipTimer);
    if (_tipEl) _tipEl.classList.remove('visible');
}

async function fetchWordPayload(word, lemma) {
    const res = await fetch('/api/word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, lemma })
    });
    return res.json();
}

async function fetchMeaning(word, lemma, tip, nextWords, seq) {
    try {
        // Longest-match phrasal verb (08/10/2026): bấm "give" trong "give up"
        // -> thử tra "give up" TRƯỚC, trúng thì dùng; không thì tra từ đơn như cũ.
        let data = null;
        const w1 = (word || '').toLowerCase().replace(/[^a-z']/g, '');
        const nw0 = ((nextWords || [])[0] || '').toLowerCase().replace(/[^a-z']/g, '');
        if (w1 && PHRASAL_PARTICLES.has(nw0)) {
            try {
                const d = await fetchWordPayload(w1 + ' ' + nw0, w1 + ' ' + nw0);
                if (d && d.found && d.meanings && d.meanings.length) data = d;
            } catch (e) { /* rớt xuống tra từ đơn */ }
        }
        if (!data) data = await fetchWordPayload(word, lemma);
        if (tip._seq !== seq) return; // đã bấm sang từ khác — bỏ kết quả cũ

        if (!data.found || !data.meanings?.length) {
            tip.innerHTML = `<div class="tip-notfound">Không tìm thấy <strong>${escapeHtml(word)}</strong></div>`;
            return;
        }

        // Từ biến thể (hands/grew) -> hiện từ GỐC làm tiêu đề như popup từ điển
        const isInflected = data.lemma && data.lemma !== data.word.toLowerCase();
        const titleWord = isInflected ? data.lemma : data.word;
        const lemmaKey = data.lemma || data.word.toLowerCase();
        const meanings = data.meanings || [];
        // Nghĩa đầu của nhóm POS đầu -> dùng làm mô tả khi lưu từ
        const _fd = meanings[0]?.definitions?.[0];
        const firstDef = (typeof _fd === 'object' ? _fd?.text : _fd) || '';
        // Map loại từ -> class màu badge (khớp CSS tip-pos-pill)
        const POS_CLASS = {
            'Danh từ': 'c-danh', 'Động từ': 'c-dong', 'Tính từ': 'c-tinh',
            'Trạng từ': 'c-trang', 'Mạo từ': 'c-mao', 'Giới từ': 'c-gioi',
            'Đại từ': 'c-dai', 'Liên từ': 'c-lien', 'Thán từ': 'c-than',
            'Trợ động từ': 'c-tro', 'Số từ': 'c-so', 'Định từ': 'c-dinh',
            'cụm động từ': 'c-dong'  // phrasal verb: dùng màu động từ (08/10/2026)
        };
        const posClass = (pos) => POS_CLASS[pos] || 'c-khac';

        // Badge POS cho từng vai trò của từ (vd "the": Mạo từ + Trạng từ).
        // 10/10/2026: nhóm không rõ loại từ (pos rỗng) thì ẩn badge, không hiện "?".
        const badgesHtml = meanings.filter(m => m.pos).map(m =>
            `<span class="tip-pos-pill ${posClass(m.pos)}">${escapeHtml(m.pos)}</span>`
        ).join('');

        // Nghĩa gom theo từng loại từ — nhãn teal như popup mẫu
        const groupsHtml = meanings.map(m => {
            const defs = m.definitions || [];
            if (!defs.length) return '';
            return `
            <div class="tip-group">
                ${m.pos ? `<div class="tip-group-label">${escapeHtml(m.pos)}</div>` : ''}
                <ul class="tip-group-defs">
                    ${defs.map(d => {
                        const txt = typeof d === 'object' ? d.text : d;
                        const rare = typeof d === 'object' && d.rare;
                        return `<li>${escapeHtml(txt)}${rare ? ' <span class="tip-rare-badge">hiếm</span>' : ''}</li>`;
                    }).join('')}
                </ul>
            </div>`;
        }).join('');

        const alreadySaved = savedWords.some(s => s.lemma === lemmaKey);

        tip.innerHTML = `
            <div class="tip-header">
                ${isInflected ? `<span class="tip-infl">${escapeHtml(data.word)} →</span>` : ''}
                <span class="tip-word">${escapeHtml(titleWord)}</span>
                <div class="tip-icons">
                    <button class="tip-icon-btn" onclick="playAudio('${escapeHtml(lemmaKey)}','us')" title="Nghe phát âm"><i class="ri-volume-up-line"></i></button>
                    <button class="tip-icon-btn ${alreadySaved ? 'starred' : ''}" id="tipStarBtn" title="${alreadySaved ? 'Đã lưu' : 'Lưu từ này'}"
                        onclick="saveWordFromTooltip('${escapeHtml(titleWord)}','${escapeHtml(lemmaKey)}','${escapeHtml(data.cefr || '')}','#6366f1','${escapeHtml(firstDef)}',this,true)"><i class="ri-star-${alreadySaved ? 'fill' : 'line'}"></i></button>
                    <button class="tip-icon-btn" onclick="hideTipNow()" title="Đóng"><i class="ri-close-line"></i></button>
                </div>
            </div>
            <div class="tip-sub">
                ${data.ipa ? `<span class="tip-ipa">/${escapeHtml(data.ipa.replace(/^\/|\/$/g, ''))}/</span>` : ''}
                ${data.cefr ? `<span class="tip-cefr-badge">${escapeHtml(data.cefr)}</span>` : ''}
            </div>
            ${badgesHtml ? `<div class="tip-pos-badges">${badgesHtml}</div>` : ''}
            ${groupsHtml ? `<div class="tip-groups">${groupsHtml}</div>` : ''}`;
        // Đồng nghĩa/trái nghĩa (WordNet) + kết hợp từ (SyntagNet) + câu ví dụ (Tatoeba)
        loadTipExtras(lemmaKey, tip, seq);
    } catch (err) {
        tip.innerHTML = `<div class="tip-notfound">Lỗi: ${escapeHtml(err.message)}</div>`;
    } finally {
        // Nội dung đã render xong → đo lại chiều cao thật để đặt vị trí chuẩn
        positionTip();
    }
}

// Đồng nghĩa / trái nghĩa (WordNet) + kết hợp từ (SyntagNet) + câu ví dụ (Tatoeba).
// Chạy nền sau khi tooltip chính đã hiện; im lặng nếu lỗi hoặc tip đã đóng.
async function loadTipExtras(lemmaKey, tip, seq) {
    const word = (lemmaKey || '').toLowerCase().trim();
    if (!word) return;
    try {
        const [relRes, sentRes, colRes] = await Promise.all([
            fetch('/api/word-relations?word=' + encodeURIComponent(word)).then(r => r.json()).catch(() => null),
            fetch('/api/example-sentences?word=' + encodeURIComponent(word) + '&count=3').then(r => r.json()).catch(() => null),
            fetch('/api/collocations?word=' + encodeURIComponent(word)).then(r => r.json()).catch(() => null),
        ]);
        if (tip._seq !== seq || !tip.isConnected) return;
        let html = '';
        const rel = relRes || {};
        const chipRow = (items) => (items || []).map(it =>
            `<span class="tip-rel-chip">${escapeHtml(it.word)}${it.vi ? `<small>${escapeHtml(it.vi)}</small>` : ''}</span>`
        ).join('');
        if (rel.synonyms && rel.synonyms.length) {
            html += `<div class="tip-extra"><div class="tip-extra-label">Đồng nghĩa</div><div class="tip-rel-row">${chipRow(rel.synonyms)}</div></div>`;
        }
        if (rel.antonyms && rel.antonyms.length) {
            html += `<div class="tip-extra"><div class="tip-extra-label">Trái nghĩa</div><div class="tip-rel-row">${chipRow(rel.antonyms)}</div></div>`;
        }
        // Kết hợp từ (SyntagNet, CC BY-NC-SA 4.0) — 08/10/2026
        const cols = (colRes && colRes.collocations) || [];
        if (cols.length) {
            html += `<div class="tip-extra"><div class="tip-extra-label">Kết hợp từ</div><div class="tip-rel-row">${chipRow(cols)}</div>` +
                `<div class="tip-source">Nguồn collocations: SyntagNet (CC BY-NC-SA 4.0)</div></div>`;
        }
        const pairs = (sentRes && sentRes.pairs) || [];
        if (pairs.length) {
            html += `<div class="tip-extra"><div class="tip-extra-label">Câu ví dụ</div>` +
                pairs.map(p => `<div class="tip-sent"><div class="tip-sent-en">${escapeHtml(p.en)}</div><div class="tip-sent-vi">${escapeHtml(p.vi)}</div></div>`).join('') +
                `<div class="tip-source">Nguồn câu ví dụ: Tatoeba (CC-BY)</div></div>`;
        }
        if (html) {
            tip.insertAdjacentHTML('beforeend', html);
            positionTip();
        }
    } catch (e) { /* tooltip chính vẫn hiện bình thường */ }
}

// Click vào word-chip → hiện tooltip
document.addEventListener('click', function(e) {
    const chip = e.target.closest('.word-chip');
    if (chip) {
        const word  = chip.dataset.word  || chip.childNodes[0]?.textContent?.trim() || '';
        const lemma = chip.dataset.lemma || word;
        showTip(chip, word, lemma, nextWordsOf(chip, 1, 'word-chip'));
        return;
    }
    if (_tipEl && !_tipEl.contains(e.target)) {
        _tipEl.classList.remove('visible');
    }
});

// ============================================================
// COMPOSER BOTTOM (khi đang chat)
// ============================================================

function handleKeydownBottom(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessageBottom(); }
}

function sendMessageBottom() {
    const input = document.getElementById('msgInputBottom');
    if (!input) return;
    // Chuyển value sang msgInput rồi gọi sendMessage
    document.getElementById('msgInput').value = input.value;
    input.value = '';
    input.style.height = 'auto';
    sendMessage();
}

// Sync autoResize cho cả 2 textarea
document.addEventListener('DOMContentLoaded', function() {
    const bottom = document.getElementById('msgInputBottom');
    if (bottom) {
        bottom.addEventListener('input', function() { autoResize(this); });
    }

    // Focus welcome input khi load
    const top = document.getElementById('msgInput');
    if (top) setTimeout(() => top.focus(), 100);
});

// ============================================================
// FLASHCARD
// ============================================================

let flashDeck = [];               // [{word, lemma, level, color, ipa, meanings, desc, detailLoaded}]
let flashDeckName = 'Bộ thẻ';       // tên bộ thẻ hiện tại (hiện trong modal chọn cách học)
let flashIdx = 0;
let flashLevel = 'B2';
let flashGrades = {};             // idx -> true (đã thuộc) / false (chưa thuộc)
const flashExampleCache = {};     // word.lower() -> example string | null

// ============================================================
// ============================================================
// TRANG CHỦ (06/10/2026)
// ============================================================
let rvData = null;

function refreshHomeTab() {
    const h = new Date().getHours();
    const greet = h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
    document.getElementById('homeGreetTitle').textContent = greet;
    const days = ['Chủ nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
    const d = new Date();
    const ds = String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
    document.getElementById('homeGreetDate').textContent = days[d.getDay()] + ', ' + ds + ' — hôm nay học gì nào?';
    renderHomeStats();
    if (!window._rvLoaded) loadRandomVocab();
}

function renderHomeStats() {
    const box = document.getElementById('homeStats');
    if (!box) return;
    const arr = (typeof getProgress === 'function') ? getProgress() : [];
    const total = arr.length;
    const avg = total ? Math.round(arr.reduce((s, r) => s + (r.total ? r.score / r.total : 0), 0) / total * 100) : 0;
    const days = new Set(arr.map(r => (r.date || '').slice(0, 10)).filter(Boolean)).size;
    const best = total ? Math.max.apply(null, arr.map(r => r.total ? Math.round(r.score / r.total * 100) : 0)) : 0;
    const items = [
        { n: total, l: 'Bài đã làm' },
        { n: avg + '%', l: 'Điểm trung bình' },
        { n: days, l: 'Ngày đã học' },
        { n: best + '%', l: 'Điểm cao nhất' },
    ];
    box.innerHTML = items.map(i =>
        '<div class="home-stat"><div class="n">' + i.n + '</div><div class="l">' + i.l + '</div></div>').join('');
}

async function loadRandomVocab() {
    try {
        const res = await fetch('/api/random-vocab');
        const d = await res.json();
        if (d.error || !d.word) throw new Error(d.error || 'empty');
        rvData = d;
        window._rvLoaded = true;
        const wEl = document.getElementById('rvWord');
        wEl.textContent = d.word;
        wEl.style.color = d.color || '#4f46e5';
        const cefr = document.getElementById('rvCefr');
        cefr.style.display = ''; cefr.textContent = d.level || '';
        setPosBadge(document.getElementById('rvPos'), d.pos || '');
        document.getElementById('rvIpa').textContent = d.ipa ? '/' + d.ipa + '/' : '';
        document.getElementById('rvMeaning').textContent = d.meaning || '';
        const ex = document.getElementById('rvExample');
        if (d.example_en) {
            ex.style.display = '';
            ex.innerHTML = '<div class="rv-ex-en">' + highlightWord(d.example_en, d.word) + '</div>' +
                (d.example_vi ? '<div class="rv-ex-vi">' + escapeHtml(d.example_vi) + '</div>' : '');
        } else ex.style.display = 'none';
        const sb = document.getElementById('rvSaveBtn');
        sb.classList.remove('saved');
        sb.innerHTML = '<i class="ri-bookmark-line"></i> Lưu từ';
    } catch (e) {
        document.getElementById('rvMeaning').textContent = 'Không tải được từ mới. Bấm "Từ khác" để thử lại.';
    }
}

function showRvDetail(e) {
    if (e) e.stopPropagation();
    if (!rvData) return;
    showTip(document.getElementById('rvWord'), rvData.word, rvData.word);
}

function saveRandomVocab() {
    if (!isLoggedIn()) { showAuthModal(); return; }
    if (!rvData) return;
    const lemma = rvData.word.toLowerCase();
    if (!savedWords.some(s => (s.lemma || '').toLowerCase() === lemma)) {
        savedWords.push({ word: rvData.word, lemma: lemma, level: rvData.level || '?',
            color: rvData.color || '#6366f1', desc: rvData.meaning || '', savedAt: Date.now() });
        persistSavedWords();
    }
    const sb = document.getElementById('rvSaveBtn');
    sb.classList.add('saved');
    sb.innerHTML = '<i class="ri-bookmark-check-line"></i> Đã lưu';
    const c = document.getElementById('flashSavedCount');
    if (c) c.textContent = savedWords.length;
}

// FLASHCARD BROWSE: de xuat + chu de (06/10/2026)
// ============================================================

let deckGroup = null;
let lastDeckRebuild = null; // hàm build lại deck để "Học tiếp từ mới"
let lastDeckUrl = null; // URL API để tải thêm từ mới (append)

// Metadata the hien thi. total = so tu that trong data (06/10/2026).
const DECK_META = [
    { id: "oxford-3000", section: "suggest", title: "Oxford 3000",
      desc: "3000 từ tiếng Anh cốt lõi quan trọng nhất, xếp theo cấp độ CEFR.",
      icon: "ri-book-2-line", bg: "#e0f2fe", fg: "#0369a1", level: "A1-B2", total: 2967 },
    { id: "oxford-5000", section: "suggest", title: "Oxford 5000 nâng cao",
      desc: "2000 từ mở rộng ngoài Oxford 3000, dành cho trình độ cao.",
      icon: "ri-rocket-line", bg: "#ede9fe", fg: "#6d28d9", level: "B2-C1", total: 1988 },
    { id: "toeic-300-450", section: "suggest", title: "TOEIC 300–450",
      desc: "Từ vựng TOEIC mục tiêu 300-450 (CEFR A2), có ví dụ song ngữ.",
      icon: "ri-briefcase-line", bg: "#d1fae5", fg: "#047857", level: "A2", total: 596 },
    { id: "toeic-450-650", section: "suggest", title: "TOEIC 450–650",
      desc: "Từ vựng TOEIC mục tiêu 450-650 (CEFR B1), có ví dụ song ngữ.",
      icon: "ri-briefcase-2-line", bg: "#fef3c7", fg: "#b45309", level: "B1", total: 297 },
    { id: "toeic-650-800", section: "suggest", title: "TOEIC 650–800",
      desc: "Từ vựng TOEIC mục tiêu 650-800 (CEFR B2), có ví dụ song ngữ.",
      icon: "ri-briefcase-3-line", bg: "#ede9fe", fg: "#6d28d9", level: "B2", total: 300 },
    { id: "idiom", section: "suggest", title: "Thành ngữ IELTS",
      desc: "300 thành ngữ thông dụng cho IELTS Speaking.",
      icon: "ri-sparkling-line", bg: "#fef3c7", fg: "#b45309", level: "B2", total: 300 },
    { id: "topic:du-lich", section: "topic", title: "Du lịch",
      desc: "Từ vựng chủ đề du lịch, giao thông, khách sạn.",
      icon: "ri-plane-line", bg: "#e0f2fe", fg: "#0369a1", level: "A1-C1", total: 101 },
    { id: "topic:kinh-doanh", section: "topic", title: "Kinh doanh",
      desc: "Từ vựng chủ đề kinh doanh, công sở, tài chính.",
      icon: "ri-briefcase-line", bg: "#fef3c7", fg: "#b45309", level: "A1-C1", total: 217 },
    { id: "topic:doi-song", section: "topic", title: "Đời sống hằng ngày",
      desc: "Từ vựng gia đình, nhà cửa, quần áo, đồ dùng.",
      icon: "ri-home-smile-line", bg: "#ecfccb", fg: "#4d7c0f", level: "A1-C1", total: 353 },
    { id: "topic:cong-nghe", section: "topic", title: "Công nghệ",
      desc: "Từ vựng máy tính, internet, công nghệ.",
      icon: "ri-computer-line", bg: "#ede9fe", fg: "#6d28d9", level: "A1-C1", total: 107 },
    { id: "topic:suc-khoe", section: "topic", title: "Sức khỏe",
      desc: "Từ vựng sức khỏe, y tế, cơ thể.",
      icon: "ri-heart-pulse-line", bg: "#fee2e2", fg: "#b91c1c", level: "A1-C1", total: 165 },
    { id: "topic:am-thuc", section: "topic", title: "Ẩm thực",
      desc: "Từ vựng đồ ăn, nấu nướng, thức uống.",
      icon: "ri-restaurant-line", bg: "#ffedd5", fg: "#c2410c", level: "A1-C1", total: 150 },
    { id: "topic:giao-duc", section: "topic", title: "Giáo dục",
      desc: "Từ vựng trường học, học tập, giáo dục.",
      icon: "ri-graduation-cap-line", bg: "#e0e7ff", fg: "#4338ca", level: "A1-C1", total: 105 },
    { id: "topic:moi-truong", section: "topic", title: "Môi trường",
      desc: "Từ vựng môi trường, thiên nhiên, khí hậu.",
      icon: "ri-earth-line", bg: "#dcfce7", fg: "#15803d", level: "A1-C1", total: 126 },
];

function getTopicProgress() {
    try { return JSON.parse(localStorage.getItem('topicProgress') || '{}'); }
    catch (e) { return {}; }
}
function markTopicKnown(groupId, word) {
    if (!groupId || !word) return;
    const p = getTopicProgress();
    const g = p[groupId] || { known: [] };
    if (!g.known.includes(word)) g.known.push(word);
    p[groupId] = g;
    try { localStorage.setItem('topicProgress', JSON.stringify(p)); } catch (e) {}
    // Đồng bộ server khi đã đăng nhập (08/10/2026)
    if (isLoggedIn()) {
        fetch('/api/user/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ group: groupId, word })
        }).catch(() => {});
    }
}

function renderBrowse() {
    const prog = getTopicProgress();
    const card = (m) => {
        let known = (prog[m.id] && prog[m.id].known) || [];
        // Oxford: cộng dồn tiến độ từ các level con (oxford-3000:A1, ...)
        if ((m.id === 'oxford-3000' || m.id === 'oxford-5000') && !known.length) {
            known = [];
            for (const k of Object.keys(prog)) {
                if (k.startsWith(m.id + ':') && prog[k].known) {
                    for (const w of prog[k].known) if (!known.includes(w)) known.push(w);
                }
            }
        }
        const pct = m.total ? Math.min(100, Math.round(known.length / m.total * 100)) : 0;
        return `<div class="deck-card" data-deck="${m.id}">` +
            `<div class="deck-illus" style="background:${m.bg}"><i class="${m.icon}" style="color:${m.fg}"></i></div>` +
            `<div class="deck-body"><h4>${escapeHtml(m.title)}</h4><p>${escapeHtml(m.desc)}</p>` +
            `<div class="deck-meta"><span class="deck-pct">${pct}% đã học</span>` +
            `<span class="deck-lv">${m.level}</span>` +
            `<span class="deck-count">${m.total} từ</span></div>` +
            `<div class="deck-bar"><div style="width:${pct}%"></div></div></div></div>`;
    };
    document.getElementById('deckGrid').innerHTML =
        DECK_META.filter(m => m.section === 'suggest').map(card).join('');
    document.getElementById('topicCarousel').innerHTML =
        DECK_META.filter(m => m.section === 'topic').map(card).join('');
    document.querySelectorAll('.deck-card').forEach(el => {
        el.addEventListener('click', () => buildDeckById(el.dataset.deck));
    });
}

function showBrowse() {
    document.removeEventListener('keydown', deepKeyHandler);
    document.getElementById('flashDeck').style.display = 'none';
    document.getElementById('flashSummary').style.display = 'none';
    document.getElementById('flashEmpty').style.display = 'none';
    const _dw = document.getElementById('deepWrap');
    if (_dw) _dw.style.display = 'none';
    hideOxfordDetailSilent();
    document.getElementById('flashBrowse').style.display = '';
    renderBrowse();
}

function buildDeckById(id) {
    if (id === 'oxford-3000') return showOxfordDetail('3000');
    if (id === 'oxford-5000') return showOxfordDetail('5000');
    if (id === 'toeic-300-450') return buildToeicBandDeck('300-450');
    if (id === 'toeic-450-650') return buildToeicBandDeck('450-650');
    if (id === 'toeic-650-800') return buildToeicBandDeck('650-800');
    if (id === 'idiom') return buildIdiomDeck();
    if (id.startsWith('topic:')) return buildTopicDeck(id.slice(6));
}

function scrollTopics(dir) {
    document.getElementById('topicCarousel').scrollBy({ left: dir * 500, behavior: 'smooth' });
}
function toggleAllTopics() {
    const c = document.getElementById('topicCarousel');
    c.classList.toggle('expanded');
    document.getElementById('browseAllBtn').textContent =
        c.classList.contains('expanded') ? 'Thu gọn' : 'Xem tất cả';
}
function toggleRandomPanel() {
    const p = document.getElementById('flashRandomPanel');
    p.style.display = p.style.display === 'none' ? '' : 'none';
}

function mapDeckWords(words) {
    return words.map(w => ({
        word: w.word, lemma: w.word,
        level: w.level, color: w.color || '#6366f1',
        ipa: w.ipa || '', meanings: w.meanings || [], desc: '',
        topic: w.topic || '',
        // 10/10/2026: ví dụ ưu tiên preset > Tatoeba nhét sẵn từ server;
        // thẻ nào cũng có ví dụ ngay khi tạo bộ, không fetch từng thẻ.
        presetExample: w.example_en ? { en: w.example_en, vi: w.example_vi }
            : (w.tatoeba_en ? { en: w.tatoeba_en, vi: w.tatoeba_vi, tatoeba: true } : null),
        detailLoaded: true,
    }));
}

async function buildOxfordDeck(source, level = '') {
    lastDeckRebuild = () => buildOxfordDeck(source, level);
    hideOxfordDetailSilent();
    showFlashEmpty('deck', 'Đang tạo bộ thẻ...', '');
    try {
        const lvParam = level ? `&level=${level}` : '';
        lastDeckUrl = `/api/oxford-deck?source=${source}&count=15${lvParam}`;
        const res = await fetch(lastDeckUrl);
        const data = await res.json();
        if (data.error || !data.words?.length) {
            showFlashEmpty('deck', 'Không tạo được bộ thẻ', data.error || 'Thử lại sau.');
            return;
        }
        flashDeck = mapDeckWords(data.words);
        deckGroup = level ? `oxford-${source}:${level}` : `oxford-${source}`;
        flashDeckName = 'Oxford ' + source + (level ? ' - ' + level : '');
        startDeck();
    } catch (err) {
        showFlashEmpty('deck', 'Lỗi kết nối', 'Không tải được từ mới. Kiểm tra server rồi thử lại.');
    }
}

const OXFORD_LEVEL_NAMES = {
    'A1': 'Beginner', 'A2': 'Elementary', 'B1': 'Intermediate',
    'B2': 'Upper-Intermediate', 'C1': 'Advanced'
};
const OXFORD_META = {
    '3000': { title: 'Oxford 3000', desc: '3000 từ tiếng Anh cốt lõi quan trọng nhất, xếp theo cấp độ CEFR.', icon: 'ri-book-line' },
    '5000': { title: 'Oxford 5000 nâng cao', desc: '2000 từ mở rộng ngoài Oxford 3000, dành cho trình độ B2-C1.', icon: 'ri-star-line' }
};
let oxfordDetailSource = '3000';
let oxfordDetailLevels = [];
// 12/10/2026: cache levels theo source — khởi tạo từ dữ liệu server nhúng sẵn
// (window.__OXFORD_PRELOAD__) nên lần đầu bấm vào cũng thấy ngay, không "Đang tải..."
let oxfordLevelsCache = (window.__OXFORD_PRELOAD__ && typeof window.__OXFORD_PRELOAD__ === 'object')
    ? window.__OXFORD_PRELOAD__ : {};

async function showOxfordDetail(source) {
    oxfordDetailSource = source;
    const meta = OXFORD_META[source];
    document.getElementById('flashBrowse').style.display = 'none';
    document.getElementById('flashEmpty').style.display = 'none';
    document.getElementById('flashDeck').style.display = 'none';
    document.getElementById('flashSummary').style.display = 'none';
    const det = document.getElementById('oxfordDetail');
    det.style.display = '';
    document.getElementById('oxdTitle').textContent = meta.title;
    document.getElementById('oxdDesc').textContent = meta.desc;
    document.getElementById('oxdIcon').className = meta.icon;
    // 12/10/2026: có cache thì hiện ngay, không fetch lại
    if (oxfordLevelsCache[source]) {
        oxfordDetailLevels = oxfordLevelsCache[source].levels;
        renderOxfordDetail(oxfordLevelsCache[source]);
        return;
    }
    document.getElementById('oxdLevels').innerHTML =
        '<div class="oxd-loading">Đang tải...</div>';
    try {
        const res = await fetch(`/api/oxford-levels?source=${source}`);
        const data = await res.json();
        if (data.error || !data.levels?.length) {
            document.getElementById('oxdLevels').innerHTML =
                '<div class="oxd-loading">Không tải được dữ liệu.</div>';
            return;
        }
        oxfordLevelsCache[source] = data;
        oxfordDetailLevels = data.levels;
        renderOxfordDetail(data);
    } catch (err) {
        document.getElementById('oxdLevels').innerHTML =
            '<div class="oxd-loading">Lỗi kết nối. Kiểm tra server rồi thử lại.</div>';
    }
}

function oxfordLevelKnown(source, level) {
    const prog = getTopicProgress();
    const g = prog[`oxford-${source}:${level}`];
    return (g && g.known) || [];
}

function renderOxfordDetail(data) {
    const source = oxfordDetailSource;
    const prog = getTopicProgress();
    let totalKnown = 0, total = data.total || 0;
    const rows = data.levels.map(lv => {
        const known = oxfordLevelKnown(source, lv.level);
        totalKnown += known.length;
        const pct = lv.count ? Math.min(100, Math.round(known.length / lv.count * 100)) : 0;
        const btnLabel = known.length ? 'Tiếp tục học' : 'Bắt đầu học';
        const lvName = OXFORD_LEVEL_NAMES[lv.level] || lv.level;
        return `<div class="oxd-level-row">
            <div class="oxd-level-info">
                <div class="oxd-level-name">${lv.level} (${lvName})</div>
                <div class="oxd-level-sub">Đã học ${known.length} trên ${lv.count} từ</div>
                <div class="oxd-bar"><div style="width:${pct}%"></div></div>
            </div>
            <button class="oxd-btn" onclick="startOxfordLevel('${lv.level}')">${btnLabel}</button>
        </div>`;
    }).join('');
    document.getElementById('oxdLevels').innerHTML = rows;
    const totalPct = total ? Math.min(100, Math.round(totalKnown / total * 100)) : 0;
    document.getElementById('oxdPct').textContent = `${totalPct}% đã học`;
    document.getElementById('oxdCount').textContent = `Đã học ${totalKnown} trên ${total} từ`;
    document.getElementById('oxdBarFill').style.width = totalPct + '%';
    document.getElementById('oxdMainBtn').textContent = totalKnown ? 'Tiếp tục học' : 'Bắt đầu học';
}

function hideOxfordDetail() {
    document.getElementById('oxfordDetail').style.display = 'none';
    document.getElementById('flashBrowse').style.display = '';
    renderBrowse();
}
function hideOxfordDetailSilent() {
    const det = document.getElementById('oxfordDetail');
    if (det) det.style.display = 'none';
}

function startOxfordAll() {
    buildOxfordDeck(oxfordDetailSource, '');
}

function startOxfordLevel(level) {
    buildOxfordDeck(oxfordDetailSource, level);
}

async function buildTopicDeck(group) {
    lastDeckRebuild = () => buildTopicDeck(group);
    showFlashEmpty('deck', 'Đang tạo bộ thẻ...', '');
    try {
        lastDeckUrl = `/api/topic-words?group=${group}&count=15`;
        const res = await fetch(lastDeckUrl);
        const data = await res.json();
        if (data.error || !data.words?.length) {
            showFlashEmpty('deck', 'Không tạo được bộ thẻ', data.error || 'Thử lại sau.');
            return;
        }
        flashDeck = mapDeckWords(data.words);
        deckGroup = 'topic:' + group;
        flashDeckName = 'Chủ đề ' + group.replace(/-/g, ' ');
        startDeck();
    } catch (err) {
        showFlashEmpty('deck', 'Lỗi kết nối', 'Không tải được từ mới. Kiểm tra server rồi thử lại.');
    }
}

async function buildToeicBandDeck(band) {
    lastDeckRebuild = () => buildToeicBandDeck(band);
    showFlashEmpty('deck', 'Đang tạo bộ thẻ...', '');
    try {
        lastDeckUrl = `/api/flashcard-ielts?kind=toeic&band=${band}&count=15`;
        const res = await fetch(lastDeckUrl);
        const data = await res.json();
        if (data.error || !data.words?.length) {
            showFlashEmpty('deck', 'Không tạo được bộ thẻ', data.error || 'Thử lại sau.');
            return;
        }
        flashDeck = mapDeckWords(data.words);
        deckGroup = 'toeic-' + band;
        flashDeckName = 'TOEIC ' + band;
        startDeck();
    } catch (err) {
        showFlashEmpty('deck', 'Lỗi kết nối', 'Không tải được từ mới. Kiểm tra server rồi thử lại.');
    }
}

async function buildIdiomDeck() {
    lastDeckRebuild = () => buildIdiomDeck();
    showFlashEmpty('deck', 'Đang tạo bộ thẻ...', '');
    try {
        const res = await fetch('/api/flashcard-ielts?kind=idiom&count=15');
        const data = await res.json();
        if (data.error || !data.words?.length) {
            showFlashEmpty('deck', 'Không tạo được bộ thẻ', data.error || 'Thử lại sau.');
            return;
        }
        flashDeck = mapDeckWords(data.words);
        deckGroup = 'idiom';
        flashDeckName = 'Thành ngữ IELTS';
        startDeck();
    } catch (err) {
        showFlashEmpty('deck', 'Lỗi kết nối', 'Không tải được từ mới. Kiểm tra server rồi thử lại.');
    }

}function setFlashLevel(level) {
    flashLevel = level;
    document.querySelectorAll('.flash-level-chip').forEach(c =>
        c.classList.toggle('active', c.dataset.level === level));
}

// Gọi mỗi khi mở tab flashcard: cập nhật số từ đã lưu, rebuild deck saved mode
function refreshFlashcardTab() {
    document.getElementById('flashSavedCount').textContent = savedWords.length;
    showBrowse();
    // 12/10/2026: tải trước levels Oxford 3000/5000 vào cache — bấm vào là hiện ngay
    ['3000', '5000'].forEach(s => {
        if (oxfordLevelsCache[s]) return;
        fetch(`/api/oxford-levels?source=${s}`).then(r => r.json()).then(d => {
            if (d && !d.error && d.levels && d.levels.length) oxfordLevelsCache[s] = d;
        }).catch(() => {});
    });
}

function buildSavedDeck() {
    document.getElementById('flashSummary').style.display = 'none';
    if (!savedWords.length) {
        showFlashEmpty('saved');
        return;
    }
    const sorted = [...savedWords].sort((a, b) => b.savedAt - a.savedAt);
    flashDeck = sorted.map(s => ({
        word: s.word, lemma: s.lemma,
        level: s.level || '?', color: s.color || '#6366f1',
        ipa: '', meanings: [], desc: s.desc || '',
        detailLoaded: false,
    }));
    deckGroup = null;
    flashDeckName = 'Từ đã lưu';
    startDeck();
}

async function buildRandomDeck() {
    const btn = document.querySelector('.flash-gen-btn');
    const count = parseInt(document.getElementById('flashCount').value, 10) || 15;
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line"></i> Đang tạo...';
    document.getElementById('flashSummary').style.display = 'none';
    try {
        const res = await fetch(`/api/flashcard-words?level=${flashLevel}&count=${count}`);
        const data = await res.json();
        if (data.error || !data.words?.length) {
            showFlashEmpty('random', 'Không tạo được bộ thẻ', data.error || 'Thử lại sau.');
            return;
        }
        flashDeck = data.words.map(w => ({
            word: w.word, lemma: w.word,
            level: w.level, color: w.color || '#6366f1',
            ipa: w.ipa || '', meanings: w.meanings || [], desc: '',
            detailLoaded: true,
        }));
    deckGroup = null;
    flashDeckName = 'Ngẫu nhiên ' + flashLevel;
        startDeck();
    } catch (err) {
        showFlashEmpty('random', 'Lỗi kết nối', 'Không tải được từ mới. Kiểm tra server rồi thử lại.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="ri-refresh-line"></i> Tạo bộ thẻ';
    }
}

function showFlashEmpty(kind, title, sub) {
    document.getElementById('flashDeck').style.display = 'none';
    document.getElementById('flashSummary').style.display = 'none';
    hideOxfordDetailSilent();
    document.getElementById('flashEmpty').style.display = '';
    if (kind === 'saved') {
        document.getElementById('flashEmptyTitle').textContent = 'Chưa có từ nào được lưu';
        document.getElementById('flashEmptySub').textContent = 'Tra từ trong Chat rồi bấm "Lưu từ này" để thêm vào bộ flashcard.';
    } else if (title) {
        document.getElementById('flashEmptyTitle').textContent = title;
        document.getElementById('flashEmptySub').textContent = sub || '';
    } else {
        document.getElementById('flashEmptyTitle').textContent = 'Chưa có bộ thẻ nào';
        document.getElementById('flashEmptySub').textContent = 'Chọn level và bấm "Tạo bộ thẻ" để bắt đầu học.';
    }
}

// Chọn cách học (08/10/2026): modal Nạp sâu ghi nhớ / Nạp nhanh Flashcard
function startDeck() {
    document.getElementById('learnDeckName').textContent = flashDeckName || 'Bộ thẻ';
    document.getElementById('learnBackdrop').style.display = 'flex';
}
function hideLearnModal() {
    document.getElementById('learnBackdrop').style.display = 'none';
}
function startDeckQuick() {
    hideLearnModal();
    document.removeEventListener('keydown', deepKeyHandler);
    flashIdx = 0;
    flashGrades = {};
    document.getElementById('flashEmpty').style.display = 'none';
    document.getElementById('flashSummary').style.display = 'none';
    document.getElementById('deepWrap').style.display = 'none';
    document.getElementById('flashDeck').style.display = '';
    document.getElementById('flashBrowse').style.display = 'none';
    hideOxfordDetailSilent();
    renderFlashcard();
}

function currentCard() { return flashDeck[flashIdx]; }

// Màu badge loại từ cho thẻ sáng (theo ảnh mẫu)
const POS_BADGE_CLASS = {
    'Danh từ': 'fc-pos-n', 'Động từ': 'fc-pos-v', 'Tính từ': 'fc-pos-a',
    'Trạng từ': 'fc-pos-av',
};
function setPosBadge(el, pos) {
    if (!el) return;
    if (!pos) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.textContent = pos;
    el.className = 'fc-pos ' + (POS_BADGE_CLASS[pos] || 'fc-pos-x');
}
// Đọc từ hiện tại (nút loa, thay 2 nút cờ emoji cũ)
function speakFlashWord() {
    const card = currentCard();
    if (!card) return;
    playAudio(card.lemma || card.word, 'us');
}
// In đậm từ vựng trong câu ví dụ
function highlightWord(sentence, word) {
    if (!sentence) return '';
    const esc = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escapeHtml(sentence).replace(new RegExp(`(${esc})`, 'gi'), '<b>$1</b>');
}

function renderFlashcard() {
    const card = currentCard();
    if (!card) return;
    const fc = document.getElementById('flashcard');
    fc.classList.remove('flipped');

    const badge = document.getElementById('flashLevelBadge');
    badge.textContent = card.level || '?';
    badge.style.background = card.color || '#6366f1';

    const pos = card.meanings?.[0]?.pos || '';
    setPosBadge(document.getElementById('flashPosBadge'), pos);
    setPosBadge(document.getElementById('flashPosBadgeBack'), pos);

    document.getElementById('flashWord').textContent = card.word;
    document.getElementById('flashWordBack').textContent = card.word;
    const ipaTxt = card.ipa ? `/${card.ipa}/` : '';
    document.getElementById('flashIpa').textContent = ipaTxt;
    document.getElementById('flashIpaBack').textContent = ipaTxt;
    const ttag = document.getElementById('flashTopicTag');
    if (card.topic) { ttag.style.display = ''; ttag.textContent = card.topic; }
    else ttag.style.display = 'none';

    renderFlashBack(card);

    const total = flashDeck.length;
    document.getElementById('flashProgressBar').style.width = ((flashIdx + 1) / total * 100) + '%';
    document.getElementById('flashProgressText').textContent = `${flashIdx + 1} / ${total}`;
    updateFlashStats();
    prefetchExamples();
}
function renderFlashBack(card) {
    const mainEl = document.getElementById('flashMainMeaning');
    const defsEl = document.getElementById('flashDefs');
    const groups = card.meanings || [];
    const enRow = `<div class="fc-defrow" id="flashEnDefRow" style="display:none"><span class="fc-deflabel">EN</span><span id="flashEnDefText"></span></div>`;
    if (groups.length) {
        const _dt = (d) => (typeof d === 'object' ? d.text : d);
        const firstDefs = groups[0].definitions || [];
        mainEl.textContent = _dt(firstDefs[0]) || card.word;
        mainEl.style.display = '';
        const rest = [];
        groups.forEach((g, gi) => (g.definitions || []).forEach((d, di) => {
            if (gi === 0 && di === 0) return;
            const t = _dt(d);
            if (t && !rest.includes(t)) rest.push(t);
        }));
        defsEl.innerHTML =
            rest.slice(0, 2).map(d =>
                `<div class="fc-defrow"><span class="fc-deflabel">VI</span><span>${escapeHtml(d)}</span></div>`
            ).join('') + enRow;
    } else if (card.desc) {
        mainEl.textContent = card.desc;
        mainEl.style.display = '';
        defsEl.innerHTML = enRow;
    } else {
        mainEl.style.display = 'none';
        defsEl.innerHTML = `<div class="fc-nodata">Chưa có nghĩa tiếng Việt.</div>` + enRow;
    }
    const ex = document.getElementById('flashExample');
    ex.innerHTML = '';
    ex.dataset.loaded = '';
    // 10/10/2026: khôi phục định nghĩa EN đã tải nền trước đó (nếu có)
    if (card._enDef) {
        const row = document.getElementById('flashEnDefRow');
        if (row) {
            document.getElementById('flashEnDefText').textContent = card._enDef;
            row.style.display = '';
        }
    }
}
function flipCard() {
    const card = currentCard();
    if (!card) return;
    const fc = document.getElementById('flashcard');
    fc.classList.toggle('flipped');
    if (fc.classList.contains('flipped')) ensureBackLoaded(card);
}

async function ensureBackLoaded(card) {
    // 1. Nghĩa chi tiết cho mode saved: lazy từ /api/word
    if (!card.detailLoaded) {
        card.detailLoaded = true; // chống fetch trùng
        const box = document.getElementById('flashDefs');
        if (currentCard() === card && !card.meanings.length && !card.desc) {
            box.innerHTML = `<div class="fc-nodata"><div class="ex-loading"><div class="spinner-sm"></div><span>Đang tải nghĩa...</span></div></div>`;
        }
        try {
            const res = await fetch('/api/word', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word: card.lemma || card.word, lemma: card.lemma || card.word }),
            });
            const data = await res.json();
            if (data.found) {
                card.ipa = data.ipa || card.ipa;
                if (data.meanings?.length) card.meanings = data.meanings;
            }
        } catch (e) { /* giữ desc fallback */ }
        if (currentCard() === card) {
            const ipaT = card.ipa ? `/${card.ipa}/` : '';
            document.getElementById('flashIpa').textContent = ipaT;
            document.getElementById('flashIpaBack').textContent = ipaT;
            renderFlashBackKeepExample(card);
        }
    }
    // 2. Ví dụ + định nghĩa EN: lazy từ Free Dictionary API (chung 1 request)
    loadFlashExample(card);
}

// Render lại nghĩa mà không reset phần ví dụ đang tải
function renderFlashBackKeepExample(card) {
    const exHtml = document.getElementById('flashExample').innerHTML;
    const exLoaded = document.getElementById('flashExample').dataset.loaded;
    renderFlashBack(card);
    document.getElementById('flashExample').innerHTML = exHtml;
    document.getElementById('flashExample').dataset.loaded = exLoaded;
}

// Tải trước ví dụ của 2 thẻ kế tiếp vào cache -> lật thẻ là có ngay, khỏi đợi
function prefetchExamples() {
    if (!flashDeck.length) return;
    for (let k = 1; k <= 2; k++) {
        const card = flashDeck[(flashIdx + k) % flashDeck.length];
        if (!card || card.presetExample) continue;
        fetchDictData((card.lemma || card.word).toLowerCase());
    }
}

// Lấy ví dụ + định nghĩa tiếng Anh từ Free Dictionary API (chung 1 request cho cả 2)
async function fetchDictData(key) {
    let data = flashExampleCache[key];
    if (data !== undefined) return data;
    // Timeout 8s: API free nên đôi khi rất chậm
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    data = { example: null, enDef: null };
    try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error('no data');
        const json = await res.json();
        outer:
        for (const entry of json) {
            for (const m of entry.meanings || []) {
                for (const d of m.definitions || []) {
                    if (!data.enDef && d.definition) data.enDef = d.definition;
                    if (!data.example && d.example) data.example = d.example;
                    if (data.enDef && data.example) break outer;
                }
            }
        }
    } catch (e) { /* giữ null */ }
    finally { clearTimeout(timer); }
    flashExampleCache[key] = data;
    return data;
}
async function loadFlashExample(card) {
    const ex = document.getElementById('flashExample');
    if (ex.dataset.loaded) return;
    ex.dataset.loaded = '1';
    // Từ bộ TOEIC/IELTS/đề xuất có sẵn ví dụ (preset hoặc Tatoeba từ server) -> hiện thẳng
    if (card.presetExample) {
        ex.innerHTML =
            `<div class="fc-ex-en">${highlightWord(card.presetExample.en, card.word)}</div>` +
            (card.presetExample.vi ? `<div class="fc-ex-vi">${escapeHtml(card.presetExample.vi)}</div>` : '');
        // ví dụ đã là Tatoeba thì khỏi append thêm (tránh trùng)
        if (!card.presetExample.tatoeba) appendTatoebaPair(card, ex);
        bgFillEnDef(card);
        return;
    }
    const key = (card.lemma || card.word).toLowerCase();
    // 10/10/2026: ví dụ lấy từ Tatoeba local (tức thì, song ngữ);
    // Free Dictionary (API ngoài, chậm) chỉ chạy nền bổ sung định nghĩa EN.
    try {
        const t = await fetch('/api/example-sentences?word=' + encodeURIComponent(key) + '&count=1').then(r => r.json());
        if (currentCard() !== card) return;
        if (t && t.pairs && t.pairs.length) {
            ex.innerHTML =
                `<div class="fc-ex-en">${highlightWord(t.pairs[0].en, card.word)}</div>` +
                (t.pairs[0].vi ? `<div class="fc-ex-vi">${escapeHtml(t.pairs[0].vi)}</div>` : '');
        } else {
            ex.innerHTML = `<div class="fc-nodata">Chưa có câu ví dụ cho từ này.</div>`;
        }
    } catch (e) {
        if (currentCard() === card) ex.innerHTML = `<div class="fc-nodata">Chưa có câu ví dụ cho từ này.</div>`;
    }
    bgFillEnDef(card);
}
// Free Dictionary API (ngoài, chậm) chạy nền: điền định nghĩa tiếng Anh vào hàng
// EN có sẵn, và bổ sung ví dụ EN khi chưa có ví dụ nào. Không chặn hiển thị.
function bgFillEnDef(card) {
    const key = (card.lemma || card.word || '').toLowerCase();
    if (!key) return;
    fetchDictData(key).then(data => {
        if (currentCard() !== card || !data) return;
        if (data.enDef) {
            card._enDef = data.enDef; // giữ lại để re-render không mất
            const row = document.getElementById('flashEnDefRow');
            if (row && row.style.display === 'none') {
                document.getElementById('flashEnDefText').textContent = data.enDef;
                row.style.display = '';
            }
        }
        if (data.example) {
            const ex = document.getElementById('flashExample');
            if (ex && ex.querySelector('.fc-nodata')) {
                ex.innerHTML = `<div class="fc-ex-en">${highlightWord(data.example, card.word)}</div>`;
            }
        }
    }).catch(() => {});
}
// Thêm 1 cặp câu song ngữ Tatoeba dưới ví dụ hiện có ở mặt sau flashcard.
// Chạy nền, im lặng nếu lỗi hoặc đã chuyển thẻ khác.
async function appendTatoebaPair(card, ex) {
    const key = (card.lemma || card.word || '').toLowerCase().trim();
    if (!key) return;
    try {
        const res = await fetch('/api/example-sentences?word=' + encodeURIComponent(key) + '&count=1');
        const data = await res.json();
        if (currentCard() !== card || !data.pairs || !data.pairs.length) return;
        const p = data.pairs[0];
        ex.insertAdjacentHTML('beforeend',
            `<div class="fc-ex-tatoeba">` +
            `<div class="fc-ex-en">${highlightWord(p.en, card.word)}</div>` +
            `<div class="fc-ex-vi">${escapeHtml(p.vi)}</div>` +
            `<div class="tip-source">Tatoeba (CC-BY)</div></div>`);
    } catch (e) { /* giữ nguyên ví dụ hiện có */ }
}
function nextCard() {
    if (!flashDeck.length) return;
    flashIdx = (flashIdx + 1) % flashDeck.length;
    renderFlashcard();
}

function prevCard() {
    if (!flashDeck.length) return;
    flashIdx = (flashIdx - 1 + flashDeck.length) % flashDeck.length;
    renderFlashcard();
}

function shuffleDeck() {
    for (let i = flashDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [flashDeck[i], flashDeck[j]] = [flashDeck[j], flashDeck[i]];
    }
    flashIdx = 0;
    flashGrades = {};
    document.getElementById('flashSummary').style.display = 'none';
    document.getElementById('flashDeck').style.display = '';
    document.getElementById('flashBrowse').style.display = 'none';
    renderFlashcard();
}

function gradeCard(known) {
    if (!flashDeck.length) return;
    const _gc = currentCard();
    flashGrades[flashIdx] = known;
    if (known && deckGroup && _gc) markTopicKnown(deckGroup, _gc.word);
    updateFlashStats();
    const total = flashDeck.length;
    if (Object.keys(flashGrades).length >= total) {
        showFlashSummary();
        return;
    }
    let n = flashIdx;
    for (let i = 0; i < total; i++) {
        n = (n + 1) % total;
        if (!(n in flashGrades)) break;
    }
    flashIdx = n;
    renderFlashcard();
}

function updateFlashStats() {
    let k = 0, u = 0;
    for (const idx in flashGrades) (flashGrades[idx] ? k++ : u++);
    document.getElementById('flashKnownCount').textContent = k;
    document.getElementById('flashUnknownCount').textContent = u;
    document.getElementById('flashRemainCount').textContent = flashDeck.length - k - u;
}

function showFlashSummary() {
    let k = 0, u = 0;
    for (const idx in flashGrades) (flashGrades[idx] ? k++ : u++);
    document.getElementById('flashSumKnown').textContent = k;
    document.getElementById('flashSumUnknown').textContent = u;
    document.getElementById('flashReviewBtn').style.display = u > 0 ? '' : 'none';
    document.getElementById('flashDeck').style.display = 'none';
    document.getElementById('flashSummary').style.display = '';
}

async function learnMoreWords() {
    // Nếu đang giữa phiên học: tải thêm và nối vào deck hiện tại
    if (lastDeckUrl && flashDeck.length && document.getElementById('flashDeck').style.display !== 'none') {
        try {
            const res = await fetch(lastDeckUrl);
            const data = await res.json();
            if (data.error || !data.words?.length) return;
            const newWords = mapDeckWords(data.words);
            // tránh trùng từ đã có
            const seen = new Set(flashDeck.map(w => (w.word || '').toLowerCase()));
            const fresh = newWords.filter(w => !seen.has((w.word || '').toLowerCase()));
            if (!fresh.length) return;
            flashDeck = flashDeck.concat(fresh);
            updateFlashStats();
            renderFlashcard();
        } catch (e) {}
        return;
    }
    if (typeof lastDeckRebuild === 'function') lastDeckRebuild();
}
function reviewUnknown() {
    const unknown = flashDeck.filter((_, i) => flashGrades[i] === false);
    if (!unknown.length) return;
    flashDeck = unknown;
    flashDeckName = 'Ôn lại từ chưa thuộc';
    startDeck();
}

function restartDeck() {
    document.getElementById('flashSummary').style.display = 'none';
    document.getElementById('flashDeck').style.display = '';
    document.getElementById('flashBrowse').style.display = 'none';
    flashIdx = 0;
    flashGrades = {};
    renderFlashcard();
}

// Phím tắt khi đang ở tab flashcard: ←/→ chuyển thẻ, Space lật thẻ
document.addEventListener('keydown', (e) => {
    const tab = document.getElementById('tab-flashcard');
    if (!tab || !tab.classList.contains('active')) return;
    if (document.getElementById('flashDeck').style.display === 'none') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;
    if (e.key === 'ArrowRight') nextCard();
    else if (e.key === 'ArrowLeft') prevCard();
    else if (e.key === ' ' || e.key === 'ArrowUp') { e.preventDefault(); flipCard(); }
});
const READING_ARTICLES = [
 {
  "id": "voa-rsv-vaccine",
  "title": "US Drug Officials Approve RSV Vaccine for Pregnant Women",
  "titleVi": "Mỹ phê duyệt vắc-xin RSV cho phụ nữ mang thai",
  "subtitle": "Level 2 · Intermediate",
  "category": "SỨC KHỎE · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "💉",
  "source_url": "https://learningenglish.voanews.com/a/us-drug-officials-approve-rsv-vaccine-for-pregnant-women/7239765.html",
  "paragraphs": [
    {
      "en": "American food and drug officials recently approved the first RSV vaccine for pregnant women. The drug will inoculate the fetus and provide protection from the dangerous lung disease at birth.",
      "vi": "Cơ quan quản lý thực phẩm và dược phẩm Hoa Kỳ vừa phê duyệt vắc-xin RSV đầu tiên dành cho phụ nữ mang thai. Vắc-xin sẽ tạo miễn dịch cho thai nhi và giúp trẻ được bảo vệ khỏi căn bệnh phổi nguy hiểm ngay từ khi chào đời."
    },
    {
      "en": "RSV stands for respiratory syncytial virus. RSV cases fill hospitals with wheezing babies every fall and winter. Pfizer's newly approved vaccine will mean babies can be protected against RSV at birth. Experts say this will guard against severe RSV infections when babies are most vulnerable — from birth through 6 months.",
      "vi": "RSV là viết tắt của virus hợp bào hô hấp. Mỗi mùa thu đông, bệnh viện lại chật kín những em bé thở khò khè vì RSV. Với vắc-xin mới được phê duyệt của Pfizer, trẻ sơ sinh có thể được bảo vệ khỏi RSV ngay từ lúc lọt lòng. Các chuyên gia cho biết điều này sẽ giúp ngăn ngừa các ca nhiễm RSV nặng trong giai đoạn trẻ dễ tổn thương nhất — từ khi sinh ra đến 6 tháng tuổi."
    },
    {
      "en": "The drug is named Abrysvo. The Centers for Disease Control and Prevention must issue guidelines, or recommendations, for use of Abrysvo during pregnancy.",
      "vi": "Loại vắc-xin này có tên Abrysvo. Trung tâm Kiểm soát và Phòng ngừa Dịch bệnh Hoa Kỳ (CDC) sẽ ban hành hướng dẫn sử dụng Abrysvo trong thai kỳ."
    },
    {
      "en": "“Maternal vaccination is an incredible way to protect the infants,” said Dr. Elizabeth Schlaudecker of Cincinnati Children's Hospital in Ohio. Schlaudecker was among the researchers in Pfizer's international study of the vaccine. If shots begin soon, she said, “I do think we could see an impact for this RSV season.”",
      "vi": "“Tiêm chủng cho mẹ là một cách tuyệt vời để bảo vệ trẻ sơ sinh,” tiến sĩ Elizabeth Schlaudecker thuộc Bệnh viện Nhi Cincinnati, Ohio cho biết. Bà là một trong các nhà nghiên cứu tham gia thử nghiệm quốc tế của Pfizer về loại vắc-xin này. Bà nói nếu việc tiêm chủng bắt đầu sớm, “tôi nghĩ chúng ta sẽ thấy hiệu quả ngay trong mùa RSV năm nay.”"
    },
    {
      "en": "RSV is a minor sickness for most healthy people but it can be life-threatening for the very young. It swells babies' airways, making breathing difficult. It can also lead to the disease pneumonia. In the U.S. alone, the disease leads to hospital stays for between 58,000 and 80,000 children under the age of 5 each year. It kills several hundred a year.",
      "vi": "RSV chỉ là bệnh nhẹ đối với hầu hết người khỏe mạnh, nhưng có thể đe dọa tính mạng trẻ nhỏ. Virus làm sưng đường thở của bé, gây khó thở, và có thể dẫn đến viêm phổi. Riêng tại Mỹ, mỗi năm có từ 58.000 đến 80.000 trẻ dưới 5 tuổi phải nhập viện vì RSV, và vài trăm trẻ tử vong."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Sức khỏe (Health)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "US officials approved Abrysvo, the first RSV vaccine for pregnant women, to protect newborns from birth.",
      "vi": "Mỹ đã phê duyệt Abrysvo — vắc-xin RSV đầu tiên cho phụ nữ mang thai, giúp bảo vệ trẻ ngay từ khi chào đời."
    },
    {
      "en": "The vaccine protects babies during their most vulnerable months, from birth to 6 months old.",
      "vi": "Vắc-xin bảo vệ trẻ trong những tháng dễ tổn thương nhất, từ lúc sinh ra đến 6 tháng tuổi."
    },
    {
      "en": "RSV hospitalizes tens of thousands of young American children every year.",
      "vi": "Mỗi năm, RSV khiến hàng chục nghìn trẻ nhỏ tại Mỹ phải nhập viện."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What is the name of the newly approved RSV vaccine?",
      "opts": [
        "Abrysvo",
        "Comirnaty",
        "Spikevax",
        "Fluzone"
      ],
      "answer": 0,
      "explain": "The article states that the newly approved drug is named Abrysvo."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "According to the article, when are babies most vulnerable to severe RSV infections?",
      "opts": [
        "From 6 months to 1 year",
        "From birth through 6 months",
        "From 1 to 2 years old",
        "Only in the summer"
      ],
      "answer": 1,
      "explain": "Experts say the vaccine guards babies when they are most vulnerable — from birth through 6 months."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main purpose of vaccinating pregnant women against RSV?",
      "opts": [
        "To cure pneumonia in adults",
        "To protect newborns from RSV at birth",
        "To replace childhood vaccines",
        "To treat the common cold"
      ],
      "answer": 1,
      "explain": "Maternal vaccination passes protection to the fetus so babies are protected from RSV at birth."
    },
    {
      "type": "SUY LUẬN",
      "q": "What can be inferred from Dr. Schlaudecker's statement about “this RSV season”?",
      "opts": [
        "The vaccine works only in winter",
        "She expects the vaccine to reduce RSV cases soon",
        "RSV season has already ended",
        "The vaccine is not yet approved"
      ],
      "answer": 1,
      "explain": "She said that if shots begin soon, “we could see an impact for this RSV season,” meaning fewer RSV cases."
    }
  ],
  "suggestions": [
    "RSV nguy hiểm thế nào với trẻ sơ sinh?",
    "Vắc-xin Abrysvo hoạt động ra sao?",
    "Tóm tắt bài này bằng tiếng Việt",
    "Mẹ bầu cần lưu ý gì khi tiêm vắc-xin?"
  ]
},
 {
  "id": "voa-digital-nationalism",
  "title": "Rising ‘Digital Nationalism’ Could Create New Internet Borders",
  "titleVi": "‘Chủ nghĩa dân tộc số’ và những biên giới internet mới",
  "subtitle": "Level 2 · Intermediate",
  "category": "CÔNG NGHỆ · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🌐",
  "source_url": "https://learningenglish.voanews.com/a/rising-digital-nationalism-could-create-new-internet-borders/5550031.html",
  "paragraphs": [
    {
      "en": "Increasing government attempts to censor or regulate the internet may result in new digital borders that could change the ways we currently experience the World Wide Web.",
      "vi": "Việc các chính phủ ngày càng tìm cách kiểm duyệt hoặc quản lý internet có thể tạo ra những biên giới số mới, làm thay đổi cách chúng ta trải nghiệm mạng lưới toàn cầu hiện nay."
    },
    {
      "en": "Authoritarian governments have long operated digital borders to restrict the flow of information and censor material it does not want its citizens to receive. One of the largest such efforts is in China, where the government blocks major parts of the internet in a massive system known as the Great Firewall of China.",
      "vi": "Các chính phủ độc tài từ lâu đã dựng lên biên giới số để hạn chế dòng thông tin và kiểm duyệt những nội dung không muốn người dân tiếp cận. Một trong những nỗ lực lớn nhất là ở Trung Quốc, nơi chính phủ chặn phần lớn internet bằng hệ thống khổng lồ mang tên Vạn Lý Tường Lửa."
    },
    {
      "en": "But there have also been attempts by countries to create digital borders by enacting rules that limit how the internet and technology companies can operate in those areas. The justification for such rules in democratic systems usually centers on protecting the individual privacy and national security.",
      "vi": "Tuy nhiên, nhiều quốc gia cũng tìm cách tạo biên giới số bằng cách ban hành quy định hạn chế hoạt động của internet và các công ty công nghệ. Ở các nước dân chủ, lý do cho những quy định này thường là bảo vệ quyền riêng tư cá nhân và an ninh quốc gia."
    },
    {
      "en": "The European Union, EU, has been one of the most active legislators in this area. About two years ago, the EU approved a massive privacy measure known as the General Data Protection Regulation, or GDPR. It aims to protect the personal data of citizens and requires companies to follow rules relating to how they collect, process and store such information.",
      "vi": "Liên minh châu Âu (EU) là một trong những bên tích cực nhất trong lĩnh vực này. Khoảng hai năm trước, EU đã thông qua đạo luật bảo mật quy mô lớn mang tên Quy định Chung về Bảo vệ Dữ liệu (GDPR), nhằm bảo vệ dữ liệu cá nhân của công dân và buộc các công ty tuân thủ quy tắc về thu thập, xử lý, lưu trữ thông tin."
    },
    {
      "en": "The regulations cover not only all EU nations, but also American-based technology companies doing business there, including Google, Facebook, Amazon and Apple.",
      "vi": "Các quy định này không chỉ áp dụng cho mọi quốc gia EU mà còn cho các công ty công nghệ Mỹ đang kinh doanh tại đây, gồm Google, Facebook, Amazon và Apple."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Công nghệ (Technology)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Governments are increasingly censoring or regulating the internet, creating new ‘digital borders.’",
      "vi": "Các chính phủ ngày càng kiểm duyệt hoặc quản lý internet, tạo ra những ‘biên giới số’ mới."
    },
    {
      "en": "China's Great Firewall is one of the largest systems for blocking internet content.",
      "vi": "Vạn Lý Tường Lửa của Trung Quốc là một trong những hệ thống chặn internet lớn nhất."
    },
    {
      "en": "The EU's GDPR shows how democracies also regulate tech companies in the name of privacy.",
      "vi": "GDPR của EU cho thấy các nước dân chủ cũng quản lý công ty công nghệ vì lý do bảo mật."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What is the name of China's massive internet blocking system?",
      "opts": [
        "The Digital Wall",
        "The Great Firewall of China",
        "The Cyber Shield",
        "The Internet Curtain"
      ],
      "answer": 1,
      "explain": "The article identifies China's system as the Great Firewall of China."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What does the GDPR aim to protect?",
      "opts": [
        "National borders",
        "The personal data of citizens",
        "Technology company profits",
        "Military secrets"
      ],
      "answer": 1,
      "explain": "The GDPR aims to protect citizens' personal data and regulate how companies handle it."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main idea of the article?",
      "opts": [
        "The internet will soon disappear",
        "Government regulation may create new digital borders on the internet",
        "China invented the World Wide Web",
        "American tech companies control Europe"
      ],
      "answer": 1,
      "explain": "The article argues that government attempts to censor or regulate the internet may create new digital borders."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why do democratic governments say they regulate the internet?",
      "opts": [
        "To increase company profits",
        "To protect individual privacy and national security",
        "To block all foreign websites",
        "To make the internet faster"
      ],
      "answer": 1,
      "explain": "The article says democratic systems usually justify such rules as protecting privacy and national security."
    }
  ],
  "suggestions": [
    "Vạn Lý Tường Lửa hoạt động như thế nào?",
    "GDPR ảnh hưởng gì đến người dùng Việt Nam?",
    "Tóm tắt bài này bằng tiếng Việt",
    "‘Chủ nghĩa dân tộc số’ nghĩa là gì?"
  ]
},
 {
  "id": "voa-us-food-regulation",
  "title": "Could the US Regulate What Americans Eat?",
  "titleVi": "Liệu nước Mỹ có nên kiểm soát những gì người dân ăn?",
  "subtitle": "Level 2 · Intermediate",
  "category": "SỨC KHỎE · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🍔",
  "source_url": "https://learningenglish.voanews.com/a/could-the-us-regulate-what-americans-eat-/6080812.html",
  "paragraphs": [
    {
      "en": "Nine out of 10 American adults have unhealthy metabolisms, mostly because of the food they eat. Experts say it might be time for the government to regulate what Americans put in their mouths.",
      "vi": "Cứ 10 người Mỹ trưởng thành thì có 9 người chuyển hóa kém, chủ yếu do thực phẩm họ ăn hằng ngày. Các chuyên gia cho rằng đã đến lúc chính phủ cần kiểm soát những gì người dân đưa vào miệng."
    },
    {
      "en": "Dariush Mozaffarian is a heart doctor at Tufts University in Massachusetts. He said the food industry is the only area of the economy “where we have the majority of products being knowingly dangerous, and we leave it up” to the public to decide what to have.",
      "vi": "Dariush Mozaffarian là bác sĩ tim mạch tại Đại học Tufts, Massachusetts. Ông nói ngành thực phẩm là lĩnh vực duy nhất của nền kinh tế “mà phần lớn sản phẩm được biết là có hại, nhưng chúng ta vẫn để” người dân tự quyết định ăn gì."
    },
    {
      "en": "To look at someone's metabolic health, doctors measure things like blood sugar, cholesterol and blood pressure. People who are in poor metabolic health are at increased risk of getting diabetes, heart disease and other serious health problems.",
      "vi": "Để đánh giá sức khỏe chuyển hóa, bác sĩ đo các chỉ số như đường huyết, cholesterol và huyết áp. Người có chuyển hóa kém đối mặt nguy cơ cao mắc tiểu đường, bệnh tim và nhiều vấn đề sức khỏe nghiêm trọng khác."
    },
    {
      "en": "“When you have nine out of 10 adults being metabolically unhealthy, largely due to diet-related illnesses, you know we have a broken system,” Mozaffarian said.",
      "vi": "“Khi 9 trên 10 người trưởng thành chuyển hóa kém, chủ yếu do các bệnh liên quan đến ăn uống, thì rõ ràng hệ thống của chúng ta đang có vấn đề,” ông Mozaffarian nói."
    },
    {
      "en": "A big part of the problem is that Americans eat a lot of junk food. Junk foods are processed foods like sweets or potato chips that provide little nutritional value and are high in fat, salt and sugar. A study by the National Institutes of Health found that junk foods account for 1 out every 7 calories in adults and 1 out of every 5 calories in children.",
      "vi": "Một phần lớn của vấn đề là người Mỹ ăn quá nhiều đồ ăn vặt. Đồ ăn vặt là thực phẩm chế biến sẵn như kẹo hay khoai tây chiên, ít giá trị dinh dưỡng nhưng giàu chất béo, muối và đường. Một nghiên cứu của Viện Y tế Quốc gia Hoa Kỳ cho thấy đồ ăn vặt chiếm 1 trên 7 lượng calo ở người lớn và 1 trên 5 ở trẻ em."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Sức khỏe (Health)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Nine in ten American adults have unhealthy metabolisms, largely because of their diet.",
      "vi": "9 trên 10 người Mỹ trưởng thành chuyển hóa kém, chủ yếu do chế độ ăn uống."
    },
    {
      "en": "Experts suggest the government should regulate unhealthy food like it regulates other dangerous products.",
      "vi": "Các chuyên gia đề xuất chính phủ nên kiểm soát thực phẩm có hại như với các sản phẩm nguy hiểm khác."
    },
    {
      "en": "Junk food makes up a large share of daily calories for both adults and children.",
      "vi": "Đồ ăn vặt chiếm tỷ lệ lớn trong lượng calo hằng ngày của cả người lớn và trẻ em."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "According to the article, how many American adults have unhealthy metabolisms?",
      "opts": [
        "Five out of ten",
        "Seven out of ten",
        "Nine out of ten",
        "Ten out of ten"
      ],
      "answer": 2,
      "explain": "The article states that nine out of ten American adults have unhealthy metabolisms."
    },
    {
      "type": "TỪ VỰNG",
      "q": "In the article, ‘junk food’ refers to food that is...",
      "opts": [
        "fresh and organic",
        "high in fat, salt and sugar with little nutritional value",
        "cooked at home",
        "rich in vitamins"
      ],
      "answer": 1,
      "explain": "The article defines junk foods as processed foods high in fat, salt and sugar that provide little nutritional value."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What do experts suggest the government should do?",
      "opts": [
        "Ban all restaurants",
        "Regulate unhealthy food products",
        "Stop importing food",
        "Close hospitals"
      ],
      "answer": 1,
      "explain": "Experts say it might be time for the government to regulate what Americans eat."
    },
    {
      "type": "SUY LUẬN",
      "q": "What can be inferred from Mozaffarian's comparison of the food industry to other industries?",
      "opts": [
        "Food companies are well regulated",
        "Dangerous food products face too little regulation",
        "People eat too little",
        "Doctors approve of junk food"
      ],
      "answer": 1,
      "explain": "He says food is the only area where most products are knowingly dangerous yet left unregulated."
    }
  ],
  "suggestions": [
    "Đồ ăn vặt gây hại sức khỏe thế nào?",
    "Chính phủ có thể kiểm soát thực phẩm bằng cách nào?",
    "Tóm tắt bài này bằng tiếng Việt",
    "‘Metabolic health’ nghĩa là gì?"
  ]
},
 {
  "id": "voa-restaurant-tents",
  "title": "Can Tents at Restaurants Prevent Coronavirus Infections?",
  "titleVi": "Lều ăn ngoài trời có giúp tránh lây COVID?",
  "subtitle": "Level 2 · Intermediate",
  "category": "SỨC KHỎE · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🍽️",
  "source_url": "https://learningenglish.voanews.com/a/can-tents-at-restaurants-prevent-coronavirus-infections-/5676595.html",
  "paragraphs": [
    {
      "en": "Some restaurants are providing plastic tents so people can stay separated from each other while they eat. But are these tents a safe way to eat out during the coronavirus health crisis?",
      "vi": "Một số nhà hàng dựng lều nhựa để thực khách giữ khoảng cách khi ăn uống. Nhưng liệu những chiếc lều này có thực sự an toàn trong thời kỳ đại dịch COVID?"
    },
    {
      "en": "Health experts say outdoor tents are a little safer than eating inside. But, not all tents are equal, they add.",
      "vi": "Các chuyên gia y tế cho biết ăn trong lều ngoài trời an toàn hơn một chút so với ăn trong nhà. Tuy nhiên, không phải chiếc lều nào cũng như nhau."
    },
    {
      "en": "Many restaurants are putting up single tents, and other outdoor structures that let people who are eating together avoid being indoors. The coronavirus spreads more easily when people are indoors.",
      "vi": "Nhiều nhà hàng dựng lều đơn và các cấu trúc ngoài trời khác để thực khách không phải ăn trong không gian kín. Virus corona lây lan dễ dàng hơn khi con người ở trong nhà."
    },
    {
      "en": "Experts say the tents should have good air circulation. A tent with four walls and a roof, for example, might not have better air circulation than an indoor dining room.",
      "vi": "Các chuyên gia cho rằng lều cần có sự lưu thông không khí tốt. Ví dụ, một chiếc lều kín bốn mặt và có mái che có thể không thoáng hơn phòng ăn trong nhà là bao."
    },
    {
      "en": "“The more airflow through the structure, the better it is,” says Dr. Isaac Weisfuse. He is a public health expert at Cornell University.",
      "vi": "“Không khí lưu thông qua lều càng nhiều thì càng tốt,” tiến sĩ Isaac Weisfuse, chuyên gia y tế công cộng tại Đại học Cornell, cho biết."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Sức khỏe (Health)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Restaurants use outdoor tents to separate diners during the COVID-19 crisis.",
      "vi": "Các nhà hàng dùng lều ngoài trời để tách thực khách trong đại dịch COVID-19."
    },
    {
      "en": "Tents are only safer if they have good airflow; a sealed tent is no better than indoors.",
      "vi": "Lều chỉ an toàn hơn khi thoáng khí; lều kín thì không khác gì trong nhà."
    },
    {
      "en": "Good air circulation is the key factor that makes outdoor dining safer.",
      "vi": "Lưu thông không khí tốt là yếu tố then chốt giúp ăn ngoài trời an toàn hơn."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Why are restaurants setting up tents, according to the article?",
      "opts": [
        "To decorate the street",
        "To keep diners separated while they eat",
        "To store extra food",
        "To block sunlight"
      ],
      "answer": 1,
      "explain": "Restaurants provide tents so people can stay separated from each other while they eat."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "According to Dr. Weisfuse, what makes a tent safer?",
      "opts": [
        "Bright lighting",
        "Good airflow through the structure",
        "Thick plastic walls",
        "Loud music"
      ],
      "answer": 1,
      "explain": "Dr. Weisfuse says, ‘The more airflow through the structure, the better it is.’"
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the article's main message about restaurant tents?",
      "opts": [
        "All tents are completely safe",
        "Tents help only when they allow good air circulation",
        "Tents should be banned",
        "Indoor dining is always safer"
      ],
      "answer": 1,
      "explain": "Experts say outdoor tents are a little safer than indoors, but only with good air circulation."
    },
    {
      "type": "SUY LUẬN",
      "q": "What can be inferred about a tent with four walls and a roof?",
      "opts": [
        "It is the safest option",
        "It may be no safer than eating indoors",
        "It prevents all infections",
        "It is cheaper than other tents"
      ],
      "answer": 1,
      "explain": "The article notes such a tent might not have better air circulation than an indoor dining room."
    }
  ],
  "suggestions": [
    "Vì sao COVID lây nhanh hơn trong nhà?",
    "Ăn ngoài trời an toàn đến mức nào?",
    "Tóm tắt bài này bằng tiếng Việt",
    "‘Air circulation’ nghĩa là gì?"
  ]
},
 {
  "id": "voa-human-genome-covid",
  "title": "Human Genome Project Helps Drive COVID-19 Research",
  "titleVi": "Dự án genome người thúc đẩy nghiên cứu COVID-19",
  "subtitle": "Level 2 · Intermediate",
  "category": "KHOA HỌC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🧬",
  "source_url": "https://learningenglish.voanews.com/a/human-genome-project-helps-drive-covid-19-research/5479209.html",
  "paragraphs": [
    {
      "en": "Until this March, machines at the Broad Institute in Massachusetts were busy sequencing enough information for a complete human genome every 10 minutes.",
      "vi": "Cho đến tháng 3 năm nay, các cỗ máy tại Viện Broad ở Massachusetts vẫn bận rộn giải trình tự đủ thông tin cho một bộ genome người hoàn chỉnh cứ mỗi 10 phút."
    },
    {
      "en": "The DNA sequencing center is among the world's largest genomics labs. Genomics is an area of molecular biology concerned with the structure and mapping of genetic material of living organisms.",
      "vi": "Trung tâm giải trình tự DNA này là một trong những phòng thí nghiệm genome học lớn nhất thế giới. Genome học là lĩnh vực sinh học phân tử nghiên cứu cấu trúc và lập bản đồ vật liệu di truyền của sinh vật."
    },
    {
      "en": "When the disease COVID-19 started spreading in the United States, scientists at the institute had an idea. What if their genome-reading machines could be repurposed and used to test patient samples for the coronavirus?",
      "vi": "Khi dịch COVID-19 bắt đầu lan rộng tại Mỹ, các nhà khoa học của viện nảy ra một ý tưởng: nếu những cỗ máy đọc genome có thể được chuyển đổi công năng để xét nghiệm mẫu bệnh phẩm tìm virus corona thì sao?"
    },
    {
      "en": "Over a period of two weeks in March, the laboratory reinvented itself. It went from sequencing the 3 billion letters of a human genome to sequencing the 30,000-letter genome of the virus.",
      "vi": "Chỉ trong hai tuần của tháng 3, phòng thí nghiệm đã tự tái cấu trúc: từ giải trình tự 3 tỷ ‘chữ cái’ của genome người chuyển sang giải trình tự 30.000 ‘chữ cái’ của genome virus."
    },
    {
      "en": "Eric Green is director of the National Human Genome Research Institute, which provides money for many of these labs. He told VOA that preparing genome labs for COVID testing only required “tweaking” -- or small changes.",
      "vi": "Eric Green là giám đốc Viện Nghiên cứu Genome Người Quốc gia, đơn vị tài trợ cho nhiều phòng thí nghiệm này. Ông nói với VOA rằng việc chuẩn bị các phòng lab genome cho xét nghiệm COVID chỉ cần những điều chỉnh nhỏ."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Khoa học (Science)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Genomics labs like the Broad Institute repurposed their machines to test for COVID-19.",
      "vi": "Các phòng lab genome như Viện Broad đã chuyển đổi máy móc để xét nghiệm COVID-19."
    },
    {
      "en": "The switch from human genome sequencing to virus sequencing took only two weeks.",
      "vi": "Việc chuyển từ giải trình tự genome người sang genome virus chỉ mất hai tuần."
    },
    {
      "en": "The Human Genome Project's tools proved valuable for fighting a new pandemic.",
      "vi": "Các công cụ của Dự án Genome Người đã phát huy giá trị trong cuộc chiến chống đại dịch mới."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "How often could Broad Institute machines sequence a complete human genome?",
      "opts": [
        "Every 10 minutes",
        "Every 10 hours",
        "Every 10 days",
        "Every 10 weeks"
      ],
      "answer": 0,
      "explain": "The article says the machines were sequencing a complete human genome every 10 minutes."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "How many ‘letters’ does the coronavirus genome have, compared to the human genome's 3 billion?",
      "opts": [
        "3 million",
        "300,000",
        "30,000",
        "3,000"
      ],
      "answer": 2,
      "explain": "The lab switched from the 3-billion-letter human genome to the 30,000-letter virus genome."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main idea of the article?",
      "opts": [
        "Genome labs closed during COVID-19",
        "Human genome research tools were quickly adapted to fight COVID-19",
        "The coronavirus has 3 billion letters",
        "Broad Institute discovered COVID-19"
      ],
      "answer": 1,
      "explain": "The article shows how genomics labs repurposed their machines for COVID-19 testing."
    },
    {
      "type": "TỪ VỰNG",
      "q": "In the article, ‘repurposed’ most nearly means...",
      "opts": [
        "destroyed",
        "sold",
        "adapted for a new use",
        "shut down"
      ],
      "answer": 2,
      "explain": "The machines were repurposed — adapted from genome sequencing to virus testing."
    }
  ],
  "suggestions": [
    "Genome học là gì?",
    "Viện Broad đã xét nghiệm COVID thế nào?",
    "Tóm tắt bài này bằng tiếng Việt",
    "Dự án Genome Người có ý nghĩa gì?"
  ]
},
 {
  "id": "voa-remove-carbon-ocean",
  "title": "Researchers Develop Method to Remove Carbon from Ocean",
  "titleVi": "Phương pháp mới loại bỏ carbon khỏi đại dương",
  "subtitle": "Level 2 · Intermediate",
  "category": "MÔI TRƯỜNG · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🌊",
  "source_url": "https://learningenglish.voanews.com/a/researchers-develop-method-to-remove-carbon-from-ocean/7067281.html",
  "paragraphs": [
    {
      "en": "American researchers say they have developed a method to remove carbon dioxide (CO2) from the sea and produce a clean-burning fuel in the process.",
      "vi": "Các nhà nghiên cứu Mỹ cho biết họ đã phát triển một phương pháp loại bỏ khí carbon dioxide (CO2) khỏi biển, đồng thời tạo ra nhiên liệu cháy sạch trong quá trình này."
    },
    {
      "en": "The method was created by an engineering team at the University of California, Los Angeles. The researchers say the process can be an additional way to help reduce CO2 from the environment to fight the effects of climate change.",
      "vi": "Phương pháp này do một nhóm kỹ sư tại Đại học California, Los Angeles tạo ra. Các nhà nghiên cứu cho biết quy trình này có thể là một cách bổ sung giúp giảm CO2 trong môi trường để chống lại tác động của biến đổi khí hậu."
    },
    {
      "en": "Plants and currents in the ocean take in large amounts of CO2 from the atmosphere. The sea is estimated to have drawn in about 30 percent of carbon emissions since the Industrial Revolution, The Associated Press reports.",
      "vi": "Thực vật và các dòng hải lưu trong đại dương hấp thụ một lượng lớn CO2 từ khí quyển. Theo hãng tin AP, biển được ước tính đã hấp thụ khoảng 30% lượng khí thải carbon kể từ cuộc Cách mạng Công nghiệp."
    },
    {
      "en": "Gaurav Sant is the director of UCLA's Institute for Carbon Management and helped lead the development project. He told the AP that the technology, called SeaChange, is meant to use the ocean's natural abilities to reduce carbon levels in the sea.",
      "vi": "Gaurav Sant là giám đốc Viện Quản lý Carbon của UCLA và là người dẫn dắt dự án phát triển này. Ông nói với AP rằng công nghệ có tên SeaChange tận dụng khả năng tự nhiên của đại dương để giảm lượng carbon trong nước biển."
    },
    {
      "en": "The process sends an electrical charge through seawater flowing through tanks on a large boat. That sets off a series of chemical reactions that turn the carbon emissions into a solid mineral that includes calcium carbonate, the same material seashells are made of. The seawater is then returned to the ocean and can pull more carbon dioxide out of the air. The calcium carbonate settles to the sea floor.",
      "vi": "Quy trình truyền dòng điện qua nước biển chảy trong các bể chứa trên một con tàu lớn. Việc này tạo ra một chuỗi phản ứng hóa học biến khí thải carbon thành khoáng chất rắn chứa canxi cacbonat — chính là chất liệu tạo nên vỏ sò. Nước biển sau đó được trả lại đại dương và có thể tiếp tục hút thêm CO2 từ không khí. Canxi cacbonat lắng xuống đáy biển."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Môi trường (Environment)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "UCLA researchers developed SeaChange, a method to remove CO2 from seawater.",
      "vi": "Các nhà nghiên cứu UCLA đã phát triển SeaChange, phương pháp loại bỏ CO2 khỏi nước biển."
    },
    {
      "en": "The process turns carbon emissions into solid calcium carbonate, the material of seashells.",
      "vi": "Quy trình biến khí thải carbon thành canxi cacbonat rắn — chất liệu tạo nên vỏ sò."
    },
    {
      "en": "Treated seawater is returned to the ocean, where it can absorb more CO2 from the air.",
      "vi": "Nước biển sau xử lý được trả lại đại dương để tiếp tục hấp thụ CO2 từ không khí."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What did UCLA researchers develop?",
      "opts": [
        "A new kind of seashell",
        "A method to remove CO2 from the ocean",
        "A clean-burning car engine",
        "A way to make seawater drinkable"
      ],
      "answer": 1,
      "explain": "The article says UCLA engineers created a method to remove carbon dioxide from the sea."
    },
    {
      "type": "TỪ VỰNG",
      "q": "In the article, the word 'emissions' is closest in meaning to...",
      "opts": [
        "gases released into the air",
        "ocean waves",
        "electrical charges",
        "mineral deposits"
      ],
      "answer": 0,
      "explain": "Emissions are gases or substances released into the environment."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why is the calcium carbonate allowed to settle on the sea floor?",
      "opts": [
        "It is dangerous to fish",
        "It safely stores the carbon long-term",
        "It helps ships move faster",
        "It makes seawater warmer"
      ],
      "answer": 1,
      "explain": "Turning CO2 into a solid mineral keeps the carbon out of the atmosphere."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main idea of the article?",
      "opts": [
        "The ocean is too acidic for sea life",
        "A new technology may help reduce CO2 to fight climate change",
        "UCLA built the world's largest boat",
        "Seashells can be used as fuel"
      ],
      "answer": 1,
      "explain": "The article focuses on SeaChange as an additional way to reduce carbon and fight climate change."
    }
  ],
  "suggestions": [
    "Tóm tắt bài đọc này",
    "Công nghệ SeaChange hoạt động thế nào?",
    "Vì sao đại dương hấp thụ nhiều CO2?",
    "Giải thích từ 'emissions'"
  ]
},
 {
  "id": "voa-betta-fish",
  "title": "How to Keep a Betta Fish",
  "titleVi": "Cách nuôi cá betta",
  "subtitle": "Level 2 · Intermediate",
  "category": "ĐỘNG VẬT · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🐠",
  "source_url": "https://learningenglish.voanews.com/a/how-to-keep-a-betta-fish/6894375.html",
  "paragraphs": [
    {
      "en": "In the northern parts of the world, winter has arrived, and some people might be wondering what to do with their time now that they are indoors. Keeping a betta fish can be a fun hobby that does not involve going outside. It also does not require too much skill, but you do have to be willing to learn.",
      "vi": "Ở các vùng phía bắc thế giới, mùa đông đã đến, và một số người có thể đang băn khoăn không biết làm gì khi phải ở trong nhà. Nuôi cá betta có thể là một thú vui không cần ra ngoài. Nó cũng không đòi hỏi quá nhiều kỹ năng, nhưng bạn phải sẵn sàng học hỏi."
    },
    {
      "en": "First, betta fish need a home. A tank that holds at least 11 liters of water is suggested although 19 liters is better. Larger tanks are better because the water needs to be changed less often and provides a healthier environment for the fish.",
      "vi": "Trước hết, cá betta cần một ngôi nhà. Nên dùng bể chứa ít nhất 11 lít nước, dù 19 lít thì tốt hơn. Bể càng lớn càng tốt vì không phải thay nước thường xuyên và tạo môi trường khỏe mạnh hơn cho cá."
    },
    {
      "en": "Second, the tank needs small rocks or sand at the bottom. In the pet fish industry, this is called substrate. A few centimeters at the bottom are all that is needed. Clean the rocks or sand with running water without soap until it runs clear before adding them to the tank.",
      "vi": "Thứ hai, bể cần có sỏi nhỏ hoặc cát ở đáy. Trong ngành cá cảnh, lớp này gọi là 'substrate' (nền đáy). Chỉ cần rải vài cm ở đáy bể. Rửa sỏi hoặc cát dưới vòi nước chảy, không dùng xà phòng, cho đến khi nước trong rồi mới cho vào bể."
    },
    {
      "en": "Third, a filter is needed to purify the water. Many people keep bettas without filters. But the fish should be raised with a filter to stay healthy. Follow the filter's guidelines and choose a filter that is the right size for the tank.",
      "vi": "Thứ ba, cần có máy lọc để làm sạch nước. Nhiều người nuôi betta không dùng máy lọc, nhưng cá nên được nuôi có máy lọc mới khỏe mạnh. Hãy đọc kỹ hướng dẫn của máy lọc và chọn loại phù hợp với kích cỡ bể."
    },
    {
      "en": "Fourth, a heater is suggested to keep your fish in good condition. These fish prefer warmer water, usually between 24 and 28 degrees Celsius. Pet stores sell heaters for fish. Choose the right size for your aquarium and follow its guidelines, or instructions, to set it up.",
      "vi": "Thứ tư, nên dùng máy sưởi để giữ cá khỏe mạnh. Loài cá này thích nước ấm, thường từ 24 đến 28 độ C. Các cửa hàng thú cưng có bán máy sưởi cho cá. Hãy chọn đúng kích cỡ cho bể và làm theo hướng dẫn để lắp đặt."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Động vật (Animals)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "A betta fish needs a tank of at least 11 liters, and bigger is better.",
      "vi": "Cá betta cần bể ít nhất 11 lít nước, bể càng lớn càng tốt."
    },
    {
      "en": "The tank should have clean substrate, a filter, and a heater.",
      "vi": "Bể cần có nền đáy sạch, máy lọc và máy sưởi."
    },
    {
      "en": "Keeping a betta is an easy indoor hobby, but owners must be willing to learn.",
      "vi": "Nuôi cá betta là thú vui trong nhà đơn giản, nhưng người nuôi phải sẵn sàng học hỏi."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What size tank is suggested for a betta fish?",
      "opts": [
        "At least 11 liters",
        "At least 5 liters",
        "At least 50 liters",
        "Any small bowl"
      ],
      "answer": 0,
      "explain": "The article suggests a tank that holds at least 11 liters, although 19 liters is better."
    },
    {
      "type": "TỪ VỰNG",
      "q": "The word 'substrate' in the article refers to...",
      "opts": [
        "fish food",
        "small rocks or sand at the bottom of the tank",
        "a water filter",
        "a fish heater"
      ],
      "answer": 1,
      "explain": "Substrate is the small rocks or sand placed at the bottom of the tank."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why are larger tanks better for betta fish?",
      "opts": [
        "They look more beautiful",
        "The water needs to be changed less often",
        "Fish grow faster in large tanks",
        "Heaters work better in large tanks"
      ],
      "answer": 1,
      "explain": "Larger tanks need less frequent water changes and give the fish a healthier environment."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main purpose of the article?",
      "opts": [
        "To describe wild betta fish habitats",
        "To explain how to sell betta fish",
        "To give steps for keeping a betta fish healthy",
        "To compare betta fish with other pets"
      ],
      "answer": 2,
      "explain": "The article lists steps — tank, substrate, filter, heater — for keeping a betta fish."
    }
  ],
  "suggestions": [
    "Tóm tắt các bước nuôi cá betta",
    "Cá betta cần nước bao nhiêu độ?",
    "Substrate là gì?",
    "Vì sao nên dùng bể lớn?"
  ]
},
 {
  "id": "voa-visa-restriction-students",
  "title": "US Withdraws Planned Visa Restriction for International Students",
  "titleVi": "Mỹ rút lại kế hoạch hạn chế visa du học sinh",
  "subtitle": "Level 2 · Intermediate",
  "category": "GIÁO DỤC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🎓",
  "source_url": "https://learningenglish.voanews.com/a/us-withdraws-planned-visa-restriction-for-international-students/5502876.html",
  "paragraphs": [
    {
      "en": "The administration of U.S. President Donald Trump has withdrawn planned visa restrictions for international students. The restrictions would have forced international students to leave the country if their schools held classes online because of the coronavirus crisis.",
      "vi": "Chính quyền của Tổng thống Mỹ Donald Trump đã rút lại kế hoạch hạn chế visa đối với du học sinh quốc tế. Các hạn chế này sẽ buộc du học sinh phải rời khỏi Mỹ nếu trường của họ chuyển sang học trực tuyến vì khủng hoảng virus corona."
    },
    {
      "en": "The surprise announcement came during a federal court hearing on Tuesday in Boston, Massachusetts. Both Harvard University and the Massachusetts Institute of Technology (MIT) had filed the legal action seeking to overturn the rule.",
      "vi": "Thông báo bất ngờ được đưa ra trong một phiên tòa liên bang vào thứ Ba tại Boston, Massachusetts. Cả Đại học Harvard và Học viện Công nghệ Massachusetts (MIT) đều đã đệ đơn kiện nhằm lật ngược quy định này."
    },
    {
      "en": "Judge Allison Burroughs said federal immigration officials had agreed to cancel the planned restrictions, which were announced July 6, and “return to the status quo.”",
      "vi": "Thẩm phán Allison Burroughs cho biết các quan chức nhập cư liên bang đã đồng ý hủy bỏ các hạn chế dự kiến (được công bố ngày 6/7) và “trở lại trạng thái ban đầu”."
    },
    {
      "en": "The decision means that international students are again permitted to attend classes online and keep their visas during the health emergency “exemption.” Immigration and Customs Enforcement (ICE) had established the exemption on March 13, when the coronavirus was spreading across the country.",
      "vi": "Quyết định này có nghĩa là du học sinh một lần nữa được phép học trực tuyến và giữ visa trong thời gian miễn trừ khẩn cấp y tế. Cơ quan Thực thi Di trú và Hải quan (ICE) đã thiết lập quy định miễn trừ này vào ngày 13/3, khi virus corona đang lan rộng khắp cả nước."
    },
    {
      "en": "But on July 6, the agency said international students must take at least some of their college classes in person during the upcoming autumn term. If they could not, they must transfer to another school offering in-person classes or leave the country. The agency added that students would have to leave the country even if a health emergency forces their classes online after the school year begins.",
      "vi": "Nhưng đến ngày 6/7, cơ quan này lại yêu cầu du học sinh phải học trực tiếp ít nhất một số môn trong học kỳ mùa thu sắp tới. Nếu không, họ phải chuyển sang trường khác có lớp học trực tiếp hoặc rời khỏi Mỹ. Cơ quan này còn nói rằng sinh viên sẽ phải rời đi ngay cả khi tình trạng khẩn cấp y tế buộc lớp học chuyển trực tuyến sau khi năm học bắt đầu."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Giáo dục (Education)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "The Trump administration withdrew planned visa restrictions for international students.",
      "vi": "Chính quyền Trump đã rút lại kế hoạch hạn chế visa đối với du học sinh."
    },
    {
      "en": "Harvard and MIT sued to overturn the rule, and a judge confirmed its cancellation.",
      "vi": "Harvard và MIT đã kiện để lật ngược quy định, và thẩm phán xác nhận việc hủy bỏ."
    },
    {
      "en": "International students can again study online and keep their visas during the health emergency.",
      "vi": "Du học sinh lại được học trực tuyến và giữ visa trong thời gian khẩn cấp y tế."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What did the Trump administration withdraw?",
      "opts": [
        "A travel ban on tourists",
        "Planned visa restrictions for international students",
        "A new student loan program",
        "Funding for Harvard University"
      ],
      "answer": 1,
      "explain": "The administration withdrew planned visa restrictions for international students."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Which two schools filed legal action against the rule?",
      "opts": [
        "Yale and Princeton",
        "Harvard and MIT",
        "Stanford and UCLA",
        "Columbia and NYU"
      ],
      "answer": 1,
      "explain": "Harvard University and MIT filed the legal action seeking to overturn the rule."
    },
    {
      "type": "TỪ VỰNG",
      "q": "The word 'overturn' in the article is closest in meaning to...",
      "opts": [
        "cancel or reverse",
        "support strongly",
        "delay slightly",
        "announce publicly"
      ],
      "answer": 0,
      "explain": "To overturn a rule means to cancel or reverse it."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why did the restriction cause concern for international students?",
      "opts": [
        "It raised their tuition fees",
        "It could force them to leave the US if classes went online",
        "It banned them from using libraries",
        "It required them to learn English faster"
      ],
      "answer": 1,
      "explain": "Students would have to leave the country if their schools held classes online."
    }
  ],
  "suggestions": [
    "Tóm tắt bài đọc này",
    "Vì sao Harvard và MIT kiện?",
    "Quy định visa này ảnh hưởng đến ai?",
    "Giải thích từ 'exemption'"
  ]
},
 {
  "id": "voa-ukraine-surgeon",
  "title": "Ukraine Surgeon Operates on Soldiers All Day Long",
  "titleVi": "Bác sĩ phẫu thuật Ukraine mổ xuyên ngày đêm",
  "subtitle": "Level 2 · Intermediate",
  "category": "NHÂN VẬT · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🩺",
  "source_url": "https://learningenglish.voanews.com/a/ukraine-surgeon-operates-on-soldiers-all-day-long/7107083.html",
  "paragraphs": [
    {
      "en": "Petro Nikitin is the lead trauma surgeon at a military hospital in Ukraine's capital, Kyiv. The 59-year-old doctor works to repair the bodies of some of the most badly injured soldiers.",
      "vi": "Petro Nikitin là bác sĩ phẫu thuật chấn thương chính tại một bệnh viện quân đội ở thủ đô Kyiv của Ukraine. Vị bác sĩ 59 tuổi này đang ngày đêm cứu chữa những binh sĩ bị thương nặng nhất."
    },
    {
      "en": "“I only operate,” Nikitin said as his team continued surgery on a patient. “I do nothing else in my life now.”",
      "vi": "“Tôi chỉ mổ thôi,” Nikitin nói trong khi nhóm của ông vẫn đang phẫu thuật cho một bệnh nhân. “Giờ đây tôi không làm gì khác trong đời nữa.”"
    },
    {
      "en": "Experts estimate more than 100,000 Ukrainian troops have been killed or wounded since Russia invaded the country almost 15 months ago.",
      "vi": "Các chuyên gia ước tính hơn 100.000 binh sĩ Ukraine đã thiệt mạng hoặc bị thương kể từ khi Nga tiến đánh nước này gần 15 tháng trước."
    },
    {
      "en": "Fighting has been very fierce in recent weeks around the eastern city of Bakhmut. It is the war's longest and bloodiest battle. Ukrainian forces recently took back more territory from the Russians.",
      "vi": "Giao tranh đã diễn ra rất ác liệt trong những tuần gần đây quanh thành phố Bakhmut ở phía đông. Đây là trận đánh kéo dài và đẫm máu nhất của cuộc chiến. Lực lượng Ukraine gần đây đã giành lại thêm lãnh thổ từ tay người Nga."
    },
    {
      "en": "Like other Ukrainian military hospitals, it lacks enough workers because doctors were pulled away to work in field hospitals closer to the fighting. The Associated Press agreed not to identify the Kyiv hospital for security reasons.",
      "vi": "Giống như các bệnh viện quân đội khác của Ukraine, bệnh viện này thiếu nhân lực vì nhiều bác sĩ đã được điều đi làm việc tại các bệnh viện dã chiến gần mặt trận hơn. Hãng tin AP đồng ý không nêu tên bệnh viện ở Kyiv vì lý do an ninh."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Nhân vật (People)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Petro Nikitin, 59, is the lead trauma surgeon repairing badly wounded Ukrainian soldiers in Kyiv.",
      "vi": "Petro Nikitin, 59 tuổi, là bác sĩ phẫu thuật chấn thương chính cứu chữa các binh sĩ Ukraine bị thương nặng tại Kyiv."
    },
    {
      "en": "Over 100,000 Ukrainian troops have been killed or wounded since the invasion.",
      "vi": "Hơn 100.000 binh sĩ Ukraine đã thiệt mạng hoặc bị thương kể từ khi chiến sự nổ ra."
    },
    {
      "en": "Military hospitals lack staff because doctors were sent to field hospitals near the fighting.",
      "vi": "Các bệnh viện quân đội thiếu nhân lực vì bác sĩ đã được điều ra bệnh viện dã chiến gần mặt trận."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What is Petro Nikitin's job?",
      "opts": [
        "A field nurse",
        "The lead trauma surgeon at a military hospital",
        "A hospital director in Lviv",
        "A medical student"
      ],
      "answer": 1,
      "explain": "Nikitin is the lead trauma surgeon at a military hospital in Kyiv."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Around which city has fighting been very fierce?",
      "opts": [
        "Kyiv",
        "Lviv",
        "Bakhmut",
        "Odesa"
      ],
      "answer": 2,
      "explain": "Fighting has been very fierce around the eastern city of Bakhmut."
    },
    {
      "type": "TỪ VỰNG",
      "q": "The word 'fierce' in the article is closest in meaning to...",
      "opts": [
        "gentle",
        "violent and intense",
        "slow",
        "quiet"
      ],
      "answer": 1,
      "explain": "Fierce fighting means violent, intense fighting."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main idea of the article?",
      "opts": [
        "A Ukrainian surgeon works nonstop to save wounded soldiers",
        "Kyiv is a safe city",
        "Field hospitals are closing down",
        "The war is about to end"
      ],
      "answer": 0,
      "explain": "The article focuses on surgeon Petro Nikitin, who does nothing but operate on injured soldiers."
    }
  ],
  "suggestions": [
    "Tóm tắt bài đọc này",
    "Bakhmut có gì đặc biệt?",
    "Bác sĩ Nikitin bao nhiêu tuổi?",
    "Giải thích từ 'trauma surgeon'"
  ]
},
 {
  "id": "voa-nobel-physics-electrons",
  "title": "Three Professors Share Nobel Physics Prize for Study of Electrons",
  "titleVi": "Ba nhà khoa học chia nhau giải Nobel Vật lý",
  "subtitle": "Level 2 · Intermediate",
  "category": "NHÀ KHOA HỌC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🏆",
  "source_url": "https://learningenglish.voanews.com/a/three-professors-share-nobel-physics-prize-for-study-of-electrons-/7295311.html",
  "paragraphs": [
    {
      "en": "Three European physics professors won the Nobel Prize on Tuesday for their work on a system that permits scientists to study electrons.",
      "vi": "Ba giáo sư vật lý người châu Âu đã giành giải Nobel vào thứ Ba nhờ công trình nghiên cứu hệ thống cho phép các nhà khoa học nghiên cứu hạt electron."
    },
    {
      "en": "The professors carried out research that showed how ultra-fast light could permit scientists to “see” an electron for the first time.",
      "vi": "Các giáo sư đã thực hiện nghiên cứu cho thấy ánh sáng siêu nhanh có thể giúp các nhà khoa học “nhìn thấy” hạt electron lần đầu tiên."
    },
    {
      "en": "“You can see whether it’s on one side of a molecule or on the other,” L’Huillier, 65, said. “It’s still very blurry.”",
      "vi": "“Bạn có thể thấy nó ở phía bên này hay phía bên kia của một phân tử,” bà L’Huillier, 65 tuổi, nói. “Nó vẫn còn rất mờ.”"
    },
    {
      "en": "The system that came from their work creates light that shows the fast-moving electron in its orbit around the nucleus.",
      "vi": "Hệ thống ra đời từ công trình của họ tạo ra ánh sáng cho thấy hạt electron chuyển động cực nhanh trên quỹ đạo quanh hạt nhân."
    },
    {
      "en": "Krausz’s team first created the short light pulses in the early 2000s. He said the system is similar to a camera with a fast shutter speed that permits a photographer to capture a Formula One race car as it crosses the finish line.",
      "vi": "Nhóm của Krausz lần đầu tiên tạo ra các xung ánh sáng ngắn vào đầu những năm 2000. Ông cho biết hệ thống này giống như một chiếc máy ảnh có tốc độ màn trập cực nhanh, giúp nhiếp ảnh gia chụp được khoảnh khắc xe đua Công thức 1 cán đích."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Nhà khoa học (Scientists)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Three professors won the Nobel Prize in Physics for work that lets scientists study electrons.",
      "vi": "Ba giáo sư đã giành giải Nobel Vật lý nhờ công trình giúp các nhà khoa học nghiên cứu hạt electron."
    },
    {
      "en": "Their research showed ultra-fast light can 'see' an electron for the first time.",
      "vi": "Nghiên cứu của họ cho thấy ánh sáng siêu nhanh có thể “nhìn thấy” hạt electron lần đầu tiên."
    },
    {
      "en": "The system works like a fast-shutter camera capturing a race car at the finish line.",
      "vi": "Hệ thống hoạt động như máy ảnh màn trập nhanh chụp xe đua cán đích."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What did the three professors win the Nobel Prize for?",
      "opts": [
        "Discovering a new planet",
        "Work on a system to study electrons",
        "Inventing a new camera",
        "Building a race car"
      ],
      "answer": 1,
      "explain": "They won for work on a system that permits scientists to study electrons."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "When did Krausz's team first create the short light pulses?",
      "opts": [
        "In the early 2000s",
        "In the 1990s",
        "Last year",
        "In the 1970s"
      ],
      "answer": 0,
      "explain": "Krausz's team first created the short light pulses in the early 2000s."
    },
    {
      "type": "TỪ VỰNG",
      "q": "The word 'blurry' in the article is closest in meaning to...",
      "opts": [
        "very clear",
        "not clear; hard to see",
        "colorful",
        "bright"
      ],
      "answer": 1,
      "explain": "Blurry means not clear or hard to see distinctly."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why does Krausz compare the system to a fast-shutter camera?",
      "opts": [
        "Both use film",
        "Both capture extremely fast movement clearly",
        "Both are expensive",
        "Both were invented in Hungary"
      ],
      "answer": 1,
      "explain": "A fast shutter freezes fast motion, just as the light pulses capture the fast-moving electron."
    }
  ],
  "suggestions": [
    "Tóm tắt bài đọc này",
    "Electron là gì?",
    "Ba nhà khoa học này là ai?",
    "Vì sao công trình này đoạt Nobel?"
  ]
},
 {
  "id": "voa-noncount-mass-nouns",
  "title": "Noncount and Mass Nouns",
  "titleVi": "Danh từ không đếm được trong tiếng Anh",
  "subtitle": "Level 2 · Intermediate",
  "category": "GIÁO DỤC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "📝",
  "source_url": "https://learningenglish.voanews.com/a/noncount-and-mass-nouns/7109448.html",
  "paragraphs": [
    {
      "en": "How do we know how to use the singular and plural of some nouns like “effort” vs. “efforts?” Both show in people's writing.",
      "vi": "Làm sao biết khi nào dùng số ít, khi nào dùng số nhiều với những danh từ như “effort” và “efforts”? Cả hai dạng đều xuất hiện trong bài viết của mọi người."
    },
    {
      "en": "Thank you for your question. These words are in a group called “mass” or “noncount” nouns. These nouns are not counted as individual things.",
      "vi": "Cảm ơn bạn đã đặt câu hỏi. Những từ này thuộc nhóm gọi là danh từ “khối” hay danh từ “không đếm được”. Người ta không đếm chúng như những vật riêng lẻ."
    },
    {
      "en": "They present problems even for native speakers of English sometimes. While there are many noncount and mass nouns, we will provide some general rules to help you use them.",
      "vi": "Đôi khi chúng còn gây khó cho cả người bản ngữ. Dù có rất nhiều danh từ không đếm được, chúng tôi sẽ đưa ra một số quy tắc chung giúp bạn dùng đúng."
    },
    {
      "en": "Noncount and mass nouns do not have a plural form. For example, sand or milk would be difficult to count. Particles of sand are too small and numerous, and milk is a liquid.",
      "vi": "Danh từ không đếm được không có dạng số nhiều. Ví dụ, cát hay sữa rất khó đếm: hạt cát quá nhỏ và quá nhiều, còn sữa là chất lỏng."
    },
    {
      "en": "In some cases, “faculty” is a collective noun, not a mass noun. Collective nouns describe many individuals who form a group. For example, the “faculty” is made up of individual teachers.",
      "vi": "Trong một số trường hợp, “faculty” là danh từ tập hợp chứ không phải danh từ khối. Danh từ tập hợp chỉ nhiều cá thể tạo thành một nhóm — ví dụ, “faculty” gồm các giáo viên riêng lẻ."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Ngữ pháp (Grammar)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Mass or noncount nouns name things that are not counted as individual items.",
      "vi": "Danh từ khối (không đếm được) chỉ những thứ không đếm theo từng vật riêng lẻ."
    },
    {
      "en": "Noncount nouns have no plural form, such as ‘sand’ or ‘milk’.",
      "vi": "Danh từ không đếm được không có dạng số nhiều, ví dụ ‘sand’ hay ‘milk’."
    },
    {
      "en": "Some nouns like ‘faculty’ can be collective nouns, describing a group of individuals.",
      "vi": "Một số danh từ như ‘faculty’ có thể là danh từ tập hợp, chỉ một nhóm gồm nhiều cá thể."
    }
  ],
  "quiz": [
    {
      "type": "Ý CHÍNH",
      "q": "What is the main topic of the article?",
      "opts": [
        "How to count money in English",
        "How to use noncount and mass nouns",
        "How to write plural nouns correctly",
        "How to teach grammar to children"
      ],
      "answer": 1,
      "explain": "The article explains what mass or noncount nouns are and gives general rules for using them."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "According to the article, why is ‘sand’ a noncount noun?",
      "opts": [
        "Because it is expensive",
        "Because its particles are too small and numerous to count",
        "Because it is a liquid",
        "Because it has no singular form"
      ],
      "answer": 1,
      "explain": "The article says particles of sand are too small and numerous, so sand cannot be counted."
    },
    {
      "type": "TỪ VỰNG",
      "q": "What does a collective noun describe?",
      "opts": [
        "A single object",
        "A liquid substance",
        "Many individuals forming a group",
        "An uncountable feeling"
      ],
      "answer": 2,
      "explain": "The article defines collective nouns as words describing many individuals who form a group, like ‘faculty’."
    },
    {
      "type": "SUY LUẬN",
      "q": "What can we infer from the article?",
      "opts": [
        "Only beginners have trouble with noncount nouns",
        "Noncount nouns never cause problems",
        "Even native speakers sometimes struggle with these nouns",
        "All English nouns have plural forms"
      ],
      "answer": 2,
      "explain": "The article states that these nouns present problems even for native speakers sometimes."
    }
  ],
  "suggestions": [
    "Danh từ không đếm được là gì?",
    "Cho ví dụ về danh từ khối.",
    "Phân biệt danh từ tập hợp và danh từ khối.",
    "‘Faculty’ dùng số ít hay số nhiều?"
  ]
},
 {
  "id": "voa-mimas-ocean",
  "title": "Scientists: Icy Moon of Saturn Likely Has an Underground Ocean",
  "titleVi": "Mặt trăng băng giá của Sao Thổ có thể ẩn giấu đại dương",
  "subtitle": "Level 2 · Intermediate",
  "category": "KHOA HỌC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🪐",
  "source_url": "https://learningenglish.voanews.com/a/scientists-icy-moon-of-saturn-likely-has-an-underground-ocean/7484026.html",
  "paragraphs": [
    {
      "en": "Astronomers based their finding on data collected by the American space agency NASA’s Cassini spacecraft. Cassini observed Saturn and its more than 140 moons for more than 10 years before ending operations in 2017.",
      "vi": "Các nhà thiên văn đưa ra phát hiện này dựa trên dữ liệu do tàu vũ trụ Cassini của cơ quan vũ trụ Mỹ NASA thu thập. Cassini đã quan sát Sao Thổ và hơn 140 mặt trăng của nó trong hơn 10 năm trước khi kết thúc sứ mệnh năm 2017."
    },
    {
      "en": "The spacecraft’s data covered details about the moon’s orbit and rotation. Researchers reported the data provided the best evidence yet of a hidden ocean about 20 to 30 kilometers beneath the frozen surface.",
      "vi": "Dữ liệu của tàu bao gồm chi tiết về quỹ đạo và chuyển động tự quay của mặt trăng. Các nhà nghiên cứu cho biết đây là bằng chứng rõ ràng nhất từ trước đến nay về một đại dương ẩn sâu khoảng 20 đến 30 km dưới bề mặt băng giá."
    },
    {
      "en": "Mimas is a relatively small moon, about 400 kilometers wide. Researchers say Mimas lacks formations on its surface found on other moons, which suggest the presence of underground water. These can include a broken surface as well as geyser activity.",
      "vi": "Mimas là một mặt trăng khá nhỏ, rộng khoảng 400 km. Các nhà nghiên cứu cho biết bề mặt Mimas không có những cấu trúc thường thấy trên các mặt trăng khác — vốn là dấu hiệu của nước ngầm, chẳng hạn như bề mặt nứt vỡ hay hoạt động của mạch nước phun."
    },
    {
      "en": "Valery Lainey, of the Paris Observatory, was co-author of a study describing the research in the publication Nature. “Mimas was probably the most unlikely place to look for a global ocean — and liquid water more generally,” he said in an email to the Associated Press.",
      "vi": "Valery Lainey thuộc Đài thiên văn Paris là đồng tác giả của nghiên cứu đăng trên tạp chí Nature. Trong email gửi hãng tin AP, ông nói: “Mimas có lẽ là nơi ít ai ngờ nhất để tìm một đại dương — hay nước lỏng nói chung.”"
    },
    {
      "en": "Lainey added, “So that looks like a potential(ly) habitable world. But nobody knows how much time is needed for life to arise.”",
      "vi": "Ông nói thêm: “Vì vậy, đây có vẻ là một thế giới tiềm năng có thể sinh sống được. Nhưng chưa ai biết cần bao nhiêu thời gian để sự sống hình thành.”"
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Khoa học vũ trụ (Space Science)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Data from NASA’s Cassini spacecraft suggests Mimas has a hidden ocean 20–30 km under its icy surface.",
      "vi": "Dữ liệu từ tàu Cassini của NASA cho thấy Mimas có thể ẩn giấu một đại dương sâu 20–30 km dưới lớp băng."
    },
    {
      "en": "Mimas was considered an unlikely place for an ocean because its surface shows no signs of underground water.",
      "vi": "Mimas từng bị coi là nơi khó có đại dương vì bề mặt không hề có dấu hiệu của nước ngầm."
    },
    {
      "en": "If confirmed, Mimas could be a potentially habitable world, though how life might arise there is unknown.",
      "vi": "Nếu được xác nhận, Mimas có thể là một thế giới tiềm năng cho sự sống, dù chưa ai biết sự sống hình thành ở đó ra sao."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "How deep is the possible hidden ocean beneath Mimas’s surface?",
      "opts": [
        "2 to 3 kilometers",
        "20 to 30 kilometers",
        "200 to 300 kilometers",
        "400 kilometers"
      ],
      "answer": 1,
      "explain": "The article says researchers found evidence of a hidden ocean about 20 to 30 kilometers beneath the frozen surface."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "How long did the Cassini spacecraft observe Saturn and its moons?",
      "opts": [
        "Less than a year",
        "About five years",
        "More than 10 years",
        "More than 20 years"
      ],
      "answer": 2,
      "explain": "The article states that Cassini observed Saturn and its more than 140 moons for more than 10 years before ending operations in 2017."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why was Mimas considered an unlikely place to find an ocean?",
      "opts": [
        "It is too far from Saturn",
        "It is too large to have water",
        "Its surface lacks formations linked to underground water",
        "It has no ice on its surface"
      ],
      "answer": 2,
      "explain": "The article explains that Mimas lacks surface formations found on other moons, which suggest underground water."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main finding of the study?",
      "opts": [
        "Mimas has no water at all",
        "Mimas likely hides an underground ocean",
        "Cassini discovered a new moon",
        "Life has been found on Mimas"
      ],
      "answer": 1,
      "explain": "The study provides the best evidence yet that the icy moon Mimas likely has an underground ocean."
    }
  ],
  "suggestions": [
    "Tàu Cassini đã phát hiện gì ở Mimas?",
    "Vì sao Mimas ít được ngờ tới có đại dương?",
    "Đại dương ngầm sâu bao nhiêu km?",
    "Mimas có thể có sự sống không?"
  ]
},
 {
  "id": "voa-africa-underground-water",
  "title": "Cost, Difficulty Prevent Africans from Getting to Underground Water",
  "titleVi": "Nước ngầm châu Phi: tiềm năng lớn, khai thác khó",
  "subtitle": "Level 2 · Intermediate",
  "category": "MÔI TRƯỜNG · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "💧",
  "source_url": "https://learningenglish.voanews.com/a/cost-difficulty-prevent-africans-from-getting-to-underground-water/6519472.html",
  "paragraphs": [
    {
      "en": "A recent study suggests that ground water is an answer to water shortages in African countries south of the Sahara Desert.",
      "vi": "Một nghiên cứu gần đây cho thấy nước ngầm có thể là lời giải cho tình trạng thiếu nước ở các nước châu Phi phía nam sa mạc Sahara."
    },
    {
      "en": "WaterAid, an international non-profit group, and the British Geological Survey (BGS), a British government organization, carried out the research. It found that underground water could help African countries deal with at least five years of drought.",
      "vi": "Tổ chức phi lợi nhuận quốc tế WaterAid và Cơ quan Khảo sát Địa chất Anh (BGS) đã thực hiện nghiên cứu này. Kết quả cho thấy nước ngầm có thể giúp các nước châu Phi chống chọi với hạn hán kéo dài ít nhất năm năm."
    },
    {
      "en": "The report released in March said underground water could help develop agriculture in the area. Additional water resources could help farming in an area where only three to five percent of agricultural land is irrigated.",
      "vi": "Báo cáo công bố hồi tháng Ba cho biết nước ngầm có thể giúp phát triển nông nghiệp trong khu vực. Nguồn nước bổ sung sẽ hỗ trợ canh tác ở nơi mà hiện chỉ 3 đến 5% đất nông nghiệp được tưới tiêu."
    },
    {
      "en": "For example, BGS information shows Senegal has an aquifer, or underground water supply, that has been kept in good condition by years of rainfall. But getting to the water is difficult and costly. Experts say it is hard to find scientists who are trained at finding underground water.",
      "vi": "Ví dụ, dữ liệu của BGS cho thấy Senegal có một tầng chứa nước ngầm được duy trì tốt nhờ lượng mưa nhiều năm. Nhưng tiếp cận nguồn nước này vừa khó vừa tốn kém. Các chuyên gia cho biết rất khó tìm được nhà khoa học được đào tạo bài bản về dò tìm nước ngầm."
    },
    {
      "en": "Tata Bathily is a village in northern Senegal. When a well there began to dry up in 2010, the government dug another one. That well began to dry up too. Then the town raised $5,000 to dig a new well last year. But that well also failed.",
      "vi": "Tata Bathily là một ngôi làng ở miền bắc Senegal. Khi một giếng nước ở đây bắt đầu cạn vào năm 2010, chính phủ đã cho đào giếng khác. Giếng mới rồi cũng cạn. Năm ngoái, người dân quyên góp 5.000 đô la để đào giếng mới, nhưng giếng đó cũng thất bại."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Môi trường (Environment)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "A recent study says underground water could solve water shortages in sub-Saharan Africa.",
      "vi": "Một nghiên cứu mới cho rằng nước ngầm có thể giải quyết tình trạng thiếu nước ở châu Phi hạ Sahara."
    },
    {
      "en": "Underground water could help countries survive long droughts and develop agriculture.",
      "vi": "Nước ngầm có thể giúp các nước chống hạn hán kéo dài và phát triển nông nghiệp."
    },
    {
      "en": "Reaching the water is difficult and costly, and experts in finding it are rare.",
      "vi": "Việc tiếp cận nguồn nước ngầm vừa khó khăn vừa tốn kém, lại thiếu chuyên gia dò tìm."
    }
  ],
  "quiz": [
    {
      "type": "Ý CHÍNH",
      "q": "What is the main idea of the article?",
      "opts": [
        "Africa has no underground water",
        "Groundwater could help solve Africa’s water shortages",
        "Senegal has the most rainfall in Africa",
        "Wells are easy to dig in Africa"
      ],
      "answer": 1,
      "explain": "The article reports that a study found groundwater could answer water shortages in African countries south of the Sahara."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Who carried out the research mentioned in the article?",
      "opts": [
        "The United Nations alone",
        "WaterAid and the British Geological Survey",
        "The government of Senegal",
        "NASA scientists"
      ],
      "answer": 1,
      "explain": "The article says WaterAid and the British Geological Survey carried out the research."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What happened in the village of Tata Bathily?",
      "opts": [
        "It found a large underground lake",
        "Its wells kept drying up despite new digging",
        "It refused government help",
        "It moved to a new location"
      ],
      "answer": 1,
      "explain": "The article describes how wells in Tata Bathily dried up repeatedly, and even a new $5,000 well failed."
    },
    {
      "type": "SUY LUẬN",
      "q": "What is a major challenge in using underground water in Africa?",
      "opts": [
        "There is too much rainfall",
        "It is difficult and costly to reach the water",
        "Africans do not need more water",
        "Underground water is polluted everywhere"
      ],
      "answer": 1,
      "explain": "The article notes that getting to the water is difficult and costly, and trained experts are hard to find."
    }
  ],
  "suggestions": [
    "Nước ngầm giúp châu Phi thế nào?",
    "Ai thực hiện nghiên cứu này?",
    "Vì sao khó khai thác nước ngầm?",
    "Chuyện gì xảy ra ở làng Tata Bathily?"
  ]
},
 {
  "id": "voa-2023-warmest-year",
  "title": "2023 Likely to Be Warmest Year in Recorded History",
  "titleVi": "2023 có thể là năm nóng nhất trong lịch sử",
  "subtitle": "Level 2 · Intermediate",
  "category": "MÔI TRƯỜNG · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🌡️",
  "source_url": "https://learningenglish.voanews.com/a/likely-to-be-warmest-year-in-recorded-history/7346961.html",
  "paragraphs": [
    {
      "en": "European researchers say a very hot October has put 2023 on a likely path to become the warmest year in recorded history.",
      "vi": "Các nhà nghiên cứu châu Âu cho biết tháng Mười nóng bất thường đã đưa năm 2023 vào lộ trình trở thành năm nóng nhất trong lịch sử ghi nhận."
    },
    {
      "en": "Last month, world temperatures beat a 2019 record for warmest October on record by 0.4 degrees, scientists from the European Union’s Copernicus Climate Change Service announced. The EU agency issues monthly reports on climate observations across Europe.",
      "vi": "Tháng trước, nhiệt độ toàn cầu đã vượt kỷ lục tháng Mười nóng nhất năm 2019 tới 0,4 độ, theo công bố của Cơ quan Biến đổi Khí hậu Copernicus thuộc Liên minh châu Âu — đơn vị phát hành báo cáo quan trắc khí hậu hằng tháng."
    },
    {
      "en": "The latest October record nearly guarantees that 2023 will be the hottest year on record, said Copernicus deputy director Samantha Burgess. “The amount that we’re smashing records by is shocking,” Burgess told The Associated Press (AP).",
      "vi": "Kỷ lục tháng Mười mới nhất gần như chắc chắn khiến 2023 trở thành năm nóng nhất từng ghi nhận, theo bà Samantha Burgess, phó giám đốc Copernicus. Trả lời hãng tin AP, bà nói: “Mức độ chúng ta đang phá vỡ các kỷ lục thật đáng kinh ngạc.”"
    },
    {
      "en": "Scientists have long linked rising world temperatures to gases from the burning of fossil fuels. El Niño has also been warming ocean waters this year.",
      "vi": "Từ lâu các nhà khoa học đã chỉ ra mối liên hệ giữa nhiệt độ toàn cầu tăng và khí thải từ đốt nhiên liệu hóa thạch. Năm nay, hiện tượng El Niño cũng làm nước biển ấm lên."
    },
    {
      "en": "El Niño is a warming of surface temperatures in the eastern and central Pacific Ocean. The event usually causes hot, dry weather in Asia and Australia and can drive weather changes in other parts of the world.",
      "vi": "El Niño là hiện tượng nhiệt độ mặt biển tăng ở phía đông và trung tâm Thái Bình Dương. Nó thường gây thời tiết nóng, khô ở châu Á và Australia, đồng thời có thể làm thay đổi thời tiết ở nhiều nơi khác trên thế giới."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Môi trường (Environment)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "A record-hot October nearly guaranteed 2023 would be the warmest year ever recorded.",
      "vi": "Tháng Mười nóng kỷ lục đã khiến 2023 gần như chắc chắn trở thành năm nóng nhất từng được ghi nhận."
    },
    {
      "en": "October 2023 beat the 2019 record by 0.4 degrees, shocking scientists.",
      "vi": "Tháng 10/2023 vượt kỷ lục năm 2019 tới 0,4 độ, khiến giới khoa học sửng sốt."
    },
    {
      "en": "Rising temperatures are linked to fossil fuel emissions and the El Niño weather pattern.",
      "vi": "Nhiệt độ tăng liên quan đến khí thải nhiên liệu hóa thạch và hiện tượng El Niño."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "By how much did October 2023 beat the 2019 warmth record?",
      "opts": [
        "0.1 degrees",
        "0.4 degrees",
        "1.4 degrees",
        "4 degrees"
      ],
      "answer": 1,
      "explain": "The article says world temperatures beat the 2019 record for warmest October by 0.4 degrees."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Which organization announced the October temperature record?",
      "opts": [
        "NASA",
        "The World Bank",
        "The EU’s Copernicus Climate Change Service",
        "The Red Cross"
      ],
      "answer": 2,
      "explain": "Scientists from the European Union’s Copernicus Climate Change Service announced the record."
    },
    {
      "type": "SUY LUẬN",
      "q": "What are the two main causes of rising temperatures mentioned in the article?",
      "opts": [
        "Volcanoes and earthquakes",
        "Fossil fuel gases and El Niño",
        "Deforestation and overfishing",
        "Solar flares and meteors"
      ],
      "answer": 1,
      "explain": "The article links rising temperatures to gases from burning fossil fuels and to El Niño warming ocean waters."
    },
    {
      "type": "TỪ VỰNG",
      "q": "In the article, what does ‘smashing records’ mean?",
      "opts": [
        "Breaking records by a large amount",
        "Hitting records with a hammer",
        "Ignoring old records",
        "Recording music"
      ],
      "answer": 0,
      "explain": "Burgess used ‘smashing records’ to describe how far new temperature highs exceed old ones."
    }
  ],
  "suggestions": [
    "Vì sao 2023 nóng kỷ lục?",
    "El Niño là gì?",
    "Copernicus là tổ chức nào?",
    "Nhiên liệu hóa thạch ảnh hưởng khí hậu thế nào?"
  ]
},
 {
  "id": "voa-pawpaw-tree",
  "title": "The Pawpaw: An Easy to Grow Tree with Tasty Fruit",
  "titleVi": "Cây pawpaw: dễ trồng, quả ngon",
  "subtitle": "Level 2 · Intermediate",
  "category": "THIÊN NHIÊN · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🌳",
  "source_url": "https://learningenglish.voanews.com/a/the-pawpaw-an-easy-to-grow-tree-with-tasty-fruit/7170353.html",
  "paragraphs": [
    {
      "en": "For Americans, one possible choice is the pawpaw, a tree that looks tropical but is native to much of North America.",
      "vi": "Với người Mỹ, một lựa chọn khả dĩ là cây pawpaw — loài cây trông như cây nhiệt đới nhưng có nguồn gốc từ phần lớn khu vực Bắc Mỹ."
    },
    {
      "en": "Associated Press writer Jessica Damiano is an expert in plants and gardening. She writes, “Also known as Hoosier banana, poor man’s banana and false banana, the sadly underused (pawpaw) will transport you to the tropics.”",
      "vi": "Jessica Damiano, cây bút của hãng tin AP và là chuyên gia về cây cối, viết: “Còn được gọi là chuối Hoosier, chuối nhà nghèo hay chuối giả, loài cây pawpaw đáng tiếc chưa được tận dụng này sẽ đưa bạn đến miền nhiệt đới.”"
    },
    {
      "en": "Pawpaw trees can be found growing wild from southern Ontario in Canada, to neighboring Michigan in the northern United States. The trees are also commonly found in western New York and in the southern states of Texas and Florida.",
      "vi": "Cây pawpaw mọc hoang từ miền nam Ontario (Canada) đến Michigan ở phía bắc nước Mỹ, cũng như ở phía tây New York và các bang miền nam như Texas, Florida."
    },
    {
      "en": "Pawpaws are known to grow well across large areas of the U.S. The small, triangular trees can reach heights up to nearly eight meters. They love humid weather and are highly resistant to freezing.",
      "vi": "Pawpaw được biết đến là dễ trồng trên nhiều vùng rộng lớn của nước Mỹ. Cây nhỏ, tán hình tam giác, cao tới gần 8 mét, ưa khí hậu ẩm và chịu rét rất tốt."
    },
    {
      "en": "The branches are covered by maroon-colored blossoms in the spring. Then groups of heavy, eight-to-12-centimeter-long fruits that look like mangoes start to develop. In autumn, the trees’ yellow or gold leaves will brighten your property. And deer usually avoid the trees.",
      "vi": "Mùa xuân, cành cây phủ đầy hoa màu nâu đỏ. Sau đó, những chùm quả nặng, dài 8–12 cm trông như quả xoài bắt đầu hình thành. Mùa thu, lá vàng óng của cây làm bừng sáng cả khu vườn — mà hươu thường tránh xa loài cây này."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Thiên nhiên (Nature)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "The pawpaw is a North American native tree that looks tropical and produces tasty fruit.",
      "vi": "Pawpaw là cây bản địa Bắc Mỹ, dáng vẻ nhiệt đới và cho quả ngon."
    },
    {
      "en": "It grows wild across a wide area, loves humidity, and resists freezing well.",
      "vi": "Cây mọc hoang trên vùng rộng, ưa ẩm và chịu rét tốt."
    },
    {
      "en": "Its mango-like fruits, colorful blossoms, and deer resistance make it great for home gardens.",
      "vi": "Quả giống xoài, hoa đẹp và hươu tránh xa khiến pawpaw rất hợp trồng trong vườn nhà."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Where is the pawpaw tree native to?",
      "opts": [
        "South America",
        "Southeast Asia",
        "Much of North America",
        "Southern Europe"
      ],
      "answer": 2,
      "explain": "The article says the pawpaw looks tropical but is native to much of North America."
    },
    {
      "type": "TỪ VỰNG",
      "q": "What are some other names for the pawpaw?",
      "opts": [
        "Apple banana and cherry banana",
        "Hoosier banana, poor man’s banana and false banana",
        "Mango banana and melon banana",
        "Royal banana and king banana"
      ],
      "answer": 1,
      "explain": "The article lists its nicknames: Hoosier banana, poor man’s banana, and false banana."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "How tall can pawpaw trees grow?",
      "opts": [
        "Up to nearly eight meters",
        "Up to eighty meters",
        "Only one meter",
        "Up to two meters"
      ],
      "answer": 0,
      "explain": "The article states the small, triangular trees can reach heights up to nearly eight meters."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why might gardeners like planting pawpaw trees?",
      "opts": [
        "They need no water at all",
        "Deer usually avoid them and they have attractive fruit and leaves",
        "They grow only in deserts",
        "Their fruit tastes like chocolate"
      ],
      "answer": 1,
      "explain": "The article notes deer avoid the trees, and their mango-like fruits and golden autumn leaves brighten gardens."
    }
  ],
  "suggestions": [
    "Cây pawpaw trông như thế nào?",
    "Quả pawpaw ăn có ngon không?",
    "Pawpaw mọc ở những đâu?",
    "Vì sao nên trồng pawpaw trong vườn?"
  ]
},
 {
  "id": "voa-if-whether",
  "title": "If and Whether, Part 2",
  "titleVi": "If và Whether, Phần 2",
  "subtitle": "Level 2 · Intermediate",
  "category": "GIÁO DỤC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "📝",
  "source_url": "https://learningenglish.voanews.com/a/if-and-whether-part-2/5667799.html",
  "paragraphs": [
    {
      "en": "Today, we continue our discussion about “if” and “whether.” Both words are conjunctions that can sometimes be used in place of each other.",
      "vi": "Hôm nay, chúng ta tiếp tục bàn về “if” và “whether.” Cả hai từ đều là liên từ và đôi khi có thể thay thế cho nhau."
    },
    {
      "en": "The word “whether” shows that there are two possibilities or choices for something. And sometimes the word “if” shares this meaning. For instance, you can say, “Please find out if my books have arrived” or “Please find out whether my books have arrived.”",
      "vi": "Từ “whether” cho thấy có hai khả năng hoặc hai lựa chọn cho một việc gì đó. Và đôi khi từ “if” cũng mang nghĩa này. Ví dụ, bạn có thể nói: “Please find out if my books have arrived” (Vui lòng xem giúp sách của tôi đã đến chưa) hoặc “Please find out whether my books have arrived.”"
    },
    {
      "en": "In Part 1 of this program, we talked about when “whether” must be used. On today’s program, Part 2, we will talk about when “if” must be used. I will also explain when the two words are interchangeable. And lastly, I will tell you an easy way to remember which to choose.",
      "vi": "Trong Phần 1 của chương trình, chúng ta đã nói về trường hợp bắt buộc phải dùng “whether”. Trong chương trình hôm nay, Phần 2, chúng ta sẽ nói về trường hợp bắt buộc phải dùng “if”. Tôi cũng sẽ giải thích khi nào hai từ này có thể thay thế cho nhau. Và cuối cùng, tôi sẽ chỉ cho bạn một cách dễ nhớ để chọn từ đúng."
    },
    {
      "en": "Next, let’s talk about when “if” and “whether” are interchangeable. That means either word can be used with no change in meaning.",
      "vi": "Tiếp theo, hãy nói về trường hợp “if” và “whether” có thể thay thế cho nhau. Nghĩa là dùng từ nào cũng được mà nghĩa của câu không thay đổi."
    },
    {
      "en": "When reporting yes or no questions, we can use “if” or “whether.” Reported questions involve telling someone what another person has asked. Listen to two statements to see what I mean:",
      "vi": "Khi tường thuật câu hỏi yes/no, chúng ta có thể dùng “if” hoặc “whether”. Câu hỏi tường thuật là khi bạn kể lại cho người khác nghe ai đó đã hỏi gì. Hãy nghe hai câu sau để hiểu ý tôi:"
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Giáo dục (Education)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "“If” and “whether” are conjunctions that can sometimes replace each other.",
      "vi": "“If” và “whether” là liên từ, đôi khi có thể thay thế cho nhau."
    },
    {
      "en": "“Whether” shows that there are two possibilities or choices.",
      "vi": "“Whether” cho thấy có hai khả năng hoặc hai lựa chọn."
    },
    {
      "en": "Both words can be used when reporting yes or no questions.",
      "vi": "Cả hai từ đều dùng được khi tường thuật câu hỏi yes/no."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What are “if” and “whether”?",
      "opts": [
        "Nouns",
        "Conjunctions",
        "Adjectives",
        "Prepositions"
      ],
      "answer": 1,
      "explain": "The article says both words are conjunctions."
    },
    {
      "type": "TỪ VỰNG",
      "q": "What does the word “whether” show?",
      "opts": [
        "A command",
        "Two possibilities or choices",
        "A past event",
        "A spelling rule"
      ],
      "answer": 1,
      "explain": "“Whether” shows that there are two possibilities or choices for something."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main topic of this lesson?",
      "opts": [
        "How to write stories",
        "When to use “if” and “whether”",
        "How to pronounce English words",
        "The history of Hollywood"
      ],
      "answer": 1,
      "explain": "The lesson explains when “if” must be used and when the two words are interchangeable."
    },
    {
      "type": "SUY LUẬN",
      "q": "Which sentence correctly reports a yes/no question?",
      "opts": [
        "She asked if I was tired.",
        "She asked whether to the store.",
        "She asked if go home now.",
        "She asked whether I tired yesterday?"
      ],
      "answer": 0,
      "explain": "When reporting yes/no questions, we can use “if” or “whether” followed by a full clause."
    }
  ],
  "suggestions": [
    "Phân biệt if và whether như thế nào?",
    "Khi nào bắt buộc phải dùng whether?",
    "Cho ví dụ câu tường thuật dùng if.",
    "Tóm tắt bài học này."
  ]
},
 {
  "id": "voa-hollywood-ai-strike",
  "title": "In Hollywood Strike, AI’s Part Is Important",
  "titleVi": "Đình công ở Hollywood: Vai trò quan trọng của AI",
  "subtitle": "Level 2 · Intermediate",
  "category": "CÔNG NGHỆ · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🎬",
  "source_url": "https://learningenglish.voanews.com/a/in-hollywood-strike-ai-s-part-is-important/7195315.html",
  "paragraphs": [
    {
      "en": "Labor unions for actors and writers are striking over pay, benefits and job protections. But Artificial intelligence technology has become a big issue in Hollywood’s labor fight.",
      "vi": "Các công đoàn của diễn viên và biên kịch đang đình công vì vấn đề lương, phúc lợi và bảo vệ việc làm. Nhưng công nghệ trí tuệ nhân tạo đã trở thành một vấn đề lớn trong cuộc đấu tranh lao động ở Hollywood."
    },
    {
      "en": "With AI, star actors fear they will lose control of their likenesses. Unknown actors fear they will be replaced altogether. Writers fear they will have to share credit with or lose credit to machines.",
      "vi": "Với AI, các ngôi sao lo sợ sẽ mất quyền kiểm soát hình ảnh của mình. Các diễn viên vô danh lo sợ sẽ bị thay thế hoàn toàn. Các biên kịch lo sợ sẽ phải chia sẻ quyền tác giả với máy móc, thậm chí mất hẳn quyền đó."
    },
    {
      "en": "The proposed contracts which the two sides have been attempting to negotiate is to last only three years. Even at the speed at which AI technology is developing, it is unlikely there would be a large displacement of writers or actors within that period of time. But unions and employers know that if they compromise on an issue, it will be harder to get what they want in the next set of negotiations.",
      "vi": "Hợp đồng mà hai bên đang cố gắng đàm phán chỉ có thời hạn ba năm. Ngay cả với tốc độ phát triển hiện nay của AI, cũng khó có chuyện số lượng lớn biên kịch hay diễn viên bị thay thế trong thời gian đó. Nhưng cả công đoàn và giới chủ đều hiểu rằng nếu nhượng bộ ở vấn đề này, họ sẽ khó đạt được điều mình muốn trong vòng đàm phán tiếp theo."
    },
    {
      "en": "New technology is important to filmmaking. AI has been used to make actors look younger, like Harrison Ford in the recent film Indiana Jones and the Dial of Destiny.",
      "vi": "Công nghệ mới rất quan trọng đối với ngành làm phim. AI đã được dùng để khiến diễn viên trông trẻ hơn, như trường hợp của Harrison Ford trong bộ phim gần đây Indiana Jones and the Dial of Destiny."
    },
    {
      "en": "All sides in the strike know that use of new technology will continue to increase. That is why both sides are looking to establish legal and creative control.",
      "vi": "Mọi bên trong cuộc đình công đều biết việc sử dụng công nghệ mới sẽ tiếp tục gia tăng. Đó là lý do cả hai bên đều muốn thiết lập quyền kiểm soát về mặt pháp lý và sáng tạo."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Công nghệ (Technology)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Actors and writers are striking over pay, benefits, and job protections, with AI as a major issue.",
      "vi": "Diễn viên và biên kịch đình công vì lương, phúc lợi và bảo vệ việc làm, trong đó AI là một vấn đề lớn."
    },
    {
      "en": "Artists fear AI will take control of their likenesses, jobs, and creative credit.",
      "vi": "Nghệ sĩ lo sợ AI sẽ chiếm quyền kiểm soát hình ảnh, việc làm và quyền tác giả sáng tạo của họ."
    },
    {
      "en": "Both sides want to establish legal and creative control over new technology.",
      "vi": "Cả hai bên đều muốn thiết lập quyền kiểm soát pháp lý và sáng tạo đối với công nghệ mới."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Why are actors and writers striking?",
      "opts": [
        "They want longer vacations",
        "Over pay, benefits and job protections",
        "They want to ban all movies",
        "Over parking spaces at studios"
      ],
      "answer": 1,
      "explain": "The article says unions are striking over pay, benefits and job protections."
    },
    {
      "type": "TỪ VỰNG",
      "q": "What does “likeness” mean in this article?",
      "opts": [
        "A person’s appearance or image",
        "A kind of contract",
        "A movie theater",
        "A labor union"
      ],
      "answer": 0,
      "explain": "Star actors fear losing control of their likenesses, meaning their appearance or image."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why do unions care about AI rules in a three-year contract?",
      "opts": [
        "AI will replace everyone next week",
        "Compromising now makes future negotiations harder",
        "They want free AI software",
        "They love new technology"
      ],
      "answer": 1,
      "explain": "The article says if they compromise on an issue, it will be harder to get what they want next time."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main idea of the article?",
      "opts": [
        "AI has no effect on Hollywood",
        "AI is a key issue in Hollywood’s labor fight",
        "All actors support using AI",
        "Movies are no longer popular"
      ],
      "answer": 1,
      "explain": "The article focuses on AI as a big issue in the strike between artists and production companies."
    }
  ],
  "suggestions": [
    "Vì sao diễn viên lo sợ AI?",
    "AI được dùng trong làm phim như thế nào?",
    "Cuộc đình công Hollywood đòi hỏi những gì?",
    "Tóm tắt bài báo này."
  ]
},
 {
  "id": "voa-harvard-professor",
  "title": "Harvard Professor Found Guilty of Lying About Work for China",
  "titleVi": "Giáo sư Harvard bị kết tội nói dối về hợp tác với Trung Quốc",
  "subtitle": "Level 2 · Intermediate",
  "category": "KHOA HỌC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🔬",
  "source_url": "https://learningenglish.voanews.com/a/harvard-professor-found-guilty-of-lying-about-work-for-china/6365387.html",
  "paragraphs": [
    {
      "en": "A Harvard professor of chemistry was found guilty in a Boston court Tuesday of charges related to his business ties to a Chinese university. The charges included making false statements to officials and on tax returns and not reporting his Chinese bank account.",
      "vi": "Một giáo sư hóa học của Đại học Harvard đã bị tòa án Boston kết tội hôm thứ Ba với các cáo buộc liên quan đến quan hệ công việc với một trường đại học Trung Quốc. Các cáo buộc bao gồm khai báo gian dối với quan chức và trong tờ khai thuế, cùng với việc không khai báo tài khoản ngân hàng ở Trung Quốc."
    },
    {
      "en": "The case was part of a federal program to deal with Chinese influence on U.S. research. The professor, Charles Lieber, is a well-known nanoscientist and the former chairman of Harvard’s chemistry department.",
      "vi": "Vụ án là một phần trong chương trình liên bang nhằm đối phó với ảnh hưởng của Trung Quốc đối với hoạt động nghiên cứu của Mỹ. Giáo sư Charles Lieber là một nhà khoa học nano nổi tiếng và từng là chủ nhiệm khoa Hóa học của Harvard."
    },
    {
      "en": "Prosecutors said that in 2011, Lieber agreed to work with Wuhan University of Technology in China. They charged that he helped get other scientists to take part in China’s Thousand Talents Program through that connection.",
      "vi": "Các công tố viên cho biết năm 2011, Lieber đã đồng ý làm việc với Đại học Công nghệ Vũ Hán ở Trung Quốc. Họ cáo buộc ông đã giúp lôi kéo các nhà khoa học khác tham gia Chương trình Ngàn Nhân tài của Trung Quốc thông qua mối quan hệ này."
    },
    {
      "en": "Prosecutors say China uses that program to persuade foreign researchers to share their knowledge with the country. Taking part in the program is not a crime. But prosecutors said the 62-year-old Lieber illegally lied to officials about his involvement.",
      "vi": "Các công tố viên nói Trung Quốc dùng chương trình này để thuyết phục các nhà nghiên cứu nước ngoài chia sẻ kiến thức với nước này. Tham gia chương trình không phải là tội. Nhưng các công tố viên cho biết Lieber, 62 tuổi, đã nói dối quan chức về việc tham gia của mình, và điều đó là bất hợp pháp."
    },
    {
      "en": "Lieber was charged in January 2020 as part of the U.S. Department of Justice’s effort called the “China Initiative.” It began during former President Donald Trump’s administration to oppose suspected Chinese economic spying and stealing of research.",
      "vi": "Lieber bị truy tố vào tháng 1 năm 2020 trong khuôn khổ nỗ lực của Bộ Tư pháp Mỹ mang tên “Sáng kiến Trung Quốc”. Sáng kiến này bắt đầu dưới thời cựu Tổng thống Donald Trump nhằm chống lại hoạt động gián điệp kinh tế và đánh cắp nghiên cứu bị nghi là của Trung Quốc."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Khoa học (Science)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Harvard professor Charles Lieber was found guilty of lying about his ties to China.",
      "vi": "Giáo sư Harvard Charles Lieber bị kết tội nói dối về quan hệ với Trung Quốc."
    },
    {
      "en": "He hid his work with Wuhan University of Technology and China’s Thousand Talents Program.",
      "vi": "Ông đã che giấu việc hợp tác với Đại học Công nghệ Vũ Hán và Chương trình Ngàn Nhân tài của Trung Quốc."
    },
    {
      "en": "The case was part of a U.S. effort against suspected Chinese economic spying.",
      "vi": "Vụ án là một phần trong nỗ lực của Mỹ chống lại hoạt động gián điệp kinh tế bị nghi là của Trung Quốc."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What was Charles Lieber found guilty of?",
      "opts": [
        "Stealing a car",
        "Lying about his business ties to China",
        "Cheating on an exam",
        "Breaking into a laboratory"
      ],
      "answer": 1,
      "explain": "He was found guilty of charges related to his business ties to a Chinese university, including false statements."
    },
    {
      "type": "TỪ VỰNG",
      "q": "What does “guilty” mean in this article?",
      "opts": [
        "Innocent",
        "Responsible for a crime",
        "Famous",
        "Wealthy"
      ],
      "answer": 1,
      "explain": "The court found him guilty, meaning legally responsible for the charges."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why was lying the crime, not joining the Thousand Talents Program?",
      "opts": [
        "Joining the program is not a crime",
        "He never joined the program",
        "The program does not exist",
        "Lying is always legal"
      ],
      "answer": 0,
      "explain": "The article states that taking part in the program is not a crime, but lying to officials about it is illegal."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main idea of the article?",
      "opts": [
        "A Harvard professor won a science prize",
        "A Harvard scientist was convicted for hiding China ties",
        "China closed all its universities",
        "Harvard fired all its professors"
      ],
      "answer": 1,
      "explain": "The article reports Lieber’s conviction for lying about his work with Chinese institutions."
    }
  ],
  "suggestions": [
    "Charles Lieber là ai?",
    "Chương trình Ngàn Nhân tài là gì?",
    "Vì sao ông bị kết tội?",
    "Tóm tắt bài báo này."
  ]
},
 {
  "id": "voa-vietnam-social-media",
  "title": "Reports: Vietnam to Limit News on Social Media",
  "titleVi": "Việt Nam sắp hạn chế tin tức trên mạng xã hội",
  "subtitle": "Level 2 · Intermediate",
  "category": "CÔNG NGHỆ · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "📱",
  "source_url": "https://learningenglish.voanews.com/a/reports-vietnam-to-limit-news-on-social-media/6769079.html",
  "paragraphs": [
    {
      "en": "Three people said Vietnam is preparing new rules to limit which social media accounts can publish news-related information.",
      "vi": "Ba người cho biết Việt Nam đang chuẩn bị các quy định mới nhằm hạn chế những tài khoản mạng xã hội nào được phép đăng tải thông tin liên quan đến tin tức."
    },
    {
      "en": "The rules would establish a legal basis for controlling the spread of news on services like Facebook and YouTube. At the same time, two of the people Reuters spoke to added that the rules will place a notable amount of responsibility on the social media services to control their information.",
      "vi": "Các quy định này sẽ tạo cơ sở pháp lý để kiểm soát việc lan truyền tin tức trên các dịch vụ như Facebook và YouTube. Đồng thời, hai trong số những người mà Reuters phỏng vấn cho biết thêm rằng các quy định sẽ đặt trách nhiệm đáng kể lên các dịch vụ mạng xã hội trong việc kiểm soát thông tin."
    },
    {
      "en": "The people who were the sources of the report asked to not be named because the discussions remain secret.",
      "vi": "Những người cung cấp thông tin cho bài báo yêu cầu được giấu tên vì các cuộc thảo luận vẫn đang được giữ bí mật."
    },
    {
      "en": "Vietnam’s Ministry of Information and Communications and Ministry of Foreign Affairs did not answer requests for comment.",
      "vi": "Bộ Thông tin và Truyền thông cùng Bộ Ngoại giao Việt Nam đã không trả lời yêu cầu bình luận."
    },
    {
      "en": "One source said, “The government wants to fix what it sees as the ‘news-lisation’ of social media.” “News-lisation,” or “báo hoá” in Vietnamese, is a term used by the officials to describe the misleading of users into thinking that social media accounts are official news sources.",
      "vi": "Một nguồn tin cho biết: “Chính phủ muốn khắc phục điều mà họ coi là sự ‘báo hoá’ mạng xã hội.” “Báo hoá” là thuật ngữ mà các quan chức dùng để mô tả việc khiến người dùng nhầm tưởng các tài khoản mạng xã hội là nguồn tin tức chính thức."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Công nghệ (Technology)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Vietnam is preparing rules to limit which social media accounts can publish news.",
      "vi": "Việt Nam đang chuẩn bị quy định hạn chế tài khoản mạng xã hội nào được phép đăng tin tức."
    },
    {
      "en": "The rules would make social media companies responsible for controlling news on their platforms.",
      "vi": "Các quy định sẽ buộc các công ty mạng xã hội chịu trách nhiệm kiểm soát tin tức trên nền tảng của mình."
    },
    {
      "en": "Officials want to stop “news-lisation,” where users mistake social media accounts for official news sources.",
      "vi": "Các quan chức muốn ngăn chặn tình trạng “báo hoá”, khi người dùng nhầm tài khoản mạng xã hội là nguồn tin chính thức."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What is Vietnam preparing?",
      "opts": [
        "New rules to limit news on social media",
        "A new social media app",
        "Free internet for everyone",
        "A ban on all newspapers"
      ],
      "answer": 0,
      "explain": "Vietnam is preparing rules to limit which accounts can publish news-related information."
    },
    {
      "type": "TỪ VỰNG",
      "q": "What does “news-lisation” describe?",
      "opts": [
        "Users mistaking social media accounts for official news sources",
        "Printing newspapers",
        "Reading the news aloud",
        "Writing a personal blog"
      ],
      "answer": 0,
      "explain": "Officials use the term to describe misleading users into thinking social media accounts are official news sources."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why did the sources ask not to be named?",
      "opts": [
        "They are famous people",
        "The discussions remain secret",
        "They forgot their own names",
        "Reuters asked them to stay quiet"
      ],
      "answer": 1,
      "explain": "The sources asked for anonymity because the discussions about the rules remain secret."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main idea of the article?",
      "opts": [
        "Vietnam bans Facebook completely",
        "Vietnam plans to regulate news on social media",
        "Vietnam supports every news account",
        "Social media is illegal in Vietnam"
      ],
      "answer": 1,
      "explain": "The article reports Vietnam’s plan to create rules controlling news on social media."
    }
  ],
  "suggestions": [
    "“Báo hoá” mạng xã hội là gì?",
    "Quy định mới ảnh hưởng thế nào đến Facebook, YouTube?",
    "Vì sao các nguồn tin yêu cầu giấu tên?",
    "Tóm tắt bài báo này."
  ]
},
 {
  "id": "voa-vinfast",
  "title": "Is VinFast Worth More than VW, Ford?",
  "titleVi": "VinFast có đáng giá hơn VW, Ford?",
  "subtitle": "Level 2 · Intermediate",
  "category": "KINH DOANH · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🚗",
  "source_url": "https://learningenglish.voanews.com/a/is-vinfast-worth-more-than-vw-ford-/7227625.html",
  "paragraphs": [
    {
      "en": "Shares of Vietnam’s electric car company VinFast started publicly trading on the Nasdaq stock exchange on Tuesday. By the end of the first trading day, investors had pushed the market value of stock in the new company to $85 billion.",
      "vi": "Cổ phiếu của hãng xe điện Việt Nam VinFast bắt đầu giao dịch công khai trên sàn chứng khoán Nasdaq vào thứ Ba. Đến cuối ngày giao dịch đầu tiên, các nhà đầu tư đã đẩy giá trị vốn hóa của công ty mới này lên tới 85 tỷ đô la."
    },
    {
      "en": "That is more than the market value of Germany’s Volkswagen at $69.7 billion, America’s Ford at $48 billion, and several other established automakers.",
      "vi": "Con số này cao hơn giá trị vốn hóa của Volkswagen (Đức) ở mức 69,7 tỷ đô la, Ford (Mỹ) ở mức 48 tỷ đô la, cùng một số hãng xe lâu đời khác."
    },
    {
      "en": "Share prices of VinFast increased about 270 percent, from around $10 to $37, on Tuesday. On Wednesday morning, the share price had dropped under $30. However, only a very small percentage of shares are being traded because VinFast founder Pham Nhat Vuong currently owns 99 percent of the company.",
      "vi": "Giá cổ phiếu VinFast đã tăng khoảng 270%, từ khoảng 10 đô la lên 37 đô la vào thứ Ba. Đến sáng thứ Tư, giá cổ phiếu đã giảm xuống dưới 30 đô la. Tuy nhiên, chỉ một tỷ lệ rất nhỏ cổ phiếu được giao dịch vì nhà sáng lập VinFast Phạm Nhật Vượng hiện sở hữu tới 99% công ty."
    },
    {
      "en": "Now comes the hard part: VinFast, an electric vehicle (EV) maker, will have to sell a lot more cars to meet the yearly target of 50,000 set by its founder.",
      "vi": "Giờ mới đến phần khó khăn: VinFast, hãng sản xuất xe điện (EV), sẽ phải bán được nhiều xe hơn nữa mới đạt được mục tiêu 50.000 xe mỗi năm mà nhà sáng lập đã đặt ra."
    },
    {
      "en": "For that, the company will need to bring in partners rather than selling directly on its own. It will also need to bring prices down to compete with other EV makers that have been lowering their prices since the start of the year.",
      "vi": "Để làm được điều đó, công ty sẽ cần hợp tác với các đối tác thay vì tự mình bán trực tiếp. Công ty cũng cần hạ giá bán để cạnh tranh với các hãng xe điện khác, vốn đã liên tục giảm giá từ đầu năm."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Kinh doanh (Business)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "VinFast’s market value reached $85 billion on its first Nasdaq trading day, higher than VW and Ford.",
      "vi": "Giá trị vốn hóa của VinFast đạt 85 tỷ đô la trong ngày giao dịch đầu tiên trên Nasdaq, cao hơn cả VW và Ford."
    },
    {
      "en": "The high value is partly because only a tiny share of stock is traded, with the founder owning 99%.",
      "vi": "Giá trị cao một phần vì chỉ một lượng cổ phiếu rất nhỏ được giao dịch, trong khi nhà sáng lập sở hữu tới 99%."
    },
    {
      "en": "VinFast now faces the hard task of selling enough cars and cutting prices to compete.",
      "vi": "VinFast giờ đối mặt với nhiệm vụ khó khăn là bán đủ số xe và hạ giá để cạnh tranh."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What was VinFast’s market value after its first trading day?",
      "opts": [
        "$48 billion",
        "$69.7 billion",
        "$85 billion",
        "$10 billion"
      ],
      "answer": 2,
      "explain": "Investors pushed VinFast’s market value to $85 billion by the end of the first trading day."
    },
    {
      "type": "TỪ VỰNG",
      "q": "What does “market value” mean in this article?",
      "opts": [
        "The price of one car",
        "The total value of a company’s stock",
        "A shopping mall",
        "A type of electric car"
      ],
      "answer": 1,
      "explain": "Market value here means the total value of all of the company’s shares."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why might VinFast’s high market value be misleading?",
      "opts": [
        "Because only a tiny percentage of shares are traded",
        "Because its cars are very cheap",
        "Because Volkswagen is better",
        "Because Nasdaq was closed"
      ],
      "answer": 0,
      "explain": "Only a very small percentage of shares are traded since the founder owns 99%, so the price may not reflect true value."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main challenge for VinFast now?",
      "opts": [
        "Selling enough cars and lowering prices to compete",
        "Building a factory on the moon",
        "Hiring more drivers",
        "Closing the company"
      ],
      "answer": 0,
      "explain": "VinFast must sell many more cars to meet its target and cut prices to compete with other EV makers."
    }
  ],
  "suggestions": [
    "Vì sao VinFast đáng giá hơn Ford?",
    "Thách thức lớn nhất của VinFast là gì?",
    "Phạm Nhật Vượng sở hữu bao nhiêu % VinFast?",
    "Tóm tắt bài báo này."
  ]
},
 {
  "id": "voa-coronavirus-study",
  "title": "New Study Suggests Ways to Stop Coronavirus’ Spread",
  "titleVi": "Nghiên cứu mới gợi ý cách ngăn chặn sự lây lan của virus corona",
  "subtitle": "Level 2 · Intermediate",
  "category": "SỨC KHỎE · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🦠",
  "source_url": "https://learningenglish.voanews.com/a/new-study-suggests-ways-to-stop-coronavirus-spread/5485110.html",
  "paragraphs": [
    {
      "en": "A recent study of coronavirus infections in Italy found that around 40 percent of cases showed no signs of infection, or symptoms. The findings suggest that asymptomatic cases are important in the spread of the virus.",
      "vi": "Một nghiên cứu gần đây về các ca nhiễm virus corona ở Ý cho thấy khoảng 40% số ca không có dấu hiệu nhiễm bệnh hay triệu chứng. Kết quả này cho thấy các ca không triệu chứng đóng vai trò quan trọng trong việc lây lan virus."
    },
    {
      "en": "The study was led by scientists at Italy’s Padua University and Imperial College London. The scientists looked at the Italian town of Vò. The town has about 3,200 people. It was put under quarantine for 14 days after having Italy’s first COVID-19 death on February 21.",
      "vi": "Nghiên cứu do các nhà khoa học tại Đại học Padua của Ý và Đại học Imperial College London dẫn đầu. Họ khảo sát thị trấn Vò của Ý với khoảng 3.200 dân. Thị trấn bị phong tỏa 14 ngày sau ca tử vong COVID-19 đầu tiên của Ý vào ngày 21 tháng 2."
    },
    {
      "en": "In the first part of the study, which was done around the time the town’s quarantine started, researchers found 73 people were infected. That is about 2.6 percent of the population. In the second part of the study, which was done after the end of the quarantine, they found 29 people were infected. That is about 1.2 percent of the population.",
      "vi": "Trong giai đoạn đầu của nghiên cứu, thực hiện vào thời điểm thị trấn bắt đầu phong tỏa, các nhà nghiên cứu phát hiện 73 người nhiễm bệnh, tương đương khoảng 2,6% dân số. Ở giai đoạn hai, sau khi kết thúc phong tỏa, họ phát hiện 29 người nhiễm, tương đương khoảng 1,2% dân số."
    },
    {
      "en": "In both parts of the study, about 40 percent of those who were infected did not have symptoms at the time of testing. They also did not develop symptoms afterwards. In other words, they were asymptomatic.",
      "vi": "Ở cả hai giai đoạn, khoảng 40% số người nhiễm không có triệu chứng tại thời điểm xét nghiệm và cũng không phát triển triệu chứng sau đó. Nói cách khác, họ là những ca không triệu chứng."
    },
    {
      "en": "The study produced evidence that testing along with case isolation and community quarantines can stop local outbreaks quickly. Because all of the coronavirus cases found were quarantined, the researchers said, the disease was not able to spread quickly.",
      "vi": "Nghiên cứu đưa ra bằng chứng rằng xét nghiệm kết hợp với cách ly ca bệnh và phong tỏa cộng đồng có thể dập tắt ổ dịch nhanh chóng. Vì tất cả các ca nhiễm được phát hiện đều bị cách ly, bệnh đã không thể lây lan nhanh, các nhà nghiên cứu cho biết."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Sức khỏe (Health)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "About 40 percent of coronavirus cases in the Italian town showed no symptoms.",
      "vi": "Khoảng 40% số ca nhiễm ở thị trấn Ý không có triệu chứng."
    },
    {
      "en": "The study tested most of the town’s population twice: during and after quarantine.",
      "vi": "Nghiên cứu đã xét nghiệm phần lớn dân số thị trấn hai lần: trong và sau phong tỏa."
    },
    {
      "en": "Testing, isolation, and quarantine together can stop local outbreaks quickly.",
      "vi": "Xét nghiệm, cách ly và phong tỏa kết hợp có thể dập ổ dịch nhanh chóng."
    }
  ],
  "quiz": [
    {
      "type": "Ý CHÍNH",
      "q": "What did the study in the Italian town of Vò find?",
      "opts": [
        "All infected people had serious symptoms",
        "About 40 percent of cases had no symptoms",
        "Quarantine made the virus spread faster",
        "Only old people got infected"
      ],
      "answer": 1,
      "explain": "The study found that about 40 percent of those infected were asymptomatic."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "How many people were infected in the first part of the study?",
      "opts": [
        "29 people",
        "3,200 people",
        "73 people",
        "40 people"
      ],
      "answer": 2,
      "explain": "Researchers found 73 infected people in the first part, about 2.6 percent of the population."
    },
    {
      "type": "TỪ VỰNG",
      "q": "The word ‘asymptomatic’ in the article means:",
      "opts": [
        "having serious illness",
        "showing no symptoms",
        "spreading quickly",
        "needing hospital care"
      ],
      "answer": 1,
      "explain": "‘Asymptomatic’ means infected but showing no symptoms."
    },
    {
      "type": "SUY LUẬN",
      "q": "What can we infer from the study’s results?",
      "opts": [
        "Testing is useless against the virus",
        "People without symptoms can still spread the virus",
        "Quarantine always fails",
        "Only Italy had asymptomatic cases"
      ],
      "answer": 1,
      "explain": "Since 40 percent had no symptoms, such people likely play an important role in spreading the virus."
    }
  ],
  "suggestions": [
    "Nghiên cứu này nói về điều gì?",
    "Tại sao ca không triệu chứng lại nguy hiểm?",
    "Tóm tắt bài báo này",
    "Phong tỏa giúp ngăn dịch thế nào?"
  ]
},
 {
  "id": "voa-face-mask",
  "title": "How to Make Your Own Face Mask",
  "titleVi": "Cách tự làm khẩu trang vải tại nhà",
  "subtitle": "Level 2 · Intermediate",
  "category": "SỨC KHỎE · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "😷",
  "source_url": "https://learningenglish.voanews.com/a/how-to-make-your-own-face-mask/5375192.html",
  "paragraphs": [
    {
      "en": "Much of the world was caught off guard by the new coronavirus. In many ways and in many places, governments, health care providers and average people were not ready.",
      "vi": "Phần lớn thế giới đã bị bất ngờ trước virus corona mới. Ở nhiều nơi, chính phủ, nhân viên y tế và người dân đều chưa sẵn sàng."
    },
    {
      "en": "Local officials in many parts of the world suggest wearing a face mask in public. A simple cloth face covering can help to slow the spread of the virus. But face masks can be hard to find. High quality ones used by professionals need to be reserved for healthcare workers.",
      "vi": "Chính quyền nhiều nơi trên thế giới khuyến nghị đeo khẩu trang ở nơi công cộng. Một chiếc khẩu trang vải đơn giản có thể giúp làm chậm sự lây lan của virus. Nhưng khẩu trang có thể khó tìm. Khẩu trang chất lượng cao dùng cho chuyên gia y tế cần được dành riêng cho nhân viên y tế."
    },
    {
      "en": "You can make your own cloth face mask from common, household items. To help guide people, the Centers for Disease Control and Prevention (CDC) in the United States has how-to tips on its website.",
      "vi": "Bạn có thể tự làm khẩu trang vải từ những vật dụng gia đình thông thường. Để hướng dẫn mọi người, Trung tâm Kiểm soát và Phòng ngừa Dịch bệnh (CDC) của Hoa Kỳ đã đăng hướng dẫn chi tiết trên trang web của mình."
    },
    {
      "en": "Now, for those people who cannot sew, there are ways to make no-sew face masks. The CDC shows two ways on its website. One uses a cotton t-shirt. The other method uses a coffee filter.",
      "vi": "Với những ai không biết may, vẫn có cách làm khẩu trang không cần khâu. CDC hướng dẫn hai cách trên trang web: một cách dùng áo thun cotton, cách còn lại dùng giấy lọc cà phê."
    },
    {
      "en": "Here is a step-by-step process for making a face mask from a 100 percent cotton T-shirt. However, if you do not have a 100 percent cotton t-shirt, you can use other materials that are easy-to-find.",
      "vi": "Dưới đây là các bước làm khẩu trang từ áo thun 100% cotton. Tuy nhiên, nếu không có áo thun 100% cotton, bạn có thể dùng các vật liệu dễ tìm khác."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Sức khỏe (Health)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Face masks were hard to find during the pandemic, so people needed alternatives.",
      "vi": "Khẩu trang khan hiếm trong đại dịch nên mọi người cần giải pháp thay thế."
    },
    {
      "en": "The CDC published guides for making cloth masks at home, including no-sew methods.",
      "vi": "CDC đã đăng hướng dẫn tự làm khẩu trang vải tại nhà, kể cả cách không cần khâu."
    },
    {
      "en": "High-quality masks should be reserved for healthcare workers.",
      "vi": "Khẩu trang chất lượng cao nên dành cho nhân viên y tế."
    }
  ],
  "quiz": [
    {
      "type": "Ý CHÍNH",
      "q": "What is the main topic of the article?",
      "opts": [
        "How hospitals treat patients",
        "How to make your own face mask",
        "Why the virus started",
        "How to sew clothes"
      ],
      "answer": 1,
      "explain": "The article explains how to make cloth face masks from household items."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "According to the CDC, what can you use to make a no-sew mask?",
      "opts": [
        "A cotton t-shirt or a coffee filter",
        "Paper money",
        "Plastic bags only",
        "Newspaper"
      ],
      "answer": 0,
      "explain": "The CDC shows two no-sew methods: one uses a cotton t-shirt, the other a coffee filter."
    },
    {
      "type": "TỪ VỰNG",
      "q": "The phrase ‘caught off guard’ in the article means:",
      "opts": [
        "well prepared",
        "surprised and unprepared",
        "wearing masks",
        "feeling sick"
      ],
      "answer": 1,
      "explain": "‘Caught off guard’ means surprised without preparation."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why does the article say high-quality masks should be saved for healthcare workers?",
      "opts": [
        "They are too expensive for normal people",
        "Healthcare workers face the highest risk of infection",
        "Cloth masks do not work at all",
        "Hospitals sell them for profit"
      ],
      "answer": 1,
      "explain": "Healthcare workers face the virus directly and were in short supply of protective equipment."
    }
  ],
  "suggestions": [
    "Bài này hướng dẫn gì?",
    "Làm khẩu trang không cần khâu thế nào?",
    "Tại sao nên đeo khẩu trang vải?",
    "Tóm tắt các bước làm khẩu trang"
  ]
},
 {
  "id": "voa-driver-assist-crashes",
  "title": "US: Nearly 400 Crashes of Driver-assist Vehicles",
  "titleVi": "Gần 400 vụ tai nạn xe hỗ trợ lái tại Mỹ",
  "subtitle": "Level 2 · Intermediate",
  "category": "CÔNG NGHỆ · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🚗",
  "source_url": "https://learningenglish.voanews.com/a/us-nearly-400-crashes-of-driver-assist-vehicles/6620116.html",
  "paragraphs": [
    {
      "en": "A U.S. highway safety agency said Wednesday that automakers reported nearly 400 crashes of vehicles with driver-assist systems. Of those accidents, 273 involved vehicles from Tesla.",
      "vi": "Một cơ quan an toàn đường bộ của Mỹ cho biết các hãng xe đã báo cáo gần 400 vụ tai nạn liên quan đến xe có hệ thống hỗ trợ lái. Trong số đó, 273 vụ liên quan đến xe Tesla."
    },
    {
      "en": "The National Highway Traffic Safety Administration, or NHTSA, said the numbers should not be used to compare automakers. The agency said it did not measure them by the number of vehicles from each manufacturer that uses the systems, or how many kilometers those vehicles traveled.",
      "vi": "Cơ quan An toàn Giao thông Đường bộ Quốc gia (NHTSA) cho biết các con số này không nên dùng để so sánh giữa các hãng xe. Cơ quan này không đo lường theo số lượng xe của từng hãng hay số km xe đã di chuyển."
    },
    {
      "en": "Automakers reported crashes from July of last year through May 15 under an order from the agency. It is examining such crashes overall for the first time.",
      "vi": "Các hãng xe đã báo cáo tai nạn từ tháng 7 năm ngoái đến ngày 15 tháng 5 theo yêu cầu của cơ quan này. Đây là lần đầu tiên cơ quan tổng kiểm tra các vụ tai nạn như vậy."
    },
    {
      "en": "Tesla’s crashes happened while vehicles were using driver-assist systems that have some control over speed and steering. The company has about 830,000 vehicles with the systems on the road.",
      "vi": "Các vụ tai nạn của Tesla xảy ra khi xe đang dùng hệ thống hỗ trợ lái có khả năng kiểm soát tốc độ và tay lái. Hãng này có khoảng 830.000 xe trang bị hệ thống trên đường."
    },
    {
      "en": "The next closest of the more than ten automakers that reported crashes was Honda, with 90. Honda says it has about six million vehicles on U.S. roads with such systems. The automaker Subaru followed with 10, and all other automakers reported five or fewer.",
      "vi": "Hãng xe đứng thứ hai trong số hơn mười hãng báo cáo là Honda với 90 vụ. Honda cho biết có khoảng 6 triệu xe trang bị hệ thống này trên đường phố Mỹ. Subaru đứng tiếp theo với 10 vụ, các hãng còn lại đều báo cáo 5 vụ trở xuống."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Công nghệ (Technology)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Automakers reported nearly 400 crashes involving driver-assist systems, most of them Teslas.",
      "vi": "Các hãng xe báo cáo gần 400 vụ tai nạn liên quan đến hệ thống hỗ trợ lái, phần lớn là xe Tesla."
    },
    {
      "en": "NHTSA warns the numbers should not be used to compare automakers directly.",
      "vi": "NHTSA cảnh báo không nên dùng các con số này để so sánh trực tiếp giữa các hãng."
    },
    {
      "en": "The agency is studying the data to find risks in the new technology.",
      "vi": "Cơ quan này đang nghiên cứu dữ liệu để tìm rủi ro của công nghệ mới."
    }
  ],
  "quiz": [
    {
      "type": "Ý CHÍNH",
      "q": "What is the article mainly about?",
      "opts": [
        "Tesla’s new car models",
        "Crashes of vehicles with driver-assist systems",
        "How to drive safely",
        "Honda’s sales numbers"
      ],
      "answer": 1,
      "explain": "The article reports nearly 400 crashes of vehicles with driver-assist systems."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "How many crashes involved Tesla vehicles?",
      "opts": [
        "90",
        "10",
        "273",
        "400"
      ],
      "answer": 2,
      "explain": "Of the nearly 400 crashes, 273 involved Tesla vehicles."
    },
    {
      "type": "TỪ VỰNG",
      "q": "The word ‘emerging’ in ‘emerging risks’ most likely means:",
      "opts": [
        "disappearing",
        "newly appearing",
        "very dangerous",
        "well known"
      ],
      "answer": 1,
      "explain": "‘Emerging’ means beginning to appear or become known."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why should the crash numbers not be used to compare automakers?",
      "opts": [
        "The numbers are secret",
        "They were not measured against fleet size or distance traveled",
        "Tesla refused to report",
        "Honda has better cars"
      ],
      "answer": 1,
      "explain": "NHTSA said the data was not measured by number of vehicles or kilometers traveled."
    }
  ],
  "suggestions": [
    "Bài báo này nói về vấn đề gì?",
    "Tesla gặp bao nhiêu vụ tai nạn?",
    "Hệ thống hỗ trợ lái là gì?",
    "NHTSA nói gì về số liệu này?"
  ]
},
 {
  "id": "voa-jumbo-restaurant",
  "title": "Famous Hong Kong Floating Restaurant Towed Away",
  "titleVi": "Nhà hàng nổi tiếng của Hồng Kông bị kéo đi",
  "subtitle": "Level 2 · Intermediate",
  "category": "ĐỜI SỐNG · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🛥️",
  "source_url": "https://learningenglish.voanews.com/a/famous-hong-kong-floating-restaurant-towed-away-/6617346.html",
  "paragraphs": [
    {
      "en": "Jumbo Floating Restaurant on Aberdeen Harbor in Hong Kong was towed away on Tuesday after being closed by the pandemic. The owners of the famed eating place could not find investors to reopen the historic site.",
      "vi": "Nhà hàng nổi Jumbo trên cảng Aberdeen ở Hồng Kông đã bị kéo đi vào thứ Ba sau khi phải đóng cửa vì đại dịch. Chủ nhà hàng nổi tiếng không tìm được nhà đầu tư để mở lại địa điểm lịch sử này."
    },
    {
      "en": "Jumbo Floating Restaurant opened in 1976 and served Cantonese food and seafood like slow-cooked baby pig and lobster. More than 30 million people ate there over the years.",
      "vi": "Nhà hàng nổi Jumbo mở cửa năm 1976, phục vụ món Quảng Đông và hải sản như heo sữa quay chậm và tôm hùm. Hơn 30 triệu lượt khách đã ăn ở đây qua các năm."
    },
    {
      "en": "The business owner, Aberdeen Restaurant Enterprises, said it became too costly to keep the property in good condition while it was closed. The floating restaurant required millions of dollars each year in maintenance and inspection costs.",
      "vi": "Chủ sở hữu, công ty Aberdeen Restaurant Enterprises, cho biết chi phí duy trì địa điểm trong tình trạng tốt khi đóng cửa là quá tốn kém. Mỗi năm nhà hàng nổi cần hàng triệu đô la cho bảo trì và kiểm định."
    },
    {
      "en": "On Tuesday, several small boats pulled the restaurant away from its place in the harbor. Officials did not say where the property was going.",
      "vi": "Hôm thứ Ba, nhiều tàu nhỏ đã kéo nhà hàng rời khỏi vị trí trong cảng. Giới chức không cho biết địa điểm này sẽ được đưa đi đâu."
    },
    {
      "en": "Some area lawmakers called for the government to step in and buy the restaurant. Hong Kong Chief Executive Carrie Lam rejected the idea. Lam said the government was “not good” at running a business like a restaurant.",
      "vi": "Một số nghị sĩ địa phương kêu gọi chính phủ can thiệp mua lại nhà hàng. Trưởng đặc khu Hồng Kông Carrie Lam đã từ chối. Bà Lam nói chính phủ “không giỏi” điều hành kinh doanh như nhà hàng."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Đời sống (Lifestyle)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "The historic Jumbo Floating Restaurant was towed away after closing during the pandemic.",
      "vi": "Nhà hàng nổi Jumbo lịch sử bị kéo đi sau khi đóng cửa vì đại dịch."
    },
    {
      "en": "The owners could not afford maintenance costs or find investors to reopen it.",
      "vi": "Chủ sở hữu không đủ khả năng chi trả bảo trì cũng như tìm nhà đầu tư để mở lại."
    },
    {
      "en": "The restaurant served over 30 million guests since opening in 1976.",
      "vi": "Nhà hàng đã phục vụ hơn 30 triệu lượt khách kể từ khi mở cửa năm 1976."
    }
  ],
  "quiz": [
    {
      "type": "Ý CHÍNH",
      "q": "Why was the Jumbo Floating Restaurant towed away?",
      "opts": [
        "It sank in a storm",
        "It closed during the pandemic and owners could not reopen it",
        "It was sold to Japan",
        "It moved to a bigger harbor"
      ],
      "answer": 1,
      "explain": "After pandemic closure, owners could not find investors and could not afford maintenance."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "When did Jumbo Floating Restaurant open?",
      "opts": [
        "1967",
        "1976",
        "1997",
        "2020"
      ],
      "answer": 1,
      "explain": "The restaurant opened in 1976."
    },
    {
      "type": "TỪ VỰNG",
      "q": "The word ‘famed’ in the article is closest in meaning to:",
      "opts": [
        "unknown",
        "famous",
        "expensive",
        "old"
      ],
      "answer": 1,
      "explain": "‘Famed’ means well known or famous."
    },
    {
      "type": "SUY LUẬN",
      "q": "What does Carrie Lam’s response suggest?",
      "opts": [
        "The government will buy the restaurant",
        "The government does not want to run a restaurant business",
        "She wants to eat there",
        "Hong Kong has no money"
      ],
      "answer": 1,
      "explain": "She rejected the idea, saying the government was ‘not good’ at running a business like a restaurant."
    }
  ],
  "suggestions": [
    "Nhà hàng Jumbo có gì đặc biệt?",
    "Tại sao nhà hàng phải đóng cửa?",
    "Chính phủ Hồng Kông phản ứng thế nào?",
    "Tóm tắt câu chuyện này"
  ]
},
 {
  "id": "voa-linking-verbs",
  "title": "Verbs and Summer Weather",
  "titleVi": "Động từ nối và thời tiết mùa hè",
  "subtitle": "Level 2 · Intermediate",
  "category": "GIÁO DỤC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "📚",
  "source_url": "https://learningenglish.voanews.com/a/verbs-and-summer-weather/5928601.html",
  "paragraphs": [
    {
      "en": "Americans often discuss the bad and good weather that is taking place by using special kinds of verbs known as linking verbs.",
      "vi": "Người Mỹ thường bàn về thời tiết xấu và đẹp bằng cách dùng một loại động từ đặc biệt gọi là động từ nối (linking verbs)."
    },
    {
      "en": "In today’s Everyday Grammar, we will explore the connection between linking verbs, grammar, and the weather.",
      "vi": "Trong bài Ngữ pháp Hằng ngày hôm nay, chúng ta sẽ khám phá mối liên hệ giữa động từ nối, ngữ pháp và thời tiết."
    },
    {
      "en": "Linking verbs are verbs that often describe a state of existence or a change to a new state. These verbs generally come before an adjective or noun phrase and connect it to the subject of the sentence.",
      "vi": "Động từ nối là những động từ thường diễn tả trạng thái tồn tại hoặc sự chuyển sang trạng thái mới. Chúng thường đứng trước tính từ hoặc cụm danh từ và nối nó với chủ ngữ của câu."
    },
    {
      "en": "The linking verb seem connects happy, an adjective, to she, the subject of the sentence. The verb is helping to describe the subject’s state of existence.",
      "vi": "Động từ nối ‘seem’ nối tính từ ‘happy’ với chủ ngữ ‘she’ trong câu. Động từ này giúp diễn tả trạng thái tồn tại của chủ ngữ."
    },
    {
      "en": "English speakers often use linking verbs to describe the state of the weather, or to talk about a change in state in the weather. They often use three common linking verbs for these purposes: feel, get, and look.",
      "vi": "Người nói tiếng Anh thường dùng động từ nối để diễn tả trạng thái thời tiết hoặc nói về sự thay đổi trạng thái của thời tiết. Họ thường dùng ba động từ nối phổ biến cho mục đích này: feel, get và look."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Giáo dục (Education)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Linking verbs describe a state of being or a change to a new state.",
      "vi": "Động từ nối diễn tả trạng thái tồn tại hoặc sự chuyển sang trạng thái mới."
    },
    {
      "en": "They connect the subject to an adjective or noun phrase.",
      "vi": "Chúng nối chủ ngữ với tính từ hoặc cụm danh từ."
    },
    {
      "en": "English speakers often use feel, get, and look to talk about the weather.",
      "vi": "Người nói tiếng Anh thường dùng feel, get và look để nói về thời tiết."
    }
  ],
  "quiz": [
    {
      "type": "Ý CHÍNH",
      "q": "What is the article mainly about?",
      "opts": [
        "Summer vacations in America",
        "Linking verbs and how they describe weather",
        "How to predict storms",
        "Famous American writers"
      ],
      "answer": 1,
      "explain": "The article explores the connection between linking verbs, grammar, and weather."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Which three linking verbs are commonly used to talk about weather?",
      "opts": [
        "run, jump, swim",
        "feel, get, look",
        "eat, drink, sleep",
        "is, am, are"
      ],
      "answer": 1,
      "explain": "The article names feel, get, and look as three common linking verbs for weather."
    },
    {
      "type": "TỪ VỰNG",
      "q": "In ‘She seems happy,’ the word ‘seems’ is:",
      "opts": [
        "an action verb",
        "a linking verb",
        "an adverb",
        "a noun"
      ],
      "answer": 1,
      "explain": "‘Seem’ connects the adjective ‘happy’ to the subject ‘she,’ so it is a linking verb."
    },
    {
      "type": "SUY LUẬN",
      "q": "In ‘It is getting cold,’ the verb ‘getting’ shows:",
      "opts": [
        "a finished action",
        "a change to a new state",
        "a place",
        "a person"
      ],
      "answer": 1,
      "explain": "Linking verbs like ‘get’ can describe a change to a new state."
    }
  ],
  "suggestions": [
    "Động từ nối là gì?",
    "Cho ví dụ về động từ nối",
    "Phân biệt động từ nối và động từ thường",
    "Tóm tắt bài ngữ pháp này"
  ]
},
 {
  "id": "voa-brain-cells-rats",
  "title": "To Study Disease, Scientists Put Human Brain Cells into Rats",
  "titleVi": "Nghiên cứu bệnh tật: Cấy tế bào não người vào chuột",
  "subtitle": "Level 2 · Intermediate",
  "category": "KHOA HỌC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🧠",
  "source_url": "https://learningenglish.voanews.com/a/to-study-disease-scientists-put-human-brain-cells-into-rats/6789830.html",
  "paragraphs": [
    {
      "en": "Scientists have transplanted human brain cells into the brains of baby rats, where the cells grew and formed connections.",
      "vi": "Các nhà khoa học đã cấy tế bào não người vào não của chuột con, nơi các tế bào phát triển và hình thành các kết nối."
    },
    {
      "en": "The research is part of an effort to study human brain development and diseases affecting this most complex of organs.",
      "vi": "Nghiên cứu này là một phần trong nỗ lực tìm hiểu sự phát triển của não người và các căn bệnh ảnh hưởng đến cơ quan phức tạp nhất này."
    },
    {
      "en": "“Many disorders such as autism and schizophrenia are likely uniquely human,” Pasca said. But the human brain has not been very easy to study. Research that does not involve taking tissue out of the human brain is a “promising” area for trying to deal with these conditions, Pasca added.",
      "vi": "Pasca cho biết: “Nhiều rối loạn như tự kỷ và tâm thần phân liệt có lẽ chỉ xuất hiện ở con người.” Nhưng não người vốn rất khó nghiên cứu. Ông nói thêm, các nghiên cứu không cần lấy mô ra khỏi não người là một hướng “đầy hứa hẹn” để đối phó với những căn bệnh này."
    },
    {
      "en": "The research builds upon the team’s earlier work creating brain “organoids.” These organoids are very small structures similar to human organs. Organoids have been made to represent organs such as the liver, kidneys and prostate.",
      "vi": "Nghiên cứu này dựa trên công trình trước đó của nhóm về việc tạo ra các “organoid” não. Organoid là những cấu trúc rất nhỏ tương tự cơ quan của con người. Người ta đã tạo ra organoid mô phỏng các cơ quan như gan, thận và tuyến tiền liệt."
    },
    {
      "en": "To make the brain organoids, Stanford University scientists changed human skin cells into stem cells. They then caused the stem cells to become several kinds of brain cells. Those cells then grew in number to form organoids that resemble the cerebral cortex, the human brain’s outermost layer. The cerebral cortex is linked to memory, thinking, learning, reasoning and emotions.",
      "vi": "Để tạo organoid não, các nhà khoa học Đại học Stanford đã biến đổi tế bào da người thành tế bào gốc. Sau đó, họ khiến tế bào gốc phát triển thành nhiều loại tế bào não khác nhau. Những tế bào này tiếp tục nhân lên để tạo thành organoid giống với vỏ não — lớp ngoài cùng của não người. Vỏ não liên quan đến trí nhớ, tư duy, học tập, lập luận và cảm xúc."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Khoa học (Science)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Scientists transplanted human brain cells into baby rats to study brain diseases.",
      "vi": "Các nhà khoa học cấy tế bào não người vào chuột con để nghiên cứu các bệnh về não."
    },
    {
      "en": "The research uses brain organoids grown from human stem cells.",
      "vi": "Nghiên cứu sử dụng organoid não được nuôi từ tế bào gốc của con người."
    },
    {
      "en": "This work may help treat uniquely human disorders like autism and schizophrenia.",
      "vi": "Công trình này có thể giúp điều trị các rối loạn đặc trưng ở người như tự kỷ và tâm thần phân liệt."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What did scientists transplant into the brains of baby rats?",
      "opts": [
        "Human brain cells",
        "Rat brain cells",
        "Human skin cells",
        "Stem cells from mice"
      ],
      "answer": 0,
      "explain": "The article says scientists transplanted human brain cells into the brains of baby rats."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What are brain organoids?",
      "opts": [
        "Very small structures similar to human organs",
        "Large machines used in brain surgery",
        "Medicines that treat brain diseases",
        "Computers that copy the human brain"
      ],
      "answer": 0,
      "explain": "Organoids are very small structures similar to human organs."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why is this research important for disorders like autism?",
      "opts": [
        "Because these disorders are likely uniquely human and the human brain is hard to study",
        "Because rats also suffer from autism",
        "Because it proves rats are smarter than humans",
        "Because organoids can replace human brains"
      ],
      "answer": 0,
      "explain": "Pasca said disorders like autism are likely uniquely human, and studying the human brain directly is difficult."
    },
    {
      "type": "TỪ VỰNG",
      "q": "What does “transplant” mean in this article?",
      "opts": [
        "To move cells or tissue from one body to another",
        "To cut cells into small pieces",
        "To look at cells under a microscope",
        "To destroy harmful cells"
      ],
      "answer": 0,
      "explain": "Scientists transplanted, or moved, human brain cells into the brains of rats."
    }
  ],
  "suggestions": [
    "Organoid là gì?",
    "Vì sao não người khó nghiên cứu?",
    "Tóm tắt bài này",
    "Nghiên cứu này giúp chữa bệnh gì?"
  ]
},
 {
  "id": "voa-fusion-reaction",
  "title": "US Researchers Report Successful Fusion Reaction",
  "titleVi": "Mỹ đạt bước tiến trong phản ứng nhiệt hạch",
  "subtitle": "Level 2 · Intermediate",
  "category": "KHOA HỌC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "⚛️",
  "source_url": "https://learningenglish.voanews.com/a/us-researchers-report-successful-fusion-reaction/6417024.html",
  "paragraphs": [
    {
      "en": "U.S. government researchers said they were able to cause a fusion reaction that sustained itself and produced energy for a very short period. The scientists said this was an important step because it is very difficult to get fusion to become self-sustaining. Fusion requires extremely high temperatures and pressures, and the process can easily stop.",
      "vi": "Các nhà nghiên cứu của chính phủ Mỹ cho biết họ đã tạo ra một phản ứng nhiệt hạch có thể tự duy trì và sinh năng lượng trong thời gian rất ngắn. Các nhà khoa học nói đây là bước tiến quan trọng vì rất khó để phản ứng nhiệt hạch tự duy trì. Nhiệt hạch đòi hỏi nhiệt độ và áp suất cực cao, và quá trình này rất dễ dừng lại."
    },
    {
      "en": "Fusion happens when the nuclei of two atoms are subjected to extreme heat. This leads to the formation of a new, larger atom and the release of energy. Fusion is the process that fuels stars, including the sun. Some experts have suggested that someday, fusion energy could be used to provide limitless, pollution-free power.",
      "vi": "Nhiệt hạch xảy ra khi hạt nhân của hai nguyên tử chịu tác động của nhiệt độ cực cao. Quá trình này tạo ra một nguyên tử mới lớn hơn và giải phóng năng lượng. Nhiệt hạch chính là quá trình cung cấp năng lượng cho các ngôi sao, bao gồm cả mặt trời. Một số chuyên gia cho rằng một ngày nào đó, năng lượng nhiệt hạch có thể mang lại nguồn điện vô hạn và không gây ô nhiễm."
    },
    {
      "en": "One barrier to that goal is the fact that the fusion process itself needs a lot of energy. Scientists have not yet performed a fusion reaction that releases more energy than it requires.",
      "vi": "Một rào cản lớn là bản thân quá trình nhiệt hạch cần rất nhiều năng lượng. Cho đến nay, các nhà khoa học vẫn chưa thực hiện được phản ứng nhiệt hạch nào giải phóng nhiều năng lượng hơn mức nó tiêu thụ."
    },
    {
      "en": "Government scientists with the National Ignition Facility at the Lawrence Livermore National Laboratory in California carried out the experiments. The lab is part of the U.S. Department of Energy.",
      "vi": "Các thí nghiệm do các nhà khoa học chính phủ tại Cơ sở Đánh lửa Quốc gia thuộc Phòng thí nghiệm Quốc gia Lawrence Livermore ở California thực hiện. Phòng thí nghiệm này thuộc Bộ Năng lượng Mỹ."
    },
    {
      "en": "The experiments took place in November 2020 and February 2021. Research results recently appeared in a study in the publication Nature Physics.",
      "vi": "Các thí nghiệm diễn ra vào tháng 11 năm 2020 và tháng 2 năm 2021. Kết quả nghiên cứu vừa được công bố trên tạp chí Nature Physics."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Khoa học (Science)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "U.S. scientists achieved a self-sustaining fusion reaction for a very short time.",
      "vi": "Các nhà khoa học Mỹ đã tạo ra phản ứng nhiệt hạch tự duy trì trong thời gian rất ngắn."
    },
    {
      "en": "Fusion powers the sun and could one day provide clean, limitless energy.",
      "vi": "Nhiệt hạch cung cấp năng lượng cho mặt trời và một ngày nào đó có thể mang lại nguồn năng lượng sạch vô hạn."
    },
    {
      "en": "Scientists have not yet produced more energy from fusion than the process uses.",
      "vi": "Các nhà khoa học vẫn chưa tạo ra được nhiều năng lượng từ nhiệt hạch hơn mức quá trình này tiêu thụ."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What did U.S. researchers achieve in the fusion experiments?",
      "opts": [
        "A fusion reaction that sustained itself for a very short period",
        "A fusion reactor that powers a whole city",
        "A new kind of solar panel",
        "A way to stop fusion reactions"
      ],
      "answer": 0,
      "explain": "The researchers caused a fusion reaction that sustained itself and produced energy briefly."
    },
    {
      "type": "Ý CHÍNH",
      "q": "Why is fusion energy considered promising?",
      "opts": [
        "It could provide limitless, pollution-free power",
        "It is cheaper than all other energy sources",
        "It works without any heat or pressure",
        "It has already replaced coal power"
      ],
      "answer": 0,
      "explain": "Experts suggest fusion could one day provide limitless, pollution-free power."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What is one major barrier to fusion energy?",
      "opts": [
        "The process needs more energy than it currently releases",
        "Fusion only works in outer space",
        "Scientists cannot find the right atoms",
        "Fusion produces too much pollution"
      ],
      "answer": 0,
      "explain": "Scientists have not yet performed a fusion reaction that releases more energy than it requires."
    },
    {
      "type": "TỪ VỰNG",
      "q": "What does “sustain” mean in this article?",
      "opts": [
        "To keep something continuing over time",
        "To stop something suddenly",
        "To measure temperature",
        "To build a laboratory"
      ],
      "answer": 0,
      "explain": "The fusion reaction sustained itself, meaning it kept going on its own."
    }
  ],
  "suggestions": [
    "Nhiệt hạch là gì?",
    "Vì sao nhiệt hạch khó thực hiện?",
    "Tóm tắt bài này",
    "Thí nghiệm này do ai thực hiện?"
  ]
},
 {
  "id": "voa-child-vaccines-drop",
  "title": "UN Warns of ‘Alarming’ Drop in Child Vaccines During Coronavirus",
  "titleVi": "LHQ cảnh báo sụt giảm đáng báo động về tiêm chủng trẻ em",
  "subtitle": "Level 2 · Intermediate",
  "category": "SỨC KHỎE · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "💉",
  "source_url": "https://learningenglish.voanews.com/a/un-warns-of-alarming-drop-in-child-vaccines-during-coronavirus/5507022.html",
  "paragraphs": [
    {
      "en": "The United Nations has warned of an “alarming” decrease in the number of children receiving life-saving vaccines around the world.",
      "vi": "Liên Hợp Quốc đã cảnh báo về sự sụt giảm “đáng báo động” số trẻ em được tiêm các loại vắc-xin cứu sống trên toàn thế giới."
    },
    {
      "en": "The drop included vaccinations for preventable diseases such as diphtheria, tetanus and measles, the U.N. said in a statement. The U.N.’s World Health Organization and UNICEF blame the decrease on the change in routine health care caused by the coronavirus crisis.",
      "vi": "Trong một tuyên bố, LHQ cho biết sự sụt giảm bao gồm các mũi tiêm phòng những bệnh có thể ngăn ngừa như bạch hầu, uốn ván và sởi. Tổ chức Y tế Thế giới và UNICEF cho rằng nguyên nhân là do dịch vụ y tế thường xuyên bị gián đoạn bởi cuộc khủng hoảng virus corona."
    },
    {
      "en": "“Vaccines are one of the most powerful tools in the history of public health, and more children are now being immunized than ever before,” WHO chief Dr. Tedros Adhanom Ghebreyesus said in a statement.",
      "vi": "Tổng giám đốc WHO, Tiến sĩ Tedros Adhanom Ghebreyesus, phát biểu trong một tuyên bố: “Vắc-xin là một trong những công cụ mạnh mẽ nhất trong lịch sử y tế công cộng, và hiện nay số trẻ em được tiêm chủng nhiều hơn bao giờ hết.”"
    },
    {
      "en": "“But the pandemic has put those gains at risk. The avoidable suffering and death caused by children missing out on routine immunizations could be far greater than COVID-19 itself.”",
      "vi": "“Nhưng đại dịch đã đe dọa những thành quả đó. Những đau khổ và tử vong hoàn toàn có thể tránh được do trẻ em bỏ lỡ tiêm chủng định kỳ có thể còn lớn hơn nhiều so với chính COVID-19.”"
    },
    {
      "en": "The WHO and UNICEF said that even when vaccines are available, many children who need them are afraid to leave their homes because of the coronavirus. Others face difficulties traveling because of COVID-19 restrictions.",
      "vi": "WHO và UNICEF cho biết ngay cả khi có sẵn vắc-xin, nhiều trẻ em cần tiêm vẫn sợ rời khỏi nhà vì virus corona. Những em khác gặp khó khăn trong việc đi lại do các hạn chế phòng chống COVID-19."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Sức khỏe (Health)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "The UN warned of an alarming drop in child vaccinations during the pandemic.",
      "vi": "LHQ cảnh báo sự sụt giảm đáng báo động về tiêm chủng trẻ em trong đại dịch."
    },
    {
      "en": "Disrupted health services left children unprotected against preventable diseases.",
      "vi": "Dịch vụ y tế bị gián đoạn khiến trẻ em không được bảo vệ trước các bệnh có thể phòng ngừa."
    },
    {
      "en": "Missing routine vaccines could cause more suffering than COVID-19 itself.",
      "vi": "Việc bỏ lỡ tiêm chủng định kỳ có thể gây đau khổ nhiều hơn cả COVID-19."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What did the United Nations warn about?",
      "opts": [
        "An alarming decrease in children receiving vaccines",
        "A new kind of coronavirus",
        "A shortage of doctors",
        "An increase in vaccine prices"
      ],
      "answer": 0,
      "explain": "The UN warned of an alarming decrease in the number of children receiving life-saving vaccines."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Which diseases are mentioned as preventable by vaccines?",
      "opts": [
        "Diphtheria, tetanus and measles",
        "Cancer, diabetes and asthma",
        "Malaria, dengue and flu",
        "COVID-19, SARS and MERS"
      ],
      "answer": 0,
      "explain": "The article names diphtheria, tetanus and measles as preventable diseases."
    },
    {
      "type": "SUY LUẬN",
      "q": "Why are many children missing vaccinations even when vaccines are available?",
      "opts": [
        "They are afraid to leave home or cannot travel due to restrictions",
        "Their parents do not believe in vaccines",
        "Vaccines have become too expensive",
        "Hospitals refuse to give vaccines"
      ],
      "answer": 0,
      "explain": "Many children are afraid to leave home, and others face travel difficulties from COVID-19 restrictions."
    },
    {
      "type": "Ý CHÍNH",
      "q": "What is the main message of the article?",
      "opts": [
        "The pandemic threatens years of progress in child immunization",
        "Vaccines are no longer effective",
        "COVID-19 only affects adults",
        "UNICEF has stopped all vaccine programs"
      ],
      "answer": 0,
      "explain": "The WHO chief said the pandemic has put gains in immunization at risk."
    }
  ],
  "suggestions": [
    "Vì sao trẻ em bỏ lỡ tiêm chủng?",
    "Vắc-xin quan trọng thế nào?",
    "Tóm tắt bài này",
    "WHO nói gì về đại dịch?"
  ]
},
 {
  "id": "voa-college-football-cancel",
  "title": "Major Universities Cancel Fall Football Seasons over Coronavirus",
  "titleVi": "Các trường đại học lớn hủy mùa bóng bầu dục vì virus corona",
  "subtitle": "Level 2 · Intermediate",
  "category": "GIÁO DỤC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🏈",
  "source_url": "https://learningenglish.voanews.com/a/major-universities-cancel-fall-football-seasons-over-coronavirus/5544219.html",
  "paragraphs": [
    {
      "en": "Two major college football conferences recently canceled their fall seasons because of concerns over the new coronavirus.",
      "vi": "Hai liên đoàn bóng bầu dục đại học lớn gần đây đã hủy mùa giải mùa thu vì lo ngại virus corona mới."
    },
    {
      "en": "The Big Ten and Pac-12 athletic conferences announced they would not have a fall football season and would also postpone other sports.",
      "vi": "Hai liên đoàn thể thao Big Ten và Pac-12 thông báo sẽ không tổ chức mùa bóng bầu dục mùa thu và cũng hoãn các môn thể thao khác."
    },
    {
      "en": "College football is a tradition in America and has millions of fans across the country. The two powerful conferences have valuable agreements to play games shown on television.",
      "vi": "Bóng bầu dục đại học là một truyền thống ở Mỹ với hàng triệu người hâm mộ trên khắp đất nước. Hai liên đoàn hùng mạnh này có những hợp đồng truyền hình giá trị để phát sóng các trận đấu."
    },
    {
      "en": "The move comes five months after the spread of coronavirus cases in the U.S. led to the cancellation of the men’s and women’s NCAA basketball tournaments. Other winter sports also had their seasons cut short and spring sports were canceled.",
      "vi": "Quyết định này được đưa ra năm tháng sau khi dịch virus corona lan rộng ở Mỹ khiến giải bóng rổ NCAA nam và nữ bị hủy. Các môn thể thao mùa đông khác cũng bị cắt ngắn mùa giải, còn thể thao mùa xuân thì bị hủy bỏ."
    },
    {
      "en": "Players, coaches and even U.S. President Donald Trump have asked that the season be held in some way. However, 40 percent of major college football teams have now decided to cancel the fall season.",
      "vi": "Các cầu thủ, huấn luyện viên và thậm chí cả Tổng thống Mỹ Donald Trump đều mong muốn mùa giải được tổ chức bằng cách nào đó. Tuy nhiên, 40% các đội bóng bầu dục đại học lớn đã quyết định hủy mùa giải mùa thu."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Giáo dục (Education)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "Two major college football conferences canceled their fall seasons over coronavirus concerns.",
      "vi": "Hai liên đoàn bóng bầu dục đại học lớn đã hủy mùa giải mùa thu vì lo ngại virus corona."
    },
    {
      "en": "College football is a beloved American tradition with millions of fans.",
      "vi": "Bóng bầu dục đại học là truyền thống được yêu thích ở Mỹ với hàng triệu người hâm mộ."
    },
    {
      "en": "Many other college sports had already been canceled or cut short by the pandemic.",
      "vi": "Nhiều môn thể thao đại học khác cũng đã bị hủy hoặc cắt ngắn vì đại dịch."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Which two conferences canceled their fall football seasons?",
      "opts": [
        "The Big Ten and Pac-12",
        "The SEC and ACC",
        "The Big 12 and Big East",
        "The Ivy League and MAC"
      ],
      "answer": 0,
      "explain": "The Big Ten and Pac-12 announced they would not have a fall football season."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Why were the seasons canceled?",
      "opts": [
        "Concerns over the new coronavirus",
        "Lack of television viewers",
        "A strike by the players",
        "Bad weather conditions"
      ],
      "answer": 0,
      "explain": "The conferences canceled because of concerns over the new coronavirus."
    },
    {
      "type": "SUY LUẬN",
      "q": "What does the article suggest about the importance of college football in America?",
      "opts": [
        "It is a tradition with millions of fans and valuable TV deals",
        "It is only popular among students",
        "It loses money every year",
        "It was recently invented"
      ],
      "answer": 0,
      "explain": "College football is described as a tradition with millions of fans and valuable television agreements."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "According to the article, what percentage of major college football teams canceled the fall season?",
      "opts": [
        "40 percent",
        "10 percent",
        "75 percent",
        "100 percent"
      ],
      "answer": 0,
      "explain": "Forty percent of major college football teams decided to cancel the fall season."
    }
  ],
  "suggestions": [
    "Vì sao mùa giải bị hủy?",
    "Bóng bầu dục đại học là gì?",
    "Tóm tắt bài này",
    "Ai muốn mùa giải tiếp tục?"
  ]
},
 {
  "id": "voa-school-for-husbands",
  "title": "In Burkina Faso, a School for Husbands",
  "titleVi": "Ở Burkina Faso, trường học dành cho các ông chồng",
  "subtitle": "Level 2 · Intermediate",
  "category": "ĐỜI SỐNG · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "👨‍👩‍👧",
  "source_url": "https://learningenglish.voanews.com/a/in-burkina-faso-a-school-for-husbands/6392784.html",
  "paragraphs": [
    {
      "en": "In the West African nation of Burkina Faso, wives are often blamed when marriages run into trouble. The World Bank is supporting a project to teach men how to be better husbands by taking them to school.",
      "vi": "Ở quốc gia Tây Phi Burkina Faso, người vợ thường bị đổ lỗi khi hôn nhân gặp trục trặc. Ngân hàng Thế giới đang hỗ trợ một dự án dạy đàn ông cách trở thành người chồng tốt hơn bằng cách đưa họ đến trường."
    },
    {
      "en": "Yeli Ouigo attended one of the “husband schools” to help him become a better spouse to Kwama Zoupoka, his wife.",
      "vi": "Yeli Ouigo đã tham gia một trong những “trường học cho chồng” để trở thành người bạn đời tốt hơn của vợ mình, Kwama Zoupoka."
    },
    {
      "en": "He said that there was a time when he did not think that women and men had much in common when it came to problems with family life. After the classes, however, he understood that married couples can help each other.",
      "vi": "Anh cho biết trước đây anh từng nghĩ đàn ông và phụ nữ chẳng có mấy điểm chung khi nói về những vấn đề trong đời sống gia đình. Tuy nhiên, sau các buổi học, anh đã hiểu rằng vợ chồng có thể giúp đỡ lẫn nhau."
    },
    {
      "en": "The schools use many teaching techniques. They include role play, to help the men understand the needs of their wives and how to meet them — for example, helping with housework.",
      "vi": "Các trường học áp dụng nhiều phương pháp giảng dạy, trong đó có đóng vai, giúp đàn ông hiểu nhu cầu của vợ và cách đáp ứng — chẳng hạn như phụ giúp việc nhà."
    },
    {
      "en": "They also teach the men about women’s rights, family planning, health and hygiene. In addition, men are encouraged to include women in making family decisions.",
      "vi": "Họ cũng dạy đàn ông về quyền của phụ nữ, kế hoạch hóa gia đình, sức khỏe và vệ sinh. Ngoài ra, đàn ông được khuyến khích để phụ nữ cùng tham gia quyết định các vấn đề gia đình."
    }
  ],
  "info_rows": [
    [
      "CHỦ ĐỀ",
      "Đời sống (Life)"
    ],
    [
      "TRÌNH ĐỘ",
      "Level 2 · Intermediate"
    ],
    [
      "NGUỒN",
      "VOA Learning English"
    ]
  ],
  "timeline": [],
  "main_ideas": [
    {
      "en": "A World Bank project in Burkina Faso teaches men to be better husbands.",
      "vi": "Một dự án của Ngân hàng Thế giới ở Burkina Faso dạy đàn ông cách làm chồng tốt hơn."
    },
    {
      "en": "The schools use role play to help men understand their wives’ needs.",
      "vi": "Các trường dùng phương pháp đóng vai để giúp đàn ông hiểu nhu cầu của vợ."
    },
    {
      "en": "Men learn about women’s rights and including wives in family decisions.",
      "vi": "Đàn ông được học về quyền phụ nữ và việc để vợ cùng tham gia quyết định gia đình."
    }
  ],
  "quiz": [
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What is the “school for husbands” in Burkina Faso?",
      "opts": [
        "A project teaching men how to be better husbands",
        "A university for married men",
        "A school that only admits husbands",
        "A training center for teachers"
      ],
      "answer": 0,
      "explain": "The project teaches men how to be better husbands."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "Who is funding the project?",
      "opts": [
        "The World Bank",
        "The United Nations",
        "The Red Cross",
        "The local government"
      ],
      "answer": 0,
      "explain": "The project is funded by the World Bank."
    },
    {
      "type": "SUY LUẬN",
      "q": "What did Yeli Ouigo learn from the classes?",
      "opts": [
        "That married couples can help each other",
        "That men should make all decisions",
        "That housework is only for women",
        "That schools are useless"
      ],
      "answer": 0,
      "explain": "After the classes, he understood that married couples can help each other."
    },
    {
      "type": "CHI TIẾT TRONG BÀI",
      "q": "What do the schools teach besides role play?",
      "opts": [
        "Women’s rights, family planning, health and hygiene",
        "Football and basketball",
        "English and mathematics",
        "Cooking and driving"
      ],
      "answer": 0,
      "explain": "They teach about women’s rights, family planning, health and hygiene."
    }
  ],
  "suggestions": [
    "“Trường học cho chồng” là gì?",
    "Dự án này do ai tài trợ?",
    "Tóm tắt bài này",
    "Họ dạy những gì?"
  ]
},
 {
  "id": "voa-air-quality",
  "title": "How to Reduce Risks of Bad Air Quality",
  "titleVi": "Chuyên gia chỉ cách giảm nguy cơ từ ô nhiễm không khí.",
  "subtitle": "Level 3 · Advanced",
  "category": "SỨC KHỎE · VOA LEARNING ENGLISH",
  "level": "Level 3 · Advanced",
  "emoji": "🌫️",
  "source_url": "https://learningenglish.voanews.com/a/how-to-reduce-risks-of-bad-air-quality/7980912.html",
  "paragraphs": [
   {
    "en": "Air quality differs from place to place and day to day. But about 99 percent of the world’s population breathes air at some point that does not meet pollution guidelines set by the World Health Organization (WHO).",
    "vi": "Chất lượng không khí khác nhau tùy nơi và tùy ngày. Nhưng khoảng 99% dân số thế giới có lúc phải hít thở bầu không khí không đạt tiêu chuẩn ô nhiễm do Tổ chức Y tế Thế giới (WHO) đặt ra."
   },
   {
    "en": "Different forms of air pollution kill about 7 million people each year, the U.N. health agency estimates. But health experts say there are some actions individuals can take to protect themselves, even in the world’s most polluted cities.",
    "vi": "Cơ quan y tế của Liên Hợp Quốc ước tính các dạng ô nhiễm không khí khác nhau giết chết khoảng 7 triệu người mỗi năm. Nhưng các chuyên gia y tế cho biết mỗi cá nhân vẫn có thể làm một số việc để tự bảo vệ mình, ngay cả ở những thành phố ô nhiễm nhất thế giới."
   },
   {
    "en": "The first step is to start with the understanding that air is not only polluted when it looks smoky or smoggy, said Tanushree Ganguly. She is an air quality expert with the Energy Policy Institute of Chicago’s India program.",
    "vi": "Bước đầu tiên là hiểu rằng không khí không chỉ ô nhiễm khi trông có vẻ đầy khói hay mù mịt, bà Tanushree Ganguly cho biết. Bà là chuyên gia chất lượng không khí thuộc chương trình Ấn Độ của Viện Chính sách Năng lượng Chicago."
   },
   {
    "en": "“Blue skies can’t guarantee you clean air,” Ganguly told The Associated Press.",
    "vi": "“Bầu trời xanh không đảm bảo cho bạn không khí sạch,” bà Ganguly nói với hãng tin Associated Press."
   },
   {
    "en": "Air pollutants often come from people burning things. Examples include fuels as well as clearing operations involving crops or trees. Pollutants can also be released from wildfires.",
    "vi": "Chất gây ô nhiễm không khí thường xuất phát từ việc con người đốt cháy thứ gì đó. Ví dụ như đốt nhiên liệu, hay đốt dọn cây trồng, cây cối. Chất ô nhiễm cũng có thể thải ra từ cháy rừng."
   },
   {
    "en": "Among the most dangerous particles we can breathe in are called particulate matter. The smallest of these are known as PM 2.5. This is because they are less than 2.5 microns in diameter. These particles can travel deep inside human lungs and are mostly created by burning fuels. Larger particles, known as PM 10, are linked to agriculture, roadways, mining or wind-blown dust.",
    "vi": "Trong số các hạt nguy hiểm nhất mà chúng ta hít vào có loại gọi là bụi mịn (particulate matter). Loại nhỏ nhất trong số đó được gọi là PM 2.5, vì chúng có đường kính nhỏ hơn 2,5 micron. Những hạt này có thể đi sâu vào phổi người và chủ yếu sinh ra từ việc đốt nhiên liệu. Các hạt lớn hơn, gọi là PM 10, liên quan đến nông nghiệp, đường sá, khai mỏ hoặc bụi do gió cuốn."
   },
   {
    "en": "Other dangerous pollutants include gases like nitrogen dioxide or sulfur dioxide, which are also produced from burning fuels.",
    "vi": "Các chất ô nhiễm nguy hiểm khác gồm những khí như nitrogen dioxide hay sulfur dioxide, cũng sinh ra từ việc đốt nhiên liệu."
   },
   {
    "en": "The American-based Health Effects Institute says air pollution is the second-largest risk factor for early death worldwide, behind high blood pressure.",
    "vi": "Viện Ảnh hưởng Sức khỏe có trụ sở tại Mỹ cho biết ô nhiễm không khí là yếu tố nguy cơ gây tử vong sớm lớn thứ hai trên thế giới, chỉ sau huyết áp cao."
   },
   {
    "en": "Short-term exposure can cause asthma attacks and increase the risk of heart attacks and stroke, especially in older people and those with existing medical problems. Long-term exposure can cause serious heart and lung problems that can lead to death.",
    "vi": "Tiếp xúc trong thời gian ngắn có thể gây cơn hen suyễn và tăng nguy cơ đau tim, đột quỵ, đặc biệt ở người cao tuổi và người đã có bệnh nền. Tiếp xúc lâu dài có thể gây các bệnh tim, phổi nghiêm trọng dẫn đến tử vong."
   },
   {
    "en": "A recent study by the U.N. children’s agency UNICEF found that more than 500 million children in East Asia and Pacific countries breathe unhealthy air. The pollution is linked to the deaths of 100 children under age 5 every day.",
    "vi": "Một nghiên cứu gần đây của Quỹ Nhi đồng Liên Hợp Quốc UNICEF cho thấy hơn 500 triệu trẻ em ở Đông Á và Thái Bình Dương đang hít thở không khí không lành mạnh. Ô nhiễm liên quan đến cái chết của 100 trẻ dưới 5 tuổi mỗi ngày."
   },
   {
    "en": "Over 6,000 cities in 117 countries now record and follow air quality levels. To help people better understand air quality levels, many countries have established an air quality index, or AQI. Larger numbers on this index mean worse air.",
    "vi": "Hơn 6.000 thành phố ở 117 quốc gia hiện nay ghi nhận và theo dõi mức chất lượng không khí. Để giúp người dân hiểu rõ hơn, nhiều nước đã lập ra chỉ số chất lượng không khí, gọi là AQI. Số càng lớn thì không khí càng tệ."
   },
   {
    "en": "For individuals, experts say the goal should be to limit exposure when air quality is bad, by staying indoors or wearing a mask.",
    "vi": "Với mỗi cá nhân, các chuyên gia cho biết mục tiêu nên là hạn chế tiếp xúc khi chất lượng không khí xấu, bằng cách ở trong nhà hoặc đeo khẩu trang."
   },
   {
    "en": "People also need to watch indoor air pollution that can be caused by common household activities like cooking or burning incense.",
    "vi": "Mọi người cũng cần chú ý ô nhiễm không khí trong nhà, có thể do các sinh hoạt thường ngày như nấu ăn hay đốt nhang."
   },
   {
    "en": "While air purifiers can help reduce indoor air pollution, experts say they do have limitations. Air purifiers work best when used in small spaces and when people are nearby.",
    "vi": "Máy lọc không khí có thể giúp giảm ô nhiễm trong nhà, nhưng các chuyên gia cho biết chúng cũng có giới hạn. Máy lọc hoạt động tốt nhất khi dùng trong không gian nhỏ và khi có người ở gần."
   },
   {
    "en": "Aniruddha Ghosal reported on this story for the Associated Press. John Russell adapted it for VOA Learning English.",
    "vi": "Aniruddha Ghosal đưa tin bài này cho hãng Associated Press. John Russell chuyển soạn cho VOA Learning English."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Sức khỏe (Health)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 3 · Advanced"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "About 99% of people breathe polluted air, which kills around 7 million people each year.",
    "vi": "Khoảng 99% dân số hít thở không khí ô nhiễm, gây tử vong khoảng 7 triệu người mỗi năm."
   },
   {
    "en": "Clean-looking air can still be polluted; the most dangerous particles are tiny PM 2.5 from burning fuels.",
    "vi": "Không khí trông sạch vẫn có thể ô nhiễm; hạt nguy hiểm nhất là PM 2.5 siêu nhỏ từ việc đốt nhiên liệu."
   },
   {
    "en": "People can protect themselves by limiting exposure on bad-air days, watching indoor air, and using purifiers wisely.",
    "vi": "Mọi người có thể tự bảo vệ bằng cách hạn chế tiếp xúc vào ngày không khí xấu, chú ý không khí trong nhà và dùng máy lọc hợp lý."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "According to the article, what should people do when air quality is bad?",
    "opts": [
     "Exercise outdoors",
     "Stay indoors or wear a mask",
     "Open all windows",
     "Burn incense"
    ],
    "answer": 1,
    "explain": "Bài đọc khuyên hạn chế tiếp xúc khi không khí xấu bằng cách ở trong nhà hoặc đeo khẩu trang."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word 'expose' in the article is closest in meaning to...",
    "opts": [
     "subject to risk",
     "protect",
     "remove",
     "clean"
    ],
    "answer": 0,
    "explain": "Theo VOA, 'expose' nghĩa là đặt ai/cái gì vào tình trạng có nguy cơ bị hại — gần nhất với 'subject to risk'."
   },
   {
    "type": "SUY LUẬN",
    "q": "What can be inferred from \"Blue skies can’t guarantee you clean air\"?",
    "opts": [
     "Blue skies are always polluted",
     "Air can be polluted even when it looks clean",
     "Only smoky air is dangerous",
     "Air pollution is not real"
    ],
    "answer": 1,
    "explain": "Câu nói hàm ý không khí có thể ô nhiễm ngay cả khi trông sạch sẽ, vì nhiều chất ô nhiễm vô hình."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Air pollution only happens in big cities",
     "People cannot protect themselves from pollution",
     "Air pollution is a major health risk, but individuals can take steps to reduce exposure",
     "Air purifiers solve all indoor pollution"
    ],
    "answer": 2,
    "explain": "Ý chính: ô nhiễm không khí là nguy cơ sức khỏe lớn, nhưng mỗi người vẫn có thể làm một số việc để giảm tiếp xúc."
   }
  ],
  "suggestions": [
   "PM 2.5 là gì?",
   "Vì sao ô nhiễm không khí nguy hiểm?",
   "Tóm tắt bài này",
   "Làm sao tự bảo vệ khi không khí xấu?"
  ]
 },
 {
  "id": "voa-vision-trouble",
  "title": "Experts Provide Tips for Avoiding Computer-linked Vision Trouble",
  "titleVi": "Mẹo tránh mỏi mắt khi dùng máy tính nhiều.",
  "subtitle": "Level 2 · Intermediate",
  "category": "SỨC KHỎE · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "👀",
  "source_url": "https://learningenglish.voanews.com/a/experts-provide-tips-for-avoiding-computer-linked-vision-trouble/7953508.html",
  "paragraphs": [
   {
    "en": "Computer, or digital, screens are common at work, homes, schools, and stores. An estimated 104 million Americans of working age spend more than seven hours a day in front of screens, the American Optometric Association says. All that screen time can cause harm.",
    "vi": "Màn hình máy tính, hay màn hình kỹ thuật số, rất phổ biến ở nơi làm việc, nhà ở, trường học và cửa hàng. Hiệp hội Đo thị lực Mỹ ước tính khoảng 104 triệu người Mỹ trong độ tuổi lao động dành hơn 7 tiếng mỗi ngày trước màn hình. Ngần ấy thời gian dùng màn hình có thể gây hại."
   },
   {
    "en": "Too much screen viewing can lead to dry or watery eyes, unclear vision and headaches. It can also lead to vision conditions including myopia, or nearsightedness, especially in children.",
    "vi": "Nhìn màn hình quá nhiều có thể gây khô mắt hoặc chảy nước mắt, nhìn mờ và đau đầu. Nó cũng có thể dẫn đến các tật về mắt như cận thị, đặc biệt ở trẻ em."
   },
   {
    "en": "However, exposure to blue light from digital screens has not been shown to cause permanent eye damage, the American Academy of Ophthalmology says.",
    "vi": "Tuy nhiên, Viện Nhãn khoa Mỹ cho biết chưa có bằng chứng cho thấy ánh sáng xanh từ màn hình kỹ thuật số gây tổn thương mắt vĩnh viễn."
   },
   {
    "en": "One reason for the screen-linked vision problems lies in the eye muscles. Staring closely at screens for long amounts of time can cause the muscle used for eye focus to become too tense, or tight.",
    "vi": "Một nguyên nhân của các vấn đề thị lực do màn hình nằm ở cơ mắt. Nhìn chằm chằm vào màn hình ở cự ly gần trong thời gian dài có thể khiến cơ dùng để điều tiết mắt bị căng cứng."
   },
   {
    "en": "The vision problems can affect work, family time and rest. Experts suggest that people with such problems get an eye examination and take regular breaks from screen viewing.",
    "vi": "Các vấn đề thị lực có thể ảnh hưởng đến công việc, thời gian bên gia đình và nghỉ ngơi. Các chuyên gia khuyên người gặp vấn đề này nên đi khám mắt và nghỉ ngơi đều đặn khi dùng màn hình."
   },
   {
    "en": "Take a break every 20 minutes from looking at a computer. During the break, focus your eyes on something that is about 20 feet away (6 meters) for 20 seconds. This will help ease tired, tight eye muscles. This is called the 20-20-20 rule.",
    "vi": "Hãy nghỉ ngơi sau mỗi 20 phút nhìn máy tính. Trong lúc nghỉ, hãy nhìn vào vật cách khoảng 20 feet (6 mét) trong 20 giây. Việc này giúp thư giãn cơ mắt đang mỏi, căng cứng. Đó gọi là quy tắc 20-20-20."
   },
   {
    "en": "People normally close their eyes very briefly about 18 to 22 times per minute. But when looking at a screen, people might close their eyes only three to seven times per minute. That is when use of eye drops might be considered.",
    "vi": "Bình thường người ta chớp mắt rất nhanh khoảng 18 đến 22 lần mỗi phút. Nhưng khi nhìn màn hình, người ta có thể chỉ chớp mắt 3 đến 7 lần mỗi phút. Đó là lúc nên cân nhắc dùng thuốc nhỏ mắt."
   },
   {
    "en": "Sitting an arm’s length away from your screen and looking down at it also can help reduce eye strain.",
    "vi": "Ngồi cách màn hình một sải tay và nhìn hơi chúc xuống màn hình cũng giúp giảm mỏi mắt."
   },
   {
    "en": "Some products for computer users, such as blue light glasses, are marketed with claims that they will reduce eye strain. But several studies have found the glasses are not very effective.",
    "vi": "Một số sản phẩm cho người dùng máy tính, như kính chống ánh sáng xanh, được quảng cáo là giảm mỏi mắt. Nhưng nhiều nghiên cứu cho thấy loại kính này không hiệu quả lắm."
   },
   {
    "en": "Children should follow the 20-20-20-2 rule. The added “2” stands for 2 hours of play outside every day, which helps with eye development.",
    "vi": "Trẻ em nên theo quy tắc 20-20-20-2. Số “2” thêm vào nghĩa là 2 giờ vui chơi ngoài trời mỗi ngày, giúp mắt phát triển tốt."
   },
   {
    "en": "To give your eyes and brain the rest they need, doctors suggest turning off screens one to two hours before going to sleep.",
    "vi": "Để mắt và não được nghỉ ngơi cần thiết, bác sĩ khuyên nên tắt màn hình 1 đến 2 tiếng trước khi đi ngủ."
   },
   {
    "en": "Cathy Bussewitz reported on this story for the Associated Press. John Russell adapted it for VOA Learning English.",
    "vi": "Cathy Bussewitz đưa tin bài này cho hãng Associated Press. John Russell chuyển soạn cho VOA Learning English."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Sức khỏe (Health)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 2 · Intermediate"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "Long screen time can cause dry eyes, unclear vision, headaches, and myopia, especially in children.",
    "vi": "Dùng màn hình lâu có thể gây khô mắt, nhìn mờ, đau đầu và cận thị, nhất là ở trẻ em."
   },
   {
    "en": "The 20-20-20 rule — plus outdoor play for children — helps relax tired eye muscles.",
    "vi": "Quy tắc 20-20-20 — cùng với vui chơi ngoài trời cho trẻ — giúp thư giãn cơ mắt mỏi mệt."
   },
   {
    "en": "Simple habits like blinking more, keeping distance from the screen, and turning screens off before sleep protect your eyes.",
    "vi": "Những thói quen đơn giản như chớp mắt nhiều hơn, giữ khoảng cách với màn hình và tắt màn hình trước khi ngủ giúp bảo vệ mắt."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "What is the 20-20-20 rule?",
    "opts": [
     "20 minutes of exercise daily",
     "Every 20 minutes, look at something 20 feet away for 20 seconds",
     "Sleep 20 hours a week",
     "Drink 20 glasses of water"
    ],
    "answer": 1,
    "explain": "Quy tắc 20-20-20: sau mỗi 20 phút nhìn màn hình, hãy nhìn vật cách 20 feet (6m) trong 20 giây."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word 'focus' in the article is closest in meaning to...",
    "opts": [
     "adjust the eye to see clearly",
     "close the eyes",
     "look away",
     "cry"
    ],
    "answer": 0,
    "explain": "Theo VOA, 'focus' là điều chỉnh điểm tập trung của mắt — gần nhất với 'adjust the eye to see clearly'."
   },
   {
    "type": "SUY LUẬN",
    "q": "Why might eye drops be useful for screen users?",
    "opts": [
     "They cure myopia",
     "People blink much less when looking at screens, so eyes get dry",
     "They block blue light",
     "They make screens brighter"
    ],
    "answer": 1,
    "explain": "Bài đọc cho biết khi nhìn màn hình người ta chớp mắt ít hơn nhiều (3-7 lần/phút so với 18-22), khiến mắt khô — đó là lúc nên dùng thuốc nhỏ mắt."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Screens always damage eyes permanently",
     "Blue light glasses are the best solution",
     "Too much screen time harms vision, but simple habits can prevent the problems",
     "Children should never use computers"
    ],
    "answer": 2,
    "explain": "Ý chính: dùng màn hình quá nhiều hại thị lực, nhưng những thói quen đơn giản có thể phòng tránh."
   }
  ],
  "suggestions": [
   "Quy tắc 20-20-20 là gì?",
   "Vì sao nhìn màn hình lâu bị mỏi mắt?",
   "Tóm tắt bài này",
   "Kính chống ánh sáng xanh có hiệu quả không?"
  ]
 },
 {
  "id": "voa-saying-no",
  "title": "Saying ‘No’ at Work Can Be Good for Your Health",
  "titleVi": "Dám nói 'không' ở chỗ làm tốt cho sức khỏe của bạn.",
  "subtitle": "Level 2 · Intermediate",
  "category": "SỨC KHỎE · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "💼",
  "source_url": "https://learningenglish.voanews.com/a/saying-no-at-work-can-be-good-for-your-health/7945653.html",
  "paragraphs": [
   {
    "en": "People might find it hard to set work limits or say “no” before taking on too many responsibilities. But experts say it is important for workers to learn to set such limits, or boundaries.",
    "vi": "Mọi người có thể thấy khó đặt ra giới hạn trong công việc hay nói “không” trước khi ôm đồm quá nhiều trách nhiệm. Nhưng các chuyên gia cho biết người lao động cần học cách đặt ra những giới hạn như vậy."
   },
   {
    "en": "These limits can be important in helping workers protect their physical and mental health. And as with any new skill, setting boundaries gets easier with practice.",
    "vi": "Những giới hạn này rất quan trọng giúp người lao động bảo vệ sức khỏe thể chất và tinh thần. Và như mọi kỹ năng mới, đặt giới hạn sẽ dễ dần lên khi luyện tập."
   },
   {
    "en": "Justin Stewart is a 36-year-old who works as a news show production assistant. In the past, he had problems setting clear limits in his work life. His life was so busy that he would sometimes sleep in his car between jobs. After a time, he had to be hospitalized for extreme tiredness and an infection.",
    "vi": "Justin Stewart, 36 tuổi, làm trợ lý sản xuất cho một chương trình tin tức. Trước đây, anh gặp khó khăn trong việc đặt giới hạn rõ ràng cho công việc. Cuộc sống bận rộn đến mức đôi khi anh phải ngủ trong xe giữa các ca làm. Sau một thời gian, anh phải nhập viện vì kiệt sức và nhiễm trùng."
   },
   {
    "en": "As a result, Stewart began trying to set boundaries. He gave up his side jobs after deciding he could live without the extra money. If people from the news show contacted him to work after-hours, he told them he was not available.",
    "vi": "Nhờ đó, Stewart bắt đầu tập đặt giới hạn. Anh bỏ các công việc làm thêm sau khi nhận ra mình có thể sống mà không cần khoản tiền đó. Nếu người của chương trình tin tức liên hệ nhờ làm ngoài giờ, anh nói rằng mình không rảnh."
   },
   {
    "en": "However, experts say making such changes can be difficult. Many people already have a hard time turning down work requests from both co-workers and managers.",
    "vi": "Tuy nhiên, các chuyên gia cho biết thay đổi như vậy không dễ. Nhiều người vốn đã khó từ chối yêu cầu công việc từ đồng nghiệp lẫn cấp trên."
   },
   {
    "en": "If your goal is to do less, adding things to your daily plans may seem like a bad idea. But planning your day can actually provide more control over your time.",
    "vi": "Nếu mục tiêu của bạn là làm ít đi, việc thêm thứ vào kế hoạch hằng ngày nghe có vẻ ngược đời. Nhưng lên kế hoạch cho ngày của mình thực ra giúp bạn kiểm soát thời gian tốt hơn."
   },
   {
    "en": "If workers have a hard time saying no, they can write down what to say beforehand. Workers do not always have to explain themselves when turning down a request. They can simply say they are not available and thank the person for asking.",
    "vi": "Nếu khó nói không, người lao động có thể viết sẵn những gì mình sẽ nói. Khi từ chối một yêu cầu, không phải lúc nào cũng cần giải thích. Họ chỉ cần nói mình không rảnh và cảm ơn người đã hỏi."
   },
   {
    "en": "When asked for help, workers may want to agree immediately. However, it can be better to take time before answering. Use the time to consider workload, energy level, and interest.",
    "vi": "Khi được nhờ giúp đỡ, người lao động có thể muốn đồng ý ngay. Tuy nhiên, dành thời gian suy nghĩ trước khi trả lời có thể tốt hơn. Hãy dùng thời gian đó để cân nhắc khối lượng công việc, mức năng lượng và sự hứng thú của mình."
   },
   {
    "en": "Experts say that just because mobile devices can keep people connected to work all the time, they do not have to interfere with a person’s non-working life. For example, moving email apps off your phone’s homepage can help you avoid checking email on weekends.",
    "vi": "Các chuyên gia cho biết dù thiết bị di động có thể khiến người ta luôn kết nối với công việc, chúng không nhất thiết phải xen vào đời sống ngoài giờ làm. Ví dụ, chuyển ứng dụng email khỏi màn hình chính của điện thoại giúp bạn tránh kiểm tra email vào cuối tuần."
   },
   {
    "en": "Cathy Bussewitz reported this story for The Associated Press from New York City. Anna Matteo adapted it for VOA Learning English.",
    "vi": "Cathy Bussewitz đưa tin bài này cho hãng Associated Press từ New York. Anna Matteo chuyển soạn cho VOA Learning English."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Sức khỏe (Health)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 2 · Intermediate"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "Setting limits at work protects workers' physical and mental health.",
    "vi": "Đặt giới hạn trong công việc giúp bảo vệ sức khỏe thể chất và tinh thần của người lao động."
   },
   {
    "en": "Justin Stewart's story shows how overwork can lead to hospitalization — and how saying no helped him recover.",
    "vi": "Câu chuyện của Justin Stewart cho thấy làm việc quá sức có thể dẫn đến nhập viện — và việc dám nói không đã giúp anh hồi phục."
   },
   {
    "en": "Practical tips include planning your day, preparing what to say, pausing before answering, and keeping work apps away during free time.",
    "vi": "Các mẹo thực tế gồm lên kế hoạch ngày làm việc, chuẩn bị sẵn lời từ chối, suy nghĩ trước khi trả lời và để ứng dụng công việc xa tầm tay lúc rảnh."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "Why was Justin Stewart hospitalized?",
    "opts": [
     "A car accident",
     "Extreme tiredness and an infection",
     "A broken leg",
     "Food poisoning"
    ],
    "answer": 1,
    "explain": "Bài đọc cho biết anh phải nhập viện vì kiệt sức và nhiễm trùng sau thời gian làm việc quá tải."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word 'stressed' in the article is closest in meaning to...",
    "opts": [
     "relaxed",
     "under mental tension",
     "happy",
     "bored"
    ],
    "answer": 1,
    "explain": "Theo VOA, 'stressed' là chịu tác động gây căng thẳng thể chất/tinh thần — gần nhất với 'under mental tension'."
   },
   {
    "type": "SUY LUẬN",
    "q": "What can be inferred about planning your day?",
    "opts": [
     "It wastes time",
     "It gives you more control over your time",
     "It means doing more work",
     "Only managers should plan"
    ],
    "answer": 1,
    "explain": "Bài đọc nói dù nghe ngược đời, lên kế hoạch hằng ngày thực ra giúp bạn kiểm soát thời gian tốt hơn."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Workers should never say no",
     "Saying no at work is rude",
     "Learning to set limits at work is good for your health",
     "Side jobs are always bad"
    ],
    "answer": 2,
    "explain": "Ý chính: học cách đặt giới hạn, dám nói không trong công việc tốt cho sức khỏe."
   }
  ],
  "suggestions": [
   "Vì sao khó nói 'không' ở chỗ làm?",
   "Đặt giới hạn công việc thế nào?",
   "Tóm tắt bài này",
   "Câu chuyện của Justin Stewart ra sao?"
  ]
 },
 {
  "id": "voa-wright-brothers",
  "title": "Wilbur and Orville Wright: The First Airplane",
  "titleVi": "Anh em nhà Wright và chuyến bay đầu tiên của nhân loại.",
  "subtitle": "1867–1948",
  "category": "KHOA HỌC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "✈️",
  "source_url": "https://learningenglish.voanews.com/a/wilbur-and-orville-wright-the-first-airplane/7998765.html",
  "paragraphs": [
   {
    "en": "Wilbur and Orville Wright are the American inventors who made a small engine-powered flying machine. They proved that flight without the aid of gas-filled balloons was possible.",
    "vi": "Wilbur và Orville Wright là hai nhà phát minh người Mỹ đã chế tạo một cỗ máy bay nhỏ chạy bằng động cơ. Họ đã chứng minh rằng con người có thể bay mà không cần đến khinh khí cầu bơm khí."
   },
   {
    "en": "Wilbur Wright was born in 1867 near Melville, Indiana. His brother Orville was born four years later in Dayton, Ohio.",
    "vi": "Wilbur Wright sinh năm 1867 gần Melville, bang Indiana. Em trai ông, Orville, sinh bốn năm sau đó tại Dayton, bang Ohio."
   },
   {
    "en": "As they grew up, the Wright brothers experimented with mechanical things. Later, they began to design their own flying machine, using ideas from earlier experiments with a toy helicopter, kites, and bicycles.",
    "vi": "Khi lớn lên, anh em nhà Wright thử nghiệm với các món đồ cơ khí. Sau này, họ bắt đầu thiết kế cỗ máy bay của riêng mình, vận dụng ý tưởng từ những thí nghiệm trước đó với trực thăng đồ chơi, diều và xe đạp."
   },
   {
    "en": "The best place to test their ideas seemed to be a piece of sandy land in North Carolina along the coast of the Atlantic Ocean. It was called Kill Devil Hill, near the town of Kitty Hawk.",
    "vi": "Nơi lý tưởng nhất để thử nghiệm ý tưởng của họ dường như là một dải đất cát ở North Carolina, dọc bờ Đại Tây Dương. Nơi đó có tên là Kill Devil Hill, gần thị trấn Kitty Hawk."
   },
   {
    "en": "The Wright brothers did many tests with gliders at Kitty Hawk and learned how to solve many problems.",
    "vi": "Anh em nhà Wright đã thực hiện nhiều cuộc thử nghiệm với tàu lượn tại Kitty Hawk và học được cách giải quyết nhiều vấn đề."
   },
   {
    "en": "By the autumn of 1903, Wilbur and Orville had designed and built an airplane powered by a gasoline engine. The plane had wings 12 meters across and weighed about 340 kilograms, including the pilot.",
    "vi": "Đến mùa thu năm 1903, Wilbur và Orville đã thiết kế và chế tạo xong một chiếc máy bay chạy bằng động cơ xăng. Chiếc máy bay có sải cánh rộng 12 mét và nặng khoảng 340 kilôgam, tính cả người lái."
   },
   {
    "en": "On December 17th, 1903, they made the world's first flight in a machine that was heavier than air and powered by an engine. Orville flew the plane 36 meters in 12 seconds. The two brothers made three more flights that day.",
    "vi": "Ngày 17 tháng 12 năm 1903, họ đã thực hiện chuyến bay đầu tiên trên thế giới bằng một cỗ máy nặng hơn không khí và chạy bằng động cơ. Orville đã lái máy bay bay được 36 mét trong 12 giây. Hai anh em còn thực hiện thêm ba chuyến bay nữa trong ngày hôm đó."
   },
   {
    "en": "It was almost five years before the Wright brothers became famous. In 1908, Wilbur went to France and gave demonstration flights. A French company agreed to begin making their flying machine. The United States War Department agreed to buy one of their planes.",
    "vi": "Phải gần năm năm sau anh em nhà Wright mới trở nên nổi tiếng. Năm 1908, Wilbur sang Pháp và thực hiện các chuyến bay trình diễn. Một công ty Pháp đã đồng ý bắt đầu sản xuất cỗ máy bay của họ. Bộ Chiến tranh Hoa Kỳ cũng đồng ý mua một chiếc máy bay của họ."
   },
   {
    "en": "Wilbur Wright died of typhoid fever in 1912. Orville Wright continued designing and inventing until he died in 1948.",
    "vi": "Wilbur Wright qua đời vì bệnh thương hàn năm 1912. Orville Wright tiếp tục thiết kế và phát minh cho đến khi ông qua đời năm 1948."
   },
   {
    "en": "Today, the Wright brothers' first airplane is in the Air and Space Museum in Washington, D.C. The world has changed a lot since Wilbur and Orville Wright began the modern age of flight over one hundred years ago.",
    "vi": "Ngày nay, chiếc máy bay đầu tiên của anh em nhà Wright được trưng bày tại Bảo tàng Hàng không và Vũ trụ ở Washington, D.C. Thế giới đã thay đổi rất nhiều kể từ khi Wilbur và Orville Wright mở ra kỷ nguyên bay hiện đại cách đây hơn một trăm năm."
   },
   {
    "en": "Marilyn Rice Christiano wrote this story for VOA Learning English. John Russell adapted it.",
    "vi": "Marilyn Rice Christiano đã viết bài này cho VOA Learning English. John Russell biên soạn lại."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Khoa học (Science)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 2 · Intermediate"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "The Wright brothers proved that engine-powered flight in a machine heavier than air was possible.",
    "vi": "Anh em nhà Wright đã chứng minh rằng chuyến bay bằng động cơ trên cỗ máy nặng hơn không khí là điều có thể."
   },
   {
    "en": "Years of experiments with gliders at Kitty Hawk helped them solve the problems of controlled flight.",
    "vi": "Nhiều năm thử nghiệm tàu lượn tại Kitty Hawk đã giúp họ giải quyết các vấn đề về điều khiển chuyến bay."
   },
   {
    "en": "Their first successful flight on December 17, 1903 began the modern age of aviation.",
    "vi": "Chuyến bay thành công đầu tiên vào ngày 17 tháng 12 năm 1903 đã mở ra kỷ nguyên hàng không hiện đại."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "On December 17, 1903, how far did Orville fly the plane?",
    "opts": [
     "12 meters",
     "36 meters",
     "340 meters",
     "12 kilometers"
    ],
    "answer": 1,
    "explain": "Bài đọc cho biết Orville đã bay được 36 mét trong 12 giây."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word “glider” in the article is closest in meaning to…",
    "opts": [
     "a flying object without an engine",
     "a gasoline-powered airplane",
     "a gas-filled balloon",
     "a toy helicopter"
    ],
    "answer": 0,
    "explain": "VOA định nghĩa glider là vật thể bay giống máy bay nhưng không có động cơ."
   },
   {
    "type": "SUY LUẬN",
    "q": "Why was Kitty Hawk a good place for the Wright brothers’ tests?",
    "opts": [
     "It was near their home in Ohio",
     "The French government invited them there",
     "It had sandy land along the ocean coast",
     "Balloons had already been tested there"
    ],
    "answer": 2,
    "explain": "Bài đọc nói đó là dải đất cát dọc bờ Đại Tây Dương — đất cát giúp hạ cánh êm, vùng ven biển có gió thuận lợi cho thử nghiệm."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Balloons were the first flying machines",
     "The Wright brothers built the first engine-powered airplane",
     "France bought the first American airplane",
     "Gliders are better than airplanes"
    ],
    "answer": 1,
    "explain": "Ý chính của bài là anh em nhà Wright đã chế tạo chiếc máy bay chạy bằng động cơ đầu tiên trên thế giới."
   }
  ],
  "suggestions": [
   "Anh em nhà Wright là ai?",
   "Chuyến bay đầu tiên diễn ra khi nào?",
   "Tóm tắt bài này",
   "Vì sao họ chọn Kitty Hawk để thử nghiệm?"
  ]
 },
 {
  "id": "voa-asteroid",
  "title": "Methods for Protecting Earth against an Asteroid Strike",
  "titleVi": "Các nhà khoa học tìm cách bảo vệ Trái Đất khỏi tiểu hành tinh.",
  "subtitle": "Level 3 · Advanced",
  "category": "KHOA HỌC · VOA LEARNING ENGLISH",
  "level": "Level 3 · Advanced",
  "emoji": "☄️",
  "source_url": "https://learningenglish.voanews.com/a/methods-for-protecting-earth-against-an-asteroid-strike/7989189.html",
  "paragraphs": [
   {
    "en": "Astronomers following asteroid activity in space estimate there is a very small chance an object large enough to destroy a whole city could strike Earth in 2032.",
    "vi": "Các nhà thiên văn học theo dõi hoạt động của tiểu hành tinh trong không gian ước tính có một khả năng rất nhỏ rằng một vật thể đủ lớn để phá hủy cả một thành phố có thể đâm vào Trái Đất vào năm 2032."
   },
   {
    "en": "But space agency officials say even if such an asteroid keeps heading on a path toward Earth, the world is now much better-equipped to defend itself against such a threat.",
    "vi": "Nhưng các quan chức cơ quan vũ trụ cho biết ngay cả khi một tiểu hành tinh như vậy vẫn đang hướng về Trái Đất, thế giới hiện nay đã được trang bị tốt hơn nhiều để tự vệ trước mối đe dọa đó."
   },
   {
    "en": "The American space agency NASA recently estimated there was a 3.1 percent chance that asteroid 2024 YR4 would hit Earth on December 22, 2032.",
    "vi": "Cơ quan vũ trụ Mỹ NASA gần đây ước tính có 3,1% khả năng tiểu hành tinh 2024 YR4 sẽ đâm vào Trái Đất vào ngày 22 tháng 12 năm 2032."
   },
   {
    "en": "Astronomers have noted that the more data they gather, the odds of a direct asteroid hit are expected to keep falling over time as predictions improve.",
    "vi": "Các nhà thiên văn học lưu ý rằng càng thu thập được nhiều dữ liệu, khả năng tiểu hành tinh đâm trực tiếp vào Trái Đất dự kiến sẽ càng giảm dần theo thời gian khi các dự đoán trở nên chính xác hơn."
   },
   {
    "en": "Only one planetary defense method has been tried against an asteroid. In 2022, NASA's Double Asteroid Redirection Test (DART) sent a spacecraft into the 160-meter-wide Dimorphos asteroid. The effort successfully changed the asteroid’s orbit.",
    "vi": "Mới chỉ có một phương pháp phòng thủ hành tinh được thử nghiệm với tiểu hành tinh. Năm 2022, Thử nghiệm Chuyển hướng Tiểu hành tinh Đôi (DART) của NASA đã đưa một tàu vũ trụ đâm vào tiểu hành tinh Dimorphos rộng 160 mét. Nỗ lực này đã thay đổi thành công quỹ đạo của tiểu hành tinh."
   },
   {
    "en": "A separate idea would involve sending a large spacecraft to fly alongside a threatening asteroid. The spacecraft would use its gravitational force to pull it away from Earth.",
    "vi": "Một ý tưởng khác là đưa một tàu vũ trụ lớn bay song song với tiểu hành tinh đang đe dọa. Tàu vũ trụ sẽ dùng lực hấp dẫn của mình để kéo tiểu hành tinh ra xa Trái Đất."
   },
   {
    "en": "Scientists have also considered painting one side of the asteroid white to increase reflected light and slowly change its course.",
    "vi": "Các nhà khoa học cũng đã cân nhắc việc sơn trắng một mặt của tiểu hành tinh để tăng lượng ánh sáng phản xạ và từ từ thay đổi quỹ đạo của nó."
   },
   {
    "en": "One idea is to use a nuclear weapon against a threatening asteroid, though this carries the risk of breaking it into smaller pieces falling toward Earth.",
    "vi": "Một ý tưởng là dùng vũ khí hạt nhân chống lại tiểu hành tinh đang đe dọa, dù cách này có nguy cơ làm vỡ nó thành nhiều mảnh nhỏ rơi về phía Trái Đất."
   },
   {
    "en": "If all else fails, the world will have a good idea where a threatening asteroid would strike, and efforts could be organized to get people out of an area before a strike.",
    "vi": "Nếu mọi cách đều thất bại, thế giới sẽ biết khá rõ tiểu hành tinh sẽ đâm vào đâu, và có thể tổ chức sơ tán người dân khỏi khu vực đó trước khi vụ va chạm xảy ra."
   },
   {
    "en": "Daniel Lawler with Issam Ahmed reported this story for Agence France-Presse. Jill Robbins adapted it for Learning English.",
    "vi": "Daniel Lawler và Issam Ahmed đã đưa tin bài này cho Agence France-Presse. Jill Robbins biên soạn lại cho Learning English."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Khoa học (Science)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 3 · Advanced"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "Astronomers estimate a very small chance that a city-destroying asteroid could hit Earth in 2032.",
    "vi": "Các nhà thiên văn học ước tính có khả năng rất nhỏ một tiểu hành tinh đủ sức phá hủy một thành phố sẽ đâm vào Trái Đất năm 2032."
   },
   {
    "en": "Scientists have several ideas to defend Earth, and NASA’s DART mission already proved one method works.",
    "vi": "Các nhà khoa học có nhiều ý tưởng để bảo vệ Trái Đất, và sứ mệnh DART của NASA đã chứng minh một phương pháp thực sự hiệu quả."
   },
   {
    "en": "If defense fails, predicting where the asteroid will strike allows people to evacuate in time.",
    "vi": "Nếu phòng thủ thất bại, việc dự đoán nơi tiểu hành tinh đâm xuống giúp con người kịp sơ tán."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "What did NASA’s DART mission do in 2022?",
    "opts": [
     "Painted an asteroid white",
     "Sent a spacecraft into the Dimorphos asteroid",
     "Used a nuclear weapon in space",
     "Evacuated people from a city"
    ],
    "answer": 1,
    "explain": "Bài đọc cho biết DART đã đưa tàu vũ trụ đâm vào tiểu hành tinh Dimorphos rộng 160 mét và thay đổi thành công quỹ đạo của nó."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word “asteroid” in the article is closest in meaning to…",
    "opts": [
     "a small rocky body in space",
     "a spacecraft sent by NASA",
     "a nuclear weapon",
     "a kind of telescope"
    ],
    "answer": 0,
    "explain": "VOA định nghĩa asteroid là thiên thể đá nhỏ, thường nằm giữa quỹ đạo sao Hỏa và sao Mộc."
   },
   {
    "type": "SUY LUẬN",
    "q": "Why is the chance of an asteroid hitting Earth expected to fall over time?",
    "opts": [
     "Asteroids are getting smaller",
     "Scientists gather more data and improve predictions",
     "NASA will destroy all asteroids",
     "Earth is moving away from asteroids"
    ],
    "answer": 1,
    "explain": "Bài đọc nói càng thu thập nhiều dữ liệu thì các dự đoán càng chính xác và khả năng va chạm dự kiến càng giảm."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "An asteroid will certainly hit Earth in 2032",
     "Scientists are preparing ways to protect Earth from asteroids",
     "Nuclear weapons are the best defense method",
     "People should leave cities immediately"
    ],
    "answer": 1,
    "explain": "Ý chính của bài là các nhà khoa học đang chuẩn bị nhiều phương pháp để bảo vệ Trái Đất khỏi tiểu hành tinh."
   }
  ],
  "suggestions": [
   "Tiểu hành tinh 2024 YR4 là gì?",
   "Sứ mệnh DART đã làm gì?",
   "Tóm tắt bài này",
   "Có những cách nào để làm chệch hướng tiểu hành tinh?"
  ]
 },
 {
  "id": "voa-ice-ages",
  "title": "Study Shows How Earth’s Orbit Affects Ice Ages",
  "titleVi": "Quỹ đạo Trái Đất ảnh hưởng đến các kỷ băng hà như thế nào.",
  "subtitle": "Level 3 · Advanced",
  "category": "KHOA HỌC · VOA LEARNING ENGLISH",
  "level": "Level 3 · Advanced",
  "emoji": "🧊",
  "source_url": "https://learningenglish.voanews.com/a/study-shows-how-earth-s-orbit-affects-ice-ages/7997495.html",
  "paragraphs": [
   {
    "en": "A recent study suggests the next ice age will likely begin in about 11,000 years unless emissions change the effects of natural climate cycles.",
    "vi": "Một nghiên cứu gần đây cho thấy kỷ băng hà tiếp theo có thể sẽ bắt đầu sau khoảng 11.000 năm nữa, trừ khi khí thải làm thay đổi tác động của các chu kỳ khí hậu tự nhiên."
   },
   {
    "en": "An ice age is a period of reduced temperatures causing ice to cover large areas of the northern and southern parts of the world.",
    "vi": "Kỷ băng hà là giai đoạn nhiệt độ giảm khiến băng bao phủ diện rộng ở phía bắc và phía nam của thế giới."
   },
   {
    "en": "A group of scientists studied changes in the shape of the Earth’s orbit around the sun, the tilt of the Earth’s axis and the movement of the axis itself, called a wobble. The Serbian scientist Milutin Milankovitch developed a theory about 100 years ago that these cycles affected Earth’s long-term climate.",
    "vi": "Một nhóm nhà khoa học đã nghiên cứu sự thay đổi hình dạng quỹ đạo Trái Đất quanh mặt trời, độ nghiêng của trục Trái Đất và chuyển động của chính trục đó, gọi là sự chao đảo. Nhà khoa học người Serbia Milutin Milankovitch đã phát triển một lý thuyết cách đây khoảng 100 năm rằng các chu kỳ này ảnh hưởng đến khí hậu dài hạn của Trái Đất."
   },
   {
    "en": "These findings permitted the team to determine how the three factors of tilt, wobble, and the shape of Earth's orbit might have affected the Earth’s climate over the last 900,000 years.",
    "vi": "Những phát hiện này giúp nhóm nghiên cứu xác định ba yếu tố — độ nghiêng, sự chao đảo và hình dạng quỹ đạo Trái Đất — có thể đã ảnh hưởng đến khí hậu Trái Đất trong 900.000 năm qua như thế nào."
   },
   {
    "en": "The group published its findings in Science on February 27.",
    "vi": "Nhóm đã công bố phát hiện của mình trên tạp chí Science vào ngày 27 tháng 2."
   },
   {
    "en": "The scientists examined a million-year record of climate by looking at ice sheets across the northern half of the world and deep ocean temperatures.",
    "vi": "Các nhà khoa học đã xem xét hồ sơ khí hậu kéo dài một triệu năm bằng cách nghiên cứu các tảng băng ở nửa phía bắc của thế giới và nhiệt độ đại dương sâu."
   },
   {
    "en": "The lead writer of the study is Stephen Barker, a professor at Cardiff University in Britain.",
    "vi": "Tác giả chính của nghiên cứu là Stephen Barker, giáo sư tại Đại học Cardiff ở Anh."
   },
   {
    "en": "Earth is believed to go through cycles of ice ages and warm periods. The last ice age is thought to have ended around 11,700 years ago.",
    "vi": "Người ta cho rằng Trái Đất trải qua các chu kỳ kỷ băng hà và giai đoạn ấm xen kẽ. Kỷ băng hà gần nhất được cho là đã kết thúc khoảng 11.700 năm trước."
   },
   {
    "en": "Barker told AFP, “We would expect a glaciation to occur within the next 11,000 years, and it would end in 66,000 years' time.”",
    "vi": "Barker nói với AFP: “Chúng tôi dự đoán một đợt băng hà sẽ xảy ra trong 11.000 năm tới, và nó sẽ kết thúc sau 66.000 năm.”"
   },
   {
    "en": "The team aims to expand its findings to investigate the long-term effects of human activity on climate.",
    "vi": "Nhóm đặt mục tiêu mở rộng phát hiện để nghiên cứu tác động dài hạn của hoạt động con người đối với khí hậu."
   },
   {
    "en": "Issam Ahmed wrote this story for Agence-France Presse. Andrew Smith adapted it for VOA Learning English.",
    "vi": "Issam Ahmed đã viết bài này cho Agence-France Presse. Andrew Smith biên soạn lại cho VOA Learning English."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Khoa học (Science)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 3 · Advanced"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "Changes in Earth’s orbit, axis tilt, and wobble drive long-term climate cycles including ice ages.",
    "vi": "Sự thay đổi quỹ đạo Trái Đất, độ nghiêng trục và sự chao đảo chi phối các chu kỳ khí hậu dài hạn, bao gồm cả kỷ băng hà."
   },
   {
    "en": "The study predicts the next ice age in about 11,000 years, unless human emissions alter the natural cycle.",
    "vi": "Nghiên cứu dự đoán kỷ băng hà tiếp theo sẽ đến sau khoảng 11.000 năm nữa, trừ khi khí thải của con người làm thay đổi chu kỳ tự nhiên."
   },
   {
    "en": "The findings confirm Milankovitch’s 100-year-old theory about what causes ice ages.",
    "vi": "Các phát hiện đã xác nhận lý thuyết 100 năm tuổi của Milankovitch về nguyên nhân gây ra kỷ băng hà."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "When is the next ice age expected to begin?",
    "opts": [
     "In 66,000 years",
     "In about 11,000 years",
     "In 900,000 years",
     "In 100 years"
    ],
    "answer": 1,
    "explain": "Bài đọc cho biết kỷ băng hà tiếp theo có thể bắt đầu sau khoảng 11.000 năm nữa."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word “tilt” in the article is closest in meaning to…",
    "opts": [
     "a slant to one side",
     "a straight vertical line",
     "a round shape",
     "a fast spin"
    ],
    "answer": 0,
    "explain": "VOA định nghĩa tilt là trạng thái nghiêng sang một bên thay vì thẳng đứng."
   },
   {
    "type": "SUY LUẬN",
    "q": "What can be inferred about human emissions from the study?",
    "opts": [
     "They have no effect on climate",
     "They could delay or change the next ice age",
     "They ended the last ice age",
     "They stopped Earth’s wobble"
    ],
    "answer": 1,
    "explain": "Bài đọc nói kỷ băng hà tiếp theo sẽ đến sau 11.000 năm “trừ khi khí thải làm thay đổi tác động của các chu kỳ tự nhiên” — tức khí thải của con người có thể làm thay đổi chu kỳ."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Humans caused the last ice age",
     "Earth’s orbit cycles control ice ages, and the next one may come in 11,000 years",
     "Ice ages will never happen again",
     "The study was published 100 years ago"
    ],
    "answer": 1,
    "explain": "Ý chính của bài là các chu kỳ quỹ đạo Trái Đất chi phối kỷ băng hà, và kỷ băng hà tiếp theo có thể đến sau khoảng 11.000 năm."
   }
  ],
  "suggestions": [
   "Kỷ băng hà là gì?",
   "Lý thuyết của Milankovitch nói về điều gì?",
   "Tóm tắt bài này",
   "Khí thải của con người ảnh hưởng thế nào đến kỷ băng hà?"
  ]
 },
 {
  "id": "voa-root-words",
  "title": "Grow Your Vocabulary by Learning Root Words",
  "titleVi": "Mở rộng vốn từ vựng bằng cách học từ gốc.",
  "subtitle": "Level 2 · Intermediate",
  "category": "GIÁO DỤC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🌱",
  "source_url": "https://learningenglish.voanews.com/a/grow-your-vocabulary-by-learning-root-words/4113426.html",
  "paragraphs": [
   {
    "en": "English has been called one the most difficult languages for non-native speakers to learn. One reason is that English has so many rules – and almost as many exceptions of those rules!",
    "vi": "Người ta từng gọi tiếng Anh là một trong những ngôn ngữ khó nhất đối với người học ngoại ngữ. Một lý do là tiếng Anh có quá nhiều quy tắc – và gần như cũng có bấy nhiêu ngoại lệ!"
   },
   {
    "en": "Sometimes, this leaves learners confused. For example, the order of words in a sentence can be tricky.",
    "vi": "Đôi khi, điều này khiến người học bối rối. Ví dụ, trật tự từ trong câu có thể rất khó nắm bắt."
   },
   {
    "en": "Another reason English is hard to learn is that the pronunciation of its words cannot always be predicted by their spelling. And, maybe the worst thing of all is that there are many idioms, or expressions, in English.",
    "vi": "Một lý do khác khiến tiếng Anh khó học là cách phát âm của từ không phải lúc nào cũng đoán được qua cách viết. Và có lẽ điều tệ nhất là tiếng Anh có rất nhiều thành ngữ."
   },
   {
    "en": "So, it is comforting to know that learning root words can help a non-native speaker use English. A root word is the most basic form of a word.",
    "vi": "Vì vậy, thật yên tâm khi biết rằng học từ gốc có thể giúp người học ngoại ngữ sử dụng tiếng Anh tốt hơn. Từ gốc là dạng cơ bản nhất của một từ."
   },
   {
    "en": "Root words can help you to break down large, new words into smaller units to discover their meanings.",
    "vi": "Từ gốc giúp bạn tách những từ mới, dài thành các đơn vị nhỏ hơn để khám phá nghĩa của chúng."
   },
   {
    "en": "Learning just one root word can help you understand several words in English. So, by learning just 20 or 30 root words, you can expand your English vocabulary to include hundreds of new words.",
    "vi": "Chỉ cần học một từ gốc là bạn đã có thể hiểu được nhiều từ tiếng Anh. Vì vậy, chỉ với 20 hoặc 30 từ gốc, bạn có thể mở rộng vốn từ vựng của mình lên đến hàng trăm từ mới."
   },
   {
    "en": "A root can be any part of a word that carries meaning: the beginning, middle or end. Prefixes, bases, and suffixes are types of roots. The prefix appears at the beginning of a word, the base in the middle and the suffix at the end.",
    "vi": "Từ gốc có thể là bất kỳ phần nào của từ mang nghĩa: đầu, giữa hoặc cuối. Tiền tố, gốc từ và hậu tố là các loại từ gốc. Tiền tố xuất hiện ở đầu từ, gốc từ ở giữa và hậu tố ở cuối."
   },
   {
    "en": "Most English root words came from the Greek and Latin languages.",
    "vi": "Hầu hết từ gốc trong tiếng Anh đến từ tiếng Hy Lạp và tiếng Latin."
   },
   {
    "en": "One useful method for building vocabulary through root words is to first look at a base word and then look for familiar prefixes and suffixes that go with that base.",
    "vi": "Một phương pháp hữu ích để xây dựng vốn từ qua từ gốc là trước tiên nhìn vào gốc từ, sau đó tìm các tiền tố và hậu tố quen thuộc đi kèm với gốc từ đó."
   },
   {
    "en": "Let's try an example: the base word “struct-.” It comes from the Latin word meaning “build.” Any English word you hear containing “struct-” will relate to building, developing or creating something.",
    "vi": "Hãy thử một ví dụ: gốc từ “struct-”. Nó đến từ từ tiếng Latin có nghĩa là “xây dựng”. Bất kỳ từ tiếng Anh nào chứa “struct-” đều liên quan đến việc xây dựng, phát triển hoặc tạo ra thứ gì đó."
   },
   {
    "en": "For example, the word “construct” is a verb that means “to build.” The prefix “con” means “together” or “with.” So, “construct” means to put things together to build or create something.",
    "vi": "Ví dụ, từ “construct” là động từ có nghĩa là “xây dựng”. Tiền tố “con” có nghĩa là “cùng nhau”. Vì vậy, “construct” nghĩa là đặt các thứ lại với nhau để xây dựng hoặc tạo ra thứ gì đó."
   },
   {
    "en": "Adding suffixes to “struct-” creates additional words. For example, adding “-ion” in English makes verbs into nouns. When we add “-ion” to “construct,” we get “construction,” which means the process, or act, of building something.",
    "vi": "Thêm hậu tố vào “struct-” sẽ tạo ra thêm nhiều từ. Ví dụ, thêm “-ion” trong tiếng Anh biến động từ thành danh từ. Khi thêm “-ion” vào “construct”, ta được “construction”, nghĩa là quá trình hay hành động xây dựng thứ gì đó."
   },
   {
    "en": "There are many other words that the base word “struct” produces. For instance, “destruction” is the opposite of “construction.” “Destruction” is the act of taking apart or damaging something that was built.",
    "vi": "Gốc từ “struct” còn tạo ra nhiều từ khác nữa. Chẳng hạn, “destruction” là từ trái nghĩa với “construction”. “Destruction” là hành động tháo dỡ hoặc phá hủy thứ đã được xây dựng."
   },
   {
    "en": "So, you see, by knowing just one root word – “struct-” – you can get a better idea of the meaning of at least 15 words in English.",
    "vi": "Như vậy, chỉ cần biết một từ gốc – “struct-” – bạn đã có thể đoán nghĩa của ít nhất 15 từ tiếng Anh."
   },
   {
    "en": "A few other common root words include “bio” meaning life, “auto” meaning self, “pro” meaning before or in favor of, and “tele” meaning distance.",
    "vi": "Một vài từ gốc phổ biến khác gồm “bio” nghĩa là sự sống, “auto” nghĩa là bản thân, “pro” nghĩa là trước hoặc ủng hộ, và “tele” nghĩa là khoảng cách."
   },
   {
    "en": "Learning common roots, prefixes and suffixes will help you become an expert in deconstructing the meanings of English words and constructing a strong vocabulary.",
    "vi": "Học các từ gốc, tiền tố và hậu tố phổ biến sẽ giúp bạn trở thành chuyên gia trong việc phân tích nghĩa của từ tiếng Anh và xây dựng một vốn từ vựng vững chắc."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Giáo dục (Education)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 2 · Intermediate"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "Learning root words helps non-native speakers understand many English words.",
    "vi": "Học từ gốc giúp người học ngoại ngữ hiểu được nhiều từ tiếng Anh."
   },
   {
    "en": "Knowing just 20 or 30 root words can expand your vocabulary to hundreds of words.",
    "vi": "Chỉ cần biết 20 hoặc 30 từ gốc là có thể mở rộng vốn từ lên hàng trăm từ."
   },
   {
    "en": "Prefixes, bases, and suffixes are types of roots that carry meaning.",
    "vi": "Tiền tố, gốc từ và hậu tố là các loại từ gốc mang nghĩa."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "According to the article, how many root words can expand your vocabulary to hundreds of words?",
    "opts": [
     "Only one",
     "Five or six",
     "20 or 30",
     "More than 100"
    ],
    "answer": 2,
    "explain": "Bài đọc nói chỉ cần học 20 hoặc 30 từ gốc là có thể mở rộng vốn từ lên hàng trăm từ mới."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word 'confuse' in the article is closest in meaning to...",
    "opts": [
     "make someone uncertain",
     "make someone happy",
     "teach someone",
     "help someone"
    ],
    "answer": 0,
    "explain": "VOA định nghĩa 'confuse' là làm cho ai đó không chắc chắn hoặc không hiểu điều gì đó."
   },
   {
    "type": "SUY LUẬN",
    "q": "What can be inferred about the word 'deconstruct' from the last paragraph?",
    "opts": [
     "It means to build something",
     "It means to take a word apart to find its meaning",
     "It is the opposite of vocabulary",
     "It comes from the Greek language"
    ],
    "answer": 1,
    "explain": "Đoạn cuối nói việc học từ gốc giúp bạn 'deconstructing the meanings of English words' — tức là tách từ ra để tìm nghĩa của chúng."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "English spelling is very difficult",
     "Learning root words helps you understand many English words",
     "Latin is more useful than Greek",
     "You should memorize hundreds of words"
    ],
    "answer": 1,
    "explain": "Ý chính của bài là học từ gốc giúp người học hiểu được nhiều từ tiếng Anh."
   }
  ],
  "suggestions": [
   "Từ gốc (root word) là gì?",
   "Cho ví dụ về từ gốc 'struct-'",
   "Tóm tắt bài này",
   "Ngoài 'struct-', còn từ gốc phổ biến nào?"
  ]
 },
 {
  "id": "voa-shadowing",
  "title": "Improve Your Pronunciation By 'Shadowing' Others",
  "titleVi": "Cải thiện phát âm bằng cách 'nói đuổi' theo người bản ngữ.",
  "subtitle": "Level 2 · Intermediate",
  "category": "GIÁO DỤC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🗣️",
  "source_url": "https://learningenglish.voanews.com/a/improve-your-english-pronunciation-shadowing-others/3339007.html",
  "paragraphs": [
   {
    "en": "Many English learners can improve their pronunciation by listening carefully to native English speakers and trying to match the up-and-down movement of their sentences.",
    "vi": "Nhiều người học tiếng Anh có thể cải thiện phát âm bằng cách lắng nghe kỹ người bản ngữ và cố gắng bắt chước sự lên xuống trong câu nói của họ."
   },
   {
    "en": "That is the opinion of Marla Yoshida, an English as a Foreign Language teacher at the University of California, Irvine.",
    "vi": "Đó là ý kiến của Marla Yoshida, giáo viên dạy tiếng Anh cho người nước ngoài tại Đại học California, Irvine."
   },
   {
    "en": "Yoshida wants English learners to look for details that are important to native speakers. These details are not only sounds, she notes. Native speakers also communicate by using pauses, and by saying some words more forcefully than others.",
    "vi": "Yoshida muốn người học tiếng Anh chú ý đến những chi tiết quan trọng đối với người bản ngữ. Bà lưu ý rằng những chi tiết này không chỉ là âm thanh. Người bản ngữ còn giao tiếp bằng cách ngắt nghỉ, và nhấn mạnh một số từ hơn những từ khác."
   },
   {
    "en": "As a result, native speakers might not understand an English learner even if the learner pronounces sounds correctly.",
    "vi": "Kết quả là, người bản ngữ có thể không hiểu người học tiếng Anh dù người học phát âm đúng các âm."
   },
   {
    "en": "Yoshida says that English learners often study pronunciation by listening and repeating something from a recording. But she says learners need to do more than listen and repeat in order to improve.",
    "vi": "Yoshida cho biết người học tiếng Anh thường luyện phát âm bằng cách nghe và nhắc lại theo băng ghi âm. Nhưng bà nói người học cần làm nhiều hơn là chỉ nghe và nhắc lại nếu muốn tiến bộ."
   },
   {
    "en": "The problem with listen and repeat, says Yoshida, is that when people repeat, they are often not trying to sound like the other person. The sounds that you hear go into your brain, and your brain filters them through the sound system of your own language.",
    "vi": "Vấn đề của phương pháp nghe và nhắc lại, theo Yoshida, là khi nhắc lại, người ta thường không cố gắng nói giống hệt người kia. Âm thanh bạn nghe được đi vào não, và não bạn lọc chúng qua hệ thống âm thanh của chính ngôn ngữ mẹ đẻ."
   },
   {
    "en": "What details should you try to copy when you listen to an English speaker? Among others, the important details include pauses or breaths, which words to emphasize, and intonation – the up and down movement of your voice as you speak.",
    "vi": "Bạn nên cố gắng bắt chước những chi tiết nào khi nghe người nói tiếng Anh? Trong số đó, các chi tiết quan trọng gồm chỗ ngắt nghỉ, từ nào cần nhấn mạnh, và ngữ điệu – sự lên xuống của giọng nói khi bạn nói."
   },
   {
    "en": "If English learners want to start improving their pronunciation, Yoshida suggests that they do an activity called shadowing.",
    "vi": "Nếu muốn bắt đầu cải thiện phát âm, Yoshida gợi ý người học tiếng Anh thực hiện một hoạt động gọi là shadowing (nói đuổi)."
   },
   {
    "en": "Shadowing means finding a short audio or video clip that you like, maybe 30 seconds to two minutes long, and listen to it. Listen a couple of times to get the meaning, and to hear where the speaker pauses, and what they emphasize, and what the intonation sounds like.",
    "vi": "Shadowing nghĩa là tìm một đoạn audio hoặc video ngắn mà bạn thích, khoảng 30 giây đến hai phút, và nghe nó. Nghe vài lần để nắm nghĩa, và để nghe chỗ người nói ngắt nghỉ, nhấn mạnh điều gì, và ngữ điệu ra sao."
   },
   {
    "en": "Then start imitating, trying to sound exactly like that person. Mark the intonation of the voice and listen for emphasized words.",
    "vi": "Sau đó bắt đầu bắt chước, cố gắng nói giống hệt người đó. Đánh dấu ngữ điệu của giọng nói và lắng nghe các từ được nhấn mạnh."
   },
   {
    "en": "English sentences often emphasize words at the end of a sentence – the place where you usually find new information.",
    "vi": "Câu tiếng Anh thường nhấn mạnh các từ ở cuối câu – nơi thường chứa thông tin mới."
   },
   {
    "en": "Remember, all our stories have audio, so you can print the story and do a shadowing exercise while listening to the story.",
    "vi": "Hãy nhớ rằng mọi bài báo của chúng tôi đều có audio, vì vậy bạn có thể in bài ra và luyện tập shadowing trong khi nghe."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Giáo dục (Education)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 2 · Intermediate"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "Good pronunciation needs more than correct sounds — pauses, emphasis, and intonation matter.",
    "vi": "Phát âm tốt cần nhiều hơn âm đúng — ngắt nghỉ, nhấn mạnh và ngữ điệu đều quan trọng."
   },
   {
    "en": "Shadowing means imitating a speaker to sound exactly like them.",
    "vi": "Shadowing là bắt chước người nói để nói giống hệt họ."
   },
   {
    "en": "English sentences often emphasize words at the end, where new information appears.",
    "vi": "Câu tiếng Anh thường nhấn mạnh từ ở cuối câu, nơi chứa thông tin mới."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "What is 'shadowing' according to the article?",
    "opts": [
     "Reading a book aloud",
     "Imitating a speaker to sound exactly like them",
     "Listening to music",
     "Writing down new words"
    ],
    "answer": 1,
    "explain": "Bài đọc giải thích shadowing là bắt chước người nói để nói giống hệt họ."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word 'intonation' in the article is closest in meaning to...",
    "opts": [
     "the rise and fall of your voice when speaking",
     "the speed of speaking",
     "a loud sound",
     "a written text"
    ],
    "answer": 0,
    "explain": "VOA định nghĩa 'intonation' là sự lên xuống của giọng nói khi bạn nói."
   },
   {
    "type": "SUY LUẬN",
    "q": "Why might native speakers not understand a learner who pronounces sounds correctly?",
    "opts": [
     "The learner speaks too fast",
     "The learner ignores pauses, emphasis and intonation",
     "The learner uses difficult words",
     "The learner is too shy to speak"
    ],
    "answer": 1,
    "explain": "Bài đọc nói người bản ngữ giao tiếp bằng ngắt nghỉ, nhấn mạnh và ngữ điệu — thiếu những yếu tố này thì dù phát âm đúng âm vẫn khó hiểu."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Listening to music improves English",
     "Shadowing helps learners improve pronunciation",
     "Grammar is more important than pronunciation",
     "Learners should avoid speaking English"
    ],
    "answer": 1,
    "explain": "Ý chính của bài là phương pháp shadowing giúp người học cải thiện phát âm."
   }
  ],
  "suggestions": [
   "Shadowing là gì?",
   "Luyện shadowing như thế nào?",
   "Tóm tắt bài này",
   "Ngữ điệu (intonation) quan trọng ra sao?"
  ]
 },
 {
  "id": "voa-writing-tips",
  "title": "Tips for Better Writing",
  "titleVi": "Mẹo để viết tốt hơn.",
  "subtitle": "Level 2 · Intermediate",
  "category": "GIÁO DỤC · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "✍️",
  "source_url": "https://learningenglish.voanews.com/a/tips-for-better-writing/2453053.html",
  "paragraphs": [
   {
    "en": "Today we continue our series of expert suggestions for academic writing. Our guest is Jennifer Ahern-Dodson, assistant professor of the Practice in Writing Studies at Duke University in North Carolina.",
    "vi": "Hôm nay chúng ta tiếp tục loạt bài gợi ý của chuyên gia về viết học thuật. Khách mời của chúng ta là Jennifer Ahern-Dodson, phó giáo sư thực hành nghiên cứu viết tại Đại học Duke ở North Carolina."
   },
   {
    "en": "She advises that you are not alone if you have had problems with your writing. She says everyone struggles with writing.",
    "vi": "Bà khuyên rằng bạn không đơn độc nếu từng gặp khó khăn với việc viết. Bà nói ai cũng chật vật với việc viết."
   },
   {
    "en": "“Writing is hard. All writers struggle at some point. And even if writing has come easily for you, at some point in your work as a student, you’re going to hit a roadblock.”",
    "vi": "“Viết rất khó. Mọi nhà văn đều có lúc chật vật. Và ngay cả khi việc viết từng dễ dàng với bạn, đến một lúc nào đó trong đời sinh viên, bạn sẽ gặp bế tắc.”"
   },
   {
    "en": "She says most people’s negative writing experiences happened because a very specific formula is required for a paper including an exact length. Focusing on the end makes it really hard to get started.",
    "vi": "Bà cho biết hầu hết trải nghiệm viết tiêu cực của mọi người xảy ra vì bài viết đòi hỏi một công thức rất cụ thể, kể cả độ dài chính xác. Quá tập trung vào kết quả cuối cùng khiến việc bắt đầu trở nên rất khó khăn."
   },
   {
    "en": "Another problem can arise when the need to do well on a paper is extremely important, like a timed essay exam or a college application essay. Worrying about what will happen if they don’t do well creates significant anxiety, and that can make it harder to get the writing done.",
    "vi": "Một vấn đề khác có thể nảy sinh khi việc viết tốt trở nên cực kỳ quan trọng, như bài luận thi có tính giờ hay bài luận xin vào đại học. Lo lắng về điều sẽ xảy ra nếu viết không tốt tạo ra sự căng thẳng đáng kể, và điều đó khiến việc viết càng khó khăn hơn."
   },
   {
    "en": "Then she and the people she’s helping move to more positive projects. She says usually when writing comes easily, the writers feel they have something important to say.",
    "vi": "Sau đó, bà và những người được bà giúp đỡ chuyển sang các dự án tích cực hơn. Bà nói thường thì khi việc viết trở nên dễ dàng, người viết cảm thấy mình có điều quan trọng muốn nói."
   },
   {
    "en": "The teacher advises asking yourself questions. What personal understanding of the subject can you bring to your paper? Why is this subject important? For whom is it meaningful? Who will be reading it?",
    "vi": "Cô giáo khuyên hãy tự hỏi bản thân những câu hỏi. Bạn có thể mang hiểu biết cá nhân nào về chủ đề vào bài viết? Vì sao chủ đề này quan trọng? Nó có ý nghĩa với ai? Ai sẽ đọc bài của bạn?"
   },
   {
    "en": "Think about who your audience is, and what it is that you really want to say to them. This can help you switch from worrying about the final product to focusing on what you have to offer: your particular perspective.",
    "vi": "Hãy nghĩ về độc giả của bạn là ai, và điều bạn thực sự muốn nói với họ là gì. Điều này giúp bạn chuyển từ lo lắng về sản phẩm cuối cùng sang tập trung vào điều bạn có thể mang lại: góc nhìn riêng của bạn."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Giáo dục (Education)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 2 · Intermediate"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "Everyone struggles with writing at some point — you are not alone.",
    "vi": "Ai cũng có lúc chật vật với việc viết — bạn không đơn độc."
   },
   {
    "en": "Focusing too much on formulas and results makes writing harder to start.",
    "vi": "Quá tập trung vào công thức và kết quả khiến việc bắt đầu viết khó khăn hơn."
   },
   {
    "en": "Ask who your audience is and what you want to say to them.",
    "vi": "Hãy tự hỏi độc giả của bạn là ai và bạn muốn nói gì với họ."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "According to the article, what should writers ask themselves?",
    "opts": [
     "How long the paper must be",
     "What grade they will get",
     "Who will read it and why the subject matters",
     "How fast they can finish"
    ],
    "answer": 2,
    "explain": "Bài đọc khuyên người viết tự hỏi: ai sẽ đọc bài, vì sao chủ đề quan trọng, mình mang được hiểu biết cá nhân nào vào bài."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The idiom 'hit a roadblock' in the article is closest in meaning to...",
    "opts": [
     "encounter a situation that blocks progress",
     "drive very fast",
     "build a road",
     "win a race"
    ],
    "answer": 0,
    "explain": "VOA giải thích 'hit a roadblock' là gặp phải tình huống cản trở tiến độ của mình."
   },
   {
    "type": "SUY LUẬN",
    "q": "Why does focusing on the final product make writing harder?",
    "opts": [
     "It makes the paper too short",
     "It creates pressure and anxiety about the result",
     "It wastes too much time",
     "It confuses the audience"
    ],
    "answer": 1,
    "explain": "Bài đọc nói quá tập trung vào kết quả cuối cùng gây lo lắng, khiến việc bắt đầu và hoàn thành bài viết khó khăn hơn."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Writing formulas are the key to success",
     "Everyone struggles with writing, but focusing on your message helps",
     "Only experts can write well",
     "Timed essays are the hardest to write"
    ],
    "answer": 1,
    "explain": "Ý chính: ai cũng chật vật với việc viết, nhưng thay vì lo về công thức hay kết quả, hãy tập trung vào điều mình muốn truyền đạt và độc giả của mình."
   }
  ],
  "suggestions": [
   "Vì sao viết lách lại khó?",
   "'Hit a roadblock' nghĩa là gì?",
   "Tóm tắt bài này",
   "Làm sao để bắt đầu viết dễ hơn?"
  ]
 },
 {
  "id": "voa-houdini",
  "title": "Harry Houdini, 1874-1926: The Great Escape Artist",
  "titleVi": "Harry Houdini — nhà ảo thuật thoát hiểm vĩ đại nhất mọi thời đại.",
  "subtitle": "1874–1926",
  "category": "NHÂN VẬT · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🎩",
  "source_url": "https://learningenglish.voanews.com/a/harry-houdini-1874-1926-the-great-escape-artist-112123534/114261.html",
  "paragraphs": [
   {
    "en": "It was a hot July day in nineteen twelve. A huge crowd gathered near New York City’s East River. They were there to watch a man whose hands and legs had been locked together. The man was put into a wooden box, which was nailed shut and lowered into the water with more than ninety kilograms of lead weight on top.",
    "vi": "Đó là một ngày tháng Bảy nóng bức năm một nghìn chín trăm mười hai. Một đám đông khổng lồ tụ tập gần sông East của thành phố New York. Họ đến để xem một người đàn ông bị khóa chặt cả tay lẫn chân. Người đàn ông bị nhốt vào một chiếc hộp gỗ, đóng đinh kín lại rồi thả xuống nước, bên trên còn đè hơn chín mươi kilôgam chì."
   },
   {
    "en": "Time seemed to go by slowly. The crowd was sure the man would soon be dead. But suddenly, there were bubbles in the water. The man swam to the surface, his arms and legs free. The man who had just escaped death was named Harry Houdini.",
    "vi": "Thời gian dường như trôi thật chậm. Đám đông chắc mẩm người đàn ông sẽ sớm chết. Nhưng bỗng nhiên, mặt nước nổi bong bóng. Người đàn ông bơi lên mặt nước, tay chân đã tự do. Người vừa thoát khỏi lưỡi hái tử thần tên là Harry Houdini."
   },
   {
    "en": "Harry Houdini’s real name was Ehrich Weisz. He was born in Budapest, Hungary in eighteen seventy-four. His family moved to the United States two years later. Young Ehrich worked at many different jobs to help earn money for his poor family. But he really wanted to be in show business.",
    "vi": "Tên thật của Harry Houdini là Ehrich Weisz. Ông sinh năm một nghìn tám trăm bảy mươi tư tại Budapest, Hungary. Hai năm sau, gia đình ông chuyển đến Hoa Kỳ. Cậu bé Ehrich làm đủ nghề để phụ giúp gia đình nghèo khó. Nhưng cậu thực sự muốn bước vào ngành giải trí."
   },
   {
    "en": "When he was nine years old, he performed a trapeze act. Then he read about a famous French magician named Jean Eugène Robert-Houdin. It changed his life. He took Houdin’s last name, changed the pronunciation and added an “i” at the end. He called himself Harry Houdini.",
    "vi": "Năm chín tuổi, cậu biểu diễn đu xà. Sau đó, cậu đọc về một nhà ảo thuật nổi tiếng người Pháp tên Jean Eugène Robert-Houdin. Điều đó đã thay đổi cuộc đời cậu. Cậu lấy họ của Houdin, đổi cách phát âm và thêm chữ “i” vào cuối. Cậu tự gọi mình là Harry Houdini."
   },
   {
    "en": "At first, Houdini performed regular magic tricks, using cards and coins. But the audience seemed to like it best when Houdini performed an escape. He soon became famous for being able to free himself from danger.",
    "vi": "Lúc đầu, Houdini biểu diễn những trò ảo thuật thông thường với bài và tiền xu. Nhưng khán giả dường như thích nhất khi Houdini biểu diễn thoát hiểm. Ông nhanh chóng nổi tiếng với khả năng tự giải thoát khỏi nguy hiểm."
   },
   {
    "en": "Most of the time, his wrists would be held together by handcuffs. He once escaped from a straightjacket while hanging high in the air, upside down, from a crane. He escaped from milk cans. He escaped from the strongest jails in the United States. No one ever found a pair of handcuffs that would hold him.",
    "vi": "Hầu hết thời gian, cổ tay ông bị còng lại với nhau. Ông từng thoát khỏi áo trói trong khi bị treo ngược, lơ lửng trên cao bằng cần cẩu. Ông thoát khỏi những thùng sữa. Ông thoát khỏi những nhà tù kiên cố nhất nước Mỹ. Không ai tìm được chiếc còng nào giữ nổi ông."
   },
   {
    "en": "But Houdini’s most famous escape was called “The Chinese Water Torture.” First, his feet were locked together. Then he was lowered, upside down, into a glass box filled with water. Several minutes would go by while the audience feared that the Great Houdini was drowning. Finally, the curtain would drop, and Houdini would be standing next to the box, free and unharmed.",
    "vi": "Nhưng màn thoát hiểm nổi tiếng nhất của Houdini có tên “Tra tấn nước kiểu Trung Hoa.” Đầu tiên, chân ông bị khóa chặt. Rồi ông bị thả ngược đầu xuống một hộp kính đầy nước. Vài phút trôi qua trong khi khán giả lo sợ Houdini vĩ đại đang chết đuối. Cuối cùng, tấm màn buông xuống, và Houdini đứng cạnh chiếc hộp, tự do và không hề hấn gì."
   },
   {
    "en": "During Houdini’s lifetime, some people thought it was possible to communicate with dead people. Houdini had loved his mother very much, and after she died, he tried to talk with her spirit. But after years of trying, he decided that no one could talk with the dead.",
    "vi": "Thời Houdini còn sống, có người tin rằng có thể giao tiếp với người đã khuất. Houdini rất yêu mẹ mình, và sau khi bà mất, ông đã cố nói chuyện với linh hồn bà. Nhưng sau nhiều năm cố gắng, ông kết luận rằng không ai có thể trò chuyện với người chết."
   },
   {
    "en": "Harry Houdini knew that mediums who claimed to contact spirits were using tricks just to make money. He began to give speeches telling how the mediums were fooling people. He even spoke before the United States Congress.",
    "vi": "Harry Houdini biết rằng những nhà ngoại cảm tự xưng liên lạc được với linh hồn chỉ dùng mánh khóe để kiếm tiền. Ông bắt đầu diễn thuyết vạch trần cách các nhà ngoại cảm lừa gạt mọi người. Ông thậm chí đã phát biểu trước Quốc hội Hoa Kỳ."
   },
   {
    "en": "Houdini was so sure that he was right, he offered ten thousand dollars to anyone who could prove he was wrong. No one ever collected the money.",
    "vi": "Houdini tin chắc mình đúng đến mức treo thưởng mười nghìn đô la cho bất kỳ ai chứng minh được ông sai. Không ai nhận được số tiền đó."
   },
   {
    "en": "Harry Houdini had a long career as a magician and an escape artist. He became the most famous magician in the world. He wrote books and acted in movies. But Houdini would not live to see old age. His life ended suddenly in nineteen twenty-six.",
    "vi": "Harry Houdini có sự nghiệp lâu dài với tư cách nhà ảo thuật và nghệ sĩ thoát hiểm. Ông trở thành nhà ảo thuật nổi tiếng nhất thế giới. Ông viết sách và đóng phim. Nhưng Houdini không sống đến tuổi già. Cuộc đời ông kết thúc đột ngột năm một nghìn chín trăm hai mươi sáu."
   },
   {
    "en": "Houdini was resting after giving a speech in Montreal, Canada. A young college student asked if it were true that Houdini would not be harmed even if hit very hard in the stomach. The student hit Houdini in the stomach three times before he could prepare himself. Doctors found that Houdini’s appendix had burst. He died on October thirty-first -- Halloween.",
    "vi": "Houdini đang nghỉ ngơi sau buổi diễn thuyết ở Montreal, Canada. Một sinh viên trẻ hỏi có đúng là dù bị đấm rất mạnh vào bụng Houdini cũng không hề hấn gì không. Cậu sinh viên đấm vào bụng Houdini ba lần trước khi ông kịp chuẩn bị. Các bác sĩ phát hiện ruột thừa của Houdini đã vỡ. Ông qua đời vào ngày ba mươi mốt tháng Mười — đúng lễ Halloween."
   },
   {
    "en": "But the story of Harry Houdini did not end there. He had told his wife, Bess, to try to speak with him after he died. He gave her two secret words, “Rosabelle, believe,” so that she would not be fooled by some trick. Bess tried for ten years, then finally gave up.",
    "vi": "Nhưng câu chuyện về Harry Houdini chưa dừng lại ở đó. Ông đã dặn vợ mình, Bess, hãy cố gắng liên lạc với ông sau khi ông qua đời. Ông cho bà hai từ bí mật, “Rosabelle, believe,” để bà không bị lừa bởi mánh khóe nào. Bess đã thử suốt mười năm, rồi cuối cùng đành bỏ cuộc."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Nhân vật (People)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 2 · Intermediate"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "Harry Houdini became the world's most famous escape artist with death-defying tricks like the Chinese Water Torture.",
    "vi": "Harry Houdini trở thành nghệ sĩ thoát hiểm nổi tiếng nhất thế giới với những màn trình diễn thách thức tử thần như “Tra tấn nước kiểu Trung Hoa”."
   },
   {
    "en": "He spent his later years exposing fake mediums who claimed to talk with the dead.",
    "vi": "Những năm cuối đời, ông dành thời gian vạch trần các nhà ngoại cảm giả mạo tự xưng trò chuyện được với người chết."
   },
   {
    "en": "Houdini died suddenly in 1926 after a student punched him in the stomach, bursting his appendix.",
    "vi": "Houdini qua đời đột ngột năm 1926 sau khi bị một sinh viên đấm vào bụng làm vỡ ruột thừa."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "What happened on the hot July day in 1912?",
    "opts": [
     "Houdini performed a trapeze act",
     "Houdini escaped from a nailed box under the East River",
     "Houdini spoke before Congress",
     "Houdini met his wife Bess"
    ],
    "answer": 1,
    "explain": "Bài đọc mở đầu bằng cảnh Houdini bị nhốt trong hộp gỗ đóng đinh, thả xuống sông East rồi thoát ra an toàn."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word “mediums” in the article is closest in meaning to...",
    "opts": [
     "people who claim to talk with spirits",
     "magicians who do card tricks",
     "doctors who treat patients",
     "reporters who write news"
    ],
    "answer": 0,
    "explain": "“Medium” trong bài chỉ những người tự xưng có thể liên lạc với linh hồn người chết để kiếm tiền."
   },
   {
    "type": "SUY LUẬN",
    "q": "Why did Houdini offer $10,000 to anyone who could prove him wrong?",
    "opts": [
     "He wanted to become richer",
     "He was completely sure all mediums were fakes",
     "He needed money for his shows",
     "He wanted to hire a real medium"
    ],
    "answer": 1,
    "explain": "Ông treo thưởng vì tin chắc 100% rằng các nhà ngoại cảm đều là lừa đảo — và không ai dám nhận thách thức."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Houdini's mother helped his career",
     "Magic tricks are easy to learn",
     "Houdini was a legendary escape artist who also fought fraud",
     "The Chinese Water Torture is safe for everyone"
    ],
    "answer": 2,
    "explain": "Bài viết kể về Houdini — nghệ sĩ thoát hiểm huyền thoại, đồng thời là người vạch trần các nhà ngoại cảm lừa đảo."
   }
  ],
  "suggestions": [
   "Houdini nổi tiếng vì điều gì?",
   "Màn “Chinese Water Torture” diễn ra thế nào?",
   "Vì sao Houdini qua đời?",
   "Tóm tắt bài này"
  ]
 },
 {
  "id": "voa-hershey",
  "title": "Milton Hershey, the Name Means Chocolate to Americans",
  "titleVi": "Milton Hershey — người đàn ông biến sô-cô-la thành cái tên của nước Mỹ.",
  "subtitle": "1857–1945",
  "category": "NHÂN VẬT · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🍫",
  "source_url": "https://learningenglish.voanews.com/a/milton-hershey-1857-1945-he-created-a-successful-business-and-built-a-sweet-town-111323784/112490.html",
  "paragraphs": [
   {
    "en": "Milton Snavely Hershey was born in eighteen fifty-seven in central Pennsylvania. His mother was a member of the Mennonite Church, a religious group that valued self-denial and community service.",
    "vi": "Milton Snavely Hershey sinh năm một nghìn tám trăm năm mươi bảy tại miền trung Pennsylvania. Mẹ ông là thành viên của Giáo hội Mennonite, một nhóm tôn giáo đề cao sự từ bỏ lợi ích cá nhân và phục vụ cộng đồng."
   },
   {
    "en": "Milton Hershey stopped attending school when he was twelve years old. He got a job with a candy and ice cream maker in the town of Lancaster. There, he learned how to mix sugar and water to make candy products.",
    "vi": "Milton Hershey nghỉ học năm mười hai tuổi. Ông xin làm cho một người thợ làm kẹo và kem ở thị trấn Lancaster. Tại đó, ông học cách trộn đường với nước để làm kẹo."
   },
   {
    "en": "Milton moved to the city of Philadelphia when he was eighteen years old. His mother and her family helped him set up a candy store. But the business failed after six years.",
    "vi": "Milton chuyển đến thành phố Philadelphia năm mười tám tuổi. Mẹ ông và gia đình bên ngoại giúp ông mở một cửa hàng kẹo. Nhưng việc kinh doanh thất bại sau sáu năm."
   },
   {
    "en": "Milton later attempted candy businesses in Chicago, New York City, and Denver. Like before, each business failed.",
    "vi": "Sau đó, Milton thử mở tiệm kẹo ở Chicago, New York và Denver. Cũng như trước, lần nào cũng thất bại."
   },
   {
    "en": "Milton returned to Lancaster and began making caramels his own way – with fresh milk. His caramels were softer than others being sold. One day, an English importer tasted Hershey’s caramels and placed a large order. Soon the Lancaster Candy Company was a success.",
    "vi": "Milton trở về Lancaster và bắt đầu làm kẹo caramel theo cách riêng — với sữa tươi. Kẹo của ông mềm hơn các loại đang bán. Một ngày nọ, một nhà nhập khẩu người Anh nếm thử caramel của Hershey và đặt hàng lớn. Chẳng bao lâu, Công ty Kẹo Lancaster thành công rực rỡ."
   },
   {
    "en": "Things began changing for Hershey after he visited the Chicago World’s Fair in eighteen ninety-three. At the World’s Fair, he saw chocolate-making machines from Germany. He decided that chocolate was the future of the candy business, and bought the machines.",
    "vi": "Mọi thứ bắt đầu thay đổi với Hershey sau khi ông thăm Hội chợ Thế giới Chicago năm một nghìn tám trăm chín mươi ba. Tại hội chợ, ông thấy những cỗ máy làm sô-cô-la từ Đức. Ông quyết định rằng sô-cô-la chính là tương lai của ngành kẹo, và mua luôn những cỗ máy đó."
   },
   {
    "en": "He was developing an unusual plan -- to build a large chocolate factory and a town to support it. He wanted to create a place where his factory’s workers could own their own houses. Hershey’s town was modern, with nice houses, large public buildings, and an electric railway system.",
    "vi": "Ông ấp ủ một kế hoạch khác thường — xây một nhà máy sô-cô-la lớn cùng cả một thị trấn để phục vụ nó. Ông muốn tạo ra nơi mà công nhân của mình có thể sở hữu nhà riêng. Thị trấn Hershey hiện đại, với những ngôi nhà đẹp, các tòa nhà công cộng lớn và hệ thống đường sắt điện."
   },
   {
    "en": "Milton Hershey and his company found a way to make large amounts of milk chocolate. The Hershey Candy Company was on its way to success.",
    "vi": "Milton Hershey và công ty của ông đã tìm ra cách sản xuất sô-cô-la sữa với số lượng lớn. Công ty Kẹo Hershey đang trên đà thành công."
   },
   {
    "en": "Milton Hershey did not marry until he was over forty years old. He married Catherine Sweeney in eighteen ninety-eight. The Hersheys were unable to have children, so they decided to help needy children by creating a school for them.",
    "vi": "Milton Hershey kết hôn muộn, khi đã ngoài bốn mươi tuổi. Ông cưới Catherine Sweeney năm một nghìn tám trăm chín mươi tám. Vợ chồng Hershey không thể có con, nên họ quyết định giúp đỡ trẻ em khó khăn bằng cách lập một ngôi trường cho các em."
   },
   {
    "en": "In nineteen-oh-nine, the Hersheys created the Hershey Industrial School for boys who had lost one or both parents. After his wife died, Milton Hershey gave shares of Hershey Chocolate Company stock worth sixty million dollars to the school’s trust.",
    "vi": "Năm một nghìn chín trăm linh chín, vợ chồng Hershey lập Trường Công nghiệp Hershey dành cho những cậu bé mồ côi cha hoặc mẹ. Sau khi vợ mất, Milton Hershey đã tặng quỹ của trường số cổ phiếu Công ty Sô-cô-la Hershey trị giá sáu mươi triệu đô la."
   },
   {
    "en": "Today, the school serves children in financial and social need, providing education, housing, food, clothing, and medical care to about one thousand eight hundred students.",
    "vi": "Ngày nay, ngôi trường phục vụ trẻ em có hoàn cảnh khó khăn, cung cấp giáo dục, nhà ở, ăn uống, quần áo và chăm sóc y tế cho khoảng một nghìn tám trăm học sinh."
   },
   {
    "en": "Milton Hershey died in nineteen forty-five. At the time of his death, the company he built was said to have produced about ninety percent of all the milk chocolate made in the United States.",
    "vi": "Milton Hershey qua đời năm một nghìn chín trăm bốn mươi lăm. Vào thời điểm đó, công ty ông gây dựng được cho là đã sản xuất khoảng chín mươi phần trăm lượng sô-cô-la sữa của toàn nước Mỹ."
   },
   {
    "en": "Today, Hershey, Pennsylvania calls itself “The Sweetest Place on Earth.” The streetlights are shaped like the candy called Hershey’s Kisses, and the air often smells like chocolate.",
    "vi": "Ngày nay, Hershey, Pennsylvania tự gọi mình là “Nơi ngọt ngào nhất Trái Đất.” Đèn đường có hình những viên kẹo Hershey’s Kisses, và không khí thường thoang thoảng mùi sô-cô-la."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Nhân vật (People)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 2 · Intermediate"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "Milton Hershey failed many times before finding success with caramels and then milk chocolate.",
    "vi": "Milton Hershey thất bại nhiều lần trước khi thành công với kẹo caramel rồi sô-cô-la sữa."
   },
   {
    "en": "He built not only a chocolate company but also a modern town for his workers.",
    "vi": "Ông không chỉ xây dựng công ty sô-cô-la mà còn cả một thị trấn hiện đại cho công nhân."
   },
   {
    "en": "Childless himself, he gave most of his fortune to a school for needy children.",
    "vi": "Không có con, ông đã dành phần lớn tài sản cho ngôi trường nuôi dạy trẻ em khó khăn."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "What made Hershey decide that chocolate was the future?",
    "opts": [
     "A book about chocolate",
     "Chocolate-making machines at the 1893 Chicago World's Fair",
     "Advice from his mother",
     "A trip to Germany"
    ],
    "answer": 1,
    "explain": "Bài đọc nói ông thấy máy làm sô-cô-la của Đức tại Hội chợ Thế giới Chicago 1893 và quyết định mua chúng."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word “importer” in the article is closest in meaning to...",
    "opts": [
     "a person who buys goods from another country",
     "a person who makes candy",
     "a person who builds houses",
     "a person who teaches children"
    ],
    "answer": 0,
    "explain": "“Importer” là nhà nhập khẩu — người mua hàng từ nước khác; trong bài là người Anh đã đặt mua caramel của Hershey."
   },
   {
    "type": "SUY LUẬN",
    "q": "What can be inferred about Milton Hershey's character?",
    "opts": [
     "He gave up easily after failures",
     "He cared only about money",
     "He never gave up and cared about others",
     "He disliked working with people"
    ],
    "answer": 2,
    "explain": "Ông thất bại nhiều lần nhưng không bỏ cuộc, xây nhà cho công nhân và tặng 60 triệu đô la cho trường học — cho thấy sự kiên trì và lòng nhân ái."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Chocolate is unhealthy for children",
     "Milton Hershey turned repeated failure into sweet success and shared it with others",
     "Pennsylvania is the best state in America",
     "Schools should teach candy-making"
    ],
    "answer": 1,
    "explain": "Bài viết kể hành trình từ thất bại liên tiếp đến thành công của Hershey và tấm lòng chia sẻ tài sản cho trẻ em khó khăn."
   }
  ],
  "suggestions": [
   "Vì sao Hershey chuyển sang làm sô-cô-la?",
   "Thị trấn Hershey có gì đặc biệt?",
   "Ông đã làm từ thiện thế nào?",
   "Tóm tắt bài này"
  ]
 },
 {
  "id": "voa-eagle-eyes",
  "title": "Don't Miss a Thing With 'Eagle Eyes'",
  "titleVi": "Thành ngữ “eagle eyes” — đôi mắt tinh như đại bàng, không bỏ sót chi tiết nào.",
  "subtitle": "Level 2 · Intermediate",
  "category": "THÀNH NGỮ · VOA LEARNING ENGLISH",
  "level": "Level 2 · Intermediate",
  "emoji": "🦅",
  "source_url": "https://learningenglish.voanews.com/a/don-t-miss-a-thing-with-eagle-eyes-/7963085.html",
  "paragraphs": [
   {
    "en": "In English, we use the term “bird’s eye view” to describe a view from above as if seen by a bird in flight. It is also described as an “overall view” or “big picture view.”",
    "vi": "Trong tiếng Anh, cụm từ “bird’s eye view” (tầm nhìn chim bay) dùng để chỉ góc nhìn từ trên cao như thể chim đang bay. Nó còn được gọi là “overall view” (cái nhìn tổng thể) hay “big picture view” (cái nhìn toàn cảnh)."
   },
   {
    "en": "For example, when I start a project, I first like to get a bird’s eye view. I ask myself: What is the overall goal? Answers to these “big picture” questions can help me understand the scope of the project.",
    "vi": "Ví dụ, khi bắt đầu một dự án, tôi thích có cái nhìn toàn cảnh trước. Tôi tự hỏi: Mục tiêu tổng thể là gì? Trả lời những câu hỏi “bức tranh lớn” này giúp tôi hiểu phạm vi của dự án."
   },
   {
    "en": "Some birds, called raptors, are known for their extremely sharp vision. Eagles, hawks, and owls can see their prey from very far away.",
    "vi": "Một số loài chim, gọi là chim săn mồi (raptors), nổi tiếng với thị lực cực kỳ sắc bén. Đại bàng, diều hâu và cú có thể nhìn thấy con mồi từ rất xa."
   },
   {
    "en": "Raptors have powerful binocular vision, where both their left and right eyes can see and focus on a single object. Eagles and hawks also have a special bone structure around their eyes that protects them from bright sunlight.",
    "vi": "Chim săn mồi có thị giác hai mắt rất mạnh, cả mắt trái và mắt phải đều nhìn và tập trung vào một vật thể. Đại bàng và diều hâu còn có cấu trúc xương đặc biệt quanh mắt giúp bảo vệ khỏi ánh nắng chói chang."
   },
   {
    "en": "If you have an eagle eye, you have the ability to see or notice distant objects. Also, you observe everything, even very small details which others might miss. Someone who is hawk-eyed watches and notices everything that happens.",
    "vi": "Nếu bạn có “eagle eye” (mắt đại bàng), bạn có khả năng nhìn thấy hoặc phát hiện vật ở xa. Bạn còn quan sát mọi thứ, kể cả những chi tiết rất nhỏ mà người khác có thể bỏ lỡ. Người “hawk-eyed” (mắt diều hâu) theo dõi và nhận ra mọi chuyện xảy ra."
   },
   {
    "en": "A person does not have to have this ability all the time. They might use their keen vision only at certain times, especially when they need to keep a close watch.",
    "vi": "Một người không cần lúc nào cũng có khả năng này. Họ có thể chỉ dùng thị lực sắc bén vào những lúc nhất định, đặc biệt khi cần theo dõi sát sao."
   },
   {
    "en": "The term “eagle eye” has been used for hundreds of years. The Oxford English Dictionary says the earliest evidence for “eagle eye” is from 1567.",
    "vi": "Cụm từ “eagle eye” đã được dùng hàng trăm năm nay. Từ điển Oxford English Dictionary cho biết bằng chứng sớm nhất của “eagle eye” là từ năm 1567."
   }
  ],
  "info_rows": [
   [
    "CHỦ ĐỀ",
    "Thành ngữ (Idioms)"
   ],
   [
    "TRÌNH ĐỘ",
    "Level 2 · Intermediate"
   ],
   [
    "NGUỒN",
    "VOA Learning English"
   ]
  ],
  "timeline": [],
  "main_ideas": [
   {
    "en": "“Bird's eye view” means looking at the big picture from above.",
    "vi": "“Bird's eye view” nghĩa là nhìn toàn cảnh từ trên cao."
   },
   {
    "en": "Raptors like eagles have extremely sharp binocular vision for spotting prey far away.",
    "vi": "Chim săn mồi như đại bàng có thị lực hai mắt cực sắc để phát hiện con mồi từ xa."
   },
   {
    "en": "“Eagle eye” describes a person who notices even the smallest details others miss.",
    "vi": "“Eagle eye” chỉ người tinh mắt, nhận ra cả những chi tiết nhỏ nhất mà người khác bỏ lỡ."
   }
  ],
  "quiz": [
   {
    "type": "CHI TIẾT TRONG BÀI",
    "q": "According to the article, what does “bird's eye view” describe?",
    "opts": [
     "A view from an airplane window",
     "A view from above, like a bird in flight",
     "A close-up photo of a bird",
     "A painting of the sky"
    ],
    "answer": 1,
    "explain": "Bài đọc định nghĩa “bird's eye view” là góc nhìn từ trên cao như thể chim đang bay."
   },
   {
    "type": "TỪ VỰNG",
    "q": "The word “keen” in the article is closest in meaning to...",
    "opts": [
     "very sharp",
     "very slow",
     "very loud",
     "very soft"
    ],
    "answer": 0,
    "explain": "VOA định nghĩa “keen” là tính từ nghĩa “rất sắc bén” (very sharp), dùng để tả thị lực."
   },
   {
    "type": "SUY LUẬN",
    "q": "Why might a manager want to get a “bird's eye view” of a project?",
    "opts": [
     "To avoid doing any work",
     "To understand the overall goal before starting",
     "To watch birds during lunch",
     "To take photos from above"
    ],
    "answer": 1,
    "explain": "Bài đọc ví dụ: có cái nhìn toàn cảnh giúp hiểu mục tiêu tổng thể và phạm vi dự án trước khi bắt tay vào làm."
   },
   {
    "type": "Ý CHÍNH",
    "q": "What is the main idea of the article?",
    "opts": [
     "Eagles are going extinct",
     "English uses bird-related terms to describe sharp vision and broad views",
     "Owls cannot see at night",
     "Dictionaries are always correct"
    ],
    "answer": 1,
    "explain": "Bài viết giới thiệu các thành ngữ tiếng Anh liên quan đến chim: “bird's eye view”, “eagle eye”, “hawk-eyed” và giải thích ý nghĩa."
   }
  ],
  "suggestions": [
   "“Eagle eye” nghĩa là gì?",
   "“Bird's eye view” dùng khi nào?",
   "Vì sao đại bàng nhìn xa tốt?",
   "Tóm tắt bài này"
  ]
 }
];
// ============================================================
// BÀI ĐỌC SONG NGỮ (thêm 04/10/2026)
// - Bấm từ tiếng Anh -> tooltip tra nghĩa (/api/word) + lưu vào Từ vựng
// - Từ lưu từ bài đọc đồng bộ với savedWords (flashcard "Từ đã lưu")
// - Hỏi AI: dùng chung /api/chat (Groq streaming), chỉ gắn thêm ngữ cảnh bài đọc
// ============================================================

let readingArticle = null;
let readingTab = 'info';
let readingLang = 'both';
let readingQi = 0, readingScore = 0, readingQLock = false;
let readingAiStreaming = false;

function openReading() {
    document.getElementById('readingFab').style.display = 'none';
    if (readingArticle) {
        document.getElementById('readingListView').style.display = 'none';
        document.getElementById('readingArticleView').style.display = '';
        document.getElementById('readingFab').style.display = '';
        renderReadingArticle();
    } else {
        document.getElementById('readingListView').style.display = '';
        document.getElementById('readingArticleView').style.display = 'none';
        renderReadingList();
    }
}

let readingFilter = 'all';
function readingCatName(a) { return (a.category || '').split('·')[0].trim() || 'Khác'; }
function renderReadingFilters() {
    const cats = {};
    READING_ARTICLES.forEach(a => { const c = readingCatName(a); cats[c] = (cats[c] || 0) + 1; });
    const el = document.getElementById('readingFilters');
    if (!el) return;
    el.innerHTML =
        `<button class="${readingFilter === 'all' ? 'on' : ''}" onclick="setReadingFilter('all')">Tất cả <span>${READING_ARTICLES.length}</span></button>` +
        Object.entries(cats).sort((x, y) => y[1] - x[1]).map(([c, n]) =>
            `<button class="${readingFilter === c ? 'on' : ''}" onclick="setReadingFilter('${c.replace(/'/g, "\\'")}')">${escapeHtml(c)} <span>${n}</span></button>`).join('');
}
function setReadingFilter(c) { readingFilter = c; renderReadingFilters(); renderReadingList(); }
function renderReadingList() {
    const grid = document.getElementById('readingGrid');
    const cnt = document.getElementById('readingCount');
    const list = readingFilter === 'all' ? READING_ARTICLES
        : READING_ARTICLES.filter(a => readingCatName(a) === readingFilter);
    if (cnt) cnt.textContent = `${list.length} bài`;
    renderReadingFilters();
    grid.innerHTML = list.map(a => `
        <div class="reading-card-item" onclick="openArticle('${a.id}')">
            <div class="rc-avatar">${a.emoji || '📖'}</div>
            <div class="rc-body">
                <h3>${escapeHtml(a.title)}</h3>
                <div class="rc-sub">${escapeHtml(a.subtitle || a.level)}</div>
                <div class="rc-sum">${escapeHtml(a.titleVi)}</div>
            </div>
        </div>`).join('');
}

function openArticle(id) {
    readingArticle = READING_ARTICLES.find(a => a.id === id);
    if (!readingArticle) return;
    readingTab = 'info';
    readingLang = 'both';
    document.querySelectorAll('#readingLangPills button').forEach(b =>
        b.classList.toggle('on', b.dataset.m === 'both'));
    document.getElementById('readingListView').style.display = 'none';
    document.getElementById('readingArticleView').style.display = '';
    document.getElementById('readingFab').style.display = '';
    // reset drawer + dừng đọc bài cũ nếu đang phát
    try { speechSynthesis.cancel(); } catch (e) {}
    _articleSpeaking = false;
    document.getElementById('readingMsgs').innerHTML = '';
    document.getElementById('readingDrawer').classList.remove('open');
    renderReadingArticle();
}

function backToReadingList() {
    document.getElementById('readingArticleView').classList.remove('reading-fullscreen');
    readingArticle = null;
    document.getElementById('readingDrawer').classList.remove('open');
    openReading();
    document.getElementById('tab-reading').scrollTop = 0;
}

function renderReadingArticle() {
    const a = readingArticle;
    if (!a) return;
    document.getElementById('readingCat').textContent = a.category;
    document.getElementById('readingDesc').textContent = a.titleVi;
    document.getElementById('readingAvatar').textContent = a.emoji || '📖';
    document.getElementById('readingIdeasCnt').textContent = (a.main_ideas || []).length;
    document.getElementById('readingQuizCnt').textContent = (a.quiz || []).length;
    document.getElementById('readingMeta').innerHTML = `
        <span class="rp-level">${escapeHtml(a.level)}</span>
        <button class="rp-audio" onclick="speakArticle()"><i class="ri-volume-up-line"></i> Nghe toàn bài</button>
        <button class="rp-ai" onclick="openReadingDrawer()"><i class="ri-chat-smile-2-line"></i> Hỏi AI về bài này</button>`;
    document.getElementById('readingDrawerSub').textContent =
        `AI đã đọc: "${a.title}" · Trả lời dựa trên bài đọc`;
    renderReadingParas();
    document.querySelectorAll('#readingTabs button').forEach(b =>
        b.classList.toggle('on', b.dataset.t === readingTab));
    renderReadingTab();
    updateReadingVocabBadge();
}

function renderReadingParas() {
    const a = readingArticle;
    if (!a) return;
    document.getElementById('readingParas').innerHTML = a.paragraphs.map((p, pi) => `
        <div class="rpara mode-${readingLang}">
            <p class="en">${renderReadingWords(p.en, pi)}</p>
            <p class="vi">${escapeHtml(p.vi)}</p>
        </div>`).join('');
}

function renderReadingWords(text, pi) {
    return escapeHtml(text).split(/([A-Za-z']+)/g).map(tok => {
        if (!/^[A-Za-z']+$/.test(tok)) return tok;
        const low = tok.toLowerCase().replace(/'(s|ve|re|ll|d|m|t)$/, '');
        const saved = savedWords.some(s => s.lemma === low && s.source === 'reading');
        return `<span class="rw${saved ? ' saved' : ''}" data-w="${low}" data-pi="${pi}">${tok}</span>`;
    }).join('');
}

// Bấm từ trong bài -> tooltip tra nghĩa (tái dùng showTip của tab CEFR)
document.addEventListener('click', function (e) {
    const readingView = document.getElementById('readingArticleView');
    if (!readingView || readingView.style.display === 'none') return;
    const el = e.target.closest ? e.target.closest('.rw') : null;
    if (!el) return;
    const s = findReadingSentence(+el.dataset.pi, el.dataset.w);
    window._readingSaveCtx = {
        ex_en: s.en, ex_vi: s.vi, source: 'reading', articleId: readingArticle.id
    };
    showTip(el, el.dataset.w, el.dataset.w, nextWordsOf(el, 1, 'rw'));
});

function findReadingSentence(pi, low) {
    const p = readingArticle.paragraphs[pi];
    const ens = p.en.match(/[^.!?]+[.!?]+/g) || [p.en];
    const vis = p.vi.match(/[^.!?]+[.!?]+/g) || [p.vi];
    for (let i = 0; i < ens.length; i++)
        if (ens[i].toLowerCase().includes(low))
            return { en: ens[i].trim(), vi: (vis[i] || '').trim() };
    return { en: ens[0].trim(), vi: (vis[0] || '').trim() };
}

// Đọc toàn bài: bấm 1 lần phát, bấm lần 2 dừng (toggle)
let _articleSpeaking = false;
function speakArticle() {
    if (!readingArticle) return;
    try {
        if (_articleSpeaking) {
            speechSynthesis.cancel();
            _articleSpeaking = false;
            updateSpeakBtn();
            return;
        }
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(
            readingArticle.paragraphs.map(p => p.en).join(' '));
        u.lang = 'en-US'; u.rate = 0.9;
        u.onend = u.onerror = () => { _articleSpeaking = false; updateSpeakBtn(); };
        _articleSpeaking = true;
        updateSpeakBtn();
        speechSynthesis.speak(u);
    } catch (e) {}
}
function updateSpeakBtn() {
    document.querySelectorAll('.rp-audio').forEach(b => {
        b.innerHTML = _articleSpeaking
            ? '<i class="ri-stop-circle-line"></i> Dừng'
            : '<i class="ri-volume-up-line"></i> Nghe toàn bài';
        b.classList.toggle('playing', _articleSpeaking);
    });
}

// Toàn màn hình đọc bài (như mẫu)
function toggleReadingFullscreen() {
    const v = document.getElementById('readingArticleView');
    v.classList.toggle('reading-fullscreen');
    const on = v.classList.contains('reading-fullscreen');
    document.querySelectorAll('.reading-fs-btn').forEach(b => {
        b.innerHTML = on ? '<i class="ri-fullscreen-exit-line"></i> Thoát'
                         : '<i class="ri-fullscreen-line"></i> Toàn màn hình';
    });
}

// Chuyển chế độ Song ngữ / Tiếng Anh / Bản dịch
document.addEventListener('click', function (e) {
    const b = e.target.closest ? e.target.closest('#readingLangPills button') : null;
    if (!b) return;
    readingLang = b.dataset.m;
    document.querySelectorAll('#readingLangPills button').forEach(x =>
        x.classList.toggle('on', x === b));
    document.querySelectorAll('#readingParas .rpara').forEach(p => {
        p.className = 'rpara mode-' + readingLang;
    });
});

// Tabs: Thông tin / Từ vựng / Ý chính / Câu hỏi
document.addEventListener('click', function (e) {
    const b = e.target.closest ? e.target.closest('#readingTabs button') : null;
    if (!b) return;
    readingTab = b.dataset.t;
    document.querySelectorAll('#readingTabs button').forEach(x =>
        x.classList.toggle('on', x === b));
    renderReadingTab();
});

function updateReadingVocabBadge() {
    const el = document.getElementById('readingVocabCnt');
    if (!el || !readingArticle) return;
    el.textContent = savedWords.filter(s =>
        s.source === 'reading' && s.articleId === readingArticle.id).length;
}

function readingToast(msg) {
    const t = document.getElementById('readingToast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 1600);
}

function renderReadingTab() {
    const a = readingArticle;
    const el = document.getElementById('readingTabBody');
    if (!a || !el) return;

    if (readingTab === 'info') {
        el.innerHTML = `
            <dl class="rkv">${a.info_rows.map(r =>
                `<dt>${escapeHtml(r[0])}</dt><dd>${escapeHtml(r[1])}</dd>`).join('')}</dl>
            ${a.source_url ? `<div class="rsource"><a href="${escapeHtml(a.source_url)}" target="_blank" rel="noopener">
                <i class="ri-external-link-line"></i> Đọc bài gốc trên VOA</a></div>` : ''}
            ${a.timeline && a.timeline.length ? `
                <div class="rsecttl">DIỄN BIẾN SỰ KIỆN</div>
                <ul class="rtl">${a.timeline.map(x => `<li><span class="yr">${escapeHtml(x.year)}</span>
                    <span><span class="en2">${escapeHtml(x.en)}</span><br>
                    <span class="vi2">${escapeHtml(x.vi)}</span></span></li>`).join('')}</ul>` : ''}`;
    } else if (readingTab === 'vocab') {
        const words = savedWords.filter(s =>
            s.source === 'reading' && s.articleId === a.id)
            .sort((x, y) => y.savedAt - x.savedAt);
        if (!words.length) {
            el.innerHTML = `<div class="rempty"><i class="ri-inbox-line" style="font-size:32px;color:var(--muted-2)"></i><br>Chưa lưu từ nào.<br>Đọc bài và <b>bấm vào từ khó</b> để lưu vào đây nhé!<br>
                <span style="font-size:13px">Từ đã lưu cũng xuất hiện trong Flashcard → Từ đã lưu.</span></div>`;
        } else {
            el.innerHTML = words.map(s => `
                <div class="rvitem">
                    <div class="wrow">
                        <span class="w">${escapeHtml(s.word)}</span>
                        <button class="rvspk" onclick="playAudio('${escapeHtml(s.lemma)}','us')" title="Nghe phát âm"><i class="ri-volume-up-line"></i></button>
                        <button class="runsave" onclick="unsaveReadingWord('${escapeHtml(s.lemma)}')" title="Bỏ lưu">✕</button>
                    </div>
                    <div class="mean">${escapeHtml(s.desc || '(chưa có nghĩa)')}</div>
                    ${s.ex_en ? `<div class="ex"><div class="en-ex">"${escapeHtml(s.ex_en)}"</div>
                        <div>${escapeHtml(s.ex_vi || '')}</div></div>` : ''}
                </div>`).join('');
        }
    } else if (readingTab === 'ideas') {
        el.innerHTML = `<div class="rsecttl">Ý CHÍNH CỦA BÀI</div>` +
            a.main_ideas.map((m, i) => `
                <div class="ridea"><span class="n">${i + 1}</span>
                    <div><p class="ie">${escapeHtml(m.en)}</p>
                    <p class="iv">${escapeHtml(m.vi)}</p></div>
                </div>`).join('');
    } else if (readingTab === 'quiz') {
        startReadingQuiz();
    }
}

function unsaveReadingWord(lemma) {
    const removed = savedWords.filter(s =>
        s.lemma === lemma && s.source === 'reading' &&
        s.articleId === (readingArticle && readingArticle.id));
    savedWords = savedWords.filter(s => !removed.includes(s));
    persistSavedWords();
    removed.forEach(s => removeSavedWordServer(s.lemma));
    updateBookmarkCount();
    renderSavedWordsPanel();
    renderReadingParas();
    updateReadingVocabBadge();
    renderReadingTab();
    readingToast('Đã bỏ lưu từ');
}

// ---------- Quiz kiểu Prep ----------
let readingSavedProgress = false;
function startReadingQuiz() { readingQi = 0; readingScore = 0; readingSavedProgress = false; renderReadingQuiz(); }

function renderReadingQuiz() {
    const el = document.getElementById('readingTabBody');
    const qs = readingArticle.quiz;
    if (readingQi >= qs.length) {
        el.innerHTML = `<div class="rqdone">
            <div style="font-size:44px">🎉</div>
            <h3>Hoàn thành!</h3>
            <p>Bạn trả lời đúng <b>${readingScore}/${qs.length}</b> câu.</p>
            <button onclick="startReadingQuiz()">🔄 Làm lại</button></div>`;
        // Lưu tiến bộ (chỉ 1 lần cho mỗi lượt làm)
        if (!readingSavedProgress) {
            readingSavedProgress = true;
            saveProgress('reading', readingArticle.title || 'Bài đọc', readingScore, qs.length);
        }
        return;
    }
    const q = qs[readingQi];
    readingQLock = false;
    el.innerHTML = `
        <div class="rqhead"><span class="rqtype">${escapeHtml(q.type)}</span>
            <span class="rqcount">CÂU ${readingQi + 1}/${qs.length}</span></div>
        <h3 class="rqq">${escapeHtml(q.q)}</h3>
        <div id="rqopts">${q.opts.map((o, i) => `
            <button class="ropt" data-i="${i}"><span class="L">${'ABCD'[i]}.</span>
                <span>${escapeHtml(o)}</span></button>`).join('')}
        </div>
        <div id="rqfb"></div>
        <div class="rqnext" id="rqnext" style="display:none">
            <button onclick="nextReadingQ()">${readingQi + 1 < qs.length ? 'Câu tiếp →' : 'Xem kết quả →'}</button>
        </div>`;
    el.querySelectorAll('.ropt').forEach(b =>
        b.addEventListener('click', () => answerReadingQ(+b.dataset.i)));
}

function answerReadingQ(i) {
    if (readingQLock) return;
    readingQLock = true;
    const q = readingArticle.quiz[readingQi];
    const ok = i === q.answer;
    if (ok) readingScore++;
    document.querySelectorAll('#rqopts .ropt').forEach((b, bi) => {
        b.disabled = true;
        if (bi === q.answer) b.classList.add('right');
        else if (bi === i) b.classList.add('wrong');
        else b.classList.add('dim');
    });
    document.getElementById('rqfb').innerHTML = `
        <div class="rqfb ${ok ? 'good' : ''}">
            <div class="st">${ok ? '✓ CHÍNH XÁC' : '✘ CHƯA ĐÚNG'}</div>
            <div>${escapeHtml(q.explain)}</div></div>`;
    document.getElementById('rqnext').style.display = 'flex';
}

function nextReadingQ() { readingQi++; renderReadingQuiz(); }

// ---------- Hỏi AI về bài đọc (drawer, dùng chung /api/chat) ----------
function openReadingDrawer() {
    const d = document.getElementById('readingDrawer');
    d.classList.add('open');
    const msgs = document.getElementById('readingMsgs');
    if (!msgs.children.length && readingArticle) {
        const a = readingArticle;
        msgs.insertAdjacentHTML('beforeend',
            `<div class="rmsg ai"><span class="tag">✨ AI · dựa trên bài đọc</span>
             <div>Chào bạn! Mình đã đọc xong bài <b>"${escapeHtml(a.title)}"</b>.
             Bạn cứ hỏi mình bất cứ điều gì về bài đọc này nhé!</div></div>`);
        document.getElementById('readingPromptView').textContent =
            `Bạn là gia sư tiếng Anh cho người Việt. Chỉ trả lời dựa trên BÀI ĐỌC dưới đây, bằng tiếng Việt đơn giản.\n\n` +
            `BÀI ĐỌC: "${a.title}"\n${a.paragraphs.map(p => p.en).join('\n').slice(0, 600)}...\n\n` +
            `Câu hỏi của người học: {câu hỏi}`;
        renderReadingChips();
    }
    setTimeout(() => document.getElementById('readingQInput').focus(), 350);
}

function closeReadingDrawer() {
    document.getElementById('readingDrawer').classList.remove('open');
}

function renderReadingChips() {
    const box = document.getElementById('readingChips');
    box.innerHTML = (readingArticle.suggestions || []).map(s =>
        `<button class="rchipbtn" onclick="askReadingChip(this)">${escapeHtml(s)}</button>`).join('');
}

function askReadingChip(b) {
    document.getElementById('readingQInput').value = b.textContent;
    sendReadingQ();
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeReadingDrawer();
    if (e.target && e.target.id === 'readingQInput' && e.key === 'Enter') sendReadingQ();
});

async function sendReadingQ() {
    if (readingAiStreaming || !readingArticle) return;
    const input = document.getElementById('readingQInput');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    document.getElementById('readingChips').innerHTML = '';
    readingAiStreaming = true;

    const a = readingArticle;
    const msgs = document.getElementById('readingMsgs');
    msgs.insertAdjacentHTML('beforeend',
        `<div class="rmsg user">${escapeHtml(q)}</div>`);
    const botDiv = document.createElement('div');
    botDiv.className = 'rmsg ai';
    botDiv.innerHTML = `<span class="tag">✨ AI · dựa trên bài đọc</span>
        <div class="rtyping"><span class="dots"><span></span><span></span><span></span></span> AI đang đọc bài...</div>`;
    msgs.appendChild(botDiv);
    msgs.scrollTop = msgs.scrollHeight;

    const contextMsg =
        `[Ngữ cảnh — Bài đọc "${a.title}":\n${a.paragraphs.map(p => p.en).join('\n')}\n` +
        `Bản dịch tiếng Việt:\n${a.paragraphs.map(p => p.vi).join('\n')}]\n\n` +
        `Câu hỏi của người học về bài đọc trên: ${q}\n` +
        `(Hãy trả lời dựa trên bài đọc, bằng tiếng Việt đơn giản, dễ hiểu.)`;

    let answer = '';
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: contextMsg, history: [] })
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6);
                if (data === '[DONE]') break;
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) answer = 'Lỗi: ' + parsed.error;
                    else if (parsed.content) answer += parsed.content;
                } catch {}
            }
            const body = botDiv.querySelector('.rtyping');
            if (body) {
                body.outerHTML = `<div>${renderMarkdown(answer)}</div>`;
            } else {
                botDiv.lastElementChild.innerHTML = renderMarkdown(answer);
            }
            msgs.scrollTop = msgs.scrollHeight;
        }
        if (!answer) answer = 'Xin lỗi, có lỗi xảy ra. Vui lòng thử lại.';
        const body = botDiv.querySelector('.rtyping');
        if (body) body.outerHTML = `<div>${renderMarkdown(answer)}</div>`;
    } catch (err) {
        botDiv.innerHTML = `<span class="tag">✨ AI · dựa trên bài đọc</span>
            <div>Không thể kết nối tới server: ${escapeHtml(err.message)}</div>`;
    } finally {
        readingAiStreaming = false;
        renderReadingChips();
        msgs.scrollTop = msgs.scrollHeight;
    }
}

// ============================================================
// BÀI HỌC AI (05/10/2026) — sinh bài bằng Groq, chấm tự động
// ============================================================
let lessonData = null;
let lessonExState = [];

function setLessonTopic(t) {
    document.getElementById('lessonTopicInput').value = t;
    document.getElementById('lessonTopicInput').focus();
}

async function generateLesson() {
    const input = document.getElementById('lessonTopicInput');
    const topic = (input.value || '').trim();
    if (!topic) { input.focus(); return; }
    const btn = document.getElementById('lessonGenBtn');
    const loading = document.getElementById('lessonLoading');
    const view = document.getElementById('lessonView');
    btn.disabled = true;
    loading.style.display = 'flex';
    view.style.display = 'none';
    try {
        const r = await fetch('/api/generate-lesson', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic })
        });
        const d = await r.json();
        if (d.error || !d.lesson) {
            loading.innerHTML = `<p style="color:#f87171">${escapeHtml(d.error || 'Lỗi không rõ')}</p>`;
            return;
        }
        lessonData = d.lesson;
        lessonExState = (lessonData.exercises || []).map(() => ({ done: false, correct: false }));
        renderLesson();
    } catch (e) {
        loading.innerHTML = `<p style="color:#f87171">Lỗi: ${escapeHtml(e.message)}</p>`;
    } finally {
        btn.disabled = false;
        if (lessonData) loading.style.display = 'none';
    }
}

function renderLesson() {
    const L = lessonData;
    const view = document.getElementById('lessonView');
    document.getElementById('lessonGenView').style.display = 'none';
    view.style.display = 'block';

    const vocabHtml = (L.vocabulary || []).map((v, i) => `
        <div class="ls-vocab-card">
            <div class="ls-vocab-top">
                <span class="ls-vocab-word" onclick="showTip(this, '${escapeHtml(v.word)}', '${escapeHtml(v.word.toLowerCase())}')">${escapeHtml(v.word)}</span>
                <button class="tip-icon-btn" onclick="playAudio('${escapeHtml(v.word.toLowerCase())}','us')" title="Nghe"><i class="ri-volume-up-line"></i></button>
            </div>
            ${v.pronunciation ? `<div class="ls-vocab-ipa">/${escapeHtml(v.pronunciation.replace(/^\/|\/$/g, ''))}/</div>` : ''}
            <div class="ls-vocab-vi">${escapeHtml(v.vietnamese_meaning || v.english_meaning || '')}</div>
            ${v.example ? `<div class="ls-vocab-ex">${escapeHtml(v.example)}</div>` : ''}
        </div>`).join('');

    const exHtml = (L.example_sentences || []).map(e => `
        <div class="ls-ex"><div class="ls-ex-en">${escapeHtml(e.english)}</div>
        <div class="ls-ex-vi">${escapeHtml(e.translation)}</div></div>`).join('');

    const convHtml = (L.conversation || []).map(m => `
        <div class="ls-conv ${m.speaker === 'A' ? 'a' : 'b'}">
            <span class="ls-spk">${escapeHtml(m.speaker)}</span>
            <div><div class="ls-conv-en">${escapeHtml(m.text)}</div>
            ${m.translation ? `<div class="ls-conv-vi">${escapeHtml(m.translation)}</div>` : ''}</div>
        </div>`).join('');

    const exsHtml = (L.exercises || []).map((ex, i) => renderExercise(ex, i)).join('');

    view.innerHTML = `
        <button class="reading-back" onclick="backToLessonGen()"><i class="ri-arrow-left-line"></i> Chủ đề khác</button>
        <h2 class="ls-title"><i class="ri-sparkles-line"></i> ${escapeHtml(L.topic)}</h2>
        <div class="ls-sec"><h3><i class="ri-book-2-line"></i> Từ vựng (${(L.vocabulary || []).length})</h3>
            <div class="ls-vocab-grid">${vocabHtml}</div></div>
        <div class="ls-sec"><h3><i class="ri-chat-quote-line"></i> Câu ví dụ</h3>${exHtml}</div>
        <div class="ls-sec"><h3><i class="ri-question-answer-line"></i> Hội thoại</h3>
            <div class="ls-conv-list">${convHtml}</div></div>
        <div class="ls-sec"><h3><i class="ri-edit-2-line"></i> Bài tập (<span id="lsExDone">0</span>/${(L.exercises || []).length})</h3>
            <div id="lsExercises">${exsHtml}</div>
            <div id="lsResult"></div></div>`;
    view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function backToLessonGen() {
    document.getElementById('lessonView').style.display = 'none';
    const gv = document.getElementById('lessonGenView');
    gv.style.display = 'block';
    document.getElementById('lessonLoading').style.display = 'none';
    document.getElementById('lessonLoading').innerHTML = '<div class="spinner-sm" style="width:28px;height:28px"></div><p>AI đang soạn bài học, chờ chút nhé...</p>';
    lessonData = null;
}

function renderExercise(ex, i) {
    if (ex.type === 'fill_in_blank') {
        return `<div class="ls-excard" id="lsEx${i}">
            <div class="ls-ex-q"><b>Câu ${i + 1}.</b> ${escapeHtml(ex.question)}</div>
            <div class="ls-opts">${ex.options.map((o, oi) =>
                `<button class="ropt" onclick="answerFillBlank(${i},${oi},this)"><span class="L">${'ABCD'[oi]}.</span><span>${escapeHtml(o)}</span></button>`
            ).join('')}</div>
            <div class="ls-ex-fb" id="lsFb${i}"></div></div>`;
    }
    if (ex.type === 'sentence_order') {
        const words = [...ex.scrambled].sort(() => Math.random() - 0.5);
        return `<div class="ls-excard" id="lsEx${i}">
            <div class="ls-ex-q"><b>Câu ${i + 1}.</b> Sắp xếp thành câu đúng:</div>
            <div class="ls-answer-line" id="lsAns${i}"><span class="ls-ph">Bấm các từ theo thứ tự...</span></div>
            <div class="ls-chips" id="lsChips${i}">${words.map((w, wi) =>
                `<button class="ls-chip" data-w="${escapeHtml(w)}" onclick="pickChip(${i},this)">${escapeHtml(w)}</button>`
            ).join('')}</div>
            <div class="ls-ex-actions">
                <button onclick="clearChips(${i})">Xóa</button>
                <button class="primary" onclick="checkOrder(${i})">Kiểm tra</button>
            </div>
            <div class="ls-ex-fb" id="lsFb${i}"></div></div>`;
    }
    // make_sentence
    return `<div class="ls-excard" id="lsEx${i}">
        <div class="ls-ex-q"><b>Câu ${i + 1}.</b> Đặt câu với từ: <b class="ls-word-hl">${escapeHtml(ex.word)}</b></div>
        <textarea class="ls-textarea" id="lsTa${i}" rows="2" placeholder="Viết câu của bạn..."></textarea>
        <div class="ls-ex-actions"><button class="primary" id="lsGradeBtn${i}" onclick="gradeMakeSentence(${i})">AI chấm câu này</button></div>
        <div class="ls-ex-fb" id="lsFb${i}"></div></div>`;
}

function markExDone(i, correct) {
    const st = lessonExState[i];
    if (st.done) return;
    st.done = true; st.correct = !!correct;
    const doneCount = lessonExState.filter(s => s.done).length;
    document.getElementById('lsExDone').textContent = doneCount;
    if (doneCount === lessonExState.length) showLessonResult();
}

function answerFillBlank(i, oi, btn) {
    const ex = lessonData.exercises[i];
    const card = document.getElementById(`lsEx${i}`);
    const ok = ex.options[oi] === ex.answer;
    card.querySelectorAll('.ropt').forEach((b, bi) => {
        b.disabled = true;
        if (ex.options[bi] === ex.answer) b.classList.add('right');
        else if (bi === oi) b.classList.add('wrong');
        else b.classList.add('dim');
    });
    document.getElementById(`lsFb${i}`).innerHTML =
        `<div class="rqfb ${ok ? 'good' : ''}"><div class="st">${ok ? '✓ CHÍNH XÁC' : '✘ CHƯA ĐÚNG'}</div></div>`;
    markExDone(i, ok);
}

function pickChip(i, btn) {
    if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('picked');
    const line = document.getElementById(`lsAns${i}`);
    const ph = line.querySelector('.ls-ph'); if (ph) ph.remove();
    const s = document.createElement('span');
    s.className = 'ls-picked'; s.textContent = btn.dataset.w; s.dataset.w = btn.dataset.w;
    s.onclick = () => { s.remove(); btn.disabled = false; btn.classList.remove('picked');
        if (!line.querySelector('.ls-picked')) line.innerHTML = '<span class="ls-ph">Bấm các từ theo thứ tự...</span>'; };
    line.appendChild(s); line.appendChild(document.createTextNode(' '));
}

function clearChips(i) {
    document.getElementById(`lsAns${i}`).innerHTML = '<span class="ls-ph">Bấm các từ theo thứ tự...</span>';
    document.querySelectorAll(`#lsChips${i} .ls-chip`).forEach(b => { b.disabled = false; b.classList.remove('picked'); });
}

function normSent(s) { return s.toLowerCase().replace(/[.,?!;:'"()]/g, '').replace(/\s+/g, ' ').trim(); }

function checkOrder(i) {
    const ex = lessonData.exercises[i];
    const got = [...document.querySelectorAll(`#lsAns${i} .ls-picked`)].map(e => e.dataset.w).join(' ');
    const ok = normSent(got) === normSent(ex.answer);
    document.getElementById(`lsFb${i}`).innerHTML =
        `<div class="rqfb ${ok ? 'good' : ''}"><div class="st">${ok ? '✓ CHÍNH XÁC' : '✘ CHƯA ĐÚNG'}</div>` +
        (ok ? '' : `<div>Đáp án: ${escapeHtml(ex.answer)}</div>`) + `</div>`;
    document.querySelectorAll(`#lsChips${i} .ls-chip`).forEach(b => b.disabled = true);
    markExDone(i, ok);
}

async function gradeMakeSentence(i) {
    const ex = lessonData.exercises[i];
    const ta = document.getElementById(`lsTa${i}`);
    const sentence = (ta.value || '').trim();
    if (!sentence) { ta.focus(); return; }
    const btn = document.getElementById(`lsGradeBtn${i}`);
    const fb = document.getElementById(`lsFb${i}`);
    btn.disabled = true; btn.textContent = 'Đang chấm...';
    try {
        const r = await fetch('/api/grade-sentence', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word: ex.word, sentence })
        });
        const d = await r.json();
        if (d.error) { fb.innerHTML = `<div class="rqfb"><div>${escapeHtml(d.error)}</div></div>`; return; }
        const ok = d.score >= 6;
        fb.innerHTML = `<div class="rqfb ${ok ? 'good' : ''}">
            <div class="st">${ok ? '✓' : '✘'} ${d.score}/10</div>
            <div>${escapeHtml(d.feedback_vi || '')}</div>
            ${d.corrected && normSent(d.corrected) !== normSent(sentence) ? `<div><b>Gợi ý:</b> ${escapeHtml(d.corrected)}</div>` : ''}
        </div>`;
        markExDone(i, ok);
    } catch (e) {
        fb.innerHTML = `<div class="rqfb"><div>Lỗi: ${escapeHtml(e.message)}</div></div>`;
    } finally {
        btn.disabled = false; btn.textContent = 'AI chấm câu này';
    }
}

function showLessonResult() {
    const total = lessonExState.length;
    const correct = lessonExState.filter(s => s.correct).length;
    document.getElementById('lsResult').innerHTML = `<div class="rqdone">
        <div style="font-size:44px">🎉</div><h3>Hoàn thành!</h3>
        <p>Bạn làm đúng <b>${correct}/${total}</b> bài tập.</p></div>`;
    saveProgress('lesson', lessonData.topic || 'Bài học AI', correct, total);
    document.getElementById('lsResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================
// NGỮ PHÁP (09/10/2026) — cây 40 chủ đề A1-B2 → bài học AI theo schema
// chuẩn (quy tắc → ví dụ song ngữ → lỗi hay mắc → quiz chẩn đoán gắn
// loại lỗi → luyện 3 cấp độ) + nút "Hỏi chatbot" → tab Chat với banner
// giới hạn chủ đề (ngữ cảnh gắn trong message, pattern như drawer bài đọc).
// ============================================================
let grammarTopicsCache = null;
let grammarLesson = null;
let chatGrammarTopic = null; // {id, title, ctx}
const G_ETYPE = { form: 'sai form', meaning: 'sai nghĩa/cách dùng', signal: 'sai dấu hiệu' };

function switchLessonTab(which) {
    document.getElementById('lsubVocab').classList.toggle('active', which === 'vocab');
    document.getElementById('lsubGrammar').classList.toggle('active', which === 'grammar');
    document.getElementById('lessonVocabWrap').style.display = which === 'vocab' ? '' : 'none';
    document.getElementById('lessonGrammarWrap').style.display = which === 'grammar' ? '' : 'none';
    // 12/10/2026: tab Ngữ pháp full-width (demo đã duyệt)
    document.querySelector('.lesson-wrap').classList.toggle('wide', which === 'grammar');
    if (which === 'grammar') loadGrammarTopics();
}

async function loadGrammarTopics() {
    const box = document.getElementById('grammarTopics');
    if (grammarTopicsCache) { renderGrammarTopics(); return; }
    box.innerHTML = '<p style="color:var(--muted)">Đang tải danh sách chủ đề...</p>';
    try {
        const r = await fetch('/api/grammar-topics', { headers: authHeaders() });
        const d = await r.json();
        grammarTopicsCache = d.topics || [];
        renderGrammarTopics();
    } catch (e) { box.innerHTML = '<p>Không tải được danh sách chủ đề.</p>'; }
}

function renderGrammarTopics() {
    const box = document.getElementById('grammarTopics');
    document.getElementById('grammarView').style.display = 'none';
    box.style.display = '';
    // 09/10/2026: level đọc động từ data (hiện A1-C2), không cứng A1-B2
    const LV_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const levels = LV_ORDER.filter(lv => (grammarTopicsCache || []).some(t => t.level === lv));
    let h = '';
    levels.forEach(lv => {
        const ts = (grammarTopicsCache || []).filter(t => t.level === lv);
        if (!ts.length) return;
        h += `<h3 class="glevel"><span class="badge lv-${lv}">${lv}</span> ${ts.length} chủ đề</h3><div class="gtgrid">`;
        ts.forEach(t => {
            h += `<button class="gtcard" onclick="openGrammarTopic('${t.id}')"><b>${escapeHtml(t.title)}</b><span>${escapeHtml(t.desc || t.en || '')}</span></button>`;
        });
        h += '</div>';
    });
    box.innerHTML = h || '<p>Chưa có chủ đề.</p>';
}

async function openGrammarTopic(id) {
    const loading = document.getElementById('grammarLoading');
    const view = document.getElementById('grammarView');
    document.getElementById('grammarTopics').style.display = 'none';
    view.style.display = 'none'; loading.style.display = '';
    try {
        const r = await fetch('/api/generate-grammar-lesson', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({ topic_id: id })
        });
        const d = await r.json();
        loading.style.display = 'none';
        if (d.error || !d.lesson) {
            // 10/10/2026: lỗi hiện gọn + nút Thử lại, không đổ raw error ra màn hình
            view.style.display = '';
            view.innerHTML = `<button class="mini" onclick="renderGrammarTopics()">← Chủ đề ngữ pháp</button>
                <div style="margin-top:16px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--panel)">
                <p style="margin:0 0 12px">${escapeHtml(d.error || 'Lỗi')}</p>
                <button class="mini" onclick="openGrammarTopic('${id}')">Thử lại</button></div>`;
            return;
        }
        grammarLesson = d.lesson;
        gQuizScore = { c: 0, t: 0 };
        renderGrammarLesson(d.lesson, !!d.cached);
    } catch (e) {
        loading.style.display = 'none'; view.style.display = '';
        view.innerHTML = `<button class="mini" onclick="renderGrammarTopics()">← Chủ đề ngữ pháp</button>
            <div style="margin-top:16px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--panel)">
            <p style="margin:0 0 12px">Lỗi kết nối.</p>
            <button class="mini" onclick="openGrammarTopic('${id}')">Thử lại</button></div>`;
    }
}

function gEx(e) {
    return `<div class="gex"><div class="en">${escapeHtml(e.en || '')}</div><div class="vi">${escapeHtml(e.vi || '')}</div>${e.context ? `<div class="ctx">${escapeHtml(e.context)}</div>` : ''}</div>`;
}
function gTable(t) {
    if (!t || !t.headers || !t.headers.length) return '';
    let h = '<table class="gtable"><tr>' + t.headers.map(x => `<th>${escapeHtml(x)}</th>`).join('') + '</tr>';
    (t.rows || []).forEach(r => { h += '<tr>' + r.map(x => `<td>${escapeHtml(x)}</td>`).join('') + '</tr>'; });
    return h + '</table>';
}

function renderGrammarLesson(L, cached) {
    const view = document.getElementById('grammarView');
    view.style.display = '';
    let h = `<button class="mini" onclick="renderGrammarTopics()">← Chủ đề ngữ pháp</button>`;
    h += `<div class="ghero"><span class="badge">${escapeHtml(L.level || '')}</span> <span class="badge">Ngữ pháp</span>
        ${cached ? '<span class="badge" title="Bài đã lưu, không tốn AI">đã lưu</span>' : ''}
        <h1>${escapeHtml(L.topic || '')}</h1>${L.intro ? `<p>${escapeHtml(L.intro)}</p>` : ''}
        <button class="btn-askbot" onclick="askGrammarChatbot()"><i class="ri-chat-3-line"></i> Hỏi chatbot</button></div>`;
    const sec = (id, icon, title, inner) => inner ? `<div class="gsec" id="${id}"><h2><i class="${icon}"></i>${title}</h2>${inner}</div>` : '';

    if ((L.when_to_use || []).length) {
        h += sec('g-use', 'ri-lightbulb-line', 'Dùng khi nào',
            L.when_to_use.map(c => `<div class="gcase"><b>${escapeHtml(c.case)}</b>${(c.examples || []).map(gEx).join('')}</div>`).join(''));
    }
    h += sec('g-form', 'ri-table-line', 'Công thức', gTable(L.formula_table));
    if ((L.rules || []).length) {
        h += sec('g-rules', 'ri-list-check-2', 'Quy tắc',
            L.rules.map((r, i) => `<div class="grule"><h3>${escapeHtml(r.title)}</h3>${r.explain ? `<p>${escapeHtml(r.explain)}</p>` : ''}${r.formula ? `<div class="gformula">${escapeHtml(r.formula)}</div>` : ''}${(r.examples || []).map(gEx).join('')}</div>`).join(''));
    }
    if ((L.context_examples || []).length)
        h += sec('g-ctx', 'ri-chat-quote-line', 'Ví dụ có bối cảnh', L.context_examples.map(gEx).join(''));
    if ((L.signals || []).length)
        h += sec('g-sign', 'ri-radar-line', 'Dấu hiệu nhận biết',
            `<ul class="gtight">${L.signals.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`);
    if ((L.common_mistakes || []).length) {
        h += sec('g-err', 'ri-error-warning-line', 'Lỗi hay mắc',
            L.common_mistakes.map(m => `<div class="gmist"><div class="row wrong"><span class="tag">Sai</span><span>${escapeHtml(m.wrong)}</span></div><div class="row right"><span class="tag">Đúng</span><span>${escapeHtml(m.correct)}</span></div><div class="row why">Vì sao: ${escapeHtml(m.why)}</div></div>`).join(''));
    }
    if ((L.self_check || []).length)
        h += sec('g-check', 'ri-checkbox-circle-line', 'Cách tự kiểm',
            `<ul class="gtight">${L.self_check.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`);
    if (L.contrast && L.contrast.with)
        h += sec('g-vs', 'ri-scales-3-line', `Phân biệt với ${escapeHtml(L.contrast.with)}`, gTable(L.contrast.table));
    if ((L.quick_ref || []).length)
        h += sec('g-mem', 'ri-brain-line', 'Ghi nhớ nhanh',
            `<ul class="gtight">${L.quick_ref.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
             <div style="margin-top:12px"><button class="btn-askbot" onclick="askGrammarChatbot()"><i class="ri-chat-3-line"></i> Hỏi chatbot về bài này</button></div>`);

    // --- Quiz chẩn đoán ---
    if ((L.diagnostic || []).length) {
        h += `<h3 class="gblock">Quiz chẩn đoán <span class="gsub">(${(L.diagnostic || []).length} câu — biết ngay mình yếu loại lỗi nào)</span></h3><div id="gQuiz">`;
        L.diagnostic.forEach((q, i) => {
            h += `<div class="gq" id="gq${i}"><div class="qq">Câu ${i + 1}. ${escapeHtml(q.question)}</div>`;
            if (q.type === 'mcq') {
                (q.options || []).forEach(o => {
                    h += `<button class="gopt" data-q="${i}" data-o="${escapeHtml(o)}">${escapeHtml(o)}</button>`;
                });
            } else {
                h += `<div class="gfillrow"><input id="gqi${i}" placeholder="${q.type === 'error' ? 'Viết câu đúng...' : 'Điền đáp án...'}"><button class="mini" onclick="gCheckFill(${i})">Kiểm tra</button></div>`;
            }
            h += `<div class="gfb" id="gqf${i}"></div></div>`;
        });
        h += '</div>';
    }
    // --- Luyện 3 cấp độ ---
    const lvName = { practice_l1: ['Luyện cấp 1', 'điền từ có gợi ý'], practice_l2: ['Luyện cấp 2', 'điền từ tự do'], practice_l3: ['Luyện cấp 3', 'viết lại câu + giải thích'] };
    ['practice_l1', 'practice_l2', 'practice_l3'].forEach((key, li) => {
        const arr = L[key] || [];
        if (!arr.length) return;
        h += `<h3 class="gblock">${lvName[key][0]} <span class="gsub">(${lvName[key][1]})</span></h3><div id="g${key}">`;
        arr.forEach((it, i) => {
            const gid = `g${li + 1}_${i}`;
            h += `<div class="gq" id="g${gid}"><div class="qq">${i + 1}. ${escapeHtml(it.question || it.task)}</div>`;
            if (key === 'practice_l3') {
                h += `<textarea id="gqi_${gid}" placeholder="Viết câu của bạn..."></textarea><div class="gfillrow"><button class="mini" onclick="gShowL3('${gid}',${i})">Xem đáp án mẫu</button></div><div class="gans" id="gqf_${gid}"></div>`;
            } else {
                if (it.bank) h += `<div class="gbank">${it.bank.map(b => `<button data-b="${escapeHtml(b)}">${escapeHtml(b)}</button>`).join('')}</div>`;
                h += `<div class="gfillrow"><input id="gqi_${gid}" placeholder="Đáp án..."><button class="mini" onclick="gCheckP('${key}',${i},'${gid}')">Kiểm tra</button></div><div style="font-size:13px;color:var(--muted);margin-top:6px">Gợi ý: ${escapeHtml(it.hint_vi || '')}</div><div class="gfb" id="gqf_${gid}"></div>`;
            }
            h += '</div>';
        });
        h += '</div>';
    });
    view.innerHTML = h;
    view.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // MCQ click (event delegation trên view)
    view.onclick = e => {
        const b = e.target.closest('.gopt');
        if (b && !b.disabled) {
            const i = +b.dataset.q, q = grammarLesson.diagnostic[i];
            const ok = b.dataset.o === q.answer;
            b.closest('.gq').querySelectorAll('.gopt').forEach(x => {
                x.disabled = true;
                if (x.dataset.o === q.answer) x.classList.add('ok');
            });
            if (!ok) b.classList.add('bad');
            gShowFb(i, q, ok);
        }
        const bb = e.target.closest('.gbank button');
        if (bb) {
            bb.closest('.gq').querySelector('input').value = bb.dataset.b;
            bb.classList.add('used');
        }
    };
}
function gNorm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.?!]$/, ''); }
function gShowFb(i, q, ok, extra) {
    const f = document.getElementById('gqf' + i);
    f.innerHTML = (ok ? '<b class="gok">Đúng!</b> ' : '<b class="gbad">Chưa đúng.</b> ') +
        `<span class="getype">loại lỗi: ${G_ETYPE[q.error_type] || q.error_type || ''}</span><br>${escapeHtml(q.explain_vi || '')}` +
        (extra || '');
    f.classList.add('show');
    if (ok && !f.dataset.done) { f.dataset.done = 1; gQuizScore.c++; }
    gQuizScore.t++; gSaveQuizProgress();
}
let gQuizScore = { c: 0, t: 0 };
function gSaveQuizProgress() {
    if (grammarLesson && gQuizScore.t > 0)
        saveProgress('grammar', grammarLesson.topic, gQuizScore.c, gQuizScore.t);
}
function gCheckFill(i) {
    const q = grammarLesson.diagnostic[i];
    const v = document.getElementById('gqi' + i).value;
    const ok = gNorm(v) === gNorm(q.answer);
    const f = document.getElementById('gqf' + i);
    f.innerHTML = (ok ? '<b class="gok">Đúng!</b> ' : '<b class="gbad">Chưa đúng.</b> ') +
        `<span class="getype">loại lỗi: ${G_ETYPE[q.error_type] || ''}</span><br>${escapeHtml(q.explain_vi || '')}` +
        (ok ? '' : `<br>Đáp án: <b>${escapeHtml(q.answer)}</b>`);
    f.classList.add('show');
    if (ok && !f.dataset.done) { f.dataset.done = 1; gQuizScore.c++; }
    gQuizScore.t++; gSaveQuizProgress();
}
function gCheckP(key, i, gid) {
    const it = grammarLesson[key][i];
    const v = document.getElementById('gqi_' + gid).value;
    const ans = Array.isArray(it.answer) ? it.answer : [it.answer];
    const ok = ans.some(a => gNorm(a) === gNorm(v));
    const f = document.getElementById('gqf_' + gid);
    f.innerHTML = (ok ? '<b class="gok">Đúng!</b> ' : '<b class="gbad">Chưa đúng.</b> ') +
        (ok ? '' : `Đáp án: <b>${escapeHtml(ans[0])}</b><br>`) +
        `<span style="color:var(--muted)">${escapeHtml(it.hint_vi || '')}</span>`;
    f.classList.add('show');
}
function gShowL3(gid, i) {
    const it = grammarLesson.practice_l3[i];
    const f = document.getElementById('gqf_' + gid);
    f.innerHTML = `<b>Đáp án mẫu:</b> ${escapeHtml(it.answer)}<br><span style="color:var(--muted)">Vì sao: ${escapeHtml(it.why_vi || '')}</span>`;
    f.classList.add('show');
}

// ---------- Hỏi chatbot về bài ngữ pháp (09/10/2026) ----------
function askGrammarChatbot() {
    if (!grammarLesson) return;
    const L = grammarLesson;
    const ctx = (`Chủ đề: ${L.topic} (${L.level}). ` +
        `Ghi nhớ: ${(L.quick_ref || []).join(' | ')}. ` +
        `Quy tắc chính: ${(L.rules || []).map(r => r.title).join(' | ')}`).slice(0, 900);
    chatGrammarTopic = { id: L.id, title: L.topic, ctx };
    renderGrammarBanner();
    switchTab('chat');
}
function renderGrammarBanner() {
    const b = document.getElementById('grammarBanner');
    if (chatGrammarTopic) {
        document.getElementById('grammarBannerTitle').textContent = chatGrammarTopic.title;
        b.style.display = '';
    } else b.style.display = 'none';
}
function exitGrammarMode() { chatGrammarTopic = null; renderGrammarBanner(); }


// ============================================================
// TIẾN BỘ (05/10/2026) — lưu điểm quiz/bài tập vào localStorage,
// thống kê đơn giản, không tốn API
// ============================================================
function getProgress() {
    try { return JSON.parse(localStorage.getItem('progressStats') || '[]'); }
    catch (e) { return []; }
}

function saveProgress(kind, title, score, total) {
    const arr = getProgress();
    arr.push({ date: new Date().toISOString(), kind, title: String(title).slice(0, 60), score, total });
    if (arr.length > 200) arr.splice(0, arr.length - 200);
    localStorage.setItem('progressStats', JSON.stringify(arr));
}

function renderProgress() {
    const el = document.getElementById('progressBody');
    const arr = getProgress();
    if (!arr.length) {
        el.innerHTML = `<div class="pg-empty"><i class="ri-line-chart-line"></i>
            <p>Chưa có dữ liệu. Làm quiz trong <b>Bài đọc</b> hoặc bài tập trong <b>Bài học AI</b> để bắt đầu theo dõi tiến bộ.</p></div>`;
        return;
    }
    const total = arr.length;
    const avg = arr.reduce((s, r) => s + (r.total ? r.score / r.total : 0), 0) / total * 100;
    const byKind = {};
    arr.forEach(r => {
        byKind[r.kind] = byKind[r.kind] || { n: 0, s: 0 };
        byKind[r.kind].n++; byKind[r.kind].s += r.total ? r.score / r.total : 0;
    });
    // 7 ngày gần nhất
    const days = [];
    for (let d = 6; d >= 0; d--) {
        const dt = new Date(); dt.setDate(dt.getDate() - d);
        days.push(dt.toISOString().slice(0, 10));
    }
    const dayAvg = days.map(day => {
        const rs = arr.filter(r => r.date.slice(0, 10) === day && r.total);
        if (!rs.length) return null;
        return rs.reduce((s, r) => s + r.score / r.total, 0) / rs.length * 100;
    });
    const maxV = Math.max(...dayAvg.filter(v => v !== null), 1);
    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const bars = days.map((day, i) => {
        const v = dayAvg[i];
        const dt = new Date(day);
        return `<div class="pg-bar-col"><div class="pg-bar" style="height:${v === null ? 4 : Math.max(8, v / maxV * 120)}px;${v === null ? 'background:var(--border)' : ''}"></div>
            <span>${dayNames[dt.getDay()]}</span>${v !== null ? `<b>${Math.round(v)}%</b>` : ''}</div>`;
    }).join('');

    const recent = [...arr].reverse().slice(0, 8).map(r => {
        const pct = r.total ? Math.round(r.score / r.total * 100) : 0;
        const dt = new Date(r.date);
        const when = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
        const kindName = r.kind === 'reading' ? 'Bài đọc' : 'Bài học AI';
        return `<div class="pg-row"><span class="pg-kind">${kindName}</span>
            <span class="pg-title">${escapeHtml(r.title)}</span>
            <span class="pg-score ${pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'bad'}">${r.score}/${r.total}</span>
            <span class="pg-date">${when}</span></div>`;
    }).join('');

    el.innerHTML = `
        <div class="pg-cards">
            <div class="pg-card"><div class="pg-num">${total}</div><div class="pg-label">Bài đã làm</div></div>
            <div class="pg-card"><div class="pg-num">${Math.round(avg)}%</div><div class="pg-label">Điểm trung bình</div></div>
            ${Object.entries(byKind).map(([k, v]) =>
                `<div class="pg-card"><div class="pg-num">${Math.round(v.s / v.n * 100)}%</div>
                 <div class="pg-label">${k === 'reading' ? 'Bài đọc' : 'Bài học AI'} (${v.n})</div></div>`).join('')}
        </div>
        <h3 class="pg-sec-t"><i class="ri-bar-chart-line"></i> 7 ngày gần nhất</h3>
        <div class="pg-chart">${bars}</div>
        <h3 class="pg-sec-t"><i class="ri-history-line"></i> Gần đây</h3>
        <div class="pg-list">${recent}</div>
        <button class="pg-clear" onclick="if(confirm('Xóa hết lịch sử tiến bộ?')){localStorage.removeItem('progressStats');renderProgress();}">Xóa lịch sử</button>`;
}

// ============================================================

// ============================================================
// TÀI LIỆU ĐÍNH KÈM TRONG CHAT (08/10/2026) — kiểu NotebookLM/ChatGPT.
// Nút 📎 trong khung chat -> popup chọn/tải/xóa file -> chip hiện trong composer.
// Tin nhắn gửi kèm doc_id -> /api/chat trả lời dựa trên nội dung file.
// Backend giữ nguyên (section DOCS trong main.py).
// ============================================================
let chatDocId = null;
let chatDocName = '';

function toggleDocsPopup(e) {
    if (e) e.stopPropagation();
    // Tài liệu gắn theo tài khoản -> cần đăng nhập; chat thường vẫn tự do
    if (!isLoggedIn()) { showAuthModal('login'); return; }
    const pop = document.getElementById('docsPopup');
    if (!pop) return;
    const willShow = pop.style.display === 'none';
    pop.style.display = willShow ? 'block' : 'none';
    if (willShow) {
        loadDocsPopupList();
        const input = document.getElementById('docsFileInput');
        if (input && !input.dataset.bound) {
            input.dataset.bound = '1';
            input.addEventListener('change', () => {
                if (input.files && input.files[0]) uploadDocFile(input.files[0]);
                input.value = '';
            });
        }
    }
}

// Đóng popup khi bấm ra ngoài
document.addEventListener('click', function(e) {
    const pop = document.getElementById('docsPopup');
    if (pop && pop.style.display !== 'none' &&
        !pop.contains(e.target) && !e.target.closest('.attach-btn')) {
        pop.style.display = 'none';
    }
});

async function loadDocsPopupList() {
    const box = document.getElementById('docsPopupList');
    if (!box) return;
    box.innerHTML = '<div class="docs-empty">Đang tải...</div>';
    try {
        const res = await fetch('/api/docs', { headers: authHeaders() });
        if (res.status === 401) { showAuthModal('login'); return; }
        const data = await res.json();
        const docs = data.docs || [];
        if (!docs.length) {
            box.innerHTML = '<div class="docs-empty">Chưa có tài liệu nào.<br>Tải file lên để bắt đầu.</div>';
            return;
        }
        box.innerHTML = docs.map(d => `
            <div class="docs-item${d.id === chatDocId ? ' selected' : ''}">
                <div class="docs-item-main" onclick="selectChatDoc(${d.id}, ${JSON.stringify(d.filename).replace(/</g, '\\u003c')})">
                    <div class="docs-item-name"><i class="ri-file-text-line"></i> ${escapeHtml(d.filename)}</div>
                    <div class="docs-item-meta">${d.chunks} đoạn</div>
                </div>
                <button class="docs-del" title="Xóa" onclick="event.stopPropagation();deleteDoc(${d.id})"><i class="ri-delete-bin-line"></i></button>
            </div>`).join('');
    } catch (e) {
        box.innerHTML = '<div class="docs-empty">Không tải được danh sách.</div>';
    }
}

function selectChatDoc(id, name) {
    chatDocId = id;
    chatDocName = name;
    updateDocChip();
    const pop = document.getElementById('docsPopup');
    if (pop) pop.style.display = 'none';
    loadDocsPopupList();
}

function clearChatDoc() {
    chatDocId = null;
    chatDocName = '';
    updateDocChip();
}

function updateDocChip() {
    const show = !!chatDocId;
    [['docChip', 'docChipName'], ['docChipBottom', 'docChipNameBottom']].forEach(([c, n]) => {
        const chip = document.getElementById(c);
        const label = document.getElementById(n);
        if (chip) chip.style.display = show ? 'flex' : 'none';
        if (label) label.textContent = chatDocName;
    });
}

async function uploadDocFile(file) {
    try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/docs/upload', {
            method: 'POST',
            headers: authHeaders(),
            body: fd
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.detail || 'Tải file thất bại.');
            return;
        }
        chatDocId = data.id;
        chatDocName = data.filename || file.name;
        updateDocChip();
        const pop = document.getElementById('docsPopup');
        if (pop) pop.style.display = 'none';
    } catch (e) {
        alert('Không kết nối được tới server.');
    }
}

async function deleteDoc(id) {
    if (!confirm('Xóa tài liệu này?')) return;
    try {
        const res = await fetch('/api/docs/' + id, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (!res.ok) { alert('Xóa thất bại.'); return; }
        if (chatDocId === id) clearChatDoc();
        loadDocsPopupList();
    } catch (e) {
        alert('Không kết nối được tới server.');
    }
}

// ============================================================
// NẠP SÂU GHI NHỚ (08/10/2026): hiện luôn từ + nghĩa + ví dụ tiếng Việt,
// chấm 3 mức: 1 Bỏ qua / 2 Học / 3 Biết rồi. Tái dùng flashDeck + flashGrades
// nên "Học lại từ chưa thuộc" (reviewUnknown) vẫn hoạt động.
// ============================================================
let deepIdx = 0;
let deepStats = { learn: 0, known: 0, skip: 0 };

function startDeepLearn() {
    hideLearnModal();
    if (!flashDeck.length) return;
    deepIdx = 0;
    deepStats = { learn: 0, known: 0, skip: 0 };
    flashGrades = {};
    document.getElementById('flashEmpty').style.display = 'none';
    document.getElementById('flashSummary').style.display = 'none';
    document.getElementById('flashDeck').style.display = 'none';
    document.getElementById('flashBrowse').style.display = 'none';
    hideOxfordDetailSilent();
    document.getElementById('deepWrap').style.display = '';
    document.getElementById('deepSummary').style.display = 'none';
    document.addEventListener('keydown', deepKeyHandler);
    renderDeepCard();
}

function deepBackToBrowse() {
    document.removeEventListener('keydown', deepKeyHandler);
    document.getElementById('deepWrap').style.display = 'none';
    showBrowse();
}

function deepKeyHandler(e) {
    if (document.getElementById('deepWrap').style.display === 'none') return;
    if (document.getElementById('deepSummary').style.display !== 'none') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === '1') deepGrade('skip');
    else if (e.key === '2') deepGrade('learn');
    else if (e.key === '3') deepGrade('known');
}

function speakDeepWord() {
    const card = flashDeck[deepIdx];
    if (card) playAudio(card.lemma || card.word, 'us');
}

// Lấy đủ dữ liệu cho 1 thẻ: nghĩa Việt + IPA (/api/word, local nhanh),
// ví dụ song ngữ ưu tiên: presetExample (có sẵn từ server, gồm Tatoeba) >
// Tatoeba local (tức thì). Free Dictionary (API ngoài, chậm) CHỈ chạy nền
// bổ sung định nghĩa tiếng Anh — không bao giờ chặn hiển thị thẻ (10/10/2026).
async function ensureDeepData(card) {
    const key = (card.lemma || card.word || '').toLowerCase();
    if (!card.detailLoaded) {
        card.detailLoaded = true;
        try {
            const res = await fetch('/api/word', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word: card.lemma || card.word, lemma: card.lemma || card.word }),
            });
            const data = await res.json();
            if (data.found) {
                card.ipa = data.ipa || card.ipa;
                if (data.meanings && data.meanings.length) card.meanings = data.meanings;
            }
        } catch (e) { /* giữ fallback */ }
    }
    let exEn = null, exVi = null;
    if (card.presetExample) {
        exEn = card.presetExample.en || null;
        exVi = card.presetExample.vi || null;
    } else if (key) {
        // Thẻ từ đã lưu: lấy Tatoeba local (tức thì, song ngữ)
        try {
            const t = await fetch('/api/example-sentences?word=' + encodeURIComponent(key) + '&count=1').then(r => r.json());
            if (t && t.pairs && t.pairs.length) {
                exEn = t.pairs[0].en; exVi = t.pairs[0].vi;
            }
        } catch (e) { /* bỏ qua */ }
    }
    // FreeDict chạy nền: về sau thì vá thêm định nghĩa EN / ví dụ nếu còn trống
    if (key) {
        fetchDictData(key).then(dict => {
            if (flashDeck[deepIdx] !== card || !dict) return;
            if (dict.enDef) {
                const defsEl = document.getElementById('deepDefs');
                if (defsEl && !document.getElementById('deepEnDefRow')) {
                    defsEl.insertAdjacentHTML('beforeend',
                        `<div class="deep-defrow" id="deepEnDefRow"><span class="deep-deflabel">EN</span><span>${escapeHtml(dict.enDef)}</span></div>`);
                }
            }
            if (!exEn && dict.example) {
                const ex = document.getElementById('deepEx');
                if (ex) ex.innerHTML =
                    `<div class="deep-ex-en">${highlightWord(dict.example, card.word)}</div>`;
            }
        }).catch(() => {});
    }
    return { enDef: null, exEn, exVi };
}

async function renderDeepCard() {
    const card = flashDeck[deepIdx];
    const total = flashDeck.length;
    if (!card) { showDeepSummary(); return; }
    document.getElementById('deepProgressBar').style.width = ((deepIdx + 1) / total * 100) + '%';
    document.getElementById('deepProgressText').textContent = `${deepIdx + 1} / ${total}`;
    document.getElementById('deepWord').textContent = card.word;
    setPosBadge(document.getElementById('deepPosBadge'), (card.meanings && card.meanings[0] && card.meanings[0].pos) || '');
    document.getElementById('deepIpa').textContent = card.ipa ? `/${card.ipa}/` : '';
    document.getElementById('deepMain').textContent = '…';
    document.getElementById('deepDefs').innerHTML = '';
    document.getElementById('deepEx').innerHTML =
        '<div class="ex-loading"><div class="spinner-sm"></div><span>Đang tải...</span></div>';

    const d = await ensureDeepData(card);
    if (flashDeck[deepIdx] !== card) return; // đã chuyển từ khác

    const _dt = (x) => (typeof x === 'object' ? x.text : x);
    const groups = card.meanings || [];
    const firstDefs = (groups[0] && groups[0].definitions) || [];
    document.getElementById('deepMain').textContent =
        _dt(firstDefs[0]) || card.desc || card.word;
    if (card.ipa) document.getElementById('deepIpa').textContent = `/${card.ipa}/`;

    const rest = [];
    groups.forEach((g, gi) => ((g.definitions || []).forEach((x, di) => {
        if (gi === 0 && di === 0) return;
        const t = _dt(x);
        if (t && !rest.includes(t)) rest.push(t);
    })));
    let defsHtml = rest.slice(0, 2).map(t =>
        `<div class="deep-defrow"><span class="deep-deflabel">VI</span><span>${escapeHtml(t)}</span></div>`
    ).join('');
    if (d.enDef) defsHtml +=
        `<div class="deep-defrow"><span class="deep-deflabel">EN</span><span>${escapeHtml(d.enDef)}</span></div>`;
    document.getElementById('deepDefs').innerHTML = defsHtml;

    const ex = document.getElementById('deepEx');
    if (d.exEn) {
        ex.innerHTML = `<div class="deep-ex-en">${highlightWord(d.exEn, card.word)}</div>` +
            (d.exVi ? `<div class="deep-ex-vi">${escapeHtml(d.exVi)}</div>` : '');
    } else {
        ex.innerHTML = '<div class="fc-nodata">Chưa có câu ví dụ cho từ này.</div>';
    }
}

function deepGrade(kind) {
    if (!flashDeck.length) return;
    if (document.getElementById('deepSummary').style.display !== 'none') return;
    const card = flashDeck[deepIdx];
    if (kind === 'known') {
        deepStats.known++;
        flashGrades[deepIdx] = true;
        if (deckGroup && card) markTopicKnown(deckGroup, card.word);
    } else if (kind === 'learn') {
        deepStats.learn++;
        flashGrades[deepIdx] = false;
    } else {
        deepStats.skip++;
    }
    deepIdx++;
    if (deepIdx >= flashDeck.length) showDeepSummary();
    else renderDeepCard();
}

function showDeepSummary() {
    document.removeEventListener('keydown', deepKeyHandler);
    document.getElementById('deepProgressText').textContent =
        `${flashDeck.length} / ${flashDeck.length}`;
    document.getElementById('deepProgressBar').style.width = '100%';
    document.getElementById('deepSumLearn').textContent = deepStats.learn;
    document.getElementById('deepSumKnown').textContent = deepStats.known;
    document.getElementById('deepSumSkip').textContent = deepStats.skip;
    document.getElementById('deepSummary').style.display = '';
    const reviewBtn = document.querySelector('#deepSummary [onclick="reviewUnknown()"]');
    if (reviewBtn) reviewBtn.style.display = deepStats.learn ? '' : 'none';
}

// ============================================================
// LUYỆN NGHE (12/10/2026): audio VOA Learning English (public domain).
// Dữ liệu: /static/listening_lessons.json. Audio ưu tiên file local
// /static/audio/<file>, lỗi thì fallback về URL VOA.
// 2 mode: trắc nghiệm + chép chính tả. Frontend-only.
// ============================================================
let _listeningLessons = null;
let _listenCur = null;
let _listenMode = 'quiz';
let _listenFilter = 'all';

async function openListening() {
    const root = document.getElementById('listenRoot');
    if (!_listeningLessons) {
        root.innerHTML = '<p style="color:var(--muted)">Đang tải danh sách bài nghe...</p>';
        try {
            const r = await fetch('/static/listening_lessons.json');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            _listeningLessons = await r.json();
        } catch (e) {
            root.innerHTML = '<p style="color:var(--muted)">Không tải được danh sách bài nghe. Kiểm tra file static/listening_lessons.json.</p>';
            return;
        }
    }
    renderListenList();
}

function _listenEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function renderListenList() {
    const root = document.getElementById('listenRoot');
    _listenCur = null;
    const f = _listenFilter || 'all';
    const counts = { all: _listeningLessons.length, beginner: 0, intermediate: 0, advanced: 0 };
    _listeningLessons.forEach(l => { if (counts[l.levelGroup] !== undefined) counts[l.levelGroup]++; });
    const chip = (k, label) => '<button class="ll-chip' + (f === k ? ' on' : '') + '" onclick="setListenFilter(\'' + k + '\')">' + label + ' (' + counts[k] + ')</button>';
    let h = '<h2 style="margin:4px 0 4px"><i class="ri-headphone-line"></i> Luyện nghe</h2>'
        + '<p style="color:var(--muted);font-size:14px;margin:0 0 12px">Nghe giọng người thật (VOA Learning English, public domain). Chọn bài rồi luyện theo 1 trong 2 cách bên dưới.</p>'
        + '<div class="ll-filters">' + chip('all', 'Tất cả') + chip('beginner', 'Cơ bản') + chip('intermediate', 'Trung cấp') + chip('advanced', 'Nâng cao') + '</div>';
    _listeningLessons.forEach(l => {
        if (f !== 'all' && l.levelGroup !== f) return;
        h += '<div class="lesson-card" onclick="openListenLesson(\'' + l.id + '\')">'
            + '<div class="lesson-play"><i class="ri-play-fill"></i></div>'
            + '<div class="lesson-meta"><h3>' + _listenEsc(l.title) + '</h3>'
            + '<p>' + _listenEsc(l.level || '') + ' · ' + l.sentences.length + ' câu · quiz ' + l.quiz.length + ' câu</p></div>'
            + '<div class="lesson-dur">' + _listenEsc(l.duration || '') + '</div></div>';
    });
    h += '<p class="src-note">Nguồn audio + transcript: VOA Learning English — public domain. Quiz tự soạn theo nội dung bài.</p>';
    root.innerHTML = h;
}

function setListenFilter(f) { _listenFilter = f; renderListenList(); }

function openListenLesson(id) {
    _listenCur = _listeningLessons.find(l => l.id === id);
    _listenMode = (_listenCur.quiz && _listenCur.quiz.length) ? 'quiz' : 'dict';
    renderListenLesson();
}

function listenAudioFallback(el) {
    if (el.dataset.fbk) return;
    el.dataset.fbk = '1';
    el.src = el.dataset.remote;
}

function renderListenLesson() {
    const root = document.getElementById('listenRoot');
    const cur = _listenCur;
    const localSrc = '/static/audio/' + cur.audio_file;
    let h = '<button class="back-link" onclick="renderListenList()">← Danh sách bài nghe</button>'
        + '<h2 style="margin:0 0 12px">' + _listenEsc(cur.title) + '</h2>'
        + '<div class="player-box"><div style="font-weight:700;margin-bottom:4px"><i class="ri-headphone-line"></i> Nghe bài</div>'
        + '<div style="font-size:13px;color:var(--muted)">Nghe kỹ rồi làm bài bên dưới. Trong trình phát có sẵn nút chỉnh tốc độ.</div>'
        + '<audio controls preload="metadata" src="' + localSrc + '" data-remote="' + cur.audio_remote + '" onerror="listenAudioFallback(this)"></audio></div>'
        + (function () {
            const hasQuiz = cur.quiz && cur.quiz.length;
            if (!hasQuiz) return '';
            return '<div class="mode-tabs">'
                + '<button class="' + (_listenMode === 'quiz' ? 'on' : '') + '" onclick="setListenMode(\'quiz\')">Trắc nghiệm</button>'
                + '<button class="' + (_listenMode === 'dict' ? 'on' : '') + '" onclick="setListenMode(\'dict\')">Chép chính tả</button>'
                + '</div>';
        })() + '<div id="listenModeBody"></div>'
        + '<p class="src-note">Nguồn: <a href="' + cur.source_url + '" target="_blank" rel="noopener">VOA Learning English</a> (public domain).</p>';
    root.innerHTML = h;
    renderListenMode();
}

function setListenMode(m) {
    _listenMode = m;
    renderListenLesson();
}

function renderListenMode() {
    if (_listenMode === 'quiz') renderListenQuiz();
    else renderListenDict();
}

/* ---------- trắc nghiệm ---------- */
function renderListenQuiz() {
    const cur = _listenCur;
    const box = document.getElementById('listenModeBody');
    let h = '<p style="color:var(--muted);font-size:14px">Nghe bài rồi trả lời ' + cur.quiz.length + ' câu hỏi.</p>';
    cur.quiz.forEach((q, i) => {
        h += '<div class="quiz-q" id="lqq' + i + '"><h4>Câu ' + (i + 1) + ': ' + _listenEsc(q.q) + '</h4>';
        q.options.forEach((op, j) => {
            h += '<div class="quiz-opt" onclick="pickListenOpt(' + i + ',' + j + ',this)"><span>' + _listenEsc(op) + '</span></div>';
        });
        h += '<div class="quiz-explain" id="lqe' + i + '"></div></div>';
    });
    h += '<button class="btn-check" onclick="checkListenQuiz()">Chấm điểm</button><div class="quiz-score" id="lqscore"></div>';
    box.innerHTML = h;
}

function pickListenOpt(i, j, el) {
    const q = document.getElementById('lqq' + i);
    q.querySelectorAll('.quiz-opt').forEach(o => o.classList.remove('sel'));
    el.classList.add('sel');
    el.dataset.pick = j;
}

function checkListenQuiz() {
    const cur = _listenCur;
    let score = 0;
    cur.quiz.forEach((q, i) => {
        const box = document.getElementById('lqq' + i);
        const opts = box.querySelectorAll('.quiz-opt');
        let pick = -1;
        opts.forEach(o => { if (o.classList.contains('sel')) pick = +o.dataset.pick; });
        opts[q.answer].classList.add('right');
        if (pick === q.answer) { score++; }
        else if (pick >= 0) { opts[pick].classList.add('wrong'); }
        const ex = document.getElementById('lqe' + i);
        ex.innerHTML = (pick === q.answer ? '✔ Đúng. ' : '✘ Chưa đúng. ') + _listenEsc(q.explain);
        ex.classList.add('show');
    });
    document.getElementById('lqscore').textContent = 'Điểm: ' + score + '/' + cur.quiz.length;
}

/* ---------- chép chính tả ---------- */
function _listenNorm(s) {
    return s.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function renderListenDict() {
    const cur = _listenCur;
    const box = document.getElementById('listenModeBody');
    let h = '<p style="color:var(--muted);font-size:14px">Nghe từng câu rồi <b>gõ lại</b> những gì bạn nghe được (không cần gõ tên người nói). Bấm “Kiểm tra” để chấm từng từ.</p>';
    cur.sentences.forEach((s, i) => {
        const spkLabel = s.speaker ? _listenEsc(s.speaker) + ' — ' : '';
        h += '<div class="dict-item"><div class="spk">' + spkLabel + 'câu ' + (i + 1) + '</div>'
            + '<input id="ldin' + i + '" placeholder="Gõ lại câu bạn nghe được..." autocomplete="off">'
            + '<div class="dict-result" id="ldres' + i + '"></div></div>';
    });
    h += '<button class="btn-check" onclick="checkListenDict()">Kiểm tra tất cả</button><div class="quiz-score" id="ldscore"></div>';
    box.innerHTML = h;
}

function checkListenDict() {
    const cur = _listenCur;
    let totalOk = 0, totalW = 0;
    cur.sentences.forEach((s, i) => {
        const exp = _listenNorm(s.text);
        const typed = _listenNorm(document.getElementById('ldin' + i).value);
        totalW += exp.length;
        let h = '';
        const n = Math.max(exp.length, typed.length);
        for (let k = 0; k < n; k++) {
            const e = exp[k], t = typed[k];
            if (e !== undefined && t === e) { h += '<span class="w-ok">' + _listenEsc(e) + '</span> '; totalOk++; }
            else if (e !== undefined && t !== undefined) { h += '<span class="w-bad">' + _listenEsc(t) + '</span><span class="w-miss">' + _listenEsc(e) + '</span> '; }
            else if (e !== undefined) { h += '<span class="w-miss">' + _listenEsc(e) + '</span> '; }
            else { h += '<span class="w-bad">' + _listenEsc(t) + '</span> '; }
        }
        const pct = exp.length ? Math.round(100 * exp.filter((w, k) => typed[k] === w).length / exp.length) : 0;
        const r = document.getElementById('ldres' + i);
        r.innerHTML = h + '<div class="dict-ans">Đúng ' + pct + '% · Đáp án: “' + _listenEsc(s.text) + '”</div>';
        r.classList.add('show');
    });
    document.getElementById('ldscore').textContent =
        'Tổng số từ đúng: ' + totalOk + '/' + totalW + ' (' + (totalW ? Math.round(100 * totalOk / totalW) : 0) + '%)';
}
