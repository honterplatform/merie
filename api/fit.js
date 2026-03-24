// ============================================================
// Required environment variable: ANTHROPIC_API_KEY
// Set this in Vercel dashboard → Project Settings → Environment Variables
// Never commit this key to git
// ============================================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are Merie's fit assistant, a warm, honest, knowledgeable friend who works in fashion. Your sole purpose is to help women find their size in Merie clothing and feel confident about their choice.

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
}`;

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      size: '—',
      reply: req.body?.language === 'en'
        ? 'Our fit assistant is temporarily unavailable. Please try again shortly.'
        : 'Nuestra asistente de tallas no está disponible temporalmente. Por favor, inténtalo de nuevo en unos minutos.',
      notes: []
    });
  }

  try {
    const { message, language, garment } = req.body;

    const garmentContext = {
      top: 'The user is looking for their size in TOPS (shirts, blouses, bras, dresses). Focus only on bust and underbust measurements. Waist and hips are not relevant here.',
      bottom: 'The user is looking for their size in BOTTOMS (pants, skirts). Focus only on waist and hip measurements. Bust and underbust are not relevant here.',
      jumpsuit: 'The user is looking for their size in JUMPSUITS. All measurements matter: bust, underbust, waist, and hips.'
    }[garment] || '';

    const languageInstruction = language === 'en'
      ? 'Respond in English.'
      : 'Responde en español.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `${languageInstruction}\n${garmentContext}\n\n${message}`
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Try to parse JSON from response
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // If Claude didn't return valid JSON, try to extract it
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse AI response as JSON');
      }
    }

    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Fit API error:', error);
    const lang = req.body?.language || 'es';
    return res.status(500).json({
      size: '—',
      reply: lang === 'en'
        ? 'Something went wrong with our fit assistant. Please try again in a moment.'
        : 'Algo salió mal con nuestra asistente de tallas. Por favor, inténtalo de nuevo en un momento.',
      notes: []
    });
  }
}
