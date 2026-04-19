import os
import shutil
import tempfile
import whisper
import fitz
import pytesseract
import base64
import io
import logging
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Setup Logging
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("server")

app = FastAPI(title="Unified AI Server")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global Models / Setup ---
print("Loading Whisper model...")
whisper_model = whisper.load_model("base")
print("Whisper ready!")

# Tesseract setup
_HAS_TESS = bool(shutil.which("tesseract"))
if not _HAS_TESS:
    print("Warning: Tesseract not found. OCR features will be disabled.")

# --- Models ---
class TranscribeResponse(BaseModel):
    text: str

# --- Helpers ---
def _to_rgb(pix: fitz.Pixmap) -> fitz.Pixmap:
    if pix.alpha or (pix.colorspace and pix.colorspace.n > 3):
        return fitz.Pixmap(fitz.csRGB, pix)
    return pix

def pix_b64(pix: fitz.Pixmap) -> str:
    return base64.b64encode(_to_rgb(pix).tobytes("png")).decode()

def run_ocr(pix: fitz.Pixmap) -> str:
    if not _HAS_TESS: return ""
    from PIL import Image, ImageEnhance, ImageOps
    png = _to_rgb(pix).tobytes("png")
    img = Image.open(io.BytesIO(png)).convert("L")
    img = ImageOps.autocontrast(img)
    w, h = img.size
    img = img.resize((w * 2, h * 2), Image.Resampling.LANCZOS)
    img = ImageEnhance.Sharpness(img).enhance(3.0)
    img = ImageEnhance.Contrast(img).enhance(1.8)
    for lang in ("vie+eng", "eng"):
        try:
            return pytesseract.image_to_string(img, lang=lang, config="--psm 3 --oem 3").strip()
        except: continue
    return ""

# --- API Endpoints ---

@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        suffix = os.path.splitext(file.filename)[1] if file.filename else ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name
        
        result = whisper_model.transcribe(tmp_path, language="vi", fp16=False)
        os.remove(tmp_path)
        return {"text": result["text"].strip()}
    except Exception as e:
        print(f"STT Error: {str(e)}")
        raise HTTPException(500, detail=str(e))

@app.post("/api/extract")
async def extract_pdf(file: UploadFile = File(...)):
    try:
        ext = (file.filename or "").rsplit(".", 1)[-1].lower()
        data = await file.read()
        pages_data = []

        if ext == "pdf":
            doc = fitz.open(stream=data, filetype="pdf")
            for i, page in enumerate(doc):
                native = page.get_text("text").strip()
                images = []
                for info in page.get_images(full=True):
                    try:
                        pix = _to_rgb(fitz.Pixmap(doc.extract_image(info[0])["image"]))
                        images.append({"b64": pix_b64(pix), "ocr": run_ocr(pix)})
                    except: pass
                
                ocr_text = ""
                if not native:
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                    ocr_text = run_ocr(pix)
                
                pages_data.append({
                    "page": i + 1,
                    "native": native,
                    "ocr": ocr_text,
                    "text": native or ocr_text or "",
                    "source": "native" if native else "ocr",
                    "images": images
                })
            doc.close()
        else:
            # Image handling
            pix = _to_rgb(fitz.Pixmap(data))
            ocr_text = run_ocr(pix)
            pages_data = [{
                "page": 1,
                "text": ocr_text,
                "source": "ocr",
                "images": [{"b64": pix_b64(pix), "ocr": ocr_text}]
            }]

        return {
            "filename": file.filename,
            "type": ext,
            "pages": len(pages_data),
            "full_text": "\n\n".join(p["text"] for p in pages_data if p["text"]),
            "detail": pages_data,
            "ocr_applied": any(p["source"] == "ocr" for p in pages_data)
        }
    except Exception as e:
        print(f"OCR Error: {str(e)}")
        raise HTTPException(500, detail=str(e))

@app.get("/")
async def root():
    return {"status": "Unified Server Running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
