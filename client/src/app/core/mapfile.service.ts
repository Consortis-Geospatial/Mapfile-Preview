import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * MapfileService
 * -------------
 * Client wrapper για το backend API.
 *
 * Endpoints που χρησιμοποιούμε:
 * - GET  /api/load
 * - POST /api/validate
 * - POST /api/save
 * - POST /api/format
 * - POST /api/autometadata
 * - POST /api/new            (NEW: create new mapfile from template + update mapserver.conf)
 */

export interface NewMapPayload {
  name?: string;
  alias?: string;
  fileName?: string;
  overwrite?: boolean;

  epsg?: number;
  units?: string;
  size?: [number, number];
  extent?: [number, number, number, number] | string;

  shapePath?: string;
  fontsetPath?: string;
  symbolsetPath?: string;

  title?: string;
  abstract?: string;
  owsOnlineResource?: string;

  wmsSrs?: string;
  wfsSrs?: string;

  /**
   * Extra MapServer MAP-level WEB/METADATA.
   *
   * Keys should be EXACT MapServer metadata keys, e.g.
   * - "ows_title.el"
   * - "ows_title.en"
   * - "ows_abstract.el"
   * - "ows_onlineresource"
   * - "wms_srs", "wfs_srs"
   * - "wms_enable_request", "wfs_enable_request"
   * - "wms_Costume_capabilities", "wfs_Costume_dsid_code", etc.
   */
  metadata?: Record<string, string>;
}

export interface NewMapResponse {
  ok: boolean;
  alias?: string;
  fileName?: string;
  mapPath?: string;
  mapserverConfPath?: string;
  hint?: string;
  conf?: any;
  error?: string;
}

export interface WfsLayerInfo {
  /** MapServer layer NAME */
  name: string;

  /** Human-friendly title, if the backend can provide it (TITLE directive or METADATA). */
  title?: string;

  /** Optional layer TYPE (POLYGON/LINE/POINT/RASTER). */
  type?: string;

  /** Any extra backend-provided fields (metadata, source, etc.). */
  [k: string]: any;
}

export interface WfsLayersResponse {
  ok: boolean;

  /**
   * Backend-specific total:
   * - preferred: total
   * - fallback: count
   * - fallback: layers.length
   */
  total?: number;
  count?: number;

  layers: WfsLayerInfo[];
  error?: string;
}

/**
 * Minimal GeoJSON FeatureCollection typing.
 * (We keep it loose to avoid TS headaches with various backends.)
 */
export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: any[];
  [k: string]: any;
}

export interface MapfilePathsResponse {
  ok: boolean;

  /**
   * Absolute folders suggested by the backend (typically extracted from MS_MAP_PATTERN).
   * The UI can use these as a dropdown for Save As.
   */
  paths: string[];

  mapserverConfPath?: string;
  msMapPattern?: string | null;
  note?: string;
  error?: string;
}


@Injectable({ providedIn: 'root' })
export class MapfileService {
  // Default fallback (can be overridden by assets/config/config.json -> apiURL)
  private API = 'http://localhost:4300/api';

  private cfgInit: Promise<void>;

  /** Expose current API base (useful for components that want to build URLs). */
  get apiBase() {
    return this.API;
  }

  /**
   * Allow the app to set apiURL explicitly (host only, without /api).
   * Also publishes it to globalThis so other components can pick it up.
   */
  setApiURL(apiURL: string) {
    const base = String(apiURL || '').trim().replace(/\/+$/, '');
    if (!base) return;
    this.API = `${base}/api`;
    (globalThis as any).__APP_API_URL = base;
  }

  constructor(private http: HttpClient) {
    // Fast path: if AppComponent already set it, use it immediately.
    const g = (globalThis as any)?.__APP_API_URL;
    if (typeof g === 'string' && g.trim()) {
      this.setApiURL(g);
    }

    // Best-effort: read from assets/config/config.json (fallback stays localhost:4300).
    this.cfgInit = this.loadApiURLFromConfig();
  }

  async ensureConfigLoaded(): Promise<void> {
    try {
      await this.cfgInit;
    } catch { }
  }

  private async loadApiURLFromConfig(): Promise<void> {
    try {
      const cfg: any = await firstValueFrom(this.http.get<any>('assets/config/config.json'));
      const apiURL = cfg?.apiURL;
      if (typeof apiURL === 'string' && apiURL.trim()) {
        this.setApiURL(apiURL);
      }
    } catch { }
  }

  async load() {
    console.debug('[MapfileService] GET /load');
    return firstValueFrom(
      this.http.get<{ ok: boolean; content?: string; path?: string; error?: string }>(`${this.API}/load`)
    );
  }

  async validate(content: string) {
    console.debug('[MapfileService] POST /validate len=', content.length);
    return firstValueFrom(
      this.http.post<{
        ok: boolean;
        success: boolean;
        errors?: { line: number; message: string }[];
        warnings?: { line: number; message: string }[];
        error?: string;
      }>(`${this.API}/validate`, { content })
    );
  }

  async save(content: string) {
    console.debug('[MapfileService] POST /save len=', content.length);
    return firstValueFrom(
      this.http.post<{
        ok: boolean;
        success: boolean;
        path?: string;
        backupPath?: string;
        error?: string;
      }>(`${this.API}/save`, { content })
    );
  }

  async format(content: string, indent = 4) {
    console.debug('[MapfileService] POST /format');
    return firstValueFrom(this.http.post<{ content: string }>(`${this.API}/format`, { content, indent }));
  }

  async autoMetadata(content: string) {
    console.debug('[MapfileService] POST /autometadata');
    return firstValueFrom(
      this.http.post<{ content: string }>(`${this.API}/autometadata`, { content, baseUrl: `${this.API}/wms` })
    );
  }

  /**
   * POST /api/new
   * - δημιουργεί νέο .map από sample template
   * - ενημερώνει mapserver.conf (MAPS block) με alias => path
   */
  async newMap(payload: NewMapPayload) {
    console.debug('[MapfileService] POST /new payload=', payload);
    return firstValueFrom(this.http.post<NewMapResponse>(`${this.API}/new`, payload));
  }

  /**
   * GET /api/mapfile/paths
   * Returns allowed folders (e.g. extracted from MS_MAP_PATTERN).
   */
  async getMapfilePaths() {
    console.debug('[MapfileService] GET /mapfile/paths');
    return firstValueFrom(this.http.get<MapfilePathsResponse>(`${this.API}/mapfile/paths`));
  }
  /**
   * GET /api/layers
   * Returns the available WFS layers for the current map context.
   */
  async getWfsLayers() {
    console.debug('[MapfileService] GET /layers');
    return firstValueFrom(this.http.get<WfsLayersResponse>(`${this.API}/layers`));
  }

  /**
   * GET /api/wfs/geojson
   * Proxy to MapServer WFS GetFeature and return GeoJSON.
   * Required params:
   * - layers: comma-separated layer names
   * - bbox:  minx,miny,maxx,maxy[,CRS]
   */
  async getWfsGeojson(layers: string[] | string, bbox: string) {
    const layerParam = Array.isArray(layers) ? layers.join(',') : String(layers || '');
    console.debug('[MapfileService] GET /wfs/geojson layers=', layerParam, 'bbox=', bbox);

    // Encode query params safely.
    const url = `${this.API}/wfs/geojson?layers=${encodeURIComponent(layerParam)}&bbox=${encodeURIComponent(bbox)}`;
    return firstValueFrom(this.http.get<GeoJsonFeatureCollection>(url));
  }
}
