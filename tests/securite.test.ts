/**
 * Étape 12 : vérifications transversales des règles de sécurité du cahier des charges.
 * - aucun secret côté navigateur, aucun mot de passe en clair ;
 * - chaque action serveur vérifie l'utilisateur, et chaque écriture respecte la lecture seule (abonnement expiré) ;
 * - chaque route d'export ou d'API contrôle l'accès ;
 * - une école ne lit ni ne modifie jamais les données d'une autre.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import { ecoleDuClasseur, enseignantDe } from "./aides/classeur";
import { ficheEleve, listerEleves, modifierEleve, supprimerEleve } from "../src/lib/eleves";
import { changerActivationCompte, listerPersonnel, modifierPersonnel, supprimerPersonnel } from "../src/lib/personnel";
import { changerEtatFeuille, feuilleDeNotes } from "../src/lib/notes";
import { enregistrerEvenement, journalEvenements, supprimerEvenement } from "../src/lib/absences";
import { supprimerClasse } from "../src/lib/parametres/service";
import { creerCompteEnseignant } from "../src/lib/auth/service";
import { mesNotifications } from "../src/lib/notifications";
import { journalEcole } from "../src/lib/historique";
import { repondre } from "../src/lib/assistant";
import { exporterClasseur } from "../src/lib/classeur/ecriture";
import { lireClasseur } from "../src/lib/classeur/lecture";

const RACINE = path.join(__dirname, "..");
function fichiers(dossier: string, filtre: RegExp): string[] {
  return fs.readdirSync(path.join(RACINE, dossier), { withFileTypes: true, recursive: true })
    .filter((f) => f.isFile() && filtre.test(f.name))
    .map((f) => path.join(f.parentPath, f.name));
}
const lire = (f: string) => fs.readFileSync(f, "utf8");
const rel = (f: string) => path.relative(RACINE, f);

/** Corps de chaque fonction exportée d'un fichier d'actions (du mot-clé au suivant). */
function actions(f: string) {
  const src = lire(f);
  return src.split(/(?=export async function )/).slice(1).map((c) => ({ nom: c.match(/export async function (\w+)/)![1], corps: c }));
}

