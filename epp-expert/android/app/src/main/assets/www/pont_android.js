/* Pont entre l'interface v8 (la même que l'application Windows AKWA SCHOOL v8) et le téléphone (AkwaNative, Pont.java).
   Chargé dans <head>, avant le code de l'interface. Les données restent sur le téléphone (fichier privé etat_v8.json,
   copie de chaque jour de la semaine) ; elles passent sur l'ordinateur par la sauvegarde v8
   (Rapports & administration › Import, export & sauvegarde). Le mot de passe administrateur, le code de secours et
   la licence du téléphone sont gérés par l'application (empreintes PBKDF2, jamais dans la page). */
(function(){
 const N=window.AkwaNative;if(!N)return;
 const FICHIER='etat_v8.json',JOURS=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
 const VERROU_APRES=5*60*1000;      // verrouillage après 5 minutes hors de l'application
 const attentes={};let compteur=0,minuterie=null,copieDu='',pauseDepuis=0,ouvert=false;
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
  bandeau(){$('#crumb').insertAdjacentHTML('beforeend',`<span class="sp"></span><span class="sub" style="margin-left:auto;display:flex;gap:8px;align-items:center">${ic('users')}Directeur<button class="btn sm" data-act="verrouiller">${ic('lock')}Verrouiller</button></span>`)}
 };

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
  v.innerHTML=`<form class="bx" novalidate><h1>AKWA <b>SCHOOL</b></h1>${html}<p class="err" id="vErr" hidden></p></form>`;
  const f=v.querySelector('form');
  f.addEventListener('submit',e=>{e.preventDefault();onok(new FormData(f),m=>{const p=f.querySelector('#vErr');p.textContent=m;p.hidden=!m})});
  const a=f.querySelector('input');if(a)setTimeout(()=>a.focus(),50);
  return f;
 }
 // tant que l'écran de verrouillage est affiché, le reste de la page est invisible
 function cacher(oui){let c=document.getElementById('akwaCache');if(oui&&!c){c=document.createElement('style');c.id='akwaCache';c.textContent='body>*:not(#akwaVerrou){visibility:hidden!important}';document.head.appendChild(c)}if(!oui&&c)c.remove()}
 cacher(true);
 function fermerEcran(){const v=document.getElementById('akwaVerrou');if(v)v.remove();cacher(false);ouvert=true}
 function afficherCode(code,suite){
  ecran(`<p><b>Votre code de secours</b></p><p class="code">${esc(code)}</p><p class="sub">Il permet de choisir un nouveau mot de passe en cas d’oubli, sans Internet. Notez-le et rangez-le en lieu sûr ; il ne sert qu’une fois.</p><button class="btn pri">J’ai noté le code</button>`,()=>suite());
 }
 function premierLancement(){
  ecran(`<p><b>Bienvenue.</b> Choisissez le mot de passe administrateur du téléphone. Il sera demandé à chaque ouverture et pour les corrections.</p>
<input type="password" name="a" placeholder="Mot de passe (6 caractères au moins)" autocomplete="new-password"><input type="password" name="b" placeholder="Confirmer le mot de passe" autocomplete="new-password"><button class="btn pri">Créer</button>`,(f,err)=>{
   const a=f.get('a'),b=f.get('b');
   if(a.length<6)return err('Le mot de passe doit compter 6 caractères au moins.');
   if(a!==b)return err('Les deux mots de passe sont différents.');
   if(!N.definirAdmin(a,''))return err('Enregistrement impossible.');
   N.demarrerEssai();afficherCode(N.nouveauCodeSecours(),licenceOuApp);
  });
 }
 function connexion(){
  const f=ecran(`<p>Mot de passe administrateur</p><input type="password" name="m" autocomplete="current-password"><button class="btn pri">Ouvrir</button><button type="button" class="lien" data-oubli>Mot de passe oublié ?</button>`,(f,err)=>{
   const w=N.attenteAdmin();if(w>0)return err(`Trop d’essais : patientez ${w} s.`);
   if(!N.verifierAdmin(f.get('m')))return err('Mot de passe incorrect.');
   licenceOuApp();
  });
  f.querySelector('[data-oubli]').addEventListener('click',oubli);
 }
 function oubli(){
  const f=ecran(`<p>Saisissez le code de secours, puis le nouveau mot de passe.</p><input name="c" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters"><input type="password" name="n" placeholder="Nouveau mot de passe" autocomplete="new-password"><button class="btn pri">Valider</button><button type="button" class="lien" data-retour>Retour</button>`,(f,err)=>{
   const r=json(N.recupererAdmin(f.get('c'),f.get('n')));
   if(!r.ok)return err(r.message||'Code de secours incorrect.');
   afficherCode(r.secours,licenceOuApp);
  });
  f.querySelector('[data-retour]').addEventListener('click',connexion);
 }
 function licenceOuApp(){
  const e=json(N.licence());
  if(e.utilisable)return entrer();
  const f=ecran(`<p>${esc(e.message||'Licence à activer.')}</p><input name="c" placeholder="AKWA-1AN-XXXX-XXXX" autocomplete="off" autocapitalize="characters"><button class="btn pri">Activer (Internet nécessaire)</button>`,(f,err)=>{
   const b=document.querySelector('#akwaVerrou .btn');b.disabled=true;err('Activation en cours…');
   attendre(id=>N.activer(id,f.get('c').trim().toUpperCase(),S.school.name||'')).then(r=>{b.disabled=false;if(!r.ok)return err(r.message||'Activation impossible.');entrer()});
  });
  return f;
 }
 function entrer(){S.school.licence=licencePage();APP.enregistrer();fermerEcran();applyTheme();render()}
 function verrouiller(){if(minuterie)APP.enregistrer();closeDlg();ouvert=false;cacher(true);connexion()}

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
  Object.assign(acts,{
   verrouiller,
   secoursNew(){askPwd('Créer un nouveau code de secours ? L’ancien ne servira plus.').then(ok=>{if(ok)setTimeout(()=>montrerCode(N.nouveauCodeSecours()),50)})},
   pwdOubli(){closeDlg();setTimeout(()=>modal(`${ic('key')} Mot de passe oublié`,`<p class="sub" style="margin-top:0">Saisissez le code de secours, puis le nouveau mot de passe.</p>${field('Code de secours','<input name="code" autofocus autocomplete="off" placeholder="XXXX-XXXX-XXXX">',1)}${field('Nouveau mot de passe','<input name="nw" type="password" required minlength="6">',1)}`,
    {ok:'Valider',onok:f=>{const r=json(N.recupererAdmin(f.get('code'),f.get('nw')));if(!r.ok){toast(r.message||'Code de secours incorrect.');return false}closeDlg();log('Mot de passe administrateur changé avec le code de secours');setTimeout(()=>montrerCode(r.secours),50);return false}}),30)},
   ensCreer(){toast('Les comptes des enseignants se créent dans AKWA SCHOOL v8, sur l’ordinateur.')},
   ensReinit(){toast('Les comptes des enseignants se gèrent dans AKWA SCHOOL v8, sur l’ordinateur.')}
  });
  // formulaires traités par le téléphone : mot de passe administrateur, activation de la licence
  document.addEventListener('submit',e=>{const f=e.target;if(!['pwdForm','actForm'].includes(f.id))return;
   e.preventDefault();e.stopImmediatePropagation();const d=new FormData(f);
   if(f.id==='pwdForm'){if(String(d.get('nw')).length<6)return toast('Le nouveau mot de passe doit compter 6 caractères au moins.');
    if(!N.definirAdmin(d.get('nw'),d.get('old')))return toast('Ancien mot de passe incorrect.');log('Mot de passe administrateur changé');toast('Mot de passe changé');f.reset()}
   if(f.id==='actForm'){toast('Activation en cours…');attendre(id=>N.activer(id,String(d.get('code')).trim().toUpperCase(),S.school.name||'')).then(r=>{if(!r.ok)return toast(r.message||'Activation impossible.');
    S.school.licence=licencePage();log('Activation : '+((r.licence&&r.licence.message)||'licence activée'));save();toast((r.licence&&r.licence.message)||'Licence activée');applyTheme();render()})}
  },true);
  // ouverture : création du mot de passe, puis mot de passe à chaque ouverture, puis licence
  if(JSON.parse(N.infos()).admin)connexion();else premierLancement();
 });
})();
