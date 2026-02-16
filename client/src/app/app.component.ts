// client/src/app/app.component.ts  (replace whole file)
import { Component, HostListener, ViewChild, AfterViewInit, inject } from '@angular/core';
import { TopMenuComponent } from './components/top-menu/top-menu.component';
import { EditorPaneComponent } from './components/editor-pane/editor-pane.component';
import { MapPaneComponent } from './components/map-pane/map-pane.component';
import { MapfileService } from './core/mapfile.service';
import { HandleNewFileService } from './core/handleNewFile.service';
import { ExtentSyncService } from './core/extent-sync.service';
import { AngularSplitModule } from 'angular-split';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { NewMapDialogComponent } from './components/new-map-dialog/new-map-dialog.component';
import { LayerPickerDialogComponent } from './components/layer-picker-dialog/layer-picker-dialog.component';
import { SaveAsDialogComponent, SaveAsPayload } from './components/save-as-dialog/save-as-dialog.component';
import { OpenMapDialogComponent, OpenMapPayload } from './components/open-map-dialog/open-map-dialog.component';
import { firstValueFrom } from 'rxjs';
import { InfoAlertComponent } from './components/alert-alert/info-alert.component';
import { InfoAlertService } from './components/alert-alert/info-alert.service';
import { MetadataDialogComponent } from './components/metadata-dialog/metadata-dialog.component';
import { SettingsDialogComponent, SettingsDialogResult } from './components/settings-dialog/settings-dialog.component';
import { MapserverTeacherDialogComponent } from './components/mapserver-teacher-dialog/mapserver-teacher-dialog.component';
import { MapserverTeacherDialogService } from './components/mapserver-teacher-dialog/mapserver-teacher-dialog.service';
import { EditorInsertService } from './core/editor-insert.service';
import { TranslateService } from '@ngx-translate/core';

type AppConfig = {
  language: 'el' | 'en';
  theme: 'light' | 'dark';
  use_AI: boolean;
};

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  imports: [AngularSplitModule, TopMenuComponent, EditorPaneComponent, MapPaneComponent, MatDialogModule, InfoAlertComponent, MapserverTeacherDialogComponent]
})
export class AppComponent implements AfterViewInit {
  @ViewChild(EditorPaneComponent) editorPane!: EditorPaneComponent;
  @ViewChild(MapPaneComponent) mapPane!: MapPaneComponent;

  splitDirection: 'horizontal' | 'vertical' = 'horizontal';
  gutterSize = 8;

  private bo = inject(BreakpointObserver);


  private dialog = inject(MatDialog); // Material dialog service (standalone)
  private infoAlert = inject(InfoAlertService);
  private mpTeacherDialog = inject(MapserverTeacherDialogService);
  private translate = inject(TranslateService);

  private t(key: string, params?: Record<string, any>): string {
    try {
      return this.translate.instant(key, params);
    } catch {
      return key;
    }
  }


  private editorInsert = inject(EditorInsertService);

  private appConfig: AppConfig | null = null;

  private coerceLang(v: any): 'el' | 'en' {
    return v === 'en' ? 'en' : 'el';
  }

  private coerceTheme(v: any): 'light' | 'dark' {
    return v === 'dark' ? 'dark' : 'light';
  }

  private async loadAppConfig(): Promise<AppConfig | null> {
    try {
      const r = await fetch('assets/config/config.json', { cache: 'no-store' });
      if (!r.ok) return null;
      const raw = await r.json().catch(() => null);
      if (!raw) return null;

      return {
        language: this.coerceLang((raw as any).language),
        theme: this.coerceTheme((raw as any).theme),
        use_AI: !!(raw as any).use_AI
      };
    } catch {
      return null;
    }
  }

  private async ensureConfigLoaded(): Promise<void> {
    if (this.appConfig) return;
    this.appConfig = await this.loadAppConfig();
  }

  private applyUiSettings(v: Partial<SettingsDialogResult>) {
    try {
      if (v.lang) {
        document.documentElement.lang = v.lang;
        document.documentElement.setAttribute('data-lang', v.lang);
      }
      if (v.theme) {
        document.documentElement.setAttribute('data-theme', v.theme);
      }
    } catch { }
  }

  private async bootstrapUiFromConfigAndStorage(): Promise<void> {
    // 1) Stored settings (if user already chose them)
    const stored = this.getSavedSettingsPreset();

    // 2) Config defaults (if available)
    await this.ensureConfigLoaded();

    const effective: Partial<SettingsDialogResult> = {
      lang: stored.lang ?? (this.appConfig?.language as any),
      theme: stored.theme ?? (this.appConfig?.theme as any)
    };

    // Stored overrides config.
    this.applyUiSettings(effective);

    // Runtime i18n
    try {
      const lang = this.coerceLang(effective.lang ?? this.appConfig?.language ?? 'el');
      this.translate.setDefaultLang(this.coerceLang(this.appConfig?.language ?? 'el'));
      this.translate.use(lang);
    } catch { }
  }

