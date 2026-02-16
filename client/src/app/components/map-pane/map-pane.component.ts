import { AfterViewInit, Component, Inject, PLATFORM_ID, ElementRef, ViewChild, NgZone, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { EventEmitter, Output } from '@angular/core';
import { MapfileService, GeoJsonFeatureCollection } from '../../core/mapfile.service';
import { MapViewportService } from '../../core/map-viewport.service';



@Component({
  selector: 'app-map-pane',
  standalone: true,
  templateUrl: './map-pane.component.html',
  styleUrls: ['./map-pane.component.scss']
})
export class MapPaneComponent implements AfterViewInit, OnDestroy {
  @Output() mapReady = new EventEmitter<void>();
  @ViewChild('map', { static: true }) mapHost!: ElementRef<HTMLDivElement>;

  private isBrowser: boolean;
  private L!: typeof import('leaflet');
  private map!: import('leaflet').Map;
  private osm!: import('leaflet').TileLayer;
  private wmsBaseUrl = 'http://localhost:4300/api/wms';

  /** Mapfile overlays currently on the map */
  private overlayLayers = new Map<string, import('leaflet').TileLayer.WMS>();

  /** WFS layers rendered as client-side vector tiles (Leaflet.VectorGrid.Slicer) */
  private wfsVectorLayers = new Map<string, any>();

  /** The current WFS selection (layer names). Used for auto-refresh on pan/zoom. */
  private wfsSelectedNames: string[] = [];

  /** If true, we re-fetch WFS GeoJSON on moveend/zoomend so data follows the viewport. */
  private wfsAutoRefresh = true;

  private wfsReloadTimer: any;
  private wfsMoveHandler?: () => void;
  private viewportMoveHandler?: () => void;

  /** Guard: load leaflet.vectorgrid only once */
  private vectorGridLoaded = false;
  /** Custom control that shows layer toggles + legend */
  private widget?: import('leaflet').Control;
  /** Resize observer to keep map sized when split area changes */
  private resizeObs?: ResizeObserver;

  // ---------- Mapfile context (used for WFS bbox projection) ----------

  /** Last mapfile text we parsed (best-effort, used to derive layer CRS/EXTENT). */
  private lastMapfileText: string | null = null;

  /** Layer NAME -> preferred bbox CRS (e.g. 'EPSG:2100'). */
  private layerBboxCrs = new Map<string, string>();

  /** Layer NAME -> EXTENT (minx,miny,maxx,maxy) in the same CRS as layerBboxCrs (best-effort). */
  private layerExtent = new Map<string, [number, number, number, number]>();

  /** Map-level projection, if found (fallback). */
  private mapProjection: string | null = null;

  /** Lazy-loaded proj4 instance (for reprojection from EPSG:4326 to mapfile CRS). */
  private proj4: any | null = null;
  private proj4Tried = false;


  constructor(
    @Inject(PLATFORM_ID) platformId: Object,
    private ngZone: NgZone,
    private mapfileService: MapfileService,
    private viewportSvc: MapViewportService
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowser) return;

    this.L = await import('leaflet');

    // Optional plugin: used for client-side vector tiles from GeoJSON (WFS preview)
    // Requires: npm i leaflet.vectorgrid geojson-vt
    try {
      await import('leaflet.vectorgrid');
      this.vectorGridLoaded = true;
    } catch (e) {
      // Keep app working even if the dependency isn't installed yet.
      console.warn('[MapPane] leaflet.vectorgrid not available. Install leaflet.vectorgrid + geojson-vt for WFS vector tiles.', e);
      this.vectorGridLoaded = false;
    }

    // Defer to next frame so <as-split> finishes measuring
    await new Promise(requestAnimationFrame);

    const el = this.mapHost.nativeElement;
    const L = this.L;

    this.ngZone.runOutsideAngular(() => {
      this.map = L!.map(el, {
        center: [38.246, 21.735], // placeholder center
        zoom: 7,
        zoomControl: true,
        attributionControl: true
      });

      L!.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(this.map!);
    });

    // Publish viewport immediately (so Save works even before the user pans/zooms)
    this.publishViewport();

    // Keep viewport snapshot up-to-date for Save/Save As extent sync
    this.viewportMoveHandler = () => this.publishViewport();
    this.map.on('moveend zoomend', this.viewportMoveHandler as any);

    console.log('[MapPane] AfterViewInit - map created?', !!this.map);

    // Make sure Leaflet knows its real size now
    this.onContainerResized();



    // Observe size changes (split drag, breakpoints)
    this.resizeObs = new ResizeObserver(() => this.onContainerResized());
    this.resizeObs.observe(el);

    this.mapReady.emit();
  }


  /**
   * Publish current Leaflet viewport extent (EPSG:4326) to MapViewportService.
   * This is consumed by ExtentSyncService before Save/Save As.
   */
  private publishViewport() {
    try {
      if (!this.map) return;
      const b = this.map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();

      // EPSG:4326 extent in lon/lat order
      this.viewportSvc.setExtent4326([sw.lng, sw.lat, ne.lng, ne.lat], this.map.getZoom());

      console.log('[MapPane] publishViewport()', {
        extent4326: [sw.lng, sw.lat, ne.lng, ne.lat],
        zoom: this.map.getZoom()
      });
    } catch (e) {
      console.warn('[MapPane] publishViewport failed', e);
    }
  }

  /** Public hook for parent to call when container size/orientation changes */
  onContainerResized() {
    if (!this.map) return;
    // slight delay helps when consecutive layout changes happen
    requestAnimationFrame(() => this.map!.invalidateSize(false));
  }

  ngOnDestroy(): void {
    try { this.resizeObs?.disconnect(); } catch { }
    try { clearTimeout(this.wfsReloadTimer); } catch { }
    try {
      if (this.viewportMoveHandler) {
        this.map?.off('moveend zoomend', this.viewportMoveHandler as any);
        this.viewportMoveHandler = undefined;
      }
      if (this.wfsMoveHandler) {
        this.map?.off('moveend zoomend', this.wfsMoveHandler as any);
        this.wfsMoveHandler = undefined;
      }
    } catch { }
    try { this.map?.remove(); } catch { }
  }

  /** Public API: parse a mapfile, extract LAYER NAMEs, and add as WMS overlays */
  refreshFromMapfile(content: string) {
    // Keep context so WFS bbox can use the layer's CRS/extent.
    this.updateMapfileContext(content);
    const names = this.parseLayerNames(content);
    console.debug('[MapPane] refreshFromMapfile → layer names:', names);
    this.setWmsLayers(names);

  }

  /** Remove all current mapfile overlays (keep base OSM) */
  clearMapfileLayers() {
    console.debug('[MapPane] clearMapfileLayers() removing', this.overlayLayers.size, 'layers');
    for (const l of this.overlayLayers.values()) {
      if (this.map.hasLayer(l)) this.map.removeLayer(l);
    }
    this.overlayLayers.clear();
    this.updateLayerWidget();
  }

  /** Remove all current WFS vector layers (keep base + WMS) */
  clearWfsVectorLayers() {
    // NOTE:
    // We remove both:
    // 1) tracked WFS layers (this.wfsVectorLayers)
    // 2) any "stale" / "ghost" WFS layers that may still be on the map due to overlapping reloads.
    //    (We tag every WFS preview layer we create with __wfsPreview=true.)
    if (!this.map) return;

    console.debug('[MapPane] clearWfsVectorLayers() removing', this.wfsVectorLayers.size, 'layers');

    // Remove tagged layers first (covers stale layers that are no longer in wfsVectorLayers)
    try {
      this.map.eachLayer((l: any) => {
        try {
          if (l && (l as any).__wfsPreview && this.map.hasLayer(l)) {
            this.map.removeLayer(l);
          }
        } catch { }
      });
    } catch { }

    // Remove currently tracked layers
    for (const l of this.wfsVectorLayers.values()) {
      try {
        if (this.map.hasLayer(l)) this.map.removeLayer(l);
      } catch { }
    }

    this.wfsVectorLayers.clear();
    this.updateLayerWidget();
  }

  /**
   * Since this app will typically preview only ONE WFS layer at a time,
   * we provide a strong "remove everything" operation for the UI toggle.
   *
   * Unlike clearWfsVectorLayers(), this keeps the registry intact (so the
   * widget can still show the entry and let you re-enable it).
   */
  private removeAllWfsFromMapKeepRegistry() {
    if (!this.map) return;

    // Remove tagged layers (stale/ghost)
    try {
      this.map.eachLayer((l: any) => {
        try {
          if (l && (l as any).__wfsPreview && this.map.hasLayer(l)) {
            this.map.removeLayer(l);
          }
        } catch { }
      });
    } catch { }

    // Remove tracked layers too
    for (const l of this.wfsVectorLayers.values()) {
      try {
        if (this.map.hasLayer(l)) this.map.removeLayer(l);
      } catch { }
    }

    this.updateLayerWidget();
  }

  /** Add new WMS overlays, one per layer name */
  setWmsLayers(layerNames: string[]) {
    if (!this.map) return;

    // 3) Remove anything already there (OSM stays)
    this.clearMapfileLayers();

    layerNames.forEach(name => {
      const wms = this.L.tileLayer.wms(this.wmsBaseUrl, {
        layers: name,
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        attribution: 'MapServer WMS'
      });
      wms.addTo(this.map);
      this.overlayLayers.set(name, wms);
      console.debug('[MapPane] ➕ Added WMS overlay:', name);
    });

    // Ensure widget exists once we have something to show.
    this.ensureLayerWidget();
    this.updateLayerWidget();
  }

  // ---------- WFS (GeoJSON → Vector Tiles on the client) ----------

  /**
   * Public API: render one or more WFS layers as *client-side vector tiles*.
   *
   * How it works:
   * - Calls backend: GET /api/wfs/geojson?layers=...&bbox=...
   * - Creates Leaflet.VectorGrid.Slicer from the GeoJSON (vector tiles in-memory)
   * - Adds the result to the map
   */
  async previewWfsLayers(layerNames: string[]) {
    if (!this.map) return;

    const names = (layerNames || []).map(String).map(s => s.trim()).filter(Boolean);
    this.wfsSelectedNames = names;

    if (!names.length) {
      this.clearWfsVectorLayers();
      return;
    }

    // If leaflet.vectorgrid isn't installed, we still render GeoJSON as plain Leaflet vectors.
    // (VectorGrid is preferred for large layers, but GeoJSON is zero-dependency.)

    // First load (current viewport)
    await this.reloadWfsVectorLayers();

    // Create widget if needed (so toggles show up)
    this.ensureLayerWidget();
    this.updateLayerWidget();

    // Optional: keep data in sync with viewport
    this.ensureWfsAutoRefreshListener();
  }

  private ensureWfsAutoRefreshListener() {
    if (!this.map) return;

    // Disable listener when auto-refresh is OFF
    if (!this.wfsAutoRefresh) {
      if (this.wfsMoveHandler) {
        try { this.map.off('moveend zoomend', this.wfsMoveHandler as any); } catch { }
        this.wfsMoveHandler = undefined;
      }
      return;
    }

    if (this.wfsMoveHandler) return;

    this.wfsMoveHandler = () => {
      // debounce: avoid spamming the server while user is panning
      clearTimeout(this.wfsReloadTimer);
      this.wfsReloadTimer = setTimeout(() => {
        this.reloadWfsVectorLayers().catch(err => console.error('[MapPane] WFS auto-refresh failed', err));
      }, 250);
    };

    this.map.on('moveend zoomend', this.wfsMoveHandler as any);
  }

  // ---------- Mapfile context parsing (CRS + EXTENT) ----------

  /** Best-effort parse of the mapfile to extract CRS/EXTENT for each LAYER. */
  private updateMapfileContext(content: string) {
    try {
      this.lastMapfileText = content || '';
      this.layerBboxCrs.clear();
      this.layerExtent.clear();
      this.mapProjection = null;

      if (!content) return;

      // --- MAP-level projection (fallback) ---
      const mapBlock = content.match(/\bMAP\b[\s\S]*?\bEND\b\s*#\s*MAP\b/i)?.[0] || '';
      const mapProj = this.extractEpsgFromProjectionBlock(mapBlock);
      if (mapProj) this.mapProjection = mapProj;

      // --- LAYER blocks ---
      // Most Consortis mapfiles end layer blocks with: "END # LAYER".
      const layerBlocks = content.match(/\bLAYER\b[\s\S]*?\bEND\b\s*#\s*LAYER\b/gi) || [];
      for (const block of layerBlocks) {
        const name = this.extractLayerName(block);
        if (!name) continue;

        // Prefer: LAYER PROJECTION -> EPSG
        let crs = this.extractEpsgFromProjectionBlock(block);

        // Fallback: DATA ... srid=XXXX
        if (!crs) {
          const srid = this.extractSrid(block);
          if (srid) crs = `EPSG:${srid}`;
        }

        // Fallback: METADATA "wfs_srs" "EPSG:...."
        if (!crs) {
          const metaCrs = this.extractEpsgFromMetadata(block, 'wfs_srs')
            || this.extractEpsgFromMetadata(block, 'wms_srs');
          if (metaCrs) crs = metaCrs;
        }

        // Final fallback: MAP projection
        if (!crs && this.mapProjection) crs = this.mapProjection;

        if (crs) this.layerBboxCrs.set(name, crs);

        // EXTENT line inside layer (best-effort, usually in layer CRS)
        const ext = this.extractExtent(block);
        if (ext) this.layerExtent.set(name, ext);
      }
    } catch (e) {
      console.warn('[MapPane] Failed to parse mapfile context (CRS/EXTENT).', e);
    }
  }

  private getLayerBboxCrs(layerName: string): string | null {
    return this.layerBboxCrs.get(layerName) || this.mapProjection || null;
  }

  private isValidExtent(ext: [number, number, number, number]) {
    const [minx, miny, maxx, maxy] = ext;
    return [minx, miny, maxx, maxy].every(Number.isFinite) && minx < maxx && miny < maxy;
  }

  private extractLayerName(layerBlock: string): string | null {
    const m = layerBlock.match(/(^|\n)\s*NAME\s+(?:"([^"]+)"|([^\s#]+))/i);
    const v = (m?.[2] || m?.[3] || '').trim();
    return v ? v : null;
  }

  private extractExtent(text: string): [number, number, number, number] | null {
    // Not commented out: avoids matching "#EXTENT ..."
    const m = text.match(/^\s*(?!#)EXTENT\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/im);
    if (!m) return null;
    const nums = m.slice(1, 5).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return null;
    return [nums[0], nums[1], nums[2], nums[3]];
  }

  private extractSrid(text: string): number | null {
    const m = text.match(/\bsrid\s*=\s*(\d+)/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }

  private extractEpsgFromMetadata(text: string, key: string): string | null {
    const re = new RegExp(`\\"${key}\\"\\s*\\"([^\\"]+)\\"`, 'i');
    const m = text.match(re);
    if (!m) return null;
    const val = String(m[1] || '').toUpperCase();
    const epsg = val.match(/EPSG\s*:\s*(\d+)/i)?.[1];
    return epsg ? `EPSG:${epsg}` : null;
  }

  private extractEpsgFromProjectionBlock(text: string): string | null {
    const projBlock = text.match(/\bPROJECTION\b[\s\S]*?\bEND\b\s*#?\s*PROJECTION\b/i)?.[0] || '';
    const epsg = projBlock.match(/EPSG\s*:\s*(\d+)/i)?.[1]
      || projBlock.match(/init\s*=\s*epsg\s*:\s*(\d+)/i)?.[1];
    return epsg ? `EPSG:${epsg}` : null;
  }

  // ---------- Proj4 (client-side reprojection) ----------

  private async ensureProj4(): Promise<boolean> {
    if (this.proj4) return true;
    if (this.proj4Tried) return false;
    this.proj4Tried = true;

    // 1) Try dynamic import (preferred)
    try {
      const mod: any = await import('proj4');
      this.proj4 = (mod?.default || mod);
    } catch (e) {
      // 2) Try global window.proj4 (if the project loads it via <script>)
      try {
        this.proj4 = (globalThis as any)?.proj4 || null;
      } catch { }
    }

    if (!this.proj4) return false;

    // Ensure EPSG:2100 exists (EGSA87 / Greek Grid). This is the most common need here.
    try {
      const has2100 = !!this.proj4?.defs?.('EPSG:2100');
      if (!has2100) {
        // Source: epsg.io/2100 (Proj4 string)
        this.proj4.defs(
          'EPSG:2100',
          '+title=GGRS87 / Greek Grid +proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs'
        );
      }
    } catch { }

    return !!this.proj4;
  }

  // ---------- GeoJSON reprojection for display ----------

  /**
   * Leaflet (and geojson-vt) expect GeoJSON coordinates in WGS84 (EPSG:4326).
   *
   * Our backend may return GeoJSON in the same CRS we used for the WFS bbox
   * (e.g. EPSG:2100). If we render those meter-based coordinates directly,
   * the vectors will appear “far away”.
   *
   * This converts FeatureCollection coordinates from `fromCrs` → `toCrs` (default EPSG:4326).
   */
  private async reprojectGeoJsonForLeaflet(
    fc: GeoJsonFeatureCollection,
    fromCrs: string,
    toCrs: string = 'EPSG:4326'
  ): Promise<GeoJsonFeatureCollection> {
    const from = (fromCrs || '').toUpperCase();
    const to = (toCrs || '').toUpperCase();

    if (!fc || from === to) return fc;

    const ok = await this.ensureProj4();
    if (!ok || !this.proj4) {
      console.warn('[MapPane] proj4 not available → cannot reproject GeoJSON. Vectors may be misplaced.');
      return fc;
    }

    const projectCoord = (xy: [number, number]): [number, number] => {
      try {
        const out = this.proj4(from, to, xy);
        return [out[0], out[1]];
      } catch {
        return xy;
      }
    };

    const isNum = (v: any) => typeof v === 'number' && Number.isFinite(v);

    const walkCoords = (coords: any): any => {
      if (coords == null) return coords;

      // Point: [x,y]
      if (Array.isArray(coords) && coords.length >= 2 && isNum(coords[0]) && isNum(coords[1])) {
        return projectCoord([coords[0], coords[1]]);
      }

      // Nested arrays
      if (Array.isArray(coords)) return coords.map(walkCoords);

      return coords;
    };

    const walkGeometry = (geom: any) => {
      if (!geom) return;

      if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
        geom.geometries.forEach(walkGeometry);
        return;
      }

      if (geom.coordinates) geom.coordinates = walkCoords(geom.coordinates);
    };

    try {
      const features = Array.isArray((fc as any).features) ? (fc as any).features : [];
      for (const f of features) {
        if (f?.geometry) walkGeometry(f.geometry);
      }

      if (Array.isArray((fc as any).bbox)) {
        const bb = (fc as any).bbox;
        if (bb.length >= 4 && bb.every(isNum)) {
          const a = projectCoord([bb[0], bb[1]]);
          const b = projectCoord([bb[2], bb[3]]);
          (fc as any).bbox = [a[0], a[1], b[0], b[1]];
        }
      }
    } catch (e) {
      console.warn('[MapPane] Failed to reproject GeoJSON for Leaflet.', e);
    }

    return fc;
  }

  /**
   * Build the current viewport bbox in the target CRS.
   *
   * Why:
   * - Leaflet works in LatLng (EPSG:4326) coordinates when calling getBounds().
   * - Our backend (/api/wfs/geojson) expects bbox in the *layer CRS* (from the mapfile),
   *   e.g. ... ,EPSG:2100.
   *
   * We reproject SW/NW/NE/SE corners from EPSG:4326 → target EPSG.
   */
  private async buildCurrentBbox(layerName: string): Promise<string> {
    // Leaflet bounds are always LatLng bounds (degrees).
    const b = this.map.getBounds().pad(0.15);

    const target = this.getLayerBboxCrs(layerName) || 'EPSG:4326';

    // Fast path: no projection required.
    if (target.toUpperCase() === 'EPSG:4326') {
      const minx = b.getWest();
      const miny = b.getSouth();
      const maxx = b.getEast();
      const maxy = b.getNorth();
      return `${minx},${miny},${maxx},${maxy},EPSG:4326`;
    }

    const ok = await this.ensureProj4();
    if (!ok || !this.proj4) {
      console.warn('[MapPane] proj4 not available. Falling back to EPSG:4326 bbox. (Install: npm i proj4)');
      const minx = b.getWest();
      const miny = b.getSouth();
      const maxx = b.getEast();
      const maxy = b.getNorth();
      return `${minx},${miny},${maxx},${maxy},EPSG:4326`;
    }

    // Transform 4 corners to be robust against axis flips.
    const corners4326: [number, number][] = [
      [b.getWest(), b.getSouth()], // SW
      [b.getWest(), b.getNorth()], // NW
      [b.getEast(), b.getNorth()], // NE
      [b.getEast(), b.getSouth()]  // SE
    ];

    const cornersT = corners4326.map(([lon, lat]) => {
      // proj4 expects [x,y] = [lon,lat] when source is EPSG:4326
      try { return this.proj4('EPSG:4326', target, [lon, lat]); } catch { return null; }
    }).filter(Boolean) as [number, number][];

    if (!cornersT.length) {
      console.warn('[MapPane] Failed to reproject bbox corners. Falling back to EPSG:4326 bbox.');
      const minx = b.getWest();
      const miny = b.getSouth();
      const maxx = b.getEast();
      const maxy = b.getNorth();
      return `${minx},${miny},${maxx},${maxy},EPSG:4326`;
    }

    let minx = Math.min(...cornersT.map(c => c[0]));
    let miny = Math.min(...cornersT.map(c => c[1]));
    let maxx = Math.max(...cornersT.map(c => c[0]));
    let maxy = Math.max(...cornersT.map(c => c[1]));

    // Optional: clamp to layer extent if mapfile provided one.
    const ext = this.layerExtent.get(layerName);
    if (ext && this.isValidExtent(ext)) {
      minx = Math.max(minx, ext[0]);
      miny = Math.max(miny, ext[1]);
      maxx = Math.min(maxx, ext[2]);
      maxy = Math.min(maxy, ext[3]);
    }

    // Guard against inverted boxes after clamping.
    if (!(Number.isFinite(minx) && Number.isFinite(miny) && Number.isFinite(maxx) && Number.isFinite(maxy)) || minx >= maxx || miny >= maxy) {
      console.warn('[MapPane] Computed bbox is invalid after reprojection/clamp. Falling back to EPSG:4326 bbox.');
      const minx0 = b.getWest();
      const miny0 = b.getSouth();
      const maxx0 = b.getEast();
      const maxy0 = b.getNorth();
      return `${minx0},${miny0},${maxx0},${maxy0},EPSG:4326`;
    }

    // Keep 4 decimals (matches typical EGSA87 precision in logs).
    const f = (n: number) => Number(n.toFixed(4));
    return `${f(minx)},${f(miny)},${f(maxx)},${f(maxy)},${target}`;
  }

  private async reloadWfsVectorLayers() {
    if (!this.map) return;
    const names = this.wfsSelectedNames;
    // If nothing is selected, ensure we don't leave stale layers on the map.
    if (!names?.length) {
      this.clearWfsVectorLayers();
      return;
    }

    // Remove current vector layers (we rebuild them for the new bbox)
    this.clearWfsVectorLayers();

    const hasVectorGrid = !!(this.vectorGridLoaded && (this.L as any)?.vectorGrid?.slicer);

    for (const name of names) {
      // IMPORTANT:
      // The backend expects the bbox to be expressed in the *layer CRS* (from the mapfile).
      // Example: ...bbox=438192.7032,4489622.0436,476344.1884,4509214.5440,EPSG:2100
      const bbox = await this.buildCurrentBbox(name);

      let fc: GeoJsonFeatureCollection;
      try {
        fc = await this.mapfileService.getWfsGeojson([name], bbox);
      } catch (e) {
        console.error('[MapPane] Failed to fetch WFS GeoJSON for layer', name, e);
        continue;
      }

      // The backend GeoJSON may be in the same CRS as the bbox (e.g. EPSG:2100).
      // Leaflet/geojson-vt expect EPSG:4326, so we reproject for display.
      const fromCrs = this.getLayerBboxCrs(name) || 'EPSG:4326';
      if (fromCrs.toUpperCase() !== 'EPSG:4326') {
        fc = await this.reprojectGeoJsonForLeaflet(fc, fromCrs, 'EPSG:4326');
      }

      // If backend returns empty, keep UX consistent (layer toggle still exists)
      const features = Array.isArray((fc as any)?.features) ? (fc as any).features : [];
      console.debug('[MapPane] WFS GeoJSON', name, 'features=', features.length);

      // Preferred: VectorGrid (client-side vector tiles) for performance.
      // Fallback: plain Leaflet GeoJSON vectors (zero extra deps).
      if (hasVectorGrid) {
        // VectorGrid.Slicer expects a FeatureCollection.
        const vg = (this.L as any).vectorGrid.slicer(fc as any, {
          // Slicer uses a single internal layer name by default: "sliced"
          vectorTileLayerStyles: {
            sliced: {
              weight: 1,
              fill: true,
              fillOpacity: 0.2
            }
          },
          interactive: true,
          maxZoom: 20,
          // good defaults for WFS preview
          tolerance: 3,
          extent: 4096
        });

        // Tag so we can always remove WFS preview layers reliably (even if a reload overlaps).
        try { (vg as any).__wfsPreview = true; (vg as any).__wfsName = name; } catch { }

        try { vg.setZIndex?.(500); } catch { }
        vg.addTo(this.map);
        this.wfsVectorLayers.set(name, vg);
        continue;
      }

      // Fallback GeoJSON vectors
      const geo = this.L.geoJSON(fc as any, {
        style: () => ({ weight: 2, fillOpacity: 0.2 }),
        pointToLayer: (_feature: any, latlng: any) => {
          return (this.L as any).circleMarker(latlng, { radius: 5, weight: 2, fillOpacity: 0.6 });
        },
        onEachFeature: (feature: any, layer: any) => {
          // Small popup with properties (helps debugging/inspection)
          const props = feature?.properties || {};
          const keys = Object.keys(props);
          if (!keys.length) return;

          const rows = keys.slice(0, 30).map(k => {
            const v = props[k];
            const safe = (v === null || v === undefined) ? '' : String(v);
            return `<tr><th style="text-align:left; padding:2px 6px; vertical-align:top;">${k}</th><td style="padding:2px 6px;">${safe}</td></tr>`;
          });

          const html = `<div style="max-width:320px; overflow:auto;"><div style="font-size:12px; font-weight:600; margin-bottom:6px;">${name}</div><table style="border-collapse:collapse; font-size:12px;">${rows.join('')}</table></div>`;
          try { layer.bindPopup(html); } catch { }
        }
      });

      // Tag so we can always remove WFS preview layers reliably.
      try { (geo as any).__wfsPreview = true; (geo as any).__wfsName = name; } catch { }

      try { (geo as any).setZIndex?.(500); } catch { }
      geo.addTo(this.map);
      this.wfsVectorLayers.set(name, geo);
    }

    this.updateLayerWidget();
  }

  // ---------- Legend + Toggle widget ----------

  private ensureLayerWidget() {
    if (this.widget) return;

    const L = this.L;
    const self = this;

    this.widget = (this.L.control as any)({ position: 'topright' });
    (this.widget as any).onAdd = function () {
      const div = L.DomUtil.create('div', 'leaflet-control layers-widget');
      div.style.background = 'white';
      div.style.padding = '8px';
      div.style.maxHeight = '240px';
      div.style.overflowY = 'auto';
      div.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';
      div.style.borderRadius = '6px';
      div.style.minWidth = '220px';

      // keep map interactions working
      div.addEventListener('mousedown', e => e.stopPropagation());
      div.addEventListener('dblclick', e => e.stopPropagation());

      (this as any)._container = div;
      self.renderWidget(div);
      return div;
    };
    this.widget?.addTo(this.map);
  }

  private updateLayerWidget() {
    // Create widget lazily only when we actually have something to show.
    if (!this.widget && (this.overlayLayers.size > 0 || this.wfsVectorLayers.size > 0)) {
      this.ensureLayerWidget();
    }
    if (!this.widget) return;
    const container = (this.widget as any)._container as HTMLElement;
    if (container) this.renderWidget(container);
  }

  private renderWidget(container: HTMLElement) {
    container.innerHTML = '<strong>Layers</strong>';
    const list = document?.createElement('div');
    container.appendChild(list);

    // --- WMS section ---
    const wmsHeader = document?.createElement('div');
    wmsHeader.style.marginTop = '6px';
    wmsHeader.style.fontSize = '12px';
    wmsHeader.style.opacity = '0.75';
    wmsHeader.textContent = 'WMS (raster)';
    list.appendChild(wmsHeader);

    for (const [name, layer] of this.overlayLayers) {
      const row = document?.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'auto 1fr';
      row.style.columnGap = '8px';
      row.style.alignItems = 'start';
      row.style.marginTop = '8px';

      // Toggle
      const chk = document?.createElement('input');
      chk.type = 'checkbox';
      chk.checked = this.map.hasLayer(layer);
      chk.addEventListener('change', () => {
        if (chk.checked) {
          layer.addTo(this.map);
          console.debug('[MapPane] 🔛 Toggled ON:', name);
        } else {
          this.map.removeLayer(layer);
          console.debug('[MapPane] 🔇 Toggled OFF:', name);
        }
      });
      row.appendChild(chk);

      // Label + Legend image
      const right = document?.createElement('div');

      const label = document?.createElement('div');
      label.textContent = name;
      label.style.fontSize = '12px';
      label.style.marginBottom = '4px';
      right.appendChild(label);

      const img = document?.createElement('img');
      const legendUrl = `${this.wmsBaseUrl}?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.3.0&SLD_VERSION=1.1.0&FORMAT=image/png&LAYER=${encodeURIComponent(name)}`;
      img.src = legendUrl;
      img.alt = `Legend for ${name}`;
      img.style.maxWidth = '240px';
      img.style.maxHeight = '120px';
      img.style.border = '1px solid #ddd';
      img.style.background = '#fff';
      right.appendChild(img);

      row.appendChild(right);
      list.appendChild(row);
    }

    // --- WFS section ---
    const wfsHeader = document?.createElement('div');
    wfsHeader.style.marginTop = '12px';
    wfsHeader.style.fontSize = '12px';
    wfsHeader.style.opacity = '0.75';
    wfsHeader.textContent = 'WFS (vector layer)';
    list.appendChild(wfsHeader);

    for (const [name, layer] of this.wfsVectorLayers) {
      const row = document?.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'auto 1fr';
      row.style.columnGap = '8px';
      row.style.alignItems = 'start';
      row.style.marginTop = '8px';

      const chk = document?.createElement('input');
      chk.type = 'checkbox';
      chk.checked = this.map.hasLayer(layer);
      chk.addEventListener('change', () => {
        // NOTE:
        // In this UI we expect to preview only ONE WFS layer at a time.
        // Also, overlapping reloads can leave "ghost" WFS layers on the map.
        // So we always remove *all* WFS preview layers when toggling.

        if (chk.checked) {
          // Remove any previously previewed WFS layers first.
          this.removeAllWfsFromMapKeepRegistry();

          // Re-run preview pipeline so the layer is re-fetched for the current viewport.
          // (This will rebuild wfsVectorLayers and re-render the widget.)
          this.previewWfsLayers([name]).catch(err => console.error('[MapPane] WFS toggle ON failed', err));

          console.debug('[MapPane] 🔛 Toggled ON (WFS vector):', name);
          return;
        }

        // OFF: stop auto-refresh and remove ALL WFS layers from the map.
        this.wfsSelectedNames = [];
        if (this.wfsMoveHandler) {
          try { this.map.off('moveend zoomend', this.wfsMoveHandler as any); } catch { }
          this.wfsMoveHandler = undefined;
        }
        this.removeAllWfsFromMapKeepRegistry();
        console.debug('[MapPane] 🔇 Toggled OFF (WFS vector):', name);
      });
      row.appendChild(chk);

      const right = document?.createElement('div');
      const label = document?.createElement('div');
      label.textContent = name;
      label.style.fontSize = '12px';
      label.style.marginBottom = '2px';
      right.appendChild(label);

      const hint = document?.createElement('div');
      hint.textContent = this.vectorGridLoaded ? 'vector tiles' : 'geojson';
      hint.style.fontSize = '11px';
      hint.style.opacity = '0.6';
      right.appendChild(hint);

      row.appendChild(right);
      list.appendChild(row);
    }

    if (this.overlayLayers.size === 0 && this.wfsVectorLayers.size === 0) {
      const empty = document?.createElement('div');
      empty.style.marginTop = '8px';
      empty.textContent = 'No mapfile layers.';
      list.appendChild(empty);
    }
  }

  // ---------- Tiny parser: LAYER ... NAME ... END ----------

  /** Returns NAME values inside LAYER ... END blocks (comments ignored) */
  private parseLayerNames(content: string): string[] {
    if (!content) return [];
    // strip /* */ and # comments
    const noBlock = content.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLine = noBlock.replace(/^[ \t]*#.*$/gm, '');
    // find "LAYER ... NAME <value> ... END"
    const re = /LAYER\b[\s\S]*?NAME\s+("?)([A-Za-z0-9_.:-]+)\1[\s\S]*?END/gi;
    const names = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(noLine))) names.add(m[2]);
    return Array.from(names);
  }
}
