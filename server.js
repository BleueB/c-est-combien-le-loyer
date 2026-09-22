// Serveur local CCTL — écrit les nouvelles annonces dans annonces.js
// Usage : node server.js
// Puis ouvre http://localhost:3000/admin.html

const http = require('http');
const fs   = require('fs');
const path = require('path');

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

// ── helpers ──────────────────────────────────────────────────────────────────

function nextId() {
  const src = fs.readFileSync(ANNONCES, 'utf8');
  const ids  = [...src.matchAll(/^\s*id:\s*(\d+)/gm)].map(m => parseInt(m[1]));
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function appendAnnonce(annonce) {
  const src = fs.readFileSync(ANNONCES, 'utf8');

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

// ── serveur ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS pour les appels fetch depuis le même localhost
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // POST /save-annonce
  if (req.method === 'POST' && req.url === '/save-annonce') {
    try {
      const body    = await readBody(req);
      const annonce = JSON.parse(body);
      const id      = appendAnnonce(annonce);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
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
