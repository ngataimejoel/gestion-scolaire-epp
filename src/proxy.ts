import { NextResponse, type NextRequest } from "next/server";

// Contrôle rapide : sans cookie de session, les pages de l'espace directeur/enseignant renvoient à la connexion.
// La vérification complète (session en base, rôle, école) est faite par chaque page via exigerUtilisateur().
export function proxy(request: NextRequest) {
  if (!request.cookies.has("epp_session")) {
    return NextResponse.redirect(new URL("/connexion", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/tableau-de-bord/:path*", "/eleves/:path*", "/personnel/:path*", "/changer-mot-de-passe", "/parametres/:path*"],
};
