import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

// NOTE: The UI/Leaflet side works with coordinates in [lon,lat] order.
// In OGC naming this matches CRS:84 (lon/lat). We keep the old naming
// (extent4326) for backwards compatibility in the app.
export type Extent = [number, number, number, number]; // [minx,miny,maxx,maxy] in CRS:84 (lon/lat)

export interface ViewportSnapshot {
    extent4326: Extent;
    zoom?: number;
    updatedAt: number; // epoch ms
}

@Injectable({ providedIn: 'root' })
export class MapViewportService {
    private readonly subject = new BehaviorSubject<ViewportSnapshot | null>(null);
    readonly viewport$ = this.subject.asObservable();

    setExtent4326(extent: Extent, zoom?: number) {
        // normalize
        const e: Extent = [
            Math.min(extent[0], extent[2]),
            Math.min(extent[1], extent[3]),
            Math.max(extent[0], extent[2]),
            Math.max(extent[1], extent[3]),
        ];

        this.subject.next({
            extent4326: e,
            zoom,
            updatedAt: Date.now()
        });
    }

    getSnapshot(): ViewportSnapshot | null {
        return this.subject.value;
    }
}
