"""End-to-end UI controls, with simulated public APIs and spreadsheet libraries.
No real SIAP records or live production calls.
"""
import json, re, os, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
checks=[];errors=[]
def check(name,cond):
    if not cond: raise AssertionError(name)
    checks.append(name)
shim=r'''
window.Fuse=class {constructor(rows){this.rows=rows;}search(){return []}};
window.turf={featureCollection:features=>({features}),bbox:()=>[2,48,2.001,48.001],booleanIntersects:()=>false,polygonToLine:()=>null,centroid:()=>null,distance:()=>100,point:coords=>({geometry:{coordinates:coords}}),booleanPointInPolygon:()=>false,lineString:()=>({}),pointToLineDistance:()=>100};
window.XLSX={read:buffer=>JSON.parse(new TextDecoder().decode(buffer)),utils:{sheet_to_json:(s,opts)=>s.data,book_new:()=>({SheetNames:[],Sheets:{}}),json_to_sheet:data=>({data,'!ref':'A1:Z100'}),book_append_sheet:(w,s,n)=>{w.SheetNames.push(n);w.Sheets[n]=s;}},writeFile:(w,n)=>{window.__export={wb:w,name:n}}};
'''
mock=r'''
window.__calls=[];
window.fetch=async url=>{
  window.__calls.push(String(url));const u=new URL(url), A='AAAAAAAAAAAA', B='BBBBBBBBBBBB';let data;
  const b=id=>({rnb_id:id,is_active:true,status:'constructed',bdg_cover_ratio:1});
  if(u.host==='geo.api.gouv.fr'){const c={code:'45234',nom:'Olivet',codesPostaux:['45160']};data=u.pathname==='/communes'?[c]:c;}
  else if(u.host==='data.geopf.fr'){
    const n=(u.searchParams.get('q').match(/^\d+/)||['1'])[0];
    data={features:[{geometry:{type:'Point',coordinates:[2+Number(n)/10000,48]},properties:{citycode:'45234',postcode:'45160',city:'Olivet',housenumber:n,score:.96,type:'housenumber',id:'45234_1234_'+n.padStart(5,'0'),label:n+' rue du Test'}}]};
  }
  else if(u.host==='apicarto.ign.fr')data={features:u.searchParams.has('geom')?[]:[{type:'Feature',properties:{id:'45234000AB0012'},geometry:{type:'Polygon',coordinates:[[[2,48],[2.001,48],[2.001,48.001],[2,48.001],[2,48]]]}}]};
  else if(u.pathname.includes('/plot/'))data={results:[b(A)],next:null};
  else if(u.pathname.endsWith('/address/')){
    const n=Number((u.searchParams.get('cle_interop_ban')||'').split('_').at(-1))||1;
    const ids=window.__opts.multi?[A,B]:window.__opts.same?[A]:n===1?[A]:[B];
    data={results:ids.map(b),next:null,status:'ok',score_ban:.96};
  }
  else if(u.pathname.endsWith('/closest/'))data={results:[],next:null};
  else if(u.pathname.includes('/buildings/'))data=b(u.pathname.split('/').filter(Boolean).at(-1));
  else throw Error('Unexpected test URL '+url);
  return {ok:true,status:200,headers:{get:()=>null},json:async()=>data};
};
'''
EH=['Code interne','Ville','Code postal','Code cadastral','Num\u00e9ro de parcelle','ID-RNB','Adresse','SIREN',"Ma\u00eetre d'ouvrage: Nom de la soci\u00e9t\u00e9","Affaire: Nom de l'affaire",'Note libre']
SH=['NUMERO_SIAP','COMMUNE_NOM','CODE_POSTAL','ADRESSE_OPERATION','ID-RNB','SIREN','MAITRISE_OUVRAGE_NOM_OFFICIEL','NOM_OPERATION']
A='AAAAAAAAAAAA';B='BBBBBBBBBBBB'
def er(id='E1',section='',parcel='',rnb='',address=''):
    return [id,'Olivet','45160',section,parcel,rnb,address,'123456789','Bailleur Test','Les Cedres','Conserver exactement']
def sr(id='S1',address='1 rue du Test',rnb='',siren='123456789',owner='Bailleur Test',name='Les Cedres'):
    return [id,'Olivet','45160',address,rnb,siren,owner,name]
def upload(p,kind,heads,rows):
    wb={'SheetNames':['Donnees'],'Sheets':{'Donnees':{'data':[heads]+rows}}}
    p.set_input_files('#file'+kind,{'name':kind+'.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':json.dumps(wb).encode()})
