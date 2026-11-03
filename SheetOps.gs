/**
 * SheetOps.gs — lecture du Sheet (instantané pour l'IA) et écritures contrôlées.
 *
 * Garde-fous :
 *  - seuls les tableaux déclarés dans la feuille Config sont accessibles
 *  - une cellule contenant une formule n'est jamais modifiée
 *  - une valeur commençant par "=" est refusée
 *  - toute écriture est re-validée juste avant d'être appliquée
 */

// ---------- Lecture : instantané envoyé à l'IA ----------

function buildSnapshot_(tables) {
  const ss = getSpreadsheet_();
  const parts = [];

  tables.forEach(function (t) {
    parts.push('## Tableau "' + t.name + '" (feuille "' + t.sheet + '", entêtes ligne ' + t.headerRow + ')' +
      (t.description ? ' — ' + t.description : ''));

    const sh = ss.getSheetByName(t.sheet);
    if (!sh) { parts.push('(feuille introuvable)'); return; }

    const lastRow = sh.getLastRow();
    const lastCol = Math.min(sh.getLastColumn(), SNAPSHOT_MAX_COLS);
    if (lastRow < 1 || lastCol < 1) { parts.push('(vide)'); return; }

    const headerRow = Math.min(t.headerRow, lastRow);
    if (lastRow <= SNAPSHOT_MAX_ROWS) {
      parts.push(readBlock_(sh, 1, lastRow, lastCol).join('\n'));
    } else {
      const tailStart = lastRow - (SNAPSHOT_MAX_ROWS - headerRow) + 1;
      parts.push(readBlock_(sh, 1, headerRow, lastCol).join('\n'));
      parts.push('(lignes ' + (headerRow + 1) + ' à ' + (tailStart - 1) + ' omises)');
      parts.push(readBlock_(sh, tailStart, lastRow, lastCol).join('\n'));
    }
  });

  return parts.join('\n');
}

/** Lit un bloc de lignes : « L7: A=5% | B=2% ». [f] marque une cellule à formule. */
function readBlock_(sh, firstRow, lastRow, lastCol) {
  const n = lastRow - firstRow + 1;
  const range = sh.getRange(firstRow, 1, n, lastCol);
  const display = range.getDisplayValues();
  const formulas = range.getFormulas();
  const lines = [];

  for (let i = 0; i < n; i++) {
    const cells = [];
    for (let j = 0; j < lastCol; j++) {
      const v = display[i][j];
      if (v === '') continue;
      cells.push(colLetter_(j + 1) + '=' + v + (formulas[i][j] ? ' [f]' : ''));
    }
    if (cells.length) lines.push('L' + (firstRow + i) + ': ' + cells.join(' | '));
  }
  return lines;
}

// ---------- Validation et description des actions ----------

/**
 * Valide une action proposée par l'IA. Renvoie { clean, summary } :
 *  - clean : action nettoyée, à stocker puis à appliquer
 *  - summary : texte lisible montré à l'utilisateur avant confirmation
 */
function validateAction_(a) {
  if (!a || (a.type !== 'append' && a.type !== 'update')) {
    throw new Error("Type d'action invalide.");
  }
  const table = findTable_(a.table);
  if (!table) throw new Error('Tableau inconnu : ' + a.table);
  const sh = getSpreadsheet_().getSheetByName(table.sheet);
  if (!sh) throw new Error('Feuille introuvable : ' + table.sheet);

  if (a.type === 'update') {
    const cell = String(a.cell || '').toUpperCase().replace(/\s/g, '');
    if (!/^[A-Z]{1,2}[1-9][0-9]{0,4}$/.test(cell)) {
      throw new Error('Adresse de cellule invalide : ' + a.cell);
    }
    const value = cleanValue_(a.value);
    let range;
    let old;
    try {
      range = sh.getRange(cell);
      if (range.getFormula()) {
        throw new Error('La cellule ' + cell + ' contient une formule : modification refusée.');
      }
      old = range.getDisplayValue();
    } catch (e) {
      if (/formule/.test(e.message)) throw e;
      throw new Error('Cellule hors de la feuille : ' + cell);
    }
    return {
      clean: { type: 'update', table: table.name, cell: cell, value: value },
      summary: '✏️ Modifier la cellule ' + cell + ' de « ' + table.sheet + ' »\n' +
               'Ancienne valeur : ' + (old === '' ? '(vide)' : old) + '\n' +
               'Nouvelle valeur : ' + value
    };
  }

  // append
  const values = a.values;
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) {
    throw new Error('Aucune valeur à ajouter.');
  }
  if (Object.keys(values).length > 20) throw new Error('Trop de colonnes.');

  const clean = {};
  const lines = [];
  Object.keys(values).forEach(function (key) {
    const col = resolveColumn_(sh, table.headerRow, key);
    const value = cleanValue_(values[key]);
    clean[key] = value;
    lines.push('• ' + col.label + ' : ' + value);
  });

  return {
    clean: { type: 'append', table: table.name, values: clean },
    summary: '➕ Ajouter une nouvelle ligne dans « ' + table.sheet + ' » :\n' + lines.join('\n')
  };
}

/** Trouve une colonne par son entête (prioritaire) ou par sa lettre. */
function resolveColumn_(sh, headerRow, key) {
  const k = String(key).trim();
  const lastCol = Math.max(1, sh.getLastColumn());
  const headers = sh.getRange(headerRow, 1, 1, lastCol).getDisplayValues()[0];

  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === k.toLowerCase() && k !== '') {
      return { index: i + 1, label: String(headers[i]).trim() + ' (' + colLetter_(i + 1) + ')' };
    }
  }
  if (/^[A-Za-z]{1,2}$/.test(k)) {
    const idx = colIndex_(k.toUpperCase());
    return { index: idx, label: 'colonne ' + k.toUpperCase() };
  }
  throw new Error('Colonne inconnue : ' + k);
}

function cleanValue_(v) {
  if (v === null || v === undefined) throw new Error('Valeur manquante.');
  const s = String(v).trim();
  if (!s) throw new Error('Valeur vide.');
  if (s.length > 300) throw new Error('Valeur trop longue.');
  if (s.charAt(0) === '=') throw new Error("Les formules ne sont pas autorisées.");
  return s;
}

// ---------- Écriture ----------

/** Applique une action déjà validée (la re-valide sous verrou). Renvoie un message de succès. */
function applyAction_(rawAction) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const v = validateAction_(rawAction);
    const a = v.clean;
    const table = findTable_(a.table);
    const sh = getSpreadsheet_().getSheetByName(table.sheet);

    if (a.type === 'update') {
      sh.getRange(a.cell).setValue(a.value);
      SpreadsheetApp.flush();
      return '✅ Cellule ' + a.cell + ' mise à jour (' + table.sheet + ').';
    }

    const row = sh.getLastRow() + 1;
    Object.keys(a.values).forEach(function (key) {
      const col = resolveColumn_(sh, table.headerRow, key);
      sh.getRange(row, col.index).setValue(a.values[key]);
    });
    SpreadsheetApp.flush();
    return '✅ Ligne ' + row + ' ajoutée (' + table.sheet + ').';
  } finally {
    lock.releaseLock();
  }
}

// ---------- Utilitaires de colonnes ----------

function colLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colIndex_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n;
}
