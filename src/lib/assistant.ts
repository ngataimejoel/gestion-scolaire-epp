/**
 * Assistant du directeur : réponses calculées sur les vraies données de l'école (aucune donnée n'est envoyée à
 * un service extérieur). La question est reconnue par mots-clés parmi une liste fermée ; chaque réponse cite
 * ses chiffres et renvoie vers la page où les vérifier.
 */
import type { Db } from "./db";
import { tableauDeBord } from "./bilans";
import { etatAbonnement } from "./abonnement";
import { anneesRevolues, estEnSurAge } from "./regles";
import { f2, pct } from "./format";

export interface Reponse {
  question: string;
  texte: string;
  tableau?: { entetes: string[]; lignes: (string | number)[][] };
  lien?: { href: string; libelle: string };
}

export const QUESTIONS = [
  { cle: "effectif", titre: "Quel est l'effectif de l'école ?", mots: ["effectif", "combien d'eleves", "nombre d'eleves", "inscrit", "garcons", "filles"] },
  { cle: "reussite", titre: "Quel est le taux de réussite ?", mots: ["reussite", "admission", "admis", "passage", "succes"] },
  { cle: "classes", titre: "Quelle classe a les résultats les plus faibles ?", mots: ["classe", "faible", "moins bon", "pire", "comparer"] },
  { cle: "meilleurs", titre: "Qui sont les premiers de chaque classe ?", mots: ["meilleur", "premier", "major", "excellent", "tete de classe"] },
  { cle: "difficulte", titre: "Quels élèves sont en difficulté ?", mots: ["difficult", "echec", "redoubl", "insuffisant", "sous la moyenne"] },
  { cle: "absences", titre: "Quels élèves s'absentent le plus ce mois-ci ?", mots: ["absen", "retard", "assiduit", "frequentation"] },
  { cle: "notes", titre: "Quelles feuilles de notes restent à valider ?", mots: ["note", "saisie", "feuille", "valid", "verrouill"] },
  { cle: "prochaine", titre: "Quelle est la prochaine évaluation ?", mots: ["prochain", "composition", "evaluation", "examen", "calendrier"] },
  { cle: "abandons", titre: "Combien d'élèves ont abandonné ?", mots: ["abandon", "transfer", "depart"] },
  { cle: "extraits", titre: "Quels élèves n'ont pas d'extrait de naissance ?", mots: ["extrait", "acte de naissance", "etat civil", "papiers"] },
  { cle: "surage", titre: "Quels élèves sont en sur-âge ?", mots: ["sur-age", "surage", "trop age", "trop vieux", "age normal"] },
  { cle: "orphelins", titre: "Combien d'élèves sont orphelins ?", mots: ["orphelin"] },
  { cle: "abonnement", titre: "Quand se termine l'abonnement ?", mots: ["abonnement", "payer", "expir", "renouvel"] },
] as const;

export type CleQuestion = (typeof QUESTIONS)[number]["cle"];

const normaliser = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'");

/** Reconnaît la question posée librement ; null si aucune ne correspond. */
export function reconnaitre(texte: string): CleQuestion | null {
  const t = normaliser(texte);
  let meilleure: { cle: CleQuestion; score: number } | null = null;
  for (const q of QUESTIONS) {
    const score = q.mots.reduce((s, m) => s + (t.includes(m) ? m.length : 0), 0);
    if (score && (!meilleure || score > meilleure.score)) meilleure = { cle: q.cle, score };
  }
  return meilleure?.cle ?? null;
}

