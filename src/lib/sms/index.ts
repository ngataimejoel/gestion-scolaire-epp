/**
 * Envoi de SMS par un fournisseur interchangeable, choisi par SMS_PROVIDER.
 * "simulation" : aucun envoi, le message est gardé en mémoire et écrit dans les journaux du serveur,
 * et l'interface peut l'afficher avec la mention « SMS simulé ». Aucune clé n'est lue côté navigateur.
 */
export interface FournisseurSms {
  nom: string;
  envoyer(telephone: string, message: string): Promise<void>;
}

export interface SmsSimule {
  telephone: string;
  message: string;
  date: Date;
}

const boite: SmsSimule[] = [];

const simulation: FournisseurSms = {
  nom: "simulation",
  async envoyer(telephone, message) {
    boite.push({ telephone, message, date: new Date() });
    if (boite.length > 200) boite.shift();
    if (process.env.NODE_ENV !== "test") console.info(`[SMS simulé] ${telephone} : ${message}`);
  },
};

const fournisseurs: Record<string, FournisseurSms> = { simulation };

/** Permet de brancher un fournisseur réel (Orange SMS API, etc.) sans toucher au reste du code. */
export function enregistrerFournisseurSms(f: FournisseurSms) {
  fournisseurs[f.nom] = f;
}

export function fournisseurSms(): FournisseurSms {
  const nom = process.env.SMS_PROVIDER || "simulation";
  const f = fournisseurs[nom];
  if (!f) throw new Error(`Fournisseur SMS inconnu : ${nom}`);
  return f;
}

export const smsSimule = () => (process.env.SMS_PROVIDER || "simulation") === "simulation";

/** Dernier SMS simulé pour un numéro (affichage en mode simulation et tests). */
export function dernierSmsSimule(telephone: string): SmsSimule | undefined {
  for (let i = boite.length - 1; i >= 0; i--) if (boite[i].telephone === telephone) return boite[i];
  return undefined;
}

export const envoyerSms = (telephone: string, message: string) => fournisseurSms().envoyer(telephone, message);
