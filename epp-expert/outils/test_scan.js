// Tests de la remise en ordre des scans (feuille de notes, extrait de naissance) : node outils/test_scan.js
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("assert");
const S = require("../android/app/src/main/assets/www/scan.js");

function ligne(t, x, y, w) {
  const mots = [];
  let cx = x;
  t.split(" ").forEach((m) => { const mw = m.length * 12; mots.push({ t: m, x: cx, y, w: mw, h: 20 }); cx += mw + 12; });
  return { t, x, y, w: w || cx - x, h: 20, mots };
}

// ---- feuille de notes : en-têtes, noms mal lus, notes à virgule, une note impossible, un élève illisible
const matieres = [{ id: 1, libelle: "LECTURE", max: 10 }, { id: 2, libelle: "MATHEMATIQUE", max: 10 },
  { id: 3, libelle: "ECRITURE", max: 10 }];
const eleves = [{ iid: 11, nom: "TANOH Adjoua Awa" }, { iid: 12, nom: "KOUASSI Yao Jean" }, { iid: 13, nom: "BAMBA Mariam" }];
const ocr = { lignes: [
  ligne("Nom et prénoms", 20, 10), ligne("LECTURE", 400, 10), ligne("MATHEMATIQUE", 520, 10), ligne("ECRITURE", 680, 10),
  ligne("TANOH Adjoua Awa", 20, 60), { t: "7,5", x: 430, y: 61, w: 30, h: 20 }, { t: "8", x: 570, y: 60, w: 12, h: 20 },
  { t: "6", x: 715, y: 59, w: 12, h: 20 },
  ligne("KOUASI Yao Jean", 20, 100), { t: "9", x: 432, y: 100, w: 12, h: 20 }, { t: "45", x: 571, y: 101, w: 24, h: 20 },
  { t: "O5", x: 712, y: 100, w: 24, h: 20 },
] };
const r = S.structurerNotes(ocr, eleves, matieres);
assert.strictEqual(r.colonnes, 3);
assert.deepStrictEqual(r.lignes[0].notes, { 1: { v: 7.5 }, 2: { v: 8 }, 3: { v: 6 } });
assert.strictEqual(r.lignes[1].trouve, true, "nom avec une lettre manquante retrouvé");
assert.deepStrictEqual(r.lignes[1].notes, { 1: { v: 9 }, 2: { v: 45, douteux: true }, 3: { v: 5 } });
assert.deepStrictEqual(r.absents, ["BAMBA Mariam"]);

// ---- extrait de naissance (texte imprimé typique)
const ext = { lignes: [
  "REPUBLIQUE DE COTE D'IVOIRE", "EXTRAIT DU REGISTRE DES ACTES DE L'ETAT CIVIL", "N° 1254 DU 14/03/2016",
  "Le douze mars deux mil seize à 10 heures 30", "est né KOUASSI Yao Jean", "à BOUAKE", "fils de KOUASSI Konan Paul",
  "et de YAO Ama Rose",
].map((t, i) => ({ t, x: 10, y: 10 + i * 30, w: 400, h: 20 })) };
const e = S.structurerExtrait(ext);
assert.strictEqual(e.nom, "KOUASSI YAO JEAN");
assert.strictEqual(e.date_naissance, "2016-03-12");
assert.strictEqual(e.localite, "BOUAKE");
assert.strictEqual(e.sexe, "M");
assert.strictEqual(e.pere_nom, "KOUASSI KONAN PAUL");
assert.strictEqual(e.mere_nom, "YAO AMA ROSE");
assert.strictEqual(e.observations, "Extrait de naissance n° 1254");
assert.strictEqual(S.date("le douze mars deux mil seize"), "2016-03-12");
assert.strictEqual(S.date("née le 05/11/2017 à Man"), "2017-11-05");
assert.strictEqual(S.nombreEnLettres(["QUATRE", "VINGT", "DIX", "NEUF"]), 99);
const e2 = S.structurerExtrait({ lignes: ["NOM : TRAORE", "Prénoms : Awa Fatou", "Sexe : F", "Date de naissance : 3 janvier 2018",
  "Lieu de naissance : KORHOGO", "Père : TRAORE Seydou", "Mère : KONE Mariam"].map((t, i) => ({ t, x: 0, y: i * 30, w: 300, h: 20 })) });
assert.deepStrictEqual(e2, { nom: "TRAORE AWA FATOU", sexe: "F", date_naissance: "2018-01-03", localite: "KORHOGO",
  pere_nom: "TRAORE SEYDOU", mere_nom: "KONE MARIAM" });
console.log("scan : extrait", JSON.stringify(e));
console.log("scan : tous les contrôles sont réussis");
