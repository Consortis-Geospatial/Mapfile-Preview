import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

export type SettingsDialogResult = {
  lang: 'el' | 'en';
  theme: 'light' | 'dark';
};

export type SettingsDialogData = {
  /** Optional preset values (e.g. current app settings) */
  preset?: Partial<SettingsDialogResult>;
  /** Persist to localStorage + apply immediately (default: true) */
  persist?: boolean;
};

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  templateUrl: './settings-dialog.component.html',
  styleUrls: ['./settings-dialog.component.scss'],
  imports: [
    
    TranslateModule,
MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    ReactiveFormsModule
  ]
})
export class SettingsDialogComponent {
  private fb = inject(FormBuilder);
  private ref = inject(MatDialogRef<SettingsDialogComponent, SettingsDialogResult | null>);
  private translate = inject(TranslateService);
  private data = inject(MAT_DIALOG_DATA) as SettingsDialogData | null;

  form = this.fb.nonNullable.group({
    lang: this.fb.nonNullable.control<'el' | 'en'>('el', { validators: [Validators.required] }),
    theme: this.fb.nonNullable.control<'light' | 'dark'>('light', { validators: [Validators.required] })
  });

  constructor() {
    const preset = this.data?.preset ?? {};
    const stored = this.readStorage();

    this.form.patchValue({
      lang: this.coerceLang(preset.lang ?? stored.lang ?? 'el'),
      theme: this.coerceTheme(preset.theme ?? stored.theme ?? 'light')
    });

    // Apply immediately so the user sees what they pick even before saving
    this.form.valueChanges.subscribe(v => {
      const lang = this.coerceLang(v.lang as any);
      const theme = this.coerceTheme(v.theme as any);
      this.apply({ lang, theme }, /*persist*/ false);
    });
  }

  cancel() {
    // Re-apply stored/preset to avoid leaving the app in preview state
    const preset = this.data?.preset ?? {};
    const stored = this.readStorage();
    const lang = this.coerceLang(preset.lang ?? stored.lang ?? 'el');
    const theme = this.coerceTheme(preset.theme ?? stored.theme ?? 'light');
    this.apply({ lang, theme }, /*persist*/ false);

    this.ref.close(null);
  }

  submit() {
    if (this.form.invalid) return;

    const v = this.form.getRawValue();
    const result: SettingsDialogResult = {
      lang: this.coerceLang(v.lang),
      theme: this.coerceTheme(v.theme)
    };

    const persist = this.data?.persist !== false;
    this.apply(result, persist);

    this.ref.close(null); // apply happens internally; keep parent silent
  }

  private coerceLang(v: any): 'el' | 'en' {
    return v === 'en' ? 'en' : 'el';
  }

  private coerceTheme(v: any): 'light' | 'dark' {
    return v === 'dark' ? 'dark' : 'light';
  }

  private readStorage(): Partial<SettingsDialogResult> {
    try {
      const lang = (globalThis?.localStorage?.getItem('app.lang') as any) ?? null;
      const theme = (globalThis?.localStorage?.getItem('app.theme') as any) ?? null;
      return { lang: this.coerceLang(lang), theme: this.coerceTheme(theme) };
    } catch {
      return {};
    }
  }

  private apply(v: SettingsDialogResult, persist: boolean) {
    // Language
    try {
      document.documentElement.lang = v.lang;
      document.documentElement.setAttribute('data-lang', v.lang);
    } catch {}

    // Runtime i18n
    try {
      this.translate.use(v.lang);
    } catch {}

    // Theme switching (works with the patched _tokens.scss using data-theme)
    try {
      document.documentElement.setAttribute('data-theme', v.theme);
    } catch {}

    if (persist) {
      try {
        globalThis?.localStorage?.setItem('app.lang', v.lang);
        globalThis?.localStorage?.setItem('app.theme', v.theme);
      } catch {}
    }

    // Optional: notify the app (handy if you want to listen elsewhere)
    try {
      window.dispatchEvent(new CustomEvent('app-settings-changed', { detail: v }));
    } catch {}
  }
}