#!/usr/bin/env python3
"""Local dev server — run with: python3 dev.py
Serves static files + proxies /api/fit to Claude API."""

import http.server
import json
import os
import urllib.request
import urllib.error
from pathlib import Path

PORT = 8080
ROOT = Path(__file__).parent

# Load .env
env_file = ROOT / '.env'
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, val = line.split('=', 1)
            os.environ[key.strip()] = val.strip()

SYSTEM_PROMPT = """You are Merie's fit assistant, a warm, honest, knowledgeable friend who works in fashion. Your sole purpose is to help women find their size in Merie clothing and feel confident about their choice.

Merie's size guide (cm):
XS: bust 80-84, waist 69-73, hips 92-96, underbust 67-71
S:  bust 85-89, waist 74-78, hips 97-101, underbust 72-76
M:  bust 90-94, waist 79-83, hips 102-106, underbust 77-81
L:  bust 95-99, waist 84-88, hips 107-111, underbust 82-86

Rules:
- Always try to get bust, waist, and hip measurements first. These give the most accurate recommendation
- If the user says they don't have measurements, walk them through how to measure: grab a soft tape measure, wrap it around the fullest part of the bust, the narrowest part of the waist, and the widest part of the hips. Keep the tape snug but not tight. Give simple, step-by-step instructions they can follow right now
- If they can't measure right now, ask about their usual size in other brands (Zara, H&M, Mango, etc.), how clothes typically fit (tight in hips? loose in waist?), and their height. Use these clues to estimate. Be transparent that this is an approximate recommendation and measuring would give a more precise result
- Never use body type labels like "pear", "apple", "hourglass" in your response
- Lead with empowerment, not measurement
- Be honest. If a garment runs small, say so
- If she's between sizes, always advise sizing up and explain why
- If she seems outside the size range, never make her feel like an edge case. Guide her warmly
- Keep responses concise but warm, 2-3 sentences max per fit note
- CRITICAL: Never use em dashes in your responses. No long dashes. Use commas, periods, or semicolons instead
- If you don't have enough information to recommend a size yet, set "size" to "-" and ask a follow-up question instead
- Respond in the language specified in the request

Always respond with valid JSON in this exact format:
{
  "size": "M",
  "reply": "Your opening empowering line here.",
  "notes": [
    { "label": "Slip dress", "text": "Fit note here." },
    { "label": "Between sizes?", "text": "Advice here." }
  ]
}"""

MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path != '/api/fit':
            self.send_error(404)
            return

        content_len = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(content_len))
        message = body.get('message', '')
        language = body.get('language', 'es')
        garment = body.get('garment', 'jumpsuit')

        garment_context = {
            'top': 'The user is looking for their size in TOPS (shirts, blouses, bras, dresses). Focus only on bust and underbust measurements. Waist and hips are not relevant here.',
            'bottom': 'The user is looking for their size in BOTTOMS (pants, skirts). Focus only on waist and hip measurements. Bust and underbust are not relevant here.',
            'jumpsuit': 'The user is looking for their size in JUMPSUITS. All measurements matter: bust, underbust, waist, and hips.'
        }.get(garment, '')

        lang_instruction = 'Respond in English.' if language == 'en' else 'Responde en español.'

        api_key = os.environ.get('ANTHROPIC_API_KEY', '')
        if not api_key:
            self._json_response(500, {'size': '—', 'reply': 'No API key configured.', 'notes': []})
            return

        payload = json.dumps({
            'model': 'claude-sonnet-4-6',
            'max_tokens': 1024,
            'system': SYSTEM_PROMPT,
            'messages': [{'role': 'user', 'content': f'{lang_instruction}\n{garment_context}\n\n{message}'}]
        }).encode()

        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
            },
            method='POST'
        )

        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read())
            text = data.get('content', [{}])[0].get('text', '')
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                import re
                m = re.search(r'\{[\s\S]*\}', text)
                parsed = json.loads(m.group()) if m else {'size': '—', 'reply': text, 'notes': []}
            self._json_response(200, parsed)
        except Exception as e:
            print(f'API error: {e}')
            self._json_response(500, {'size': '—', 'reply': 'Error connecting to AI.', 'notes': []})

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':
            path = '/index.html'

        file_path = ROOT / path.lstrip('/')
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return

        ext = file_path.suffix
        self.send_response(200)
        self.send_header('Content-Type', MIME_TYPES.get(ext, 'application/octet-stream'))
        self.end_headers()
        self.wfile.write(file_path.read_bytes())

    def _json_response(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f'  {args[0]}')


if __name__ == '__main__':
    server = http.server.HTTPServer(('', PORT), Handler)
    print(f'\n  Merie Size Guide running at http://localhost:{PORT}\n')
    server.serve_forever()
