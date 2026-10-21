/* =====================================================================================
   Persistance locale.

   Choix : IndexedDB (base du navigateur, plusieurs centaines de Mo, écritures transactionnelles)
   plutôt que localStorage (5 Mo environ, écriture d'un bloc, dépassement silencieux dans
   la version 1.7.0). Les images (photos, extraits, logos) sont rangées à part, une seule fois
   par contenu : l'enregistrement courant ne réécrit que le texte des données.

   Base « akwa-school » :
     kv        : 'etat' (texte JSON, images remplacées par « @img:<empreinte> »), 'info'
     images    : <empreinte> → image intégrée (data:)
     copies    : copies de sécurité locales (une par jour + avant chaque opération à risque)

   Repli : si IndexedDB est indisponible (navigation privée, réglages), localStorage puis,
   en dernier recours, la mémoire seule — avec un avertissement permanent à l'écran.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u;
  const NOM_BASE = 'akwa-school';
  const VERSION_BASE = 1;
  const CLE_LS = 'akwa_school_2';
  const CLE_LS_1X = 'akwa_school_v5'; // AKWA SCHOOL 1.x (même navigateur) : lu, jamais effacé
  const PREFIXE_IMG = '@img:';
  const COPIES_JOUR = 14, COPIES_OPERATION = 10;

  /* ---------- Sérialisation : images à part ---------- */
  function serialiser(S) {
    const images = new Map();
    const texte = JSON.stringify(S, function (k, v) {
      if (this === S && k.startsWith('_')) return undefined; // champs transitoires
      if (typeof v === 'string' && v.length > 256 && v.startsWith('data:image/')) {
        const e = u.empreinte(v);
        images.set(e, v);
        return PREFIXE_IMG + e;
      }
      return v;
    });
    return { texte, images };
  }
  function reconstituer(texte, lireImage) {
    const manquantes = [];
    const S = JSON.parse(texte, (k, v) => {
      if (typeof v === 'string' && v.startsWith(PREFIXE_IMG)) {
        const img = lireImage(v.slice(PREFIXE_IMG.length));
        if (img == null) manquantes.push(k);
        return img || '';
      }
      return v;
    });
    return { S, manquantes };
  }

  /* ---------- IndexedDB (promesses) ---------- */
  const req = (r) => new Promise((ok, ko) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  const finTx = (tx) => new Promise((ok, ko) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => ko(tx.error);
    tx.onabort = () => ko(tx.error || new Error('Transaction annulée'));
  });
  function ouvrir() {
    return new Promise((ok, ko) => {
      if (!window.indexedDB) return ko(new Error('IndexedDB absent'));
      let r;
      try {
        r = indexedDB.open(NOM_BASE, VERSION_BASE);
      } catch (e) {
        return ko(e);
      }
      const minuterie = setTimeout(() => ko(new Error('IndexedDB ne répond pas')), 6000);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
        if (!db.objectStoreNames.contains('copies')) db.createObjectStore('copies', { keyPath: 'id' });
      };
      r.onsuccess = () => {
        clearTimeout(minuterie);
        const db = r.result;
        db.onversionchange = () => db.close();
        ok(db);
      };
      r.onerror = () => {
        clearTimeout(minuterie);
        ko(r.error);
      };
      r.onblocked = () => {
        clearTimeout(minuterie);
        ko(new Error('Base bloquée par une autre fenêtre d’AKWA SCHOOL'));
      };
    });
  }

  function adaptateurIDB(db) {
    const connues = new Set(); // images déjà écrites
    let cacheImages = new Map();
    return {
      nom: 'IndexedDB',
      copies: true,
      async charger() {
        const tx = db.transaction(['kv', 'images'], 'readonly');
        const texte = await req(tx.objectStore('kv').get('etat'));
        if (texte == null) return null;
        const cles = await req(tx.objectStore('images').getAllKeys());
        const vals = await req(tx.objectStore('images').getAll());
        cacheImages = new Map(cles.map((k, i) => [k, vals[i]]));
        cles.forEach((k) => connues.add(k));
        return reconstituer(texte, (e) => cacheImages.get(e));
      },
      async enregistrer(S) {
        const { texte, images } = serialiser(S);
        const tx = db.transaction(['kv', 'images'], 'readwrite');
        const st = tx.objectStore('images');
        images.forEach((v, k) => {
          if (!connues.has(k)) st.put(v, k);
        });
        tx.objectStore('kv').put(texte, 'etat');
        tx.objectStore('kv').put({ maj: Date.now(), octets: texte.length, schema: S.meta && S.meta.schema }, 'info');
        await finTx(tx);
        images.forEach((v, k) => {
          connues.add(k);
          cacheImages.set(k, v);
        });
        return texte.length;
      },
      async copie(S, motif) {
        const { texte, images } = serialiser(S);
        const tx = db.transaction(['copies', 'images'], 'readwrite');
        const st = tx.objectStore('images');
        images.forEach((v, k) => {
          if (!connues.has(k)) st.put(v, k);
        });
        const id = (motif === 'jour' ? 'J' : 'O') + '-' + new Date().toISOString();
        tx.objectStore('copies').put({ id, motif, t: Date.now(), texte, eleves: S.students.length, octets: texte.length });
        await finTx(tx);
        images.forEach((v, k) => connues.add(k));
        await this.elaguerCopies();
        return id;
      },
      async listeCopies() {
        const tx = db.transaction('copies', 'readonly');
        const L = await req(tx.objectStore('copies').getAll());
        return L.map(({ id, motif, t, eleves, octets }) => ({ id, motif, t, eleves, octets })).sort((a, b) => b.t - a.t);
      },
      async lireCopie(id) {
        const tx = db.transaction(['copies', 'images'], 'readonly');
        const c = await req(tx.objectStore('copies').get(id));
        if (!c) throw new AK.ErreurMetier('Copie de sécurité introuvable.');
        const imgs = new Map();
        const st = tx.objectStore('images');
        const cles = await req(st.getAllKeys());
        const vals = await req(st.getAll());
        cles.forEach((k, i) => imgs.set(k, vals[i]));
        return reconstituer(c.texte, (e) => imgs.get(e)).S;
      },
      async elaguerCopies() {
        const L = await this.listeCopies();
        const jours = L.filter((c) => c.motif === 'jour').slice(COPIES_JOUR);
        const ops = L.filter((c) => c.motif !== 'jour').slice(COPIES_OPERATION);
        if (!jours.length && !ops.length) return;
        const tx = db.transaction('copies', 'readwrite');
        [...jours, ...ops].forEach((c) => tx.objectStore('copies').delete(c.id));
        await finTx(tx);
      },
      /** Supprime les images qui ne servent plus ni aux données ni aux copies. */
      async menage(S) {
        const utiles = new Set(serialiser(S).images.keys());
        const tx0 = db.transaction('copies', 'readonly');
        const copies = await req(tx0.objectStore('copies').getAll());
        copies.forEach((c) => (c.texte.match(/@img:[0-9a-f]{16}-[0-9a-z]+/g) || []).forEach((x) => utiles.add(x.slice(PREFIXE_IMG.length))));
        const tx = db.transaction('images', 'readwrite');
        const cles = await req(tx.objectStore('images').getAllKeys());
        let n = 0;
        cles.forEach((k) => {
          if (!utiles.has(k)) {
            tx.objectStore('images').delete(k);
            connues.delete(k);
            n++;
          }
        });
        await finTx(tx);
        return n;
      },
      async effacerTout() {
        const tx = db.transaction(['kv', 'images', 'copies'], 'readwrite');
        ['kv', 'images', 'copies'].forEach((s) => tx.objectStore(s).clear());
        await finTx(tx);
        connues.clear();
      }
    };
  }

  /* ---------- localStorage (repli) : images incluses, quota limité ---------- */
  function adaptateurLS() {
    return {
      nom: 'localStorage (capacité limitée)',
      copies: false,
      async charger() {
        const t = localStorage.getItem(CLE_LS);
        return t ? { S: JSON.parse(t), manquantes: [] } : null;
      },
      async enregistrer(S) {
        const t = JSON.stringify(S, function (k, v) {
          return this === S && k.startsWith('_') ? undefined : v;
        });
        try {
          localStorage.setItem(CLE_LS, t);
        } catch (e) {
          throw new AK.ErreurMetier('Espace de stockage du navigateur plein : les dernières modifications ne sont PAS enregistrées. Faites une sauvegarde sur clé USB, puis retirez des photos ou utilisez un navigateur qui accepte IndexedDB.');
        }
        return t.length;
      },
      async copie() {
        return null;
      },
      async listeCopies() {
        return [];
      },
      async lireCopie() {
        throw new AK.ErreurMetier('Copies de sécurité indisponibles avec ce stockage.');
      },
      async elaguerCopies() {},
      async menage() {
        return 0;
      },
      async effacerTout() {
        localStorage.removeItem(CLE_LS);
      }
    };
  }
  function adaptateurMemoire() {
    let memo = null;
    return {
      nom: 'mémoire seule (rien n’est conservé à la fermeture)',
      copies: false,
      ephemere: true,
      async charger() {
        return memo ? { S: JSON.parse(memo), manquantes: [] } : null;
      },
      async enregistrer(S) {
        memo = JSON.stringify(S);
        return memo.length;
      },
      async copie() {
        return null;
      },
      async listeCopies() {
        return [];
      },
      async lireCopie() {
        throw new AK.ErreurMetier('Copies de sécurité indisponibles.');
      },
      async elaguerCopies() {},
      async menage() {
        return 0;
      },
      async effacerTout() {
        memo = null;
      }
    };
  }
  /* ---------- Fichiers privés d'une application installée (APK Android : pont AkwaNative) ----------
     Les données sont écrites dans des fichiers internes à l'application (écriture atomique côté Java) :
     akwa2_etat.json (texte, images à part), i_<empreinte>.json (une image par fichier, écrite une fois),
     akwa2_copies.json (index) et akwa2_c_<n>.json (copies de sécurité). Noms imposés par le pont :
     [a-z0-9_]{1,40}.json. */
  function adaptateurFichiers(N) {
    const ETAT = 'akwa2_etat.json', INDEX = 'akwa2_copies.json', IMAGES = 'akwa2_images.json';
    const nomImg = (e) => 'i_' + String(e).replace(/[^0-9a-z]/g, '_') + '.json';
    const lireJSON = (nom, defaut) => {
      try {
        const t = N.lire(nom);
        return t ? JSON.parse(t) : defaut;
      } catch (e) {
        return defaut;
      }
    };
    const ecrire = (nom, texte) => {
      if (!N.ecrire(nom, texte)) throw new AK.ErreurMetier('Enregistrement impossible sur le téléphone (mémoire pleine ?). Libérez de la place puis réessayez ; exportez une sauvegarde.');
    };
    const connues = new Set(lireJSON(IMAGES, []));
    const ecrireImages = (images) => {
      let ajout = false;
      images.forEach((v, k) => {
        if (connues.has(k)) return;
        ecrire(nomImg(k), JSON.stringify(v));
        connues.add(k);
        ajout = true;
      });
      if (ajout) ecrire(IMAGES, JSON.stringify([...connues]));
    };
    const image = (e) => {
      try {
        const t = N.lire(nomImg(e));
        return t ? JSON.parse(t) : null;
      } catch (x) {
        return null;
      }
    };
    return {
      nom: 'Fichiers de l’application Android',
      copies: true,
      async charger() {
        const texte = N.lire(ETAT);
        return texte ? reconstituer(texte, image) : null;
      },
      async enregistrer(S) {
        const { texte, images } = serialiser(S);
        ecrireImages(images);
        ecrire(ETAT, texte);
        return texte.length;
      },
      async copie(S, motif) {
        const { texte, images } = serialiser(S);
        ecrireImages(images);
        const L = lireJSON(INDEX, []);
        const n = L.reduce((m, c) => Math.max(m, c.n || 0), 0) + 1;
        const id = (motif === 'jour' ? 'J' : 'O') + '-' + new Date().toISOString();
        ecrire('akwa2_c_' + n + '.json', JSON.stringify({ id, motif, t: Date.now(), texte }));
        L.push({ id, n, motif, t: Date.now(), eleves: S.students.length, octets: texte.length });
        ecrire(INDEX, JSON.stringify(L));
        await this.elaguerCopies();
        return id;
      },
      async listeCopies() {
        return lireJSON(INDEX, []).map(({ id, motif, t, eleves, octets }) => ({ id, motif, t, eleves, octets })).sort((a, b) => b.t - a.t);
      },
      async lireCopie(id) {
        const c = lireJSON(INDEX, []).find((x) => x.id === id);
        const f = c && lireJSON('akwa2_c_' + c.n + '.json', null);
        if (!f) throw new AK.ErreurMetier('Copie de sécurité introuvable.');
        return reconstituer(f.texte, image).S;
      },
      async elaguerCopies() {
        const L = lireJSON(INDEX, []).sort((a, b) => b.t - a.t);
        const jours = L.filter((c) => c.motif === 'jour').slice(COPIES_JOUR);
        const ops = L.filter((c) => c.motif !== 'jour').slice(COPIES_OPERATION);
        const retirer = new Set([...jours, ...ops].map((c) => c.id));
        if (!retirer.size) return;
        ecrire(INDEX, JSON.stringify(L.filter((c) => !retirer.has(c.id))));
        [...jours, ...ops].forEach((c) => N.supprimer('akwa2_c_' + c.n + '.json'));
      },
      async menage(S) {
        const utiles = new Set(serialiser(S).images.keys());
        lireJSON(INDEX, []).forEach((c) => {
          const f = lireJSON('akwa2_c_' + c.n + '.json', null);
          if (f) (f.texte.match(/@img:[0-9a-f]{16}-[0-9a-z]+/g) || []).forEach((x) => utiles.add(x.slice(PREFIXE_IMG.length)));
        });
        let n = 0;
        [...connues].forEach((k) => {
          if (!utiles.has(k) && N.supprimer(nomImg(k))) {
            connues.delete(k);
            n++;
          }
        });
        if (n) ecrire(IMAGES, JSON.stringify([...connues]));
        return n;
      },
      async effacerTout() {
        lireJSON(INDEX, []).forEach((c) => N.supprimer('akwa2_c_' + c.n + '.json'));
        connues.forEach((k) => N.supprimer(nomImg(k)));
        connues.clear();
        [ETAT, INDEX, IMAGES].forEach((f) => N.supprimer(f));
      }
    };
  }
  function lsDisponible() {
    try {
      const k = '__akwa_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  let actif = null;
  const stockage = {
    /** Choisit le meilleur stockage disponible. */
    async initialiser(prefere) {
      if (prefere) return (actif = prefere);
      try {
        actif = adaptateurIDB(await ouvrir());
      } catch (e) {
        AK.diag.avert('IndexedDB indisponible : ' + e.message);
        actif = lsDisponible() ? adaptateurLS() : adaptateurMemoire();
      }
      // demande au navigateur de ne pas effacer la base en cas de manque de place
      if (navigator.storage && navigator.storage.persist && actif.nom === 'IndexedDB') {
        navigator.storage.persist().then((ok) => AK.diag.info('Stockage persistant : ' + ok)).catch(() => {});
      }
      return actif;
    },
    get actif() {
      return actif;
    },
    description: () => (actif ? actif.nom : 'non initialisé'),
    /** Le stockage actif sait-il faire des copies de sécurité locales ? */
    copiesDisponibles: () => !!(actif && actif.copies),
    /** Données d'AKWA SCHOOL 1.x laissées par l'ancienne version dans ce navigateur (lecture seule). */
    ancienneVersion() {
      // application installée : fichier de données de l'ancienne version (ex. Android 1.x : etat_v8.json)
      if (AK.hote && typeof AK.hote.ancienneVersion === 'function') {
        const o = AK.hote.ancienneVersion();
        if (o) return o;
      }
      try {
        const t = localStorage.getItem(CLE_LS_1X);
        if (!t) return null;
        const o = JSON.parse(t);
        return o && Array.isArray(o.students) ? o : null;
      } catch (e) {
        return null;
      }
    },
    serialiser,
    reconstituer
  };
  AK.stockage = stockage;
  AK.stockage._adaptateurs = { adaptateurIDB, adaptateurLS, adaptateurMemoire, adaptateurFichiers, ouvrir };
  AK.stockage.adaptateurFichiers = adaptateurFichiers;
})(window.AK);
