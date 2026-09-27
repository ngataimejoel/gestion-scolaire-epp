"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import * as service from "@/lib/auth/service";
import { accesParent } from "@/lib/auth/acces-parent";
import { supprimerSession } from "@/lib/auth/sessions";
import {
  effacerAccesParent,
  effacerAttente,
  effacerSession,
  exigerUtilisateur,
  jetonSession,
  lireAttente,
  metaRequete,
  poserAccesParent,
  poserAttente,
  poserSession,
} from "@/lib/auth/next";

export interface EtatFormulaire {
  erreur?: string;
  champ?: string;
  info?: string;
  valeurs?: Record<string, string>;
  choixEcoles?: { schoolId: string; nom: string }[];
}

/** Valeurs saisies renvoyées au formulaire en cas d'erreur (jamais les mots de passe ni les codes). */
function valeurs(fd: FormData, ...noms: string[]) {
  return Object.fromEntries(noms.map((n) => [n, String(fd.get(n) ?? "")]));
}
const champ = (fd: FormData, n: string) => String(fd.get(n) ?? "");

/* Inscription du directeur */

export async function actionInscription(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const donnees = {
    fullName: champ(fd, "fullName"),
    phone: champ(fd, "phone"),
    schoolName: champ(fd, "schoolName"),
    schoolCode: champ(fd, "schoolCode"),
    password: champ(fd, "password"),
    confirm: champ(fd, "confirm"),
  };
  const r = await service.demanderInscription(db(), donnees);
  if (!r.ok) return { erreur: r.erreur, champ: r.champ, valeurs: valeurs(fd, "fullName", "phone", "schoolName", "schoolCode") };
  await poserAttente({ phone: r.phone, objet: "SIGNUP" });
  redirect("/inscription/code");
}

export async function actionConfirmerInscription(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const a = await lireAttente("SIGNUP");
  if (!a) redirect("/inscription");
  const r = await service.confirmerInscription(db(), a.phone, champ(fd, "code"), await metaRequete());
  if (!r.ok) return { erreur: r.erreur };
  await effacerAttente();
  await poserSession(r.jeton, r.expiresAt);
  redirect("/tableau-de-bord");
}

/* Connexion */

export async function actionConnexion(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const r = await service.connexion(db(), { phone: champ(fd, "phone"), password: champ(fd, "password") }, await metaRequete());
  if (!r.ok) return { erreur: r.erreur, valeurs: valeurs(fd, "phone") };
  if (r.etape === "code") {
    await poserAttente({ phone: r.phone, objet: "LOGIN" });
    redirect("/connexion/code");
  }
  await poserSession(r.jeton, r.expiresAt);
  redirect(r.user.mustChangePassword ? "/changer-mot-de-passe" : "/tableau-de-bord");
}

export async function actionConfirmerConnexion(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const a = await lireAttente("LOGIN");
  if (!a) redirect("/connexion");
  const r = await service.confirmerConnexion(db(), a.phone, champ(fd, "code"), await metaRequete());
  if (!r.ok) return { erreur: r.erreur };
  if (r.etape !== "session") redirect("/connexion");
  await effacerAttente();
  await poserSession(r.jeton, r.expiresAt);
  redirect(r.user.mustChangePassword ? "/changer-mot-de-passe" : "/tableau-de-bord");
}

/** Renvoi du code pour l'étape en cours. */
export async function actionRenvoyerCode(objet: "SIGNUP" | "LOGIN" | "PASSWORD_RESET", _: EtatFormulaire): Promise<EtatFormulaire> {
  const a = await lireAttente(objet);
  if (!a) return { erreur: "Session expirée. Recommencez depuis le début." };
  const r = await service.renvoyerCode(db(), a.phone, objet);
  if (!r.ok) return { erreur: r.erreur };
  await poserAttente(a);
  return { info: "Un nouveau code vous a été envoyé par SMS." };
}

/* Mot de passe oublié */

export async function actionMotDePasseOublie(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const r = await service.demanderReinitialisation(db(), champ(fd, "phone"));
  if (!r.ok) return { erreur: r.erreur, valeurs: valeurs(fd, "phone") };
  await poserAttente({ phone: r.phone, objet: "PASSWORD_RESET" });
  redirect("/mot-de-passe-oublie/nouveau");
}

export async function actionReinitialiser(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const a = await lireAttente("PASSWORD_RESET");
  if (!a) redirect("/mot-de-passe-oublie");
  const r = await service.reinitialiserMotDePasse(
    db(),
    { phone: a.phone, code: champ(fd, "code"), password: champ(fd, "password"), confirm: champ(fd, "confirm") },
    await metaRequete(),
  );
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  await effacerAttente();
  redirect("/connexion?reinitialise=1");
}

/* Changement de mot de passe (obligatoire à la première connexion d'un enseignant) */

export async function actionChangerMotDePasse(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(undefined, { autoriserChangementMdp: true });
  const r = await service.changerMotDePasse(
    db(),
    u.id,
    { current: champ(fd, "current"), password: champ(fd, "password"), confirm: champ(fd, "confirm") },
    await jetonSession(),
  );
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  redirect("/tableau-de-bord?mdp=1");
}

export async function actionDeconnexion() {
  const j = await jetonSession();
  if (j) await supprimerSession(db(), j);
  await effacerSession();
  redirect("/connexion");
}

/* Accès parents */

export async function actionAccesParent(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const { ip } = await metaRequete();
  const r = await accesParent(
    db(),
    { identifiant: champ(fd, "identifiant"), naissance: champ(fd, "naissance"), schoolId: champ(fd, "schoolId") || undefined },
    ip,
  );
  if (!r.ok) return { erreur: r.erreur, choixEcoles: r.choixEcoles, valeurs: valeurs(fd, "identifiant", "naissance") };
  await poserAccesParent(r.studentId, r.schoolId);
  redirect("/parents/eleve");
}

export async function actionQuitterParent() {
  await effacerAccesParent();
  redirect("/parents");
}
