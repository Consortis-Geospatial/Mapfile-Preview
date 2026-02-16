import { Component, EventEmitter, Output, OnInit } from '@angular/core';
import { NgIf } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-top-menu',
  standalone: true,
  templateUrl: './top-menu.component.html',
  styleUrls: ['./top-menu.component.scss'],
  imports: [
    MatToolbarModule,
    MatMenuModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    NgIf,
    TranslateModule
  ]
})
export class TopMenuComponent implements OnInit {
  /** When true, show the MapServer Teacher (school) button */
  showTeacher = true; // default true for backwards compatibility

  ngOnInit(): void {
    // Load optional runtime config from assets.
    fetch('assets/config/config.json')
      .then(r => (r.ok ? r.json() : null))
      .then((cfg: any) => {
        if (cfg && typeof cfg.use_AI !== 'undefined') {
          this.showTeacher = !!cfg.use_AI;
        }
      })
      .catch(() => {
        // ignore; keep default
      });
  }

  @Output() newFile = new EventEmitter<void>();
  @Output() quickNewFile = new EventEmitter<void>();
  @Output() openFile = new EventEmitter<void>();
  @Output() saveFile = new EventEmitter<void>();
  @Output() saveAsFile = new EventEmitter<void>();
  @Output() saveSampleFile = new EventEmitter<void>();

  @Output() format = new EventEmitter<void>();
  @Output() validate = new EventEmitter<void>();
  @Output() autoMetadata = new EventEmitter<void>();

  @Output() previewWms = new EventEmitter<void>();
  @Output() previewWfs = new EventEmitter<void>();
  @Output() previewCgi = new EventEmitter<void>();

  @Output() openTeacher = new EventEmitter<void>();

  @Output() openSettings = new EventEmitter<void>();
}