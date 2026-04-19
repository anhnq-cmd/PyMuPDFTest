/**
 * Unified AI Dashboard Logic
 */

// --- Configuration ---
const CONFIG = {
    STT_API: 'http://localhost:8001/api/transcribe',
    OCR_API: 'http://localhost:8001/api/extract'
};

// --- Navigation Logic ---
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const pageId = item.getAttribute('data-page');
        
        // Update nav UI
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        // Update pages
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${pageId}`).classList.add('active');
    });
});

// --- Speech to Text (Whisper) Logic ---
let mediaRecorder;
let audioChunks = [];

const sttStartBtn = document.getElementById('stt-start-btn');
const sttStopBtn = document.getElementById('stt-stop-btn');
const sttStatus = document.getElementById('stt-status');
const sttResultText = document.getElementById('stt-result-text');
const sttLoader = document.getElementById('stt-loader');
const sttMsg = document.getElementById('stt-processing-msg');

sttStartBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => audioChunks.push(event.data);
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            setSttLoading(true);
            await sendToSttBackend(audioBlob);
            setSttLoading(false);
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        sttStartBtn.disabled = true;
        sttStopBtn.disabled = false;
        sttStatus.style.display = 'inline-flex';
        sttResultText.innerText = "Đang lắng nghe...";
    } catch (err) {
        console.error("Microphone error:", err);
        alert("Không thể truy cập micro.");
    }
});

sttStopBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        sttStartBtn.disabled = false;
        sttStopBtn.disabled = true;
        sttStatus.style.display = 'none';
    }
});

async function sendToSttBackend(blob) {
    const fd = new FormData();
    fd.append('file', blob, 'audio.webm');
    try {
        const res = await fetch(CONFIG.STT_API, { method: 'POST', body: fd });
        if (!res.ok) throw new Error("STT Backend error");
        const data = await res.json();
        sttResultText.innerText = data.text || "(Không nhận diện được nội dung)";
    } catch (err) {
        sttResultText.innerText = "Lỗi kết nối tới Whisper Backend (Port 8000).";
    }
}

function setSttLoading(isLoading) {
    sttLoader.style.display = isLoading ? 'block' : 'none';
    sttMsg.style.display = isLoading ? 'block' : 'none';
    sttResultText.style.opacity = isLoading ? '0.5' : '1';
}

// --- PDF & OCR (PyMuPDF) Logic ---
let ocrFile = null;
const ocrInput = document.getElementById('ocr-file-input');
const ocrDropZone = document.getElementById('ocr-drop-zone');
const ocrExtractBtn = document.getElementById('ocr-extract-btn');
const ocrResults = document.getElementById('ocr-results');

ocrDropZone.addEventListener('click', () => ocrInput.click());
ocrInput.addEventListener('change', (e) => selectOcrFile(e.target.files[0]));

ocrDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    ocrDropZone.style.borderColor = 'var(--primary-light)';
});
ocrDropZone.addEventListener('dragleave', () => ocrDropZone.style.borderColor = '');
ocrDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    ocrDropZone.style.borderColor = '';
    selectOcrFile(e.dataTransfer.files[0]);
});

function selectOcrFile(f) {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['pdf','png','jpg','jpeg'].includes(ext)) {
        alert("Định dạng không hỗ trợ.");
        return;
    }
    ocrFile = f;
    document.getElementById('ocr-file-name').innerText = f.name;
    document.getElementById('ocr-file-size').innerText = (f.size / (1024 * 1024)).toFixed(2) + " MB";
    document.getElementById('ocr-file-bar').style.display = 'flex';
    ocrExtractBtn.disabled = false;
    ocrResults.style.display = 'none';
}

document.getElementById('ocr-clear-btn').addEventListener('click', () => {
    ocrFile = null;
    ocrInput.value = '';
    document.getElementById('ocr-file-bar').style.display = 'none';
    ocrExtractBtn.disabled = true;
});

ocrExtractBtn.addEventListener('click', async () => {
    if (!ocrFile) return;
    
    ocrExtractBtn.disabled = true;
    ocrExtractBtn.innerText = "Đang xử lý...";
    document.getElementById('ocr-err').style.display = 'none';

    const fd = new FormData();
    fd.append('file', ocrFile);

    try {
        const res = await fetch(CONFIG.OCR_API, { method: 'POST', body: fd });
        if (!res.ok) throw new Error("OCR Backend error");
        const data = await res.json();
        renderOcrResults(data);
    } catch (err) {
        document.getElementById('ocr-err').innerText = "Lỗi kết nối tới OCR Backend (Port 8003).";
        document.getElementById('ocr-err').style.display = 'block';
    } finally {
        ocrExtractBtn.disabled = false;
        ocrExtractBtn.innerText = "Bắt đầu trích xuất";
    }
});

function renderOcrResults(d) {
    ocrResults.style.display = 'block';
    
    // Render Stats
    const words = (d.full_text || '').trim().split(/\s+/).filter(Boolean).length;
    const imgs = d.detail.reduce((s, p) => s + (p.images || []).length, 0);
    
    document.getElementById('ocr-stats').innerHTML = `
        <div class="stat-card"><div class="stat-val">${d.type.toUpperCase()}</div><div class="stat-lbl">Loại</div></div>
        <div class="stat-card"><div class="stat-val">${d.pages}</div><div class="stat-lbl">Trang</div></div>
        <div class="stat-card"><div class="stat-val">${words}</div><div class="stat-lbl">Số từ</div></div>
        <div class="stat-card"><div class="stat-val">${imgs}</div><div class="stat-lbl">Ảnh</div></div>
    `;

    document.getElementById('ocr-text-result').innerText = d.full_text || "(Không có nội dung)";

    // Render Images
    const grid = document.getElementById('ocr-image-grid');
    grid.innerHTML = '';
    const allImgs = d.detail.flatMap(p => (p.images || []).map(img => ({ ...img, page: p.page })));
    
    if (allImgs.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2rem;">Không tìm thấy hình ảnh.</p>';
    } else {
        allImgs.forEach(img => {
            const item = document.createElement('div');
            item.className = 'img-item';
            item.innerHTML = `
                <img src="data:image/png;base64,${img.b64}">
                <div class="img-info">
                    <strong>Trang ${img.page}</strong>
                    <div class="img-ocr">${img.ocr || 'Không có text OCR'}</div>
                </div>
            `;
            grid.appendChild(item);
        });
    }
    
    ocrResults.scrollIntoView({ behavior: 'smooth' });
}

// Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');
    });
});
