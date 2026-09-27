/**
 * Comptes et connexion (étape 4). Fonctions indépendantes de Next.js : elles reçoivent la base en paramètre
 * et sont testées dans tests/auth.test.ts. Les pages appellent ces fonctions depuis des actions serveur.
 *
 * - Directeur : inscription avec code SMS, puis mot de passe + code SMS à chaque connexion.
 * - Enseignant : compte créé par le directeur, mot de passe provisoire envoyé par SMS, à changer à la 1re connexion.
 * - Parent : aucun compte (voir acces-parent.ts).
 */
import { z } from "zod";
import type { Db } from "../db";
import type { Prisma, User } from "@/generated/prisma/client";
import { journaliser } from "../audit";
import { anneeDebutCourante } from "../parametres/defauts";
import { preparerEcole } from "../parametres/service";
import { envoyerSms } from "../sms";
import { compterTentative, effacerTentatives, LIMITES, messageBlocage, tempsDeBlocage } from "./limites";
import { caracteresAleatoires, erreurMotDePasse, hacherMotDePasse, motDePasseProvisoire, verifierMotDePasse } from "./mot-de-passe";
import { envoyerCode, verifierCode } from "./otp";
import { creerSession, supprimerAutresSessions } from "./sessions";
import { formaterTelephone, normaliserTelephone } from "./telephone";

export const ECHECS_AVANT_VERROU = 5;
export const DUREE_VERROU_MS = 15 * 60_000;

export type Resultat<T = object> = ({ ok: true } & T) | { ok: false; erreur: string; champ?: string };
type Meta = { ip?: string | null; userAgent?: string | null };

const MSG_IDENTIFIANTS = "Numéro de téléphone ou mot de passe incorrect.";

const telephone = z.string().transform((v, ctx) => {
  const n = normaliserTelephone(v);
  if (!n) {
    ctx.addIssue({ code: "custom", message: "Numéro invalide : 10 chiffres commençant par 01, 05, 07, 21, 25 ou 27." });
    return z.NEVER;
  }
  return n;
});
const texte = (nom: string, max = 120) =>
  z.string().trim().min(2, `${nom} : 2 caractères au moins.`).max(max, `${nom} : ${max} caractères au plus.`);

function premiereErreur(e: z.ZodError): { ok: false; erreur: string; champ?: string } {
  const i = e.issues[0];
  return { ok: false, erreur: i.message, champ: i.path[0]?.toString() };
}

/* ------------------------------------------------------------ Inscription */

export const schemaInscription = z
  .object({
    fullName: texte("Nom et prénoms"),
    phone: telephone,
    schoolName: texte("Nom de l'établissement"),
    schoolCode: z.string().trim().toUpperCase().max(40).optional().default(""),
    password: z.string(),
    confirm: z.string(),
  })
  .superRefine((v, ctx) => {
    const e = erreurMotDePasse(v.password);
    if (e) ctx.addIssue({ code: "custom", path: ["password"], message: e });
    else if (v.password !== v.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: "Les deux mots de passe ne sont pas identiques." });
  });

interface InscriptionEnAttente {
  fullName: string;
  schoolName: string;
  schoolCode: string;
  passwordHash: string;
}

/** 1re étape : vérifie les données, puis envoie un code SMS. Rien n'est créé avant la validation du code. */
export async function demanderInscription(db: Db, donnees: unknown): Promise<Resultat<{ phone: string }>> {
  const p = schemaInscription.safeParse(donnees);
  if (!p.success) return premiereErreur(p.error);
  const v = p.data;
  if (await db.user.findUnique({ where: { phone: v.phone } }))
    return { ok: false, champ: "phone", erreur: "Ce numéro a déjà un compte. Connectez-vous ou utilisez « Mot de passe oublié »." };
  if (v.schoolCode && (await db.school.findUnique({ where: { code: v.schoolCode } })))
    return { ok: false, champ: "schoolCode", erreur: "Ce code établissement est déjà utilisé sur la plateforme." };

  const attente: InscriptionEnAttente = {
    fullName: v.fullName,
    schoolName: v.schoolName,
    schoolCode: v.schoolCode,
    passwordHash: await hacherMotDePasse(v.password),
  };
  const r = await envoyerCode(db, v.phone, "SIGNUP", attente as unknown as Prisma.InputJsonValue);
  return r.ok ? { ok: true, phone: v.phone } : r;
}

