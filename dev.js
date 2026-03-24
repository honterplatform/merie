// Local dev server — run with: node dev.js
// Serves static files + proxies /api/fit to the serverless handler

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

const server = http.createServer(async (req, res) => {
  // Handle /api/fit
  if (req.url === '/api/fit' && (req.method === 'POST' || req.method === 'OPTIONS')) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.writeHead(200).end();

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, language } = JSON.parse(body);

        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            system: `You are Merie's fit assistant — a warm, honest, knowledgeable friend who works in fashion. Your sole purpose is to help women find their size in Merie clothing and feel confident about their choice.

Merie's size guide (cm):
XS: bust 80–84, waist 69–73, hips 92–96, underbust 67–71
S:  bust 85–89, waist 74–78, hips 97–101, underbust 72–76
M:  bust 90–94, waist 79–83, hips 102–106, underbust 77–81
L:  bust 95–99, waist 84–88, hips 107–111, underbust 82–86

Rules:
- Never use body type labels like "pear", "apple", "hourglass" in your response
- Lead with empowerment, not measurement
- Be honest — if a garment runs small, say so
- If she's between sizes, always advise sizing up and explain why
- If she seems outside the size range, never make her feel like an edge case — guide her warmly
- Keep responses concise but warm — 2–3 sentences max per fit note
- Respond in the language specified in the request

Always respond with valid JSON in this exact format:
{
  "size": "M",
  "reply": "Your opening empowering line here.",
  "notes": [
    { "label": "Slip dress", "text": "Fit note here." },
    { "label": "Between sizes?", "text": "Advice here." }
  ]
}`,
            messages: [{ role: 'user', content: `${language === 'en' ? 'Respond in English.' : 'Responde en español.'}\n\n${message}` }]
          })
        });

        const data = await apiRes.json();
        const text = data.content?.[0]?.text || '';
        let parsed;
        try { parsed = JSON.parse(text); } catch {
          const m = text.match(/\{[\s\S]*\}/);
          parsed = m ? JSON.parse(m[0]) : { size: '—', reply: text, notes: [] };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(parsed));
      } catch (err) {
        console.error('API error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ size: '—', reply: 'Error connecting to AI. Check your API key.', notes: [] }));
      }
    });
    return;
  }

  // Static files
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not found');
  }

  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

const PORT = 6000;
server.listen(PORT, () => {
  console.log(`\n  Merie Size Guide running at http://localhost:${PORT}\n`);
});
