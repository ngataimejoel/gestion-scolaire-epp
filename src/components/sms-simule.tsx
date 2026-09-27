import { dernierSmsSimule, smsSimule } from "@/lib/sms";

/**
 * En mode simulation (aucun fournisseur SMS configuré), affiche le dernier SMS « envoyé » à ce numéro,
 * pour pouvoir tester sans téléphone. Masqué en production sauf si AFFICHER_SMS_SIMULES=oui.
 */
export function SmsSimule({ phone }: { phone: string }) {
  const visible = smsSimule() && (process.env.NODE_ENV !== "production" || process.env.AFFICHER_SMS_SIMULES === "oui");
  const sms = visible ? dernierSmsSimule(phone) : undefined;
  if (!sms) return null;
  return (
    <div className="mb-4 rounded-lg border border-dashed border-accent bg-info-fond px-3 py-2 text-sm">
      <span className="block text-xs font-semibold uppercase tracking-wide text-accent">SMS simulé (aucun fournisseur SMS configuré)</span>
      {sms.message}
    </div>
  );
}
