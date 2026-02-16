import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type InfoAlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface InfoAlertButton {
  /** Button label */
  text: string;
  /** Optional semantic role */
  role?: 'cancel' | 'confirm';
  /** Optional click handler */
  onClick?: () => void | Promise<void>;
}

export interface InfoAlertState {
  /** Whether the overlay is visible */
  open: boolean;

  /** Dialog title (shown in header) */
  title: string;

  /** Visual variant (controls header/icon styling) */
  variant: InfoAlertVariant;

  /**
   * Optional LLM answer / human-friendly explanation.
   * If present, it is rendered FIRST (before the raw error).
   */
  llmAnswer?: string;

  /**
   * Raw technical error text (rendered exactly as-is in a <pre>).
   * If missing, `message` is used as fallback.
   */
  rawError?: string;

  /**
   * Generic message (fallback). If you only pass one string, put it here.
   * When `llmAnswer` is present, this is treated as raw/fallback error.
   */
  message: string;

  /** Whether clicking the backdrop or pressing ESC closes the dialog */
  dismissOnBackdrop: boolean;

  /** Action buttons */
  buttons: InfoAlertButton[];
}

export type InfoAlertOpenOptions = Partial<
  Omit<InfoAlertState, 'open' | 'buttons' | 'dismissOnBackdrop' | 'message'>
> & {
  title?: string;
  variant?: InfoAlertVariant;
  message?: string;
  rawError?: string;
  llmAnswer?: string;
  dismissOnBackdrop?: boolean;
  buttons?: InfoAlertButton[];
};

const CLOSED_STATE: InfoAlertState = {
  open: false,
  title: '',
  variant: 'info',
  message: '',
  dismissOnBackdrop: false,
  buttons: [],
};

@Injectable({ providedIn: 'root' })
export class InfoAlertService {
  private readonly _state$ = new BehaviorSubject<InfoAlertState>(CLOSED_STATE);

  /** Observable state for the overlay component to bind to */
  readonly state$ = this._state$.asObservable();

  /** Synchronous snapshot (useful for ESC handling, etc.) */
  get snapshot(): InfoAlertState {
    return this._state$.value;
  }

  /**
   * Backwards-compat:
   * Some call sites used to concatenate:
   *   <llm answer> + "\n---------------------------\n" + <raw error>
   * We now split this automatically so the UI can:
   *  - show the LLM answer FIRST
   *  - keep the raw error in a collapsible <details> block
   */
  private parseLegacyCombinedMessage(
    input: string | undefined
  ): { llmAnswer: string; rawError: string } | null {
    if (!input) return null;

    // Match a "separator line" like: ---------------------------
    // Require at least 10 dashes to avoid false positives.
    const sep = /\r?\n\s*-{10,}\s*\r?\n/;
    const m = sep.exec(input);
    if (!m) return null;

    const left = input.slice(0, m.index).trim();
    const right = input.slice(m.index + m[0].length); // keep as-is
    if (!left || !right) return null;

    return { llmAnswer: left, rawError: right };
  }

  private normalizeState(next: InfoAlertState): InfoAlertState {
    const hasLlm = !!(next.llmAnswer && next.llmAnswer.trim().length > 0);
    if (hasLlm) return next;

    const candidate = next.rawError ?? next.message ?? '';
    const parsed = this.parseLegacyCombinedMessage(candidate);
    if (!parsed) return next;

    return {
      ...next,
      llmAnswer: parsed.llmAnswer,
      rawError: parsed.rawError,
      // When llmAnswer exists, `message` is treated as the raw/fallback error.
      message: parsed.rawError,
    };
  }

  /**
   * Open the dialog.
   *
   * Overloads:
   *  - open("message", "Title?", "variant?")
   *  - open({ title, variant, message, rawError, llmAnswer, buttons, dismissOnBackdrop })
   */
  open(message: string, title?: string, variant?: InfoAlertVariant): void;
  open(options: InfoAlertOpenOptions): void;
  open(arg1: string | InfoAlertOpenOptions, title?: string, variant?: InfoAlertVariant): void {
    const next: InfoAlertState =
      typeof arg1 === 'string'
        ? {
            open: true,
            title: title ?? 'Alert',
            variant: variant ?? 'info',
            message: arg1,
            rawError: undefined,
            llmAnswer: undefined,
            dismissOnBackdrop: true,
            buttons: [{ text: 'OK', role: 'confirm' }],
          }
        : {
            open: true,
            title: arg1.title ?? 'Alert',
            variant: arg1.variant ?? 'info',
            llmAnswer: arg1.llmAnswer,
            rawError: arg1.rawError,
            message: arg1.message ?? arg1.rawError ?? '',
            dismissOnBackdrop: arg1.dismissOnBackdrop ?? true,
            buttons: arg1.buttons ?? [{ text: 'OK', role: 'confirm' }],
          };

    this._state$.next(this.normalizeState(next));
  }

  close(): void {
    this._state$.next(CLOSED_STATE);
  }

  info(message: string, title = 'Info'): void {
    this.open(message, title, 'info');
  }

  success(message: string, title = 'Success'): void {
    this.open(message, title, 'success');
  }

  warning(message: string, title = 'Warning'): void {
    this.open(message, title, 'warning');
  }

  /**
   * Error alert.
   * - If you pass only `message`, it will be shown directly as the raw error.
   * - If you also pass `llmAnswer`, that will be shown FIRST and the raw error will appear in "Details".
   */
  error(messageOrRawError: string, title = 'Error', llmAnswer?: string): void {
    this.open({
      title,
      variant: 'error',
      llmAnswer,
      rawError: messageOrRawError,
      message: messageOrRawError,
      dismissOnBackdrop: true,
      buttons: [{ text: 'OK', role: 'confirm' }],
    });
  }

  /**
   * Confirmation dialog (returns true/false).
   * (Useful for deletes / irreversible actions.)
   */
  async confirm(
    message: string,
    title = 'Confirm',
    confirmText = 'OK',
    cancelText = 'Cancel'
  ): Promise<boolean> {
    let resolveFn!: (v: boolean) => void;
    const result = new Promise<boolean>((resolve) => (resolveFn = resolve));

    this.open({
      title,
      variant: 'info',
      message,
      dismissOnBackdrop: false,
      buttons: [
        { text: cancelText, role: 'cancel', onClick: () => resolveFn(false) },
        { text: confirmText, role: 'confirm', onClick: () => resolveFn(true) },
      ],
    });

    const val = await result;
    this.close();
    return val;
  }
}
