# Tracking de Campañas — Hyundai (Petroautos, Panamá)

Dashboard **standalone** de tracking diario de campañas de pauta de Hyundai (Meta, Google Ads, TikTok),
todas de **Panamá**. Mismo stack y patrón que `tracking_campanas`, adaptado a un solo cliente.

- **Frontend:** `index.html` estático + Chart.js (sin build).
- **Datos:** `data/tracking.json`, generado desde la vista
  `garnier-436600.Garnier.vw_marketing_daily_campaign` (BigQuery), filtrando solo
  `account_name_homologado = 'Hyundai'` y cruzado con `data/homologacion.json` por `platform + account_name`.
- **Auth:** Supabase (correo + contraseña), tabla `permisos` (rol + scope) y módulo `/admin`.
- **Auto-actualización (cloud):** GitHub Actions corre `refresh.js` cada día y commitea la data;
  Vercel redeploya en cada push. Funciona aunque tu PC esté apagado.

## Cuentas incluidas (join por `platform` + `account_name`)

| Plataforma  | account_name                    |
|-------------|---------------------------------|
| Meta        | `Petroautos`                    |
| Google Ads  | `Hyundai Petroautos`, `Petroautos` |
| TikTok      | `PA_SMB_IMS_Hyundai_`           |

*(DV360 no tiene cuentas Hyundai.)* Todas son de Panamá; el gasto viene en **USD**.

## Ver en local
```bash
npm install
npm run serve      # http://localhost:4500
```

## Refrescar la data manualmente
Requiere una Service Account de GCP con acceso a BigQuery:
```bash
GOOGLE_APPLICATION_CREDENTIALS=./sa.json npm run refresh
```

## Puesta en marcha (una sola vez)

1. **GitHub:** repo `hyundai-dashboard` (ya creado) con esta carpeta pusheada.
2. **Vercel:** New Project → importar el repo → Deploy (framework *Other*, sin build).
3. **Service Account en GCP** (proyecto `garnier-436600`):
   - Roles: **BigQuery Data Viewer** + **BigQuery Job User** (para leer y correr consultas).
   - Crear clave JSON → secret de GitHub `GCP_SA_KEY` (contenido completo del JSON).
4. **Supabase:** se reutiliza el proyecto `ioumqovyirtwqjrbseqt` (ver `config.js`).
   - Crear usuarios en Authentication → Users (Auto Confirm).
   - Tabla `permisos` (`email`, `rol`, `agencias` text[], `cuentas` text[]) con RLS.
   - Alta/edición de accesos desde `/admin` (requiere un usuario con `rol='admin'`).

## Workflow
- `.github/workflows/refresh.yml` — 11:00 UTC (06:00 Panamá): consulta BigQuery → `data/tracking.json`.
Se puede lanzar a mano desde la pestaña **Actions** → *Run workflow*.

## Actualizar la homologación
Si cambian los `account_name` de las cuentas Hyundai, edita `data/homologacion.json` a mano
(4 entradas `platform||account_name`) y commitea.

## Notas
- El gasto está en **USD** (no se convierte).
- Estado de campaña: **>5 días sin consumo = Finalizada**, si no Activa.
- La ventana del `refresh.js` es **todo 2026** (`SINCE=2026-01-01`).
- *Este dashboard va sin el agente de recomendaciones (Gemini).* Si quisieras añadirlo después,
  se puede portar `analyze.js` + `analyze.yml` desde `tracking_campanas`.
