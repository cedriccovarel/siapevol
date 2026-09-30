import json, re, sys, os, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
# API and library test doubles: no production services called by these tests.
shim=r'''
window.Fuse=class {constructor(rows){this.rows=rows;}search(){return []}};
window.turf={featureCollection:features=>({features}),bbox:()=>[2,48,2.001,48.001],booleanIntersects:()=>false,polygonToLine:()=>null,centroid:()=>null,distance:()=>100,point:coords=>({geometry:{coordinates:coords}}),booleanPointInPolygon:()=>false,lineString:()=>({}),pointToLineDistance:()=>100};
window.XLSX={read:buffer=>JSON.parse(new TextDecoder().decode(buffer)),utils:{sheet_to_json:(s,opts)=>s.data,book_new:()=>({SheetNames:[],Sheets:{}}),json_to_sheet:data=>({data,'!ref':'A1:Z100'}),book_append_sheet:(w,s,n)=>{w.SheetNames.push(n);w.Sheets[n]=s;}},writeFile:(w,n)=>{window.__export={wb:w,name:n}}};
'''
errors=[];checks=[]
def check(name,condition):
    if not condition: raise AssertionError(name)
    checks.append(name)

def route_handler(route):
    url=route.request.url
    if url.startswith('https://app.test/'):
        target=ROOT/url.split('https://app.test/',1)[1].split('?',1)[0]
        import mimetypes
        route.fulfill(status=200,content_type=mimetypes.guess_type(str(target))[0] or 'text/plain',body=target.read_bytes());return
    if url.startswith('https://cdn.'):
        route.fulfill(status=200,content_type='text/javascript',body='');return
    if 'geo.api.gouv.fr' in url:
        data={'code':'45234','nom':'Olivet','codesPostaux':['45160']}
        if '/communes?' in url:data=[data]
    elif 'apicarto.ign.fr' in url:
        data={'features':[{'type':'Feature','properties':{'id':'45234000AB0012'},'geometry':{'type':'Polygon','coordinates':[[[2,48],[2.001,48],[2.001,48.001],[2,48.001],[2,48]]]}}]}
    elif 'rnb-api.beta.gouv.fr' in url:
        b={'rnb_id':'AAAAAAAAAAAA','bdg_cover_ratio':1,'is_active':True,'status':'constructed'}
        data={'results':[b],'next':None} if '/plot/' in url else b
    else:
        route.continue_();return
    route.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers={'Access-Control-Allow-Origin':'*'})

def workbook(headers,rows,front=True):
    sheets={'Operations':{'data':[['Titre libre'],headers]+rows}}
    if front:sheets={'Guide':{'data':[['Information'],['Lire la notice']]},**sheets}
    return {'SheetNames':list(sheets),'Sheets':sheets}

