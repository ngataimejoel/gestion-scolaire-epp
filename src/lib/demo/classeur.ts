/**
 * Chargement des données d'exemple du classeur (EPP LIGUIYO, 64 élèves, 8 agents, notes, absences) dans une
 * école neuve. Sert aux tests de référence (les résultats doivent être identiques au classeur) et à
 * l'école de démonstration (npm run db:seed).
 */
import type { Db } from "../db";
import type { GuardianRelation } from "@/generated/prisma/client";
import { hacherMotDePasse } from "../auth/mot-de-passe";
import { normaliserTelephone } from "../auth/telephone";
import { preparerEcole } from "../parametres/service";

type Ligne = (string | number | null)[];
export interface DonneesClasseur {
  E: Record<string, string | number | null>[];
  N: Record<string, Ligne[]>;
  P: Record<string, string | number | null>[];
  AE: { date: string; mat: string; nature: string; jours: number | null; min: number | null; motif: string | null; just: string | null; obs: string | null }[];
  AP: DonneesClasseur["AE"];
  PAR: Record<string, unknown> & { ecole: string; code: string; annee: string };
}

const jour = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : null);
const txt = (v: unknown) => (v == null || v === "" || v === "-" ? null : String(v));

/** Crée l'école du classeur avec son directeur ; renvoie l'école et le compte directeur. */
export async function chargerClasseur(db: Db, D: DonneesClasseur, opts: { telephoneDirecteur: string; motDePasse: string; code?: string }) {
  const P = D.PAR as unknown as Record<string, string>;
  const anneeDebut = Number(P.annee.slice(0, 4));
  const passwordHash = await hacherMotDePasse(opts.motDePasse);

  const { school, directeur } = await db.$transaction(
    async (tx) => {
      const school = await tx.school.create({
        data: {
          name: P.ecole, code: opts.code ?? P.code, ministry: P.ministere, regionalDirectorate: P.dren, inspectorate: P.iepp,
          sector: P.secteur, locality: P.localite,
        },
      });
      await preparerEcole(tx, school.id, anneeDebut);
      await tx.schoolSettings.update({
        where: { schoolId: school.id },
        data: { directorName: P.directeur, reportDate: jour(P.dateEdition), expectedNewCp1: Number(P.nouveauxCP1) || 0 },
      });
      await tx.academicYear.updateMany({ where: { schoolId: school.id, isActive: true }, data: { ageReferenceDate: jour(P.dateRefAge)! } });
      const directeur = await tx.user.create({
        data: { schoolId: school.id, phone: opts.telephoneDirecteur, fullName: P.directeur, role: "DIRECTOR", passwordHash, phoneVerifiedAt: new Date() },
      });
      return { school, directeur };
    },
    { timeout: 30_000 },
  );

  const annee = await db.academicYear.findFirstOrThrow({ where: { schoolId: school.id, isActive: true } });
  const classes = new Map((await db.classroom.findMany({ where: { academicYearId: annee.id }, include: { level: true } })).map((c) => [c.name, c]));

  // Personnel et classes tenues
  for (const p of D.P) {
    const [nom, ...prenoms] = String(p.nom).split(" ");
    const s = await db.staff.create({
      data: {
        schoolId: school.id, matricule: String(p.mat), lastName: nom.toUpperCase(), firstNames: prenoms.join(" "), sex: p.sexe as "M" | "F",
        birthDate: jour(p.naiss), function: String(p.fonction), grade: txt(p.grade), diploma: txt(p.diplome), serviceStartDate: jour(p.priseService),
        arrivalDate: jour(p.arrivee), phone: normaliserTelephone(String(p.tel ?? "")), maritalStatus: txt(p.sitMat),
        userId: p.fonction === "DIRECTEUR" ? directeur.id : null,
      },
    });
    const c = classes.get(String(p.classe));
    if (c) await db.classTeacher.create({ data: { classroomId: c.id, staffId: s.id } });
  }

  // Élèves, parents et inscriptions
  const inscriptions = new Map<string, { id: string; niveau: string }>();
  for (const e of D.E) {
    const c = classes.get(String(e.classe))!;
    const parents: [GuardianRelation, string][] = [["PERE", "pere"], ["MERE", "mere"], ["TUTEUR", "tut"]];
    const s = await db.student.create({
      data: {
        schoolId: school.id, schoolMatricule: String(e.mat), despsId: txt(e.desps), fullName: String(e.nom), sex: e.sexe as "M" | "F",
        birthDate: jour(e.naiss), nationality: txt(e.nat), locality: txt(e.loc), subPrefecture: txt(e.sp), hasBirthCertificate: e.extrait !== "NON",
        certificateNumber: txt(e.acte), certificateDate: jour(e.acteDu), civilRegistryCenter: txt(e.centre), isOrphan: e.orphelin === "OUI",
        orphanOf: e.orphelin === "OUI" ? txt(e.orphDe) : null,
        guardians: {
          create: parents
            .map(([relation, k]) => ({ relation, fullName: txt(e[k === "tut" ? "tuteur" : k]), profession: txt(e[`${k}Prof`]), residence: txt(e[`${k}Res`]), phone: normaliserTelephone(String(e[`${k}Tel`] ?? "")) }))
            .filter((g): g is typeof g & { fullName: string } => !!g.fullName),
        },
        enrollments: {
          create: { academicYearId: annee.id, classroomId: c.id, isRepeating: e.redoublant === "OUI", status: e.statut as "PRESENT" | "ABANDON" | "TRANSFERE", notes: txt(e.obs) },
        },
      },
      include: { enrollments: true },
    });
    inscriptions.set(String(e.mat), { id: s.enrollments[0].id, niveau: c.level.code });
  }

  // Notes et colonne « Présent ? »
  const evaluations = await db.assessment.findMany({ where: { academicYearId: annee.id } });
  const matieres = await db.subject.findMany({ where: { schoolId: school.id }, orderBy: { position: "asc" } });
  const niveaux = new Map([...classes.values()].map((c) => [c.level.code, c.level]));
  const presences = [];
  const notes: { assessmentId: string; enrollmentId: string; subjectId: string; score: number }[] = [];
  for (const [mat, lignes] of Object.entries(D.N)) {
    const ins = inscriptions.get(mat);
    if (!ins) continue;
    const niveau = niveaux.get(ins.niveau)!;
    for (const [k, l] of lignes.entries()) {
      if (!l) continue;
      const ev = evaluations.find((a) => a.number === k + 1 && a.track === (ins.niveau === "CM2" ? "CM2" : "STANDARD"))!;
      presences.push({ assessmentId: ev.id, enrollmentId: ins.id, present: l[0] !== "NON" });
      const m = matieres.filter((x) => x.gradeSheet === niveau.gradeSheet && x.assessmentNumber === k + 1);
      l.slice(1).forEach((v, i) => {
        if (typeof v === "number" && m[i]) notes.push({ assessmentId: ev.id, enrollmentId: ins.id, subjectId: m[i].id, score: v });
      });
    }
  }
  await db.assessmentPresence.createMany({ data: presences });
  await db.grade.createMany({ data: notes });

  // Journaux des retards et absences
  const agents = new Map((await db.staff.findMany({ where: { schoolId: school.id } })).map((s) => [s.matricule, s.id]));
  const evenement = (a: DonneesClasseur["AE"][number]) => ({
    schoolId: school.id, academicYearId: annee.id, date: jour(a.date)!, nature: a.nature as "RETARD" | "ABSENCE",
    days: a.jours, minutes: a.min, reason: txt(a.motif), justified: a.just === "OUI", notes: txt(a.obs),
  });
  await db.attendanceEvent.createMany({
    data: [
      ...D.AE.filter((a) => inscriptions.has(a.mat)).map((a) => ({ ...evenement(a), enrollmentId: inscriptions.get(a.mat)!.id })),
      ...D.AP.filter((a) => agents.has(a.mat)).map((a) => ({ ...evenement(a), staffId: agents.get(a.mat)! })),
    ],
  });
  return { school, directeur, annee };
}
