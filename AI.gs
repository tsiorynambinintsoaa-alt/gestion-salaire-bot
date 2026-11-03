/**
 * AI.gs — appels aux IA gratuites : Groq en priorité, Google Gemini en secours.
 * Les modèles peuvent être changés via les propriétés GROQ_MODEL et GEMINI_MODEL.
 */

/** Interroge l'IA et renvoie l'objet JSON décodé. Bascule sur Gemini si Groq échoue. */
function askAI_(systemPrompt, userPrompt) {
  const errors = [];

  if (prop_('GROQ_API_KEY')) {
    try {
      return parseAiJson_(callGroq_(systemPrompt, userPrompt));
    } catch (e) {
      errors.push('Groq : ' + e.message);
      console.error('Groq a échoué : ' + e.message);
    }
  }

  if (prop_('GEMINI_API_KEY')) {
    try {
      return parseAiJson_(callGemini_(systemPrompt, userPrompt));
    } catch (e) {
      errors.push('Gemini : ' + e.message);
      console.error('Gemini a échoué : ' + e.message);
    }
  }

  throw new Error('Aucune IA disponible. ' + errors.join(' | '));
}

function callGroq_(systemPrompt, userPrompt) {
  const res = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + requireProp_('GROQ_API_KEY') },
    payload: JSON.stringify({
      model: prop_('GROQ_MODEL', DEFAULT_GROQ_MODEL),
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code !== 200) throw new Error('HTTP ' + code + ' ' + text.slice(0, 200));
  const data = JSON.parse(text);
  return data.choices[0].message.content;
}

function callGemini_(systemPrompt, userPrompt) {
  const model = prop_('GEMINI_MODEL', DEFAULT_GEMINI_MODEL);
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': requireProp_('GEMINI_API_KEY') },
    payload: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
    }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code !== 200) throw new Error('HTTP ' + code + ' ' + text.slice(0, 200));
  const data = JSON.parse(text);
  return data.candidates[0].content.parts[0].text;
}

/** Décode la réponse de l'IA (tolère les balises ``` et le texte autour du JSON). */
function parseAiJson_(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Réponse IA sans JSON');
  const obj = JSON.parse(s.slice(start, end + 1));
  if (['answer', 'append', 'update'].indexOf(obj.type) === -1) {
    throw new Error('Type de réponse IA inconnu : ' + obj.type);
  }
  return obj;
}
