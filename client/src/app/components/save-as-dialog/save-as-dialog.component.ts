import { Component, inject } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';

import { MapfileService } from '../../core/mapfile.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

/**
 * Dialog: payload για POST /api/save_as
 *
 * Διαφορά σε σχέση με το "Save":
 * - Δέχεται επιπλέον ορίσματα: path, fileName, allias
 * - (optional) overwrite
 *
 * NOTE: Το backend έχει δικό του safety check για path traversal.
 * Εδώ κάνουμε μόνο "φιλική" προ-κανονικοποίηση ώστε ο χρήστης να μην στέλνει περίεργες τιμές.
 */
export type SaveAsPayload = {
  /** Optional folder (absolute or relative). Must be under backend workspaceDir. */
  path?: string;
  fileName: string;
  allias: string; // (σκόπιμα ίδιο όνομα με backend)
  overwrite?: boolean;
};

type SaveAsDialogData = {
  preset?: Partial<SaveAsPayload>;
  /** Optional: preloaded options (if caller already fetched them). */
  paths?: string[];
};

@Component({
  selector: 'app-save-as-dialog',
  standalone: true,
  templateUrl: './save-as-dialog.component.html',
  styleUrls: ['./save-as-dialog.component.scss'],
  imports: [
    
    TranslateModule,
NgIf,
    NgFor,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    ReactiveFormsModule
  ]
})
export class SaveAsDialogComponent {
  private fb = inject(FormBuilder);
  private ref = inject(MatDialogRef<SaveAsDialogComponent>);
  private translate = inject(TranslateService);
  private data = inject(MAT_DIALOG_DATA) as SaveAsDialogData | null;

  private mapfile = inject(MapfileService);

  pathsLoading = false;
  pathsError: string | null = null;

  /** Dropdown options (absolute or relative folders). */
  pathOptions: string[] = [];

  form = this.fb.group({
    allias: ['', [Validators.required]],
    fileName: ['', [Validators.required]],
    path: [''], // dropdown selected value ('' => default)
    overwrite: [false]
  });

  constructor() {
    const preset = this.data?.preset ?? {};
    if (preset) {
      this.form.patchValue({
        allias: (preset.allias as any) ?? '',
        fileName: (preset.fileName as any) ?? '',
        path: (preset.path as any) ?? '',
        overwrite: !!preset.overwrite
      });
    }

    // Make sure preset/current selection stays visible.
    this.rebuildPathOptions(this.data?.paths ?? []);

    // Load allowed paths from backend (if caller didn't preload them).
    if (!this.data?.paths?.length) {
      this.loadPaths();
    }
  }

  cancel() {
    this.ref.close(null);
  }

  /** convert name -> SAFE_ALIAS (same idea as server) */
  private toSafeAlias(v: string) {
    return String(v || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private toSafeFileName(v: string) {
    const base = String(v || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!base) return '';
    return base.toLowerCase().endsWith('.map') ? base : `${base}.map`;
  }

  /**
   * Safe-ish path (absolute OR relative).
   * - normalize separators
   * - remove trailing separators
   * - block ".."
   * - for relative: remove leading "/"
   *
   * Backend still enforces "under workspaceDir".
   */

  private toSafePath(v: string) {
    const raw = String(v || '').trim();
    if (!raw) return '';

    const bs = String.fromCharCode(92); // backslash character

    // Normalize to forward slashes for parsing.
    let p = raw.split(bs).join('/').replace(/\/+/g, '/');
    p = p.replace(/\/+$/g, '');

    // Block obvious traversal (backend does strict check too).
    if (p.split('/').some(seg => seg === '..')) return '';

    const isWindowsAbs = /^[A-Za-z]:\//.test(p);
    const isAbs = p.startsWith('/') || isWindowsAbs;

    if (!isAbs) {
      return p.replace(/^\/+/, '');
    }

    // Restore backslashes for Windows absolute paths.
    if (isWindowsAbs) return p.split('/').join(bs);
    return p;
  }


  private async loadPaths() {
    this.pathsLoading = true;
    this.pathsError = null;

    try {
      const r = await this.mapfile.getMapfilePaths();
      if (r?.ok && Array.isArray(r.paths)) {
        this.rebuildPathOptions(r.paths);
      } else {
        this.pathsError = r?.error || this.translate.instant('SAVE_AS.ERR_LOAD_PATHS');
        this.rebuildPathOptions([]);
      }
    } catch (e: any) {
      this.pathsError = e?.message || this.translate.instant('SAVE_AS.ERR_LOAD_PATHS');
      this.rebuildPathOptions([]);
    } finally {
      this.pathsLoading = false;
    }
  }

  /** Ensure dropdown includes: (preset/current selection) + backend-provided options */
  private rebuildPathOptions(incoming: string[]) {
    const selected = String(this.form.get('path')?.value || '').trim();
    const preset = String((this.data?.preset?.path as any) || '').trim();

    const set = new Set<string>();
    if (selected) set.add(selected);
    if (preset) set.add(preset);

    for (const p of incoming || []) {
      const v = String(p || '').trim();
      if (v) set.add(v);
    }

    this.pathOptions = Array.from(set);
  }

  submit() {
    if (this.form.invalid) return;

    const v = this.form.getRawValue();

    const allias = this.toSafeAlias(v.allias || '');
    const fileName = this.toSafeFileName(v.fileName || '');
    const path = this.toSafePath(v.path || '');

    if (!allias || !fileName) return;

    const payload: SaveAsPayload = {
      allias,
      fileName,
      path: path || undefined,
      overwrite: !!v.overwrite
    };

    this.ref.close(payload);
  }
}