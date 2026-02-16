import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MapserverTeacherDialogService } from './mapserver-teacher-dialog.service';
import { Subscription } from 'rxjs';

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  role: ChatRole;
  text: string;
  html: SafeHtml;
  sources?: { pageStart: number; pageEnd: number; rank?: number }[];
  ts: number;
}

@Component({
  selector: 'app-mapserver-teacher-dialog',
  standalone: true,
  templateUrl: './mapserver-teacher-dialog.component.html',
  styleUrls: ['./mapserver-teacher-dialog.component.scss'],
  imports: [CommonModule, FormsModule, TranslateModule]
})
export class MapserverTeacherDialogComponent implements OnInit, OnDestroy {
  private dialog = inject(MapserverTeacherDialogService);
  private sanitizer = inject(DomSanitizer);
  private translate = inject(TranslateService);

  private t(key: string, params?: Record<string, any>): string {
    try {
      return this.translate.instant(key, params);
    } catch {
      return key;
    }
  }

  state$ = this.dialog.state$;

  @ViewChild('scrollEl') private scrollEl?: ElementRef<HTMLDivElement>;

  private getGlobalApiBase(): string | null {
    try {
      if (typeof window === 'undefined') return null;
      const w: any = window as any;
      const v = w.__APP_API_URL || w.__API_URL;
      const s = typeof v === 'string' ? v.trim() : '';
      return s ? s.replace(/\/$/, '') : null;
    } catch {
      return null;
    }
  }

  private async applyConfigApiBaseIfNoLocalOverride(): Promise<void> {
    try {
      if (typeof window === 'undefined') return;
      if (localStorage.getItem('mpTeacher.apiBase')) return;

      const g = this.getGlobalApiBase();
      if (g) {
        this.apiBase = g;
        return;
      }

      const r = await fetch('assets/config/config.json', { cache: 'no-store' });
      if (!r.ok) return;
      const raw = await r.json().catch(() => null);
      const s = typeof raw?.apiURL === 'string' ? String(raw.apiURL).trim() : '';
      if (s) this.apiBase = s.replace(/\/$/, '');
    } catch { }
  }


  /** Gemini API host (per your note: localhost:4300). */
  apiBase = this.loadLocal('mpTeacher.apiBase', this.getGlobalApiBase() || 'http://localhost:4300');

  /** Full path to MapServer.pdf (server-side path). */
  pdfPath = this.loadLocal('mpTeacher.pdfPath', 'C:/Consortis_Projects/MapHelper.pdf');

  draft = '';
  sending = false;

  messages: ChatMessage[] = [];

  private subs = new Subscription();

  ngOnInit(): void {
    void this.applyConfigApiBaseIfNoLocalOverride();
    // Use async translation lookup so the intro message is correct even if the dialog component
    // is instantiated before the i18n files have finished loading.
    this.setIntroMessage();

    // Keep the intro message in sync if the user changes language.
    this.subs.add(
      this.translate.onLangChange.subscribe(() => {
        this.setIntroMessage(true);
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private setIntroMessage(force = false): void {
    this.subs.add(
      this.translate.get('MP_TEACHER.CHAT_INTRO_MD').subscribe((txt) => {
        // Replace only the initial/system intro (do not overwrite an active conversation).
        if (
          force ||
          this.messages.length === 0 ||
          (this.messages.length === 1 && this.messages[0].role === 'assistant')
        ) {
          this.messages = [this.makeMsg('assistant', txt)];
          queueMicrotask(() => this.scrollToBottom());
        }
      })
    );
  }

  // ✅ central helper: keep text + rendered markdown together
  private makeMsg(role: ChatRole, text: string, extra?: Partial<ChatMessage>): ChatMessage {
    const cleanText = String(text || '');
    return {
      role,
      text: cleanText,
      html: this.renderMarkdown(cleanText),
      ts: Date.now(),
      ...extra
    };
  }

  // ✅ markdown -> sanitized HTML -> SafeHtml
  private renderMarkdown(md: string): SafeHtml {
    // marked: GFM + line breaks like chat apps
    const rawHtml = marked.parse(md ?? '', { gfm: true, breaks: true }) as string;

    // DOMPurify: prevent XSS
    const safe = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true }
    });

    // tell Angular it's safe after sanitization
    return this.sanitizer.bypassSecurityTrustHtml(safe);
  }


  close() {
    this.dialog.close();
  }

  onBackdropClick() {
    this.close();
  }

  clearChat() {
    this.messages = [
      this.makeMsg('assistant', this.t('MP_TEACHER.CHAT_RESET_MD'))
    ];
    this.scrollToBottom();
  }

  savePdfPath() {
    const v = (this.pdfPath || '').trim();
    this.pdfPath = v;
    this.saveLocal('mpTeacher.pdfPath', v);
  }

  saveApiBase() {
    const v = (this.apiBase || '').trim() || (this.getGlobalApiBase() || 'http://localhost:4300');
    this.apiBase = v;
    this.saveLocal('mpTeacher.apiBase', v);
  }

  onDraftKeydown(e: KeyboardEvent) {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.send();
    }
  }

