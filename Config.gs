/**
 * Config.gs — constantes, accès aux clés (Propriétés du script) et feuille "Config".
 * Aucune clé secrète n'est écrite dans le code : tout passe par les Propriétés du script.
 */

const CONFIG_SHEET_NAME = 'Config';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

const SNAPSHOT_MAX_ROWS = 60;     // lignes max envoyées à l'IA par tableau
const SNAPSHOT_MAX_COLS = 20;     // colonnes max lues par tableau
const PENDING_TTL_SEC = 600;      // délai (10 min) pour confirmer une écriture
const HISTORY_MAX_MESSAGES = 6;   // mémoire de conversation courte
const HISTORY_TTL_SEC = 3600;

/** Lit une propriété du script (chaîne vide si absente). */
function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return v ? v.trim() : (fallback || '');
}

/** Lit une propriété obligatoire, sinon lève une erreur claire. */
function requireProp_(key) {
  const v = prop_(key);
  if (!v) throw new Error('Propriété du script manquante : ' + key);
  return v;
}

/** Liste des chat id Telegram autorisés (séparés par des virgules). */
function getAllowedChatIds_() {
  return prop_('ALLOWED_CHAT_ID').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function isAllowed_(chatId) {
  return getAllowedChatIds_().indexOf(String(chatId)) !== -1;
}

/** Classeur cible : SPREADSHEET_ID si défini, sinon le classeur auquel le script est lié. */
function getSpreadsheet_() {
  const id = prop_('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Secret ajouté à l'URL du webhook (généré automatiquement au premier appel). */
function getWebhookSecret_() {
  let s = prop_('WEBHOOK_SECRET');
  if (!s) {
    s = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    PropertiesService.getScriptProperties().setProperty('WEBHOOK_SECRET', s);
  }
  return s;
}

/** Crée la feuille "Config" avec un exemple (à exécuter une fois). */
function setupConfigSheet() {
  const ss = getSpreadsheet_();
  if (ss.getSheetByName(CONFIG_SHEET_NAME)) {
    Logger.log('La feuille "' + CONFIG_SHEET_NAME + '" existe déjà.');
    return;
  }
  const sh = ss.insertSheet(CONFIG_SHEET_NAME);
  sh.getRange(1, 1, 2, 4).setValues([
    ['Table', 'Feuille', 'LigneEntete', 'Description'],
    ['depenses', 'Gestion salaire', 1, 'Budget salaire : répartition par catégorie et suivi hebdomadaire des dépenses']
  ]);
  sh.getRange(1, 1, 1, 4).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 4);
  Logger.log('Feuille "' + CONFIG_SHEET_NAME + '" créée. Adapte-la à tes tableaux.');
}

/** Lit la feuille Config : un objet par tableau déclaré. */
function getTablesConfig_() {
  const sh = getSpreadsheet_().getSheetByName(CONFIG_SHEET_NAME);
  if (!sh) throw new Error('Feuille "' + CONFIG_SHEET_NAME + '" introuvable. Lance setupConfigSheet().');
  const rows = sh.getDataRange().getValues().slice(1);
  const tables = rows
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) {
      return {
        name: String(r[0]).trim(),
        sheet: String(r[1]).trim(),
        headerRow: Math.max(1, parseInt(r[2], 10) || 1),
        description: String(r[3] || '').trim()
      };
    });
  if (!tables.length) throw new Error('La feuille Config ne déclare aucun tableau.');
  return tables;
}

/** Retrouve un tableau par son nom (insensible à la casse). */
function findTable_(name) {
  const wanted = String(name || '').trim().toLowerCase();
  const found = getTablesConfig_().filter(function (t) { return t.name.toLowerCase() === wanted; });
  return found[0] || null;
}
