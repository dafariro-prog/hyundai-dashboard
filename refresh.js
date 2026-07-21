#!/usr/bin/env node
/**
 * Refresca data/tracking.json con datos REALES de la vista
 * garnier-436600.Garnier.vw_marketing_daily_campaign, filtrando SOLO las cuentas
 * de Hyundai (todas de Panamá) y cruzándolas con data/homologacion.json
 * (platform||account_name -> {hom:'Hyundai', pais:'Panamá', ag:'Hyundai'}).
 *
 * Cuentas (account_name en la vista), join por platform + account_name:
 *   Meta:        Petroautos
 *   Google Ads:  Hyundai Petroautos, Petroautos
 *   TikTok:      PA_SMB_IMS_Hyundai_
 *   (DV360: no hay cuentas Hyundai)
 *
 * Ventana: TODO el año 2026.
 *
 * Pensado para correr en GitHub Actions (diario) con una Service Account de GCP.
 * Requiere GOOGLE_APPLICATION_CREDENTIALS apuntando al JSON de la SA
 * (o GCP_SA_KEY con el contenido del JSON, que el workflow vuelca a un archivo).
 *
 * Local:  GOOGLE_APPLICATION_CREDENTIALS=./sa.json node refresh.js
 */
const fs = require('fs');
const path = require('path');
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT = process.env.BQ_PROJECT || 'garnier-436600';
const VIEW    = '`garnier-436600.Garnier.vw_marketing_daily_campaign`';
const SINCE   = process.env.SINCE || '2026-01-01';   // toda la data de 2026

const lookup = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'homologacion.json'), 'utf8'));
const accounts = [...new Set(Object.keys(lookup).map(k => k.split('||')[1]))];
const num = v => (v === null || v === undefined || v === '' ? 0 : +v);
const dval = d => (d && d.value) ? d.value : d;  // BigQueryDate -> 'YYYY-MM-DD'

const bq = new BigQuery({ projectId: PROJECT });

const Q_DETALLE = `
  SELECT platform, account_name, campaign_name AS campana,
    COALESCE(objective,'(sin objetivo)') AS objetivo,
    FORMAT_DATE('%Y-%m', date) AS mes,
    MIN(date) inicio, MAX(date) fin, MAX(IF(spend>0,date,NULL)) last_spend,
    ROUND(SUM(spend),2) spend,
    CAST(SUM(impressions) AS INT64) impressions,
    CAST(SUM(clicks) AS INT64) clicks,
    CAST(SUM(reach) AS INT64) reach,
    CAST(SUM(views) AS INT64) views,
    CAST(SUM(engagements) AS INT64) engagements,
    ROUND(SUM(conversions),2) conversions
  FROM ${VIEW}
  WHERE date >= @since
    AND account_name IN UNNEST(@accounts)
  GROUP BY 1,2,3,4,5
  HAVING spend > 0 OR impressions > 0`;

const Q_SERIE = `
  SELECT date, platform, account_name,
    COALESCE(objective,'(sin objetivo)') AS objetivo,
    ROUND(SUM(spend),2) spend,
    CAST(SUM(impressions) AS INT64) impressions,
    CAST(SUM(clicks) AS INT64) clicks,
    CAST(SUM(views) AS INT64) views,
    ROUND(SUM(conversions),2) conversions
  FROM ${VIEW}
  WHERE date >= @since
    AND account_name IN UNNEST(@accounts)
  GROUP BY 1,2,3,4`;

async function run(query) {
  const [rows] = await bq.query({ query, params: { accounts, since: SINCE }, location: 'US' });
  return rows;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// El token OAuth de Google a veces corta la conexión desde runners ("Premature close",
// ECONNRESET, socket hang up). Reintentamos con backoff antes de dar el job por fallido.
async function withRetry(fn, tries = 5) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      console.error(`Intento ${i}/${tries} falló: ${e.message}`);
      if (i < tries) await sleep(2000 * i);
    }
  }
  throw lastErr;
}