/** 2e étape : le code est bon → création de l'école et du compte directeur, puis ouverture de session. */
export async function confirmerInscription(
  db: Db,
  phone: string,
  code: string,
  meta: Meta = {},
): Promise<Resultat<{ user: User; jeton: string; expiresAt: Date }>> {
  const v = await verifierCode(db, phone, "SIGNUP", code.trim());
  if (!v.ok) return v;
  const a = v.payload as unknown as InscriptionEnAttente | null;
  if (!a?.passwordHash) return { ok: false, erreur: "Inscription introuvable. Recommencez le formulaire." };
  if (await db.user.findUnique({ where: { phone } })) return { ok: false, erreur: "Ce numéro a déjà un compte." };

  let schoolCode = a.schoolCode;
  if (!schoolCode) {
    do schoolCode = `EPP-${caracteresAleatoires(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")}`;
    while (await db.school.findUnique({ where: { code: schoolCode } }));
  }
  const user = await db.$transaction(async (tx) => {
    const school = await tx.school.create({
      data: { name: a.schoolName, code: schoolCode, settings: { create: { directorName: a.fullName } } },
    });
    // Paramètres du classeur par défaut : niveaux, seuils, matières, calendrier, jours de classe, listes, une classe par niveau.
    await preparerEcole(tx, school.id, anneeDebutCourante());
    const u = await tx.user.create({
      data: {
        schoolId: school.id,
        phone,
        fullName: a.fullName,
        role: "DIRECTOR",
        passwordHash: a.passwordHash,
        phoneVerifiedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: { schoolId: school.id, userId: u.id, action: "inscription", entity: "School", entityId: school.id, after: { name: school.name, code: school.code }, ip: meta.ip ?? null },
    });
    return u;
  });
  const s = await creerSession(db, user.id, meta);
  return { ok: true, user, jeton: s.jeton, expiresAt: s.expiresAt };
}

/* --------------------------------------------------------------- Connexion */

export type EtapeConnexion =
  | { ok: true; etape: "code"; phone: string }
  | { ok: true; etape: "session"; user: User; jeton: string; expiresAt: Date }
  | { ok: false; erreur: string; champ?: string };

async function exigeCode(db: Db, u: User): Promise<boolean> {
  if (u.role === "DIRECTOR" || u.role === "PLATFORM_ADMIN") return true;
  if (!u.schoolId) return false;
  const s = await db.schoolSettings.findUnique({ where: { schoolId: u.schoolId } });
  return !!s?.teacherLoginOtp;
}

/** 1re étape : numéro + mot de passe. Directeur : un code SMS est ensuite exigé. */
export async function connexion(db: Db, saisie: { phone: string; password: string }, meta: Meta = {}): Promise<EtapeConnexion> {
  const cleIp = `connexion:${meta.ip ?? "inconnue"}`;
  const bloque = await tempsDeBlocage(db, cleIp);
  if (bloque) return { ok: false, erreur: messageBlocage(bloque) };

  const phone = normaliserTelephone(saisie.phone ?? "");
  const u = phone ? await db.user.findUnique({ where: { phone } }) : null;
  if (u?.lockedUntil && u.lockedUntil > new Date()) {
    return { ok: false, erreur: messageBlocage((u.lockedUntil.getTime() - Date.now()) / 1000) };
  }
  // On vérifie toujours un mot de passe (même sans compte) pour ne pas révéler les numéros inscrits par le temps de réponse.
  const bon = await verifierMotDePasse(u?.passwordHash ?? (await fausseEmpreinte()), saisie.password ?? "");
  if (!u || !bon || !u.isActive) {
    await compterTentative(db, cleIp, LIMITES.connexion);
    if (u && !bon) {
      const echecs = u.failedLogins + 1;
      const verrou = echecs >= ECHECS_AVANT_VERROU;
      await db.user.update({
        where: { id: u.id },
        data: { failedLogins: verrou ? 0 : echecs, lockedUntil: verrou ? new Date(Date.now() + DUREE_VERROU_MS) : undefined },
      });
      if (verrou) {
        await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "verrouillage", entity: "User", entityId: u.id, ip: meta.ip });
        return { ok: false, erreur: `${MSG_IDENTIFIANTS} Compte bloqué 15 minutes après ${ECHECS_AVANT_VERROU} essais.` };
      }
    }
    return { ok: false, erreur: u && bon && !u.isActive ? "Ce compte est désactivé. Contactez votre directeur." : MSG_IDENTIFIANTS };
  }
  await db.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } });

  if (await exigeCode(db, u)) {
    const r = await envoyerCode(db, u.phone, "LOGIN");
    return r.ok ? { ok: true, etape: "code", phone: u.phone } : r;
  }
  return ouvrir(db, u, meta);
}

