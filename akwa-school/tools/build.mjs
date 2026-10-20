#!/usr/bin/env node
/* =====================================================================================
   Construction d'AKWA SCHOOL : assemble les sources modulaires (src/) en un fichier HTML
   unique et autonome (dist/), utilisable hors ligne en double-cliquant dessus.

     node tools/build.mjs            → dist/AKWA_SCHOOL.html et dist/AKWA_SCHOOL_verification_modele.html
     node tools/build.mjs --verifier → contrôle seulement que chaque script se compile

   Aucune dépendance : Node 18 ou plus récent suffit.
   ===================================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RACINE, 'src');
const DIST = join(RACINE, 'dist');
const manifeste = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const lire = (p) => readFileSync(join(SRC, p), 'utf8');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const enDataUrl = (p) => `data:${MIME[extname(p)]};base64,${readFileSync(join(SRC, p)).toString('base64')}`;

/* Interdit la fermeture prématurée d'une balise <script> ou <style> dans le code inclus. */
const sur = (code, balise) => {
  if (new RegExp(`</${balise}`, 'i').test(code)) throw new Error(`« </${balise} » présent dans un fichier inclus : remplacez par <\\/${balise}`);
  return code;
};

function verifierSyntaxe(nom, code) {
  try {
    new vm.Script(code, { filename: nom });
  } catch (e) {
    console.error(`Erreur de syntaxe dans ${nom} : ${e.message}`);
    process.exit(1);
  }
}

/* Ressources intégrées : logo, armoiries, photos (images de l'école), illustration. */
function moduleRessources() {
  const a = manifeste.ressources;
  const photos = Object.fromEntries(Object.entries(a.photos || {}).map(([k, p]) => [k, enDataUrl(p)]));
  const obj = { logo: enDataUrl(a.logo), armoiries: enDataUrl(a.armoiries), photos };
  return `/* Ressources intégrées (générées par tools/build.mjs) */\n(function (AK) {\n  'use strict';\n  AK.assets = ${JSON.stringify(obj)};\n})(window.AK);\n`;
}

function construireVerificateur() {
  const v = manifeste.verificateur;
  const css = v.css.map((p) => sur(lire(p), 'style')).join('\n');
  const js = v.js.map((p) => {
    const c = lire(p);
    verifierSyntaxe(p, c);
    return `<script>\n${sur(c, 'script')}\n//# sourceURL=akwa/${p}\n</script>`;
  }).join('\n');
  return lire(v.gabarit)
    .replace('<!-- @CSS -->', () => `<style>\n${css}\n</style>`)
    .replace('<!-- @JS -->', () => js)
    .replace(/@VERSION/g, manifeste.version);
}

function construire() {
  const css = manifeste.css.map((p) => `/* ==== ${p} ==== */\n${sur(lire(p), 'style')}`).join('\n');
  const verif = existsSync(join(SRC, manifeste.verificateur.gabarit)) ? construireVerificateur() : '';
  const modules = manifeste.js.map((p) => {
    let code = p === '@ressources' ? moduleRessources() : p === '@verificateur' ? `(function (AK) { AK.gabaritVerificateur = ${JSON.stringify(verif).replace(/<\//g, '<\\/')}; })(window.AK);\n` : lire(p);
    verifierSyntaxe(p, code);
    return `<script>\n${sur(code, 'script')}\n//# sourceURL=akwa/${p.replace('@', '')}\n</script>`;
  });
  const page = lire('index.html')
    .replace('<!-- @CSS -->', () => `<style>\n${css}\n</style>`)
    .replace('<!-- @JS -->', () => modules.join('\n'))
    .replace(/@VERSION/g, manifeste.version);
  return { page, verif };
}

const { page, verif } = construire();
if (process.argv.includes('--verifier')) {
  console.log(`Syntaxe correcte : ${manifeste.js.length} scripts, ${manifeste.css.length} feuilles de style.`);
  process.exit(0);
}
mkdirSync(DIST, { recursive: true });
const sortie = join(DIST, 'AKWA_SCHOOL.html');
writeFileSync(sortie, page);
if (verif) writeFileSync(join(DIST, 'AKWA_SCHOOL_verification_modele.html'), verif);
const ko = (f) => (statSync(f).size / 1024).toFixed(0) + ' Ko';
console.log(`AKWA SCHOOL ${manifeste.version} construit : ${basename(sortie)} (${ko(sortie)})`);
if (verif) console.log(`Outil de vérification (modèle sans clé) : AKWA_SCHOOL_verification_modele.html (${ko(join(DIST, 'AKWA_SCHOOL_verification_modele.html'))})`);
