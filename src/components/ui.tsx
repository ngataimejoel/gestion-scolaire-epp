"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Charge des données asynchrones ; elles sont rechargées quand `deps` change ou via `recharger()`.
export function useDonnees<T>(charger: () => Promise<T>, deps: unknown[] = []) {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const chargeur = useRef(charger);
  useEffect(() => {
    chargeur.current = charger;
  });
  const cle = JSON.stringify(deps);
  useEffect(() => {
    let actif = true;
    chargeur.current().then(
      (d) => { if (actif) { setDonnees(d); setErreur(null); } },
      (e: Error) => { if (actif) setErreur(e.message); }
    );
    return () => { actif = false; };
  }, [cle, version]);
  return { donnees, erreur, recharger: () => setVersion((v) => v + 1) };
}

export function Entete({ titre, children }: { titre: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold text-slate-800">{titre}</h1>
      <div className="flex flex-wrap items-center gap-2 no-print">{children}</div>
    </div>
  );
}

type BoutonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "principal" | "secondaire" | "danger" };

export function Bouton({ variante = "secondaire", className = "", ...p }: BoutonProps) {
  const styles = {
    principal: "bg-emerald-700 text-white hover:bg-emerald-800 border-emerald-700",
    secondaire: "bg-white text-slate-700 hover:bg-slate-50 border-slate-300",
    danger: "bg-white text-red-700 hover:bg-red-50 border-red-300",
  }[variante];
  return (
    <button
      {...p}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Champ({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export const classeInput =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";

export function Modal({
  titre, ouvert, fermer, children,
}: { titre: string; ouvert: boolean; fermer: () => void; children: ReactNode }) {
  if (!ouvert) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 no-print" onMouseDown={fermer}>
      <div className="mt-10 w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{titre}</h2>
          <button onClick={fermer} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="Fermer">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Alerte({ message, type = "erreur" }: { message: string | null; type?: "erreur" | "succes" }) {
  if (!message) return null;
  const s = type === "erreur" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800";
  return <div className={`mb-4 rounded-md border px-3 py-2 text-sm no-print ${s}`}>{message}</div>;
}

export function Tableau({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="tableau w-full text-sm">{children}</table>
    </div>
  );
}

export function Vide({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">{children}</div>;
}

// En-tête affiché uniquement à l'impression (nom de l'école, année, titre du document).
export function EnteteImpression({ ecole, titre }: { ecole?: { nom: string; iepp: string; dren: string; annee_scolaire: string } | null; titre: string }) {
  return (
    <div className="print-only mb-4 text-sm">
      <div className="flex justify-between">
        <div>
          {ecole?.dren && <div>DREN : {ecole.dren}</div>}
          {ecole?.iepp && <div>IEPP : {ecole.iepp}</div>}
          <div className="font-semibold">{ecole?.nom}</div>
        </div>
        <div className="text-right">
          <div>RÉPUBLIQUE DE CÔTE D&apos;IVOIRE</div>
          <div>Union – Discipline – Travail</div>
          {ecole?.annee_scolaire && <div>Année scolaire {ecole.annee_scolaire}</div>}
        </div>
      </div>
      <h2 className="mt-3 text-center text-lg font-bold uppercase">{titre}</h2>
    </div>
  );
}

export function confirmer(message: string) {
  return window.confirm(message);
}