describe("Secrets et mots de passe", () => {
  it("aucun composant exécuté dans le navigateur ne lit une variable d'environnement", () => {
    const clients = fichiers("src", /\.(tsx?|jsx?)$/).filter((f) => /^\s*["']use client["']/.test(lire(f)));
    expect(clients.length).toBeGreaterThan(5);
    for (const f of clients) expect(lire(f), rel(f)).not.toMatch(/process\.env/);
  });

  it("aucune variable publique (NEXT_PUBLIC_) et aucune clé écrite en dur dans le code", () => {
    for (const f of [...fichiers("src", /\.(tsx?|mjs)$/), path.join(RACINE, ".env.example"), path.join(RACINE, "next.config.ts")]) {
      const s = lire(f);
      expect(s, rel(f)).not.toMatch(/^[^#\n]*NEXT_PUBLIC_/m);
      expect(s, rel(f)).not.toMatch(/(sk_live|sk_test|wave_sn_prod|re_[A-Za-z0-9]{20,})/);
    }
    // Toutes les clés de .env.example sont vides ou de simples réglages (aucun secret livré)
    for (const l of lire(path.join(RACINE, ".env.example")).split("\n")) {
      const m = l.match(/^(\w*(SECRET|KEY|MOT_DE_PASSE)\w*)="(.*)"$/);
      if (m) expect(m[3], m[1]).toBe("");
    }
  });

  it("les prix des offres ne sont pas écrits dans les pages", () => {
    for (const f of fichiers("src/app", /\.tsx$/)) expect(lire(f), rel(f)).not.toMatch(/\b(30\s?000|60\s?000)\b/);
  });
});

describe("Contrôle d'accès des actions et des routes", () => {
  const dossierActions = path.join(RACINE, "src/app/actions");
  it("chaque action serveur (hors connexion) vérifie l'utilisateur", () => {
    for (const f of fs.readdirSync(dossierActions).filter((n) => n !== "auth.ts")) {
      for (const a of actions(path.join(dossierActions, f))) expect(a.corps, `${f} ${a.nom}`).toMatch(/exigerUtilisateur\(|executer\(/);
    }
  });

  it("chaque action qui écrit dans les données de l'école respecte la lecture seule", () => {
    const ecritures = ["absences.ts", "eleves.ts", "import.ts", "notes.ts", "parametres.ts", "personnel.ts", "rapports.ts"];
    const exceptions = new Set(["actionAnnulerImport"]); // annuler n'écrit rien dans l'école
    for (const f of ecritures)
      for (const a of actions(path.join(dossierActions, f)))
        if (!exceptions.has(a.nom)) expect(a.corps, `${f} ${a.nom}`).toMatch(/ecritureBloquee\(|executer\(/);
    expect(lire(path.join(dossierActions, "parametres.ts"))).toMatch(/async function executer[\s\S]*?ecritureBloquee\(/);
  });

  it("chaque route d'export et d'API contrôle l'accès", () => {
    for (const f of fichiers("src/app/export", /^route\.ts$/)) expect(lire(f), rel(f)).toMatch(/role !== "DIRECTOR"[\s\S]*status: 403/);
    expect(lire(path.join(RACINE, "src/app/api/taches/route.ts"))).toMatch(/CRON_SECRET/);
    expect(lire(path.join(RACINE, "src/app/api/paiement/[fournisseur]/route.ts"))).toMatch(/lireNotification|verifier/);
  });

  it("toutes les pages de l'espace connecté sont protégées par le proxy", () => {
    const proxy = lire(path.join(RACINE, "src/proxy.ts"));
    const pages = fs.readdirSync(path.join(RACINE, "src/app/(espace)"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const p of pages) expect(proxy, p).toContain(`"/${p}/:path*"`);
  });
});

describe.skipIf(!baseDisponible)("Isolation entre écoles (toutes les données)", () => {
  const db = baseDeTest();
  let a: Awaited<ReturnType<typeof ecoleDuClasseur>>;
  let b: Awaited<ReturnType<typeof ecoleDuClasseur>>;

  beforeAll(async () => {
    await viderBase(db);
    a = await ecoleDuClasseur(db, "0730908035", "EPP-A");
    b = await ecoleDuClasseur(db, "0101010101", "EPP-B");
  }, 120_000);

  it("les mots de passe sont stockés hachés (argon2), jamais en clair", async () => {
    const users = (await db.user.findMany()).filter((u) => u.passwordHash);
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u.passwordHash).toMatch(/^\$argon2/);
      expect(u.passwordHash).not.toContain("Ecole2026");
    }
  });

  it("élèves : l'école A ne lit, ne modifie ni ne supprime un élève de B", async () => {
    const eleveB = await db.student.findFirstOrThrow({ where: { schoolId: b.school.id } });
    expect(await ficheEleve(db, a.directeur, eleveB.id)).toBeNull();
    expect((await supprimerEleve(db, a.directeur, eleveB.id)).ok).toBe(false);
    expect((await modifierEleve(db, a.directeur, eleveB.id, { fullName: "X" } as never)).ok).toBe(false);
    expect((await listerEleves(db, a.directeur)).every((e) => e.student.schoolId === a.school.id)).toBe(true);
    expect(await db.student.findUnique({ where: { id: eleveB.id } })).not.toBeNull();
  });

  it("personnel : ni modification, ni suppression, ni compte créé pour un agent de B", async () => {
    const agentB = await db.staff.findFirstOrThrow({ where: { schoolId: b.school.id, function: { not: "DIRECTEUR" } } });
    expect((await modifierPersonnel(db, a.directeur, agentB.id, { lastName: "X" })).ok).toBe(false);
    expect((await supprimerPersonnel(db, a.directeur, agentB.id)).ok).toBe(false);
    expect((await changerActivationCompte(db, a.directeur, agentB.id, false)).ok).toBe(false);
    expect((await creerCompteEnseignant(db, a.directeur, agentB.id)).ok).toBe(false);
    expect((await listerPersonnel(db, a.school.id)).some((p) => p.id === agentB.id)).toBe(false);
  });

  it("notes : ni lecture ni verrouillage d'une feuille de B, même par un enseignant de A", async () => {
    const cp1B = await db.classroom.findFirstOrThrow({ where: { name: "CP1", academicYear: { schoolId: b.school.id } } });
    expect(await feuilleDeNotes(db, a.directeur, cp1B.id, 1)).toBeNull();
    const ensA = await enseignantDe(db, a.directeur, "CP1");
    expect(await feuilleDeNotes(db, ensA, cp1B.id, 1)).toBeNull();
    expect((await changerEtatFeuille(db, a.directeur, cp1B.id, 1, "verrouiller")).ok).toBe(false);
  });

  it("absences : pas d'absence saisie pour un élève de B, ni supprimée", async () => {
    const insB = await db.enrollment.findFirstOrThrow({ where: { classroom: { academicYear: { schoolId: b.school.id } } } });
    const r = await enregistrerEvenement(db, a.directeur, { enrollmentId: insB.id, date: "2026-10-12", nature: "ABSENCE", days: "1" } as never);
    expect(r.ok).toBe(false);
    const evB = await db.attendanceEvent.findFirstOrThrow({ where: { schoolId: b.school.id } });
    expect((await supprimerEvenement(db, a.directeur, evB.id)).ok).toBe(false);
    expect(await db.attendanceEvent.findUnique({ where: { id: evB.id } })).not.toBeNull();
    const journal = await journalEvenements(db, a.directeur, "eleve");
    expect(JSON.stringify(journal)).not.toContain(evB.id);
  });

  it("paramètres : une classe de B ne peut pas être supprimée par A", async () => {
    const cm2B = await db.classroom.findFirstOrThrow({ where: { name: "CM2", academicYear: { schoolId: b.school.id } } });
    expect((await supprimerClasse(db, a.directeur, cm2B.id)).ok).toBe(false);
  });

  it("historique, notifications, assistant et export ne contiennent que les données de l'école", async () => {
    const nomsB = new Set((await db.student.findMany({ where: { schoolId: b.school.id }, select: { id: true } })).map((s) => s.id));
    const j = await journalEcole(db, a.school.id);
    expect(j.lignes.length).toBeGreaterThan(0);
    const logsB = await db.auditLog.findMany({ where: { schoolId: b.school.id }, select: { id: true } });
    expect(j.lignes.some((l) => logsB.some((x) => x.id === l.id))).toBe(false);
    expect((await mesNotifications(db, a.directeur.id)).every((n) => n.userId === a.directeur.id)).toBe(true);
    const eff = await repondre(db, a.school.id, "effectif");
    expect(eff.texte).toContain("64 élèves");
    const l = await lireClasseur(await exporterClasseur(db, a.school.id, "complet"));
    expect(l.donnees.E).toHaveLength(64);
    expect(nomsB.size).toBe(64);
  });
});
