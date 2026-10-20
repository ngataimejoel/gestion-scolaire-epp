/* =====================================================================================
   Cartes d'identification scolaire (élèves) et cartes professionnelles (personnel).
   Hiérarchie : photographie → nom → matricule → QR code. Champs limités au strict nécessaire.
   QR : référence + nom et matricule (déjà imprimés), jamais la photo, le téléphone des
   parents, la santé ou l'acte de naissance.
   ===================================================================================== */
(function (AK) {
  'use strict';
  const u = AK.u, { html, raw } = u;
  const S = () => AK.store.etat;
  const X = () => AK.calc;

  const CARTE_DEFAUT = { format: 'id1', l: 85.6, h: 53.98, verso: true, eco: false, expiration: 'fin-annee', dateExpiration: '', bande: '#1f4e8c', filet: '#c7782f' };
  function valider(o) {
    const c = { ...CARTE_DEFAUT, ...(o.carte || {}) };
    c.format = AK.cartes.FORMATS[c.format] ? c.format : 'id1';
    c.l = Math.min(150, Math.max(40, Number(c.l) || 85.6));
    c.h = Math.min(150, Math.max(40, Number(c.h) || 53.98));
    c.verso = !!c.verso;
    c.eco = !!c.eco;
    c.expiration = ['fin-annee', 'date', 'aucune'].includes(c.expiration) ? c.expiration : 'fin-annee';
    c.dateExpiration = u.estISO(c.dateExpiration) ? c.dateExpiration : '';
    if (c.expiration === 'date' && !c.dateExpiration) throw new AK.ErreurMetier('Indiquez la date de fin de validité de la carte.', 'carte.dateExpiration');
    c.bande = /^#[0-9a-f]{6}$/i.test(c.bande) ? c.bande : CARTE_DEFAUT.bande;
    c.filet = /^#[0-9a-f]{6}$/i.test(c.filet) ? c.filet : CARTE_DEFAUT.filet;
    o.carte = c;
  }
  const logoEcole = () => {
    const sc = S().school;
    return sc.logoEcole && u.IMG_OK.test(sc.logoEcole) ? sc.logoEcole : sc.armoiries && u.IMG_OK.test(sc.armoiries) ? sc.armoiries : AK.assets.armoiries;
  };
  function enveloppe(ctx, r, type, corps, agent) {
    const f = AK.cartes.format(r), c = r.carte;
    const cls = `carte-id${agent ? ' agent' : ''}${f.classe ? ' ' + f.classe : ''}${c.eco ? ' eco' : ''}`;
    const statut = ctx._statut ? AK.filigrane.libelleStatut(ctx._statut) : '';
    return html`<div class="${cls}" style="--cw:${f.l}mm;--ch:${f.h}mm;--c-acc:${agent ? '#13233a' : c.bande};--c-acc2:${c.filet}">${AK.filigrane.calques(r.filigrane, ctx._statut, f.l, f.h)}
      <div class="bande"><img src="${logoEcole()}" alt=""><div class="ecole"><b>${S().school.name || 'ÉCOLE'}</b><span>${[S().school.iepp, S().school.drenaet].filter(Boolean).join(' · ')}</span></div><div class="type"><b>${type}</b><span>${S().school.year || ''}</span></div></div><div class="filet"></div>
      ${corps}${statut ? html`<div class="statut-carte">${statut}</div>` : ''}</div>`;
  }
  const photo = (p) => html`<div class="photo">${p.photo ? html`<img src="${p.photo}" alt="">` : raw('<span>PHOTO</span>')}</div>`;
  const qr = (ctx) => (ctx.qrTexte ? html`<div class="qr">${AK.qr.svg(ctx.qrTexte, { titre: 'QR code de la carte' })}</div><div class="ref">${ctx.ref}</div>` : '');
  const validite = (ctx) => (ctx.doc && ctx.doc.expire ? html`Valable jusqu’au <b>${u.fmtDate(ctx.doc.expire)}</b>` : html`Validité : <b>année ${S().school.year || ''}</b>`);
  function verso(ctx, r, titre, lignes, agent) {
    const f = AK.cartes.format(r), sc = S().school;
    return html`<div class="carte-id verso${agent ? ' agent' : ''}" style="--cw:${f.l}mm;--ch:${f.h}mm;--c-acc:${agent ? '#13233a' : r.carte.bande}">${AK.filigrane.calques({ type: 'logo', logo: 'ecole', opacite: 5, taille: 70 }, ctx._statut, f.l, f.h)}
      <div class="v-tete">${titre}</div><div class="v-texte">${lignes.map((l) => html`<p>${l}</p>`)}</div>
      <div class="v-pied"><span>${sc.name}${sc.adresse ? ' · ' + sc.adresse : ''}${sc.telephone ? ' · ' + sc.telephone : ''}</span><span>${ctx.ref || ''}</span></div></div>`;
  }

  AK.modeles.def({
    id: 'carte-eleve', version: 1, lib: 'Carte d’identité scolaire', categorie: 'carte', sujet: 'eleve', icone: 'idCard',
    description: 'Format carte bancaire (ID-1), portrait ou badge ; planche A4 de 10 cartes avec traits de coupe ou impression à l’unité.',
    emission: { type: 'CEL', politique: 'registre', expire: (ctx, r) => AK.cartes.expiration(r) },
    champsOptionnels: [['naissance', 'Date de naissance', true], ['sexe', 'Sexe', false], ['signature', 'Zone de signature du directeur', true]],
    defauts: {
      titre: 'Carte scolaire', champs: { naissance: true, sexe: false, signature: true },
      filigrane: { type: 'logo', opacite: 6, taille: 55 }, qr: { actif: true, identite: true, taille: 17 }, carte: { ...CARTE_DEFAUT },
      texte: 'Cette carte est personnelle. Elle doit être présentée à toute demande du personnel de l’école.\n\nEn cas de perte, prévenir la direction. Toute carte trouvée doit être rapportée à l’école.'
    },
    valider,
    rendu(ctx, r) {
      const s = ctx.eleve, x = X();
      ctx._statut = ctx._statutCarte;
      const corps = html`${photo(s)}<div class="infos"><div class="nom">${s.nom}</div><div class="prenoms">${s.prenoms}</div><dl><dt>Matricule</dt><dd class="mono">${x.matOf(s)}</dd><dt>Classe</dt><dd>${s.classe}</dd>${r.champs.naissance !== false ? html`<dt>Né(e) le</dt><dd>${s.ageEstime ? '—' : u.fmtDate(s.naissance)}</dd>` : ''}${r.champs.sexe ? html`<dt>Sexe</dt><dd>${s.sexe}</dd>` : ''}</dl></div>${qr(ctx)}
        <div class="pied"><span class="valid">${validite(ctx)}</span>${r.champs.signature !== false ? html`<span class="sig">Le Directeur</span>` : ''}</div>`;
      return {
        carte: enveloppe(ctx, r, 'Carte d’identité scolaire', corps, false),
        verso: r.carte.verso ? verso(ctx, r, 'Carte d’identité scolaire', String(r.texte || '').split(/\n{2,}/).filter(Boolean).concat(['Vérification : scanner le QR code avec AKWA SCHOOL (Vérifier un document).']), false) : null,
        format: AK.cartes.format(r)
      };
    }
  });

  AK.modeles.def({
    id: 'carte-agent', version: 1, lib: 'Carte professionnelle du personnel', categorie: 'carte', sujet: 'agent', icone: 'idCard',
    description: 'Enseignants et personnel administratif : nom, fonction, matricule, établissement, validité.',
    emission: { type: 'CPE', politique: 'registre', expire: (ctx, r) => AK.cartes.expiration(r) },
    champsOptionnels: [['emploi', 'Emploi / grade', true], ['classes', 'Classe(s) tenue(s)', false], ['signature', 'Zone de signature du directeur', true]],
    defauts: {
      titre: 'Carte professionnelle', champs: { emploi: true, classes: false, signature: true },
      filigrane: { type: 'logo', opacite: 6, taille: 55 }, qr: { actif: true, identite: true, taille: 17 }, carte: { ...CARTE_DEFAUT },
      texte: 'Cette carte est strictement personnelle et doit être restituée à la direction en cas de départ de l’établissement.\n\nEn cas de perte, prévenir immédiatement la direction.'
    },
    valider,
    rendu(ctx, r) {
      const t = ctx.agent, x = X();
      ctx._statut = ctx._statutCarte;
      const corps = html`${photo(t)}<div class="infos"><div class="nom">${AK.valid.civ.sans(t.nom)}</div><div class="prenoms">${t.fonction || ''}</div><dl><dt>Matricule</dt><dd class="mono">${t.matricule || '—'}</dd>${r.champs.emploi !== false && x.emploiGrade(t) ? html`<dt>Emploi</dt><dd>${x.emploiGrade(t)}</dd>` : ''}${r.champs.classes && x.clsTxt(t) ? html`<dt>Classe</dt><dd>${x.clsTxt(t)}</dd>` : ''}</dl></div>${qr(ctx)}
        <div class="pied"><span class="valid">${validite(ctx)}</span>${r.champs.signature !== false ? html`<span class="sig">Le Directeur</span>` : ''}</div>`;
      return {
        carte: enveloppe(ctx, r, 'Carte professionnelle', corps, true),
        verso: r.carte.verso ? verso(ctx, r, 'Carte professionnelle', String(r.texte || '').split(/\n{2,}/).filter(Boolean).concat(['Vérification : scanner le QR code avec AKWA SCHOOL (Vérifier un document).']), true) : null,
        format: AK.cartes.format(r)
      };
    }
  });
})(window.AK);
