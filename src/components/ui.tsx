"use client";

import { useFormStatus } from "react-dom";
import type { InputHTMLAttributes, ReactNode } from "react";

interface ChampProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  erreur?: string | false;
  aide?: ReactNode;
}

/** Champ de formulaire avec libellé, aide et message d'erreur accessible. */
export function Champ({ label, name, erreur, aide, id, ...reste }: ChampProps) {
  const i = id ?? name;
  return (
    <label htmlFor={i} className="block text-sm font-medium">
      {label}
      <input id={i} name={name} className="champ" aria-invalid={erreur ? true : undefined} aria-describedby={erreur ? `${i}-err` : undefined} {...reste} />
      {aide && !erreur && <span className="mt-1 block text-xs font-normal text-attenue">{aide}</span>}
      {erreur && (
        <span id={`${i}-err`} className="mt-1 block text-sm font-normal text-erreur">
          {erreur}
        </span>
      )}
    </label>
  );
}

export function BoutonEnvoi({ children, enCours = "Patientez…", className = "btn-principal w-full" }: { children: ReactNode; enCours?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? enCours : children}
    </button>
  );
}

export function Alerte({ type = "erreur", children }: { type?: "erreur" | "succes" | "info"; children: ReactNode }) {
  if (!children) return null;
  const styles = { erreur: "bg-erreur-fond text-erreur", succes: "bg-succes-fond text-principal", info: "bg-info-fond text-texte" };
  return (
    <p role={type === "erreur" ? "alert" : "status"} className={`rounded-lg px-3 py-2.5 text-sm ${styles[type]}`}>
      {children}
    </p>
  );
}