// --- Google Analytics 4 (Data API) ---
// Trae tráfico del sitio (sesiones + usuarios) por día usando la MISMA Service Account.
// Requiere:
//   - env GA4_PROPERTY_ID = id numérico de la propiedad GA4 (ej. 456789123)
//   - que la SA tenga rol "Lector" en esa propiedad y la "Google Analytics Data API" habilitada.
// No es fatal: si algo falla, se registra y el refresco de pauta continúa igual.
const GA4_PID = process.env.GA4_PROPERTY_ID || '';
async function fetchGA4() {
  if (!GA4_PID) { console.log('GA4: sin GA4_PROPERTY_ID, se omite tráfico del sitio.'); return null; }
  let client;
  try {
    const { BetaAnalyticsDataClient } = require('@google-analytics/data');
    client = new BetaAnalyticsDataClient();
  } catch (e) {
    console.error('GA4: no se pudo inicializar el cliente (se continúa sin él):', e.message);
    return null;
  }
  const prop = `properties/${GA4_PID}`;
  const FULL = [{ startDate: SINCE, endDate: 'today' }];
  const L30  = [{ startDate: '30daysAgo', endDate: 'today' }];

  // Cada reporte va aislado: si uno falla (métrica/dimensión no disponible en la
  // propiedad), devuelve [] y los demás siguen funcionando.
  async function rep(dims, mets, { ranges = L30, limit = 100000, sortBy = null, byDate = false } = {}) {
    try {
      const req = {
        property: prop, dateRanges: ranges,
        dimensions: dims.map(name => ({ name })),
        metrics: mets.map(name => ({ name })),
        limit,
      };
      if (byDate) req.orderBys = [{ dimension: { dimensionName: 'date' } }];
      else if (sortBy) req.orderBys = [{ metric: { metricName: sortBy }, desc: true }];
      const [r] = await client.runReport(req);
      return (r.rows || []).map(row => {
        const o = {};
        if (byDate) {
          const d = row.dimensionValues[0].value;           // YYYYMMDD
          o.date = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
        } else {
          o.k = row.dimensionValues.map(d => d.value).join(' / ') || '(no definido)';
        }
        mets.forEach((m, i) => { o[m] = num(row.metricValues[i].value); });
        return o;
      });
    } catch (e) {
      console.error(`GA4 [${dims.join('+')}]: ${e.message}`);
      return [];
    }
  }

  // Métricas aditivas (las tasas y promedios se calculan en el front)
  const CORE = ['sessions','totalUsers','newUsers','screenPageViews','engagedSessions','userEngagementDuration'];

  const [rows, canales, fuentes, dispositivos, ciudades, landing, paginas] = await Promise.all([
    rep(['date'], CORE, { ranges: FULL, byDate: true }),
    rep(['sessionDefaultChannelGroup'], ['sessions','totalUsers','engagedSessions','screenPageViews'], { sortBy:'sessions', limit:25 }),
    rep(['sessionSourceMedium'], ['sessions','engagedSessions'], { sortBy:'sessions', limit:15 }),
    rep(['deviceCategory'], ['sessions','totalUsers'], { sortBy:'sessions', limit:10 }),
    rep(['city'], ['sessions'], { sortBy:'sessions', limit:12 }),
    rep(['landingPage'], ['sessions','engagedSessions'], { sortBy:'sessions', limit:15 }),
    rep(['pagePath'], ['screenPageViews','sessions'], { sortBy:'screenPageViews', limit:15 }),
  ]);

  const daily = rows.filter(r => r.date >= SINCE);
  if (!daily.length) { console.error('GA4: no se obtuvieron días de tráfico.'); return null; }
  console.log(`GA4 OK · propiedad ${GA4_PID} · ${daily.length} días · canales ${canales.length} · fuentes ${fuentes.length} · ` +
    `dispositivos ${dispositivos.length} · ciudades ${ciudades.length} · landings ${landing.length} · páginas ${paginas.length}`);
  return {
    property: GA4_PID, updated: new Date().toISOString(),
    ventana_desgloses: 'últimos 30 días',
    rows: daily.map(r => ({
      date: r.date,
      sessions: r.sessions, users: r.totalUsers, newUsers: r.newUsers,
      pageviews: r.screenPageViews, engaged: r.engagedSessions, engTime: r.userEngagementDuration,
    })),
    canales, fuentes, dispositivos, ciudades, landing, paginas,
  };
}

(async () => {
  console.log(`Consultando BigQuery · Hyundai · ${accounts.length} cuentas · desde ${SINCE}…`);
  const [det, ser, ga4] = await Promise.all([
    withRetry(() => run(Q_DETALLE)),
    withRetry(() => run(Q_SERIE)),
    fetchGA4(),
  ]);

  const detalle = [];
  for (const r of det) {
    const h = lookup[r.platform + '||' + r.account_name];
    if (!h) continue;
    detalle.push({
      agencia: h.ag, pais: h.pais, cuenta: h.hom,
      account_name: r.account_name, campana: r.campana || '(sin nombre)', plataforma: r.platform, mes: r.mes,
      objetivo: r.objetivo, inicio: dval(r.inicio), fin: dval(r.fin), last_spend: dval(r.last_spend),
      spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks),
      reach: num(r.reach), views: num(r.views), engagements: num(r.engagements), conversions: num(r.conversions),
    });
  }

  const rows = [];
  for (const r of ser) {
    const h = lookup[r.platform + '||' + r.account_name];
    if (!h) continue;
    rows.push({
      date: dval(r.date), agencia: h.ag, pais: h.pais, cuenta: h.hom, account_name: r.account_name, plataforma: r.platform,
      objetivo: r.objetivo,
      spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks),
      views: num(r.views), conversions: num(r.conversions),
    });
  }

  const out = {
    updated: new Date().toISOString(),
    cliente: 'Hyundai',
    nota: 'Datos reales de BigQuery (cuentas Hyundai · Petroautos, Panamá · todo 2026) · gasto en USD',
    rango: { min: detalle.reduce((m, r) => r.inicio < m ? r.inicio : m, '9999'),
             max: detalle.reduce((m, r) => r.fin > m ? r.fin : m, '0000') },
    rango_serie: { min: rows.reduce((m, r) => r.date < m ? r.date : m, '9999'),
                   max: rows.reduce((m, r) => r.date > m ? r.date : m, '0000') },
    rows, detalle,
    ga4,  // tráfico del sitio (GA4) o null si no está configurado/falló
  };
  fs.writeFileSync(path.join(__dirname, 'data', 'tracking.json'), JSON.stringify(out));
  console.log(`OK · ${detalle.length} campañas · ${rows.length} filas de serie · ` +
    `${new Set(detalle.map(d => d.plataforma)).size} plataformas · GA4 ${ga4 ? ga4.rows.length + ' días' : 'sin datos'}`);
})().catch(e => { console.error('FALLO refresh:', e.message); process.exit(1); });
