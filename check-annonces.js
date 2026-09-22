// Script de validation des annonces
// Usage : node check-annonces.js
// Vérifie que les données dans annonces.js correspondent à l'API Bien'ici

const fs   = require('fs');
const path = require('path');
const https = require('https');

// Charger annonces.js sans require() pour éviter les dépendances
const src = fs.readFileSync(path.join(__dirname, 'annonces.js'), 'utf8');
const ANNONCES = eval(src.replace('const ANNONCES =', 'module.exports =').replace(/;?\s*$/, ''));

// ── helpers ───────────────────────────────────────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CCTL-check/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`JSON invalide : ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function extractId(lien) {
  const m = lien.match(/\/annonce\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : null;
}

function getBadge(annonce, label) {
  const b = annonce.badges.find(b => b.label === label);
  return b ? b.value : '';
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── comparaisons ──────────────────────────────────────────────────────────────

function comparer(local, api) {
  const diffs = [];

  // Loyer
  if (api.price && local.loyer !== api.price) {
    diffs.push({ champ: 'Loyer', local: local.loyer + ' €', api: api.price + ' €',
      grave: Math.abs(local.loyer - api.price) > 50 });
  }

  // Surface
  const surfaceApi = api.surfaceArea ? api.surfaceArea + ' m²' : null;
  const surfaceLocal = getBadge(local, 'Surface');
  if (surfaceApi && norm(surfaceLocal) !== norm(surfaceApi)) {
    diffs.push({ champ: 'Surface', local: surfaceLocal, api: surfaceApi, grave: true });
  }

  // Pièces
  if (api.roomsQuantity) {
    const pLocal = getBadge(local, 'Pièces');
    if (!pLocal.startsWith(String(api.roomsQuantity))) {
      diffs.push({ champ: 'Pièces', local: pLocal, api: api.roomsQuantity + ' pièces', grave: false });
    }
  }

  // Meublé
  const meubApi  = api.isFurnished ? '✅ Oui' : '❌ Non';
  const meubLocal = getBadge(local, 'Meublé');
  if (meubLocal && meubLocal !== meubApi) {
    diffs.push({ champ: 'Meublé', local: meubLocal, api: meubApi, grave: true });
  }

  // DPE
  const dpeApi = api.energyClassification;
  const dpeLocal = getBadge(local, 'DPE');
  if (dpeApi && dpeLocal && !dpeLocal.toUpperCase().startsWith(dpeApi.toUpperCase())) {
    diffs.push({ champ: 'DPE', local: dpeLocal, api: dpeApi, grave: false });
  }

  // Étage
  if (api.floor) {
    const etageLocal = getBadge(local, 'Étage');
    if (etageLocal && !etageLocal.startsWith(String(api.floor))) {
      diffs.push({ champ: 'Étage', local: etageLocal, api: api.floor + 'e', grave: false });
    }
  }

  return diffs;
}

// ── main ──────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const GREY   = '\x1b[90m';

async function main() {
  console.log(`\n${BOLD}🔍 Vérification des annonces${RESET}\n`);

  let nbOk = 0, nbWarn = 0, nbErr = 0, nbSkip = 0;

  for (const annonce of ANNONCES) {
    const source = annonce.source || '';
    const label  = `#${annonce.id} — ${annonce.titre}`;

    // Seul Bien'ici est vérifiable via API
    if (!/bienici/i.test(source)) {
      console.log(`${GREY}⏭  ${label} [${source} — non vérifiable]${RESET}`);
      nbSkip++;
      continue;
    }

    const id = extractId(annonce.lien);
    if (!id) {
      console.log(`${YELLOW}⚠  ${label} — impossible d'extraire l'ID du lien${RESET}`);
      nbWarn++;
      continue;
    }

    try {
      const api = await fetchJSON(`https://www.bienici.com/realEstateAd.json?id=${id}`);

      // Vérifier si l'annonce est toujours en ligne
      if (api.status && api.status.onTheMarket === false) {
        console.log(`${YELLOW}⚠  ${label}${RESET}`);
        console.log(`   ${YELLOW}→ Annonce retirée du marché${RESET}`);
        nbWarn++;
        continue;
      }

      const diffs = comparer(annonce, api);

      if (diffs.length === 0) {
        console.log(`${GREEN}✅ ${label}${RESET}`);
        nbOk++;
      } else {
        const hasGrave = diffs.some(d => d.grave);
        const icon = hasGrave ? `${RED}❌` : `${YELLOW}⚠ `;
        console.log(`${icon} ${label}${RESET}`);
        for (const d of diffs) {
          const col = d.grave ? RED : YELLOW;
          console.log(`   ${col}${d.champ}${RESET} : local="${d.local}" → api="${d.api}"`);
        }
        if (hasGrave) nbErr++; else nbWarn++;
      }
    } catch(e) {
      console.log(`${RED}💥 ${label} — erreur : ${e.message}${RESET}`);
      nbErr++;
    }

    // Pause entre requêtes pour respecter l'API
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${BOLD}Résultat :${RESET} ${GREEN}${nbOk} ok${RESET}  ${YELLOW}${nbWarn} avertissements${RESET}  ${RED}${nbErr} erreurs${RESET}  ${GREY}${nbSkip} ignorés${RESET}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
