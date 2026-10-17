import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { activer, genererCodes, liberer, lister, memoire, nouveauCode, normaliserCode, revoquer, traiter,
  verifierLicence } from "../lib/core.mjs";

const { privateKey } = crypto.generateKeyPairSync("ed25519");
const M1 = "a".repeat(64), M2 = "b".repeat(64);
const lire = (l) => JSON.parse(Buffer.from(l, "base64url").toString());

test("format et saisie des codes", () => {
  const c = nouveauCode();
  assert.match(c, /^EPP-([2-9A-HJ-NP-Z]{4}-){3}[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(normaliserCode(c.toLowerCase().replaceAll("-", " ")), c);
  assert.equal(normaliserCode("EPP-0000-1111-2222-3333"), null);   // 0 et 1 n'existent pas
  assert.equal(new Set(Array.from({ length: 2000 }, nouveauCode)).size, 2000);
  // un code tiré au hasard peut commencer par « EPP » (1 chance sur 32 768) : il reste valable
  assert.equal(normaliserCode("EPP-EPPA-BCDE-FGHJ-KLMN"), "EPP-EPPA-BCDE-FGHJ-KLMN");
  assert.equal(normaliserCode("eppa bcde fghj klmn"), "EPP-EPPA-BCDE-FGHJ-KLMN");   // saisi sans le préfixe
});

test("un code ne sert qu'une seule fois", async () => {
  const s = memoire();
  const [{ code }] = await genererCodes(s, { type: "vie", nombre: 1, note: "EPP OUANINOU 2" });
  const r = await activer(s, privateKey, { code, machine: M1, ecole: "EPP OUANINOU 2" });
  const l = verifierLicence(privateKey, r.licence, r.signature);
  assert.equal(l.type, "vie"); assert.equal(l.expire_le, null); assert.equal(l.machine, M1);
  await assert.rejects(activer(s, privateKey, { code, machine: M2 }), { status: 409 });
  // réinstallation sur le même ordinateur : même licence, pas de nouvelle activation
  const r2 = await activer(s, privateKey, { code, machine: M1 });
  assert.equal(r2.licence, r.licence); assert.ok(r2.reactivation);
});

test("code 1 an : échéance à 365 jours, renouvellement sans perte des jours restants", async () => {
  const s = memoire();
  const [a, b] = await genererCodes(s, { type: "1an", nombre: 2 });
  const t0 = new Date("2026-10-13T10:00:00Z");
  const r = await activer(s, privateKey, { code: a.code, machine: M1 }, t0);
  assert.equal(lire(r.licence).expire_le, "2027-10-13T10:00:00.000Z");
  const t1 = new Date("2027-09-13T10:00:00Z");   // renouvelé un mois avant l'échéance
  const r2 = await activer(s, privateKey, { code: b.code, machine: M1, licence_actuelle: r.licence,
    signature_actuelle: r.signature }, t1);
  assert.equal(lire(r2.licence).expire_le, "2028-10-12T10:00:00.000Z");
});

test("une licence falsifiée n'est pas acceptée pour prolonger", async () => {
  const s = memoire();
  const [b] = await genererCodes(s, { type: "1an" });
  const faux = Buffer.from(JSON.stringify({ machine: M1, expire_le: "2099-01-01T00:00:00Z" })).toString("base64url");
  const t = new Date("2026-10-13T00:00:00Z");
  const r = await activer(s, privateKey, { code: b.code, machine: M1, licence_actuelle: faux, signature_actuelle: "AAAA" }, t);
  assert.equal(lire(r.licence).expire_le, "2027-10-13T00:00:00.000Z");
});

test("codes inconnus, annulés, libérés", async () => {
  const s = memoire();
  await assert.rejects(activer(s, privateKey, { code: nouveauCode(), machine: M1 }), { status: 404 });
  await assert.rejects(activer(s, privateKey, { code: "n'importe quoi", machine: M1 }), { status: 400 });
  const [{ code }, { code: c2 }] = await genererCodes(s, { type: "vie", nombre: 2 });
  await activer(s, privateKey, { code, machine: M1 });
  await liberer(s, code);                        // changement d'ordinateur autorisé par le fournisseur
  await activer(s, privateKey, { code, machine: M2 });
  await revoquer(s, c2);
  await assert.rejects(activer(s, privateKey, { code: c2, machine: M1 }), { status: 403 });
  const liste = await lister(s);
  assert.equal(liste.length, 2);
  assert.ok(liste.find((x) => x.code === code).utilise);
});

test("activations simultanées du même code : une seule réussit", async () => {
  const s = memoire();
  const [{ code }] = await genererCodes(s, { type: "vie" });
  const res = await Promise.allSettled([M1, M2].map((m) => activer(s, privateKey, { code, machine: m })));
  assert.equal(res.filter((r) => r.status === "fulfilled").length, 1);
});

test("API HTTP : administration protégée par jeton", async () => {
  const ctx = { store: memoire(), privateKey, jetonAdmin: "x".repeat(40) };
  const req = (chemin, init = {}) => traiter(new Request(`https://a.example${chemin}`, init), ctx);
  assert.equal((await req("/api/admin/codes")).status, 401);
  assert.equal((await req("/api/admin/codes", { headers: { authorization: "Bearer mauvais" } })).status, 401);
  const r = await req("/api/admin/codes", { method: "POST", headers: { authorization: `Bearer ${"x".repeat(40)}` },
    body: JSON.stringify({ type: "1an", nombre: 3, note: "test" }) });
  assert.equal(r.status, 201);
  const { codes } = await r.json();
  const a = await req("/api/activer", { method: "POST", body: JSON.stringify({ code: codes[0].code, machine: M1 }) });
  assert.equal(a.status, 200);
  assert.equal((await req("/api/activer", { method: "POST", body: "{" })).status, 400);
});

test("codes enseignant : seulement pour l'espace enseignant", async () => {
  const s = memoire();
  const [{ code }, { code: c2 }] = await genererCodes(s, { type: "ens1an", nombre: 2 });
  await assert.rejects(activer(s, privateKey, { code, machine: M1 }), { status: 403 });
  await assert.rejects(activer(s, privateKey, { code, machine: M1, espace: "ecole" }), { status: 403 });
  const r = await activer(s, privateKey, { code, machine: M1, espace: "enseignant" });
  const l = verifierLicence(privateKey, r.licence, r.signature);
  assert.equal(l.type, "ens1an"); assert.ok(l.expire_le);
  const [{ code: v }] = await genererCodes(s, { type: "ensvie" });
  assert.equal(lire((await activer(s, privateKey, { code: v, machine: M2, espace: "enseignant" })).licence).expire_le, null);
  // un code école reste accepté dans l'espace enseignant
  const [{ code: e }] = await genererCodes(s, { type: "1an" });
  assert.ok((await activer(s, privateKey, { code: e, machine: M2, espace: "enseignant" })).licence);
  assert.ok(c2);
});