  private getEffectiveSettingsPreset(): Partial<SettingsDialogResult> {
    const stored = this.getSavedSettingsPreset();
    return {
      lang: stored.lang ?? (this.appConfig?.language as any),
      theme: stored.theme ?? (this.appConfig?.theme as any)
    };
  }

  constructor(private mapfileService: MapfileService, private handleNewFileSvc: HandleNewFileService, private extentSync: ExtentSyncService) {
    void this.bootstrapUiFromConfigAndStorage();

    this.bo.observe([Breakpoints.Medium, Breakpoints.Small, Breakpoints.Handset])
      .subscribe(state => {
        const isNarrow = state.matches;
        const newDir: 'horizontal' | 'vertical' = isNarrow ? 'vertical' : 'horizontal';

        // Only mark for update if it actually changed
        const changed = this.splitDirection !== newDir;
        this.splitDirection = newDir;               // <-- ensure assignment
        this.gutterSize = isNarrow ? 10 : 8;

        // Allow DOM to settle (split re-layout), then invalidate Leaflet size
        // Allow DOM to settle, then invalidate Leaflet size
        setTimeout(() => this.mapPane?.onContainerResized(), 0);
      });
  }
  async ngAfterViewInit() {
    await this.loadAndRenderOnStartup();
    //await this.loadInitialFile();
  }

  private mapfileContent: string | null = null;

  private async loadAndRenderOnStartup() {
    try {
      console.debug('[AppComponent] ▶ Load current mapfile');
      const r = await this.mapfileService.load();
      if (r?.content) {
        console.debug('[AppComponent] ✅ mapfile loaded from', r.path);
        this.editorPane.setContent(r.content);     // ✅ use setContent
        this.mapfileContent = r.content;
        //this.mapPane.refreshFromMapfile(r.content);
      } else {
        console.warn('[AppComponent] ⚠ No content returned by /load');
      }
    } catch (e) {
      console.error('[AppComponent] ❌ Error loading mapfile:', e);
    }
  }

  onMapReady() {
    // Always refresh using the editor’s current text (covers both cases)
    const content = this.editorPane.getContent();
    if (content?.length) {
      this.mapPane.refreshFromMapfile(content);
    }
    // Ensure Leaflet sizes correctly after initial render/layout
    setTimeout(() => this.mapPane?.onContainerResized(), 0);
  }

  notifyMapResized() {
    this.mapPane?.onContainerResized();
  }


  // --- Keyboard shortcuts ---
  // Ctrl+S / Cmd+S -> Save (same action as Top Menu > Save).
  // We prevent the browser's default "Save page" behavior.
  @HostListener('window:keydown', ['$event'])
  onGlobalKeydown(e: KeyboardEvent) {
    const key = (e.key || '').toLowerCase();
    const isSave = (e.ctrlKey || e.metaKey) && key === 's';
    if (!isSave) return;

    // If focus is inside Monaco, let Monaco's own Ctrl/Cmd+S binding handle it
    // (see EditorPaneComponent.addCommand).
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('.monaco-editor')) return;

    // Avoid repeating if key is held down
    if ((e as any).repeat) return;

    // If a dialog is open, ignore (optional safety)
    if ((this.dialog as any)?.openDialogs?.length) return;

    e.preventDefault();
    e.stopPropagation();

