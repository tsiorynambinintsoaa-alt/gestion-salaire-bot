/**
 * Telegram.gs — appels à l'API Telegram, messages et boutons de confirmation.
 */

/** Appel générique d'une méthode de l'API Bot Telegram. */
function tgCall_(method, payload) {
  const url = 'https://api.telegram.org/bot' + requireProp_('TELEGRAM_TOKEN') + '/' + method;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });
  let body;
  try {
    body = JSON.parse(res.getContentText());
  } catch (e) {
    body = { ok: false, description: 'Réponse non JSON (HTTP ' + res.getResponseCode() + ')' };
  }
  if (!body.ok) console.error('Telegram ' + method + ' : ' + (body.description || res.getContentText()));
  return body;
}

/** Envoie un message texte brut (pas de Markdown, pour éviter les erreurs de format). */
function sendMessage_(chatId, text, replyMarkup) {
  const payload = { chat_id: chatId, text: String(text).slice(0, 4000) };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return tgCall_('sendMessage', payload);
}

function sendTyping_(chatId) {
  tgCall_('sendChatAction', { chat_id: chatId, action: 'typing' });
}

/** Clavier Confirmer / Annuler lié à un jeton d'action en attente. */
function confirmKeyboard_(token) {
  return {
    inline_keyboard: [[
      { text: '✅ Confirmer', callback_data: 'ok:' + token },
      { text: '❌ Annuler', callback_data: 'no:' + token }
    ]]
  };
}

function answerCallback_(callbackId, text) {
  tgCall_('answerCallbackQuery', { callback_query_id: callbackId, text: text || '' });
}

/** Retire les boutons d'un message (évite le double clic). */
function clearKeyboard_(chatId, messageId) {
  tgCall_('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] }
  });
}

/**
 * À exécuter une fois après le déploiement (propriété WEB_APP_URL = URL terminant par /exec).
 * Un secret est ajouté à l'URL pour rejeter les appels qui ne viennent pas de Telegram.
 */
function setWebhook() {
  const base = requireProp_('WEB_APP_URL');
  const url = base + (base.indexOf('?') === -1 ? '?' : '&') + 's=' + getWebhookSecret_();
  const res = tgCall_('setWebhook', {
    url: url,
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query']
  });
  Logger.log(JSON.stringify(res));
}

function deleteWebhook() {
  Logger.log(JSON.stringify(tgCall_('deleteWebhook', { drop_pending_updates: true })));
}

/** Affiche l'état du webhook (secret masqué) pour le débogage. */
function webhookInfo() {
  const res = tgCall_('getWebhookInfo');
  if (res.result && res.result.url) {
    res.result.url = res.result.url.replace(/s=[^&]+/, 's=***');
  }
  Logger.log(JSON.stringify(res, null, 2));
}
