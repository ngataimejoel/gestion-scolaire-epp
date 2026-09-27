"use client";

import { createContext, useActionState, useContext, useTransition, type FormEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import type { EtatFormulaire } from "@/app/actions/auth";
import { Champ } from "../ui";

/** Erreur du champ courant : le serveur renvoie le chemin du champ en faute (ex. « pere.phone »). */
const Erreurs = createContext<EtatFormulaire>({});
export const useErreur = (champ: string) => {
  const e = useContext(Erreurs);
  return e.champ === champ ? e.erreur : undefined;
};

/**
 * Formulaire de fiche (élève, personnel) : l'action est déclenchée à la main pour que la saisie reste en place
 * après une erreur (React réinitialise sinon le formulaire), et l'erreur s'affiche sous le champ concerné.
 */
export function useFiche<E extends EtatFormulaire>(action: (e: E, fd: FormData) => Promise<E>) {
  const [etat, envoyer] = useActionState<E, FormData>(action, {} as Awaited<E>);
  const [enCours, demarrer] = useTransition();
  function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    demarrer(() => envoyer(fd));
  }
  return { etat, enCours, soumettre, erreurs: (enCours ? {} : etat) as EtatFormulaire };
}

export function ErreursFiche({ etat, children }: { etat: EtatFormulaire; children: ReactNode }) {
  return <Erreurs.Provider value={etat}>{children}</Erreurs.Provider>;
}

export function ChampFiche(props: Parameters<typeof Champ>[0]) {
  const erreur = useErreur(props.name);
  return <Champ {...props} erreur={erreur} />;
}

export function Choix({ label, name, options, vide, ...reste }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; name: string; options: (string | [string, string])[]; vide?: string }) {
  const erreur = useErreur(name);
  return (
    <label htmlFor={name} className="block text-sm font-medium">
      {label}
      <select id={name} name={name} className="champ" aria-invalid={erreur ? true : undefined} aria-describedby={erreur ? `${name}-err` : undefined} {...reste}>
        {vide !== undefined && <option value="">{vide}</option>}
        {options.map((o) => {
          const [v, l] = typeof o === "string" ? [o, o] : o;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
      {erreur && <span id={`${name}-err`} className="mt-1 block text-sm font-normal text-erreur">{erreur}</span>}
    </label>
  );
}

export function Texte({ label, name, ...reste }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; name: string }) {
  const erreur = useErreur(name);
  return (
    <label htmlFor={name} className="block text-sm font-medium">
      {label}
      <textarea id={name} name={name} rows={2} className="champ" aria-invalid={erreur ? true : undefined} {...reste} />
      {erreur && <span className="mt-1 block text-sm font-normal text-erreur">{erreur}</span>}
    </label>
  );
}
