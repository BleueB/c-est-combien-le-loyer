// Serveur local CCTL — écrit les nouvelles annonces dans annonces.js
// Usage : node server.js
// Puis ouvre http://localhost:3000/admin.html

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { execFile } = require('child_process');

const PORT       = 3000;
const ROOT       = __dirname;
const ANNONCES   = path.join(ROOT, 'annonces.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

// ── validation ───────────────────────────────────────────────────────────────

function validerAnnonces() {
  const src = fs.readFileSync(ANNONCES, 'utf8');
  const erreurs = [];

  // 1. Syntaxe JS — évaluation dans un contexte isolé
  let annonces;
  try {
    const mod = { exports: {} };
    const wrapped = `(function(module){ ${src.replace('const ANNONCES =', 'module.exports =')} })(module)`;
    const vm = require('vm');
    vm.runInNewContext(wrapped, { module: mod });
    annonces = mod.exports;
    if (!Array.isArray(annonces)) throw new Error('ANNONCES n\'est pas un tableau');
  } catch(e) {
    return [`❌ Syntaxe invalide dans annonces.js : ${e.message}`];
  }

  // 2. Vérifications par annonce
  const ids = new Set();
  const liens = new Set();

  for (const a of annonces) {
    const ctx = `Annonce #${a.id ?? '?'} (${a.titre ?? '?'})`;

    if (!a.id)                    erreurs.push(`${ctx} : id manquant`);
    if (ids.has(a.id))            erreurs.push(`${ctx} : id dupliqué (${a.id})`);
    else if (a.id)                ids.add(a.id);

    if (!a.titre)                 erreurs.push(`${ctx} : titre manquant`);
    if (!a.loyer || a.loyer <= 0) erreurs.push(`${ctx} : loyer invalide (${a.loyer})`);
    if (!a.lien)                  erreurs.push(`${ctx} : lien manquant`);
    if (!a.source)                erreurs.push(`${ctx} : source manquante`);

    // Coordonnées
    if (!Array.isArray(a.coords) || a.coords.length !== 2) {
      erreurs.push(`${ctx} : coords invalides`);
    } else {
      const [lat, lng] = a.coords;
      if (lat < 41 || lat > 52) erreurs.push(`${ctx} : latitude suspecte (${lat}) — France attendue`);
      if (lng < -5 || lng > 10) erreurs.push(`${ctx} : longitude suspecte (${lng}) — France attendue`);
    }

    // Badges obligatoires
    const labelsAttendus = ['Surface','Pièces','Meublé','DPE'];
    if (Array.isArray(a.badges)) {
      for (const label of labelsAttendus) {
        if (!a.badges.find(b => b.label === label && b.value)) {
          erreurs.push(`${ctx} : badge "${label}" manquant ou vide`);
        }
      }
    } else {
      erreurs.push(`${ctx} : badges manquants`);
    }

    // Lien dupliqué
    const lienBase = (a.lien || '').split('?')[0].replace(/\/$/, '');
    if (lienBase && liens.has(lienBase)) erreurs.push(`${ctx} : lien dupliqué`);
    else if (lienBase) liens.add(lienBase);
  }

  return erreurs;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function nextId() {
  const src = fs.readFileSync(ANNONCES, 'utf8');
  const ids  = [...src.matchAll(/^\s*id:\s*(\d+)/gm)].map(m => parseInt(m[1]));
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function appendAnnonce(annonce) {
  const src = fs.readFileSync(ANNONCES, 'utf8');

  // Lien obligatoire
  if (!annonce.lien) {
    throw new Error('Le lien de l\'annonce est obligatoire');
  }

  // Vérifier doublon sur le lien (on normalise en retirant les query params)
  if (annonce.lien) {
    const lienBase = annonce.lien.split('?')[0].replace(/\/$/, '');
    const liens = [...src.matchAll(/lien:\s*"([^"]+)"/g)].map(m => m[1].split('?')[0].replace(/\/$/, ''));
    if (liens.includes(lienBase)) {
      throw new Error(`Cette annonce est déjà dans la base (lien identique)`);
    }
  }

  const id  = nextId();

  const badges = annonce.badges.map(b =>
    `      { label: "${esc(b.label)}", value: "${esc(b.value)}" },`
  ).join('\n');

  const bloc = `  {
    id: ${id},
    titre: "${esc(annonce.titre)}",
    sous_titre: "${esc(annonce.sous_titre)}",
    coords: [${annonce.coords[0]}, ${annonce.coords[1]}],
    zoom: ${annonce.zoom || 16},
    tooltip: "${esc(annonce.tooltip || annonce.titre)}",
    loyer: ${annonce.loyer},
    lien: "${esc(annonce.lien)}",
    source: "${esc(annonce.source)}",
    badges: [
${badges}
    ],
    particularites: "${esc(annonce.particularites)}",
    note: "${esc(annonce.note)}",
  },`;

  // Insère avant le commentaire de fin
  const updated = src.replace(
    /(\s*\/\/ --- Ajoute tes prochaines annonces ici ---)/,
    `\n${bloc}\n$1`
  );

  if (updated === src) {
    // Pas de marqueur → insère avant la fermeture du tableau
    fs.writeFileSync(ANNONCES, src.replace(/\n\];/, `\n${bloc}\n\n];\n`));
  } else {
    fs.writeFileSync(ANNONCES, updated);
  }

  return id;
}

function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function gitPush(id, titre) {
  return new Promise((resolve, reject) => {
    const msg = `Annonce #${id} — ${titre}`;
    // git add annonces.js && git commit -m "..." && git push
    execFile('git', ['add', 'annonces.js'], { cwd: ROOT }, (err) => {
      if (err) return reject(new Error('git add : ' + err.message));
      execFile('git', ['commit', '-m', msg], { cwd: ROOT }, (err) => {
        if (err) return reject(new Error('git commit : ' + err.message));
        execFile('git', ['push'], { cwd: ROOT }, (err, stdout, stderr) => {
          if (err) return reject(new Error('git push : ' + err.message));
          console.log(`✅ git push — ${msg}`);
          resolve();
        });
      });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  () => resolve(data));
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── contrôles de cohérence ────────────────────────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    https.get(url, { headers: { 'User-Agent': 'CCTL-check/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function extractBieniciId(lien) {
  const m = (lien || '').match(/bienici\.com\/annonce\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : null;
}

async function controlerCoherence(annonce) {
  const alertes = [];

  // 1. Vérifier via API Bien'ici
  const bieniciId = extractBieniciId(annonce.lien);
  if (bieniciId) {
    try {
      const d = await fetchJSON(`https://www.bienici.com/realEstateAd.json?id=${bieniciId}`);
      if (d.adType && d.adType !== 'rent')
        alertes.push(`⚠️ Type d'annonce : "${d.adType}" — ce n'est pas une location !`);
      if (d.status?.onTheMarket === false)
        alertes.push(`⚠️ Annonce retirée du marché sur Bien'ici`);
      if (d.price && Math.abs(d.price - annonce.loyer) > 50)
        alertes.push(`⚠️ Loyer : local=${annonce.loyer}€ mais API=${d.price}€`);
    } catch(e) {
      alertes.push(`⚠️ Impossible de vérifier via Bien'ici : ${e.message}`);
    }
  }

  // 2. Vérifier cohérence GPS / titre via Nominatim
  if (annonce.coords && annonce.titre) {
    // Extraire le quartier du titre (avant la virgule)
    const quartier = annonce.titre.split(',')[0].trim();
    try {
      const results = await fetchJSON(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(quartier + ' Nice France')}&format=json&limit=1`
      );
      if (results.length) {
        const nlat = parseFloat(results[0].lat);
        const nlon = parseFloat(results[0].lon);
        const [alat, alon] = annonce.coords;
        // Distance approximative en km (formule simplifiée)
        const dist = Math.sqrt(Math.pow((nlat - alat) * 111, 2) + Math.pow((nlon - alon) * 73, 2));
        if (dist > 3) {
          alertes.push(`⚠️ GPS suspect : les coords semblent à ${dist.toFixed(1)}km du quartier "${quartier}" selon Nominatim (${nlat.toFixed(4)}, ${nlon.toFixed(4)})`);
        }
      }
    } catch(e) { /* Nominatim indisponible, on ignore */ }
  }

  // 3. Vérifier que la note ne mentionne pas un quartier incohérent
  if (annonce.note && annonce.titre) {
    const quartiersConnus = ['Rossetti', 'Californie', 'Musicien', 'Carabacel', 'Cimiez', 'Libération'];
    const quartierTitre = annonce.titre.split(',')[0].toLowerCase();
    for (const q of quartiersConnus) {
      if (annonce.note.toLowerCase().includes(q.toLowerCase()) &&
          !quartierTitre.includes(q.toLowerCase())) {
        alertes.push(`⚠️ La note mentionne "${q}" mais le titre indique "${annonce.titre.split(',')[0]}" — note peut-être copiée d'une autre annonce`);
      }
    }
  }

  return alertes;
}

// ── serveur ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS pour les appels fetch depuis le même localhost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /check-lien?url=...
  if (req.method === 'GET' && req.url.startsWith('/check-lien')) {
    const url = new URL('http://localhost' + req.url).searchParams.get('url');
    if (!url) { res.writeHead(400); res.end('{}'); return; }
    try {
      const https = require('https');
      const http2 = require('http');
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http2;

      // Pour Bien'ici → appel API direct
      const bieniciId = extractBieniciId(url);
      if (bieniciId) {
        const d = await fetchJSON(`https://www.bienici.com/realEstateAd.json?id=${bieniciId}`);
        const online = d.adType === 'rent' && d.status?.onTheMarket !== false && d.price > 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, online }));
        return;
      }

      // Pour les autres (SeLoger, PAP…) → non vérifiable fiablement, à vérifier manuellement
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, online: null }));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, online: false }));
    }
    return;
  }

  // GET /list-annonces
  if (req.method === 'GET' && req.url === '/list-annonces') {
    try {
      const src = fs.readFileSync(ANNONCES, 'utf8');
      const vm  = require('vm');
      const mod = { exports: {} };
      vm.runInNewContext(
        `(function(module){ ${src.replace('const ANNONCES =', 'module.exports =')} })(module)`,
        { module: mod }
      );
      const annonces = Array.isArray(mod.exports) ? mod.exports : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(annonces));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /save-annonce
  if (req.method === 'POST' && req.url === '/save-annonce') {
    try {
      const body    = await readBody(req);
      const annonce = JSON.parse(body);
      const id      = appendAnnonce(annonce);
      // Push vers GitHub en arrière-plan (non bloquant)
      gitPush(id, annonce.titre).catch(e => console.error('git push échoué :', e.message));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // POST /delete-annonce
  if (req.method === 'POST' && req.url === '/delete-annonce') {
    try {
      const body = await readBody(req);
      const { id } = JSON.parse(body);
      if (!id) throw new Error('id manquant');

      let src = fs.readFileSync(ANNONCES, 'utf8');

      // Trouver le bloc de l'annonce par son id et le commenter
      // Stratégie : trouver "id: N," puis remonter au "{" ouvrant, puis trouver le "}" fermant correspondant
      const idPattern = new RegExp(`\\bid:\\s*${id}\\b`);
      const idIdx = src.search(idPattern);
      if (idIdx === -1) throw new Error(`Annonce #${id} introuvable dans annonces.js`);

      // Remonter jusqu'au "{" ouvrant du bloc
      let start = src.lastIndexOf('\n  {', idIdx);
      if (start === -1) throw new Error(`Bloc introuvable pour #${id}`);
      start += 1; // inclure le \n

      // Avancer jusqu'au "}" fermant en comptant les accolades
      let depth = 0, end = -1;
      for (let i = start; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      // Inclure la virgule et le retour à la ligne éventuel après
      if (src[end] === ',') end++;
      if (end === -1) throw new Error(`Fin de bloc introuvable pour #${id}`);

      const bloc = src.slice(start, end);
      const commented = `  /* SUPPRIMÉ #${id}\n${bloc.trim().replace(/^/gm, '  ')}\n  */`;
      src = src.slice(0, start) + '\n' + commented + src.slice(end);
      fs.writeFileSync(ANNONCES, src);

      gitPush(id, `Suppression annonce #${id}`).catch(e => console.error('git push échoué :', e.message));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch(e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ── fonction partagée : construire une annonce depuis données Bien'ici ────────
  function buildAnnonceFromBienici(d, url) {
    const pos = d.blurInfo?.position || d.blurInfo;
    const lat = pos?.lat, lng = pos?.lon;
    if (!lat || !lng) throw new Error('Coordonnées GPS manquantes');

    // Particularités auto depuis les données API
    const parts = [];
    if (d.floor > 0)              parts.push(`${d.floor}e étage`);
    else if (d.floor === 0)       parts.push('RDC');
    if (d.hasElevator === true)   parts.push('🛗 Ascenseur');
    if (d.hasCellar === true)     parts.push('🪣 Cave');
    if (d.hasBalcony === true)    parts.push('🌿 Balcon');
    if (d.hasTerrace === true)    parts.push('☀️ Terrasse');
    if (d.hasParking === true || (d.enclosedParkingQuantity > 0) || (d.outdoorParkingQuantity > 0))
                                  parts.push('🚗 Parking');
    if (d.hasPool === true)       parts.push('🏊 Piscine');
    if (d.hasFirePlace === true)  parts.push('🔥 Cheminée');
    if (d.yearOfConstruction)     parts.push(`Construit en ${d.yearOfConstruction}`);
    if (d.heating)                parts.push(`Chauffage : ${d.heating}`);
    if (d.exposition)             parts.push(`Exposition : ${d.exposition}`);
    if (d.charges > 0)            parts.push(`Charges : ${d.charges}€/mois`);

    // Note factuelle construite depuis les données structurées (pas de copier-coller d'agence)
    const noteParts = [];
    if (d.floor > 0) noteParts.push(`${d.floor}e étage`);
    else if (d.floor === 0) noteParts.push('Rez-de-chaussée');
    if (d.surfaceArea) noteParts.push(`${d.surfaceArea} m²`);
    if (d.bedroomsQuantity > 0) noteParts.push(`${d.bedroomsQuantity} chambre${d.bedroomsQuantity > 1 ? 's' : ''}`);
    if (d.exposition) noteParts.push(`exposition ${d.exposition.toLowerCase()}`);
    if (d.yearOfConstruction) noteParts.push(`immeuble ${d.yearOfConstruction}`);
    // Chercher mentions de transports dans la description sans reprendre le baratin
    const descRaw = (d.description || '').replace(/<[^>]+>/g, '');
    const tramMatch = descRaw.match(/tram(?:way)?\s+[A-Z0-9]+/i);
    if (tramMatch) noteParts.push(`🚋 ${tramMatch[0]}`);
    const note = noteParts.join(' · ');

    return {
      titre:          `${d.district?.libelle || d.city || 'Nice'}, ${d.roomsQuantity || '?'}p · ${d.surfaceArea || '?'}m²`,
      sous_titre:     `${d.city || 'Nice'} · ${d.postalCode || ''}`,
      coords:         [parseFloat(lat.toFixed(5)), parseFloat(lng.toFixed(5))],
      zoom:           16,
      tooltip:        `${d.district?.libelle || d.city || 'Nice'}`,
      loyer:          Math.round(d.price),
      lien:           url,
      source:         "Bien'ici",
      badges: [
        { label: 'Surface',  value: d.surfaceArea ? `${d.surfaceArea} m²` : '?' },
        { label: 'Pièces',   value: String(d.roomsQuantity || '?') },
        { label: 'Meublé',   value: d.isFurnished === true ? 'Oui' : 'Non' },
        { label: 'DPE',      value: d.energyClassification && d.energyClassification !== 'NS' ? `${d.energyClassification} · GES ${d.greenhouseGazClassification || '?'}` : 'NS' },
        ...(d.hasBalcony  === true ? [{ label: 'Balcon',   value: '✓' }] : []),
        ...(d.hasTerrace  === true ? [{ label: 'Terrasse', value: '✓' }] : []),
        ...((d.hasParking === true || d.enclosedParkingQuantity > 0) ? [{ label: 'Parking', value: '✓' }] : []),
      ],
      particularites: parts.join(' · '),
      note,
    };
  }

  // POST /import-masse
  if (req.method === 'POST' && req.url === '/import-masse') {
    try {
      const body = await readBody(req);
      const { urls } = JSON.parse(body);
      if (!Array.isArray(urls)) throw new Error('urls doit être un tableau');

      const details = [];
      let nbOk = 0, nbDoublons = 0, nbErreurs = 0;

      for (const url of urls) {
        const bieniciId = extractBieniciId(url);
        if (!bieniciId) {
          details.push({ url, status: 'erreur', message: 'URL non reconnue' });
          nbErreurs++; continue;
        }

        const src = fs.readFileSync(ANNONCES, 'utf8');
        const lienBase = url.split('?')[0].replace(/\/$/, '');
        const liens = [...src.matchAll(/lien:\s*"([^"]+)"/g)].map(m => m[1].split('?')[0].replace(/\/$/, ''));
        if (liens.includes(lienBase)) {
          details.push({ url, status: 'doublon', message: 'Déjà dans la base' });
          nbDoublons++; continue;
        }

        try {
          const d = await fetchJSON(`https://www.bienici.com/realEstateAd.json?id=${bieniciId}`);
          if (!d || !d.price || d.price <= 0)     { details.push({ url, status: 'erreur', message: 'Prix manquant' }); nbErreurs++; continue; }
          if (d.adType !== 'rent')                 { details.push({ url, status: 'erreur', message: `Type "${d.adType}" — pas une location` }); nbErreurs++; continue; }
          if (d.status?.onTheMarket === false)      { details.push({ url, status: 'erreur', message: 'Annonce retirée du marché' }); nbErreurs++; continue; }

          const annonce = buildAnnonceFromBienici(d, url);
          const id = appendAnnonce(annonce);
          details.push({ url, status: 'ok', message: `#${id} — ${annonce.loyer}€ — ${annonce.titre}` });
          nbOk++;
          await new Promise(r => setTimeout(r, 300));
        } catch(e) {
          details.push({ url, status: 'erreur', message: e.message });
          nbErreurs++;
        }
      }

      if (nbOk > 0) gitPush('masse', `${nbOk} annonces importées`).catch(e => console.error('git push échoué :', e.message));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: nbOk, doublons: nbDoublons, erreurs: nbErreurs, details }));
    } catch(e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: 0, doublons: 0, erreurs: 1, details: [{ url: '', status: 'erreur', message: e.message }] }));
    }
    return;
  }

  // POST /enrichir-annonces — re-fetch toutes les annonces Bien'ici avec particularites/note vides
  if (req.method === 'POST' && req.url === '/enrichir-annonces') {
    try {
      const src = fs.readFileSync(ANNONCES, 'utf8');
      const mod = { exports: {} };
      require('vm').runInNewContext(
        `(function(module){ ${src.replace('const ANNONCES =', 'module.exports =')} })(module)`,
        { module: mod }
      );
      const annonces = Array.isArray(mod.exports) ? mod.exports : [];

      // Annonces Bien'ici avec particularites ou note vides
      const aEnrichir = annonces.filter(a =>
        a.source === "Bien'ici" && extractBieniciId(a.lien) && (!a.particularites || !a.note)
      );

      const details = [];
      let nbOk = 0, nbErreurs = 0;

      for (const a of aEnrichir) {
        const bieniciId = extractBieniciId(a.lien);
        try {
          const d = await fetchJSON(`https://www.bienici.com/realEstateAd.json?id=${bieniciId}`);
          if (!d || !d.price) { details.push({ id: a.id, status: 'erreur', message: 'API vide' }); nbErreurs++; continue; }

          const enrichi = buildAnnonceFromBienici(d, a.lien);

          // Mettre à jour particularites et note dans le fichier
          let fileSrc = fs.readFileSync(ANNONCES, 'utf8');

          // Trouver la position du bloc de cette annonce
          const idIdx = fileSrc.search(new RegExp(`\\bid:\\s*${a.id}\\b`));
          if (idIdx === -1) { details.push({ id: a.id, status: 'erreur', message: 'Introuvable dans fichier' }); nbErreurs++; continue; }
          let start = fileSrc.lastIndexOf('\n  {', idIdx) + 1;
          let depth = 0, end = -1;
          for (let i = start; i < fileSrc.length; i++) {
            if (fileSrc[i] === '{') depth++;
            else if (fileSrc[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
          }
          if (fileSrc[end] === ',') end++;

          // Reconstruire le bloc complet avec les nouveaux champs
          const badges = enrichi.badges.map(b => `      { label: "${esc(b.label)}", value: "${esc(b.value)}" },`).join('\n');
          const newBloc = `  {
    id: ${a.id},
    titre: "${esc(enrichi.titre)}",
    sous_titre: "${esc(enrichi.sous_titre)}",
    coords: [${enrichi.coords[0]}, ${enrichi.coords[1]}],
    zoom: ${a.zoom || 16},
    tooltip: "${esc(enrichi.tooltip)}",
    loyer: ${enrichi.loyer},
    lien: "${esc(enrichi.lien)}",
    source: "${esc(enrichi.source)}",
    badges: [
${badges}
    ],
    particularites: "${esc(enrichi.particularites)}",
    note: "${esc(enrichi.note)}",
  },`;

          fileSrc = fileSrc.slice(0, start) + newBloc + fileSrc.slice(end);
          fs.writeFileSync(ANNONCES, fileSrc);

          details.push({ id: a.id, status: 'ok', message: `${a.titre} — particularites + note mis à jour` });
          nbOk++;
          await new Promise(r => setTimeout(r, 300));
        } catch(e) {
          details.push({ id: a.id, status: 'erreur', message: e.message });
          nbErreurs++;
        }
      }

      if (nbOk > 0) gitPush('enrichi', `${nbOk} annonces enrichies`).catch(e => console.error('git push échoué :', e.message));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: nbOk, erreurs: nbErreurs, total: aEnrichir.length, details }));
    } catch(e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: 0, erreurs: 1, total: 0, details: [{ id: '?', status: 'erreur', message: e.message }] }));
    }
    return;
  }

  // Fichiers statiques
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/' || urlPath === '') urlPath = '/admin.html';
  const filePath = path.join(ROOT, urlPath);

  // Sécurité : rester dans ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  serveFile(res, filePath);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n✅  Serveur CCTL démarré`);
  console.log(`   Admin  →  http://localhost:${PORT}/admin.html`);
  console.log(`   Jeu    →  http://localhost:${PORT}/index.html`);
  console.log(`\n   Ctrl+C pour arrêter\n`);
});
