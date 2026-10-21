/* =====================================================================================
   Registre des documents émis : référence unique, empreinte, signature, statut, historique.

   Deux politiques d'émission :
   - « registre » (certificats, attestations, cartes, exeat…) : chaque émission crée une
     nouvelle référence. Réimpression = COPIE ; duplicata = nouvelle référence, l'original
     peut être invalidé (carte perdue).
   - « unique » (bulletins, fiches) : une référence par élève et par période. Si le contenu
     change (note corrigée), une nouvelle version est enregistrée ; la vérification d'un
     exemplaire ancien signale qu'il n'est plus la version en vigueur.
   Rien n'est jamais effacé : un document annulé reste au registre avec son motif.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, V = AK.valid;
  const S = () => AK.store.etat;
  const E = (m) => new AK.ErreurMetier(m);

  const TYPES = {
    CEL: 'Carte d’identité scolaire',
    CPE: 'Carte professionnelle',
    CSC: 'Certificat de scolarité',
    ATF: 'Attestation de fréquentation',
    CTR: 'Certificat de transfert (exeat)',
    FIS: 'Fiche scolaire',
    FII: 'Fiche individuelle de l’élève',
    FIN: 'Fiche d’inscription',
    BUL: 'Bulletin de notes',
    BUA: 'Bulletin annuel',
    ATS: 'Attestation de service',
    REC: 'Reçu de versement'
  };

  const statutEffectif = (d) => {
    if (!d) return 'inconnu';
    if (d.statut === 'annule') return 'annule';
    if (d.statut === 'remplace') return 'remplace';
    if (d.expire && d.expire < u.aujourdhui()) return 'expire';
    return 'valide';
  };
  const trouver = (ref) => (S().docs.items || []).find((d) => d.ref === V.normRef(ref)) || null;
  const auteur = () => AK.session.libelle();

  function nouvelleReference(type) {
    const an = new Date().getFullYear();
    const cle = `${type}-${an}`;
    const n = (S().docs.seq[cle] || 0) + 1;
    return { ref: V.reference(type, an, n), cle, n };
  }

  /** Construit et signe le contenu du QR d'un document. */
  async function contenuQR(d, canon, identite) {
    const c = { T: d.type, R: d.ref, E: d.emisLe.slice(0, 10), X: d.expire || '', H: d.H };
    if (identite) {
      c.N = [canon.nom, canon.prenoms].filter(Boolean).join(' ');
      c.M = canon.matricule || '';
    }
    let sig = null;
    // seul le directeur peut déverrouiller la clé ; un document émis par un enseignant reste vérifiable par le registre
    if (AK.cles.active() && AK.crypto.dispo() && !S().meta.demo && (AK.cles.disponible() || AK.session.estDirecteur())) {
      c.K = AK.cles.active().id;
      sig = await AK.cles.signer(AK.qr.message(c));
      if (!sig) delete c.K; // signature refusée (mot de passe non saisi) : document non signé
      else c.S = sig.sig;
    }
    return { texte: AK.qr.texte(c), kid: sig ? sig.kid : null };
  }

  const registre = {
    TYPES,
    statutEffectif,
    trouver,
    libelleType: (t) => TYPES[t] || t,
    /** Documents d'un sujet (élève ou membre du personnel). */
    duSujet: (id) => (S().docs.items || []).filter((d) => d.sujet && d.sujet.id === id),
    /**
     * Émet (ou réutilise, pour la politique « unique ») un document.
     * o = { type, modele, version, politique: 'registre'|'unique', cleUnique, sujet: {type, id, libelle},
     *       canon: { nom, prenoms, matricule, classe, annee, ecole, extra }, expire, qr: { actif, identite }, duplicataDe }
     * Renvoie { doc, qrTexte, statutFiligrane, nouveau }.
     */
    async emettre(o) {
      const demo = !!S().meta.demo;
      if (!AK.perm.peut('document.emettre') && !(o.politique === 'unique' && AK.perm.peut('document.imprimerClasse', { classe: o.canon && o.canon.classe })))
        throw new AK.ErreurDroits('L’émission de ce document est réservée au directeur.');
      if (!TYPES[o.type]) throw E('Type de document inconnu.');
      const qrActif = o.qr ? o.qr.actif !== false : true;

      // politique « unique » : même référence pour le même élève et la même période (sauf duplicata : nouvelle référence)
      if (o.politique === 'unique' && !o.duplicataDe) {
        const exist = (S().docs.items || []).find((d) => d.cleUnique === o.cleUnique && d.statut === 'valide');
        if (exist) {
          const H = await AK.qr.empreinteTitulaire({ ...o.canon, type: o.type, ref: exist.ref });
          let qrTexte = exist.qr;
          let nouvelleVersion = false;
          if (H !== exist.H || !qrTexte || (qrActif && !exist.qr)) {
            nouvelleVersion = true;
            const v = { ...exist, H, emisLe: new Date().toISOString() };
            const q = qrActif ? await contenuQR(v, o.canon, o.qr && o.qr.identite) : { texte: '', kid: null };
            qrTexte = q.texte;
            AK.store.modifier(`${TYPES[o.type]} ${exist.ref} : nouvelle version`, () => {
              exist.versions = exist.versions || [];
              exist.versions.push({ H: exist.H, le: exist.emisLe, qr: exist.qr });
              Object.assign(exist, { H, emisLe: v.emisLe, qr: qrTexte, kid: q.kid, signe: !!q.kid, modeleVersion: o.version });
              exist.impressions.push({ t: Date.now(), type: 'original', par: auteur() });
            }, { rendu: false, categorie: 'documents' });
          } else {
            AK.store.modifier(`${TYPES[o.type]} ${exist.ref} réimprimé`, () => exist.impressions.push({ t: Date.now(), type: 'reimpression', par: auteur() }), { rendu: false, categorie: 'documents' });
          }
          return { doc: exist, qrTexte, statutFiligrane: demo ? 'specimen' : null, nouveau: false, nouvelleVersion };
        }
      }

      const { ref, cle, n } = nouvelleReference(o.type);
      const emisLe = new Date().toISOString();
      const H = await AK.qr.empreinteTitulaire({ ...o.canon, type: o.type, ref });
      const doc = {
        ref, type: o.type, modele: o.modele, modeleVersion: o.version, politique: o.politique || 'registre', cleUnique: o.cleUnique || null,
        sujet: o.sujet || null, emisLe, emisPar: auteur(), annee: S().school.year, expire: o.expire || null, H,
        statut: 'valide', impressions: [{ t: Date.now(), type: o.duplicataDe ? 'duplicata' : 'original', par: auteur() }],
        duplicataDe: o.duplicataDe || null, demo, qrIdentite: !!(o.qr && o.qr.identite)
      };
      const q = qrActif ? await contenuQR(doc, o.canon, o.qr && o.qr.identite) : { texte: '', kid: null };
      doc.qr = q.texte;
      doc.kid = q.kid;
      doc.signe = !!q.kid;
      AK.store.modifier(`${TYPES[o.type]} émis : ${ref}${o.sujet ? ' · ' + o.sujet.libelle : ''}${o.duplicataDe ? ' (duplicata de ' + o.duplicataDe + ')' : ''}`, (s) => {
        s.docs.seq[cle] = n;
        s.docs.items.push(doc);
      }, { rendu: false, categorie: 'documents' });
      return { doc, qrTexte: doc.qr, statutFiligrane: demo ? 'specimen' : o.duplicataDe ? 'duplicata' : null, nouveau: true };
    },
    /** Réimpression d'un document du registre : « copie » (mention COPIE) ; annulé → mention ANNULÉ. */
    reimprimer(ref, type = 'copie') {
      const d = trouver(ref);
      if (!d) throw E('Document introuvable.');
      AK.perm.exiger('document.registre');
      AK.store.modifier(`${TYPES[d.type]} ${d.ref} : ${type === 'copie' ? 'copie imprimée' : 'réimpression'}`, () => d.impressions.push({ t: Date.now(), type, par: auteur() }), { rendu: false, categorie: 'documents' });
      const st = statutEffectif(d);
      return { doc: d, qrTexte: d.qr, statutFiligrane: d.demo ? 'specimen' : st === 'annule' || st === 'remplace' ? 'annule' : type === 'copie' ? 'copie' : null };
    },
    /** Annulation : le document reste au registre ; la vérification le signale comme annulé. */
    annuler(ref, motif) {
      AK.perm.exiger('document.annuler');
      const d = trouver(ref);
      if (!d) throw E('Document introuvable.');
      if (d.statut !== 'valide') throw E('Ce document n’est déjà plus valide.');
      const m = String(motif || '').trim();
      if (m.length < 3) throw new AK.ErreurMetier('Indiquez le motif de l’annulation.', 'motif');
      AK.store.modifier(`${TYPES[d.type]} ${d.ref} annulé : ${m.slice(0, 100)}`, () => {
        d.statut = 'annule';
        d.annulation = { le: new Date().toISOString(), par: auteur(), motif: m.slice(0, 300) };
      }, { categorie: 'documents' });
      return d;
    },
    /** Duplicata (perte) : l'original est marqué « remplacé » si demandé. */
    remplacer(ref, nouveauRef) {
      AK.perm.exiger('document.emettre');
      const d = trouver(ref), n = trouver(nouveauRef);
      if (!d) throw E('Document introuvable au registre.');
      if (!n || n === d || n.type !== d.type) throw E('Le duplicata doit être un document du même type, déjà inscrit au registre.');
      if (d.statut !== 'valide') throw E('Seul un document valide peut être remplacé.');
      AK.store.modifier(`${TYPES[d.type]} ${d.ref} remplacé par ${nouveauRef}`, () => {
        d.statut = 'remplace';
        d.remplacePar = nouveauRef;
        d.annulation = { le: new Date().toISOString(), par: auteur(), motif: 'Remplacé par le duplicata ' + nouveauRef };
      }, { categorie: 'documents' });
    },
    /** Liste minimale pour l'outil de vérification hors ligne (aucune donnée personnelle sensible). */
    exportVerification({ avecNoms = false } = {}) {
      AK.perm.exiger(avecNoms ? 'document.registre' : 'verification.utiliser');
      return (S().docs.items || []).filter((d) => !d.demo).map((d) => ({
        r: d.ref, t: d.type, e: d.emisLe.slice(0, 10), x: d.expire || null, h: d.H, s: statutEffectif(d) === 'expire' ? 'valide' : d.statut,
        a: d.annulation ? d.annulation.le.slice(0, 10) : null, v: (d.versions || []).map((v) => v.H), n: avecNoms && d.sujet ? AK.qr.propre(d.sujet.libelle) : undefined
      }));
    }
  };
  AK.registre = registre;
})(window.AK);
