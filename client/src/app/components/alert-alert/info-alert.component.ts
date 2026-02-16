import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { InfoAlertService, InfoAlertState } from './info-alert.service';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Global alert overlay component.
 *
 * Put <app-info-alert /> once in your root template (e.g. app.component.html).
 * Then call InfoAlertService.info/error/... from anywhere.
 */
@Component({
  selector: 'app-info-alert',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './info-alert.component.html',
  styleUrls: ['./info-alert.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoAlertComponent {
  readonly alert = inject(InfoAlertService);
  readonly state$ = this.alert.state$;

  close(): void {
    this.alert.close();
  }

  onBackdropClick(state: InfoAlertState): void {
    if (state.dismissOnBackdrop) this.alert.close();
  }

  async onButtonClick(btn: NonNullable<InfoAlertState['buttons']>[number]): Promise<void> {
    try {
      await btn.onClick?.();
    } finally {
      this.alert.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    const s = this.alert.snapshot;
    if (s.open && s.dismissOnBackdrop) this.alert.close();
  }

  /** Raw error displayed exactly as-is */
  getRawError(s: InfoAlertState): string {
    return (s.rawError ?? s.message ?? '');
  }

  hasLlmAnswer(s: InfoAlertState): boolean {
    return !!(s.llmAnswer && s.llmAnswer.trim().length > 0);
  }
}
