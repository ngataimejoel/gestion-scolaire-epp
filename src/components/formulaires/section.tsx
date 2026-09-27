"use client";

import { useActionState, useEffect, useRef, useTransition, type FormEvent, type ReactNode } from "react";
import type { EtatFormulaire } from "@/app/actions/auth";
import { Alerte } from "../ui";

type Action = (etat: EtatFormulaire, fd: FormData) => Promise<EtatFormulaire>;

/**
 * Formulaire de réglages : les champs sont rendus par le serveur (children) et gardent leur saisie en cas d'erreur
 * (l'action est déclenchée à la main pour éviter la remise à zéro automatique du formulaire).
 */
export function FormSection({ action, children, bouton = "Enregistrer", className = "space-y-4", viderApresSucces = false }: { action: Action; children: ReactNode; bouton?: string; className?: string; viderApresSucces?: boolean }) {
  const [etat, envoyer] = useActionState(action, {} as EtatFormulaire);
  const [enCours, demarrer] = useTransition();
  const formulaire = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (viderApresSucces && etat.info) formulaire.current?.reset();
  }, [etat, viderApresSucces]);
  function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    demarrer(() => envoyer(fd));
  }
  return (
    <form ref={formulaire} onSubmit={soumettre} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={enCours} className="btn-principal">
          {enCours ? "Enregistrement…" : bouton}
        </button>
        {!enCours && etat.info && <Alerte type="succes">{etat.info}</Alerte>}
      </div>
      {!enCours && etat.erreur && <Alerte>{etat.erreur}</Alerte>}
    </form>
  );
}
