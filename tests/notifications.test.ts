/** Étape 11 (1/2) : notifications, alertes quotidiennes, historique, assistant du directeur. */
import { beforeAll, describe, expect, it } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import { ATTENDU, ecoleDuClasseur, enseignantDe } from "./aides/classeur";
import { alertesQuotidiennes, marquerLues, mesNotifications, nombreNonLues } from "../src/lib/notifications";
import { differences, journalEcole } from "../src/lib/historique";
import { reconnaitre, repondre } from "../src/lib/assistant";
import { changerEtatFeuille } from "../src/lib/notes";
import { journaliser } from "../src/lib/audit";

describe("Assistant : reconnaissance des questions", () => {
  it.each([
    ["Combien d'élèves sont inscrits ?", "effectif"],
    ["quel est le taux de réussite de l'école", "reussite"],
    ["Quels élèves n'ont pas d'extrait de naissance", "extraits"],
    ["Qui s'absente le plus ?", "absences"],
    ["prochaine composition", "prochaine"],
    ["Les orphelins", "orphelins"],
    ["Quand expire l'abonnement ?", "abonnement"],
    ["élèves en difficulté", "difficulte"],
    ["Quel temps fait-il ?", null],
  ])("« %s » → %s", (q, cle) => {
    expect(reconnaitre(q)).toBe(cle);
  });
});

describe("Historique : différences lisibles", () => {
  it("ne liste que les champs modifiés", () => {
    expect(differences({ a: 1.5, b: "x" }, { a: 2, b: "x", c: null })).toEqual(["a : 1,5 → 2"]);
    expect(differences(null, { fullName: "KONE", notes: null, date: "2026-11-10" })).toEqual(["Nom et prénoms : KONE", "Date : 10/11/2026"]);
    expect(differences(null, { changements: [{ eleve: "CE1-001-26", matiere: "DICTEE", avant: 6.5, apres: 9.5 }] })).toEqual(["CE1-001-26 DICTEE : 6,5 → 9,5"]);
  });
});

describe.skipIf(!baseDisponible)("Notifications, historique et assistant", () => {
  const db = baseDeTest();
  let ecole: Awaited<ReturnType<typeof ecoleDuClasseur>>;

  beforeAll(async () => {
    await viderBase(db);
    ecole = await ecoleDuClasseur(db);
  }, 60_000);

  it("assistant : chiffres identiques au tableau de bord du classeur", async () => {
    const id = ecole.school.id;
    const eff = await repondre(db, id, "effectif");
    expect(eff.texte).toContain(`${ATTENDU.tableauDeBord.effectif} élèves`);
    const r = await repondre(db, id, "reussite");
    expect(r.texte).toContain(`${ATTENDU.tableauDeBord.presents} présents`);
    const ext = await repondre(db, id, "extraits");
    expect(ext.tableau?.lignes).toHaveLength(ATTENDU.tableauDeBord.sansExtrait);
    const ab = await repondre(db, id, "abandons");
    expect(ab.tableau!.lignes.length).toBe(ATTENDU.tableauDeBord.effectif - ATTENDU.tableauDeBord.presents);
    const prochaine = await repondre(db, id, "prochaine", new Date("2026-12-01T00:00:00Z"));
    expect(prochaine.texte).toContain("09/12/2026");
    const abs = await repondre(db, id, "absences", new Date("2026-10-15T00:00:00Z"));
    expect(abs.tableau!.lignes.length).toBeGreaterThan(0);
    for (const cle of ["classes", "meilleurs", "difficulte", "notes", "surage", "orphelins", "abonnement"] as const) {
      expect((await repondre(db, id, cle)).texte.length, cle).toBeGreaterThan(10);
    }
  });

  it("alertes quotidiennes : évaluation dans 3 jours et notes à terminer, une seule fois", async () => {
    const ens = await enseignantDe(db, ecole.directeur, "CE1");
    const c1 = await db.assessment.findFirstOrThrow({ where: { schoolId: ecole.school.id, number: 1, track: "STANDARD" } });
    const avant = new Date(c1.date!.getTime() - 3 * 86_400_000 + 3_600_000);
    expect(await alertesQuotidiennes(db, avant)).toBeGreaterThanOrEqual(2);
    expect(await alertesQuotidiennes(db, avant)).toBe(0);
    expect((await mesNotifications(db, ens.id)).map((n) => n.title)).toContain("Évaluation dans 3 jours");
    expect((await mesNotifications(db, ecole.directeur.id)).map((n) => n.title)).toContain("Évaluation dans 3 jours");

    // 8 jours après : la feuille du CE1 est encore ouverte dans les données du classeur
    const apres = new Date(c1.date!.getTime() + 8 * 86_400_000);
    await alertesQuotidiennes(db, apres);
    expect((await mesNotifications(db, ens.id)).some((n) => n.title === "Notes à terminer : CE1")).toBe(true);
    // Le même rappel n'est pas renvoyé le lendemain
    const n = (await mesNotifications(db, ens.id)).length;
    await alertesQuotidiennes(db, new Date(apres.getTime() + 86_400_000));
    expect((await mesNotifications(db, ens.id)).length).toBe(n);
  });

  it("réouverture par le directeur : l'enseignant est prévenu ; lecture de ses seules notifications", async () => {
    const ens = await enseignantDe(db, ecole.directeur, "CM1");
    const cm1 = await db.classroom.findFirstOrThrow({ where: { schoolId: ecole.school.id, name: "CM1" } });
    await changerEtatFeuille(db, ecole.directeur, cm1.id, 1, "verrouiller");
    expect((await changerEtatFeuille(db, ecole.directeur, cm1.id, 1, "rouvrir")).ok).toBe(true);
    const l = await mesNotifications(db, ens.id);
    expect(l[0].title).toBe("Feuille rouverte : CM1");
    expect(await nombreNonLues(db, ens.id)).toBeGreaterThan(0);
    // Le directeur ne peut pas marquer lues les notifications de l'enseignant
    await marquerLues(db, ecole.directeur.id, l[0].id);
    expect((await db.notification.findUniqueOrThrow({ where: { id: l[0].id } })).readAt).toBeNull();
    await marquerLues(db, ens.id, l[0].id);
    expect((await db.notification.findUniqueOrThrow({ where: { id: l[0].id } })).readAt).not.toBeNull();
    await marquerLues(db, ens.id);
    expect(await nombreNonLues(db, ens.id)).toBe(0);
  });

  it("historique : filtré par école, par données et par auteur", async () => {
    const autre = await ecoleDuClasseur(db, "0102030405", "AUTRE-ECOLE");
    await journaliser(db, { schoolId: autre.school.id, userId: autre.directeur.id, action: "modification", entity: "Student", before: { nom: "A" }, after: { nom: "B" } });
    const j = await journalEcole(db, ecole.school.id);
    expect(j.total).toBeGreaterThan(0);
    expect(j.lignes.every((l) => l.details.join() !== "nom : A → B")).toBe(true);
    const feuilles = await journalEcole(db, ecole.school.id, { entite: "ClassAssessment" });
    expect(feuilles.lignes.map((l) => l.action)).toEqual(["Réouverture", "Verrouillage"]);
    expect(feuilles.lignes[0].details).toContain("État : LOCKED → OPEN");
    const autreJ = await journalEcole(db, autre.school.id, { userId: autre.directeur.id });
    expect(autreJ.lignes[0].details).toEqual(["nom : A → B"]);
  });
});
