/* =====================================================================================
   Hôte d'exécution : ce qui dépend de l'endroit où tourne la page.
     - « navigateur » : fichier HTML ouvert directement (stockage IndexedDB, téléchargements,
       impression du navigateur ; l'export PDF passe par la boîte d'impression).
     - « bureau » : application Windows AKWA SCHOOL (PySide6, QWebChannel) : données dans la
       base SQLite de l'application, connexion et mots de passe gérés par l'application,
       fichiers enregistrés par une boîte de dialogue Windows. Même contrat que pont_v8.js.
   Le reste de l'application ne connaît que AK.hote.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u;

  function hoteNavigateur() {
    return {
      type: 'navigateur',
      libelle: 'Navigateur (fichier HTML local)',
      authentificationLocale: true,  // comptes et mots de passe gérés par la page
      pdfDirect: false,              // PDF : seulement via « Enregistrer au format PDF » de l'impression
      async demarrer() {
        await AK.stockage.initialiser();
        return null; // l'état est chargé par AK.store depuis le stockage
      },
      async enregistrer(S) {
        return AK.stockage.actif.enregistrer(S);
      },
      async fichier(nom, contenu, type) {
        u.telechargerNavigateur(nom, contenu, type);
        return nom;
      },
      imprimer() {
        window.print();
      }
    };
  }

  function hoteBureau() {
    const D = window.APP_DATA || {};
    let py = null;
    const attente = [];
    const pret = (f) => (py ? f() : attente.push(f));
    const appel = (nom, ...args) => new Promise((ok) => pret(() => py[nom](...args, ok)));
    return {
      type: 'bureau',
      libelle: 'Application Windows AKWA SCHOOL',
      authentificationLocale: false,
      pdfDirect: false,
      session: D.session || { role: 'dir' },
      licence: D.licence || null,
      async demarrer() {
        await new Promise((ok) => {
          /* global QWebChannel */
          new QWebChannel(window.qt.webChannelTransport, (ch) => {
            py = ch.objects.pont;
            attente.splice(0).forEach((f) => f());
            ok();
          });
        });
        await AK.stockage.initialiser({
          nom: 'Base SQLite de l’application Windows',
          async enregistrer() {
            return 0;
          },
          async charger() {
            return null;
          },
          async copie() {
            return null;
          },
          async listeCopies() {
            return [];
          },
          async lireCopie() {
            throw new AK.ErreurMetier('Les copies quotidiennes sont gérées par l’application Windows.');
          },
          async elaguerCopies() {},
          async menage() {
            return 0;
          },
          async effacerTout() {}
        });
        return D.etat || null;
      },
      async enregistrer(S) {
        const o = JSON.parse(JSON.stringify(S, function (k, v) {
          return this === S && (k.startsWith('_') || k === 'securite') ? undefined : v;
        }));
        const err = await appel('enregistrer', JSON.stringify(o));
        if (err) throw new AK.ErreurMetier(err);
        return 0;
      },
      verifierAdmin: (mdp) => appel('verifierAdmin', mdp),
      async fichier(nom, contenu, type) {
        const texte = typeof contenu === 'string' ? contenu : await contenu.text();
        return appel('telecharger', nom, texte, type || 'text/plain');
      },
      imprimer(paysage) {
        appel('imprimer', !!paysage);
      },
      appel
    };
  }

  /**
   * Emballage natif (APK Android, application Windows .exe) : contrat « AkwaNatif ».
   * L'emballage expose window.AkwaNatif (Android : addJavascriptInterface ; Electron : preload) avec :
   *   enregistrerFichier(nom, contenuBase64, typeMime) → chemin enregistré, ou '' si annulé   (obligatoire)
   *   imprimer(paysage)                                → impression native de la page          (facultatif)
   *   exporterPdf(nom, paysage)                        → vrai fichier PDF, chemin ou ''        (facultatif)
   *   version()                                        → texte affiché dans Diagnostic         (facultatif)
   * Les données restent dans IndexedDB (activer le stockage DOM et les bases dans la WebView).
   * Voir packaging/ et docs/EMBALLAGE.md.
   */
  function hoteNatif() {
    const N = window.AkwaNatif;
    const base = hoteNavigateur();
    const b64 = (blob) => new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1] || '');
      r.onerror = () => ko(r.error);
      r.readAsDataURL(blob);
    });
    const appel = async (f, ...a) => {
      const r = f.apply(N, a);
      return r && typeof r.then === 'function' ? r : r;
    };
    return {
      ...base,
      type: 'natif',
      libelle: 'Application installée' + (typeof N.version === 'function' ? ' ' + N.version() : ''),
      pdfDirect: typeof N.exporterPdf === 'function',
      async fichier(nom, contenu, type) {
        const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type: (type || 'text/plain') + ';charset=utf-8' });
        const chemin = await appel(N.enregistrerFichier, nom, await b64(blob), type || blob.type || 'application/octet-stream');
        return chemin == null ? '' : String(chemin);
      },
      imprimer(paysage) {
        if (typeof N.imprimer === 'function') appel(N.imprimer, !!paysage);
        else window.print();
      },
      async exporterPdf(nom, paysage) {
        return String((await appel(N.exporterPdf, nom, !!paysage)) || '');
      }
    };
  }

  AK.hote = window.qt && window.qt.webChannelTransport && window.APP_DATA && typeof window.QWebChannel === 'function'
    ? hoteBureau()
    : window.AkwaNatif && typeof window.AkwaNatif.enregistrerFichier === 'function'
      ? hoteNatif()
      : hoteNavigateur();
})(window.AK);
