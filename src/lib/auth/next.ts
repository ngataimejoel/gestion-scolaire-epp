/** Liaison des services de comptes avec Next.js : cookies, en-têtes et contrôle d'accès des pages. */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/generated/prisma/client";
import { db } from "../db";
import { lireSigne, signer } from "./jetons";
import { COOKIE_SESSION, utilisateurDeSession } from "./sessions";
import { DUREE_ACCES_PARENT_S } from "./acces-parent";

const COOKIE_ATTENTE = "epp_attente";
const COOKIE_PARENT = "epp_parent";
const securise = process.env.NODE_ENV === "production";
const base = { httpOnly: true, secure: securise, sameSite: "lax" as const, path: "/" };

export async function metaRequete() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}

export async function poserSession(jeton: string, expiresAt: Date) {
  (await cookies()).set(COOKIE_SESSION, jeton, { ...base, expires: expiresAt });
}

export async function jetonSession() {
  return (await cookies()).get(COOKIE_SESSION)?.value;
}

export async function effacerSession() {
  (await cookies()).delete(COOKIE_SESSION);
}

/** Utilisateur connecté (une seule lecture en base par requête). */
export const utilisateurCourant = cache(async () => utilisateurDeSession(db(), await jetonSession()));

/**
 * À appeler en tête de chaque page ou action protégée : redirige vers la connexion sinon.
 * Le filtre par école (schoolId) de l'utilisateur renvoyé doit ensuite être appliqué à chaque requête.
 */
export async function exigerUtilisateur(roles?: Role[], options: { autoriserChangementMdp?: boolean } = {}) {
  const u = await utilisateurCourant();
  if (!u) redirect("/connexion");
  if (u.mustChangePassword && !options.autoriserChangementMdp) redirect("/changer-mot-de-passe");
  // L'administrateur de la plateforme n'a pas d'école : il n'accède qu'à son espace /admin.
  if (u.role === "PLATFORM_ADMIN" && !roles?.includes("PLATFORM_ADMIN") && !options.autoriserChangementMdp) redirect("/admin");
  if (roles && !roles.includes(u.role)) redirect("/tableau-de-bord");
  return u;
}

/* Étape « code SMS » en attente : numéro et objet gardés dans un cookie signé de 15 minutes. */
export type Attente = { phone: string; objet: "SIGNUP" | "LOGIN" | "PASSWORD_RESET" };

export async function poserAttente(a: Attente) {
  (await cookies()).set(COOKIE_ATTENTE, signer(a, 15 * 60), { ...base, maxAge: 15 * 60 });
}
export async function lireAttente(objet: Attente["objet"]): Promise<Attente | null> {
  const a = lireSigne<Attente>((await cookies()).get(COOKIE_ATTENTE)?.value);
  return a?.objet === objet ? a : null;
}
export async function effacerAttente() {
  (await cookies()).delete(COOKIE_ATTENTE);
}

/* Accès parent : un seul élève, lecture seule, 30 minutes. */
export async function poserAccesParent(studentId: string, schoolId: string) {
  (await cookies()).set(COOKIE_PARENT, signer({ studentId, schoolId }, DUREE_ACCES_PARENT_S), { ...base, maxAge: DUREE_ACCES_PARENT_S });
}
export async function lireAccesParent() {
  return lireSigne<{ studentId: string; schoolId: string }>((await cookies()).get(COOKIE_PARENT)?.value);
}
export async function effacerAccesParent() {
  (await cookies()).delete(COOKIE_PARENT);
}
