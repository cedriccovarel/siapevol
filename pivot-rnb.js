/* SIAP / EVOLUTION: bilateral RNB comparison, V5.1.
 * Pure functions, no network, no data persistence. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./cadastre-rnb.js'));
  else root.PivotRNB=factory(root.CadastreRNB);
})(typeof globalThis!=='undefined'?globalThis:this,function(C){
  'use strict';
  const unique=values=>[...new Set(values)];
  const selected=row=>unique([...(row.primaryRnbIds||[])].filter(id=>C.active(row.rnbBuildings?.get(id)||{})));
  function compare(a,b){
    const info=C.compareRnb(a,b),baseIds=selected(a),siapIds=selected(b);
    const strong=baseIds.filter(id=>siapIds.includes(id));
    const baseOnly=baseIds.filter(id=>!strong.includes(id)),siapOnly=siapIds.filter(id=>!strong.includes(id));
    const relation=!strong.length?(info.conflict?'incompatible':'non_resolu'):baseOnly.length?'partiel':siapOnly.length?'batiment_dans_operation':'identique';
    return {...info,strong,baseIds,siapIds,baseOnly,siapOnly,relation,
      baseCoverage:baseIds.length?strong.length/baseIds.length:null,
      siapCoverage:siapIds.length?strong.length/siapIds.length:null,
      fullBaseCoverage:baseIds.length>0&&!baseOnly.length};
  }
  function buildIndex(rows){
    const index=new Map();
    for(const row of rows)for(const id of new Set([...(row.rnbIds||[]),...(row.primaryRnbIds||[])])){
      if(!C.active(row.rnbBuildings?.get(id)||{}))continue;
      if(!index.has(id))index.set(id,[]);
      index.get(id).push(row);
    }
    return index;
  }
  function classify(ranked){
    const best=ranked[0],second=ranked[1];
    const decision=C.classify(best,second);
    const linkedSiapIds=unique(ranked.filter(c=>c.rnbMatch?.strong.length&&!String(c.s.id).startsWith('SIAP_SANS_ID_')).map(c=>String(c.s.id)));
    const multiple=linkedSiapIds.length>1;
    const partial=!!best?.rnbMatch?.strong.length&&!best.rnbMatch.fullBaseCoverage;
    const reasons=[];
    if(multiple)reasons.push('Plusieurs num\u00e9ros SIAP partagent les RNB de cette ligne : '+linkedSiapIds.join(' ; '));
    if(partial)reasons.push('Correspondance partielle : tous les RNB retenus de la base ne sont pas couverts par ce SIAP.');
    if(multiple||partial){
      decision.ambiguous=true;decision.numeroSiap='';
      if(decision.level==='auto'){decision.level='probable';decision.score=Math.min(84,decision.score);}
      decision.label=multiple?'Plusieurs SIAP pour les RNB communs \u2014 validation requise':'RNB partiellement communs \u2014 validation requise';
    }
    return {...decision,linkedSiapIds,reasons};
  }
  function addresses(row,ids){
    const wanted=new Set(ids||[]);
    return unique((row?.locations||[]).filter(l=>!wanted.size||[...(l.rnbIds||[])].some(id=>wanted.has(id)))
      .map(l=>[l.input?.address,l.input?.postal,l.input?.city].filter(Boolean).join(' ')).filter(Boolean));
  }
  function sourceSummary(row,ids){
    const labels={provided:'ID-RNB fourni et v\u00e9rifi\u00e9',address:'Adresse pr\u00e9cise / BAN',plot:'Parcelle cadastrale',address_approx:'Adresse non confirm\u00e9e',plot_approx:'Parcelle d\u00e9duite / non confirm\u00e9e',near:'Proximit\u00e9 seule',manual:'Choix manuel'};
    return unique((ids||selected(row)).flatMap(id=>(row?.rnbEvidence?.get(id)||[]).map(e=>labels[e.source]||e.source))).join(' ; ');
  }
  function relationLabel(info){
    return ({identique:'M\u00eames RNB retenus',batiment_dans_operation:'B\u00e2timent(s) de la base inclus dans une op\u00e9ration SIAP plus large',partiel:'Une partie seulement des RNB de la base est commune',incompatible:'RNB retenus incompatibles',non_resolu:'Aucun RNB retenu commun'})[info?.relation]||'Non compar\u00e9';
  }
  return {compare,buildIndex,classify,addresses,sourceSummary,relationLabel};
});
