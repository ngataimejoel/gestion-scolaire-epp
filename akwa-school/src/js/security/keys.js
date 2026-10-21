/* =====================================================================================
   Clés de signature des documents (ECDSA P-256).

   - La clé privée est créée sur cet ordinateur par le directeur. Elle n'existe jamais en clair
     dans les données ni dans les sauvegardes : elle est chiffrée (AES-GCM) par une clé dérivée du
     mot de passe administrateur. Elle n'est jamais intégrée au code HTML distribué.
   - Pendant une session du directeur, elle est chargée en mémoire sous forme non exportable.
   - La clé publique (et son empreinte lisible) est distribuée dans l'outil de vérification.
   - Rotation : une nouvelle clé remplace l'active ; l'ancienne est « retirée » (elle ne signe
     plus mais vérifie toujours les documents émis avant son retrait). Une clé « compromise »
     rend suspects les documents qu'elle a signés.
   - Mot de passe oublié (code de secours) : l'ancienne clé ne peut plus être déchiffrée ; elle
     est retirée et le directeur en crée une nouvelle. Les documents déjà émis restent vérifiables.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const K = AK.crypto, u = AK.u;
  const S = () => AK.store.etat;
  let cleEnMemoire = null; // { id, cle: CryptoKey non exportable }
  let refusLe = 0; // mot de passe refusé : ne pas redemander à chaque document d'un même lot

  const cles = {
    liste: () => (S() ? S().cles.liste : []),
    active: () => (S() ? S().cles.liste.find((c) => c.id === S().cles.active && c.statut === 'active') || null : null),
    disponible: () => !!cleEnMemoire && !!cles.active() && cleEnMemoire.id === cles.active().id,

    /** Crée une clé (première clé ou rotation). Le mot de passe administrateur chiffre la clé privée. */
    async creer(mdp) {
      AK.perm.exiger('cles.gerer');
      if (!(await AK.auth.verifierAdmin(mdp))) throw new AK.ErreurMetier('Mot de passe incorrect.', 'pwd');
      const { pub, priv } = await K.nouvellePaire();
      const prive = await K.chiffrer(priv, mdp);
      const empreinte = await K.empreinteCle(pub);
      const n = S().cles.liste.reduce((m, c) => Math.max(m, parseInt(String(c.id).slice(1), 10) || 0), 0) + 1;
      const id = 'K' + n;
      const ancienne = cles.active();
      AK.store.modifier(ancienne ? `Rotation des clés : ${ancienne.id} retirée, ${id} active` : `Clé de signature ${id} créée`, (s) => {
        if (ancienne) {
          ancienne.statut = 'retiree';
          ancienne.retireeLe = new Date().toISOString();
          ancienne.motif = 'Remplacée par ' + id;
        }
        s.cles.liste.push({ id, algo: 'ECDSA-P256-SHA256', pub, empreinte, prive, statut: 'active', creeeLe: new Date().toISOString(), ecole: s.school.name, installId: s.meta.installId });
        s.cles.active = id;
      });
      cleEnMemoire = { id, cle: await K.importerPrivee(priv) };
      priv.fill(0);
      return id;
    },
    /** Charge la clé active en mémoire (après connexion du directeur). */
    async deverrouiller(mdp) {
      const a = cles.active();
      if (!a || !a.prive || !K.dispo()) return false;
      const brut = await K.dechiffrer(a.prive, mdp);
      if (!brut) return false;
      cleEnMemoire = { id: a.id, cle: await K.importerPrivee(brut) };
      brut.fill(0);
      return true;
    },
    oublier: () => (cleEnMemoire = null),
    /** Signe un message canonique avec la clé active ; demande le mot de passe si besoin. */
    async signer(message) {
      if (!cles.active()) return null;
      if (!cles.disponible()) {
        if (Date.now() - refusLe < 60000) return null;
        const mdp = await AK.ui.saisirMotDePasse('Signature électronique : saisissez le mot de passe administrateur pour déverrouiller la clé de signature. Sans lui, les documents seront émis sans signature (vérifiables seulement par le registre).');
        if (!mdp) {
          refusLe = Date.now();
          return null;
        }
        refusLe = 0;
        if (!(await cles.deverrouiller(mdp))) throw new AK.ErreurMetier('Mot de passe incorrect : la clé de signature reste verrouillée.');
      }
      return { kid: cleEnMemoire.id, sig: await K.signer(cleEnMemoire.cle, message) };
    },
    /** Changement du mot de passe administrateur : la clé privée est rechiffrée. */
    async rechiffrer(ancien, nouveau) {
      const L = S().cles.liste.filter((c) => c.prive && c.statut === 'active');
      const maj = [];
      for (const c of L) {
        const brut = await K.dechiffrer(c.prive, ancien);
        if (!brut) continue;
        maj.push([c, await K.chiffrer(brut, nouveau)]);
        brut.fill(0);
      }
      if (maj.length) AK.store.modifier(null, () => maj.forEach(([c, p]) => (c.prive = p)), { rendu: false });
    },
    /** Après récupération par code de secours : l'ancienne clé ne peut plus être déchiffrée. */
    async recupererParSecours() {
      const a = cles.active();
      if (!a) return;
      AK.store.modifier(`Clé ${a.id} retirée (mot de passe perdu) : créez une nouvelle clé`, (s) => {
        a.statut = 'retiree';
        a.retireeLe = new Date().toISOString();
        a.motif = 'Mot de passe administrateur perdu';
        s.cles.active = null;
      });
      cleEnMemoire = null;
    },
    /** Déclare une clé compromise (vol de l'ordinateur, mot de passe divulgué…). */
    declarerCompromise(id, motif) {
      AK.perm.exiger('cles.gerer');
      const c = S().cles.liste.find((x) => x.id === id);
      if (!c) throw new AK.ErreurMetier('Clé introuvable.');
      AK.store.modifier(`Clé ${id} déclarée compromise`, (s) => {
        c.statut = 'compromise';
        c.compromiseLe = new Date().toISOString();
        c.motif = String(motif || '').slice(0, 200);
        if (s.cles.active === id) s.cles.active = null;
      });
      if (cleEnMemoire && cleEnMemoire.id === id) cleEnMemoire = null;
    },
    /** Partie publique, pour l'outil de vérification (aucun secret). */
    publiques() {
      return cles.liste().map((c) => ({ id: c.id, algo: c.algo, pub: c.pub, empreinte: c.empreinte, statut: c.statut, creeeLe: c.creeeLe, retireeLe: c.retireeLe || null, compromiseLe: c.compromiseLe || null, ecole: c.ecole }));
    },
    _effacerMemoire: () => (cleEnMemoire = null),
    _u: u
  };
  AK.cles = cles;
})(window.AK);