/** 2e étape (directeur) : code SMS de connexion. */
export async function confirmerConnexion(db: Db, phone: string, code: string, meta: Meta = {}): Promise<EtapeConnexion> {
  const u = await db.user.findUnique({ where: { phone } });
  if (!u || !u.isActive) return { ok: false, erreur: "Compte introuvable." };
  const v = await verifierCode(db, phone, "LOGIN", code.trim());
  if (!v.ok) return v;
  return ouvrir(db, u, meta);
}

async function ouvrir(db: Db, u: User, meta: Meta): Promise<EtapeConnexion> {
  await effacerTentatives(db, `connexion:${meta.ip ?? "inconnue"}`);
  const s = await creerSession(db, u.id, meta);
  await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "connexion", entity: "User", entityId: u.id, ip: meta.ip });
  return { ok: true, etape: "session", user: u, jeton: s.jeton, expiresAt: s.expiresAt };
}

/** Renvoi d'un code (inscription, connexion ou réinitialisation), avec délai entre deux envois. */
export async function renvoyerCode(db: Db, phone: string, objet: "SIGNUP" | "LOGIN" | "PASSWORD_RESET"): Promise<Resultat> {
  if (objet === "SIGNUP") {
    const attente = await db.otpCode.findFirst({ where: { phone, purpose: "SIGNUP" }, orderBy: { createdAt: "desc" } });
    if (!attente?.payload) return { ok: false, erreur: "Inscription introuvable. Recommencez le formulaire." };
  } else if (!(await db.user.findUnique({ where: { phone } }))) {
    return { ok: true }; // ne révèle pas si le numéro a un compte
  }
  return envoyerCode(db, phone, objet);
}

/* ---------------------------------------------------- Mot de passe oublié */

/** Envoie un code si le numéro a un compte ; la réponse est la même dans tous les cas. */
export async function demanderReinitialisation(db: Db, saisie: string): Promise<Resultat<{ phone: string }>> {
  const phone = normaliserTelephone(saisie ?? "");
  if (!phone) return { ok: false, champ: "phone", erreur: "Numéro invalide : 10 chiffres commençant par 01, 05, 07, 21, 25 ou 27." };
  const u = await db.user.findUnique({ where: { phone } });
  if (u?.isActive) {
    const r = await envoyerCode(db, phone, "PASSWORD_RESET");
    if (!r.ok) return r;
  }
  return { ok: true, phone };
}

export async function reinitialiserMotDePasse(
  db: Db,
  saisie: { phone: string; code: string; password: string; confirm: string },
  meta: Meta = {},
): Promise<Resultat> {
  const e = erreurMotDePasse(saisie.password ?? "");
  if (e) return { ok: false, champ: "password", erreur: e };
  if (saisie.password !== saisie.confirm) return { ok: false, champ: "confirm", erreur: "Les deux mots de passe ne sont pas identiques." };
  const u = await db.user.findUnique({ where: { phone: saisie.phone } });
  const v = await verifierCode(db, saisie.phone, "PASSWORD_RESET", (saisie.code ?? "").trim());
  if (!v.ok) return v;
  if (!u) return { ok: false, erreur: "Compte introuvable." };
  await db.user.update({
    where: { id: u.id },
    data: { passwordHash: await hacherMotDePasse(saisie.password), mustChangePassword: false, failedLogins: 0, lockedUntil: null, phoneVerifiedAt: u.phoneVerifiedAt ?? new Date() },
  });
  await supprimerAutresSessions(db, u.id);
  await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "reinitialisation_mot_de_passe", entity: "User", entityId: u.id, ip: meta.ip });
  return { ok: true };
}

