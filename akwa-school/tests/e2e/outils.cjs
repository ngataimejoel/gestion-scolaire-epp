/* Outils communs des tests de bout en bout (Playwright + Chromium, fichier ouvert en file://). */
const path = require('node:path');
const fs = require('node:fs');
function chargerPlaywright() {
  const essais = ['playwright', '/opt/node22/lib/node_modules/playwright', path.join(process.env.NODE_PATH || '', 'playwright')];
  for (const e of essais) {
    try { return require(e); } catch (x) { /* essai suivant */ }
  }
  throw new Error('Playwright introuvable : installez-le (npm i -D playwright) ou définissez NODE_PATH.');
}
const { chromium } = chargerPlaywright();
const FICHIER = process.env.AKWA_FICHIER ? path.resolve(process.env.AKWA_FICHIER) : path.resolve(__dirname, '../../dist/AKWA_SCHOOL.html');
const URL = 'file://' + FICHIER;

async function ouvrir({ largeur = 1366, hauteur = 860, profil } = {}) {
  const navigateur = await chromium.launch();
  const contexte = profil ? await chromium.launchPersistentContext(profil, { viewport: { width: largeur, height: hauteur } }) : await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, acceptDownloads: true });
  const page = contexte.pages ? contexte.pages()[0] || (await contexte.newPage()) : await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push('CONSOLE ' + m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!/^(file|data|blob):/.test(u)) erreurs.push('RESEAU ' + u); });
  return { navigateur, contexte, page, erreurs };
}
async function creerEcole(page, { mdp = 'Ecole2026a', nom = 'EPP TEST 1' } = {}) {
  await page.goto(URL);
  await page.waitForSelector('[data-ep="creer"]');
  await page.click('[data-ep="creer"]');
  await page.fill('[name=name]', nom);
  await page.fill('[name=drenaet]', 'Touba');
  await page.fill('[name=iepp]', 'Ouaninou');
  await page.fill('[name=director]', 'KONE Ali');
  await page.click('.btn-pri');
  await page.waitForSelector('[name=year]');
  await page.click('.btn-pri');
  await page.waitForSelector('[name=mdp]');
  await page.fill('[name=mdp]', mdp);
  await page.fill('[name=mdp2]', mdp);
  await page.click('.btn-pri');
  await page.waitForSelector('.code-secours', { timeout: 20000 });
  const code = (await page.textContent('.code-secours')).trim();
  await page.check('dialog [name=note]');
  await page.click('dialog [type=submit]');
  await page.waitForSelector('#contenu .accueil-tete');
  return { code, mdp };
}
async function demo(page) {
  await page.goto(URL);
  await page.waitForSelector('[data-ep="demo"]');
  await page.click('[data-ep="demo"]');
  await page.waitForSelector('.ep-profil');
  await page.fill('[name=mdp]', 'Demo2026');
  await page.click('.ep-contenu .btn-pri');
  await page.waitForSelector('#contenu .accueil-tete');
}
async function aller(page, route) {
  await page.evaluate((r) => { if (location.hash === '#' + r) AK.shell.dessiner(); else location.hash = r; }, route);
  await page.waitForTimeout(120);
}
async function confirmerMdp(page, mdp) {
  await page.waitForSelector('dialog[open] #mdp-admin');
  const d = page.locator('dialog[open]:has(#mdp-admin)').last();
  await d.locator('#mdp-admin').fill(mdp);
  await d.locator('[type=submit]').click();
}
module.exports = { chromium, URL, FICHIER, ouvrir, creerEcole, demo, aller, confirmerMdp, fs, path };
