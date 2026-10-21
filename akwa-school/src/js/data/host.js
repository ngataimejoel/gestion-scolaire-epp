/* =====================================================================================
   Hôte d'exécution : ce qui dépend de l'endroit où tourne la page.
     - « navigateur » : fichier HTML ouvert directement (stockage IndexedDB, téléchargements,
       impression du navigateur ; l'export PDF passe par la boîte d'impression).
     - « bureau » : application Windows AKWA SCHOOL (PySide6, QWebChannel) : données dans la
       base SQLite de l'application, connexion et mots de passe gérés par l'application,
       fichiers enregistrés par une boîte de dialogue Windows. Même contrat que pont_v8.js.
     - « natif » : emballage générique (contrat AkwaNatif ci-dessous : Electron, autre WebView).
     - « android » : application Android existante (pont AkwaNative de epp-expert/android).
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

  /**
   * Application Android AKWA SCHOOL existante (epp-expert/android, pont Java « AkwaNative », Pont.java) :
   * données dans les fichiers privés de l'application (lire/ecrire, écriture atomique), fichiers enregistrés
   * par le sélecteur d'Android (enregistrerFichier, réponse asynchrone par akwaRetour), impression par le
   * service d'impression d'Android (imprimerPage) qui propose aussi « Enregistrer au format PDF ».
   * Les mots de passe restent gérés par la page (empreintes PBKDF2), comme dans la version navigateur.
   */
  function hoteAndroid() {
    const N = window.AkwaNative;
    const base = hoteNavigateur();
    const attentes = {};
    let compteur = 0;
    window.akwaRetour = function (id) {
      const f = attentes[id];
      delete attentes[id];
      let r = null;
      try {
        r = JSON.parse(N.resultat(id));
      } catch (e) { /* réponse illisible */ }
      if (f) f(r || { ok: false, message: 'Réponse illisible du téléphone.' });
    };
    const attendre = (lancer) => new Promise((ok) => {
      const id = 'r' + ++compteur;
      attentes[id] = ok;
      lancer(id);
    });
    let version = '';
    try {
      version = JSON.parse(N.infos()).version || '';
    } catch (e) { /* version inconnue */ }
    return {
      ...base,
      type: 'android',
      libelle: 'Application Android' + (version ? ' ' + version : ''),
      pdfDirect: false,
      async demarrer() {
        await AK.stockage.initialiser(AK.stockage.adaptateurFichiers(N));
        return null;
      },
      async fichier(nom, contenu, type) {
        let t = typeof contenu === 'string' ? contenu : await contenu.text();
        type = type || 'text/plain';
        if (/^text\/csv/.test(type) && t.charCodeAt(0) === 0xfeff) t = t.slice(1); // le pont ajoute lui-même l'indicateur UTF-8
        const r = await attendre((id) => N.enregistrerFichier(id, nom, type, t));
        if (r && r.ok) return nom;
        if (r && r.annule) return '';
        throw new AK.ErreurMetier((r && r.message) || 'Enregistrement du fichier impossible.');
      },
      imprimer(paysage) {
        N.imprimerPage(!!paysage);
      },
      /** Données de l'application Android 1.x (interface v8) laissées sur le téléphone : lues, jamais effacées. */
      ancienneVersion() {
        try {
          const o = JSON.parse(N.lire('etat_v8.json') || 'null');
          return o && Array.isArray(o.students) ? o : null;
        } catch (e) {
          return null;
        }
      }
    };
  }

  AK.hote = window.qt && window.qt.webChannelTransport && window.APP_DATA && typeof window.QWebChannel === 'function'
    ? hoteBureau()
    : window.AkwaNatif && typeof window.AkwaNatif.enregistrerFichier === 'function'
      ? hoteNatif()
      : window.AkwaNative && typeof window.AkwaNative.ecrire === 'function' && typeof window.AkwaNative.enregistrerFichier === 'function'
        ? hoteAndroid()
        : hoteNavigateur();
})(window.AK);