/* ------------------------------------------------- Changement de mot de passe */

export async function changerMotDePasse(
  db: Db,
  userId: string,
  saisie: { current: string; password: string; confirm: string },
  jetonCourant?: string,
): Promise<Resultat> {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) return { ok: false, erreur: "Compte introuvable." };
  if (!(await verifierMotDePasse(u.passwordHash, saisie.current ?? ""))) return { ok: false, champ: "current", erreur: "Mot de passe actuel incorrect." };
  const e = erreurMotDePasse(saisie.password ?? "");
  if (e) return { ok: false, champ: "password", erreur: e };
  if (saisie.password !== saisie.confirm) return { ok: false, champ: "confirm", erreur: "Les deux mots de passe ne sont pas identiques." };
  if (saisie.password === saisie.current) return { ok: false, champ: "password", erreur: "Choisissez un mot de passe différent de l'actuel." };
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await hacherMotDePasse(saisie.password), mustChangePassword: false } });
  await supprimerAutresSessions(db, u.id, jetonCourant);
  await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "changement_mot_de_passe", entity: "User", entityId: u.id });
  return { ok: true };
}

/* ------------------------------------------------------- Comptes enseignants */

/**
 * Crée (ou recrée) le compte de connexion d'un membre du personnel enseignant à partir de son numéro.
 * Identifiant = numéro ; mot de passe provisoire = 4 derniers chiffres + 4 caractères aléatoires,
 * envoyé par SMS et renvoyé une seule fois au directeur pour qu'il puisse le communiquer.
 */
export async function creerCompteEnseignant(
  db: Db,
  directeur: Pick<User, "id" | "schoolId" | "role">,
  staffId: string,
): Promise<Resultat<{ phone: string; motDePasse: string; nouveau: boolean }>> {
  if (directeur.role !== "DIRECTOR" || !directeur.schoolId) return { ok: false, erreur: "Seul le directeur peut créer des comptes." };
  const staff = await db.staff.findFirst({ where: { id: staffId, schoolId: directeur.schoolId } });
  if (!staff) return { ok: false, erreur: "Membre du personnel introuvable." };
  const phone = normaliserTelephone(staff.phone ?? "");
  if (!phone) return { ok: false, champ: "phone", erreur: "Renseignez un numéro de téléphone valide pour cet enseignant." };

  const existant = await db.user.findUnique({ where: { phone } });
  if (existant && (existant.schoolId !== directeur.schoolId || (existant.role !== "TEACHER" && existant.id !== staff.userId)))
    return { ok: false, champ: "phone", erreur: "Ce numéro est déjà utilisé par un autre compte." };

  const motDePasse = motDePasseProvisoire(phone);
  const data = {
    passwordHash: await hacherMotDePasse(motDePasse),
    mustChangePassword: true,
    fullName: `${staff.lastName} ${staff.firstNames}`.trim(),
    failedLogins: 0,
    lockedUntil: null,
    isActive: true,
  };
  const user = existant
    ? await db.user.update({ where: { id: existant.id }, data })
    : await db.user.create({ data: { ...data, phone, role: "TEACHER", schoolId: directeur.schoolId } });
  if (existant) await supprimerAutresSessions(db, user.id);
  if (staff.userId !== user.id) await db.staff.update({ where: { id: staff.id }, data: { userId: user.id } });

  await envoyerSms(
    phone,
    `GESTION SCOLAIRE EPP - Votre compte enseignant. Identifiant : ${formaterTelephone(phone)}. Mot de passe provisoire : ${motDePasse}. Vous devrez le changer à la première connexion.`,
  );
  await journaliser(db, {
    schoolId: directeur.schoolId,
    userId: directeur.id,
    action: existant ? "nouveau_mot_de_passe_enseignant" : "creation_compte_enseignant",
    entity: "User",
    entityId: user.id,
    after: { phone, staffId: staff.id },
  });
  return { ok: true, phone, motDePasse, nouveau: !existant };
}

/** Empreinte d'un mot de passe aléatoire, pour un temps de réponse constant quand le compte n'existe pas. */
let fausse: Promise<string> | undefined;
const fausseEmpreinte = () => (fausse ??= hacherMotDePasse(caracteresAleatoires(24)));
