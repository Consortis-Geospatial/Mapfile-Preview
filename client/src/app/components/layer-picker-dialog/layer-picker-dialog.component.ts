import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WfsLayerInfo } from '../../core/mapfile.service';

// Client-side augmentation for /api/layers response
// (server adds wfsSupported + optional reasons)
type LayerPickInfo = WfsLayerInfo & { wfsSupported?: boolean; wfsReasons?: string[] };

/**
 * LayerPickerDialog
 * -----------------
 * Simple Angular Material dialog to select a single layer.
 *
 * Style aligned with the existing "new-map-dialog" look & feel.
 *
 * Expected usage:
 *   const ref = dialog.open(LayerPickerDialogComponent, { data: { layers }});
 *   const picked = await firstValueFrom(ref.afterClosed()); // WfsLayerInfo[] | null
 */
@Component({
  selector: 'app-layer-picker-dialog',
  standalone: true,
  templateUrl: './layer-picker-dialog.component.html',
  styleUrls: ['./layer-picker-dialog.component.scss'],
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatTooltipModule,
    ReactiveFormsModule,
    TranslateModule
  ]
})
export class LayerPickerDialogComponent {
  private ref = inject(MatDialogRef<LayerPickerDialogComponent, WfsLayerInfo[] | null>);
  private translate = inject(TranslateService);
  private data = inject(MAT_DIALOG_DATA) as
    | { layers: LayerPickInfo[]; total?: number; title?: string; subtitle?: string }
    | null;

  /** Copy + stable sort for nicer UI. */
  readonly layers: LayerPickInfo[] = (this.data?.layers || [])
    .slice()
    .sort((a, b) => this.layerDisplay(a).localeCompare(this.layerDisplay(b)));

  readonly title = this.data?.title ?? '';
  readonly subtitle = this.data?.subtitle ?? '';
  readonly total = Number(this.data?.total ?? this.layers.length);

  searchCtrl = new FormControl<string>('', { nonNullable: true });
  selectedCtrl = new FormControl<LayerPickInfo | null>(null);

  cancel() {
    this.ref.close(null);
  }

  pick() {
    const picked = this.selectedCtrl.value;
    if (!picked) return;
    // Keep backward-compatible dialog result type: array with a single selected layer.
    this.ref.close([picked as WfsLayerInfo]);
  }
  /** Selection helpers */

  isWfsDisabled(layer: LayerPickInfo): boolean {
    return layer?.wfsSupported === false;
  }

  wfsReasonsTooltip(layer: LayerPickInfo): string {
    if (!this.isWfsDisabled(layer)) return '';
    const reasons = (layer?.wfsReasons || []).filter(Boolean);
    if (reasons.length === 0) return this.translate.instant('LAYER_PICKER.WFS_NOT_SUPPORTED');
    // Multiline tooltip (rendered with pre-line via CSS).
    return reasons.map((r) => `• ${r}`).join('\n');
  }

  selectLayer(layer: LayerPickInfo) {
    // Safety: do not allow selecting non-WFS layers
    if (this.isWfsDisabled(layer)) return;
    this.selectedCtrl.setValue(layer);
  }

  clearSelection() {
    this.selectedCtrl.setValue(null);
  }

  /** UI helpers */
  layerTitle(layer: WfsLayerInfo): string {
    return extractLayerTitle(layer);
  }

  layerDisplay(layer: WfsLayerInfo): string {
    const t = extractLayerTitle(layer);
    return (t ? `${t} — ` : '') + (layer?.name || '');
  }

  filteredLayers(): LayerPickInfo[] {
    const term = (this.searchCtrl.value || '').trim().toLowerCase();
    if (!term) return this.layers;

    return this.layers.filter((l) => {
      const name = String(l?.name || '').toLowerCase();
      const title = String(extractLayerTitle(l) || '').toLowerCase();
      const type = String((l as any)?.type || '').toLowerCase();
      return name.includes(term) || title.includes(term) || type.includes(term);
    });
  }
}

function extractLayerTitle(layer: any): string {
  // Priority:
  // 1) layer.title
  // 2) layer.metadata keys
  // 3) empty string
  if (!layer) return '';
  if (layer.title) return String(layer.title);

  const md = layer.metadata || {};
  const keyOrder = ['wms_title', 'ows_title', 'title', 'wfs_title', 'gml_featuretype_title'];
  for (const k of keyOrder) {
    if (md[k]) return String(md[k]);
  }

  return '';
}