    if (!this.editorPane) return;
    void this.handleSaveFile();
  }

  private async loadInitialFile() {
    try {
      const resp = await this.mapfileService.load();
      const content = resp?.content ?? '';
      this.editorPane?.setContent(content || '# New mapfile\nMAP\n  NAME "untitled"\nEND\n');
    } catch (e) {
      console.warn('[AppComponent] Failed to load mapfile from backend, using fallback.', e);
      this.editorPane?.setContent('# New mapfile\nMAP\n  NAME "untitled"\nEND\n');
    }
  }


  // --- Menu wiring ---

  /**
   * Preview (WMS) should not silently fail.
   *
   * If the mapfile has parse/validation errors, we surface the full MapServer
   * error text to the user (instead of a generic "See details.").
   */
  async handlePreviewWms() {
    const content = this.editorPane.getContent(); // ✅ use getContent
    console.debug('[AppComponent] ▶ Preview → WMS. Content length:', content?.length ?? 0);

    const ok = await this.validateAndSurface(content, this.t('APP.TITLES.PREVIEW_WMS'));
    if (!ok) return;

    // If MapPane exposes runtime errors (promise/observable/throw), surface them.
    try {
      const maybe = (this.mapPane as any)?.refreshFromMapfile?.(content);

      // Promise-like
      if (maybe && typeof maybe.then === 'function') {
        maybe
          .then((resp: any) => {
            if (resp && resp.success === false) {
              this.infoAlert.error(this.buildBackendErrorText(resp, this.t('APP.TITLES.PREVIEW_WMS_RUNTIME')), this.t('APP.TITLES.PREVIEW'));
            }
          })
          .catch((err: any) => {
            this.infoAlert.error(this.buildBackendErrorText(err, this.t('APP.TITLES.PREVIEW_WMS_RUNTIME')), this.t('APP.TITLES.PREVIEW'));
          });
      }

      // Observable-like
      if (maybe && typeof maybe.subscribe === 'function') {
        maybe.subscribe({
          error: (err: any) => this.infoAlert.error(this.buildBackendErrorText(err, this.t('APP.TITLES.PREVIEW_WMS_RUNTIME')), this.t('APP.TITLES.PREVIEW'))
        });
      }
    } catch (e: any) {
      this.infoAlert.error(this.buildBackendErrorText(e, this.t('APP.TITLES.PREVIEW_WMS_RUNTIME')), this.t('APP.TITLES.PREVIEW'));
    }
  }

  private formatValidationErrors(
    errors: { line: number; message: string; llmParagraph?: string | null }[] | undefined
  ): string {
    if (!errors || errors.length === 0) return this.t('APP.VALIDATION.FAILED_NO_DETAILS');

    // If the backend provided an LLM explanation, show it first, then a divider, then the original error message.
    const hasLlmParagraph = errors.some((e) => !!String((e as any)?.llmParagraph || '').trim());
    const divider = '------------------------------';
    const joiner = hasLlmParagraph ? '\n\n' : '\n';

    const lines = errors.map((e, i) => {
      const rawMsg = String((e as any)?.message || '').replace(/\s+/g, ' ').trim();
      const llm = String((e as any)?.llmParagraph || '').trim();

      if (llm) {
        return `${llm}
${divider}
#${i + 1} (line ${e.line}): ${rawMsg}`;
      }

      // Existing behavior (one line per error)
      return `#${i + 1} (line ${e.line}): ${rawMsg}`;
    });

    return [...lines].join(joiner);
  }

  /**
   * Build a human-readable error string from whatever the backend returned.
   * We support both the structured {errors:[{line,message}]} form and any
   * additional raw fields (error/details/message/stderr/stdout).
   */
  private buildBackendErrorText(resp: any, contextLabel = 'Validation'): string {
    const parts: string[] = [];

    // 1) Structured MapServer parse/validation errors
    const structured = this.formatValidationErrors(resp?.errors);
    if (resp?.errors?.length) parts.push(structured);

    // 2) Optional raw fields (runtime validation, spawnMapserv, etc.)
    const rawCandidates = [
      resp?.error,
      resp?.details,
      resp?.message,
      resp?.stderr,
      resp?.stdout,
      resp?.raw,
      resp?.debug
    ].filter(Boolean);

    if (rawCandidates.length) {
      const raw = rawCandidates
        .map((v: any) => String(v))
        .join('\n')
        .trim();
      if (raw) parts.push(raw);
    }

    // 3) Warnings (if any)
    if (Array.isArray(resp?.warnings) && resp.warnings.length) {
      parts.push([this.t('APP.BACKEND.WARNINGS'), ...resp.warnings.map((w: any) => `- ${String(w)}`)].join('\n'));
    }

    if (parts.length) return parts.join('\n\n');
    return this.t('APP.BACKEND.FAILED_NO_DETAILS', { context: contextLabel });
  }

  /**
   * Validate content and make sure the user sees the full error message.
   * Returns true when validation passes.
   */
  private async validateAndSurface(content: string, contextLabel: string): Promise<boolean> {
    try {
      const v = await this.mapfileService.validate(content);
      console.debug(`[AppComponent] ${contextLabel} -> Validate response:`, v);

      if (!v?.ok) {
        // Network/HTTP failure
        const msg = this.buildBackendErrorText(v, contextLabel);
        console.error(`[AppComponent] ${contextLabel} validate request failed:`, v);
        this.infoAlert.error(msg);
        return false;
      }

      if (v.success) {
        this.editorPane?.clearMarkers?.();
        return true;
      }

      // Validation failed: highlight + show the full MapServer error text
      this.editorPane?.applyValidationMarkers?.(v.errors || []);
      const msg = this.buildBackendErrorText(v, contextLabel);
      console.warn(`[AppComponent] ${contextLabel} validation failed. Details:\n${msg}`);
      this.infoAlert.error(msg);
      return false;
    } catch (e: any) {
      console.error(`[AppComponent] ${contextLabel} validate crashed`, e);
      this.infoAlert.error(this.t('APP.ALERTS.ACTION_FAILED_SEE_CONSOLE', { action: contextLabel }), contextLabel);
      return false;
    }
  }

  onEditorChange(newContent: string) {
    // Optional: live behavior
    // console.debug('[AppComponent] Editor change len=', newContent.length);
  }

  // --- File menu actions (you can flesh these later) ---
  // --- File menu actions ---
  //
  // New:
  // 1) Ανοίγει dialog για συμπλήρωση payload
  // 2) Κάνει POST /api/new μέσω MapfileService
  // 3) Επιστρέφει info (alias/path/hint) και ενημερώνει τον χρήστη
  //
  // ΣΗΜΕΙΩΣΗ:
  // - Το backend γράφει νέο .map στο workspaceDir και ενημερώνει mapserver.conf (MAPS).
  // - Το currentMapPath/currentMapAlias του backend δεν αλλάζει αυτόματα εδώ.
  //   Άρα (προς το παρόν) μετά το "New" μπορεί να χρειαστεί "Open" ή άλλο endpoint
  //   για να φορτώσεις αυτό το νέο αρχείο στον editor.
  // File > New
  // 1) ανοίγει dialog για συμπλήρωση payload
  // 2) κάνει POST /api/new μέσω MapfileService
  // 3) αποθηκεύει preset σε localStorage για γρήγορο επόμενο "New"
  // File > New
  // 1) ανοίγει dialog για συμπλήρωση payload
  // 2) κάνει POST /api/new
  // 3) αποθηκεύει το τελευταίο payload στο localStorage για προ-συμπλήρωση
  async handleNewFile() {
    try {
      const preset = this.getLastNewMapPayload();

      const ref = this.dialog.open(NewMapDialogComponent, {
        width: '560px',
        disableClose: true,
        data: { preset }
      });

      const payload = await firstValueFrom(ref.afterClosed());
      if (!payload) return; // user cancelled

      this.setLastNewMapPayload(payload);

      // ✅ Create + immediately load the actual new mapfile content (no refresh)
      const r = await this.handleNewFileSvc.createAndLoad(payload);

      if (!r.ok) {
        console.error('[AppComponent] New map failed:', r);
        this.infoAlert.error(r?.error || this.t('APP.ALERTS.NEW_MAP_FAILED_SEE_CONSOLE'), this.t('APP.TITLES.NEW_MAP'));
        return;
      }

      // If we managed to fetch the new mapfile content, show it right away
      if (r.snapshot?.content) {
        this.editorPane?.setContent(r.snapshot.content, false);
        this.editorPane?.clearMarkers?.();

        // Refresh map preview immediately using the newly loaded content
        try { this.mapPane?.refreshFromMapfile?.(r.snapshot.content); } catch (_) { }

        this.infoAlert.success(
          this.t('APP.ALERTS.NEW_MAP_CREATED_OPENED', {
            alias: r.snapshot.alias || r.created?.alias || '',
            path: r.snapshot.path || r.created?.mapPath || this.t('APP.COMMON.UNKNOWN')
          }),
          this.t('APP.TITLES.NEW_MAP')
        );
        return;
      }

      // Fallback: NEW succeeded but we couldn't auto-load content
      console.warn('[AppComponent] New map created but content could not be loaded automatically:', r);
      this.infoAlert.info(
        this.t('APP.ALERTS.NEW_MAP_CREATED_NOT_LOADED', { alias: r.created?.alias || '' }),
        this.t('APP.TITLES.NEW_MAP')
      );
    } catch (e) {
      console.error('[AppComponent] 💥 New map request crashed', e);
      this.infoAlert.error(this.t('APP.ALERTS.NEW_MAP_FAILED_SEE_CONSOLE'), this.t('APP.TITLES.NEW_MAP'));
    }
  }

  // File > Quick New (Costume)
  // - opens the same New Map dialog in "quick" mode (only name/alias/fileName/overwrite)
  // - calls POST /api/newQuickCostume
  // - then calls POST /api/open to load the created mapfile content into the editor
  async handleQuickNewCostume() {
    try {
      const preset = this.getLastQuickNewCostumePayload();

      const ref = this.dialog.open(NewMapDialogComponent, {
        width: '560px',
        disableClose: true,
        data: { preset, mode: 'quickCostume' }
      });

      const payload = await firstValueFrom(ref.afterClosed());
      if (!payload) return;

      this.setLastQuickNewCostumePayload(payload);

      const apiBase =
        (this.mapfileService as any).apiBase ||
        (this.mapfileService as any).baseUrl ||
        (this.mapfileService as any).apiUrl ||
        'http://localhost:4300/api';

      const base = String(apiBase).replace(/\/$/, '');
      const url = `${base}/newQuickCostume`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        console.error('[AppComponent] 💥 Quick New failed:', { status: res.status, data });
        this.infoAlert.error(data?.error || this.t('APP.ALERTS.NEW_MAP_FAILED_SEE_CONSOLE'), this.t('APP.TITLES.QUICK_NEW'));
        return;
      }

      // Load content via /open so editor/preview update immediately
      const openUrl = `${base}/open`;
      const openRes = await fetch(openUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: data.mapPath || data.path || payload.fileName || '',
          allias: data.alias || payload.alias || 'Costume',
          overwrite: true
        })
      });

      const openData = await openRes.json().catch(() => ({}));
      if (!openRes.ok || !openData?.success) {
        console.error('[AppComponent] 💥 Quick New open failed:', { status: openRes.status, openData });
        this.infoAlert.error(this.t('APP.ALERTS.OPEN_FAILED_CONSOLE', { details: openData?.error ? `: ${openData.error}` : '' }), this.t('APP.TITLES.QUICK_NEW'));
        return;
      }

      const content = openData.content ?? '';
      this.editorPane?.setContent(content, false);
      this.editorPane?.clearMarkers?.();

      try { this.mapPane?.refreshFromMapfile?.(content); } catch (_) { }

      this.infoAlert.success(
        this.t('APP.ALERTS.NEW_MAP_CREATED_OPENED', { alias: openData.alias || data.alias || '', path: openData.path || data.mapPath || '' }),
        this.t('APP.TITLES.QUICK_NEW')
      );
    } catch (e) {
      console.error('[AppComponent] 💥 Quick New crashed', e);
      this.infoAlert.error(this.t('APP.ALERTS.NEW_MAP_FAILED_SEE_CONSOLE'), this.t('APP.TITLES.QUICK_NEW'));
    }
  }

  async handleOpenFile() {
    try {
      const preset = this.getLastOpenMapPayload();

      const ref = this.dialog.open(OpenMapDialogComponent, {
        width: '560px',
        disableClose: true,
        data: { preset }
      });

      const payload = await firstValueFrom(ref.afterClosed());
      if (!payload) return;

      this.setLastOpenMapPayload(payload);

      const apiBase =
        (this.mapfileService as any).apiBase ||
        (this.mapfileService as any).baseUrl ||
        (this.mapfileService as any).apiUrl ||
        'http://localhost:4300/api';

      const url = `${String(apiBase).replace(/\/$/, '')}/open`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: payload.path,
          allias: payload.allias,
          overwrite: payload.overwrite
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        console.error('[AppComponent] 💥 Open file failed:', { status: res.status, data });
        this.infoAlert.error(this.t('APP.ALERTS.OPEN_FAILED_CONSOLE', { details: data?.error ? `: ${data.error}` : '' }), this.t('APP.TITLES.OPEN'));
        return;
      }

      // backend returns content
      const content = data.content ?? '';
      this.editorPane?.setContent(content, false);
      this.editorPane?.clearMarkers?.();

      // refresh preview
      this.handlePreviewWms();

      this.infoAlert.info(this.t('APP.ALERTS.OPENED_MAP', { alias: data.alias || payload.allias, path: data.path || payload.path }), this.t('APP.TITLES.OPEN'));
    } catch (e) {
      console.error('[AppComponent] 💥 Open file crashed', e);
      this.infoAlert.error(this.t('APP.ALERTS.OPEN_FAILED_SEE_CONSOLE'), this.t('APP.TITLES.OPEN'));
    }
  }

  // --- SAVE (validate first) ---
  async handleSaveFile() {
    let content = this.editorPane.getContent();
    console.debug('handleSaveFile() -- [AppComponent] Save: content length=', content.length);
    console.groupCollapsed('[AppComponent] 💾 Save: sync extents from current viewport');

    console.log('[AppComponent] Save: syncing EXTENT(s) from current viewport before save... ');
    // 0) sync EXTENTs (MAP + LAYER) from current map viewport before validate/save
    let synced = content;
    try {
      synced = await this.extentSync.syncToCurrentViewport(content, { addMissing: true });
    } catch (e) {
      console.warn('[AppComponent] Save: extent sync failed; proceeding without extent update.', e);
    }
    if (synced !== content) {
      console.log('[AppComponent] Save: editor content updated with new EXTENT(s).');
      this.editorPane.setContent(synced, true);
      content = synced;
    } else {
      console.log('[AppComponent] Save: EXTENT(s) not changed.');
    }
    console.groupEnd();


    // 1) validate current editor content (and surface the full MapServer message)
    const ok = await this.validateAndSurface(content, this.t('APP.TITLES.SAVE'));
    if (!ok) return;

    // 2) clear markers and save
    this.editorPane.clearMarkers();

    const s = await this.mapfileService.save(content);
    console.debug('[AppComponent] Save response:', s);

    if (s.ok && s.success) {
      console.log('[AppComponent] ✅ Saved to:', s.path);
      this.infoAlert.success(this.t('APP.ALERTS.SAVED'), this.t('APP.TITLES.SAVE'));
    } else {
      console.error('[AppComponent] 💥 Save failed:', s);
      this.infoAlert.error(this.t('APP.ALERTS.SAVE_FAILED_CONSOLE'), this.t('APP.TITLES.SAVE'));
    }
  }


  // --- SAVE SAMPLE TEMPLATE (validate first) ---
  async handleSaveSample() {
    let content = this.editorPane.getContent();
    console.debug('handleSaveSample() -- [AppComponent] Save as Default: content length=', content.length);
    console.groupCollapsed('[AppComponent] 💾 Save as Default: sync extents from current viewport');

    // 0) sync EXTENTs (MAP + LAYER) from current map viewport before validate/saveSample
    let synced = content;
    try {
      synced = await this.extentSync.syncToCurrentViewport(content, { addMissing: true });
    } catch (e) {
      console.warn('[AppComponent] Save as Default: extent sync failed; proceeding without extent update.', e);
    }
    if (synced !== content) {
      console.log('[AppComponent] Save as Default: editor content updated with new EXTENT(s).');
      this.editorPane.setContent(synced, true);
      content = synced;
    } else {
      console.log('[AppComponent] Save as Default: EXTENT(s) not changed.');
    }
    console.groupEnd();

    const contextLabel = this.t('TOP_MENU.SAVE_SAMPLE');

    // 1) Save as Default does NOT validate (per requirement). We just persist the template via backend.
    // 2) clear markers and call backend
    this.editorPane.clearMarkers();

    const apiBase =
      (this.mapfileService as any).apiBase ||
      (this.mapfileService as any).baseUrl ||
      (this.mapfileService as any).apiUrl ||
      'http://localhost:4300/api';

    const url = `${String(apiBase).replace(/\/$/, '')}/saveSample`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.success) {
      console.error('[AppComponent] 💥 Save as Default failed:', { status: res.status, data });

      // If backend returned structured errors, highlight them
      if (Array.isArray((data as any)?.errors) && (data as any).errors.length) {
        this.editorPane?.applyValidationMarkers?.((data as any).errors);
      }

      const msg = this.buildBackendErrorText(data, contextLabel);
      this.infoAlert.error(msg, contextLabel);
      return;
    }

    // Optional: show warnings
    if (Array.isArray((data as any)?.warnings) && (data as any).warnings.length) {
      const warnText = [this.t('APP.BACKEND.WARNINGS'), ...(data as any).warnings.map((w: any) => `- ${String(w)}`)].join('\n');
      this.infoAlert.info(warnText, contextLabel);
    }

    this.infoAlert.success(this.t('APP.ALERTS.SAVED_AS_DEFAULT'), contextLabel);
  }

  async handleSaveAsFile() {
    try {
      const preset = this.getLastSaveAsPayload();

      const ref = this.dialog.open(SaveAsDialogComponent, {
        width: '560px',
        disableClose: true,
        data: { preset }
      });

      const payload = await firstValueFrom(ref.afterClosed());
      if (!payload) return;

      this.setLastSaveAsPayload(payload);

      // validate current content before saving-as
      let content = this.editorPane.getContent();
      console.groupCollapsed('[AppComponent] 💾 Save As: sync extents from current viewport');

      // 0) sync EXTENTs (MAP + LAYER) from current map viewport before validate/save-as
      let synced = content;
      try {
        synced = await this.extentSync.syncToCurrentViewport(content, { addMissing: true });
      } catch (e) {
        console.warn('[AppComponent] Save As: extent sync failed; proceeding without extent update.', e);
      }
      if (synced !== content) {
        console.log('[AppComponent] Save As: editor content updated with new EXTENT(s).');
        this.editorPane.setContent(synced, true);
        content = synced;
      } else {
        console.log('[AppComponent] Save As: EXTENT(s) not changed.');
      }
      console.groupEnd();


      const ok = await this.validateAndSurface(content, 'Save As');
      if (!ok) return;

      this.editorPane.clearMarkers();

      const apiBase =
        (this.mapfileService as any).apiBase ||
        (this.mapfileService as any).baseUrl ||
        (this.mapfileService as any).apiUrl ||
        'http://localhost:4300/api';

      const url = `${String(apiBase).replace(/\/$/, '')}/save_as`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'geojson' },
        body: JSON.stringify({
          content,
          path: payload.path,
          fileName: payload.fileName,
          allias: payload.allias,
          overwrite: !!payload.overwrite
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        console.error('[AppComponent] 💥 Save As failed:', { status: res.status, data });
        this.infoAlert.error(this.t('APP.ALERTS.SAVE_AS_FAILED_CONSOLE', { details: data?.error ? `: ${data.error}` : '' }), this.t('APP.TITLES.SAVE_AS'));
        return;
      }

      this.infoAlert.success(this.t('APP.ALERTS.SAVED_AS', { alias: data.alias || payload.allias, path: data.path || this.t('APP.COMMON.UNKNOWN') }), this.t('APP.TITLES.SAVE_AS'));

      // Optional: refresh preview since backend switched current map
      // this.handlePreviewWms();
    } catch (e) {
      console.error('[AppComponent] 💥 Save As crashed', e);
      this.infoAlert.error(this.t('APP.ALERTS.SAVE_AS_FAILED_SEE_CONSOLE'), this.t('APP.TITLES.SAVE_AS'));
    }
  }

  // --- VALIDATE (editor content only) ---
  async handleValidate() {
    const content = this.editorPane.getContent();
    console.debug('[AppComponent] Validate: content length=', content.length);

    const ok = await this.validateAndSurface(content, this.t('APP.TITLES.VALIDATE'));
    if (ok) {
      console.log('[AppComponent] ✅ Validation passed.');
      this.infoAlert.success(this.t('APP.ALERTS.VALIDATION_PASSED'), this.t('APP.TITLES.VALIDATE'));
    }
  }


  // --- FORMAT (editor content only) ---
  // -----------------------------
  // LocalStorage helpers (New Map)
  // -----------------------------
  // Αποθηκεύουμε το τελευταίο payload ώστε το dialog να ανοίγει προ-συμπληρωμένο.
  // -----------------------------
  // LocalStorage helpers (Save As)
  // -----------------------------
  private getLastSaveAsPayload(): SaveAsPayload | null {
    try {
      const raw = localStorage.getItem('mapfile.saveas.payload');
      return raw ? (JSON.parse(raw) as SaveAsPayload) : null;
    } catch {
      return null;
    }
  }

  private setLastSaveAsPayload(payload: SaveAsPayload) {
    try {
      localStorage.setItem('mapfile.saveas.payload', JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  // -----------------------------
  // LocalStorage helpers (Open Map)
  // -----------------------------
  private getLastOpenMapPayload(): OpenMapPayload | null {
    try {
      const raw = localStorage.getItem('mapfile.open.payload');
      return raw ? (JSON.parse(raw) as OpenMapPayload) : null;
    } catch {
      return null;
    }
  }

  private setLastOpenMapPayload(payload: OpenMapPayload) {
    try {
      localStorage.setItem('mapfile.open.payload', JSON.stringify(payload));
    } catch {
      // ignore
    }
  }


  private getLastNewMapPayload(): any | null {
    try {
      const raw = localStorage.getItem('mapfile.new.payload');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private setLastNewMapPayload(payload: any) {
    try {
      localStorage.setItem('mapfile.new.payload', JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }

  private getLastQuickNewCostumePayload(): any | null {
    try {
      const raw = localStorage.getItem('mapfile.quick_new_Costume.payload');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private setLastQuickNewCostumePayload(payload: any) {
    try {
      localStorage.setItem('mapfile.quick_new_Costume.payload', JSON.stringify(payload));
    } catch {
      // ignore
    }
  }


  private getIndent(): number {
    const v = Number(localStorage.getItem('mapfile.indent'));
    return Number.isFinite(v) && v > 0 ? v : 4; // default 4
  }
  async handleFormat() {
    const current = this.editorPane?.getContent() ?? '';
    if (!current.trim()) return;

    try {
      const indent = this.getIndent();
      const res = await this.mapfileService.format(current, indent);
      // service returns { content: string }
      const formatted = res?.content ?? '';
      if (formatted) this.editorPane.setContent(formatted, /*preserveCursor*/ true);
    } catch (e) {
      console.error('[AppComponent] Auto-Format failed', e);
      this.infoAlert.error(this.t('APP.ALERTS.FORMAT_FAILED_SEE_CONSOLE'), this.t('APP.TITLES.FORMAT'));
    }
  }

  // Placeholders
  async handleAutoMetadata() {
    const ref = this.dialog.open(MetadataDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      autoFocus: false,
      restoreFocus: true
    });

    const text = await firstValueFrom(ref.afterClosed());
    if (!text) return;

    // Insert into Monaco at the last cursor position (handled by EditorPane)
    this.editorInsert.insert(text);
  }

  /**
     * Preview WFS
     * ----------
     * Client flow (as requested):
     * 1) GET /api/layers
     * 2) total === 1 -> auto-select
     * 3) total  > 1 -> open dialog and select 1+ layers
     * 4) pass selected layers to MapPane for loading
     */
  async handlePreviewWfs() {
    const content = this.editorPane.getContent(); // ✅ use getContent
    console.debug('[AppComponent] ▶ Preview → WFS. Content length:', content?.length ?? 0);

    // Optional but useful: validate the mapfile text before making any WFS calls
    const ok = await this.validateAndSurface(content, this.t('APP.TITLES.PREVIEW_WFS'));
    if (!ok) return;

    // Keep server-side preview in sync (best-effort). Some backends use the last preview map for WFS.
    try { (this.mapPane as any)?.refreshFromMapfile?.(content); } catch (_) { }

    try {
      const r = await this.mapfileService.getWfsLayers();

      if (!r || r.ok === false) {
        console.error('[AppComponent] /wfs/layers failed:', r);
        this.infoAlert.error(r?.error || this.t('APP.ALERTS.WFS_LOAD_FAILED'), this.t('APP.TITLES.PREVIEW_WFS'));
        return;
      }

      const layers = Array.isArray(r.layers) ? r.layers : [];
      const total = Number((r as any).total ?? (r as any).count ?? layers.length);

      if (total <= 0 || layers.length === 0) {
        this.infoAlert.info(this.t('APP.ALERTS.WFS_NO_LAYERS'), this.t('APP.TITLES.PREVIEW_WFS'));
        return;
      }

      let pickedLayers = [layers[0]];

      if (total > 1) {
        const ref = this.dialog.open(LayerPickerDialogComponent, {
          width: '560px',
          disableClose: true,
          data: { layers, total }
        });

        const picked = await firstValueFrom(ref.afterClosed());
        if (!picked) return; // cancelled
        pickedLayers = picked;
      }

      const layerNames = pickedLayers.map((l: any) => String(l?.name || l)).filter(Boolean);
      if (layerNames.length === 0) return;

      // Pass selection to MapPane (best-effort, so we don't break compilation if MapPane doesn't implement it yet).
      const mapPaneAny = this.mapPane as any;

      if (typeof mapPaneAny?.previewWfsLayers === 'function') {
        mapPaneAny.previewWfsLayers(layerNames);
        return;
      }

      // Backwards-compat: if MapPane only supports a single layer method.
      if (typeof mapPaneAny?.previewWfsLayer === 'function') {
        mapPaneAny.previewWfsLayer(layerNames[0]);
        return;
      }
      if (typeof mapPaneAny?.loadWfsLayer === 'function') {
        mapPaneAny.loadWfsLayer(layerNames[0]);
        return;
      }

      // Fallback: just inform the user (so UX is not silent).
      this.infoAlert.info(
        this.t('APP.ALERTS.WFS_SELECTED_FALLBACK', { layers: layerNames.join('\n- ') }),
        this.t('APP.TITLES.PREVIEW_WFS')
      );
    } catch (e: any) {
      console.error('[AppComponent] Preview WFS failed', e);
      this.infoAlert.error(this.buildBackendErrorText(e, this.t('APP.TITLES.PREVIEW_WFS')), this.t('APP.TITLES.PREVIEW'));
    }
  }

  private getSavedSettingsPreset(): Partial<SettingsDialogResult> {
    try {
      const langRaw = globalThis?.localStorage?.getItem('app.lang');
      const themeRaw = globalThis?.localStorage?.getItem('app.theme');

      const preset: Partial<SettingsDialogResult> = {};
      if (langRaw === 'el' || langRaw === 'en') preset.lang = langRaw;
      if (themeRaw === 'light' || themeRaw === 'dark') preset.theme = themeRaw;

      return preset;
    } catch {
      return {};
    }
  }

  private applySavedUiSettings() {
    // Only apply if the user has chosen something before.
    // This keeps OS-based auto theme working when there is no stored preference.
    try {
      const preset = this.getSavedSettingsPreset();

      if (preset.lang) {
        document.documentElement.lang = preset.lang;
        document.documentElement.setAttribute('data-lang', preset.lang);
      }

      if (preset.theme) {
        document.documentElement.setAttribute('data-theme', preset.theme);
      }
    } catch { }
  }

  handlePreviewCgi() { console.log('[AppComponent] Preview CGI (not implemented)'); }

  handleOpenTeacher() {
    this.mpTeacherDialog.open();
  }
  async handleOpenSettings() {
    try {
      await this.ensureConfigLoaded();
      const preset = this.getEffectiveSettingsPreset();

      const ref = this.dialog.open(SettingsDialogComponent, {
        width: '560px',
        disableClose: false,
        data: { preset, persist: true }
      });

      const result = await firstValueFrom(ref.afterClosed());
      if (!result) return; // cancelled

      const langLabel = this.t(result.lang === 'el' ? 'SETTINGS.LANG_EL' : 'SETTINGS.LANG_EN');
      const themeLabel = this.t(result.theme === 'dark' ? 'SETTINGS.THEME_DARK' : 'SETTINGS.THEME_LIGHT');
      this.infoAlert.success(this.t('APP.ALERTS.SETTINGS_SAVED', { lang: langLabel, theme: themeLabel }), this.t('APP.TITLES.SETTINGS'));
    } catch (e: any) {
      console.error('[AppComponent] Open Settings failed', e);
      this.infoAlert.error(this.buildBackendErrorText(e, this.t('APP.TITLES.SETTINGS')), this.t('APP.TITLES.SETTINGS'));
    }
  }
}