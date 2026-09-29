/**
 * Parcours de paiement de l'abonnement : choix de l'offre → paiement en attente → confirmation du fournisseur
 * (notification vérifiée ou relecture) → activation → rappels J-15, J-7, J-1 → expiration (lecture seule).
 * Le montant vient toujours de l'offre en base et il est recontrôlé à la confirmation, jamais pris du navigateur.
 */
import type { Db } from "../db";
import type { User } from "@/generated/prisma/client";
import { journaliser } from "../audit";
import type { Resultat } from "../auth/service";
import { ajouterJours, etatAbonnement } from "../abonnement";
import { notifierDirecteurs } from "../notifications";
import { fournisseur, simulationAutorisee, type Verification } from "./fournisseurs";

type Utilisateur = Pick<User, "id" | "schoolId" | "role">;
const fcfa = (n: number) => `${n.toLocaleString("fr-FR").replace(/ /g, " ")} FCFA`;

/** Crée l'abonnement en attente et le paiement, puis demande au fournisseur l'adresse de paiement. */
export async function demanderPaiement(
  db: Db,
  u: Utilisateur,
  choix: { planId: string; fournisseur: string },
  urlBase: string,
): Promise<Resultat<{ paymentId: string; urlPaiement: string }>> {
  if (u.role !== "DIRECTOR" || !u.schoolId) return { ok: false, erreur: "Seul le directeur peut payer l'abonnement." };
  const plan = await db.plan.findFirst({ where: { id: choix.planId, isActive: true, isTrial: false } });
  if (!plan) return { ok: false, champ: "planId", erreur: "Choisissez une offre disponible." };
  if (plan.priceXof <= 0) return { ok: false, champ: "planId", erreur: "Cette offre n'a pas de prix : contactez l'administrateur." };
  const f = fournisseur(choix.fournisseur);
  if (!f) return { ok: false, champ: "fournisseur", erreur: "Moyen de paiement indisponible." };
  const enCours = await db.payment.count({ where: { schoolId: u.schoolId, status: "PENDING", createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
  if (enCours >= 5) return { ok: false, erreur: "Trop de paiements commencés. Réessayez dans quelques minutes." };

  const abonnement = await db.subscription.create({ data: { schoolId: u.schoolId, planId: plan.id, status: "PENDING" } });
  const paiement = await db.payment.create({ data: { schoolId: u.schoolId, subscriptionId: abonnement.id, provider: f.nom, amountXof: plan.priceXof } });
  await journaliser(db, { schoolId: u.schoolId, userId: u.id, action: "paiement_demande", entity: "Payment", entityId: paiement.id, after: { offre: plan.code, montant: plan.priceXof, fournisseur: f.nom } });
  try {
    const r = await f.initier({
      reference: paiement.id,
      montant: plan.priceXof,
      description: `Abonnement ${plan.name} GESTION SCOLAIRE EPP`,
      urlRetour: `${urlBase}/abonnement/retour?paiement=${paiement.id}`,
      urlNotification: `${urlBase}/api/paiement/${f.nom}`,
    });
    await db.payment.update({ where: { id: paiement.id }, data: { providerRef: r.refFournisseur } });
    return { ok: true, paymentId: paiement.id, urlPaiement: r.urlPaiement };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.payment.update({ where: { id: paiement.id }, data: { status: "FAILED", rawPayload: { erreur: message } } });
    await db.subscription.update({ where: { id: abonnement.id }, data: { status: "PAYMENT_FAILED" } });
    return { ok: false, erreur: `Le paiement n'a pas pu démarrer. ${message}` };
  }
}

/**
 * Applique le statut confirmé par le fournisseur. Idempotent : un paiement déjà réussi n'est jamais compté deux fois.
 * Un montant différent de celui attendu est refusé et journalisé.
 */
export async function appliquerVerification(db: Db, v: Verification, source: string, maintenant = new Date()): Promise<"active" | "echec" | "attente" | "ignore"> {
  const p = await db.payment.findUnique({ where: { id: v.reference }, include: { subscription: { include: { plan: true } } } });
  if (!p || p.status === "SUCCEEDED" || p.status === "CANCELLED") return "ignore";
  const brut = JSON.parse(JSON.stringify({ source, statut: v.statut, montant: v.montant, devise: v.devise, reponse: v.brut ?? null }));
  if (v.statut === "PENDING") return "attente";

  if (v.statut === "SUCCEEDED" && (v.montant !== p.amountXof || (v.devise && v.devise !== "XOF"))) {
    await db.payment.update({ where: { id: p.id }, data: { status: "FAILED", rawPayload: { ...brut, erreur: "montant incohérent" } } });
    await journaliser(db, { schoolId: p.schoolId, action: "paiement_refuse", entity: "Payment", entityId: p.id, after: { attendu: p.amountXof, recu: v.montant, devise: v.devise ?? null } });
    return "echec";
  }
  if (v.statut === "FAILED") {
    const n = await db.payment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "FAILED", rawPayload: brut } });
    if (n.count) await db.subscription.update({ where: { id: p.subscriptionId }, data: { status: "PAYMENT_FAILED" } });
    return "echec";
  }

  const plan = p.subscription.plan;
  const active = await db.$transaction(async (tx) => {
    // Réservation atomique : deux notifications simultanées ne peuvent pas activer deux fois.
    const n = await tx.payment.updateMany({ where: { id: p.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "SUCCEEDED", confirmedAt: maintenant, rawPayload: brut } });
    if (!n.count) return false;
    const enCours = await tx.subscription.findMany({ where: { schoolId: p.schoolId, status: "ACTIVE" }, include: { plan: true } });
    // L'essai s'arrête dès le premier paiement ; un abonnement payant en cours est prolongé à sa suite.
    const essais = enCours.filter((s) => s.plan.isTrial);
    if (essais.length) await tx.subscription.updateMany({ where: { id: { in: essais.map((s) => s.id) } }, data: { status: "CANCELLED" } });
    const payants = enCours.filter((s) => !s.plan.isTrial && s.endsAt && s.endsAt > maintenant);
    const debut = payants.length ? new Date(Math.max(...payants.map((s) => s.endsAt!.getTime()))) : maintenant;
    await tx.subscription.update({ where: { id: p.subscriptionId }, data: { status: "ACTIVE", startsAt: debut, endsAt: ajouterJours(debut, plan.durationDays) } });
    await tx.auditLog.create({
      data: { schoolId: p.schoolId, action: "abonnement_active", entity: "Subscription", entityId: p.subscriptionId, after: { offre: plan.code, montant: p.amountXof, debut, source } },
    });
    return true;
  });
  if (!active) return "ignore";
  const e = await etatAbonnement(db, p.schoolId, maintenant);
  await notifierDirecteurs(db, p.schoolId, {
    titre: "Paiement reçu",
    corps: `Abonnement ${plan.name} activé (${fcfa(p.amountXof)}). Il couvre l'école jusqu'au ${e.finLe?.toLocaleDateString("fr-FR")}.`,
  });
  return "active";
}

