/**
 * Envoi d'e-mails par un fournisseur interchangeable, choisi par EMAIL_PROVIDER.
 * « simulation » (par défaut) : rien n'est envoyé, le message est écrit dans les journaux du serveur.
 * « resend » : API HTTP Resend (RESEND_API_KEY). D'autres fournisseurs se branchent avec enregistrerFournisseurEmail().
 */
export interface FournisseurEmail {
  nom: string;
  envoyer(a: string, sujet: string, texte: string): Promise<void>;
}

const simulation: FournisseurEmail = {
  nom: "simulation",
  async envoyer(a, sujet) {
    if (process.env.NODE_ENV !== "test") console.info(`[E-mail simulé] ${a} : ${sujet}`);
  },
};

const resend: FournisseurEmail = {
  nom: "resend",
  async envoyer(a, sujet, texte) {
    const cle = process.env.RESEND_API_KEY;
    if (!cle) throw new Error("Variable d'environnement manquante : RESEND_API_KEY");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [a], subject: sujet, text: texte }),
    });
    if (!r.ok) throw new Error(`Envoi de l'e-mail refusé (${r.status}).`);
  },
};

const fournisseurs: Record<string, FournisseurEmail> = { simulation, resend };

export function enregistrerFournisseurEmail(f: FournisseurEmail) {
  fournisseurs[f.nom] = f;
}

export function envoyerEmail(a: string, sujet: string, texte: string) {
  const nom = process.env.EMAIL_PROVIDER || "simulation";
  const f = fournisseurs[nom];
  if (!f) throw new Error(`Fournisseur d'e-mail inconnu : ${nom}`);
  return f.envoyer(a, sujet, texte);
}
