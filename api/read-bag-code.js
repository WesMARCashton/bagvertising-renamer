export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' })
  }

  try {
    const { imageBase64, mimeType } = req.body

    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ error: 'Missing imageBase64 or mimeType' })
    }

    const prompt = `You are reading a photo of the BOTTOM of a reusable promotional bag (BagVertising product by MARC Group).

Your only job: find and extract the bag code printed on the label. It looks like: BAG-YFM-WCFM-FC-CA-US-2
It is always in the format: BAG-[letters]-[letters]-[letters]-[letters]-[letters]-[number]
It appears at the bottom of a printed label on the bag.

Respond ONLY with a valid JSON object, no extra text:
{"code":"BAG-YFM-WCFM-FC-CA-US-2","confidence":"high"}

If you cannot read it:
{"code":null,"confidence":"low","reason":"brief explanation"}`

    const body = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 }
      }
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    )

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}))
      return res.status(geminiRes.status).json({ error: err?.error?.message || 'Gemini API error' })
    }

    const data = await geminiRes.json()
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim()

    if (!text) {
      return res.status(500).json({ error: 'Empty response from Gemini' })
    }

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      const m = text.match(/\{[\s\S]*\}/)
      if (!m) return res.status(500).json({ error: 'No JSON in Gemini response' })
      parsed = JSON.parse(m[0])
    }

    return res.status(200).json({ code: parsed.code || null, confidence: parsed.confidence, reason: parsed.reason })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' })
  }
}