  async send() {
    const prompt = (this.draft || '').trim();
    if (!prompt || this.sending) return;

    // Always send pdfPath, so the backend never falls back to "mapserver.pdf" by accident.
    const pdfPath = (this.pdfPath || '').trim() || 'C:/MapHelper.pdf';
    const payload: any = { prompt, pdfPath };

    // persist current inputs
    this.pdfPath = pdfPath;
    this.savePdfPath();
    this.saveApiBase();

    // push user msg
    this.messages.push(this.makeMsg('user', prompt));
    this.draft = '';
    this.sending = true;
    this.scrollToBottom();

    try {
      const resp = await fetch(this.askUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await resp.json().catch(() => ({} as any));

      if (!resp.ok || !json?.ok) {
        const errText = String(json?.error || json?.details || `HTTP ${resp.status}`).trim();
        throw new Error(errText);
      }

      this.messages.push(
        this.makeMsg('assistant', String(json.answer || '').trim(), {
          sources: Array.isArray(json.sources) ? json.sources : undefined
        })
      );
    } catch (err: any) {
      this.messages.push(this.makeMsg('assistant', '❌ ' + (err?.message ? String(err.message) : String(err))));
    } finally {
      this.sending = false;
      this.scrollToBottom();
    }
  }

  /**
   * Download MapServer.pdf via backend.
   *
   * Expectation on the backend:
   *   GET {apiBase}/api/mpTeacher/mapserverTeacher/pdf?pdfPath=<full-path>
   * returning application/pdf (or a file download).
   */
  async downloadPdf() {
    const pdfPath = (this.pdfPath || '').trim() || 'C:/Consortis_Projects/MapHelper.pdf';
    this.pdfPath = pdfPath;
    this.savePdfPath();
    this.saveApiBase();

    const url = new URL(this.pdfUrl);
    url.searchParams.set('pdfPath', pdfPath);

    try {
      const resp = await fetch(url.toString(), { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const blob = await resp.blob();
      const filename =
        this.filenameFromContentDisposition(resp.headers.get('content-disposition')) ||
        this.filenameFromPath(pdfPath) ||
        'MapServer.pdf';

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.click();

      // cleanup later
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (err: any) {
      // last resort: open the URL (helps if server sets Content-Disposition itself)
      try {
        window.open(url.toString(), '_blank', 'noopener');
      } catch { }

      const details = err?.message ? String(err.message) : String(err);

      this.messages.push(
        this.makeMsg('assistant', this.t('MP_TEACHER.ERR_DOWNLOAD_PDF', { details }))
      );
      this.scrollToBottom();
    }
  }

  private get askUrl() {
    return this.joinUrl(this.apiBase || (this.getGlobalApiBase() || 'http://localhost:4300'), '/api/mpTeacher/mapserverTeacher/ask');
  }

  private get pdfUrl() {
    return this.joinUrl(this.apiBase || (this.getGlobalApiBase() || 'http://localhost:4300'), '/api/mpTeacher/mapserverTeacher/pdf');
  }

  private joinUrl(base: string, path: string) {
    return String(base || '').replace(/\/+$/, '') + path;
  }

  private filenameFromPath(p: string) {
    const clean = String(p || '').replace(/\\/g, '/');
    const parts = clean.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }

  private filenameFromContentDisposition(cd: string | null) {
    if (!cd) return null;

    // RFC 5987 / basic filename=
    const m5987 = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (m5987?.[1]) {
      try {
        return decodeURIComponent(m5987[1].trim().replace(/(^"|"$)/g, ''));
      } catch { }
    }

    const m = /filename=([^;]+)/i.exec(cd);
    if (m?.[1]) return m[1].trim().replace(/(^"|"$)/g, '');

    return null;
  }

  private scrollToBottom() {
    // allow DOM to render first
    setTimeout(() => {
      const el = this.scrollEl?.nativeElement;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, 0);
  }

  private loadLocal(key: string, fallback: string) {
    try {
      const v = globalThis?.localStorage?.getItem(key);
      return (v ?? fallback) as string;
    } catch {
      return fallback;
    }
  }

  private saveLocal(key: string, value: string) {
    try {
      globalThis?.localStorage?.setItem(key, value);
    } catch { }
  }
}