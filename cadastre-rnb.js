/* Cadastre/RNB V5.1. No build step. Browser + Node test runner.
 * Public API specifications consulted 2026-09-30. All matches are geometric,
 * not fiscal, and scores are heuristics, not statistical probabilities.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CadastreRNB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const BASE = {
    communes: 'https://geo.api.gouv.fr/communes',
    cadastre: 'https://apicarto.ign.fr/api/cadastre/parcelle',
    rnb: 'https://rnb-api.beta.gouv.fr/api/alpha/buildings',
    geocode: 'https://data.geopf.fr/geocodage/search'
  };
  const INSEE = /^(?:\d{5}|2[AB]\d{3})$/;
  const FULL = /^(\d{5}|2[AB]\d{3})(\d{3})([A-Z]{2}|0[A-Z]|\d{2})(\d{4})$/;
  const clean = v => String(v ?? '').trim();
  const norm = v => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\bst\b/g,'saint').replace(/\bste\b/g,'sainte').replace(/[^a-z0-9]+/g,' ').trim();
  function code(v) {
    let s = clean(v).toUpperCase().replace(/[.,]0+$/,'');
    if (/^\d{4}$/.test(s)) s = s.padStart(5,'0');
    return INSEE.test(s) ? s : '';
  }
  function postal(v) {
    const s = clean(v).replace(/[.,]0+$/,'');
    return /^\d{4,5}$/.test(s) ? s.padStart(5,'0') : '';
  }
  function section(v) {
    const s = clean(v).toUpperCase();
    return /^(?:[A-Z]{1,2}|0[A-Z]|\d{1,2})$/.test(s) ? s.padStart(2,'0') : '';
  }
  function number(v) {
    const s = clean(v).replace(/[.,]0+$/,'');
    return /^\d{1,4}$/.test(s) && Number(s)>0 ? s.padStart(4,'0') : '';
  }
  function prefix(v) { const s=clean(v); return /^\d{1,3}$/.test(s) ? s.padStart(3,'0') : null; }
  function fullId(v) {
    let s = clean(v).toUpperCase().replace(/[\s-]/g,'');
    if (typeof v === 'number' && /^\d{13}$/.test(s)) s='0'+s;
    const m=s.match(FULL);
    return m && Number(m[4])>0 ? { city:m[1], prefix:m[2], section:m[3], number:m[4], id:s, key:s, partial:false } : null;
  }
  function makeId(city, pre, sec, num) {
    const c=code(city), p=prefix(pre), s=section(sec), n=number(num);
    return c && p!==null && s && n ? c+p+s+n : '';
  }
  function rnbIds(v) {
    const out=[];
    for (const part of clean(v).toUpperCase().split(/[;,/\n|]+/)) {
      const c=part.replace(/[\s-]/g,'');
      if (/^[A-Z0-9]{12}$/.test(c)) out.push(c);
      else for (const token of part.split(/\s+/)) if (/^[A-Z0-9]{12}$/.test(token)) out.push(token);
    }
    return [...new Set(out)];
  }
  function numbers(raw, issues) {
    let text=clean(raw).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[\u2013\u2014]/g,'-').replace(/\b(?:A|AU)\b/g,'-').replace(/\bET\b/g,',')
      .replace(/\b(?:PARCELLES?|NUMEROS?|N[O\u00b0])\b/g,'').trim();
    const out=[];
    for (const chunk of text.split(/[;,/\n|]+/).map(x=>x.trim()).filter(Boolean)) {
      const m=chunk.match(/^(\d{1,4})\s*(P)?\s*-\s*(\d{1,4})\s*(P)?$/);
      if (m) {
        const a=+m[1], b=+m[3];
        if (a<1 || b<a || b-a+1>250 || out.length+b-a+1>250) { issues.push('Plage cadastrale invalide ou sup\u00e9rieure \u00e0 250 num\u00e9ros : '+chunk); continue; }
        for(let n=a;n<=b;n++) out.push({number:number(n),partial:!!(m[2]||m[4])});
      } else {
        const tokens=chunk.split(/\s+/).filter(Boolean);
        // A standalone p is accepted after a number.
        for(let i=0;i<tokens.length;i++) {
          const t=tokens[i].match(/^(\d{1,4})(P)?$/);
          if (!t || !number(t[1])) { issues.push('Num\u00e9ro de parcelle non interpr\u00e9t\u00e9 : '+tokens[i]); continue; }
          let partial=!!t[2]; if(tokens[i+1]==='P') {partial=true;i++;}
          out.push({number:number(t[1]),partial});
        }
      }
      if(out.length>250) {out.length=250;issues.push('Plus de 250 parcelles : saisie \u00e0 scinder.');break;}
    }
    return out;
  }
  function parseInput(fields={}) {
    const issues=[], refs=[];
    let insee=code(fields.insee), sec=clean(fields.section), nums=clean(fields.parcels), full=clean(fields.full), pre=prefix(fields.prefix);
    const city=clean(fields.city), cp=postal(fields.postal), generic=clean(fields.cadastral);
    if(clean(fields.postal)&&!cp) issues.push('Code postal invalide.');
    if(clean(fields.insee)&&!insee) issues.push('Code INSEE invalide (5 caract\u00e8res attendus).');
    if(clean(fields.prefix)&&pre===null) issues.push('Pr\u00e9fixe cadastral invalide.');
    if(generic) {
      if(fullId(generic)) full=[full,generic].filter(Boolean).join(';');
      else if(code(generic)) {
        if(insee && insee!==code(generic)) issues.push('Conflit entre Code INSEE et Code cadastral.');
        else insee=code(generic);
      } else if(section(generic)) {
        if(sec && section(sec)!==section(generic)) issues.push('Conflit entre Section et Code cadastral.');
        else sec=generic;
      } else if(/^\d{3}[A-Z]{1,2}$/i.test(generic.replace(/\s/g,''))) {
        const x=generic.replace(/\s/g,'');pre=x.slice(0,3);sec=x.slice(3);
      } else { nums=[nums,generic].filter(Boolean).join(';'); }
    }
    // Extract complete parcel identifiers BEFORE any shorter numeric token.
    function takeFull(text) {
      return text.toUpperCase().replace(/(^|[^A-Z0-9])((?:\d{5}|2[AB]\d{3})[\s-]*\d{3}[\s-]*(?:[A-Z]{2}|0[A-Z]|\d{2})[\s-]*\d{4})(?=$|[^A-Z0-9])/g, (all,start,id)=>{
        const ref=fullId(id);if(ref)refs.push(ref);else issues.push('R\u00e9f\u00e9rence compl\u00e8te invalide : '+id);return start+';';
      });
    }
    const fullRest=takeFull(full).replace(/[;,\s|/]+/g,'');
    if(fullRest) issues.push('R\u00e9f\u00e9rence compl\u00e8te non interpr\u00e9t\u00e9e : '+fullRest);
    sec=takeFull(sec);nums=takeFull(nums);
    // Explicit AB 12,13; AC 7 preserves the section-number relationship.
    let text=nums.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/(\d)\s+(?:A|AU)\s+(?=\d)/g,'$1-');
    const markers=[...text.matchAll(/\b([A-Z]{1,2}|0[A-Z])\s*:?\s*(?=\d)/g)].filter(m=>!['P','N','NO'].includes(m[1]));
    if(markers.length) {
      const before=text.slice(0,markers[0].index).replace(/[;,/\s]+/g,'');
      if(before) issues.push('Parcelles sans section explicite : '+before);
      for(let i=0;i<markers.length;i++) {
        const m=markers[i], end=i+1<markers.length?markers[i+1].index:text.length;
        for(const n of numbers(text.slice(m.index+m[0].length,end),issues)) refs.push({city:insee,prefix:pre,section:section(m[1]),...n});
      }
    } else if(nums.replace(/[;,\s]+/g,'')) {
      const secs=sec.split(/[;,/\s|]+/).map(section).filter(Boolean);
      const unique=[...new Set(secs)];
      if(unique.length!==1) issues.push(unique.length?'Plusieurs sections sans association explicite : saisir AB 12 ; AC 13.':'Section cadastrale manquante.');
      else for(const n of numbers(nums,issues)) refs.push({city:insee,prefix:pre,section:unique[0],...n});
    } else if(sec.replace(/[;,\s]+/g,'') && !refs.length) {
      // Some exports put both section and number in the section column.
      if(/\d/.test(sec) && !section(sec)) return parseInput({...fields, section:'',parcels:sec,cadastral:'',full});
      issues.push('Num\u00e9ro de parcelle manquant.');
    }
    const uniq=new Map();
    for(const ref of refs) {
      if(insee&&ref.city&&ref.city!==insee) issues.push('Conflit entre le code INSEE et la r\u00e9f\u00e9rence compl\u00e8te.');
      ref.city=ref.city||insee;
      ref.id=ref.id||makeId(ref.city,ref.prefix,ref.section,ref.number);
      const k=[ref.city,ref.prefix??'?',ref.section,ref.number].join('|');
      if(uniq.has(k)) ref.partial=ref.partial||uniq.get(k).partial;
      uniq.set(k,ref);
    }
    const suppliedRnb=rnbIds(fields.rnb);
    if(clean(fields.rnb)&&!suppliedRnb.length) issues.push('ID-RNB non interpr\u00e9t\u00e9 (12 caract\u00e8res attendus).');
    return {city,postal:cp,insee,refs:[...uniq.values()],suppliedRnb,issues:[...new Set(issues)],address:clean(fields.address)};
  }
  function featureId(feature,fallback='') {
    const p=feature?.properties||{};
    for(const raw of [p.id,p.idu,p.id_parcelle,p.idu_parcel,p.code,feature?.id]) {const f=fullId(raw);if(f)return f.id;}
    let c=code(p.code_insee||p.codeInsee||p.citycode);
    if(!c&&p.code_dep!==undefined&&p.code_com!==undefined) {
      const dep=clean(p.code_dep).toUpperCase().padStart(2,'0');
      const arr=clean(p.code_arr); const com=(/^\d{3}$/.test(arr)&&arr!=='000')?arr:clean(p.code_com).padStart(3,'0');
      c=code(dep+com);
    }
    c=c||code(fallback);
    return makeId(c,p.com_abs??p.comAbs,p.section,p.numero);
  }
  function items(json) {
    if(Array.isArray(json))return json;
    const r=json?.results;return Array.isArray(r)?r:Array.isArray(r?.features)?r.features:Array.isArray(json?.features)?json.features:[];
  }
  function building(item) {
    const p=item?.properties||item||{};
    return {...p, rnb_id:clean(p.rnb_id||item?.rnb_id).toUpperCase(), shape:p.shape||item?.geometry||null};
  }
  function active(b) {return b.is_active!==false && !['demolished','notUsable'].includes(b.status);}
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  class Engine {
    constructor(options={}) {
      this.fetch=options.fetch||globalThis.fetch?.bind(globalThis);this.sleep=options.sleep||pause;
      this.minCover=options.minCover??0.8;this.cache=new Map();this.pending=new Map();this.slots=new Map();
      this.log=[];this.cancelled=false;this.controllers=new Set();this.rate=options.rate??220;
      this.timeout=options.timeout??25000;this.maxPages=options.maxPages??100;this.retries=options.retries??2;
    }
    cancel(){this.cancelled=true;for(const c of this.controllers)c.abort();}
    check(){if(this.cancelled)throw new Error('Analyse interrompue par l\u2019utilisateur.');}
    async json(url,tag='') {
      this.check();const at=new Date().toISOString();
      const trace={date:at,ligne:tag,url,statut:'',cache:false};this.log.push(trace);
      if(this.cache.has(url)){trace.statut='OK';trace.cache=true;return this.cache.get(url);}
      if(this.pending.has(url)){trace.cache=true;try{const v=await this.pending.get(url);trace.statut='OK';return v;}catch(e){trace.statut=e.message;throw e;}}
      const task=(async()=>{
        const host=new URL(url).host;
        for(let attempt=0;attempt<=this.retries;attempt++) {
          this.check();const now=Date.now(),slot=Math.max(now,this.slots.get(host)||0);this.slots.set(host,slot+this.rate);
          if(slot>now)await this.sleep(slot-now);this.check();
          const c=new AbortController();this.controllers.add(c);const timer=setTimeout(()=>c.abort(),this.timeout);
          let delay=500*(2**attempt);
          try {
            const response=await this.fetch(url,{signal:c.signal,headers:{Accept:'application/json'}});
            if(!response.ok) {
              const err=new Error('HTTP '+response.status);err.status=response.status;
              const ra=response.headers?.get?.('retry-after');
              if(ra){const n=Number(ra);delay=Number.isFinite(n)?n*1000:Math.max(0,Date.parse(ra)-Date.now());}
              throw err;
            }
            const data=await response.json();this.cache.set(url,data);return data;
          }catch(e){
            this.check();if(attempt===this.retries || (e.status&&e.status!==429&&e.status<500))throw e;
          }finally{clearTimeout(timer);this.controllers.delete(c);}
          await this.sleep(Math.min(delay,30000));
        }
      })();
      this.pending.set(url,task);
      try{const value=await task;trace.statut='OK';return value;}
      catch(e){trace.statut=e.message;throw e;}
      finally{this.pending.delete(url);}
    }
    async paged(url,tag='') {
      const origin=new URL(url).origin,seen=new Set(),out=[];
      while(url) {
        if(seen.has(url)||seen.size>=this.maxPages)throw new Error('Pagination incompl\u00e8te ou cyclique.');
        if(new URL(url).origin!==origin)throw new Error('Lien de pagination hors service officiel.');
        seen.add(url);const json=await this.json(url,tag);out.push(...items(json));
        const next=json?.next;
        if(next!==null&&next!==undefined&&typeof next!=='string')throw new Error('Pagination RNB invalide.');
        url=next?new URL(next,url).href:null;
      }
      return out;
    }
    async commune(input,tag) {
      const warnings=[],refCities=[...new Set(input.refs.map(r=>r.city).filter(Boolean))];
      const explicit=input.insee||(refCities.length===1?refCities[0]:'');
      const fields='nom,code,codesPostaux,anciensCodes,deleguees,associees';
      if(refCities.length>1) return {codes:refCities,exact:false,method:'Plusieurs communes dans les r\u00e9f\u00e9rences',warnings:['R\u00e9f\u00e9rences de plusieurs communes : contr\u00f4le n\u00e9cessaire.']};
      if(explicit) {
        try {
          const c=await this.json(`${BASE.communes}/${explicit}?fields=${fields}`,tag);
          if(code(c?.code)!==explicit)throw new Error('Commune retourn\u00e9e diff\u00e9rente.');
          const names=[c.nom,...(c.deleguees||[]).map(x=>x.nom),...(c.associees||[]).map(x=>x.nom)].map(norm);
          if(input.city&&!names.includes(norm(input.city)))warnings.push('Ville et code INSEE discordants : le code fourni est conserv\u00e9 pour la recherche.');
          if(input.postal&&Array.isArray(c.codesPostaux)&&!c.codesPostaux.includes(input.postal))warnings.push('Code postal et commune discordants.');
          return {codes:[explicit],exact:!warnings.length,method:'Code INSEE fourni / extrait',name:c.nom,warnings};
        }catch(e){this.check();return {codes:[explicit],exact:false,method:'Code INSEE fourni, non v\u00e9rifi\u00e9',warnings:['V\u00e9rification commune impossible : '+e.message]};}
      }
      if(!input.city&&!input.postal)return {codes:[],exact:false,method:'Commune manquante',warnings:[]};
      const q=new URLSearchParams({fields,limit:'100'});
      if(input.postal)q.set('codePostal',input.postal);else q.set('nom',input.city);
      const list=await this.json(`${BASE.communes}?${q}`,tag);
      if(!Array.isArray(list))throw new Error('R\u00e9ponse communes invalide.');
      const matching=input.city?list.filter(c=>norm(c.nom)===norm(input.city)):list;
      // An associated/delegated name is reported, not silently mapped to a new commune.
      if(matching.length!==1){
        const variants=list.filter(c=>[...(c.deleguees||[]),...(c.associees||[])].some(x=>norm(x.nom)===norm(input.city)));
        if(variants.length)warnings.push('Commune associ\u00e9e/d\u00e9l\u00e9gu\u00e9e : fournir le code INSEE et le pr\u00e9fixe cadastral pour lever l\u2019ambigu\u00eft\u00e9.');
        warnings.push(matching.length>1?'Plusieurs communes possibles : fournir le code INSEE.':'Ville/code postal non r\u00e9solus sans ambigu\u00eft\u00e9.');
        return {codes:[],candidates:matching.map(c=>({code:c.code,nom:c.nom})),exact:false,method:'Commune \u00e0 pr\u00e9ciser',warnings};
      }
      return {codes:[code(matching[0].code)],exact:true,method:input.city?'Ville + code postal / nom exact':'Code postal univoque',name:matching[0].nom,warnings};
    }
    async geocode(input,locality,tag) {
      if(!input.address)return null;
      const p=new URLSearchParams({q:[input.address,input.postal,input.city].filter(Boolean).join(' '),limit:'3',index:'address'});
      if(locality.codes.length===1)p.set('citycode',locality.codes[0]);
      if(input.postal)p.set('postcode',input.postal);
      const json=await this.json(`${BASE.geocode}?${p}`,tag);
      const candidates=(json?.features||[]).filter(f=>{
        const a=f.properties||{},c=code(a.citycode||a.city_code||a.code_insee);
        return (!locality.codes.length||locality.codes.includes(c))&&(!input.postal||String(a.postcode)===input.postal);
      }).sort((a,b)=>Number(b.properties?.score||0)-Number(a.properties?.score||0));
      const f=candidates[0];
      if(!f?.geometry?.coordinates)return null;
      const p2=f.properties||{},[lon,lat]=f.geometry.coordinates;
      if(!Number.isFinite(lon)||!Number.isFinite(lat))return null;
      const score=Number(p2.score)||0,type=p2.type||'',banId=p2.id||p2.cle_interop||'';
      const requested=norm(input.address).match(/^\d{1,4}(?:\s*(?:bis|ter|quater|[a-z])\b)?\b/);
      const normalizedNumber=v=>norm(v).replace(/\bb\b/g,'bis').replace(/\bt\b/g,'ter').replace(/^0+(?=\d)/,'').replace(/\s+/g,'');
      const warnings=[],suppliedNumber=requested?requested[0].trim():'';
      if(suppliedNumber&&p2.housenumber&&normalizedNumber(suppliedNumber)!==normalizedNumber(p2.housenumber))warnings.push('Numero de voie demande et numero geocode differents.');
      if(suppliedNumber&&!p2.housenumber)warnings.push('Numero de voie non confirme par le geocodage.');
      const alternative=candidates.slice(1).find(x=>{
        const q=x.properties||{};
        return (q.id||q.cle_interop||q.label)!==(banId||p2.label)&&Number(q.score)>=0.8&&score-Number(q.score)<=0.03;
      });
      if(alternative)warnings.push('Plusieurs adresses geocodees de scores proches : verification requise.');
      if(type!=='housenumber'||score<0.8)warnings.push('Adresse non resolue au numero avec un score suffisant.');
      return {lon,lat,score,type,precise:score>=0.8&&type==='housenumber'&&!warnings.length,citycode:code(p2.citycode||p2.city_code||p2.code_insee),postcode:p2.postcode||'',city:p2.city||'',label:p2.label||'',banId,warnings};
    }

    empty(input) {
      return {input,issues:[...input.issues],errors:[],parcelFeatures:[],parcelKeys:new Set(),parcelKeysExact:new Set(),parcelKeysNearby:new Set(),parcelLabels:[],plotIds:new Set(),refPlotIds:new Set(),plotSources:new Map(),
        candidateCityCodes:[],parcelCityCodes:new Set(),rnbIds:new Set(),rnbAddressIds:new Set(),primaryRnbIds:new Set(),rnbClosest:new Map(),rnbCover:new Map(),rnbEvidence:new Map(),rnbBuildings:new Map(),suppliedRnb:new Set(input.suppliedRnb),
        geo:null,locality:{codes:[],exact:false,warnings:[]},cadastreStatus:'Non renseign\u00e9',rnbStatus:'Non recherch\u00e9',rnbDecision:'',hasPartial:input.refs.some(r=>r.partial),resolvedAt:new Date().toISOString(),complete:true};
    }
    addFeature(out,f,fallback,source) {
      const id=featureId(f,fallback);if(!id)return '';
      if(!out.parcelFeatures.some(x=>x._plotId===id))out.parcelFeatures.push({...f,_plotId:id});
      out.plotIds.add(id);out.parcelKeys.add(id);out.plotSources.set(id,source);
      if(source==='reference') {out.refPlotIds.add(id);out.parcelKeysExact.add(id);} else out.parcelKeysNearby.add(id);
      const r=fullId(id);out.parcelCityCodes.add(r.city);
      const label=`${r.city} / ${r.prefix} / ${r.section} ${r.number}`;
      if(!out.parcelLabels.includes(label))out.parcelLabels.push(label);
      return id;
    }
    addBuilding(out,item,evidence) {
      const b=building(item),id=b.rnb_id;
      if(!/^[A-Z0-9]{12}$/.test(id))return;
      out.rnbBuildings.set(id,{...(out.rnbBuildings.get(id)||{}),...b});out.rnbIds.add(id);
      if(!out.rnbEvidence.has(id))out.rnbEvidence.set(id,[]);
      if(!out.rnbEvidence.get(id).some(x=>x.source===evidence.source&&x.plot===evidence.plot&&x.url===evidence.url))out.rnbEvidence.get(id).push(evidence);
      if(evidence.source==='near'&&Number.isFinite(evidence.distance))out.rnbClosest.set(id,evidence.distance);
    }
    async enrich(fields,tag='') {
      const input=parseInput(fields),out=this.empty(input);
      const safely=async(name,task)=>{try{return await task();}catch(e){this.check();out.errors.push(name+' : '+e.message);out.complete=false;return null;}};
      const loc=await safely('Communes',()=>this.commune(input,tag));if(loc)out.locality=loc;
      out.issues.push(...out.locality.warnings);out.candidateCityCodes=out.locality.codes;
      out.geo=await safely('G\u00e9ocodage',()=>this.geocode(input,out.locality,tag));
      if(input.address&&!out.geo)out.issues.push('Adresse non geocodee : recherche RNB textuelle candidate seulement.');
      out.issues.push(...(out.geo?.warnings||[]));
      if(!out.candidateCityCodes.length&&!input.city&&!input.postal&&out.geo?.precise&&out.geo.citycode) {
        out.locality={codes:[out.geo.citycode],exact:true,method:'Adresse pr\u00e9cise g\u00e9ocod\u00e9e',warnings:[]};out.candidateCityCodes=out.locality.codes;
      }
      let resolvedRefs=0;
      for(const ref of input.refs) {
        const city=ref.city||(out.candidateCityCodes.length===1?out.candidateCityCodes[0]:'');
        if(!city){out.issues.push('Parcelle non recherch\u00e9e : commune non r\u00e9solue.');continue;}
        const p=new URLSearchParams({code_insee:city,section:ref.section,numero:ref.number,source_ign:'PCI'});
        if(ref.prefix!==null)p.set('com_abs',ref.prefix);
        const json=await safely('Cadastre '+city+' '+ref.section+' '+ref.number,()=>this.json(`${BASE.cadastre}?${p}`,tag));
        const fs=(json?.features||[]).filter(f=>{
          const id=featureId(f,city),r=fullId(id);
          return r&&r.city===city&&r.section===ref.section&&r.number===ref.number&&(ref.prefix===null||r.prefix===ref.prefix);
        });
        const ids=[...new Set(fs.map(f=>featureId(f,city)))];
        if(ids.length>1)out.issues.push('Pr\u00e9fixe cadastral ambigu pour '+ref.section+' '+ref.number+' : '+ids.join(', '));
        if(ids.length)resolvedRefs++;
        for(const f of fs)this.addFeature(out,f,city,'reference');
        if(!ids.length) {
          out.issues.push('Parcelle non retrouv\u00e9e dans le cadastre courant : '+(ref.id||city+' '+ref.section+' '+ref.number));
          // A complete user-supplied ID may still be queried in the RNB. It is not cadastre-verified.
          if(ref.id){out.plotIds.add(ref.id);out.plotSources.set(ref.id,'reference_unverified');}
        }
      }
      out.cadastreStatus=input.refs.length?(resolvedRefs===input.refs.length?'R\u00e9f\u00e9rences retrouv\u00e9es':resolvedRefs?'R\u00e9f\u00e9rences partiellement retrouv\u00e9es':'Parcelles non r\u00e9solues'):'Pas de r\u00e9f\u00e9rence fournie';
      // No guessed 000 prefix, no cartesian product of sections/numbers/cities.
      // Address-point parcels are spatial candidates, never verified references.
      if(!input.refs.length&&out.geo?.precise) {
        const p=new URLSearchParams({geom:JSON.stringify({type:'Point',coordinates:[out.geo.lon,out.geo.lat]}),source_ign:'PCI'});
        const json=await safely('Parcelle du point adresse',()=>this.json(`${BASE.cadastre}?${p}`,tag));
        for(const f of json?.features||[])this.addFeature(out,f,out.geo.citycode,'address_point');
      }
      for(const id of input.suppliedRnb) {
        const url=`${BASE.rnb}/${id}/?withPlots=1`,json=await safely('ID-RNB fourni '+id,()=>this.json(url,tag));
        if(json&&building(json).rnb_id===id)this.addBuilding(out,json,{source:'provided',url});
        else out.issues.push('ID-RNB fourni non v\u00e9rifi\u00e9 : '+id);
      }
      for(const plot of out.plotIds) {
        const url=`${BASE.rnb}/plot/${plot}/`,list=await safely('RNB parcelle '+plot,()=>this.paged(url,tag));
        for(const item of list||[]) {
          const b=building(item),raw=b.bdg_cover_ratio;
          const cover=raw!==undefined&&raw!==null&&Number.isFinite(Number(raw))?Number(raw):null;
          this.addBuilding(out,item,{source:out.plotSources.get(plot)==='reference'?'plot':'plot_approx',plot,cover,url});
        }
      }
      // A reliable address is a complementary discriminator, never the first arbitrary result.
      if(input.address) {
        const p=new URLSearchParams({min_score:'0.8'});
        if(out.geo?.precise&&out.geo.banId)p.set('cle_interop_ban',out.geo.banId);
        else p.set('q',[input.address,input.postal,input.city].filter(Boolean).join(', '));
        const url=`${BASE.rnb}/address/?${p}`;
        const json=await safely('RNB adresse',()=>this.json(url,tag));
        let list=items(json);
        if(json?.next){const rest=await safely('RNB adresse pagination',async()=>{const next=new URL(json.next,url);if(next.origin!==new URL(url).origin)throw new Error('Pagination hors service officiel.');return this.paged(next.href,tag);});list=list.concat(rest||[]);}
        if(json?.status&&json.status!=='ok'){out.issues.push('Recherche RNB par adresse : '+json.status);list=[];}
        const score=json?.score_ban;
        const precise=!!out.geo?.precise&&(p.has('cle_interop_ban')||(score!==null&&score!==undefined&&Number(score)>=0.8));
        for(const item of list)this.addBuilding(out,item,{source:precise?'address':'address_approx',url,score:score??out.geo?.score});
        if(out.geo&&(!list.length || !precise)) {
          const q=new URLSearchParams({point:`${out.geo.lat},${out.geo.lon}`,radius:'100'}),nearUrl=`${BASE.rnb}/closest/?${q}`;
          const near=await safely('RNB proches',()=>this.paged(nearUrl,tag));
          for(const item of near||[]) {
            const d=building(item).distance;
            this.addBuilding(out,item,{source:'near',url:nearUrl,distance:d!==null&&d!==undefined?Number(d):Infinity});
          }
        }
      }
      this.decide(out);out.issues=[...new Set(out.issues)];return out;
    }
    decide(out) {
      const valid=[...out.rnbBuildings].filter(([,b])=>active(b)).map(([id])=>id);
      const has=(id,src)=>(out.rnbEvidence.get(id)||[]).some(x=>x.source===src);
      const supplied=valid.filter(id=>has(id,'provided'));
      const plot=valid.filter(id=>has(id,'plot'));
      const addr=valid.filter(id=>has(id,'address'));
      for(const id of plot) {
        const byPlot=new Map();
        for(const e of out.rnbEvidence.get(id)||[])if(e.source==='plot'&&Number.isFinite(e.cover))byPlot.set(e.plot,Math.max(byPlot.get(e.plot)||0,e.cover));
        if(byPlot.size)out.rnbCover.set(id,Math.min(1,[...byPlot.values()].reduce((a,b)=>a+b,0)));
      }
      const sufficientlyCovered=id=>(out.rnbCover.get(id)||0)>=this.minCover;
      const addressPlotConflict=plot.length&&addr.length&&!plot.some(id=>addr.includes(id));
      if(addressPlotConflict)out.issues.push('Les RNB de l adresse precise et des parcelles sont incompatibles : controle requis.');
      if(supplied.length===out.suppliedRnb.size&&supplied.length) {
        out.primaryRnbIds=new Set(supplied);out.rnbDecision='ID-RNB fourni et v\u00e9rifi\u00e9';
        if(out.refPlotIds.size&&supplied.some(id=>!plot.includes(id)))out.issues.push('ID-RNB fourni non retrouv\u00e9 sur les parcelles renseign\u00e9es.');
      } else if(!addressPlotConflict&&plot.length===1&&sufficientlyCovered(plot[0])&&!out.hasPartial) {
        out.primaryRnbIds=new Set(plot);out.rnbDecision='B\u00e2timent unique sur les parcelles retrouv\u00e9es';
      } else if(plot.length>1 && !out.hasPartial) {
        const intersection=plot.filter(id=>addr.includes(id)&&sufficientlyCovered(id));
        if(intersection.length===1){out.primaryRnbIds=new Set(intersection);out.rnbDecision='Parcelle + adresse pr\u00e9cise concordantes';}
      } else if(!out.input.refs.length&&addr.length===1) {
        out.primaryRnbIds=new Set(addr);out.rnbDecision='Adresse pr\u00e9cise, RNB unique';
      }
      if(out.hasPartial)out.issues.push('Parcelle partielle : le contour entier ne prouve pas le b\u00e2timent concern\u00e9.');
      const inactive=[...out.rnbBuildings].filter(([,b])=>!active(b)).map(([id])=>id);
      if(inactive.length)out.issues.push('RNB inactifs, d\u00e9molis ou inutilisables \u00e9cart\u00e9s : '+inactive.join(', '));
      if([...out.primaryRnbIds].some(id=>out.rnbBuildings.get(id)?.status!=='constructed'))out.issues.push('Statut RNB non construit ou non renseign\u00e9 : v\u00e9rification n\u00e9cessaire.');
      out.rnbAddressIds=new Set(out.primaryRnbIds);
      out.rnbStatus=out.primaryRnbIds.size?out.rnbDecision:valid.length>1?'Plusieurs b\u00e2timents candidats':valid.length===1?'Un candidat, preuve insuffisante':out.errors.length?'Recherche incompl\u00e8te / API indisponible':'Aucun b\u00e2timent RNB trouv\u00e9';
      if(out.primaryRnbIds.size&&(out.issues.length||out.errors.length))out.rnbStatus+=' \u2014 \u00e0 v\u00e9rifier';
      out.eligibleAutomatic=!!out.primaryRnbIds.size&&!out.issues.length&&!out.errors.length;
    }
  }
  function compareRnb(a,b) {
    const strong=[...(a.primaryRnbIds||[])].filter(id=>b.primaryRnbIds?.has(id));
    const shared=[...(a.rnbIds||[])].filter(id=>b.rnbIds?.has(id)&&active(a.rnbBuildings?.get(id)||{})&&active(b.rnbBuildings?.get(id)||{}));
    const near=shared.filter(id=>!strong.includes(id));
    const providedConflict=a.suppliedRnb?.size&&b.suppliedRnb?.size&&![...a.suppliedRnb].some(id=>b.suppliedRnb.has(id));
    const selectedConflict=a.primaryRnbIds?.size&&b.primaryRnbIds?.size&&!strong.length;
    return {strong,near,minNearDistance:Math.min(Infinity,...near.map(id=>b.rnbClosest?.get(id)??a.rnbClosest?.get(id)??Infinity)),conflict:!!(providedConflict||selectedConflict)};
  }
  function classify(best,second) {
    const score=best?.score||0,ambiguous=!!second&&score>=50&&score-second.score<=6;
    const auto=!!best?.automaticEligible&&score>=85&&!ambiguous;
    const level=auto?'auto':score>=70?'probable':score>=50?'candidate':'unmatched';
    return {score,ambiguous,level,numeroSiap:auto?best.s.id:'',label:auto?'Association automatique':ambiguous?'Ambigu \u2014 plusieurs SIAP proches':level==='probable'?'Probable \u00e0 v\u00e9rifier':level==='candidate'?'Candidat \u00e0 contr\u00f4ler':'Faible / non associ\u00e9'};
  }
  return {BASE,norm,code,postal,section,number,prefix,fullId,makeId,rnbIds,parseInput,featureId,items,building,active,Engine,compareRnb,classify};
});
