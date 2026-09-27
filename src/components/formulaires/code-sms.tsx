"use client";

import { useActionState } from "react";
import type { EtatFormulaire } from "@/app/actions/auth";
import { Alerte, BoutonEnvoi, Champ } from "../ui";

type Action = (etat: EtatFormulaire, fd: FormData) => Promise<EtatFormulaire>;

/** Saisie d'un code SMS à 6 chiffres, avec renvoi du code. */
export function FormCodeSms({ action, renvoi, libelle = "Valider" }: { action: Action; renvoi: (etat: EtatFormulaire) => Promise<EtatFormulaire>; libelle?: string }) {
  const [etat, envoyer] = useActionState(action, {} as EtatFormulaire);
  const [etatRenvoi, renvoyer] = useActionState(renvoi, {} as EtatFormulaire);
  return (
    <div className="space-y-4">
      <form action={envoyer} className="space-y-4">
        <Alerte>{etat.erreur}</Alerte>
        <Champ label="Code reçu par SMS" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus placeholder="••••••" className="champ text-center text-2xl tracking-[0.5em]" />
        <BoutonEnvoi enCours="Vérification…">{libelle}</BoutonEnvoi>
      </form>
      <form action={renvoyer} className="text-center">
        {etatRenvoi.erreur && <Alerte>{etatRenvoi.erreur}</Alerte>}
        {etatRenvoi.info && <Alerte type="succes">{etatRenvoi.info}</Alerte>}
        <BoutonEnvoi className="lien mt-2 text-sm" enCours="Envoi…">Je n&apos;ai pas reçu le code : renvoyer</BoutonEnvoi>
      </form>
    </div>
  );
}