def start(browser,evals,siap,opts=None):
    p=browser.new_page(viewport={'width':1500,'height':1050});p.on('pageerror',lambda e:errors.append(str(e)))
    html=re.sub(r'<script\b[^>]*>.*?</script>','',ROOT.joinpath('index.html').read_text(),flags=re.S)
    html=re.sub(r'<link[^>]+stylesheet[^>]*>','',html)
    p.set_content(html);p.add_style_tag(content=ROOT.joinpath('app.css').read_text());p.add_script_tag(content=shim)
    p.evaluate('(opts)=>window.__opts=opts',opts or {});p.add_script_tag(content=mock)
    for name in ['cadastre-rnb.js','pivot-rnb.js','app.js']:p.add_script_tag(content=ROOT.joinpath(name).read_text())
    p.evaluate('''()=>{const Base=CadastreRNB.Engine;CadastreRNB.Engine=class extends Base{constructor(){super({rate:0,retries:0})}}}''')
    upload(p,'Eval',EH,evals);upload(p,'Siap',SH,siap);p.locator('#useCompany').uncheck();p.locator('#runButton').click()
    p.wait_for_function("document.querySelector('#progressPercent').textContent==='100 %' && !document.querySelector('#exportButton').disabled",timeout=20000)
    p.locator('#exportButton').click();return p,p.evaluate('window.__export')
def main(exp):return exp['wb']['Sheets']['Rapprochement V5']['data'][0]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
    p,x=start(browser,[er(section='AB',parcel='12')],[sr()]);r=main(x)
    check('Cadastre base to precise SIAP address produces common RNB',r['RAPPROCHEMENT_RNB_COMMUNS']==A)
    check('Unique supported building association can be automatic',r['NUMERO_SIAP']=='S1' and r['RAPPROCHEMENT_NIVEAU']=='auto')
    check('Two source RNB columns are exported',r['RAPPROCHEMENT_RNB_BASE']==A and r['RAPPROCHEMENT_RNB_SIAP']==A)
    check('Original columns unchanged',r['Note libre']=='Conserver exactement')
    check('New comparison and SIAP-address sheets present',all(n in x['wb']['SheetNames'] for n in ['Comparaison RNB','Adresses SIAP RNB']))
    check('Geocode and RNB address endpoint called',p.evaluate("__calls.some(x=>x.includes('data.geopf.fr'))&&__calls.some(x=>x.includes('cle_interop_ban='))"))
    p.locator('[data-detail="0"]').click()
    check('Proof dialog shows both RNB sets','RNB base' in p.locator('#detailContent').inner_text() and 'RNB SIAP' in p.locator('#detailContent').inner_text())
    p.screenshot(path=str(ROOT/'tests/bilateral-details.png'));p.close()
    p,x=start(browser,[er(section='AB',parcel='12')],[sr(),sr(id='S2',siren='987654321',owner='Autre Bailleur',name='Autre Programme')]);r=main(x)
    check('Multiple SIAP numbers sharing a RNB block automatic selection',r['NUMERO_SIAP']=='' and r['RAPPROCHEMENT_AMBIGU']=='OUI')
    check('All overlapping SIAP numbers are exported',r['RAPPROCHEMENT_SIAP_LIES_RNB']=='S1 ; S2')
    p.close()
    p,x=start(browser,[er(rnb=B)],[sr(),sr(address='2 rue du Test')]);r=main(x)
    check('Same SIAP multiple addresses is one operation',p.locator('#statSiapUnique').inner_text()=='1')
    check('All distinct SIAP source addresses analyzed',len(x['wb']['Sheets']['Adresses SIAP RNB']['data'])==2)
    check('RNB from second SIAP address is retained',r['RAPPROCHEMENT_RNB_COMMUNS']==B and r['RAPPROCHEMENT_RNB_SIAP']=='AAAAAAAAAAAA ; BBBBBBBBBBBB')
    check('Matched source address, not representative first address, exported',r['RAPPROCHEMENT_SIAP_ADRESSES_LIEES_RNB'].startswith('2 rue'))
    check('Building subset of wider SIAP can be supported',r['NUMERO_SIAP']=='S1' and r['RAPPROCHEMENT_RNB_PART_SIAP_PCT']==50)
    p.close()
    p,x=start(browser,[er(rnb=A+' ; '+B)],[sr()]);r=main(x)
    check('Partial base RNB coverage remains unvalidated',r['NUMERO_SIAP']=='' and r['RAPPROCHEMENT_RNB_PART_BASE_PCT']==50)
    p.close()
    p,x=start(browser,[er(rnb=B)],[sr()],{'multi':True});r=main(x)
    check('Ambiguous SIAP address never becomes a retained RNB',r['RAPPROCHEMENT_RNB_SIAP']=='' and r['NUMERO_SIAP']=='')
    check('Ambiguous common building remains visible as candidate',B in x['wb']['Sheets']['Comparaison RNB']['data'][0]['RNB_CANDIDATS_COMMUNS'])
    p.close()
    p,x=start(browser,[er(address='1 rue du Test')],[sr(address='2 rue du Test')],{'same':True});r=main(x)
    check('Different entrances of same building can match through RNB',r['NUMERO_SIAP']=='S1' and r['RAPPROCHEMENT_RNB_COMMUNS']==A)
    p.close();browser.close()
check('No browser JavaScript errors',not errors)
print('\n'.join('PASS '+s for s in checks));print(f'{len(checks)} bilateral browser checks passed (simulated API and libraries).')
(ROOT/'tests/bilateral-browser-last-run.txt').write_text('\n'.join(checks)+'\n')
