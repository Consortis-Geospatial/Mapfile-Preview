import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface MapserverTeacherDialogState {
  open: boolean;
}

/**
 * Tiny UI state service (same pattern as InfoAlertService).
 * Keeps the dialog mounted in the DOM and toggles visibility.
 */
@Injectable({ providedIn: 'root' })
export class MapserverTeacherDialogService {
  private readonly _state$ = new BehaviorSubject<MapserverTeacherDialogState>({ open: false });
  readonly state$ = this._state$.asObservable();

  open() {
    this._state$.next({ open: true });
  }

  close() {
    this._state$.next({ open: false });
  }

  toggle() {
    this._state$.next({ open: !this._state$.value.open });
  }
}