const dateFr = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "UTC" });
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export async function repondre(db: Db, schoolId: string, cle: CleQuestion, maintenant = new Date()): Promise<Reponse> {
  const question = QUESTIONS.find((q) => q.cle === cle)!.titre;
  const t = await tableauDeBord(db, schoolId);
  const tous = t.resultats.flatMap((r) => r.eleves.map((e) => ({ ...e, classe: r.classe })));
  const presents = tous.filter((e) => e.statut === "PRESENT");

  switch (cle) {
    case "effectif": {
      return {
        question,
        texte: `L'école compte ${pluriel(t.effectif, "élève")} inscrits cette année (${t.effectif - t.filles} garçons, ${t.filles} filles), dont ${t.presents} présents. ${pluriel(t.enseignants, "enseignant")}, soit ${t.elevesParEnseignant ? f2(t.elevesParEnseignant) : "—"} élèves par enseignant.`,
        tableau: { entetes: ["Classe", "Garçons", "Filles", "Total"], lignes: t.parClasse.map((c) => [c.nom, c.effectif.M, c.effectif.F, c.effectif.M + c.effectif.F]) },
        lien: { href: "/eleves", libelle: "Registre des élèves" },
      };
    }
    case "reussite": {
      return {
        question,
        texte: `${t.admis} élèves admis sur ${t.presents} présents : taux de réussite de ${pct(t.tauxAdmission)} (calculé comme le TABLEAU DE BORD du classeur, sur les élèves ayant une décision).`,
        tableau: { entetes: ["Classe", "Présents", "Admis", "Taux"], lignes: t.parClasse.map((c) => [c.nom, c.presents, c.admis, pct(c.taux)]) },
        lien: { href: "/resultats", libelle: "Résultats" },
      };
    }
    case "classes": {
      const tri = t.parClasse.filter((c) => c.taux != null).sort((a, b) => a.taux! - b.taux!);
      if (!tri.length) return { question, texte: "Aucune classe n'a encore de résultats annuels (MGA) : les compositions ne sont pas toutes saisies.", lien: { href: "/notes", libelle: "Notes" } };
      const faible = tri[0];
      return {
        question,
        texte: `${faible.nom} a le taux de réussite le plus faible (${pct(faible.taux)}, ${faible.admis} admis sur ${faible.presents}). La meilleure est ${tri.at(-1)!.nom} (${pct(tri.at(-1)!.taux)}).`,
        tableau: { entetes: ["Classe", "Taux de réussite", "Enseignant"], lignes: tri.map((c) => [c.nom, pct(c.taux), c.enseignant ?? "—"]) },
        lien: { href: "/statistiques", libelle: "Statistiques" },
      };
    }
    case "meilleurs": {
      const premiers = t.resultats.flatMap((r) => r.eleves.filter((e) => e.rang === 1).map((e) => [r.classe.nom, e.nom, `${f2(e.mga)} / ${r.classe.bareme}`]));
      return {
        question,
        texte: premiers.length ? `Premiers de chaque classe selon la MGA (rang parmi les élèves présents).` : "Les rangs ne sont pas encore calculés (MGA manquantes).",
        tableau: premiers.length ? { entetes: ["Classe", "Élève", "MGA"], lignes: premiers } : undefined,
        lien: { href: "/resultats", libelle: "Résultats" },
      };
    }
    case "difficulte": {
      // MGA sous le seuil, ou à défaut dernière moyenne connue sous le seuil de la classe.
      const liste = presents
        .map((e) => {
          const derniere = [...e.moyennes].reverse().find((m) => m != null) ?? null;
          const valeur = e.mga ?? derniere;
          return { e, valeur, base: e.mga != null ? "MGA" : "dernière moyenne" };
        })
        .filter((x) => x.valeur != null && x.valeur < x.e.classe.seuil)
        .sort((a, b) => a.valeur! / a.e.classe.bareme - b.valeur! / b.e.classe.bareme);
      return {
        question,
        texte: liste.length
          ? `${pluriel(liste.length, "élève")} sous le seuil d'admission de leur classe${liste.length > 20 ? " ; les 20 plus en difficulté sont affichés" : ""}.`
          : "Aucun élève présent n'est sous le seuil d'admission de sa classe.",
        tableau: liste.length
          ? { entetes: ["Élève", "Classe", "Moyenne", "Base"], lignes: liste.slice(0, 20).map((x) => [x.e.nom, x.e.classe.nom, `${f2(x.valeur)} / ${x.e.classe.bareme}`, x.base]) }
          : undefined,
        lien: { href: "/resultats", libelle: "Résultats" },
      };
    }
    case "absences": {
      const debut = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1));
      const fin = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
      const evts = await db.attendanceEvent.findMany({
        where: { schoolId, enrollmentId: { not: null }, date: { gte: debut, lt: fin } },
        include: { enrollment: { include: { student: true, classroom: true } } },
      });
      const parEleve = new Map<string, { nom: string; classe: string; jours: number; retards: number; fois: number }>();
      for (const a of evts) {
        const k = a.enrollmentId!;
        const x = parEleve.get(k) ?? { nom: a.enrollment!.student.fullName, classe: a.enrollment!.classroom.name, jours: 0, retards: 0, fois: 0 };
        if (a.nature === "ABSENCE") {
          x.jours += Number(a.days ?? 0);
          x.fois++;
        } else x.retards++;
        parEleve.set(k, x);
      }
      const tri = [...parEleve.values()].sort((a, b) => b.jours - a.jours || b.retards - a.retards);
      const repetees = tri.filter((x) => x.fois >= 3).length;
      const mois = debut.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
      return {
        question,
        texte: tri.length
          ? `En ${mois} : ${pluriel(tri.length, "élève")} concernés par une absence ou un retard${repetees ? `, dont ${repetees} avec 3 absences ou plus (absences répétées)` : ""}.`
          : `Aucune absence ni aucun retard d'élève enregistré en ${mois}.`,
        tableau: tri.length ? { entetes: ["Élève", "Classe", "Jours d'absence", "Retards"], lignes: tri.slice(0, 15).map((x) => [x.nom, x.classe, String(x.jours).replace(".", ","), x.retards]) } : undefined,
        lien: { href: "/absences", libelle: "Retards et absences" },
      };
    }
    case "notes": {
      const a = t.alertes.find((x) => x.libelle.startsWith("Feuilles de notes passées"))!;
      const mga = t.alertes.find((x) => x.libelle.startsWith("MGA manquantes"))!;
      return {
        question,
        texte: a.nombre
          ? `${pluriel(a.nombre, "feuille")} d'évaluations déjà passées sont encore en saisie : ${a.detail}. ${mga.nombre} élèves présents n'ont pas encore de MGA.`
          : `Toutes les feuilles des évaluations passées sont validées. ${mga.nombre} élèves présents n'ont pas encore de MGA.`,
        lien: { href: "/classes", libelle: "Classes et avancement" },
      };
    }
    case "prochaine": {
      const evals = await db.assessment.findMany({ where: { schoolId, academicYear: { isActive: true }, date: { gte: maintenant } }, orderBy: { date: "asc" } });
      if (!evals.length) return { question, texte: "Aucune évaluation à venir dans le calendrier de l'année.", lien: { href: "/parametres#calendrier", libelle: "Calendrier" } };
      const j = Math.ceil((evals[0].date!.getTime() - maintenant.getTime()) / 86_400_000);
      return {
        question,
        texte: `Prochaine évaluation : ${evals[0].label}${evals[0].track === "CM2" ? " (CM2)" : ""} le ${dateFr(evals[0].date!)}, dans ${pluriel(j, "jour")}.`,
        tableau: { entetes: ["Évaluation", "Classes", "Date"], lignes: evals.slice(0, 6).map((e) => [e.label, e.track === "CM2" ? "CM2" : "CP1 à CM1", dateFr(e.date!)]) },
        lien: { href: "/parametres#calendrier", libelle: "Calendrier" },
      };
    }
    case "abandons": {
      const l = tous.filter((e) => e.statut !== "PRESENT");
      return {
        question,
        texte: `${pluriel(l.filter((e) => e.statut === "ABANDON").length, "abandon")} et ${pluriel(l.filter((e) => e.statut === "TRANSFERE").length, "transfert")} cette année ; taux d'abandon de ${pct(t.tauxAbandon)}.`,
        tableau: l.length ? { entetes: ["Élève", "Classe", "Statut"], lignes: l.map((e) => [e.nom, e.classe.nom, e.statut === "ABANDON" ? "Abandon" : "Transféré"]) } : undefined,
        lien: { href: "/eleves", libelle: "Registre des élèves" },
      };
    }
    case "extraits":
    case "surage":
    case "orphelins": {
      const eleves = await db.student.findMany({
        where: { schoolId, enrollments: { some: { academicYear: { isActive: true } } } },
        include: { enrollments: { where: { academicYear: { isActive: true } }, include: { classroom: { include: { level: true } }, academicYear: true } } },
        orderBy: { fullName: "asc" },
      });
      const ligne = (s: (typeof eleves)[number], extra: string) => [s.fullName, s.enrollments[0].classroom.name, extra];
      if (cle === "extraits") {
        const l = eleves.filter((s) => !s.hasBirthCertificate);
        return {
          question,
          texte: l.length ? `${pluriel(l.length, "élève")} sans extrait de naissance.` : "Tous les élèves inscrits ont un extrait de naissance.",
          tableau: l.length ? { entetes: ["Élève", "Classe", "Matricule"], lignes: l.map((s) => ligne(s, s.schoolMatricule)) } : undefined,
          lien: { href: "/eleves", libelle: "Registre des élèves" },
        };
      }
      if (cle === "surage") {
        const l = eleves
          .map((s) => ({ s, age: anneesRevolues(s.birthDate, s.enrollments[0].academicYear.ageReferenceDate) }))
          .filter((x) => estEnSurAge(x.age, x.s.enrollments[0].classroom.level.code));
        return {
          question,
          texte: l.length
            ? `${pluriel(l.length, "élève")} en sur-âge (3 ans ou plus au-dessus de l'âge normal de la classe, âge calculé à la date de référence des Paramètres).`
            : "Aucun élève en sur-âge.",
          tableau: l.length ? { entetes: ["Élève", "Classe", "Âge"], lignes: l.map((x) => ligne(x.s, `${x.age} ans`)) } : undefined,
          lien: { href: "/eleves", libelle: "Registre des élèves" },
        };
      }
      const l = eleves.filter((s) => s.isOrphan);
      return {
        question,
        texte: l.length ? `${pluriel(l.length, "élève")} orphelin(s).` : "Aucun élève n'est déclaré orphelin.",
        tableau: l.length ? { entetes: ["Élève", "Classe", "Orphelin de"], lignes: l.map((s) => ligne(s, s.orphanOf ?? "—")) } : undefined,
        lien: { href: "/eleves", libelle: "Registre des élèves" },
      };
    }
    case "abonnement": {
      const e = await etatAbonnement(db, schoolId, maintenant);
      return {
        question,
        texte: e.actif
          ? `Offre ${e.plan?.name} active jusqu'au ${e.finLe ? dateFr(e.finLe) : "—"} (${pluriel(e.joursRestants, "jour")}).`
          : "L'abonnement est arrivé à échéance : le site est en lecture seule.",
        lien: { href: "/abonnement", libelle: "Abonnement" },
      };
    }
  }
}
