
(() => {
  "use strict";

  const C = window.CadastreRNB;
  const P = window.PivotRNB;
  let engine = null, running = false;
  const workbooks = { SIAP:null, EVAL:null };
  const fileMeta = { SIAP:{}, EVAL:{} };
  const manualSiap = new Map();
  const FIELD_LABELS = { id:'Identifiant', city:'Ville / Commune', postal:'Code postal', insee:'Code INSEE', section:'Section cadastrale', parcels:'Numéro(s) de parcelle', prefix:'Préfixe cadastral', full:'Référence complète (14 caractères)', cadastral:'Code cadastral (détection par valeur)', rnb:'ID-RNB fourni', owner:'Maître d’ouvrage', operation:'Nom de l’opération', address:'Adresse', siren:'SIREN', totalLogements:'Total logements', totalBatiments:'Total bâtiments', surface:'Surface', referential:'Référentiel', regulation:'Réglementation', date:'Date', type:'Type' };
  const AUTO_THRESHOLD = 85;
  const PROBABLE_THRESHOLD = 70;
  const CANDIDATE_THRESHOLD = 50;
  const MAX_RANGE_EXPANSION = 250;
  const GEO_CONCURRENCY = 8;
  const PARCEL_CONCURRENCY = 8;
  const RNB_CONCURRENCY = 6;
  const RNB_MIN_ADDRESS_SCORE = 0.55;
  const RNB_CLOSEST_RADIUS_M = 100;
  const COMPANY_MIN_CANDIDATE_CONFIDENCE = 62;
  const COMPANY_STRONG_CONFIDENCE = 84;
  const ADDRESS_PARCEL_RADIUS_M = 50;
  const MAX_GEO_CANDIDATE_RADIUS_M = 500;

  const API = {
    geocode: "https://data.geopf.fr/geocodage/search",
    postalCommunes: "https://apicarto.ign.fr/api/codes-postaux/communes/",
    parcel: "https://apicarto.ign.fr/api/cadastre/parcelle",
    rnb: "https://rnb-api.beta.gouv.fr/api/alpha/buildings",
    companySearch: "https://recherche-entreprises.api.gouv.fr/search"
  };

  const EXPECTED = {
    SIAP: {
      id: ["NUMERO_SIAP", "Numero SIAP", "Numéro SIAP"],
      postal: ["COMMUNE_CODE_POSTAL", "CODE_POSTAL", "Code postal"],
      owner: ["MAITRISE_OUVRAGE_NOM_OFFICIEL", "Maîtrise d'ouvrage", "Maitre d'ouvrage"],
      operation: ["NOM_OPERATION", "Nom de l'opération", "Nom opération"],
      address: ["ADRESSE_COMPLETE_OPERATION", "ADRESSE_COMPLETE", "Adresse complète de l'opération", "Adresse complète", "ADRESSE_OPERATION", "Adresse de l'opération", "Adresse opération", "Adresse"],
      siren: ["SIREN", "CODE_SIREN", "Code SIREN", "SIREN_MOA", "SIREN MOA", "MAITRISE_OUVRAGE_SIREN", "SIREN_MAITRISE_OUVRAGE", "Maîtrise d'ouvrage: SIREN", "Maitre d'ouvrage: SIREN"],
      totalLogements: ["TOTAL_LOGEMENTS", "Total logements", "Nombre de logements", "Nb logements"],
      totalBatiments: ["TOTAL_BATIMENTS", "Total bâtiments", "Nombre de bâtiments", "Nb bâtiments"],
      surface: ["SURFACE", "Surface de référence", "SHAB", "SDP"],
      referential: ["REFERENTIEL", "Référentiel", "Référentiel: Nom du référentiel"],
      regulation: ["REGLEMENTATION", "Réglementation"],
      date: ["DATE_OPERATION", "Date de création", "Date"],
      type: ["TYPE_OPERATION", "Type d'opération", "Ouvrage", "Nature des travaux"]
    },
    EVAL: {
      id: ["Évaluation: Opération: Code interne", "Code interne"],
      postal: ["Évaluation: Opération: Code postal", "Code postal"],
      owner: ["Évaluation: Opération: Maître d'ouvrage: Nom de la société", "Maître d'ouvrage: Nom de la société"],
      operation: ["Évaluation: Opération: Affaire: Nom de l'affaire", "Affaire: Nom de l'affaire", "Nom de l'opération (interne)", "Nom du programme (client)"],
      address: ["Évaluation: Opération: Adresse", "Adresse de l'opération", "Adresse opération", "Adresse"],
      siren: ["Évaluation: Opération: Maître d'ouvrage: SIREN", "Maître d'ouvrage: SIREN", "SIREN", "Code SIREN"],
      section: [
        "Évaluation: Opération: N° de section de(s) parcelle(s) et",
        "Évaluation: Opération: N° de section de(s) parcelle(s)",
        "N° de section de(s) parcelle(s)"
      ],
      parcels: ["Évaluation: Opération: N° de(s) parcelle(s)", "N° de(s) parcelle(s)"],
      totalLogements: ["Total logements", "Évaluation: Opération: Total logements"],
      totalBatiments: ["Total bâtiments", "Évaluation: Opération: Total bâtiments"],
      surface: ["Surface de référence / SHAB retenue", "Surface de référence", "SHAB", "SDP"],
      referential: ["Référentiel: Nom du référentiel", "Évaluation: Opération: Référentiel: Nom du référentiel", "Référentiel"],
      regulation: ["Réglementation", "Évaluation: Opération: Réglementation"],
      date: ["Évaluation: Date de création", "Affaire: Accepté le", "Contrat: Date d'activation", "Date de création"],
      type: ["Ouvrage", "Nature des travaux", "Type d'opération"]
    }
  };

  for (const t of ['SIAP','EVAL']) {
    Object.assign(EXPECTED[t], {
      city:['Ville','Commune','COMMUNE_NOM','COMMUNE_LIBELLE','Nom de la commune','Évaluation: Opération: Ville','Évaluation: Opération: Commune'],
      insee:['Code INSEE','CODE_INSEE','COMMUNE_CODE_INSEE','Code commune INSEE','INSEE'],
      prefix:['Préfixe cadastral','Prefixe','COM_ABS','Commune absorbée'],
      full:['Référence cadastrale complète','Identifiant parcelle','ID_PARCELLE','IDU','Identifiant cadastral','Référence cadastrale'],
      cadastral:['Code cadastral','Code cadastrale'],
      rnb:['ID-RNB','ID_RNB','RNB_ID','RNB','Identifiant RNB','Numéro RNB','ID RNB','Identifiants RNB','RNB_RETENUS','ID_RNB_retenus','RAPPROCHEMENT_RNB_RETENUS']
    });
    EXPECTED[t].section=[...(EXPECTED[t].section||[]),'Section cadastrale','Section','Code section'];
    EXPECTED[t].parcels=[...(EXPECTED[t].parcels||[]),'Numéro de parcelle','Numéro de(s) parcelle(s)','Numero parcelle','Parcelles','Parcelle'];
    EXPECTED[t].postal.push('Code postale','CP');
  }

  const CORE_FIELDS = {
    SIAP: ["id"],
    EVAL: []
  };

  let rawSiapRows = [];
  let rawEvalRows = [];
  let siapRows = [];
  let evalRows = [];
  let results = [];
  let columns = { SIAP: {}, EVAL: {} };
  let missingColumns = { SIAP: [], EVAL: [] };
  let warningMessages = [];
  let siapConsolidationStats = { raw: 0, unique: 0, grouped: 0, missingId: 0 };
  let sortState = { key: "score", dir: "desc" };

  const geocodeCache = new Map();
  const postalCache = new Map();
  const parcelCache = new Map();
  const siapParcelPointCache = new Map();
  const rnbAddressCache = new Map();
  const rnbClosestCache = new Map();
  const rnbPlotCache = new Map();
  const rnbDetailCache = new Map();
  const companySearchCache = new Map();
  let companyNextSlot = 0;
  let companyErrorCount = 0;
  let rnbNextSlot = 0;
  let rnbErrorCount = 0;

  const els = Object.fromEntries([
    "dropSiap","dropEval","fileSiap","fileEval","siapFileInfo","evalFileInfo","siapFileName","evalFileName","siapFileRows","evalFileRows",
    "runButton","exportButton","progressBar","progressText","progressPercent","errorBox","warningBox","statsSection","statSiapRaw","statSiapUnique","statSiapGrouped","statTotal","statAuto","statProbable","statCandidate","statRnb","statParcel","statSirenMatch","statAverage","resultsBody","tableFooter","searchInput","statusFilter","evidenceFilter","distanceFilter","sirenFilter","minScoreFilter","methodFilter","resetFilters"
  ].map(id => [id, document.getElementById(id)]));

  function normalizeHeader(v) {
    return String(v ?? "").replace(/^\uFEFF/, "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/['’`´]/g, " ").replace(/&/g, " et ")
      .replace(/\b(sas|sasu|sarl|eurl|sa|sci|scic|sem|spl|snc|groupe|societe|societe anonyme|habitat)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function headerKey(v) { return normalizeText(normalizeHeader(v)).replace(/\s+/g, " "); }

  function normalizeOperationText(value) {
    return normalizeText(value)
      .replace(/\b(construction|rehabilitation|renovation|residence|programme|operation|logements?|logts?|immeuble|batiments?|lotissement|projet|phase|tranche)\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function parseAddressParts(value) {
    const raw = String(value ?? "");
    const n = normalizeText(raw);
    const numberMatch = n.match(/\b(\d{1,4})\s*(bis|ter|quater|b|t)?\b/);
    const houseNumber = numberMatch ? numberMatch[1] : "";
    const suffix = numberMatch?.[2] || "";
    let street = n
      .replace(/\b\d{5}\b/g, " ")
      .replace(/\b\d{1,4}\s*(bis|ter|quater|b|t)?\b/, " ")
      .replace(/\b(rue|avenue|av|boulevard|bd|route|chemin|impasse|allee|place|quai|cours|passage|square|residence|lotissement|lieu dit|ld)\b/g, " ")
      .replace(/\s+/g, " ").trim();
    return { houseNumber, suffix, street, normalized: n };
  }

  function numericTokens(value) {
    return [...new Set((String(value ?? "").match(/\b\d{1,4}\b/g) || []).filter(x => Number(x) > 0))];
  }

  function modeRepresentative(values, normalizer = normalizeText) {
    const filtered = values.filter(v => String(v ?? "").trim() !== "");
    if (!filtered.length) return "";
    const groups = new Map();
    for (const v of filtered) {
      const key = normalizer(v) || String(v).trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    return [...groups.values()].sort((a,b) => b.length - a.length || String(b[0]).length - String(a[0]).length)[0]
      .sort((a,b) => String(b).length - String(a).length)[0];
  }

  function smartNumericAggregate(values, kind) {
    const nums = values.map(parseNumberValue).filter(Number.isFinite);
    if (!nums.length) return null;
    const rounded = nums.map(n => Math.round(n * 1000) / 1000);
    const counts = new Map();
    for (const n of rounded) counts.set(n, (counts.get(n) || 0) + 1);
    const best = [...counts.entries()].sort((a,b) => b[1] - a[1] || b[0] - a[0])[0];
    if (best && best[1] >= 2) return best[0];
    // Pour des champs intitulés "total", la valeur maximale est plus sûre que la somme
    // lorsque plusieurs lignes décrivent des typologies d'une même opération.
    return Math.max(...nums);
  }

  function uniqueJoined(values, max = 6) {
    const out = [];
    const seen = new Set();
    for (const v of values) {
      const s = String(v ?? "").trim();
      const k = normalizeText(s);
      if (!s || !k || seen.has(k)) continue;
      seen.add(k); out.push(s);
      if (out.length >= max) break;
    }
    return out.join(" ; ");
  }

  function normalizePostalCode(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value)).padStart(5, "0").slice(-5);
    let text = String(value).trim().replace(/\u00A0/g, " ");
    if (/^\d{4,5}[.,]0+$/.test(text)) text = text.split(/[.,]/)[0];
    const match = text.match(/(?:^|\D)(\d{5})(?:\D|$)/);
    if (match) return match[1];
    const digits = text.replace(/\D/g, "");
    return digits ? digits.slice(0, 5).padStart(5, "0") : "";
  }

  function semanticHeaderMatch(key, field) {
    if (field === 'city') return /(?:^| )(?:ville|commune)(?:$| )/.test(key) && !/code|maitre|ouvrage|absorbee/.test(key);
    if (field === 'insee') return key.includes('insee');
    if (field === 'rnb') return key.includes('rnb') && !/candidat|statut|score|alerte|methode|nombre|commun|source|diagnostic|couverture/.test(key);
    if (['prefix','full','cadastral'].includes(field)) return false;

    if (field === "section") return key.includes("section") && key.includes("parcelle");
    if (field === "parcels") return key.includes("parcelle") && !key.includes("section") && (key.includes("numero") || key.includes("n de") || key.includes("n parcelle"));
    if (field === "totalLogements") return (key.includes("total") || key.includes("nombre") || key.includes("nb")) && key.includes("logement");
    if (field === "totalBatiments") return (key.includes("total") || key.includes("nombre") || key.includes("nb")) && key.includes("batiment");
    if (field === "surface") return key.includes("surface") || key === "shab" || key.includes("surface shab") || key === "sdp";
    if (field === "referential") return key.includes("referentiel");
    if (field === "regulation") return key.includes("reglementation");
    if (field === "type") return key.includes("ouvrage") || key.includes("nature des travaux") || key.includes("type operation");
    if (field === "address") return key.includes("adresse") && !key.includes("mail");
    if (field === "postal") return key.includes("code postal");
    if (field === "owner") return key.includes("maitre") && key.includes("ouvrage") && (key.includes("nom") || key.includes("societe"));
    if (field === "siren") return key.includes("siren") && !key.includes("siret");
    if (field === "operation") return key.includes("nom") && (key.includes("operation") || key.includes("affaire") || key.includes("programme"));
    if (field === "id") return key.includes("code interne") || key.includes("numero siap");
    if (field === "date") return key.includes("date") && (key.includes("creation") || key.includes("accepte") || key.includes("activation") || key.includes("decision"));
    return false;
  }

  function resolveColumn(headers, aliases, field) {
    const normalized = headers.map(h => ({ original: h, key: headerKey(h) }));
    for (const alias of aliases) {
      const exact = normalized.find(x => x.key === headerKey(alias));
      if (exact) return exact.original;
    }
    const semantic = normalized.find(x => semanticHeaderMatch(x.key, field));
    return semantic ? semantic.original : null;
  }

  function mapColumns(rows, type) {
    if (!rows.length) throw new Error(`Le fichier ${type} ne contient aucune ligne exploitable.`);
    const headers = Object.keys(rows[0]);
    const mapped = {};
    for (const [field, aliases] of Object.entries(EXPECTED[type])) mapped[field] = resolveColumn(headers, aliases, field);
    if(type === "SIAP" && mapped.id && !headerKey(mapped.id).includes("siap"))mapped.id=null;
    missingColumns[type] = CORE_FIELDS[type].filter(field => !mapped[field]);
    return mapped;
  }

  function valueAt(row, column) { return column ? (row[column] ?? "") : ""; }

  function normalizeSiren(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (digits.length === 9) return digits;
    if (digits.length === 14) return digits.slice(0, 9);
    const m = String(value ?? "").match(/(?:^|\D)(\d{9})(?:\D|$)/);
    return m ? m[1] : "";
  }

  function canonicalizeObjectKeys(row) {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[normalizeHeader(k)] = v;
    return out;
  }

  function parseNumberValue(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    let s = String(v).trim().replace(/\u00A0/g, " ");
    const match = s.replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return null;
    const n = Number(match[0].replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function parseDateValue(v) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v > 20000 && v < 80000) return Math.round((v - 25569) * 86400 * 1000);
      if (v > 100000000000) return v;
    }
    const s = String(v).trim();
    const fr = s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
    if (fr) {
      let y = Number(fr[3]); if (y < 100) y += y >= 70 ? 1900 : 2000;
      const d = new Date(y, Number(fr[2]) - 1, Number(fr[1]));
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }

  function normalizeSectionToken(token) {
    const t = String(token || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!t || ["ET","DE","LA","LE","LES","P"].includes(t)) return "";
    if (t.length === 1) return `0${t}`;
    return t.slice(0, 2);
  }

  function parseSections(raw) {
    let text = String(raw ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, " ");
    text = text.replace(/\b(SECTIONS?|PARCELLES?|CADASTR(?:E|AL|ALE|ALES)?|NUMERO|NO|N°|DE|DES|DU|LA|LE|LES|ET)\b/g, " ");
    const tokens = text.split(/[^A-Z0-9]+/).map(x => x.trim()).filter(Boolean);
    const out = [];
    for (const token of tokens) {
      if (token.length > 2) continue;
      const sec = normalizeSectionToken(token);
      if (sec && !out.includes(sec)) out.push(sec);
    }
    return out;
  }

  function parcel4(n) {
    const digits = String(n ?? "").replace(/\D/g, "");
    if (!digits) return "";
    return digits.padStart(4, "0").slice(-4);
  }

  function parseParcels(raw) {
    let text = String(raw ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    text = text.replace(/[–—]/g, "-").replace(/\b(a|au)\b/g, "-").replace(/\b(et)\b/g, ",");
    const parts = text.split(/[;,/\n]+/).map(s => s.trim()).filter(Boolean);
    const found = [];
    const seen = new Set();

    function add(num, partial, source) {
      const n = parcel4(num);
      if (!n) return;
      const key = `${n}|${partial ? 1 : 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ number: n, partial: !!partial, source });
      }
    }

    for (const part of parts) {
      const range = part.match(/(?:n\s*[°o]?\s*)?(\d{1,4})\s*-\s*(\d{1,4})/i);
      if (range) {
        const a = Number(range[1]), b = Number(range[2]);
        if (Number.isFinite(a) && Number.isFinite(b) && b >= a && (b - a + 1) <= MAX_RANGE_EXPANSION) {
          for (let n = a; n <= b; n++) add(n, /\bp\b|\d+p\b/.test(part), part);
          continue;
        }
      }
      const matches = [...part.matchAll(/(\d{1,4})\s*(p)?\b/gi)];
      for (const m of matches) add(m[1], !!m[2], part);
    }
    return found;
  }

  function formatCadastre(sections, parcels) {
    if (!sections.length && !parcels.length) return "";
    const p = parcels.map(x => `${Number(x.number)}${x.partial ? "p" : ""}`).join(", ");
    return `${sections.join(" / ")}${p ? " • " + p : ""}`;
  }

  function buildPreparedRows() {
    const groups = new Map();
    let missingId = 0;
    rawSiapRows.forEach((row, index) => {
      const rawId = String(valueAt(row, columns.SIAP.id) ?? "").trim();
      const key = rawId ? `ID:${rawId}` : `ROW:${index}`;
      if (!rawId) missingId++;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ row, index });
    });

    siapRows = [...groups.values()].map((entries, consolidatedIndex) => {
      const rows = entries.map(x => x.row);
      const first = rows[0];
      const id = modeRepresentative(rows.map(r => valueAt(r, columns.SIAP.id)), v => String(v).trim()) || `SIAP_SANS_ID_${entries[0].index + 1}`;
      const postal = normalizePostalCode(modeRepresentative(rows.map(r => valueAt(r, columns.SIAP.postal)), normalizePostalCode));
      const owner = modeRepresentative(rows.map(r => valueAt(r, columns.SIAP.owner)));
      const operation = modeRepresentative(rows.map(r => valueAt(r, columns.SIAP.operation)));
      const address = modeRepresentative(rows.map(r => valueAt(r, columns.SIAP.address)));
      const siren = normalizeSiren(modeRepresentative(rows.map(r => valueAt(r, columns.SIAP.siren)), normalizeSiren));
      const addressParts = parseAddressParts(address);
      return {
        index: consolidatedIndex, original: first, sourceRowsOriginal: rows, sourceRowIndexes: entries.map(x => x.index), sourceRowCount: rows.length,
        id, postal, owner, operation, address, siren,
        ownerN: normalizeText(owner), operationN: normalizeOperationText(operation), addressN: normalizeText(address), combinedN: normalizeText(`${owner} ${operation}`),
        addressParts, operationNumbers: numericTokens(operation),
        totalLogements: smartNumericAggregate(rows.map(r => valueAt(r, columns.SIAP.totalLogements)), "logements"),
        totalBatiments: smartNumericAggregate(rows.map(r => valueAt(r, columns.SIAP.totalBatiments)), "buildings"),
        surface: smartNumericAggregate(rows.map(r => valueAt(r, columns.SIAP.surface)), "surface"),
        referential: uniqueJoined(rows.map(r => valueAt(r, columns.SIAP.referential))),
        regulation: uniqueJoined(rows.map(r => valueAt(r, columns.SIAP.regulation))),
        date: Math.min(...rows.map(r => parseDateValue(valueAt(r, columns.SIAP.date))).filter(Number.isFinite), Infinity),
        type: uniqueJoined(rows.map(r => valueAt(r, columns.SIAP.type))),
        geo: null,
        parcelFeatures: [], parcelKeys: new Set(), parcelKeysExact: new Set(), parcelKeysNearby: new Set(), parcelLabels: [], plotIds: new Set(), parcelLookupMode: "",
        rnbAddressIds: new Set(), rnbClosest: new Map(), rnbIds: new Set(), rnbPlotIds: new Set(), rnbAddressScore: null, rnbAddressStatus: ""
      };
    });
    for (const s of siapRows) { s.sourceType="SIAP"; }
    for (const s of siapRows) if (s.date === Infinity) s.date = null;
    siapConsolidationStats = { raw: rawSiapRows.length, unique: siapRows.length, grouped: Math.max(0, rawSiapRows.length - siapRows.length), missingId };

    evalRows = rawEvalRows.map((row, index) => {
      const sectionRaw = valueAt(row, columns.EVAL.section);
      const parcelRaw = valueAt(row, columns.EVAL.parcels);
      const sections = parseSections(sectionRaw);
      const parcels = parseParcels(parcelRaw);
      const id = valueAt(row, columns.EVAL.id);
      const postal = normalizePostalCode(valueAt(row, columns.EVAL.postal));
      const owner = valueAt(row, columns.EVAL.owner);
      const operation = valueAt(row, columns.EVAL.operation);
      const address = valueAt(row, columns.EVAL.address);
      const sirenDirect = normalizeSiren(valueAt(row, columns.EVAL.siren));
      const addressParts = parseAddressParts(address);
      return {
        index, original: row, sourceType:"EVAL", id, postal, owner, operation, address, sirenDirect,
        ownerN: normalizeText(owner), operationN: normalizeOperationText(operation), addressN: normalizeText(address), combinedN: normalizeText(`${owner} ${operation}`),
        addressParts, operationNumbers: numericTokens(operation),
        totalLogements: parseNumberValue(valueAt(row, columns.EVAL.totalLogements)),
        totalBatiments: parseNumberValue(valueAt(row, columns.EVAL.totalBatiments)),
        surface: parseNumberValue(valueAt(row, columns.EVAL.surface)),
        referential: valueAt(row, columns.EVAL.referential), regulation: valueAt(row, columns.EVAL.regulation), date: parseDateValue(valueAt(row, columns.EVAL.date)), type: valueAt(row, columns.EVAL.type),
        sections, parcels, cadastreLabel: formatCadastre(sections, parcels), geo: null,
        companyCandidates: [], sirenBest: sirenDirect ? { siren: sirenDirect, name: owner, confidence: 100, direct: true, ambiguous: false } : null,
        sirenCandidates: sirenDirect ? [{ siren: sirenDirect, name: owner, confidence: 100, direct: true, ambiguous: false }] : [],
        parcelFeatures: [], parcelCityCodes: new Set(), parcelKeys: new Set(), plotIds: new Set(), candidateCityCodes: [], rnbIds: new Set(), rnbCover: new Map()
      };
    });
  }

  function appendWarning(message) {
    if (!message || warningMessages.includes(message)) return;
    warningMessages.push(message);
    els.warningBox.textContent = warningMessages.join("\n\n");
    els.warningBox.classList.remove("hidden");
  }

  function showColumnWarnings() {
    for (const type of ["SIAP", "EVAL"]) {
      const missing = missingColumns[type] || [];
      if (!missing.length) continue;
      const labels = missing.map(k => EXPECTED[type][k][0]);
      appendWarning(`Fichier ${type} : colonne(s) non détectée(s) : ${labels.join(" ; ")}\nLe fichier est accepté : le moteur utilisera automatiquement les critères encore disponibles.`);
    }
  }

  async function readExcelFile(file, type) {
    if(running) throw new Error('Arrêtez l’analyse avant de remplacer un fichier.');
    if(typeof XLSX==='undefined')throw new Error('Bibliothèque Excel non chargée. Vérifiez votre connexion puis rechargez la page.');
    clearError();const ab=await file.arrayBuffer();
    const wb=XLSX.read(ab,{type:'array',cellDates:false,raw:true});
    if(!wb.SheetNames.length)throw new Error('Le classeur ne contient aucune feuille.');
    workbooks[type]=wb;fileMeta[type]={name:file.name};
    let best={score:-1,sheet:wb.SheetNames[0],row:1};
    for(const sheet of wb.SheetNames) {
      const matrix=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:'',raw:false,blankrows:true});
      for(let i=0;i<Math.min(25,matrix.length);i++) {
        const headers=matrix[i].map(normalizeHeader).filter(Boolean);
        const fields=Object.keys(EXPECTED[type]).filter(f=>resolveColumn(headers,EXPECTED[type][f],f));
        const score=fields.length+(fields.includes('id')?2:0)+(fields.includes('city')?2:0)+(fields.includes('full')?3:0);
        if(score>best.score)best={score,sheet,row:i+1};
      }
    }
    fileMeta[type].sheet=best.sheet;fileMeta[type].headerRow=best.row;
    applySheet(type);renderImport(type);updateRunButton();
  }

  function applySheet(type) {
    const wb=workbooks[type],meta=fileMeta[type];
    const matrix=XLSX.utils.sheet_to_json(wb.Sheets[meta.sheet],{header:1,defval:'',raw:true,blankrows:true});
    const headers=(matrix[meta.headerRow-1]||[]).map((v,i)=>normalizeHeader(v)||('Colonne '+(i+1)));
    if(!headers.length)throw new Error('La ligne d’en-têtes est vide.');
    const seen=new Map();
    const safeHeaders=headers.map(h=>{const n=(seen.get(h)||0)+1;seen.set(h,n);return n>1?h+' ['+n+']':h;});
    if([...seen.values()].some(n=>n>1))appendWarning('En-têtes en double : suffixes [2], [3] ajoutés pour conserver toutes les cellules.');
    const records=[];meta.rowNumbers=[];
    for(let i=meta.headerRow;i<matrix.length;i++) {
      const values=matrix[i];if(!values.some(v=>v!==''&&v!==null&&v!==undefined))continue;
      const row={};safeHeaders.forEach((h,j)=>{row[h]=values[j]??'';});records.push(row);meta.rowNumbers.push(i+1);
    }
    if(!records.length)throw new Error('Aucune donnée sous la ligne d’en-têtes sélectionnée.');
    if(type==='SIAP')rawSiapRows=records;else rawEvalRows=records;
    columns[type]=mapColumns(records,type);meta.headers=safeHeaders;
    const p=type==='SIAP'?'siap':'eval';
    els[p+'FileName'].textContent=meta.name;els[p+'FileRows'].textContent=`${formatNumber(records.length)} ligne(s) • ${meta.sheet} • en-têtes ligne ${meta.headerRow}`;
    els[p+'FileInfo'].classList.remove('hidden');
    invalidateResults();showColumnWarnings();
  }

  function invalidateResults() {
    results=[];manualSiap.clear();siapRows=[];evalRows=[];
    els.exportButton.disabled=true;els.statsSection.classList.add('hidden');
    document.getElementById('diagnosticsSection').classList.add('hidden');
    els.resultsBody.innerHTML='<tr><td colspan="15" class="px-6 py-16 text-center text-slate-400">Import modifié : lancez une nouvelle analyse.</td></tr>';
  }

  function renderImport(type) {
    document.getElementById('importSection').classList.remove('hidden');
    const meta=fileMeta[type],wb=workbooks[type],box=document.getElementById(type==='SIAP'?'mappingSiap':'mappingEval');
    box.innerHTML=`<details open><summary class="font-semibold mb-3">${type==='SIAP'?'SIAP':'ÉVOLUTION'} : ${escapeHtml(meta.name)}</summary>
      <div class="flex flex-wrap gap-4 mb-4 text-sm"><label>Feuille <select data-sheet="${type}" class="border rounded-lg p-2">${wb.SheetNames.map(n=>`<option ${n===meta.sheet?'selected':''}>${escapeHtml(n)}</option>`).join('')}</select></label>
      <label>Ligne des en-têtes <input data-header="${type}" type="number" min="1" max="10000" value="${meta.headerRow}" class="border rounded-lg p-2" style="width:95px"></label>
      <button data-apply="${type}" class="small-action">Appliquer feuille / en-têtes</button></div>
      <div class="mapping-grid">${Object.keys(FIELD_LABELS).map(f=>`<label>${escapeHtml(FIELD_LABELS[f])}<select data-map-type="${type}" data-field="${f}"><option value="">Non utilisée</option>${meta.headers.map(h=>`<option value="${escapeHtml(h)}" ${columns[type][f]===h?'selected':''}>${escapeHtml(h)}</option>`).join('')}</select></label>`).join('')}</div>
      <p class="text-xs text-slate-500 mt-3">Code cadastral : AB = section ; 45234 = code INSEE ; 45234000AB0123 = référence complète. Si plusieurs sections : AB 12,13 ; AC 7.</p></details>`;
    box.querySelector('[data-apply]').addEventListener('click',()=>{
      if(running)return;
      try{meta.sheet=box.querySelector('[data-sheet]').value;meta.headerRow=Math.max(1,Number(box.querySelector('[data-header]').value)||1);applySheet(type);renderImport(type);updateRunButton();}catch(e){showError(e.message);}
    });
    box.querySelectorAll('[data-field]').forEach(select=>select.addEventListener('change',()=>{
      columns[type][select.dataset.field]=select.value||null;invalidateResults();updateRunButton();
    }));
  }

  function configureDropZone(drop, input, type) {
    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", async e => { const f = e.target.files?.[0]; if (f) await handleFile(f, type); });
    ["dragenter","dragover"].forEach(name => drop.addEventListener(name, e => { e.preventDefault(); e.stopPropagation(); drop.classList.add("dragover"); }));
    ["dragleave","drop"].forEach(name => drop.addEventListener(name, e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove("dragover"); }));
    drop.addEventListener("drop", async e => { const f = e.dataTransfer.files?.[0]; if (f) await handleFile(f, type); });
  }

  async function handleFile(file, type) {
    if (!/\.(xlsx|xls|xlsm)$/i.test(file.name)) return showError("Veuillez sélectionner un fichier Excel .xlsx, .xls ou .xlsm.");
    try {
      setProgress(2, `Lecture du fichier ${type}...`);
      await readExcelFile(file, type);
      setProgress(0, rawSiapRows.length && rawEvalRows.length ? "Les deux fichiers sont prêts" : "En attente du second fichier");
    } catch (err) {
      console.error(err); showError(err.message || "Impossible de lire le fichier."); setProgress(0, "Erreur de lecture");
    }
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function fetchJson(url, timeoutMs = 25000, retries = 1) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { "Accept": "application/json" } });
        if (res.status === 429 && attempt < retries) {
          clearTimeout(timer);
          await sleep(900 + attempt * 800);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        if (attempt >= retries) throw e;
        await sleep(350 + attempt * 500);
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async function companyFetchJson(url) {
    if(engine){try{return await engine.json(url,"SIREN complémentaire");}catch(e){engine.check();companyErrorCount++;return null;}}
    const now = Date.now();
    const target = Math.max(now, companyNextSlot);
    // API publique : limite documentée 7 appels/s. On reste volontairement sous 6 appels/s.
    companyNextSlot = target + 180;
    if (target > now) await sleep(target - now);
    try {
      return await fetchJson(url, 25000, 2);
    } catch (e) {
      companyErrorCount++;
      console.warn("API Recherche d'entreprises indisponible", url, e);
      return null;
    }
  }

  function companyResultName(item) {
    return String(item?.nom_complet || item?.nom_raison_sociale || item?.nom || item?.sigle || "").trim();
  }

  function companyResultPostals(item) {
    const set = new Set();
    const push = v => { const p = normalizePostalCode(v); if (p) set.add(p); };
    push(item?.siege?.code_postal);
    for (const e of (item?.matching_etablissements || [])) push(e?.code_postal || e?.adresse?.code_postal);
    return [...set];
  }

  function companyResultCityCodes(item) {
    const set = new Set();
    const push = v => { const s = String(v || ""); if (/^\d{5}$/.test(s)) set.add(s); };
    push(item?.siege?.commune || item?.siege?.code_commune);
    for (const e of (item?.matching_etablissements || [])) push(e?.commune || e?.code_commune);
    return [...set];
  }

  async function searchCompaniesByOwner(owner) {
    const key = normalizeText(owner);
    if (!key) return [];
    if (companySearchCache.has(key)) return companySearchCache.get(key);
    const params = new URLSearchParams({ q: String(owner).trim(), page: "1", per_page: "15" });
    let out = [];
    const json = await companyFetchJson(`${API.companySearch}?${params.toString()}`);
    for (const item of (json?.results || [])) {
      const siren = normalizeSiren(item?.siren);
      if (!siren) continue;
      out.push({
        siren,
        name: companyResultName(item),
        sigle: String(item?.sigle || ""),
        state: String(item?.etat_administratif || ""),
        postals: companyResultPostals(item),
        cityCodes: companyResultCityCodes(item),
        address: String(item?.siege?.adresse || ""),
        rawScore: Number(item?.score)
      });
    }
    const uniq = new Map();
    for (const c of out) if (!uniq.has(c.siren)) uniq.set(c.siren, c);
    out = [...uniq.values()];
    companySearchCache.set(key, out);
    return out;
  }

  function rankCompanyCandidates(ev, rawCandidates) {
    if (ev.sirenDirect) return [{ siren: ev.sirenDirect, name: ev.owner, confidence: 100, direct: true, ambiguous: false }];
    if (!ev.ownerN) return [];
    const ranked = [];
    for (const c of rawCandidates || []) {
      const nameScore = Math.max(similarity(ev.owner, c.name), c.sigle ? similarity(ev.owner, c.sigle) : 0);
      let confidence = nameScore;
      const ownerN = normalizeText(ev.owner), nameN = normalizeText(c.name), sigleN = normalizeText(c.sigle);
      if (ownerN && (ownerN === nameN || ownerN === sigleN)) confidence = 100;
      else if (ownerN.length >= 5 && nameN.includes(ownerN)) confidence = Math.max(confidence, 90);
      else if (nameN.length >= 5 && ownerN.includes(nameN)) confidence = Math.max(confidence, 88);
      if (ev.postal && c.postals.includes(ev.postal)) confidence += 6;
      if (ev.candidateCityCodes?.some(code => c.cityCodes.includes(code))) confidence += 6;
      if (c.state && !["A", "ACTIF", "ACTIVE"].includes(c.state.toUpperCase())) confidence -= 5;
      confidence = Math.max(0, Math.min(100, Math.round(confidence)));
      if (confidence >= COMPANY_MIN_CANDIDATE_CONFIDENCE) ranked.push({ ...c, confidence, nameScore });
    }
    ranked.sort((a,b) => b.confidence - a.confidence || b.nameScore - a.nameScore);
    const top = ranked[0], second = ranked[1];
    const ambiguous = !!(top && second && top.siren !== second.siren && (top.confidence - second.confidence) <= 5);
    return ranked.slice(0, 6).map((c,i) => ({ ...c, ambiguous: ambiguous && i < 2 }));
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const p1 = toRad(lat1), p2 = toRad(lat2), dp = toRad(lat2-lat1), dl = toRad(lon2-lon1);
    const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  async function mapConcurrent(items, concurrency, worker, onProgress) {
    let cursor = 0, done = 0;
    const output = new Array(items.length);
    async function run() {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        try { output[i] = await worker(items[i], i); } catch (e) { output[i] = null; console.warn(e); }
        done++;
        if (onProgress) onProgress(done, items.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, run));
    return output;
  }

  function tokenDice(a, b) {
    const A = new Set(normalizeText(a).split(" ").filter(Boolean));
    const B = new Set(normalizeText(b).split(" ").filter(Boolean));
    if (!A.size && !B.size) return 100;
    if (!A.size || !B.size) return 0;
    let inter = 0; for (const x of A) if (B.has(x)) inter++;
    return Math.round(200 * inter / (A.size + B.size));
  }

  function bigramDice(a, b) {
    a = normalizeText(a).replace(/\s+/g, " "); b = normalizeText(b).replace(/\s+/g, " ");
    if (a === b && a) return 100;
    if (a.length < 2 || b.length < 2) return 0;
    const counts = new Map();
    for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i,i+2); counts.set(g, (counts.get(g)||0)+1); }
    let inter = 0;
    for (let i = 0; i < b.length - 1; i++) { const g = b.slice(i,i+2), c = counts.get(g)||0; if (c>0) { inter++; counts.set(g,c-1); } }
    return Math.round(200 * inter / ((a.length-1)+(b.length-1)));
  }

  function similarity(a, b) {
    if (!normalizeText(a) || !normalizeText(b)) return 0;
    return Math.round(.58 * tokenDice(a,b) + .42 * bigramDice(a,b));
  }

  function geometryDistance(point, geometry) {
    try {
      const pt = turf.point([point.lon, point.lat]);
      const feature = { type: "Feature", properties: {}, geometry };
      if ((geometry.type === "Polygon" || geometry.type === "MultiPolygon") && turf.booleanPointInPolygon(pt, feature)) return { distance: 0, inside: true };
      let min = Infinity;
      const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
      for (const poly of polygons) {
        for (const ring of poly) {
          if (!ring || ring.length < 2) continue;
          const d = turf.pointToLineDistance(pt, turf.lineString(ring), { units: "meters" });
          if (Number.isFinite(d) && d < min) min = d;
        }
      }
      return { distance: min, inside: false };
    } catch (e) { return { distance: Infinity, inside: false }; }
  }

  function bestGeoAgainstParcels(siap, parcelFeatures) {
    if (!siap.geo || !parcelFeatures.length) return { distance: Infinity, inside: false, feature: null };
    let best = { distance: Infinity, inside: false, feature: null };
    for (const f of parcelFeatures) {
      const d = geometryDistance(siap.geo, f.geometry);
      if (d.distance < best.distance) best = { ...d, feature: f };
      if (d.inside) return best;
    }
    return best;
  }

  function geoScore(distance, inside) {
    if (inside) return 100;
    if (!Number.isFinite(distance)) return 0;
    if (distance <= 10) return 99;
    if (distance <= 25) return 96;
    if (distance <= 50) return 91;
    if (distance <= 100) return 84;
    if (distance <= 200) return 75;
    if (distance <= 500) return 62;
    if (distance <= 1000) return 48;
    if (distance <= 2500) return 28;
    if (distance <= 5000) return 10;
    return 0;
  }

  function numericCloseness(a, b, kind) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const diff = Math.abs(a-b);
    if (kind === "buildings") {
      if (diff === 0) return 100; if (diff === 1) return 75; if (diff === 2) return 45; return 5;
    }
    if (kind === "logements") {
      if (diff === 0) return 100;
      const base = Math.max(Math.abs(a), Math.abs(b), 1), rel = diff/base;
      if (diff <= 1 || rel <= .03) return 95; if (rel <= .08) return 85; if (rel <= .15) return 70; if (rel <= .25) return 50; return 10;
    }
    const base = Math.max(Math.abs(a), Math.abs(b), 1), rel = diff/base;
    if (rel <= .03) return 100; if (rel <= .07) return 90; if (rel <= .15) return 75; if (rel <= .25) return 55; if (rel <= .40) return 30; return 5;
  }

  function dateCloseness(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const days = Math.abs(a-b) / 86400000;
    if (days <= 30) return 100; if (days <= 90) return 90; if (days <= 180) return 80; if (days <= 365) return 65; if (days <= 730) return 40; return 10;
  }

  function businessScores(ev, s) {
    const criteria = [];
    const add = (name, value, weight) => {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
      criteria.push({ name, value: Math.max(0, Math.min(100, Number(value))), weight });
    };
    const sirenInfo = commonSirenInfo(ev, s);
    if (sirenInfo.match) add("siren", Math.max(78, sirenInfo.confidence), 25);
    if (ev.ownerN && s.ownerN) add("owner", similarity(ev.owner, s.owner), 14);
    if (ev.operationN && s.operationN) add("operation", similarity(ev.operationN, s.operationN), 17);
    if (ev.addressN && s.addressN) add("address", similarity(ev.address, s.address), 9);
    if (ev.addressParts?.street && s.addressParts?.street) add("street", similarity(ev.addressParts.street, s.addressParts.street), 14);
    if (ev.addressParts?.houseNumber && s.addressParts?.houseNumber) add("houseNumber", ev.addressParts.houseNumber === s.addressParts.houseNumber ? 100 : 0, 8);
    if (ev.postal && s.postal) add("postal", ev.postal === s.postal ? 100 : 0, 4);
    if (ev.candidateCityCodes?.length && s.geo?.citycode) add("city", ev.candidateCityCodes.includes(s.geo.citycode) ? 100 : 0, 8);
    add("logements", numericCloseness(ev.totalLogements, s.totalLogements, "logements"), 12);
    add("batiments", numericCloseness(ev.totalBatiments, s.totalBatiments, "buildings"), 8);
    add("surface", numericCloseness(ev.surface, s.surface, "surface"), 10);
    if (normalizeText(ev.referential) && normalizeText(s.referential)) add("referential", similarity(ev.referential, s.referential), 3);
    if (normalizeText(ev.regulation) && normalizeText(s.regulation)) add("regulation", similarity(ev.regulation, s.regulation), 3);
    if (normalizeText(ev.type) && normalizeText(s.type)) add("type", similarity(ev.type, s.type), 4);
    add("date", dateCloseness(ev.date, s.date), 4);

    const evNums = new Set(ev.operationNumbers || []), sNums = new Set(s.operationNumbers || []);
    if (evNums.size && sNums.size) {
      const common = [...evNums].filter(x => sNums.has(x));
      add("operationNumbers", common.length ? 100 : 0, 5);
    }

    const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
    let score = totalWeight ? Math.round(criteria.reduce((sum, c) => sum + c.value*c.weight, 0) / totalWeight) : 0;
    if (totalWeight < 20) score = Math.min(score, 58);
    else if (totalWeight < 35) score = Math.min(score, 72);
    else if (totalWeight < 50) score = Math.min(score, 84);
    else score = Math.min(score, 94);
    const byName = Object.fromEntries(criteria.map(c => [c.name, Math.round(c.value)]));
    return { score, totalWeight, byName, criteria };
  }

  function commonSirenInfo(ev, s) {
    if (!s?.siren) return { match: false, confidence: 0, candidate: null };
    const direct = ev?.sirenDirect && ev.sirenDirect === s.siren;
    if (direct) return { match: true, confidence: 100, candidate: { siren: s.siren, confidence: 100, direct: true } };
    const candidates = ev?.sirenCandidates || [];
    const candidate = candidates.find(c => c.siren === s.siren);
    return candidate ? { match: true, confidence: candidate.confidence || 0, candidate } : { match: false, confidence: 0, candidate: null };
  }

  function commonParcelInfo(ev,s) {
    const keys=[...ev.parcelKeys].filter(k=>s.parcelKeys.has(k));
    const exact=keys.some(k=>ev.parcelKeysExact.has(k)&&s.parcelKeysExact.has(k));
    return {keys,exact,nearbyExtracted:keys.length>0&&!exact};
  }

  function flattenLineFeatures(feature) {
    try {
      const lines = turf.polygonToLine(feature);
      if (!lines) return [];
      if (lines.type === "FeatureCollection") return lines.features || [];
      if (lines.type === "Feature") return [lines];
    } catch (e) {}
    return [];
  }

  function sampleCoords(feature, max = 70) {
    const out = [];
    const walk = c => {
      if (!Array.isArray(c)) return;
      if (c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") out.push([c[0], c[1]]);
      else for (const x of c) walk(x);
    };
    walk(feature?.geometry?.coordinates);
    if (out.length <= max) return out;
    const step = out.length / max;
    return Array.from({length:max}, (_,i) => out[Math.floor(i*step)]);
  }

  function featureDistanceMeters(a, b) {
    if (!a?.geometry || !b?.geometry) return Infinity;
    try { if (turf.booleanIntersects(a, b)) return 0; } catch (e) {}
    const linesA = flattenLineFeatures(a), linesB = flattenLineFeatures(b);
    let best = Infinity;
    const check = (coords, lines) => {
      for (const coord of coords) for (const line of lines) {
        try {
          const d = turf.pointToLineDistance(turf.point(coord), line, { units: "kilometers" }) * 1000;
          if (d < best) best = d;
          if (best <= 1) return;
        } catch (e) {}
      }
    };
    check(sampleCoords(a), linesB); check(sampleCoords(b), linesA);
    if (Number.isFinite(best)) return best;
    try { return turf.distance(turf.centroid(a), turf.centroid(b), { units: "kilometers" }) * 1000; } catch (e) { return Infinity; }
  }

  function parcelRelationship(ev, s) {
    const common = commonParcelInfo(ev, s);
    if (common.exact) return { type: "identical", distance: 0, keys: common.keys, exact: true, rank: 4 };
    if (common.keys.length) return { type: "same_reference_nearby", distance: 0, keys: common.keys, exact: false, rank: 4 };
    if (!ev?.parcelFeatures?.length || !s?.parcelFeatures?.length) return { type: "none", distance: Infinity, keys: [], exact: false, rank: 0 };
    let best = Infinity;
    for (const a of ev.parcelFeatures) for (const b of s.parcelFeatures) {
      const d = featureDistanceMeters(a, b);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best <= 2) return { type: "adjacent", distance: best, keys: [], exact: false, rank: 3 };
    if (best <= 25) return { type: "near25", distance: best, keys: [], exact: false, rank: 2 };
    if (best <= 100) return { type: "near100", distance: best, keys: [], exact: false, rank: 1 };
    if (best <= 500) return { type: "near500", distance: best, keys: [], exact: false, rank: 1 };
    return { type: "none", distance: best, keys: [], exact: false, rank: 0 };
  }

  function commonRnbInfo(ev,s) { return P.compare(ev,s); }

  function scoreCandidate(ev,s,geoInfo) {
    const biz=businessScores(ev,s),g=geoScore(geoInfo.distance,geoInfo.inside),parcel=parcelRelationship(ev,s),rnb=commonRnbInfo(ev,s),siren=commonSirenInfo(ev,s);
    let score=biz.score,method='Critères métier / texte';const reasons=[];
    if(rnb.strong.length){score=Math.round(87+10*biz.score/100);method='RNB base ↔ RNB SIAP';}
    else if(rnb.near.length){score=Math.min(84,Math.round(64+.20*biz.score));method='RNB candidat commun, à vérifier';}
    else if(parcel.type==='identical'){score=Math.min(84,Math.round(68+.16*biz.score));method='Parcelle exacte commune, SIAP à vérifier';}
    else if(parcel.type==='same_reference_nearby'){score=Math.min(79,Math.round(59+.20*biz.score));method='Parcelle commune déduite de l’adresse';}
    else if(parcel.type==='adjacent'){score=Math.min(79,Math.round(.55*80+.45*biz.score));method='Parcelles adjacentes + critères';}
    else if(Number.isFinite(geoInfo.distance)&&geoInfo.distance<=500){score=Math.min(84,Math.round(.4*g+.6*biz.score));method=siren.match?'SIREN + proximité ≤ 500 m':'Proximité ≤ 500 m + critères';}
    else if(siren.match){score=Math.min(79,Math.round(.3*siren.confidence+.7*biz.score));method='SIREN + critères métier';}
    else score=Math.min(79,score);
    if(rnb.conflict){score=Math.min(score,49);reasons.push('RNB retenus incompatibles');}
    if(ev.locality?.exact&&s.locality?.exact&&ev.candidateCityCodes.length&&s.candidateCityCodes.length&&!ev.candidateCityCodes.some(c=>s.candidateCityCodes.includes(c))){score=Math.min(score,39);reasons.push('Communes différentes');}
    if(ev.sirenDirect && s.siren && ev.sirenDirect!==s.siren) reasons.push('SIREN fournis diff\u00e9rents');
    if(!rnb.strong.length&&biz.byName.houseNumber===0&&biz.byName.street>=85)reasons.push('Numéros de rue différents');
    if(biz.byName.logements!==undefined&&biz.byName.logements<=10)reasons.push('Effectifs logements très différents');
    const directBoth=rnb.strong.some(id=>ev.suppliedRnb.has(id)&&s.suppliedRnb.has(id));
    const independent=biz.criteria.filter(c=>['siren','owner','operation','operationNumbers','logements','batiments','surface','date'].includes(c.name));
    const independentWeight=independent.reduce((n,c)=>n+c.weight,0);
    const independentBusiness=independentWeight>=25&&independent.reduce((n,c)=>n+c.value*c.weight,0)/independentWeight>=60;
    const automaticEligible=!!rnb.strong.length&&rnb.fullBaseCoverage&&ev.eligibleAutomatic&&s.eligibleAutomatic&&!reasons.length&&(directBoth||independentBusiness)&&!String(s.id).startsWith('SIAP_SANS_ID_');
    if(rnb.strong.length&&!rnb.fullBaseCoverage)reasons.push('Une partie seulement des RNB de la base est commune');
    if(!automaticEligible&&score>=85)score=84;
    if(!automaticEligible&&rnb.strong.length)reasons.push('Validation automatique bloquée par un diagnostic ou des critères insuffisants');
    return {score:Math.max(0,Math.min(100,score)),method,automaticEligible,reasons,businessScore:biz.score,businessWeight:biz.totalWeight,businessDetails:biz.byName,geoScore:g,parcelMatch:parcel,rnbMatch:rnb,sirenMatch:siren,...geoInfo};
  }

  function formatParcelKey(key) {
    const r=C.fullId(key);return r?`${r.city} / ${r.prefix} / ${r.section} ${r.number}`:String(key||'');
  }

  function formatDistance(m, inside) {
    if (inside) return "Dans la parcelle";
    if (!Number.isFinite(m)) return "—";
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m/1000).toFixed(1).replace(".", ",")} km`;
  }

  function buildFuseIndexes() {
    const postalGroups = new Map(), cityGroups = new Map(), ownerExact = new Map(), sirenGroups = new Map();
    for (const s of siapRows) {
      if (s.postal) { if (!postalGroups.has(s.postal)) postalGroups.set(s.postal, []); postalGroups.get(s.postal).push(s); }
      for(const city of s.candidateCityCodes||[]) {if(!cityGroups.has(city))cityGroups.set(city,[]);cityGroups.get(city).push(s);}
      if (s.ownerN) { if (!ownerExact.has(s.ownerN)) ownerExact.set(s.ownerN, []); ownerExact.get(s.ownerN).push(s); }
      if (s.siren) { if (!sirenGroups.has(s.siren)) sirenGroups.set(s.siren, []); sirenGroups.get(s.siren).push(s); }
    }
    const options = { keys: ["combinedN","ownerN","operationN","addressN"], threshold: 1, includeScore: true, ignoreLocation: true, ignoreFieldNorm: true };
    const postalFuse = new Map();
    for (const [postal, rows] of postalGroups) postalFuse.set(postal, new Fuse(rows, options));
    return { postalGroups, cityGroups, ownerExact, sirenGroups, postalFuse, allFuse: new Fuse(siapRows, options) };
  }

  function spatialKey(lon, lat, size=.01) { return `${Math.floor(lon/size)}|${Math.floor(lat/size)}`; }

  function buildSpatialIndex() {
    const size = .01, map = new Map();
    for (const s of siapRows) {
      if (!s.geo || !Number.isFinite(s.geo.lon) || !Number.isFinite(s.geo.lat)) continue;
      const k = spatialKey(s.geo.lon, s.geo.lat, size);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    return { size, map };
  }

  function evalReferenceBBox(ev) {
    try {
      if (ev.parcelFeatures?.length) return turf.bbox(turf.featureCollection(ev.parcelFeatures));
    } catch (e) {}
    if (ev.geo && Number.isFinite(ev.geo.lon) && Number.isFinite(ev.geo.lat)) return [ev.geo.lon, ev.geo.lat, ev.geo.lon, ev.geo.lat];
    return null;
  }

  function nearbySiapWithinRadius(ev, spatial, radiusM = MAX_GEO_CANDIDATE_RADIUS_M) {
    const bbox = evalReferenceBBox(ev);
    if (!bbox) return [];
    const lat = (bbox[1] + bbox[3]) / 2;
    const dLat = radiusM / 111320;
    const dLon = radiusM / Math.max(20000, 111320 * Math.cos(lat * Math.PI / 180));
    const minLon = bbox[0] - dLon, maxLon = bbox[2] + dLon, minLat = bbox[1] - dLat, maxLat = bbox[3] + dLat;
    const ix0 = Math.floor(minLon/spatial.size), ix1 = Math.floor(maxLon/spatial.size), iy0 = Math.floor(minLat/spatial.size), iy1 = Math.floor(maxLat/spatial.size);
    const out = new Map();
    for (let ix=ix0; ix<=ix1; ix++) for (let iy=iy0; iy<=iy1; iy++) {
      for (const s of spatial.map.get(`${ix}|${iy}`) || []) out.set(s.index, s);
    }
    return [...out.values()];
  }

  function geoInfoForCandidate(ev,s) {
    let best={distance:Infinity,inside:false,feature:null};
    for(const location of s.locations||[s]) {
      if(!location.geo?.precise)continue;
      if(ev.parcelFeatures.length){const d=bestGeoAgainstParcels(location,ev.parcelFeatures);if(d.distance<best.distance)best=d;}
      else for(const e of ev.locations||[ev])if(e.geo?.precise){const d=haversineMeters(e.geo.lat,e.geo.lon,location.geo.lat,location.geo.lon);if(d<best.distance)best={distance:d,inside:false,feature:null};}
    }
    return best;
  }

  function mappedFields(raw,type) {
    return Object.fromEntries(Object.keys(EXPECTED[type]).map(f=>[f,valueAt(raw,columns[type][f])]));
  }

  function mergeLocations(row,locations) {
    const primary=locations[0]||engine.empty(C.parseInput({}));
    Object.assign(row,primary);row.locations=locations;
    for(const field of ['parcelKeys','parcelKeysExact','parcelKeysNearby','plotIds','refPlotIds','candidateCityCodes','parcelCityCodes','rnbIds','rnbAddressIds','primaryRnbIds','suppliedRnb']) {
      const set=new Set(locations.flatMap(l=>[...(l[field]||[])]));row[field]=field==='candidateCityCodes'?[...set]:set;
    }
    for(const field of ['rnbCover','rnbClosest','rnbEvidence','rnbBuildings','plotSources']) {
      const m=new Map();for(const l of locations)for(const [k,v] of l[field]||[])m.set(k,field==='rnbEvidence'?[...(m.get(k)||[]),...v]:v);row[field]=m;
    }
    row.parcelFeatures=[...new Map(locations.flatMap(l=>l.parcelFeatures).map(f=>[f._plotId,f])).values()];
    row.parcelLabels=[...new Set(locations.flatMap(l=>l.parcelLabels))];
    row.issues=[...new Set(locations.flatMap(l=>l.issues))];row.errors=[...new Set(locations.flatMap(l=>l.errors))];
    row.eligibleAutomatic=locations.length>0&&locations.every(l=>l.eligibleAutomatic);
    row.locality={...primary.locality,codes:row.candidateCityCodes,exact:locations.every(l=>l.locality.exact)};
    row.city=primary.input.city||primary.locality.name||'';row.insee=row.candidateCityCodes.join('; ');
    row.cadastreLabel=row.parcelLabels.join(' ; ')||row.original?.[columns[row.sourceType]?.parcels]||'';
    if(locations.length>1)row.rnbStatus=`${locations.length} localisations sources conservées — ${row.primaryRnbIds.size} RNB retenu(s)`;
  }

  async function prepareGeodata() {
    buildPreparedRows();engine=new C.Engine();companySearchCache.clear();companyErrorCount=0;rnbErrorCount=0;
    const all=[...siapRows,...evalRows];
    await mapConcurrent(all,4,async row=>{
      const sources=row.sourceType==='SIAP'?row.sourceRowsOriginal:[row.original];
      const fields=[...new Map(sources.map(raw=>{const mapped=mappedFields(raw,row.sourceType);const f=Object.fromEntries(['city','postal','insee','section','parcels','prefix','full','cadastral','rnb','address'].map(k=>[k,mapped[k]]));return [JSON.stringify(f),f];})).values()];
      const locations=[];
      for(let j=0;j<fields.length;j++) {
        engine.check();
        try {locations.push(await engine.enrich(fields[j],`${row.sourceType} ${row.id||row.index+1} / source ${j+1}`));}
        catch(e){engine.check();const failed=engine.empty(C.parseInput(fields[j]));failed.errors.push(e.message);failed.rnbStatus='Erreur de traitement';failed.eligibleAutomatic=false;locations.push(failed);}
      }
      mergeLocations(row,locations);
    },(done,total)=>setProgress(3+Math.round(77*done/Math.max(1,total)),`RNB des deux fichiers : ${done} / ${total} opérations`));
    engine.check();
    if(document.getElementById('useCompany').checked && siapRows.length) {
      const owners=[...new Map(evalRows.filter(e=>e.ownerN&&!e.sirenDirect).map(e=>[e.ownerN,e.owner])).entries()];
      const found=await mapConcurrent(owners,2,async([k,v])=>{engine.check();return [k,await searchCompaniesByOwner(v)];},(d,t)=>setProgress(80+Math.round(5*d/Math.max(1,t)),`SIREN complémentaires : ${d} / ${t}`));
      const lookup=new Map(found.filter(Boolean));
      for(const ev of evalRows)if(!ev.sirenDirect){ev.sirenCandidates=rankCompanyCandidates(ev,lookup.get(ev.ownerN)||[]);ev.sirenBest=ev.sirenCandidates[0]||null;}
    }
    engine.check();
  }

  async function runMatching() {
    if(!rawEvalRows.length)return showError('Chargez le fichier ÉVOLUTION. Le SIAP est facultatif pour le diagnostic RNB.');
    if(typeof Fuse==='undefined'||typeof turf==='undefined'||!C||!P)return showError('Une bibliothèque n’est pas chargée. Vérifiez la connexion et rechargez.');
    if(rawSiapRows.length&&!columns.SIAP.id)return showError('Associez la colonne NUMERO_SIAP dans le panneau de correspondance.');
    clearError();warningMessages=[];els.warningBox.classList.add('hidden');manualSiap.clear();results=[];
    running=true;setBusy(true);els.exportButton.disabled=true;
    try {
      await prepareGeodata();await matchPreparedRows();
      setProgress(100,siapRows.length?'Analyse V5.1 terminée':'Diagnostic RNB terminé (sans fichier SIAP)');
      const bad=evalRows.filter(r=>r.issues.length||r.errors.length).length;
      if(siapRows.length)appendWarning(`${siapRows.filter(r=>r.issues.length||r.errors.length).length}/${siapRows.length} opération(s) SIAP avec contrôle RNB requis. Consultez Adresses SIAP RNB dans l'export.`);
      appendWarning(`${bad}/${evalRows.length} ligne(s) ÉVOLUTION avec contrôle requis. Le détail et le journal API sont exportables.`);
      if(siapConsolidationStats.missingId)appendWarning(`${siapConsolidationStats.missingId} ligne(s) SIAP sans numéro : jamais validées automatiquement.`);
      if(companyErrorCount)appendWarning(`${companyErrorCount} recherche(s) SIREN indisponible(s).`);
    } catch(e) {showError(e.message||String(e));setProgress(0,engine?.cancelled?'Analyse interrompue':'Erreur');}
    finally {running=false;setBusy(false);updateRunButton();}
  }

  function setBusy(value) {
    document.getElementById('stopButton').disabled=!value;els.runButton.disabled=value;
    document.querySelectorAll('#importSection select,#importSection input,#importSection button,#useCompany,#fileSiap,#fileEval').forEach(e=>e.disabled=value);
  }

  async function matchPreparedRows() {
    results=[];
      const indexes = buildFuseIndexes();
      const spatial = buildSpatialIndex();
      const parcelToSiap = new Map(), rnbStrongToSiap = new Map(), rnbNearToSiap = new Map();
      const allRnbToSiap=P.buildIndex(siapRows);
      for (const s of siapRows) {
        for (const key of s.parcelKeys) { if (!parcelToSiap.has(key)) parcelToSiap.set(key, []); parcelToSiap.get(key).push(s); }
        for (const id of s.rnbAddressIds) { if (!rnbStrongToSiap.has(id)) rnbStrongToSiap.set(id, []); rnbStrongToSiap.get(id).push(s); }
        for (const id of s.rnbClosest.keys()) { if (!rnbNearToSiap.has(id)) rnbNearToSiap.set(id, []); rnbNearToSiap.get(id).push(s); }
      }

      for (let i=0; i<evalRows.length; i++) {
        const ev = evalRows[i];
        const candidateMap = new Map();
        const add = s => { if (s) candidateMap.set(s.index, s); };

        // 1. SIREN = générateur de candidats prioritaire
        for (const c of ev.sirenCandidates || []) {
          if (c.confidence < COMPANY_MIN_CANDIDATE_CONFIDENCE) continue;
          for (const s of indexes.sirenGroups.get(c.siren) || []) add(s);
        }
        // 2. Preuves fortes RNB / parcelle
        for (const id of new Set([...ev.rnbIds,...ev.primaryRnbIds])) {
          for (const s of allRnbToSiap.get(id) || []) add(s);
          for (const s of rnbStrongToSiap.get(id) || []) add(s);
          for (const s of rnbNearToSiap.get(id) || []) add(s);
        }
        for (const key of ev.parcelKeys) for (const s of parcelToSiap.get(key) || []) add(s);
        // 3. Commune / code postal
        for (const city of ev.candidateCityCodes || []) for (const s of indexes.cityGroups.get(city) || []) add(s);
        for (const s of indexes.postalGroups.get(ev.postal) || []) add(s);
        // 4. Recherche géographique large dans l'emprise + 500 m
        for (const s of nearbySiapWithinRadius(ev, spatial, MAX_GEO_CANDIDATE_RADIUS_M)) add(s);
        // 5. MOA et fuzzy globaux en secours
        for (const s of indexes.ownerExact.get(ev.ownerN) || []) add(s);
        const query = ev.combinedN || ev.ownerN || ev.operationN || ev.addressN;
        if (query) {
          const localFuse = indexes.postalFuse.get(ev.postal);
          if (localFuse) for (const x of localFuse.search(query, { limit: 35 })) add(x.item);
          for (const x of indexes.allFuse.search(query, { limit: 60 })) add(x.item);
        }

        const candidates = [...candidateMap.values()];
        let best = null, second = null;
        const ranked = [];
        for (const s of candidates) {
          const geo = geoInfoForCandidate(ev, s);
          const sc = scoreCandidate(ev, s, geo);
          const candidate = { s, ...sc }; ranked.push(candidate);
          if (!best || candidate.score > best.score) { second = best; best = candidate; }
          else if (!second || candidate.score > second.score) second = candidate;
        }

        ranked.sort((a,b)=>b.score-a.score || b.businessScore-a.businessScore || String(a.s.id).localeCompare(String(b.s.id),'fr'));
        best=ranked[0]||null;second=ranked[1]||null;
        const decision=P.classify(ranked),score=decision.score,level=decision.level;
        const label=decision.label;
        const parcelMatch = best?.parcelMatch || { type:"none", distance:Infinity, keys:[], rank:0, exact:false };
        results.push({
          eval: ev, siap: best?.s || null, score, level, statusLabel: label,
          numeroSiap: decision.numeroSiap, ambiguous:decision.ambiguous, ranked, reasons:[...new Set([...(best?.reasons||[]),...decision.reasons])], linkedSiapIds:decision.linkedSiapIds, rnbComparison:best?.rnbMatch||null,
          method: best?.method || "Aucun candidat", distance: best?.distance ?? Infinity, inside: !!best?.inside,
          businessScore: best?.businessScore || 0, businessWeight: best?.businessWeight || 0, businessDetails: best?.businessDetails || {}, geoScore: best?.geoScore || 0,
          parcelMatchType: parcelMatch.type, parcelDistance: parcelMatch.distance, parcelRelationRank: parcelMatch.rank || 0,
          parcelMatchCount: parcelMatch.keys?.length || 0, parcelMatchKeys: parcelMatch.keys || [], parcelMatchExact: !!parcelMatch.exact,
          rnbStrongIds: best?.rnbMatch?.strong || [], rnbNearIds: best?.rnbMatch?.near || [], rnbNearDistance: best?.rnbMatch?.minNearDistance ?? Infinity,
          sirenMatch: !!best?.sirenMatch?.match, sirenConfidence: best?.sirenMatch?.confidence || 0, sirenCandidate: best?.sirenMatch?.candidate || null,
          secondScore: second?.score || 0, candidateCount: candidates.length, parcelFound: ev.parcelFeatures.length > 0,
          levelRank: level === "auto" ? 4 : level === "probable" ? 3 : level === "candidate" ? 2 : 1
        });

        engine.check();
        if (i % 10 === 0 || i === evalRows.length-1) {
          setProgress(87 + Math.round(13*(i+1)/Math.max(1,evalRows.length)), `Scoring multi-critères : ${i+1} / ${evalRows.length}`);
          await nextFrame();
        }
      }


    for(const result of results) if(manualSiap.has(result.eval.index)) applyManualSiap(result,manualSiap.get(result.eval.index),false);
    populateMethodFilter();renderResults();updateStats();renderDiagnostics();
    els.statsSection.classList.remove('hidden');els.exportButton.disabled=!results.length;
  }

  function levelBadge(r) {
    if (r.level === "manual") return `<span class="pill" style="background:#dcfce7;color:#065f46">Validé manuellement</span>`;
    if (r.level === "auto") return `<span class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">Automatique</span>`;
    if (r.level === "probable") return `<span class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Probable</span>`;
    if (r.level === "candidate") return `<span class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">Candidat</span>`;
    return `<span class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">Faible</span>`;
  }

  function scoreBadge(score) {
    const cls = score >= AUTO_THRESHOLD ? "bg-green-100 text-green-800" : score >= PROBABLE_THRESHOLD ? "bg-amber-100 text-amber-800" : score >= CANDIDATE_THRESHOLD ? "bg-orange-100 text-orange-800" : "bg-red-100 text-red-800";
    return `<span class="inline-flex px-2.5 py-1 rounded-lg text-xs font-bold ${cls}">${score}/100</span>`;
  }

  function parcelRelationLabel(r) {
    if(r.parcelMatchType === "same_reference_nearby") return "Commune par adresse (à vérifier)";
    if (r.parcelMatchType === "identical") return "Référence exacte";
    if (r.parcelMatchType === "adjacent") return "Adjacente";
    if (r.parcelMatchType === "near25") return `Proche ~${Math.round(r.parcelDistance)} m`;
    if (r.parcelMatchType === "near100") return `Proche ~${Math.round(r.parcelDistance)} m`;
    if (r.parcelMatchType === "near500") return `Proche ~${Math.round(r.parcelDistance)} m`;
    return "—";
  }

  function shortIds(ids, max = 2) {
    const arr = [...new Set(ids || [])];
    if (!arr.length) return "—";
    return arr.slice(0,max).join(" ; ") + (arr.length > max ? ` +${arr.length-max}` : "");
  }

  function populateMethodFilter() {
    const current = els.methodFilter.value || "all";
    const methods = [...new Set(results.map(r => r.method).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr"));
    els.methodFilter.innerHTML = `<option value="all">Toutes méthodes</option>` + methods.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
    if (methods.includes(current)) els.methodFilter.value = current;
  }

  function sortValue(r, key) {
    const map = {
      levelRank: r.levelRank, score: r.score, method: r.method, distance: Number.isFinite(r.distance) ? r.distance : 1e12,
      parcelRelationRank: r.parcelRelationRank, sirenMatch: r.sirenMatch ? 1 : 0, evalId: r.eval?.id || "", evalOwner: r.eval?.owner || "", evalOperation: r.eval?.operation || "",
      siapId: r.siap?.id || "", siapSourceRows: r.siap?.sourceRowCount || 0, siapOwner: r.siap?.owner || "", siapOperation: r.siap?.operation || "",
      streetScore: r.businessDetails?.street ?? -1, businessScore: r.businessScore
    };
    return map[key];
  }

  function compareValues(a,b) {
    if (typeof a === "number" && typeof b === "number") return a-b;
    return String(a ?? "").localeCompare(String(b ?? ""), "fr", { numeric:true, sensitivity:"base" });
  }

  function getFilteredResults() {
    const q = normalizeText(els.searchInput.value), status = els.statusFilter.value, evidence = els.evidenceFilter.value;
    const dist = els.distanceFilter.value === "all" ? Infinity : Number(els.distanceFilter.value);
    const siren = els.sirenFilter.value, minScore = Number(els.minScoreFilter.value || 0), method = els.methodFilter.value;
    const filtered = results.filter(r => {
      if (status !== "all" && r.level !== status) return false;
      if (r.score < minScore) return false;
      if (Number.isFinite(dist) && !(Number.isFinite(r.distance) && r.distance <= dist)) return false;
      if (siren === "yes" && !r.sirenMatch) return false;
      if (siren === "no" && r.sirenMatch) return false;
      if (method !== "all" && r.method !== method) return false;
      if (evidence === "rnb" && !r.rnbStrongIds.length) return false;
      if (evidence === "parcelExact" && !(r.parcelMatchType === "identical" || r.parcelMatchType === "same_reference_nearby")) return false;
      if (evidence === "parcelAdjacent" && r.parcelMatchType !== "adjacent") return false;
      if (evidence === "parcelNear" && !["near25","near100","near500"].includes(r.parcelMatchType)) return false;
      if (evidence === "siren" && !r.sirenMatch) return false;
      if (evidence === "geo" && !(Number.isFinite(r.distance) && r.distance <= 500)) return false;
      if (!q) return true;
      return normalizeText([r.eval?.id,r.eval?.owner,r.eval?.operation,r.eval?.cadastreLabel,r.eval?.sirenBest?.siren,r.siap?.id,r.siap?.owner,r.siap?.operation,r.siap?.address,r.siap?.siren,r.method,parcelRelationLabel(r)].join(" ")).includes(q);
    });
    filtered.sort((a,b) => {
      const c = compareValues(sortValue(a, sortState.key), sortValue(b, sortState.key));
      return sortState.dir === "asc" ? c : -c;
    });
    return filtered;
  }

  function renderResults() {
    const pageY=window.scrollY,wrap=document.querySelector(".table-wrapper"),top=wrap.scrollTop,left=wrap.scrollLeft;
    const filtered = getFilteredResults();
    if (!filtered.length) {
      els.resultsBody.innerHTML = `<tr><td colspan="15" class="px-6 py-16 text-center text-slate-400">Aucun résultat correspondant aux filtres.</td></tr>`;
    } else {
      els.resultsBody.innerHTML = filtered.map(r => {
        const b = r.businessDetails || {};
        const detail = [
          `MO ${b.owner ?? "—"}%`, `Nom ${b.operation ?? "—"}%`, `Rue ${b.street ?? "—"}%`,
          Number.isFinite(b.logements) ? `Log. ${b.logements}%` : "", Number.isFinite(b.batiments) ? `Bât. ${b.batiments}%` : "", Number.isFinite(b.surface) ? `Surf. ${b.surface}%` : ""
        ].filter(Boolean).join(" • ");
        return `<tr class="hover:bg-slate-50">
          <td class="px-4 py-3 whitespace-nowrap">${levelBadge(r)}${r.ambiguous ? `<div class="text-[11px] text-amber-700 mt-1">Plusieurs SIAP proches : ${r.secondScore}/100</div>` : ""}</td>
          <td class="px-4 py-3 whitespace-nowrap">${scoreBadge(r.score)}<div class="text-[11px] text-slate-400 mt-1">${r.candidateCount} candidat(s)</div></td>
          <td class="px-4 py-3 min-w-[210px] text-xs">${escapeHtml(r.method)}<br><button class="small-action" data-detail="${r.eval.index}">Preuves / choisir</button></td>
          <td class="px-4 py-3 whitespace-nowrap font-semibold mono">${escapeHtml(formatDistance(r.distance, r.inside))}</td>
          <td class="px-4 py-3 whitespace-nowrap"><span class="font-semibold ${r.parcelRelationRank >= 3 ? "text-green-700" : r.parcelRelationRank ? "text-amber-700" : "text-slate-400"}">${escapeHtml(parcelRelationLabel(r))}</span>${Number.isFinite(r.parcelDistance) && r.parcelDistance>0 ? `<div class="text-[11px] text-slate-400">écart parcelles ~${Math.round(r.parcelDistance)} m</div>` : ""}</td>
          <td class="px-4 py-3 whitespace-nowrap"><div class="font-mono ${r.sirenMatch ? "text-indigo-800 font-bold" : "text-slate-400"}">${escapeHtml(r.eval?.sirenBest?.siren || "—")}</div><div class="text-[11px] ${r.sirenMatch ? "text-green-700 font-semibold" : "text-slate-400"}">${r.sirenMatch ? `= ${escapeHtml(r.siap?.siren || "")}` : "pas de SIREN commun"}</div></td>
          <td class="px-4 py-3 whitespace-nowrap font-medium">${escapeHtml(r.eval?.id || "")}</td>
          <td class="px-4 py-3">${escapeHtml(r.eval?.owner || "")}</td>
          <td class="px-4 py-3">${escapeHtml(r.eval?.operation || "")}<div class="text-[11px] text-slate-400 mt-1">${escapeHtml(r.eval?.cadastreLabel || "")}</div></td>
          <td class="px-4 py-3 whitespace-nowrap font-bold ${r.level !== "unmatched" ? "text-green-800" : "text-slate-500"}">${escapeHtml(r.numeroSiap || r.siap?.id || "")}<div class="text-[11px] text-slate-400">${r.numeroSiap?"Retenu":"Candidat non validé"}</div></td>
          <td class="px-4 py-3 whitespace-nowrap text-center"><span class="inline-flex min-w-8 justify-center px-2 py-1 rounded-lg bg-slate-100 font-semibold">${r.siap?.sourceRowCount || 0}</span></td>
          <td class="px-4 py-3">${escapeHtml(r.siap?.owner || "")}</td>
          <td class="px-4 py-3">${escapeHtml(r.siap?.operation || "")}</td>
          <td class="px-4 py-3">${escapeHtml(r.siap?(P.addresses(r.siap,r.rnbStrongIds).join(' ; ')||r.siap.address):'')}${r.siap?.geo?.label ? `<div class="text-[11px] text-slate-400 mt-1">${escapeHtml(r.siap.geo.label)}</div>` : ""}<div class="text-[11px] mt-1">Rue : <b>${b.street ?? "—"}%</b>${b.houseNumber !== undefined ? ` • N° : <b>${b.houseNumber}%</b>` : ""}</div></td>
          <td class="px-4 py-3 text-xs"><div class="font-semibold">Métier ${r.businessScore}% • Géo ${r.geoScore}%</div><div class="text-slate-500 mt-1 leading-5">${escapeHtml(detail)}</div><div class="text-slate-400 mt-1">Base : ${escapeHtml(shortIds([...r.eval.primaryRnbIds]))}<br>SIAP : ${escapeHtml(shortIds([...(r.siap?.primaryRnbIds||[])]))}<br>Communs : ${escapeHtml(shortIds(r.rnbStrongIds))}</div></td>
        </tr>`;
      }).join("");
    }
    els.resultsBody.querySelectorAll("[data-detail]").forEach(b=>b.addEventListener("click",()=>openDetail(Number(b.dataset.detail))));
    wrap.scrollTop=top;wrap.scrollLeft=left;window.scrollTo({top:pageY,behavior:"instant"});
    els.tableFooter.classList.remove("hidden");
    els.tableFooter.textContent = `${formatNumber(filtered.length)} résultat(s) affiché(s) sur ${formatNumber(results.length)} • tri ${sortState.key} ${sortState.dir === "asc" ? "croissant" : "décroissant"}`;
  }

  function updateStats() {
    const total = results.length;
    els.statSiapRaw.textContent = formatNumber(siapConsolidationStats.raw);
    els.statSiapUnique.textContent = formatNumber(siapConsolidationStats.unique);
    els.statSiapGrouped.textContent = formatNumber(siapConsolidationStats.grouped);
    els.statTotal.textContent = formatNumber(total);
    els.statAuto.textContent = formatNumber(results.filter(r => r.level === "auto").length);
    els.statProbable.textContent = formatNumber(results.filter(r => r.level === "probable").length);
    els.statCandidate.textContent = formatNumber(results.filter(r => r.level === "candidate").length);
    els.statRnb.textContent = formatNumber(results.filter(r => r.rnbStrongIds.length).length);
    els.statParcel.textContent = formatNumber(results.filter(r => r.parcelRelationRank > 0).length);
    els.statSirenMatch.textContent = formatNumber(results.filter(r => r.sirenMatch).length);
    const avg = total ? Math.round(results.reduce((sum,r)=>sum+r.score,0)/total) : 0;
    els.statAverage.textContent = `${avg}/100`;
  }

  function exportResults() {
    if(!results.length)return;
    const rows=results.map(r=>{
      const base={...r.eval.original};
      const add=(key,value)=>{let name=key;while(Object.prototype.hasOwnProperty.call(base,name))name+='_V5';base[name]=value;};
      const fields={NUMERO_SIAP:r.numeroSiap||'',RAPPROCHEMENT_NUMERO_SIAP_CANDIDAT:r.siap?.id||'',RAPPROCHEMENT_NIVEAU:r.level,RAPPROCHEMENT_SCORE_GLOBAL:r.score,RAPPROCHEMENT_METHODE:r.method,RAPPROCHEMENT_AMBIGU:r.ambiguous?'OUI':'NON',RAPPROCHEMENT_VALIDATION_MANUELLE:r.manualDate||'',RAPPROCHEMENT_MOTIFS:(r.reasons||[]).join(' ; '),RAPPROCHEMENT_COMMUNES:r.eval.candidateCityCodes.join(' ; '),RAPPROCHEMENT_PARCELLES:[...r.eval.refPlotIds].join(' ; '),RAPPROCHEMENT_RNB_RETENUS:[...r.eval.primaryRnbIds].join(' ; '),RAPPROCHEMENT_RNB_CANDIDATS:[...r.eval.rnbIds].join(' ; '),RAPPROCHEMENT_RNB_STATUT:r.eval.rnbStatus,RAPPROCHEMENT_ALERTES:[...r.eval.issues,...r.eval.errors].join(' ; '),RAPPROCHEMENT_DISTANCE_M:Number.isFinite(r.distance)?Math.round(r.distance):'',RAPPROCHEMENT_PARCELLE_RELATION:parcelRelationLabel(r),RAPPROCHEMENT_RNB_COMMUNS:r.rnbStrongIds.join(' ; '),RAPPROCHEMENT_SIREN_COMMUN:r.sirenMatch?'OUI':'NON',RAPPROCHEMENT_NB_CANDIDATS:r.candidateCount,RAPPROCHEMENT_SCORE_SECOND:r.secondScore,RAPPROCHEMENT_SIAP_NOM:r.siap?.operation||'',RAPPROCHEMENT_SIAP_MOA:r.siap?.owner||'',RAPPROCHEMENT_SIAP_ADRESSE:r.siap?.address||'',RAPPROCHEMENT_SIAP_LIGNES_SOURCE:r.siap?.sourceRowCount||'',RAPPROCHEMENT_LIGNE_EXCEL:fileMeta.EVAL.rowNumbers?.[r.eval.index]||'',RAPPROCHEMENT_FICHIER:fileMeta.EVAL.name||'',RAPPROCHEMENT_FEUILLE:fileMeta.EVAL.sheet||''};
      Object.assign(fields,{
        RAPPROCHEMENT_RNB_BASE:[...r.eval.primaryRnbIds].join(' ; '),
        RAPPROCHEMENT_RNB_SIAP:[...(r.siap?.primaryRnbIds||[])].join(' ; '),
        RAPPROCHEMENT_RNB_PREUVE_BASE:P.sourceSummary(r.eval),
        RAPPROCHEMENT_RNB_PREUVE_SIAP:r.siap?P.sourceSummary(r.siap):'',
        RAPPROCHEMENT_RNB_RELATION:P.relationLabel(r.rnbComparison),
        RAPPROCHEMENT_RNB_PART_BASE_PCT:r.rnbComparison?.baseCoverage==null?'':Math.round(r.rnbComparison.baseCoverage*100),
        RAPPROCHEMENT_RNB_PART_SIAP_PCT:r.rnbComparison?.siapCoverage==null?'':Math.round(r.rnbComparison.siapCoverage*100),
        RAPPROCHEMENT_SIAP_LIES_RNB:(r.linkedSiapIds||[]).join(' ; '),
        RAPPROCHEMENT_SIAP_ADRESSES_LIEES_RNB:r.siap&&r.rnbStrongIds.length?P.addresses(r.siap,r.rnbStrongIds).join(' ; '):'',
        RAPPROCHEMENT_SIAP_DIAGNOSTIC_RNB:r.siap?.rnbStatus||'',
        RAPPROCHEMENT_SIAP_ALERTES:r.siap?[...r.siap.issues,...r.siap.errors].join(' ; '):''
      });
      for(const [k,v] of Object.entries(fields))add(k,v);
      for(const [k,v] of Object.entries(r.businessDetails||{}))add('RAPPROCHEMENT_SCORE_'+k.toUpperCase(),v);
      return base;
    });
    const wb=XLSX.utils.book_new();
    const append=(name,data)=>{
      const ws=XLSX.utils.json_to_sheet(data.length?data:[{Information:'Aucune ligne'}]);
      ws['!cols']=Object.keys(data[0]||{Information:''}).map(k=>({wch:Math.min(55,Math.max(16,k.length+2))}));
      if(ws['!ref'])ws['!autofilter']={ref:ws['!ref']};XLSX.utils.book_append_sheet(wb,ws,name);
    };
    append('Rapprochement V5',rows);
    append('Associations auto',rows.filter((_,i)=>results[i].level==='auto'));
    append('Validations manuelles',rows.filter((_,i)=>results[i].level==='manual'));
    append('A verifier',rows.filter((_,i)=>!['auto','manual'].includes(results[i].level)));
    append('Diagnostic cadastre RNB',[...evalRows,...siapRows].map(row=>diagnosticExport(row)));
    append('Details RNB',[...evalRows,...siapRows].flatMap(row=>[...row.rnbEvidence].flatMap(([id,evidence])=>evidence.map(e=>({Source:row.sourceType,Identifiant:row.id,ID_RNB:id,Retenu:row.primaryRnbIds.has(id)?'OUI':'NON',Methode:e.source,Parcelle:e.plot||'',Recouvrement:e.cover??'',Distance_m:Number.isFinite(e.distance)?e.distance:'',Statut_RNB:row.rnbBuildings.get(id)?.status||'',ID_actif:row.rnbBuildings.get(id)?.is_active??'',Source_URL:e.url||'',Date:e.date||row.resolvedAt})))));
    append('Candidats SIAP',results.flatMap(r=>r.ranked.map((c,i)=>({Code_interne:r.eval.id,Rang:i+1,NUMERO_SIAP:c.s.id,Nom_SIAP:c.s.operation,Score:c.score,Methode:c.method,RNB_communs:c.rnbMatch.strong.join(' ; '),RNB_candidats_communs:c.rnbMatch.near.join(' ; '),Motifs:c.reasons.join(' ; '),Distance_m:Number.isFinite(c.distance)?Math.round(c.distance):'',SIREN:c.s.siren,Source_lignes:c.s.sourceRowIndexes.map(i=>fileMeta.SIAP.rowNumbers?.[i]||i+2).join(' ; ')}))));
    append('SIAP consolide',siapRows.map(s=>({NUMERO_SIAP:s.id,NB_LIGNES_SOURCE:s.sourceRowCount,LIGNES_EXCEL_SOURCE:s.sourceRowIndexes.map(i=>fileMeta.SIAP.rowNumbers?.[i]||i+2).join(' ; '),NOM_OPERATION:s.operation,MOA:s.owner,SIREN:s.siren,TOTAL_LOGEMENTS:s.totalLogements,TOTAL_BATIMENTS:s.totalBatiments,SURFACE:s.surface,ADRESSES_SOURCE:uniqueJoined(s.sourceRowsOriginal.map(r=>valueAt(r,columns.SIAP.address)),10000),COMMUNES:s.candidateCityCodes.join(' ; '),PARCELLES:[...s.refPlotIds].join(' ; '),RNB_RETENUS:[...s.primaryRnbIds].join(' ; '),ALERTES:[...s.issues,...s.errors].join(' ; ')})));
    append('Comparaison RNB',results.flatMap(r=>r.ranked.filter(c=>c.rnbMatch.strong.length||c.rnbMatch.near.length).map(c=>({
      Code_interne:r.eval.id,Ligne_base:fileMeta.EVAL.rowNumbers?.[r.eval.index]||r.eval.index+2,NUMERO_SIAP:c.s.id,
      RNB_BASE:c.rnbMatch.baseIds.join(' ; '),RNB_SIAP:c.rnbMatch.siapIds.join(' ; '),RNB_COMMUNS_RETENUS:c.rnbMatch.strong.join(' ; '),
      RNB_CANDIDATS_COMMUNS:c.rnbMatch.near.join(' ; '),Relation:P.relationLabel(c.rnbMatch),
      Part_RNB_base_pct:c.rnbMatch.baseCoverage==null?'':Math.round(c.rnbMatch.baseCoverage*100),Part_RNB_SIAP_pct:c.rnbMatch.siapCoverage==null?'':Math.round(c.rnbMatch.siapCoverage*100),
      Origine_base:P.sourceSummary(r.eval,c.rnbMatch.strong),Origine_SIAP:P.sourceSummary(c.s,c.rnbMatch.strong),
      Adresses_SIAP_liees:P.addresses(c.s,[...c.rnbMatch.strong,...c.rnbMatch.near]).join(' ; '),SIAP_validé:r.numeroSiap===c.s.id?'OUI':'NON',
      Alerte:uniqueJoined([...r.reasons,...c.reasons],100)
    }))));
    append('Adresses SIAP RNB',siapRows.flatMap(s=>(s.locations||[]).map((l,i)=>({NUMERO_SIAP:s.id,Localisation:i+1,
      Adresse_source:l.input.address,Ville_source:l.input.city,Code_postal_source:l.input.postal,
      Adresse_reconnue:l.geo?.label||'',Type_geocodage:l.geo?.type||'',Score_geocodage:l.geo?.score??'',Cle_BAN:l.geo?.banId||'',
      RNB_RETENUS:[...l.primaryRnbIds].join(' ; '),RNB_CANDIDATS:[...l.rnbIds].join(' ; '),Origine:P.sourceSummary(l),
      Diagnostic:l.rnbStatus,Alertes:[...l.issues,...l.errors].join(' ; ')
    }))));
    append('SIAP sources',rawSiapRows);
    append('Journal API',engine?.log||[]);
    append('Correspondance colonnes',['SIAP','EVAL'].flatMap(t=>Object.entries(columns[t]).map(([f,col])=>({Source:t,Fichier:fileMeta[t].name||'',Feuille:fileMeta[t].sheet||'',Ligne_entetes:fileMeta[t].headerRow||'',Champ:FIELD_LABELS[f]||f,Colonne:col||''}))));
    append('Methode et sources',[
      {Sujet:'Version',Description:'V5.1 - 30 septembre 2026. Score heuristique /100, non probabiliste.'},
      {Sujet:'Validation',Description:'NUMERO_SIAP rempli uniquement si validation automatique sans ambiguite ou validation manuelle. Sinon seul le candidat est renseigne.'},
      {Sujet:'RNB',Description:'Lien geometrique, non fiscal. Pagination complete. Seuil de recouvrement pour selection automatique : 80%. Les petits recouvrements restent visibles.',URL:'https://rnb-api.beta.gouv.fr/api/alpha/schema/'},
      {Sujet:'Cadastre',Description:'Prefixe conserve dans la cle. Aucune hypothese 000 sans verification.',URL:'https://apicarto.ign.fr/api/doc/cadastre'},
      {Sujet:'Commune',Description:'Code INSEE ou nom exact dans le code postal. Pas de choix arbitraire de commune.',URL:'https://geo.api.gouv.fr/decoupage-administratif/communes'},
      {Sujet:'Comparaison RNB',Description:'Enrichissement des deux fichiers. Tous les RNB candidats sont indexes. Plusieurs SIAP partageant les RNB ou une couverture partielle imposent une validation. Les pourcentages expriment une part des identifiants retenus, jamais une probabilite de correspondance.'},
      {Sujet:'SIAP',Description:'Uniquement le fichier importe. La concordance du batiment ne prouve pas a elle seule le financement ou la tranche SIAP.'},
      {Sujet:'Sources',Description:'Les colonnes originales sont conservees. En cas de collision, les colonnes ajoutees recoivent un suffixe _V5.'}
    ]);
    XLSX.writeFile(wb,`Rapprochement_SIAP_EVOLUTION_V5_1_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.xlsx`);
  }

  function diagnosticExport(row) {
    return {Source:row.sourceType,Identifiant:row.id,Ville:row.city,Code_postal:row.postal,Code_INSEE:row.candidateCityCodes.join(' ; '),Resolution_commune:row.locality.method||'',Parcelles_exactes:[...row.refPlotIds].join(' ; '),Parcelles_candidates:[...row.plotIds].join(' ; '),Statut_cadastre:row.cadastreStatus,ID_RNB_retenus:[...row.primaryRnbIds].join(' ; '),ID_RNB_candidats:[...row.rnbIds].join(' ; '),Diagnostic_RNB:row.rnbStatus,Validation_RNB_manuelle:row.rnbManualDate||'',Alertes:row.issues.join(' ; '),Erreurs_API:row.errors.join(' ; '),Date:row.resolvedAt};
  }

  function updateRunButton() { els.runButton.disabled = running || !rawEvalRows.length; els.runButton.textContent=rawSiapRows.length?"Lancer le rapprochement V5.1":"Identifier les RNB (sans SIAP)"; }
  function setProgress(percent, text) { const p=Math.max(0,Math.min(100,percent)); els.progressBar.style.width=`${p}%`; els.progressPercent.textContent=`${Math.round(p)} %`; if(text) els.progressText.textContent=text; }
  function showError(msg) { els.errorBox.textContent=msg; els.errorBox.classList.remove("hidden"); }
  function clearError() { els.errorBox.classList.add("hidden"); els.errorBox.textContent=""; }
  function formatNumber(v) { return new Intl.NumberFormat("fr-FR").format(v); }
  function escapeHtml(v) { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;"); }
  function nextFrame() { return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve,0))); }

  function renderDiagnostics() {
    const pageY=window.scrollY,box=document.getElementById('diagnosticsSection');box.classList.remove('hidden');
    const q=C.norm(document.getElementById('diagnosticSearch').value);
    const all=[...evalRows,...siapRows],filtered=all.filter(r=>!q||C.norm([r.sourceType,r.id,r.city,r.insee,[...r.plotIds].join(' '),[...r.rnbIds].join(' '),r.rnbStatus].join(' ')).includes(q));
    document.getElementById('diagnosticSummary').textContent=`Base : ${evalRows.filter(r=>r.primaryRnbIds.size).length}/${evalRows.length} lignes avec RNB retenu(s). SIAP : ${siapRows.filter(r=>r.primaryRnbIds.size).length}/${siapRows.length} opérations avec RNB retenu(s). ${results.filter(r=>r.rnbStrongIds.length).length} lignes avec RNB communs. Les candidats non retenus restent consultables.`;
    document.getElementById('diagnosticBody').innerHTML=filtered.map(r=>`<tr>
      <td class="diagnostic-cell"><span class="pill">${r.sourceType==='EVAL'?'\u00c9VOLUTION':'SIAP'}</span><br><b>${escapeHtml(r.id||('Ligne '+(r.index+1)))}</b>${r.sourceType==='EVAL'?`<br><button class="small-action" data-diagnostic="${r.index}">Voir / choisir</button>`:''}</td>
      <td class="diagnostic-cell"><b>${escapeHtml(r.city||'\u2014')}</b><br>${escapeHtml(r.candidateCityCodes.join(' ; ')||'Commune non r\u00e9solue')}<br><small>${escapeHtml(r.locality.method||'')}</small><br><small>${escapeHtml(P.addresses(r).join(' ; ')||r.address||'')}</small></td>
      <td class="diagnostic-cell">${[...r.refPlotIds].map(escapeHtml).join('<br>')||'\u2014'}<br><small>${escapeHtml(r.cadastreStatus)}</small></td>
      <td class="diagnostic-cell"><b>${[...r.primaryRnbIds].map(escapeHtml).join('<br>')||'Aucun ID retenu'}</b><br><small>${r.rnbIds.size} ID candidat(s) au total</small></td>
      <td class="diagnostic-cell"><b>${escapeHtml(r.rnbStatus)}</b>${r.issues.length||r.errors.length?`<div style="color:#92400e;margin-top:6px;font-size:12px">${[...r.issues,...r.errors].map(escapeHtml).join('<br>')}</div>`:''}</td>
    </tr>`).join('')||'<tr><td colspan="5" class="diagnostic-cell">Aucun r\u00e9sultat.</td></tr>';
    document.querySelectorAll('[data-diagnostic]').forEach(b=>b.addEventListener('click',()=>openDetail(+b.dataset.diagnostic)));
    window.scrollTo({top:pageY,behavior:'instant'});
  }

  function openDetail(index) {
    const r=results.find(x=>x.eval.index===index);if(!r)return;
    const row=r.eval,dialog=document.getElementById('detailDialog');
    document.getElementById('detailTitle').textContent=`${row.id||'Ligne '+(index+1)} \u2014 preuves et validation`;
    const html=`<p><b>${escapeHtml(row.operation||'')}</b> \u2014 ${escapeHtml(row.city||'')} ${escapeHtml(row.postal||'')}</p>
      <p style="color:#64748b;font-size:13px;margin-top:8px">L\u2019ID-RNB identifie un b\u00e2timent, pas une op\u00e9ration de financement. V\u00e9rifiez les tranches, dates et ma\u00eetres d\u2019ouvrage avant de valider un SIAP.</p>
      <h3 style="font-size:18px;font-weight:bold;margin:20px 0 8px">1. Commune et parcelles</h3>
      <p>${escapeHtml(row.locality.method||'')} : <b>${escapeHtml(row.insee||'non r\u00e9solue')}</b></p>
      <p>${[...row.plotIds].map(escapeHtml).join(' ; ')||'Aucune parcelle r\u00e9solue'}</p>
      ${row.issues.length||row.errors.length?`<div style="background:#fffbeb;padding:12px;border-radius:8px;margin:10px 0;color:#92400e">${[...row.issues,...row.errors].map(escapeHtml).join('<br>')}</div>`:''}
      <h3 style="font-size:18px;font-weight:bold;margin:20px 0 8px">2. B\u00e2timents RNB (${row.rnbIds.size})</h3>
      <p style="font-size:13px">Tous les candidats sont conserv\u00e9s. Les petits recouvrements et les voisins ne sont pas des preuves suffisantes.</p>
      <table class="audit-table"><thead><tr><th>Retenir</th><th>ID-RNB / statut</th><th>Origine de la preuve</th><th>Recouvrement</th><th>Source</th></tr></thead><tbody>
      ${[...row.rnbBuildings].map(([id,b])=>{
        const evidence=row.rnbEvidence.get(id)||[],cover=row.rnbCover.get(id),isActive=C.active(b);
        return `<tr><td><input type="checkbox" data-rnb-choice="${id}" ${row.primaryRnbIds.has(id)?'checked':''} ${!isActive?'disabled':''}></td><td><b>${escapeHtml(id)}</b><br>${escapeHtml(b.status||'statut non renseign\u00e9')}${!isActive?' \u2014 \u00e9cart\u00e9':''}</td><td>${evidence.map(e=>escapeHtml(e.source+(e.plot?' \u2014 '+e.plot:''))).join('<br>')}</td><td>${Number.isFinite(cover)?Math.round(cover*100)+' %':'\u2014'}</td><td><a href="${C.BASE.rnb}/${id}/?withPlots=1" target="_blank" rel="noopener noreferrer" class="small-action">Fiche API</a></td></tr>`;
      }).join('')||'<tr><td colspan="5">Aucun RNB disponible. V\u00e9rifiez les r\u00e9f\u00e9rences ou les erreurs API.</td></tr>'}
      </tbody></table>
      ${row.rnbIds.size?'<button id="saveRnbChoice" class="small-action">Retenir les ID-RNB coch\u00e9s et recalculer les candidats SIAP</button>':''}
      <h3 style="font-size:18px;font-weight:bold;margin:24px 0 8px">3. Candidats SIAP (${r.ranked.length})</h3>
      <p style="font-size:13px;color:#64748b">${escapeHtml(r.statusLabel)}. Un choix manuel sera dat\u00e9 dans l\u2019export. Les ${r.ranked.length} candidats sont export\u00e9s ; les 30 premiers sont affich\u00e9s ici.</p>
      <table class="audit-table"><thead><tr><th>Num\u00e9ro SIAP</th><th>Op\u00e9ration / MOA / adresse</th><th>Preuves et alertes</th><th>Score</th><th>D\u00e9cision</th></tr></thead><tbody>
      ${r.ranked.slice(0,30).map(c=>`<tr><td><b>${escapeHtml(c.s.id)}</b></td><td>${escapeHtml(c.s.operation)}<br>${escapeHtml(c.s.owner)}<br>${escapeHtml(P.addresses(c.s,c.rnbMatch.strong).join(' ; ')||c.s.address)}<br><small>${c.s.totalLogements??'\u2014'} logements / ${c.s.totalBatiments??'\u2014'} b\u00e2timents</small></td><td>${escapeHtml(c.method)}<br><b>RNB base :</b> ${escapeHtml(c.rnbMatch.baseIds.join(' ; ')||'aucun retenu')}<br><b>RNB SIAP :</b> ${escapeHtml(c.rnbMatch.siapIds.join(' ; ')||'aucun retenu')}<br><b>Communs :</b> ${escapeHtml(c.rnbMatch.strong.join(' ; ')||'aucun retenu')}<br>${escapeHtml(P.relationLabel(c.rnbMatch))}<br><small>Origine SIAP : ${escapeHtml(P.sourceSummary(c.s,c.rnbMatch.strong))}</small><br><small>${escapeHtml(c.reasons.join(' ; '))}</small></td><td><b>${c.score}/100</b></td><td><button class="small-action" data-choose-siap="${escapeHtml(c.s.id)}" ${String(c.s.id).startsWith('SIAP_SANS_ID_')?'disabled':''}>Valider ce SIAP</button></td></tr>`).join('')||'<tr><td colspan="5">Aucun candidat. Le diagnostic RNB reste disponible sans fichier SIAP.</td></tr>'}
      </tbody></table><button id="rejectSiap" class="small-action">Ne valider aucun SIAP pour cette ligne</button>`;
    document.getElementById('detailContent').innerHTML=html;
    document.querySelectorAll('[data-choose-siap]').forEach(b=>b.addEventListener('click',()=>{
      const choice={id:b.dataset.chooseSiap,date:new Date().toISOString()};manualSiap.set(index,choice);applyManualSiap(r,choice);dialog.close();
    }));
    document.getElementById('rejectSiap').addEventListener('click',()=>{const choice={id:'',date:new Date().toISOString()};manualSiap.set(index,choice);applyManualSiap(r,choice);dialog.close();});
    document.getElementById('saveRnbChoice')?.addEventListener('click',async()=>{
      row.primaryRnbIds=new Set([...document.querySelectorAll('[data-rnb-choice]:checked')].map(e=>e.dataset.rnbChoice));row.rnbAddressIds=new Set(row.primaryRnbIds);
      row.rnbManualDate=new Date().toISOString();row.rnbStatus='S\u00e9lection RNB manuelle';row.eligibleAutomatic=false;
      for(const id of row.primaryRnbIds)row.rnbEvidence.get(id).push({source:'manual',url:'',date:row.rnbManualDate});
      manualSiap.delete(index);dialog.close();await matchPreparedRows();openDetail(index);
    });
    if(!dialog.open)dialog.showModal();
  }

  function applyManualSiap(r,choice,refresh=true) {
    const c=r.ranked.find(x=>x.s.id===choice.id);
    r.manualDate=choice.date;r.numeroSiap=c?c.s.id:'';r.level=c?'manual':'unmatched';r.levelRank=c?5:1;
    r.statusLabel=c?'Association valid\u00e9e manuellement':'Aucun SIAP valid\u00e9 (d\u00e9cision manuelle)';
    if(c) {
      Object.assign(r,{siap:c.s,score:c.score,method:c.method,ambiguous:false,reasons:c.reasons,distance:c.distance,inside:c.inside,businessScore:c.businessScore,businessWeight:c.businessWeight,businessDetails:c.businessDetails,geoScore:c.geoScore,
        parcelMatchType:c.parcelMatch.type,parcelDistance:c.parcelMatch.distance,parcelRelationRank:c.parcelMatch.rank,parcelMatchKeys:c.parcelMatch.keys,parcelMatchCount:c.parcelMatch.keys.length,parcelMatchExact:c.parcelMatch.exact,rnbComparison:c.rnbMatch,rnbStrongIds:c.rnbMatch.strong,rnbNearIds:c.rnbMatch.near,rnbNearDistance:c.rnbMatch.minNearDistance,sirenMatch:c.sirenMatch.match,sirenConfidence:c.sirenMatch.confidence});
    }
    if(refresh){renderResults();updateStats();}
  }

  document.getElementById('closeDetail').addEventListener('click',()=>document.getElementById('detailDialog').close());
  document.getElementById('diagnosticSearch').addEventListener('input',renderDiagnostics);

  document.getElementById("stopButton").addEventListener("click",()=>engine?.cancel());
  document.getElementById("statusFilter").insertAdjacentHTML("beforeend",'<option value="manual">Validations manuelles</option>');
  configureDropZone(els.dropSiap, els.fileSiap, "SIAP");
  configureDropZone(els.dropEval, els.fileEval, "EVAL");
  els.runButton.addEventListener("click", runMatching);
  els.exportButton.addEventListener("click", exportResults);
  [els.searchInput, els.minScoreFilter].forEach(el => el.addEventListener("input", renderResults));
  [els.statusFilter, els.evidenceFilter, els.distanceFilter, els.sirenFilter, els.methodFilter].forEach(el => el.addEventListener("change", renderResults));
  document.querySelectorAll("th.sortable").forEach(th => th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortState.key === key) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
    else { sortState.key = key; sortState.dir = ["score","levelRank","parcelRelationRank","sirenMatch","siapSourceRows","businessScore"].includes(key) ? "desc" : "asc"; }
    renderResults();
  }));
  els.resetFilters.addEventListener("click", () => {
    els.searchInput.value = ""; els.statusFilter.value = "all"; els.evidenceFilter.value = "all"; els.distanceFilter.value = "all";
    els.sirenFilter.value = "all"; els.minScoreFilter.value = ""; els.methodFilter.value = "all"; sortState = { key:"score", dir:"desc" }; renderResults();
  });
})();
