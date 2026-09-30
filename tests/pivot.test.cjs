'use strict';
const assert=require('node:assert/strict'),C=require('../cadastre-rnb.js'),P=require('../pivot-rnb.js');
const tests=[],test=(n,f)=>tests.push([n,f]);
const A='AAAAAAAAAAAA',B='BBBBBBBBBBBB',D='DDDDDDDDDDDD';
const bdg=id=>({rnb_id:id,status:'constructed',is_active:true});
const row=(ids,all=ids)=>({primaryRnbIds:new Set(ids),rnbIds:new Set(all),rnbBuildings:new Map(all.map(id=>[id,bdg(id)])),suppliedRnb:new Set(),rnbEvidence:new Map(),rnbClosest:new Map()});
const ranked=(a,b,id='S1',score=95)=>({s:{...b,id},score,automaticEligible:true,rnbMatch:P.compare(a,b)});
const response=(v,status=200)=>({ok:status===200,status,headers:{get:()=>null},json:async()=>v});
function fixture(o={}){
  const calls=[];
  const fetch=async url=>{
    calls.push(url);const u=new URL(url);
    if(u.host==='geo.api.gouv.fr')return response([{nom:'Olivet',code:'45234',codesPostaux:['45160']}]);
    if(u.host==='data.geopf.fr'){
      if(o.failGeo)return response({},503);
      const feature=(num,score=.96)=>({geometry:{type:'Point',coordinates:[2,48]},properties:{citycode:'45234',postcode:'45160',housenumber:num,type:o.type||'housenumber',score,id:'45234_1234_'+num.padStart(5,'0'),label:num+' rue du Test'}});
      return response({features:o.noGeo?[]:[feature(o.number||'1'),...(o.ambiguousGeo?[feature('2',.95)]:[])]});
    }
    if(u.host==='apicarto.ign.fr')return response({features:o.plot?[{type:'Feature',properties:{id:'45234000AB0012'},geometry:{type:'Polygon',coordinates:[[[2,48],[2.01,48],[2.01,48.01],[2,48]]]}}]:[]});
    if(u.pathname.endsWith('/address/')){
      if(o.failAddress)return response({},503);
      return response({results:u.searchParams.has('page')?[bdg(B)]:(o.addressIds||[A]).map(bdg),status:o.status||'ok',score_ban:.96,next:o.evilPage?'https://evil.test/p2':o.paged&&!u.searchParams.has('page')?'?page=2':null});
    }
    if(u.pathname.includes('/plot/'))return response({results:[{...bdg(D),bdg_cover_ratio:1}],next:null});
    if(u.pathname.endsWith('/closest/'))return response({results:[{...bdg(D),distance:2}],next:null});
    return response(bdg(u.pathname.split('/').filter(Boolean).at(-1)));
  };
  return {e:new C.Engine({fetch,rate:0,sleep:async()=>{},retries:0}),calls};
}
const input={city:'Olivet',postal:'45160',address:'1 rue du Test'};
test('Equal retained RNB sets',()=>{const i=P.compare(row([A]),row([A]));assert.equal(i.relation,'identique');assert.equal(i.baseCoverage,1);assert.equal(i.siapCoverage,1)});
test('Base building is included in a larger SIAP operation',()=>{const i=P.compare(row([A]),row([A,B]));assert.equal(i.relation,'batiment_dans_operation');assert.equal(i.fullBaseCoverage,true);assert.equal(i.siapCoverage,.5)});
test('Partial base coverage never automatic',()=>{const d=P.classify([ranked(row([A,B]),row([A]))]);assert.equal(d.numeroSiap,'');assert.ok(d.ambiguous);assert.equal(d.level,'probable')});
test('Distinct SIAP on same RNB blocks automatic despite score gap',()=>{const d=P.classify([ranked(row([A]),row([A]),'S1',95),ranked(row([A]),row([A]),'S2',49)]);assert.equal(d.numeroSiap,'');assert.equal(d.linkedSiapIds.length,2)});
test('Same SIAP number is counted once',()=>{const d=P.classify([ranked(row([A]),row([A]),'S1',95),ranked(row([A]),row([A]),'S1',60)]);assert.equal(d.linkedSiapIds.length,1);assert.equal(d.numeroSiap,'S1')});
test('All ambiguous candidate RNBs are indexed',()=>{const s={...row([],[A,B]),id:'S1'};assert.equal(P.buildIndex([s]).get(B)[0].id,'S1')});
test('Candidates on both sides are not retained matches',()=>{const i=P.compare(row([],[A]),row([],[A]));assert.equal(i.strong.length,0);assert.deepEqual(i.near,[A])});
test('Different retained IDs conflict',()=>assert.ok(P.compare(row([A]),row([B])).conflict));
test('Inactive IDs are not indexed',()=>{const s=row([],[A]);s.rnbBuildings.set(A,{...bdg(A),is_active:false});assert.equal(P.buildIndex([s]).size,0)});
test('All matching source addresses retained, duplicates removed',()=>{const s=row([A,B]);s.locations=[{input:{address:'1 rue A'},rnbIds:new Set([A])},{input:{address:'2 rue B'},rnbIds:new Set([B])},{input:{address:'2 rue B'},rnbIds:new Set([B])}];assert.deepEqual(P.addresses(s,[B]),['2 rue B'])});
test('Address alone gives unique precise RNB',async()=>{const {e,calls}=fixture();const r=await e.enrich(input);assert.deepEqual([...r.primaryRnbIds],[A]);assert.ok(r.eligibleAutomatic);assert.ok(calls.some(u=>u.includes('cle_interop_ban=')))});
test('Address with multiple buildings remains ambiguous',async()=>{const {e}=fixture({addressIds:[A,B]});const r=await e.enrich(input);assert.equal(r.primaryRnbIds.size,0);assert.equal(r.rnbIds.size,2)});
test('Address result pagination retains all candidates',async()=>{const {e}=fixture({paged:true});const r=await e.enrich(input);assert.equal(r.rnbIds.size,2);assert.equal(r.primaryRnbIds.size,0)});
test('Nearby building cannot replace a missing address match',async()=>{const {e}=fixture({addressIds:[]});const r=await e.enrich(input);assert.ok(r.rnbIds.has(D));assert.equal(r.primaryRnbIds.size,0)});
test('Different house number is never precise',async()=>{const {e}=fixture({number:'2'});const r=await e.enrich(input);assert.equal(r.geo.precise,false);assert.equal(r.primaryRnbIds.size,0);assert.ok(r.issues.length)});
test('Two equally plausible geocoded addresses are flagged',async()=>{const {e}=fixture({ambiguousGeo:true});const r=await e.enrich(input);assert.equal(r.geo.precise,false);assert.equal(r.primaryRnbIds.size,0)});
test('Street-only geocode is not a building proof',async()=>{const {e}=fixture({type:'street'});const r=await e.enrich(input);assert.equal(r.primaryRnbIds.size,0)});
test('Geocoding failure still runs candidate-only textual RNB search',async()=>{const {e,calls}=fixture({failGeo:true});const r=await e.enrich(input);assert.ok(r.errors.length);assert.ok(calls.some(u=>u.includes('/address/?')&&u.includes('q=')));assert.ok(r.rnbIds.has(A));assert.equal(r.primaryRnbIds.size,0)});
test('API address status is exported as warning, not accepted as evidence',async()=>{const {e}=fixture({status:'geocoding_score_is_too_low'});const r=await e.enrich(input);assert.equal(r.primaryRnbIds.size,0);assert.ok(r.issues.some(v=>v.includes('geocoding_score_is_too_low')))});
test('Conflicting plot and precise address prevent automatic selection',async()=>{const {e}=fixture({plot:true});const r=await e.enrich({...input,section:'AB',parcels:'12'});assert.equal(r.primaryRnbIds.size,0);assert.ok(r.issues.some(v=>v.includes('incompatibles')))});
test('Foreign pagination URL never fetched',async()=>{const {e,calls}=fixture({evilPage:true});const r=await e.enrich(input);assert.ok(r.errors.length);assert.equal(r.eligibleAutomatic,false);assert.ok(!calls.some(v=>v.includes('evil.test')))});
test('Address API failure distinct from empty results',async()=>{const {e}=fixture({failAddress:true});const r=await e.enrich(input);assert.ok(r.errors.length);assert.equal(r.eligibleAutomatic,false)});
(async()=>{let failed=0;for(const [name,fn] of tests){try{await fn();console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack)}}console.log(`${tests.length-failed}/${tests.length} bilateral RNB tests passed`);process.exitCode=failed?1:0})();