/** Relit le statut auprès du fournisseur (page de retour, ou notification reçue) et l'applique. */
export async function actualiserPaiement(db: Db, paymentId: string, source = "verification") {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.status !== "PENDING") return p?.status ?? null;
  const f = fournisseur(p.provider);
  if (!f || f.nom === "simulation") return p.status;
  try {
    await appliquerVerification(db, await f.verifier({ reference: p.id, refFournisseur: p.providerRef }), source);
  } catch (e) {
    console.error(`[paiement] vérification impossible pour ${p.id} :`, e instanceof Error ? e.message : e);
  }
  return (await db.payment.findUnique({ where: { id: paymentId } }))?.status ?? null;
}

/** Page de simulation : le directeur confirme ou fait échouer son propre paiement simulé. */
export async function simulerPaiement(db: Db, u: Utilisateur, paymentId: string, succes: boolean): Promise<Resultat> {
  if (!simulationAutorisee()) return { ok: false, erreur: "Paiement simulé désactivé." };
  const p = await db.payment.findFirst({ where: { id: paymentId, schoolId: u.schoolId ?? "-", provider: "simulation" } });
  if (!p || u.role !== "DIRECTOR") return { ok: false, erreur: "Paiement introuvable." };
  await appliquerVerification(db, { reference: p.id, statut: succes ? "SUCCEEDED" : "FAILED", montant: p.amountXof, devise: "XOF" }, "simulation");
  return { ok: true };
}

