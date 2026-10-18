/* Pont entre l'interface v8 (la même que l'application Windows AKWA SCHOOL v8) et le téléphone (AkwaNative, Pont.java).
   Chargé dans <head>, avant le code de l'interface. Les données restent sur le téléphone (fichier privé etat_v8.json,
   copie de chaque jour de la semaine) ; elles passent sur l'ordinateur par la sauvegarde v8
   (Rapports & administration › Import, export & sauvegarde). Le mot de passe administrateur, les comptes des enseignants
   (créés par le directeur sur ce téléphone), les codes de secours et la licence du téléphone sont gérés par l'application
   (empreintes PBKDF2, jamais dans la page). */
(function(){
 const N=window.AkwaNative;if(!N)return;
 const FICHIER='etat_v8.json',JOURS=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
 const VERROU_APRES=5*60*1000;      // verrouillage après 5 minutes hors de l'application
 const attentes={};let compteur=0,minuterie=null,copieDu='',pauseDepuis=0,ouvert=false,session={role:'dir'};
 window.akwaRetour=function(id){const f=attentes[id];delete attentes[id];let r;try{r=JSON.parse(N.resultat(id))}catch(e){r=null}if(f)f(r||{ok:false,message:'Réponse illisible.'})};
 const attendre=lancer=>new Promise(ok=>{const id='r'+(++compteur);attentes[id]=ok;lancer(id)});
 const jour=d=>{const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,10)};
 const json=t=>{try{return JSON.parse(t)}catch(e){return {}}};
 const secrets=o=>{const c=JSON.parse(JSON.stringify(o));delete c.school.adminPwd;delete c.school.secours;delete c.session;return c};

 /** Licence du téléphone (Licence.java) au format de l'interface v8. */
 function licencePage(){
  const e=json(N.licence()),auj=Date.now();
  if(e.statut==='active'&&!e.expire_le)return {type:'vie'};
  if(e.expire_le&&(e.statut==='active'||e.statut==='expiree'))return {type:'an',fin:e.expire_le.slice(0,10)};
  const reste=e.statut==='essai'?Number(e.jours_restants)||0:0;
  return {type:'essai',debut:jour(auj-(7-reste)*864e5)};
 }

 const APP=window.APP={
  telephone:true,
  charger(){
   let o=json(N.lire(FICHIER)||'null');
   if(!o||o.v!==5||!Array.isArray(o.students))o={v:5,school:{...ECOLE,idLock:false},students:[],teachers:[],grades:{},compAbs:{},att:{},appel:{},auth:[],conges:[],
    redac:{},persoReps:[],archives:{},lastBackup:'',log:[],messages:[],attente:{},saisie:{}};
   else o=migrate(o);
   o.messages=o.messages||[];o.teachers.forEach(t=>{if(t.compte===undefined)t.compte=null});
   o.school.adminPwd='';o.school.secours='—';o.school.licence=licencePage();o.session={role:'dir'};
   return o;
  },
  etatJSON(){return JSON.stringify(secrets(S))},
  enregistrer(){
   clearTimeout(minuterie);minuterie=null;
   const t=APP.etatJSON(),d=new Date();
   if(!N.ecrire(FICHIER,t))return toast('Enregistrement impossible : mémoire du téléphone pleine ?');
   if(copieDu!==jour(d)){copieDu=jour(d);N.ecrire('copie_v8_'+JOURS[d.getDay()]+'.json',t)}
  },
  verifierAdmin(p){return Promise.resolve(N.attenteAdmin()===0&&N.verifierAdmin(p))},
  nomSession(){const t=session.role==='ens'&&S.teachers.find(x=>x.id===session.tid);return t?t.nom:'Directeur (administrateur)'},
  bandeau(){$('#crumb').insertAdjacentHTML('beforeend',`<span class="sp"></span><span class="sub" style="margin-left:auto;display:flex;gap:8px;align-items:center">${ic('users')}${esc(APP.nomSession())}</span>`);
   const h=$('#helpBtn');if(h&&!$('#akwaLock'))h.insertAdjacentHTML('beforebegin',`<button class="ib" data-act="verrouiller" id="akwaLock" title="Verrouiller (changer d’utilisateur)" aria-label="Verrouiller">${ic('lock')}</button>`)}
 };

 function loginDe(nom){const p=nom.replace(/^(M\.|Mme|Mlle)\s+/,'').split(/\s+/);return ((p[1]||'')[0]||'').toLowerCase()+(p[0]||'').toLowerCase().normalize('NFD').replace(/[^a-z]/g,'')}
 function montrerCode(code,suite){modal(`${ic('key')} Code de secours`,`<p>Il permet de choisir un nouveau mot de passe en cas d’oubli, sans Internet. Notez-le et rangez-le en lieu sûr ; il ne sert qu’une fois.</p><p style="font-size:22px;font-weight:700;letter-spacing:2px;text-align:center">${esc(code)}</p>`,{noFoot:true,onclose:suite})}

 // ------------------------------------------------------------------ écran de verrouillage (ouverture de l'application)
 const CSS=`#akwaVerrou{position:fixed;inset:0;z-index:2147483000;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
#akwaVerrou .bx{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:22px;display:grid;gap:12px}
#akwaVerrou h1{margin:0;font:700 22px var(--disp);color:var(--acc)}#akwaVerrou h1 b{color:var(--org)}
#akwaVerrou p{margin:0}#akwaVerrou input{width:100%;padding:11px 12px;font-size:16px}#akwaVerrou .btn{justify-content:center;padding:11px 12px}
#akwaVerrou .lien{background:none;border:0;color:var(--acc);font-weight:600;padding:4px}#akwaVerrou .code{font-size:22px;font-weight:700;letter-spacing:2px;text-align:center}`;
 function ecran(html,onok){
  let v=document.getElementById('akwaVerrou');
  if(!v){v=document.createElement('div');v.id='akwaVerrou';document.body.appendChild(v)}
  v.innerHTML=`<form class="bx" novalidate><h1>AKWA <b>SCHOOL</b></h1>${html}<p class="err" id="vErr" hidden></p><p class="sub" style="text-align:center;font-size:12px">Version ${esc(json(N.infos()).version||'')} · interface v8</p></form>`;
  const f=v.querySelector('form');
  f.addEventListener('submit',e=>{e.preventDefault();onok(new FormData(f),m=>{const p=f.querySelector('#vErr');p.textContent=m;p.hidden=!m})});
  const a=f.querySelector('[autofocus]')||f.querySelector('input');if(a)setTimeout(()=>a.focus(),50);
  return f;
 }
 // tant que l'écran de verrouillage est affiché, le reste de la page est invisible
 function cacher(oui){let c=document.getElementById('akwaCache');if(oui&&!c){c=document.createElement('style');c.id='akwaCache';c.textContent='body>*:not(#akwaVerrou){visibility:hidden!important}';document.head.appendChild(c)}if(!oui&&c)c.remove()}
 cacher(true);
 function fermerEcran(){const v=document.getElementById('akwaVerrou');if(v)v.remove();cacher(false);ouvert=true}
 function afficherCode(code,suite){
  ecran(`<p><b>Votre code de secours</b></p><p class="code">${esc(code)}</p><p class="sub">Il permet de choisir un nouveau mot de passe en cas d’oubli, sans Internet. Notez-le et rangez-le en lieu sûr ; il ne sert qu’une fois.</p><button class="btn pri">J’ai noté le code</button>`,()=>suite());
 }
 // espace enseignant seul : sa classe sans école ; le mot de passe « admin » du téléphone est le sien
 const estSolo=()=>{try{return !!(S.school.solo&&S.teachers.some(t=>t.id===S.school.solo.tid))}catch(e){return false}};
 // compte enseignant supprimé ou désactivé dans les données : refus (jamais de repli sur le directeur)
 const refusEns=r=>{if(!r.ok||r.role!=='ens')return '';const t=S.teachers.find(x=>x.id===r.tid);const m=!t||!t.compte?'Utilisateur inexistant.':!t.actif||!t.compte.actif?'Compte désactivé. Adressez-vous au directeur.':'';if(m)N.deconnecter();return m};
 const sessionDe=r=>r.role==='ens'?{role:'ens',tid:r.tid}:estSolo()?{role:'ens',tid:S.school.solo.tid,solo:true}:{role:'dir'};
 const espace=()=>session&&session.solo?'enseignant':'ecole';
 const licEns=e=>/^ens/.test(e.type||'');
 function premierLancement(){
  const f=ecran(`<p><b>Bienvenue.</b> Qui utilise ce téléphone ?</p><button class="btn pri">Le directeur (espace de l’école)</button><button type="button" class="btn" data-ens>Un enseignant seul (sans l’école)</button>`,creerDirecteur);
  f.querySelector('[data-ens]').addEventListener('click',creerEnseignant);
 }
 // renseignements demandés à la création : directeur, secteur, inspection, inspecteur et conseiller pédagogique
 const CH_DIR=[['director','Nom et prénoms du directeur'],['dirTel','Contact du directeur']];
 const CH_IEPP=[['secteur','Secteur pédagogique'],['iepp','Inspection (IEPP), ex. OUANINOU'],['inspNom','Nom et prénoms de l’inspecteur'],['inspTel','Contact de l’inspecteur'],['cpNom','Nom et prénoms du conseiller pédagogique'],['cpTel','Contact du conseiller pédagogique']];
 const champs=L=>L.map(([k,l])=>`<input name="${k}" placeholder="${l}"${/Tel$/.test(k)?' inputmode="tel" autocomplete="off"':''}>`).join('');
 function lireChamps(f,L,err){const o={};for(const[k,l]of L){const v=String(f.get(k)||'').trim();if(!v){err(l.replace(/,.*$/,'')+' : à renseigner.');return null}o[k]=v}return o}
 function appliquerEcole(o){const sc=S.school;Object.assign(sc,o);const lieu=String(o.iepp||'').replace(/^IEPP\s+/i,'').trim().toUpperCase();
  if(lieu){sc.iepp='IEPP '+lieu;sc.inspection="INSPECTION DE L'ENSEIGNEMENT PRESCOLAIRE ET PRIMAIRE DE "+lieu}}
 function creerEnseignant(){
  const f=ecran(`<p><b>Espace enseignant.</b> Vous tenez votre classe seul ; le directeur pourra le rattacher plus tard à l’école.</p><input name="nom" placeholder="Vos nom et prénoms" autocomplete="name"><select name="cls">${CLASSES.map(c=>`<option>${c}</option>`).join('')}</select><input name="ecole" placeholder="Nom de l’école (facultatif)">${champs(CH_DIR)}${champs(CH_IEPP)}
<input type="password" name="a" placeholder="Mot de passe (6 caractères au moins)" autocomplete="new-password"><input type="password" name="b" placeholder="Confirmer le mot de passe" autocomplete="new-password"><button class="btn pri">Créer mon espace</button><button type="button" class="lien" data-retour>Retour</button>`,(f,err)=>{
   const nom=String(f.get('nom')).trim(),a=f.get('a'),b=f.get('b'),ec=String(f.get('ecole')).trim();
   if(nom.length<3)return err('Saisissez vos nom et prénoms.');
   const o=lireChamps(f,[...CH_DIR,...CH_IEPP],err);if(!o)return;
   if(a.length<6)return err('Le mot de passe doit compter 6 caractères au moins.');
   if(a!==b)return err('Les deux mots de passe sont différents.');
   if(!N.definirAdmin(a,''))return err('Enregistrement impossible.');
   N.connecter('admin',a);
   const t={id:uid(),nom:majNomComplet(nom),matricule:'',fonction:'Instituteur',grade:'',classe:f.get('cls'),tel:'',photo:'',actif:true,compte:null};
   S.teachers=[t];S.students=[];S.school.solo={tid:t.id};S.school.name=ec.toUpperCase();appliquerEcole(o);
   session={role:'ens',tid:t.id,solo:true};N.demarrerEssai();APP.enregistrer();afficherCode(N.nouveauCodeSecours(),licenceOuApp);
  });
  f.querySelector('[data-retour]').addEventListener('click',premierLancement);
 }
 function creerDirecteur(){
  ecran(`<p><b>Bienvenue.</b> Choisissez le mot de passe administrateur du téléphone. Il sera demandé à chaque ouverture et pour les corrections.</p>
${champs([['director','Vos nom et prénoms (directeur)'],['dirTel','Votre contact']])}${champs(CH_IEPP)}<input type="password" name="a" placeholder="Mot de passe (6 caractères au moins)" autocomplete="new-password"><input type="password" name="b" placeholder="Confirmer le mot de passe" autocomplete="new-password"><button class="btn pri">Créer</button>`,(f,err)=>{
   const a=f.get('a'),b=f.get('b'),o=lireChamps(f,[...CH_DIR,...CH_IEPP],err);if(!o)return;
   if(a.length<6)return err('Le mot de passe doit compter 6 caractères au moins.');
   if(a!==b)return err('Les deux mots de passe sont différents.');
   if(!N.definirAdmin(a,''))return err('Enregistrement impossible.');
   N.connecter('admin',a);session={role:'dir'};appliquerEcole(o);APP.enregistrer();N.demarrerEssai();afficherCode(N.nouveauCodeSecours(),licenceOuApp);
  });
 }
 function connexion(){
  const so=estSolo()&&S.teachers.find(x=>x.id===S.school.solo.tid);
  const f=ecran(`${so?`<p>Espace enseignant de <b>${esc(so.nom)}</b> (${esc(so.classe)}).</p><input name="l" value="admin" type="hidden">`:`<p>Identifiant : <b>admin</b> pour le directeur, ou celui remis à l’enseignant.</p><input name="l" value="admin" autocomplete="username" autocapitalize="none">`}<input type="password" name="m" placeholder="Mot de passe" autocomplete="current-password" autofocus><button class="btn pri">Ouvrir</button><button type="button" class="lien" data-oubli>Mot de passe oublié ?</button>`,(f,err)=>{
   const r=json(N.connecter(f.get('l'),f.get('m')));
   if(!r.ok)return err(r.message||'Identifiant ou mot de passe incorrect.');
   const refus=refusEns(r);if(refus)return err(refus);
   session=sessionDe(r);
   if(r.provisoire)return nouveauMotDePasse();
   licenceOuApp();
  });
  f.querySelector('[data-oubli]').addEventListener('click',()=>oubli(f.querySelector('[name=l]').value));
 }
 /** Première connexion d'un enseignant : il remplace le mot de passe provisoire et reçoit son code de secours. */
 function nouveauMotDePasse(){
  ecran(`<p><b>Première connexion.</b> Choisissez votre mot de passe personnel.</p><input type="password" name="a" placeholder="Mot de passe (6 caractères au moins)" autocomplete="new-password"><input type="password" name="b" placeholder="Confirmer le mot de passe" autocomplete="new-password"><button class="btn pri">Valider</button>`,(f,err)=>{
   if(f.get('a')!==f.get('b'))return err('Les deux mots de passe sont différents.');
   const r=json(N.choisirMotDePasse(f.get('a')));
   if(!r.ok)return err(r.message||'Enregistrement impossible.');
   afficherCode(r.secours,licenceOuApp);
  });
 }
 function oubli(login){
  const f=ecran(`<p>Saisissez votre identifiant, le code de secours, puis le nouveau mot de passe.</p><input name="l" value="${esc(login||'admin')}" autocomplete="username" autocapitalize="none"><input name="c" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters"><input type="password" name="n" placeholder="Nouveau mot de passe" autocomplete="new-password"><button class="btn pri">Valider</button><button type="button" class="lien" data-retour>Retour</button>`,(f,err)=>{
   const l=String(f.get('l')).trim().toLowerCase();
   const r=json(!l||l==='admin'?N.recupererAdmin(f.get('c'),f.get('n')):N.recupererCompte(l,f.get('c'),f.get('n')));
   if(!r.ok)return err(r.message||'Code de secours incorrect.');
   const c=json(N.connecter(l||'admin',f.get('n')));const refus=refusEns(c);if(refus)return err(refus);session=sessionDe(c);
   afficherCode(r.secours,licenceOuApp);
  });
  f.querySelector('[data-retour]').addEventListener('click',connexion);
 }
 function licenceOuApp(){
  const e=json(N.licence());
  // une licence enseignant n'ouvre que les sessions d'enseignant, jamais l'espace du directeur
  if(e.utilisable&&(!licEns(e)||session.role==='ens'))return entrer();
  // la licence (activation, date d'expiration) ne regarde que le directeur, ou l'enseignant seul pour son espace
  if(session&&session.role==='ens'&&!session.solo){const f=ecran('<p>L’application n’est pas utilisable pour le moment. Adressez-vous au directeur.</p><button class="btn pri">Retour</button>',()=>connexion());return f}
  const msg=e.utilisable?'Ce téléphone a une licence enseignant : l’espace du directeur demande un code école.':e.message||'Licence à activer.';
  const f=ecran(`<p>${esc(msg)}</p><input name="c" placeholder="EPP-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters"><button class="btn pri">Activer (Internet nécessaire)</button>`,(f,err)=>{
   const b=document.querySelector('#akwaVerrou .btn');b.disabled=true;err('Activation en cours…');
   attendre(id=>N.activerEspace(id,f.get('c').trim().toUpperCase(),S.school.name||'',espace())).then(r=>{b.disabled=false;if(!r.ok)return err(r.message||'Activation impossible.');entrer()});
  });
  return f;
 }
 function entrer(){S.school.licence=licencePage();S.session=session;APP.enregistrer();fermerEcran();location.hash='#accueil';applyTheme();render()}
 function verrouiller(){if(minuterie)APP.enregistrer();closeDlg();N.deconnecter();ouvert=false;cacher(true);connexion()}

 // ------------------------------------------------------------------ cycle de vie Android (MainActivity)
 window.akwaArriere=function(){
  if(!ouvert)return false;
  if(dlg.open){closeDlg();return true}
  if(location.hash&&location.hash!=='#accueil'){history.back();return true}
  return false;
 };
 window.akwaPause=function(){if(minuterie)APP.enregistrer();pauseDepuis=Date.now()};
 window.akwaReprise=function(){if(ouvert&&pauseDepuis&&Date.now()-pauseDepuis>VERROU_APRES)verrouiller();pauseDepuis=0};

 document.addEventListener('DOMContentLoaded',()=>{
  const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
  // enregistrement sur le téléphone (regroupé : une écriture au plus toutes les 0,4 s)
  save=function(){clearTimeout(minuterie);minuterie=setTimeout(APP.enregistrer,400)};
  // fichiers : Android demande où les enregistrer (Téléchargements, Drive…) ; l'indicateur UTF-8 des CSV est ajouté par l'application
  download=function(nom,texte,type='text/plain'){let t=String(texte);if(/csv/.test(type))t=t.replace(/^﻿/,'');
   attendre(id=>N.enregistrerFichier(id,nom,type,t)).then(r=>{if(r.ok)toast('Fichier enregistré : '+nom);else if(!r.annule)toast(r.message||'Enregistrement impossible.')})};
  // impression : la page elle-même (zone d'impression), en A4 portrait ou paysage ; « Enregistrer en PDF » est proposé par Android
  window.print=function(){const a=$('#printArea');N.imprimerPage(!!(a&&/landscape/.test(a.innerHTML)))};
  acts.deconnexion=()=>verrouiller();
  // sauvegarde complète réservée à l'application activée (pas pendant l'essai)
  const sauvegarder=acts.backup;
  acts.backup=function(...a){if((S.school.licence||{}).type==='essai')return toast('La sauvegarde est disponible après l’activation de l’application (Paramètres › Activation).');return sauvegarder.apply(this,a)};
  Object.assign(acts,{
   verrouiller,
   secoursNew(){askPwd('Créer un nouveau code de secours ? L’ancien ne servira plus.').then(ok=>{if(ok)setTimeout(()=>montrerCode(N.nouveauCodeSecours()),50)})},
   pwdOubli(){closeDlg();setTimeout(()=>modal(`${ic('key')} Mot de passe oublié`,`<p class="sub" style="margin-top:0">Saisissez le code de secours, puis le nouveau mot de passe.</p>${field('Code de secours','<input name="code" autofocus autocomplete="off" placeholder="XXXX-XXXX-XXXX">',1)}${field('Nouveau mot de passe','<input name="nw" type="password" required minlength="6">',1)}`,
    {ok:'Valider',onok:f=>{const r=json(N.recupererAdmin(f.get('code'),f.get('nw')));if(!r.ok){toast(r.message||'Code de secours incorrect.');return false}closeDlg();log('Mot de passe administrateur changé avec le code de secours');setTimeout(()=>montrerCode(r.secours),50);return false}}),30)},
   ensCreer(t){const m=S.teachers.find(x=>x.id===t.dataset.id);
    modal('Créer le compte de '+esc(m.nom),field('Identifiant',`<input name="login" value="${esc(loginDe(m.nom))}" required autofocus autocapitalize="none">`)+'<p class="sub">Un mot de passe provisoire sera affiché. L’enseignant le changera à sa première connexion sur ce téléphone et recevra son code de secours.</p>',
     {ok:'Créer',onok:f=>{const l=f.get('login').trim().toLowerCase(),r=json(N.creerCompte(m.id,l));if(!r.ok){toast(r.message);return false}closeDlg();m.compte={login:l,actif:true,cree:today};log(`Compte enseignant créé : ${l} (${m.classe})`);save();render();
      setTimeout(()=>modal('Compte créé',`<p>Identifiant : <b>${esc(l)}</b><br>Mot de passe provisoire : <b>${esc(r.mdp)}</b></p><p class="sub">Notez-le et remettez-le à ${esc(m.nom)}.</p>`,{noFoot:true}),50);return false}})},
   ensReinit(t){const m=S.teachers.find(x=>x.id===t.dataset.id);let r=json(N.reinitCompte(m.id));
    // compte venu de l'ordinateur (sauvegarde restaurée) : il est créé sur ce téléphone avec le même identifiant
    if(!r.ok&&m.compte&&m.compte.login&&!json(N.listeComptes())[m.id])r=json(N.creerCompte(m.id,m.compte.login));
    if(!r.ok)return toast(r.message);modal('Mot de passe provisoire',`<p>Nouveau mot de passe provisoire de <b>${esc(m.nom)}</b> : <b>${esc(r.mdp)}</b></p>`,{noFoot:true});log(`Mot de passe réinitialisé : ${m.compte.login}`)}
  });
  // formulaires traités par le téléphone : mot de passe administrateur, activation de la licence
  document.addEventListener('submit',e=>{const f=e.target;if(!['pwdForm','actForm'].includes(f.id))return;
   e.preventDefault();e.stopImmediatePropagation();const d=new FormData(f);
   if(f.id==='pwdForm'){if(String(d.get('nw')).length<6)return toast('Le nouveau mot de passe doit compter 6 caractères au moins.');
    if(!N.definirAdmin(d.get('nw'),d.get('old')))return toast('Ancien mot de passe incorrect.');log('Mot de passe administrateur changé');toast('Mot de passe changé');f.reset()}
   if(f.id==='actForm'){toast('Activation en cours…');attendre(id=>N.activerEspace(id,String(d.get('code')).trim().toUpperCase(),S.school.name||'',espace())).then(r=>{if(!r.ok)return toast(r.message||'Activation impossible.');
    S.school.licence=licencePage();log('Activation : '+((r.licence&&r.licence.message)||'licence activée'));save();toast((r.licence&&r.licence.message)||'Licence activée');applyTheme();render()})}
  },true);
  // ouverture : création du mot de passe, puis mot de passe à chaque ouverture, puis licence
  if(JSON.parse(N.infos()).admin)connexion();else premierLancement();
 });
})();
