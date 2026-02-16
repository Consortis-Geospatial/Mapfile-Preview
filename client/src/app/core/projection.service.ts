import { Injectable } from '@angular/core';
import type { Extent } from './map-viewport.service';

/**
 * ProjectionService
 * - Lazy-load proj4
 * - Provide extent reprojection (4 corners -> min/max)
 */
@Injectable({ providedIn: 'root' })
export class ProjectionService {
    private proj4: any | null = null;
    private tried = false;

    /**
     * Projection definitions (proj4 strings)
     * -----------------------------------
     * We keep these in ONE place so the app always uses the same definitions
     * for reprojection (extent sync, bbox building, WFS/WMS helpers, etc.).
     *
     * IMPORTANT (CRS:84 vs EPSG:4326 axis order):
     * - Leaflet (and most client code) works with coordinates in [lon,lat].
     * - In OGC services (WMS 1.3.0), EPSG:4326 is commonly treated as [lat,lon],
     *   while CRS:84 is explicitly [lon,lat].
     * - proj4 itself always expects [x,y] = [lon,lat] for geographic CRS.
     *
     * So for coordinate TRANSFORMS we define CRS:84 explicitly and we do NOT
     * auto-alias it to EPSG:4326.
     */
    private static readonly DEF_EPSG_2100 =
        '+title=GGRS87 / Greek Grid +proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs';

    private static readonly DEF_CRS_84 = '+proj=longlat +datum=WGS84 +no_defs';

    private async ensureProj4(): Promise<any | null> {
        if (this.proj4) return this.proj4;
        if (this.tried) return this.proj4;
        this.tried = true;

        try {
            const mod: any = await import('proj4');
            this.proj4 = (mod?.default || mod);
        } catch {
            // optional global fallback
            this.proj4 = (globalThis as any)?.proj4 || null;
        }

        if (!this.proj4) return null;

        // Ensure EPSG:2100 exists (GGRS87 / Greek Grid)
        try {
            // We set it unconditionally so we don't depend on whatever defs are preloaded.
            this.proj4.defs('EPSG:2100', ProjectionService.DEF_EPSG_2100);
        } catch { /* ignore */ }


        // Make sure EPSG:3857 exists (Web Mercator)
        try {
            const has3857 = !!this.proj4?.defs?.('EPSG:3857');
            if (!has3857) {
                this.proj4.defs(
                    'EPSG:3857',
                    '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs +type=crs'
                );
            }
        } catch { /* ignore */ }

        // Ensure CRS:84 exists (WGS84 lon/lat, axis order like Leaflet)
        try {
            // Same: set unconditionally to the exact definition we want.
            this.proj4.defs('CRS:84', ProjectionService.DEF_CRS_84);
        } catch { /* ignore */ }


        return this.proj4;
    }

    async projectPoint(fromCrs: string, toCrs: string, xy: [number, number]): Promise<[number, number]> {
        const norm = (v: string) => {
            const u = String(v || '').toUpperCase();
            return u;
        };

        const from = norm(fromCrs);

        const to = norm(toCrs);
        if (!from || !to || from === to) return xy;

        const p = await this.ensureProj4();
        if (!p) return xy;

        try {
            const out = p(from, to, xy);
            return [out[0], out[1]];
        } catch (err) {
            console.warn(`[ProjectionService] projectPoint failed ${from} -> ${to}`, { xy, err });
            return xy;
        }
    }

    async projectExtent(extent: Extent, fromCrs: string, toCrs: string): Promise<Extent> {
        const norm = (v: string) => {
            const u = String(v || '').toUpperCase();
            return u;
        };

        const from = norm(fromCrs);

        const to = norm(toCrs);
        if (!from || !to || from === to) return extent;

        const [minx, miny, maxx, maxy] = extent;
        const corners: [number, number][] = [
            [minx, miny],
            [minx, maxy],
            [maxx, miny],
            [maxx, maxy],
        ];

        const pts = await Promise.all(corners.map(c => this.projectPoint(from, to, c)));
        const xs = pts.map(p => p[0]);
        const ys = pts.map(p => p[1]);

        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
}
