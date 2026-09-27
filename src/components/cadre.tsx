import Link from "next/link";
import type { ReactNode } from "react";

/** Mise en page des écrans publics (connexion, inscription, parents). */
export function CadrePublic({ titre, sousTitre, children, pied }: { titre: string; sousTitre?: ReactNode; children: ReactNode; pied?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-8 sm:py-14">
      <Link href="/" className="mb-6 text-center">
        <span className="block text-xs font-semibold tracking-[0.2em] text-accent">RÉPUBLIQUE DE CÔTE D&apos;IVOIRE</span>
        <span className="block text-lg font-bold tracking-wide text-principal">GESTION SCOLAIRE EPP</span>
      </Link>
      <main className="carte w-full max-w-md">
        <h1 className="text-xl font-bold">{titre}</h1>
        {sousTitre && <p className="mt-1 text-sm text-attenue">{sousTitre}</p>}
        <div className="mt-5">{children}</div>
      </main>
      {pied && <div className="mt-5 w-full max-w-md text-center text-sm text-attenue">{pied}</div>}
    </div>
  );
}
