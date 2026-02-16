import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { MapfileService } from './mapfile.service';

/**
 * Snapshot of the mapfile that the UI should display.
 *
 * We keep it simple: content + optional path/alias.
 */
export interface MapfileSnapshot {
  content: string;
  alias?: string;
  path?: string;
  /** ISO date string */
  loadedAt: string;
  /** where the content was fetched from */
  source: 'newMapResponse' | 'load' | 'open';
}

export interface HandleNewFileResult {
  /** true when the NEW succeeded (even if loading content needs fallback) */
  ok: boolean;
  /** raw response of POST /new (kept as any because backend shape may evolve) */
  created?: any;
  /** when we managed to fetch the actual content */
  snapshot?: MapfileSnapshot;
  /** user-facing message for failures */
  error?: string;
}

/**
 * HandleNewFileService
 *
 * Fix for: "New mapfile created but UI keeps showing the old one until refresh".
 *
 * Flow:
 * 1) POST /api/new via MapfileService.newMap(payload)
 * 2) Immediately fetch the newly created file content:
 *    - if backend returned content in /new response, use it
 *    - else call /load (if backend automatically switched current map)
 *    - else fallback to /open using the returned mapPath
 * 3) Expose the loaded snapshot via an observable (optional)
 *
 * Usage (AppComponent):
 *   const r = await handleNewFile.createAndLoad(payload);
 *   if (r.snapshot) {
 *     editor.setContent(r.snapshot.content, false);
 *     map.refreshFromMapfile(r.snapshot.content);
 *   }
 */
@Injectable({ providedIn: 'root' })
export class HandleNewFileService {
  private readonly snapshot$ = new BehaviorSubject<MapfileSnapshot | null>(null);

  /** Optional: subscribe if you want global "current mapfile" state */
  readonly currentSnapshot$ = this.snapshot$.asObservable();

  constructor(
    private readonly mapfile: MapfileService,
    private readonly http: HttpClient
  ) {}

  /**
   * Create a new mapfile in the backend, then immediately load its content.
   */
  async createAndLoad(payload: any): Promise<HandleNewFileResult> {
    // 1) Create new map (POST /new)
    const created = await this.mapfile.newMap(payload);

    if (!created?.ok) {
      return {
        ok: false,
        created,
        error: created?.error || 'New map failed.'
      };
    }

    // 2) If backend already returns the content, prefer it.
    const contentFromResp = (created as any)?.content;
    if (typeof contentFromResp === 'string' && contentFromResp.trim().length) {
      const snap: MapfileSnapshot = {
        content: contentFromResp,
        alias: (created as any)?.alias,
        path: (created as any)?.mapPath,
        loadedAt: new Date().toISOString(),
        source: 'newMapResponse'
      };
      this.snapshot$.next(snap);
      return { ok: true, created, snapshot: snap };
    }

    // 3) Try /load (many backends set the "current map" after /new)
    try {
      const loaded = await this.mapfile.load();
      if (loaded?.content) {
        const snap: MapfileSnapshot = {
          content: loaded.content,
          alias: (created as any)?.alias ?? (loaded as any)?.alias,
          path: (created as any)?.mapPath ?? (loaded as any)?.path,
          loadedAt: new Date().toISOString(),
          source: 'load'
        };
        this.snapshot$.next(snap);
        return { ok: true, created, snapshot: snap };
      }
    } catch {
      // ignore and fallback to /open
    }

    // 4) Fallback: /open with mapPath (if available)
    const mapPath = (created as any)?.mapPath;
    const alias = (created as any)?.alias;

    if (typeof mapPath === 'string' && mapPath.trim()) {
      try {
        const openRes = await this.openByPath(mapPath, alias);
        if (openRes?.content) {
          const snap: MapfileSnapshot = {
            content: openRes.content,
            alias: openRes.alias ?? alias,
            path: openRes.path ?? mapPath,
            loadedAt: new Date().toISOString(),
            source: 'open'
          };
          this.snapshot$.next(snap);
          return { ok: true, created, snapshot: snap };
        }
      } catch {
        // handled below
      }
    }

    // 5) NEW succeeded, but we couldn't fetch content (UI can still show a message)
    return {
      ok: true,
      created,
      error:
        'New map created, but the UI could not load its content automatically. Try Open or refresh.'
    };
  }

  /**
   * Low-level helper: call POST /open.
   *
   * NOTE: Backend expects `allias` (typo) based on current AppComponent implementation.
   */
  private async openByPath(path: string, alias?: string): Promise<any> {
    const base = this.getApiBase();
    const url = `${base}/open`;

    return await firstValueFrom(
      this.http.post<any>(url, {
        path,
        allias: alias,
        overwrite: true
      })
    );
  }

  /**
   * Try to discover API base from MapfileService (so we don't hardcode it).
   * Falls back to localhost.
   */
  private getApiBase(): string {
    const m: any = this.mapfile as any;
    const base = m?.apiBase || m?.baseUrl || m?.apiUrl || 'http://localhost:4300/api';
    return String(base).replace(/\/$/, '');
  }
}
