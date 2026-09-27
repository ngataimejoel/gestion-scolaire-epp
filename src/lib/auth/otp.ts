import { randomInt } from "node:crypto";
import type { Db } from "../db";
import type { OtpPurpose, Prisma } from "@/generated/prisma/client";
import { egaliteSure, hmac } from "./jetons";
import { compterTentative, LIMITES, tempsDeBlocage } from "./limites";
import { envoyerSms } from "../sms";

export const OTP_DUREE_MS = 5 * 60_000; // 5 minutes
export const OTP_ESSAIS = 3;
export const OTP_DELAI_RENVOI_MS = 60_000; // 1 minute entre deux envois

const empreinte = (telephone: string, objet: OtpPurpose, code: string) => hmac(`${telephone}:${objet}:${code}`);

const TEXTES: Record<OtpPurpose, string> = {
  SIGNUP: "Code d'inscription",
  LOGIN: "Code de connexion",
  PASSWORD_RESET: "Code de réinitialisation",
  VERIFY_PHONE: "Code de vérification",
};

export type ResultatEnvoi = { ok: true } | { ok: false; erreur: string };

/**
 * Crée un code à 6 chiffres (5 min, 3 essais), invalide les codes précédents du même objet et l'envoie par SMS.
 * Seule l'empreinte HMAC du code est enregistrée.
 */
export async function envoyerCode(
  db: Db,
  telephone: string,
  objet: OtpPurpose,
  payload?: Prisma.InputJsonValue,
): Promise<ResultatEnvoi> {
  const cle = `otp:${telephone}`;
  const bloque = await tempsDeBlocage(db, cle);
  if (bloque) return { ok: false, erreur: `Trop de codes demandés. Réessayez dans ${Math.ceil(bloque / 60)} minutes.` };

  const dernier = await db.otpCode.findFirst({ where: { phone: telephone, purpose: objet }, orderBy: { createdAt: "desc" } });
  if (dernier && Date.now() - dernier.createdAt.getTime() < OTP_DELAI_RENVOI_MS) {
    const s = Math.ceil((OTP_DELAI_RENVOI_MS - (Date.now() - dernier.createdAt.getTime())) / 1000);
    return { ok: false, erreur: `Patientez ${s} secondes avant de demander un nouveau code.` };
  }
  await compterTentative(db, cle, LIMITES.envoiCode);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.$transaction([
    db.otpCode.updateMany({ where: { phone: telephone, purpose: objet, consumedAt: null }, data: { consumedAt: new Date() } }),
    db.otpCode.create({
      data: {
        phone: telephone,
        purpose: objet,
        codeHash: empreinte(telephone, objet, code),
        expiresAt: new Date(Date.now() + OTP_DUREE_MS),
        payload: payload ?? (dernier?.payload as Prisma.InputJsonValue | undefined),
      },
    }),
  ]);
  await envoyerSms(telephone, `GESTION SCOLAIRE EPP - ${TEXTES[objet]} : ${code}. Valable 5 minutes. Ne le communiquez à personne.`);
  return { ok: true };
}

export type ResultatVerification =
  | { ok: true; payload: Prisma.JsonValue | null }
  | { ok: false; erreur: string; epuise?: boolean };

/** Vérifie le dernier code valide ; 3 essais au plus, puis le code est annulé. */
export async function verifierCode(db: Db, telephone: string, objet: OtpPurpose, code: string): Promise<ResultatVerification> {
  const otp = await db.otpCode.findFirst({
    where: { phone: telephone, purpose: objet, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { ok: false, erreur: "Aucun code en attente. Demandez un nouveau code.", epuise: true };
  if (otp.expiresAt <= new Date()) {
    await db.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    return { ok: false, erreur: "Ce code a expiré. Demandez un nouveau code.", epuise: true };
  }
  if (!/^\d{6}$/.test(code) || !egaliteSure(otp.codeHash, empreinte(telephone, objet, code))) {
    const essais = otp.attempts + 1;
    const epuise = essais >= OTP_ESSAIS;
    await db.otpCode.update({ where: { id: otp.id }, data: { attempts: essais, consumedAt: epuise ? new Date() : null } });
    return epuise
      ? { ok: false, erreur: "Code incorrect. Nombre d'essais dépassé : demandez un nouveau code.", epuise }
      : { ok: false, erreur: `Code incorrect. Il vous reste ${OTP_ESSAIS - essais} essai${OTP_ESSAIS - essais > 1 ? "s" : ""}.` };
  }
  // Consommation atomique : un code ne sert qu'une fois, même en cas de double envoi du formulaire.
  const { count } = await db.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (!count) return { ok: false, erreur: "Ce code a déjà été utilisé.", epuise: true };
  return { ok: true, payload: otp.payload };
}
