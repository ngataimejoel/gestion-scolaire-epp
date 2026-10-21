/* =====================================================================================
   Vérification d'un document (QR code scanné ou référence saisie).

   Quatre questions distinctes, jamais confondues :
     1. Intégrité   : le contenu du QR a-t-il été modifié ? (signature ECDSA)
     2. Émetteur    : qui a signé ? (clé connue, active, retirée, compromise)
     3. Validité    : le document figure-t-il au registre, avec la même empreinte ?
     4. Statut      : annulé, remplacé, expiré, version dépassée ?
   Une signature valide ne prouve PAS qu'un document n'a pas été annulé après son émission :
   seul un registre à jour le dit. Hors ligne, la liste d'annulation n'est connue qu'à la date
   de la dernière copie du registre (indiquée dans le résultat).

   Code pur, partagé par l'application et l'outil de vérification autonome.
   source = { cles: [clés publiques], trouver(ref) → entrée | null, registreDate, ecole }
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u;
  const AZERTY = { '&': '1', 'é': '2', '"': '3', "'": '4', '(': '5', '§': '6', 'è': '7', '!': '8', 'ç': '9', 'à': '0', ')': '-', '_': '8' };

  /** Référence saisie au clavier, y compris par une douchette réglée en QWERTY sur un clavier AZERTY. */
  function lireReference(t) {
    let s = String(t || '').trim().toUpperCase().replace(/\s+/g, '');
    const brut = s;
    if (!/^AK-[A-Z]{3}-\d{4}-\d{6}-[0-9A-Z]$/.test(s)) s = [...String(t || '').trim()].map((c) => AZERTY[c] || c).join('').toUpperCase().replace(/\s+/g, '');
    const m = s.match(/AK-[A-Z]{3}-\d{4}-\d{6}-[0-9A-Z]/);
    return m ? m[0] : /^AK-/.test(brut) ? brut : null;
  }

  async function verifier(texte, source) {
    const R = { entree: String(texte || '').trim().slice(0, 600), points: [], verdict: 'inconnu' };
    const point = (cle, etat, titre, detail) => R.points.push({ cle, etat, titre, detail });
    const q = AK.qr.lire(R.entree);
    let ref;
    if (q) {
      R.format = 'qr';
      R.champs = q.champs;
      ref = AK.valid.normRef(q.champs.R);
    } else {
      ref = lireReference(R.entree);
      R.format = ref ? 'reference' : 'inconnu';
    }
    R.ref = ref;
    if (!ref) {
      R.titre = 'Contenu non reconnu';
      R.resume = 'Ce texte n’est ni un QR code AKWA SCHOOL ni une référence de document (AK-XXX-AAAA-NNNNNN-C).';
      point('format', 'ko', 'Format', 'Non reconnu');
      return R;
    }
    const refOk = AK.valid.refValide(ref);
    point('format', refOk ? 'ok' : 'ko', 'Référence', refOk ? `${ref} (clé de contrôle correcte)` : `${ref} : clé de contrôle incorrecte (faute de frappe ou référence inventée)`);
    if (!refOk) {
      R.verdict = 'invalide';
      R.titre = 'Référence invalide';
      R.resume = 'La clé de contrôle de la référence ne correspond pas.';
      return R;
    }
    R.type = q ? q.champs.T : ref.split('-')[1];

    /* 1 et 2. Intégrité et émetteur (signature) */
    let sigOk = null, cle = null;
    if (q && q.signature) {
      cle = (source.cles || []).find((c) => c.id === q.champs.K) || null;
      if (!cle) {
        point('integrite', 'av', 'Intégrité', 'Document signé avec une clé inconnue de cet appareil : signature non vérifiable ici.');
        point('emetteur', 'av', 'Émetteur', `Clé ${q.champs.K || '?'} inconnue. Utilisez l’outil de vérification fourni par l’école émettrice.`);
      } else {
        sigOk = await AK.crypto.verifierSignature(cle.pub, q.message, q.signature);
        if (!sigOk) point('integrite', 'ko', 'Intégrité', 'Signature INVALIDE : le contenu du QR code a été modifié ou fabriqué.');
        else point('integrite', 'ok', 'Intégrité', 'Signature électronique valide : le contenu n’a pas été modifié depuis l’émission.');
        if (sigOk) {
          const emis = q.champs.E || '';
          if (cle.statut === 'compromise') point('emetteur', 'ko', 'Émetteur', `Clé ${cle.id} déclarée COMPROMISE le ${u.fmtDate(String(cle.compromiseLe || '').slice(0, 10))} : la signature ne suffit plus à garantir l’origine.`);
          else if (cle.statut === 'retiree' && cle.retireeLe && emis > String(cle.retireeLe).slice(0, 10)) point('emetteur', 'ko', 'Émetteur', `Clé ${cle.id} retirée le ${u.fmtDate(String(cle.retireeLe).slice(0, 10))} : un document daté après cette date ne devrait pas être signé par elle.`);
          else point('emetteur', 'ok', 'Émetteur', `${cle.ecole || 'École'} · clé ${cle.id} (${cle.empreinte})${cle.statut === 'retiree' ? ' · clé retirée depuis, document antérieur' : ''}`);
        }
      }
    } else if (q) {
      point('integrite', 'info', 'Intégrité', 'QR code non signé : l’authenticité repose uniquement sur la comparaison avec le registre de l’école (empreinte ci-dessous).');
    } else {
      point('integrite', 'info', 'Intégrité', 'Référence saisie à la main : pas de signature à contrôler. Comparez le document présenté avec les informations du registre.');
    }

    /* 3 et 4. Registre et statut */
    const e = source.trouver ? source.trouver(ref) : null;
    R.entreeRegistre = e;
    let statutOk = false, registreOk = false;
    if (!e) {
      point('registre', 'av', 'Registre', source.registreDate
        ? `Absent de la copie du registre du ${u.fmtDate(source.registreDate)}${sigOk ? ' : document signé, peut-être émis après cette date.' : '.'}`
        : `Absent du registre de cet appareil${sigOk ? ' (document signé : registre à mettre à jour ?)' : ''}.`);
    } else {
      if (e.demo) point('registre', 'av', 'Registre', 'Document de DÉMONSTRATION : sans valeur officielle.');
      if (q && q.champs.H) {
        if (q.champs.H === e.h) {
          registreOk = !e.demo;
          if (!e.demo) point('registre', 'ok', 'Registre', `Inscrit au registre le ${u.fmtDate(e.e)}${e.n ? ' · ' + e.n : ''} ; empreinte identique.`);
        } else if ((e.v || []).includes(q.champs.H)) point('registre', 'av', 'Registre', 'Version ANCIENNE : ce document a été réédité depuis (par exemple après une correction de note). Demandez la version en vigueur.');
        else point('registre', 'ko', 'Registre', 'Empreinte DIFFÉRENTE de celle du registre : document falsifié ou mal copié.');
      } else {
        registreOk = !e.demo;
        if (!e.demo) point('registre', 'ok', 'Registre', `Référence inscrite au registre le ${u.fmtDate(e.e)}${e.n ? ' · ' + e.n : ''}. Comparez le document avec les informations du registre.`);
      }
      const auj = source.aujourdhui || u.aujourdhui();
      if (e.s === 'annule') point('statut', 'ko', 'Statut', `ANNULÉ${e.a ? ' le ' + u.fmtDate(e.a) : ''}${e.motif ? ' : ' + e.motif : ''}.`);
      else if (e.s === 'remplace') point('statut', 'ko', 'Statut', `REMPLACÉ par un duplicata${e.remplacePar ? ' (' + e.remplacePar + ')' : ''} : cet exemplaire n’est plus valable.`);
      else if (e.x && e.x < auj) point('statut', 'av', 'Statut', `EXPIRÉ depuis le ${u.fmtDate(e.x)}.`);
      else {
        statutOk = true;
        point('statut', 'ok', 'Statut', `En vigueur${e.x ? ' jusqu’au ' + u.fmtDate(e.x) : ''}${source.registreDate ? ` (selon le registre du ${u.fmtDate(source.registreDate)})` : ''}.`);
      }
    }
    if (!e && q && q.champs.X && q.champs.X < (source.aujourdhui || u.aujourdhui())) point('statut', 'av', 'Statut', `Date de fin de validité inscrite dans le QR dépassée (${u.fmtDate(q.champs.X)}).`);

    /* Identité inscrite dans le QR (à comparer avec le document présenté) */
    if (q && (q.champs.N || q.champs.M)) point('identite', 'info', 'Titulaire (QR)', `${q.champs.N || ''}${q.champs.M ? ' · matricule ' + q.champs.M : ''} — comparez avec la carte et la personne.`);

    /* Verdict */
    const ko = R.points.some((p) => p.etat === 'ko');
    const av = R.points.some((p) => p.etat === 'av');
    if (ko) R.verdict = 'invalide';
    else if (!e && !sigOk) R.verdict = 'inconnu';
    else if (registreOk && statutOk && (sigOk || !q || !q.signature)) R.verdict = av ? 'douteux' : 'valide';
    else R.verdict = 'douteux';
    const libType = AK.registre ? AK.registre.libelleType(R.type) : R.type;
    const titreValide = sigOk ? 'Document authentique et en vigueur' : R.format === 'reference' ? 'Référence inscrite au registre et en vigueur' : 'Inscrit au registre et en vigueur (document non signé)';
    R.titre = { valide: titreValide, douteux: 'Vérification incomplète : prudence', invalide: 'Document NON valable', inconnu: 'Document inconnu' }[R.verdict];
    R.resume = `${libType || 'Document'} · ${ref}`;
    return R;
  }

  /** Affichage du résultat (application et outil autonome). */
  function rendu(R) {
    const { html } = u, ic = AK.ic;
    const icone = { valide: 'shieldCheck', douteux: 'warn', invalide: 'shieldX', inconnu: 'help' }[R.verdict];
    const ico = { ok: 'checkCircle', ko: 'xCircle', av: 'warn', info: 'info' };
    return html`<div class="verif-res ${R.verdict}" role="status" aria-live="polite"><div class="verif-tete">${ic(icone)}<div><b>${R.titre}</b><span>${R.resume}</span></div></div>
      <div class="verif-points">${R.points.map((p) => html`<div class="verif-point ${p.etat}">${ic(ico[p.etat] || 'info')}<b>${p.titre}</b><span>${p.detail}</span></div>`)}</div></div>`;
  }

  AK.verif = { verifier, rendu, lireReference };
})(window.AK);
