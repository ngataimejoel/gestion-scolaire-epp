/**
 * Historique (journal d'audit) consultable par le directeur : qui a fait quoi, quand, avec l'ancienne et la
 * nouvelle valeur. Toujours limité à l'école de l'utilisateur. Aucun mot de passe ni code n'y est enregistré.
 */
import type { Db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

export const LIBELLES_ENTITE: Record<string, string> = {
  School: "Établissement",
  SchoolSettings: "Paramètres",
  SchoolMonth: "Jours de classe",
  Level: "Seuils",
  Subject: "Matières",
  Assessment: "Calendrier",
  ChoiceItem: "Listes",
  Classroom: "Classes",
  Student: "Élèves",
  Staff: "Personnel",
  User: "Comptes",
  Grade: "Notes",
  ClassAssessment: "Feuilles de notes",
  AttendanceEvent: "Absences",
  ReportDraft: "Rapports",
  Payment: "Paiements",
  Subscription: "Abonnement",
  Plan: "Offres",
  ImportJob: "Imports",
};

export const LIBELLES_ACTION: Record<string, string> = {
  creation: "Création",
  modification: "Modification",
  suppression: "Suppression",
  inscription: "Inscription",
  connexion: "Connexion",
  saisie_notes: "Saisie des notes",
  feuille_valider: "Validation",
  feuille_verrouiller: "Verrouillage",
  feuille_rouvrir: "Réouverture",
  verrouillage: "Blocage du compte",
  redaction: "Rédaction",
  changement_mot_de_passe: "Changement de mot de passe",
  reinitialisation_mot_de_passe: "Mot de passe oublié",
  creation_compte_enseignant: "Création du compte",
  nouveau_mot_de_passe_enseignant: "Nouveau mot de passe",
  activation_compte: "Activation du compte",
  desactivation_compte: "Désactivation du compte",
  consultation_parent: "Consultation parent",
  paiement_demande: "Paiement commencé",
  paiement_refuse: "Paiement refusé",
  abonnement_active: "Abonnement activé",
  activation_manuelle: "Activation manuelle",
  import: "Import",
  export: "Sauvegarde",
};

export const libelleAction = (a: string) => LIBELLES_ACTION[a] ?? a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const PAR_PAGE = 50;

const LIBELLES_CHAMPS: Record<string, string> = {
  fullName: "Nom et prénoms", lastName: "Nom", firstNames: "Prénoms", sex: "Sexe", birthDate: "Né(e) le", phone: "Téléphone",
  classroomId: "Classe", classe: "Classe", evaluation: "Évaluation", etat: "État", status: "Statut", statusDate: "Date du statut",
  despsId: "Matricule DESPS", schoolMatricule: "Matricule école", matricule: "Matricule", function: "Fonction", grade: "Grade",
  date: "Date", nature: "Nature", days: "Jours", minutes: "Minutes", reason: "Motif", justified: "Justifié", notes: "Observation",
  isRepeating: "Redoublant", hasBirthCertificate: "Extrait", isOrphan: "Orphelin", nationality: "Nationalité", name: "Nom",
  code: "Code", offre: "Offre", montant: "Montant", fournisseur: "Moyen", debut: "Début", source: "Source", priceXof: "Prix",
  durationDays: "Durée (jours)", maxStudents: "Élèves max", maxTeachers: "Enseignants max", features: "Fonctions", isActive: "Actif",
  passMark: "Seuil", scale: "Barème", workingDays: "Jours de classe", label: "Libellé", changements: "Notes modifiées",
};

function valeur(v: unknown): string {
  if (v == null || v === "") return "vide";
  if (v === true) return "oui";
  if (v === false) return "non";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(v)) return new Date(v).toLocaleDateString("fr-FR", { timeZone: "UTC" });
  if (typeof v === "number") return String(v).replace(".", ",");
  if (Array.isArray(v)) return v.map(valeur).join(", ").slice(0, 120);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Changement de note : « élève matière : avant → après »
    if ("eleve" in o && "avant" in o) return `${o.eleve}${o.matiere ? ` ${o.matiere}` : ""} : ${valeur(o.avant)} → ${valeur(o.apres)}`;
    return JSON.stringify(v).slice(0, 80);
  }
  return String(v).slice(0, 80);
}

const champ = (k: string) => LIBELLES_CHAMPS[k] ?? k;

/** Différences lisibles entre l'état avant et après (champs modifiés seulement ; valeurs vides ignorées à la création). */
export function differences(avant: unknown, apres: unknown): string[] {
  const a = (avant && typeof avant === "object" ? avant : {}) as Record<string, unknown>;
  const b = (apres && typeof apres === "object" ? apres : {}) as Record<string, unknown>;
  const cles = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const lignes: string[] = [];
  for (const k of cles) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (!(k in a)) {
      if (b[k] == null || b[k] === "") continue;
      if (Array.isArray(b[k]) && (b[k] as unknown[]).every((x) => x && typeof x === "object" && "avant" in (x as object))) {
        for (const x of b[k] as unknown[]) lignes.push(valeur(x));
        continue;
      }
      lignes.push(`${champ(k)} : ${valeur(b[k])}`);
    } else if (!(k in b)) lignes.push(`${champ(k)} : ${valeur(a[k])} (retiré)`);
    else lignes.push(`${champ(k)} : ${valeur(a[k])} → ${valeur(b[k])}`);
  }
  return lignes;
}

export interface FiltreJournal {
  entite?: string;
  userId?: string;
  du?: string;
  au?: string;
  page?: number;
}

export async function journalEcole(db: Db, schoolId: string, f: FiltreJournal = {}) {
  const jour = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : undefined);
  const du = jour(f.du);
  const au = jour(f.au);
  const where: Prisma.AuditLogWhereInput = {
    schoolId,
    ...(f.entite ? { entity: f.entite } : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(du || au ? { createdAt: { ...(du ? { gte: du } : {}), ...(au ? { lt: new Date(au.getTime() + 86_400_000) } : {}) } } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [total, lignes, utilisateurs] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAR_PAGE, take: PAR_PAGE, include: { user: { select: { fullName: true, role: true } } } }),
    db.user.findMany({ where: { schoolId }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAR_PAGE)),
    utilisateurs,
    lignes: lignes.map((l) => ({
      id: l.id,
      date: l.createdAt,
      auteur: l.user?.fullName ?? (l.action === "consultation_parent" ? "Parent" : "Système"),
      action: libelleAction(l.action),
      entite: LIBELLES_ENTITE[l.entity] ?? l.entity,
      details: differences(l.before, l.after),
      ip: l.ip,
    })),
  };
}
