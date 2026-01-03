"""
Tesseract OCR HTTP Server

REST API für OCR-Anfragen von der Autonomous Learning Pipeline.

Endpoints:
- POST /ocr - OCR auf Base64-Bild
- GET /health - Health Check
"""

import base64
import io
import os
from flask import Flask, request, jsonify
from PIL import Image
import pytesseract

app = Flask(__name__)

# Konfiguration
OCR_LANG = os.environ.get('OCR_LANG', 'eng+deu')
CONFIDENCE_THRESHOLD = float(os.environ.get('CONFIDENCE_THRESHOLD', '30'))

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    try:
        # Teste Tesseract
        version = pytesseract.get_tesseract_version()
        return jsonify({
            'status': 'healthy',
            'tesseract_version': str(version),
            'ocr_lang': OCR_LANG
        })
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 500

@app.route('/ocr', methods=['POST'])
def ocr():
    """
    OCR auf Base64-codiertem Bild
    
    Request Body:
    {
        "image": "base64_encoded_image_data",
        "lang": "eng+deu" (optional)
    }
    
    Response:
    {
        "text": "erkannter text",
        "confidence": 0.85,
        "words": [
            {"text": "wort", "confidence": 0.9, "bbox": [x, y, w, h]}
        ]
    }
    """
    try:
        data = request.json
        if not data or 'image' not in data:
            return jsonify({'error': 'Missing image field'}), 400
        
        # Base64 dekodieren
        image_data = base64.b64decode(data['image'])
        image = Image.open(io.BytesIO(image_data))
        
        # Optional: Sprache überschreiben
        lang = data.get('lang', OCR_LANG)
        
        # OCR mit Details
        ocr_data = pytesseract.image_to_data(
            image, 
            lang=lang, 
            output_type=pytesseract.Output.DICT
        )
        
        # Ergebnisse aggregieren
        words = []
        total_confidence = 0
        word_count = 0
        full_text = []
        
        for i, text in enumerate(ocr_data['text']):
            text = text.strip()
            if not text:
                continue
                
            conf = int(ocr_data['conf'][i])
            if conf < 0:  # Tesseract gibt -1 für nicht erkannte Bereiche
                continue
                
            word_count += 1
            total_confidence += conf
            full_text.append(text)
            
            # Bounding Box
            x = ocr_data['left'][i]
            y = ocr_data['top'][i]
            w = ocr_data['width'][i]
            h = ocr_data['height'][i]
            
            words.append({
                'text': text,
                'confidence': conf / 100.0,
                'bbox': [x, y, w, h]
            })
        
        avg_confidence = (total_confidence / word_count / 100.0) if word_count > 0 else 0
        
        return jsonify({
            'text': ' '.join(full_text),
            'confidence': avg_confidence,
            'words': words,
            'word_count': word_count
        })
        
    except Exception as e:
        return jsonify({
            'error': str(e),
            'text': '',
            'confidence': 0
        }), 500

@app.route('/ocr/batch', methods=['POST'])
def ocr_batch():
    """
    Batch OCR auf mehreren Bildern
    
    Request Body:
    {
        "images": ["base64_1", "base64_2", ...]
    }
    """
    try:
        data = request.json
        if not data or 'images' not in data:
            return jsonify({'error': 'Missing images field'}), 400
        
        results = []
        for img_base64 in data['images']:
            try:
                image_data = base64.b64decode(img_base64)
                image = Image.open(io.BytesIO(image_data))
                
                text = pytesseract.image_to_string(image, lang=OCR_LANG)
                
                # Einfache Confidence-Schätzung
                ocr_data = pytesseract.image_to_data(
                    image, 
                    lang=OCR_LANG, 
                    output_type=pytesseract.Output.DICT
                )
                
                confs = [c for c in ocr_data['conf'] if c > 0]
                avg_conf = sum(confs) / len(confs) / 100.0 if confs else 0
                
                results.append({
                    'text': text.strip(),
                    'confidence': avg_conf
                })
            except Exception as e:
                results.append({
                    'text': '',
                    'confidence': 0,
                    'error': str(e)
                })
        
        return jsonify({'results': results})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print(f"Starting OCR Server...")
    print(f"  Language: {OCR_LANG}")
    print(f"  Tesseract: {pytesseract.get_tesseract_version()}")
    
    # Für Entwicklung
    app.run(host='0.0.0.0', port=8080, debug=False)