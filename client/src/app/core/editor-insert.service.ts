import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class EditorInsertService {
    private readonly insertSubject = new Subject<string>();
    readonly insert$ = this.insertSubject.asObservable();

    insert(text: string): void {
        this.insertSubject.next(text);
    }
}
