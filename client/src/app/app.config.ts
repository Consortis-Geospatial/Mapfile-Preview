import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { provideAnimations } from '@angular/platform-browser/animations';

import { TranslateLoader, TranslateModule, TranslationObject } from '@ngx-translate/core';

/**
 * NOTE:
 * Some builds report TS2554 on TranslateHttpLoader(...) (constructor typing mismatch).
 * This simple loader avoids that by loading JSON directly from /assets/i18/<lang>.json.
 */
export class AssetsTranslateLoader implements TranslateLoader {
  constructor(private http: HttpClient) {}

  getTranslation(lang: string): Observable<TranslationObject> {
    return this.http.get<TranslationObject>(`/assets/i18/${lang}.json`);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideHttpClient(),
    provideAnimations(),

    importProvidersFrom(
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useClass: AssetsTranslateLoader,
          deps: [HttpClient]
        }
      })
    )
  ]
};