/** Activation par l'administrateur (paiement en espèces ou virement reçu hors plateforme), tracée comme un paiement. */
export async function activerManuellement(db: Db, admin: Utilisateur, schoolId: string, planId: string, note: string): Promise<Resultat> {
  if (admin.role !== "PLATFORM_ADMIN") return { ok: false, erreur: "Réservé à l'administrateur de la plateforme." };
  const [ecole, plan] = await Promise.all([db.school.findUnique({ where: { id: schoolId } }), db.plan.findUnique({ where: { id: planId } })]);
  if (!ecole || !plan || plan.isTrial) return { ok: false, erreur: "École ou offre introuvable." };
  if (note.trim().length < 3) return { ok: false, champ: "note", erreur: "Indiquez la référence du paiement reçu (reçu, virement…)." };
  const abonnement = await db.subscription.create({ data: { schoolId, planId, status: "PENDING" } });
  const p = await db.payment.create({ data: { schoolId, subscriptionId: abonnement.id, provider: "manuel", amountXof: plan.priceXof, providerRef: null } });
  await journaliser(db, { schoolId, userId: admin.id, action: "activation_manuelle", entity: "Payment", entityId: p.id, after: { offre: plan.code, note: note.trim() } });
  await appliquerVerification(db, { reference: p.id, statut: "SUCCEEDED", montant: plan.priceXof, devise: "XOF", brut: { note: note.trim(), admin: admin.id } }, "manuel");
  return { ok: true };
}

export const paiementsEcole = (db: Db, schoolId: string) =>
  db.payment.findMany({ where: { schoolId }, orderBy: { createdAt: "desc" }, take: 30, include: { subscription: { include: { plan: true } } } });

export const RAPPELS_JOURS = [15, 7, 1];

/** Rappels J-15, J-7 et J-1 avant la fin de l'abonnement (dans l'application et par SMS), une seule fois chacun. */
export async function rappelsAbonnement(db: Db, maintenant = new Date()) {
  let envoyes = 0;
  const ecoles = await db.subscription.findMany({ where: { status: "ACTIVE" }, select: { schoolId: true }, distinct: ["schoolId"] });
  for (const { schoolId } of ecoles) {
    const e = await etatAbonnement(db, schoolId, maintenant);
    if (!e.actif || !e.finLe || !RAPPELS_JOURS.includes(e.joursRestants)) continue;
    const titre = e.joursRestants === 1 ? "Abonnement : dernier jour demain" : `Abonnement : fin dans ${e.joursRestants} jours`;
    const corps = `L'abonnement ${e.plan?.name ?? ""} se termine le ${e.finLe.toLocaleDateString("fr-FR")}. Renouvelez-le dans le menu Abonnement pour garder l'accès complet ; après cette date le site passe en lecture seule.`;
    // Le corps contient la date de fin : un même rappel n'est envoyé qu'une fois par échéance.
    if (await db.notification.count({ where: { schoolId, title: titre, body: corps } })) continue;
    await notifierDirecteurs(db, schoolId, { titre, corps, canaux: ["IN_APP", "SMS"] });
    envoyes++;
  }
  return envoyes;
}
