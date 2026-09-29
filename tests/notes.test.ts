/** Étape 7 : feuilles de notes, contrôle de saisie, validation et verrouillage. */
import { beforeAll, describe, expect, it } from "vitest";
import { baseDeTest, baseDisponible, viderBase } from "./aides/base";
import { ATTENDU, DONNEES, ecoleDuClasseur, enseignantDe } from "./aides/classeur";
import { changerEtatFeuille, enregistrerNotes, feuilleDeNotes, tableauDesClasses, type FeuilleDeNotes, type SaisieLigne } from "../src/lib/notes";

type U = Awaited<ReturnType<typeof ecoleDuClasseur>>["directeur"];

/** Saisie identique au contenu actuel de la feuille (point de départ des modifications). */
const saisieActuelle = (f: FeuilleDeNotes): SaisieLigne[] =>
  f.lignes.map((l) => ({
    enrollmentId: l.enrollmentId,
    present: l.present !== false,
    notes: Object.fromEntries(f.matieres.map((m, i) => [m.id, l.notes[i] == null ? "" : String(l.notes[i]).replace(".", ",")])),
  }));

describe.skipIf(!baseDisponible)("Feuilles de notes", () => {
  const db = baseDeTest();
  let directeur: U;
  let ens: U;
  let classes: Map<string, string>;

  beforeAll(async () => {
    await viderBase(db);
    ({ directeur } = await ecoleDuClasseur(db));
    ens = await enseignantDe(db, directeur, "CE1");
    classes = new Map((await db.classroom.findMany({ where: { schoolId: directeur.schoolId! } })).map((c) => [c.name, c.id]));
  }, 60_000);

  it("les moyennes des 4 évaluations sont celles du classeur pour les 64 élèves", async () => {
    let comparees = 0;
    for (const [nom, id] of classes) {
      for (const k of [1, 2, 3, 4]) {
        const f = (await feuilleDeNotes(db, directeur, id, k))!;
        for (const l of f.lignes) {
          expect(l.moyenne, `${l.matricule} évaluation ${k}`).toBe(ATTENDU.resultats[l.matricule][k - 1]);
          comparees++;
        }
      }
      expect(nom).toBeTruthy();
    }
    expect(comparees).toBe(DONNEES.E.length * 4);
  });

  it("l'enseignant ne voit que sa classe", async () => {
    expect(await feuilleDeNotes(db, ens, classes.get("CE1")!, 1)).not.toBeNull();
    expect(await feuilleDeNotes(db, ens, classes.get("CP1")!, 1)).toBeNull();
    const tableau = await tableauDesClasses(db, ens);
    expect(tableau.map((c) => c.nom)).toEqual(["CE1"]);
  });

  it("contrôle du barème, empreinte et journal", async () => {
    const id = classes.get("CE1")!;
    const f = (await feuilleDeNotes(db, ens, id, 1))!;
    const s = saisieActuelle(f);
    const dictee = f.matieres.find((m) => m.nom === "DICTEE")!;
    s[0].notes[dictee.id] = "11"; // barème 10
    const refus = await enregistrerNotes(db, ens, id, 1, s, f.empreinte);
    expect(refus).toMatchObject({ ok: false, champ: `n:${s[0].enrollmentId}:${dictee.id}` });

    s[0].notes[dictee.id] = "9,5";
    const r = await enregistrerNotes(db, ens, id, 1, s, f.empreinte);
    expect(r).toMatchObject({ ok: true, modifications: 1 });
    // Une deuxième saisie partie de l'ancienne version est refusée : rien n'est écrasé en silence.
    const conflit = await enregistrerNotes(db, directeur, id, 1, s, f.empreinte);
    expect(conflit.ok).toBe(false);
    const apres = (await feuilleDeNotes(db, ens, id, 1))!;
    expect(apres.lignes[0].notes[f.matieres.indexOf(dictee)]).toBe(9.5);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "saisie_notes" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(log.after)).toContain('"apres":9.5');
  });

  it("absent : moyenne 0, notes conservées", async () => {
    const id = classes.get("CE1")!;
    const f = (await feuilleDeNotes(db, ens, id, 2))!;
    const s = saisieActuelle(f);
    s[1].present = false;
    expect((await enregistrerNotes(db, ens, id, 2, s, f.empreinte)).ok).toBe(true);
    const apres = (await feuilleDeNotes(db, ens, id, 2))!;
    expect(apres.lignes[1]).toMatchObject({ present: false, moyenne: 0 });
    expect(apres.lignes[1].notes).toEqual(f.lignes[1].notes);
  });

  it("validation, correction par le directeur, verrouillage et réouverture", async () => {
    const id = classes.get("CE1")!;
    // Feuille incomplète : validation refusée
    const f = (await feuilleDeNotes(db, ens, id, 3))!;
    const s = saisieActuelle(f);
    const premiere = f.lignes.findIndex((l) => l.statut === "PRESENT" && l.present !== false);
    s[premiere].notes[f.matieres[0].id] = "";
    expect((await enregistrerNotes(db, ens, id, 3, s, f.empreinte)).ok).toBe(true);
    expect(await changerEtatFeuille(db, ens, id, 3, "valider")).toMatchObject({ ok: false });

    const f2 = (await feuilleDeNotes(db, ens, id, 3))!;
    s[premiere].notes[f.matieres[0].id] = "30";
    expect((await enregistrerNotes(db, ens, id, 3, s, f2.empreinte)).ok).toBe(true);
    expect(await changerEtatFeuille(db, ens, id, 3, "valider")).toMatchObject({ ok: true, etat: "VALIDATED" });
    expect(await db.notification.count({ where: { userId: directeur.id } })).toBe(1);

    // L'enseignant ne peut plus modifier, le directeur si ; l'enseignant ne peut pas verrouiller.
    const f3 = (await feuilleDeNotes(db, ens, id, 3))!;
    expect(f3.modifiable).toBe(false);
    expect((await enregistrerNotes(db, ens, id, 3, s, f3.empreinte)).ok).toBe(false);
    expect(await changerEtatFeuille(db, ens, id, 3, "verrouiller")).toMatchObject({ ok: false });
    const f4 = (await feuilleDeNotes(db, directeur, id, 3))!;
    s[premiere].notes[f.matieres[0].id] = "31";
    expect((await enregistrerNotes(db, directeur, id, 3, s, f4.empreinte)).ok).toBe(true);

    expect(await changerEtatFeuille(db, directeur, id, 3, "verrouiller")).toMatchObject({ ok: true, etat: "LOCKED" });
    const f5 = (await feuilleDeNotes(db, directeur, id, 3))!;
    expect(f5.modifiable).toBe(false);
    expect((await enregistrerNotes(db, directeur, id, 3, s, f5.empreinte)).ok).toBe(false);

    expect(await changerEtatFeuille(db, directeur, id, 3, "rouvrir")).toMatchObject({ ok: true, etat: "OPEN" });
    expect((await feuilleDeNotes(db, ens, id, 3))!.modifiable).toBe(true);
  });

  it("tableau des classes : avancement de la saisie", async () => {
    const t = await tableauDesClasses(db, directeur);
    expect(t).toHaveLength(6);
    const cp1 = t.find((c) => c.nom === "CP1")!;
    expect(cp1.effectif).toEqual({ M: 5, F: 6 });
    expect(cp1.evaluations[0]).toMatchObject({ numero: 1, completes: 11, attendus: 11 });
    expect(cp1.enseignants).toHaveLength(1);
  });

  it("isolation : un directeur d'une autre école ne voit rien", async () => {
    const autre = await ecoleDuClasseur(db, "0102030405", "AUTRE-ECOLE");
    const id = classes.get("CE1")!;
    expect(await feuilleDeNotes(db, autre.directeur, id, 1)).toBeNull();
    expect(await changerEtatFeuille(db, autre.directeur, id, 1, "verrouiller")).toMatchObject({ ok: false });
  }, 60_000);
});
