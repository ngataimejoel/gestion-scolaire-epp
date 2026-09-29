"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigerUtilisateur } from "@/lib/auth/next";
import { majOffre } from "@/lib/abonnement";
import { activerManuellement, demanderPaiement, simulerPaiement } from "@/lib/paiement";
import type { EtatFormulaire } from "./auth";

async function urlBase() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/** Le directeur choisit une offre et un moyen de paiement ; il est envoyé sur la page du fournisseur. */
export async function actionPayer(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const r = await demanderPaiement(db(), u, { planId: String(fd.get("planId") ?? ""), fournisseur: String(fd.get("fournisseur") ?? "") }, await urlBase());
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  redirect(r.urlPaiement);
}

export async function actionSimulerPaiement(paymentId: string, succes: boolean): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["DIRECTOR"]);
  const r = await simulerPaiement(db(), u, paymentId, succes);
  if (!r.ok) return { erreur: r.erreur };
  revalidatePath("/", "layout");
  redirect(`/abonnement/retour?paiement=${encodeURIComponent(paymentId)}`);
}

export async function actionOffre(planId: string | null, _: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["PLATFORM_ADMIN"]);
  const t = (k: string) => String(fd.get(k) ?? "");
  const r = await majOffre(
    db(),
    u,
    planId,
    {
      name: t("name"),
      priceXof: t("priceXof"),
      durationDays: t("durationDays"),
      maxStudents: t("maxStudents"),
      maxTeachers: t("maxTeachers"),
      features: fd.getAll("features").map(String),
      isActive: fd.get("isActive") === "on",
      position: t("position") || "0",
    },
    t("code"),
  );
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  revalidatePath("/admin");
  return { info: planId ? "Offre enregistrée." : "Offre créée." };
}

export async function actionActiverManuellement(schoolId: string, _: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const u = await exigerUtilisateur(["PLATFORM_ADMIN"]);
  const r = await activerManuellement(db(), u, schoolId, String(fd.get("planId") ?? ""), String(fd.get("note") ?? ""));
  if (!r.ok) return { erreur: r.erreur, champ: r.champ };
  revalidatePath("/admin");
  return { info: "Abonnement activé." };
}