def upload(page,kind,wb):
    page.set_input_files('#file'+kind,{'name':kind+'.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':json.dumps(wb).encode()})

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1600,'height':1100})
    page.add_init_script(shim)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',route_handler)
    html=re.sub(r'<script\b[^>]*>.*?</script>','',ROOT.joinpath('index.html').read_text(),flags=re.S)
    html=re.sub(r'<link[^>]+stylesheet[^>]*>','',html)
    page.set_content(html)
    page.add_style_tag(content=ROOT.joinpath('app.css').read_text())
    page.add_script_tag(content=shim)
    page.add_script_tag(content=r'''window.fetch=async url=>{
      const u=new URL(url);let data;
      if(u.host==='geo.api.gouv.fr'){const c={code:'45234',nom:'Olivet',codesPostaux:['45160']};data=u.pathname==='/communes'?[c]:c;}
      else if(u.host==='apicarto.ign.fr')data={features:[{type:'Feature',properties:{id:'45234000AB0012'},geometry:{type:'Polygon',coordinates:[[[2,48],[2.001,48],[2.001,48.001],[2,48.001],[2,48]]]}}]};
      else if(u.host==='rnb-api.beta.gouv.fr'){const b={rnb_id:'AAAAAAAAAAAA',bdg_cover_ratio:1,is_active:true,status:'constructed'};data=u.pathname.includes('/plot/')?{results:[b],next:null}:b;}
      else throw Error('Unexpected mock URL: '+url);
      return {ok:true,status:200,headers:{get:()=>null},json:async()=>data};
    };''')
    page.add_script_tag(content=ROOT.joinpath('cadastre-rnb.js').read_text())
    page.add_script_tag(content=ROOT.joinpath('pivot-rnb.js').read_text())
    page.add_script_tag(content=ROOT.joinpath('app.js').read_text())
    check('Initial run disabled',page.locator('#runButton').is_disabled())
    evalheads=['Code interne','Ville','Code postal','Code cadastral','Num\u00e9ro de parcelle','Nom de l\u2019op\u00e9ration','SIREN','Ma\u00eetre d\u2019ouvrage: Nom de la soci\u00e9t\u00e9','Total logements','NUMERO_SIAP','Note personnelle']
    # Decode escaped labels written as ASCII source.
    evalheads=[x.encode().decode('unicode_escape') if '\\u' in x else x for x in evalheads]
    evalwb=workbook(evalheads,[['EV001','Olivet','45160','AB','12','Les Cedres','123456789','Bailleur Test',10,'OLD-VALUE','A conserver'],['EV002','Olivet','45160','AB','12p','Les Cedres','123456789','Bailleur Test',10,'','Partielle']])
    upload(page,'Eval',evalwb)
    check('Header and sheet autodetection',page.locator('#evalFileRows').inner_text().endswith('en-t\u00eates ligne 2'))
    check('RNB-only mode enabled',not page.locator('#runButton').is_disabled() and 'sans SIAP' in page.locator('#runButton').inner_text())
    page.locator('#useCompany').uncheck()
    page.locator('#runButton').click()
    page.wait_for_function("document.querySelector('#progressPercent').textContent==='100 %' && !document.querySelector('#exportButton').disabled",timeout=15000)
    check('RNB-only diagnostic present',page.locator('#diagnosticBody').inner_text().count('AAAAAAAAAAAA')==1)
    page.locator('#exportButton').click()
    exp=page.evaluate('window.__export')
    check('Original NUMERO_SIAP not overwritten',exp['wb']['Sheets']['Rapprochement V5']['data'][0]['NUMERO_SIAP']=='OLD-VALUE')
    check('New NUMERO_SIAP suffix preserved',exp['wb']['Sheets']['Rapprochement V5']['data'][0]['NUMERO_SIAP_V5']=='')
    check('Original arbitrary column retained',exp['wb']['Sheets']['Rapprochement V5']['data'][0]['Note personnelle']=='A conserver')
    siaph=['NUMERO_SIAP','COMMUNE_NOM','CODE_POSTAL','Section','Parcelle','NOM_OPERATION','SIREN','MAITRISE_OUVRAGE_NOM_OFFICIEL','TOTAL_LOGEMENTS']
    siapwb=workbook(siaph,[['S1','Olivet','45160','AB','12','Les Cedres','123456789','Bailleur Test',10],['S1','Olivet','45160','AB','12','Les Cedres','123456789','Bailleur Test',10],['S2','Olivet','45160','AB','12','Les Cedres','123456789','Bailleur Test',10]])
    upload(page,'Siap',siapwb)
    page.locator('#useCompany').uncheck()
    page.locator('#runButton').click()
    page.wait_for_function("document.querySelector('#progressPercent').textContent==='100 %' && !document.querySelector('#exportButton').disabled",timeout=15000)
    check('SIAP consolidation retained',page.locator('#statSiapUnique').inner_text()=='2')
    check('Tied matches never automatic',page.locator('#statAuto').inner_text()=='0')
    page.locator('#exportButton').click();exp=page.evaluate('window.__export')
    rows=exp['wb']['Sheets']['Rapprochement V5']['data']
    check('Ambiguous SIAP remains unvalidated',rows[0]['NUMERO_SIAP_V5']=='' and rows[0]['RAPPROCHEMENT_AMBIGU']=='OUI')
    check('Candidate export contains both SIAP',len(exp['wb']['Sheets']['Candidats SIAP']['data'])>=2)
    check('Audit sheets present',all(n in exp['wb']['SheetNames'] for n in ['Journal API','Details RNB','Correspondance colonnes','SIAP sources']))
    page.locator('[data-detail="0"]').click();check('Details dialog opens',page.locator('#detailDialog').is_visible())
    page.locator('[data-choose-siap="S2"]').click()
    page.locator('#exportButton').click();exp=page.evaluate('window.__export');row=exp['wb']['Sheets']['Rapprochement V5']['data'][0]
    check('Manual SIAP selection reflected in export',row['NUMERO_SIAP_V5']=='S2' and row['RAPPROCHEMENT_NIVEAU']=='manual')
    check('Manual validation dated',bool(row['RAPPROCHEMENT_VALIDATION_MANUELLE']))
    page.locator('[data-detail="1"]').click();page.locator('[data-rnb-choice="AAAAAAAAAAAA"]').check();page.locator('#saveRnbChoice').click()
    check('Manual RNB selection retained after recomputing',page.locator('[data-rnb-choice="AAAAAAAAAAAA"]').is_checked())
    page.locator('#closeDetail').click()
    page.locator('#statusFilter').select_option('manual')
    check('Manual filter works',page.locator('#resultsBody tr').count()==1)
    page.locator('#resetFilters').click()
    page.evaluate('window.scrollTo(0,500)');before=page.evaluate('window.scrollY')
    page.locator('#searchInput').fill('Cedres');after=page.evaluate('window.scrollY')
    # Playwright may scroll to bring an input into view; compare re-render with direct dispatch.
    page.evaluate('window.scrollTo(0,600)');before=page.evaluate('window.scrollY')
    page.evaluate("document.querySelector('#searchInput').dispatchEvent(new Event('input'))")
    check('Render preserves scroll',abs(page.evaluate('window.scrollY')-before)<=1)
    page.evaluate("document.querySelectorAll('#importSection details').forEach(e=>e.open=false);window.scrollTo(0,0)")
    page.screenshot(path=str(ROOT/'tests'/'browser-last-run.png'),full_page=True)
    check('No browser JavaScript errors',not errors)
    browser.close()
print('\n'.join('PASS '+x for x in checks));print(f'\n{len(checks)} browser checks passed (mock API / mock third-party libraries).')
(ROOT/'tests'/'browser-last-run.txt').write_text('\n'.join(checks)+'\n'+str(errors))
