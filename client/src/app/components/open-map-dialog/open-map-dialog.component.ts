import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Dialog payload for POST /api/open
 * - path: relative path inside workspace (backend will enforce workspaceDir boundary)
 * - allias: alias stored in mapserver.conf (MAPS)
 * - overwrite: overwrite alias mapping if already exists
 */
export type OpenMapPayload = {
  path: string;
  allias: string; // keep spelling aligned with backend
  overwrite?: boolean;
};

@Component({
  selector: 'app-open-map-dialog',
  standalone: true,
  templateUrl: './open-map-dialog.component.html',
  styleUrls: ['./open-map-dialog.component.scss'],
  imports: [
    
    TranslateModule,
MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    ReactiveFormsModule
  ]
})
export class OpenMapDialogComponent {
  private fb = inject(FormBuilder);
  private ref = inject(MatDialogRef<OpenMapDialogComponent>);
  private data = inject(MAT_DIALOG_DATA) as { preset?: Partial<OpenMapPayload> } | null;

  form = this.fb.group({
    allias: ['', [Validators.required]],
    path: ['', [Validators.required]],
    overwrite: [true]
  });

  constructor() {
    const preset = this.data?.preset ?? {};
    this.form.patchValue({
      allias: (preset.allias as any) ?? '',
      path: (preset.path as any) ?? '',
      overwrite: preset.overwrite !== undefined ? !!preset.overwrite : true
    });
  }

  cancel() {
    this.ref.close(null);
  }

  /** Convert alias -> SAFE_ALIAS */
  private toSafeAlias(v: string) {
    return String(v || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Normalize path safely WITHOUT regex backslashes (some editors/copy-paste break `/\\/g`).
   * - Convert backslashes to forward slashes
   * - Remove leading "/" for relative paths (absolute paths allowed; backend still restricts)
   * - Block ".." segments (backend does strict check too)
   */
  private toSafePath(v: string) {
    const raw = String(v || '').trim();
    if (!raw) return '';

    // Replace backslashes with slashes robustly
    const normalized = raw.split('\\').join('/');

    // Detect "absolute-ish" paths: /... or C:/...
    const isAbs = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);

    if (!isAbs) {
      const noLead = normalized.replace(/^\/+/, '');
      if (noLead.split('/').some(seg => seg === '..')) return '';
      return noLead;
    }

    // Absolute path: still allow user input; backend enforces workspaceDir boundary
    return normalized;
  }

  submit() {
    if (this.form.invalid) return;

    const v = this.form.getRawValue();
    const allias = this.toSafeAlias(v.allias || '');
    const path = this.toSafePath(v.path || '');

    if (!allias || !path) return;

    const payload: OpenMapPayload = {
      allias,
      path,
      overwrite: v.overwrite !== undefined ? !!v.overwrite : true
    };

    this.ref.close(payload);
  }
}