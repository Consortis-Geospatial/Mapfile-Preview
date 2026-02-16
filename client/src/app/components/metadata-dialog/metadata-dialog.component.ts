import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';

type Target = 'layer' | 'web';
type LayerType = 'POINT' | 'LINE' | 'POLYGON' | 'RASTER' | 'CIRCLE' | 'CHART' | 'QUERY';

export interface MetadataDialogData {
    defaultTarget?: Target;
    defaultLayerType?: LayerType;
    wrapBlock?: boolean; // wrap with METADATA/END
    includeComments?: boolean;
}

@Component({
    selector: 'app-metadata-dialog',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,

        MatDialogModule,
        MatButtonModule,
        MatRadioModule,
        MatSelectModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatInputModule,
        TranslateModule,
    ],
    templateUrl: './metadata-dialog.component.html',
    styleUrls: ['./metadata-dialog.component.scss'],
})
export class MetadataDialogComponent {
    // UI state
    target: Target = 'layer';
    layerType: LayerType = 'POINT';

    includeOws = true;

    // Service toggles
    includeWms = true;
    includeWfs = true;
    includeWcs = false;

    // Vector WFS details
    includeGmlHelpers = true;
    gmlFeatureIdField = 'id';
    gmlIncludeItems = 'all'; // or "field1,field2"

    // Raster WCS details
    wcsLabel = 'My Raster Layer';
    wcsFormats = 'GTiff';

    wrapBlock = true;
    includeComments = true;

    preview = '';

    constructor(
        private dialogRef: MatDialogRef<MetadataDialogComponent, string>,
        @Inject(MAT_DIALOG_DATA) data: MetadataDialogData | null
    ) {
        if (data?.defaultTarget) this.target = data.defaultTarget;
        if (data?.defaultLayerType) this.layerType = data.defaultLayerType;
        if (typeof data?.wrapBlock === 'boolean') this.wrapBlock = data.wrapBlock;
        if (typeof data?.includeComments === 'boolean') this.includeComments = data.includeComments;

        // sensible defaults
        this.syncServiceDefaultsForLayer();
        this.updatePreview();
    }

    isVectorLayer(): boolean {
        return this.layerType === 'POINT' || this.layerType === 'LINE' || this.layerType === 'POLYGON' || this.layerType === 'CIRCLE' || this.layerType === 'CHART';
    }

    isRasterLayer(): boolean {
        return this.layerType === 'RASTER';
    }

    onTargetChange(): void {
        this.updatePreview();
    }

    onLayerTypeChange(): void {
        this.syncServiceDefaultsForLayer();
        this.updatePreview();
    }

    onAnyChange(): void {
        this.updatePreview();
    }

    private syncServiceDefaultsForLayer(): void {
        // WMS almost always makes sense for both raster and vector
        this.includeWms = true;

        if (this.isRasterLayer()) {
            this.includeWcs = true;
            this.includeWfs = false;
        } else if (this.isVectorLayer()) {
            this.includeWfs = true;
            this.includeWcs = false;
        } else {
            // QUERY layer: allow WMS/WFS depending on your usage; keep WMS on by default
            this.includeWfs = false;
            this.includeWcs = false;
        }

        // If WFS is off, these don’t matter
        if (!this.includeWfs) this.includeGmlHelpers = false;
    }

    insert(): void {
        // Ensure it ends with newline for clean insertion
        const text = this.preview.endsWith('\n') ? this.preview : this.preview + '\n';
        this.dialogRef.close(text);
    }

    cancel(): void {
        this.dialogRef.close();
    }

    private updatePreview(): void {
        const lines: string[] = [];

        if (this.wrapBlock) lines.push('METADATA');

        const indent = this.wrapBlock ? '  ' : '';

        if (this.target === 'web') {
            this.buildWebMetadata(lines, indent);
        } else {
            this.buildLayerMetadata(lines, indent);
        }

        if (this.wrapBlock) lines.push('END');

        this.preview = lines.join('\n');
    }

    private buildWebMetadata(lines: string[], indent: string): void {
        if (this.includeComments) {
            lines.push(`${indent}# MAP-level (WEB->METADATA) service metadata`);
            lines.push(`${indent}# Put your cursor inside WEB block where you want METADATA`);
        }

        if (this.includeOws) {
            if (this.includeComments) lines.push(`${indent}# Generic OWS (applies to WMS/WFS/WCS)`);
            lines.push(`${indent}"ows_title" "My Map Service"`);
            lines.push(`${indent}"ows_abstract" "Short service description..."`);
            lines.push(`${indent}"ows_keywordlist" "mapserver,ogc"`);
            lines.push(`${indent}"ows_onlineresource" "https://example.com/cgi-bin/mapserv?map=/path/to.map&"`);
            lines.push(`${indent}"ows_srs" "EPSG:4326 EPSG:3857"`);
            lines.push('');
        }

        if (this.includeWms) {
            if (this.includeComments) lines.push(`${indent}# WMS`);
            lines.push(`${indent}"wms_title" "My WMS Service"`);
            lines.push(`${indent}"wms_onlineresource" "https://example.com/cgi-bin/mapserv?map=/path/to.map&"`);
            lines.push(`${indent}"wms_srs" "EPSG:4326 EPSG:3857"`);
            lines.push(`${indent}"wms_enable_request" "*"`);
            lines.push(`${indent}"wms_feature_info_mime_type" "geojson"`);
            lines.push('');
        }

        if (this.includeWfs) {
            if (this.includeComments) lines.push(`${indent}# WFS`);
            lines.push(`${indent}"wfs_onlineresource" "https://example.com/cgi-bin/mapserv?map=/path/to.map&"`);
            lines.push(`${indent}"wfs_srs" "EPSG:4326 EPSG:3857"`);
            lines.push(`${indent}"wfs_enable_request" "*"`);
            lines.push(`${indent}"wfs_getfeature_formatlist" "geojson gml2 gml3"`);
            lines.push('');
        }

        if (this.includeWcs) {
            if (this.includeComments) lines.push(`${indent}# WCS`);
            lines.push(`${indent}"wcs_onlineresource" "https://example.com/cgi-bin/mapserv?map=/path/to.map&"`);
            lines.push(`${indent}"wcs_enable_request" "*"`);
            lines.push('');
        }

        // Trim trailing blank line(s)
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
    }

    private buildLayerMetadata(lines: string[], indent: string): void {
        if (this.includeComments) {
            lines.push(`${indent}# LAYER-level metadata`);
            lines.push(`${indent}# Layer TYPE: ${this.layerType}`);
            lines.push(`${indent}# Put your cursor inside a LAYER block where you want METADATA`);
            lines.push('');
        }

        if (this.includeOws) {
            if (this.includeComments) lines.push(`${indent}# Generic OWS`);
            lines.push(`${indent}"ows_title" "My Layer Title"`);
            lines.push(`${indent}"ows_abstract" "Short layer description..."`);
            lines.push(`${indent}"ows_keywordlist" "keyword1,keyword2"`);
            lines.push(`${indent}"ows_srs" "EPSG:4326 EPSG:3857"`);
            lines.push('');
        }

        if (this.includeWms) {
            if (this.includeComments) lines.push(`${indent}# WMS (images)`);
            lines.push(`${indent}"wms_title" "My Layer Title"`);
            lines.push(`${indent}"wms_feature_info_mime_type" "geojson"`);
            lines.push('');
        }

        if (this.includeWfs) {
            if (this.includeComments) lines.push(`${indent}# WFS (vector features)`);
            lines.push(`${indent}"wfs_title" "My Layer Title"`);
            if (this.includeGmlHelpers) {
                lines.push(`${indent}"gml_featureid" "${this.gmlFeatureIdField}"`);
                lines.push(`${indent}"gml_include_items" "${this.gmlIncludeItems}"`);
                lines.push(`${indent}"gml_types" "auto"`);
            }
            lines.push('');
        }

        if (this.includeWcs) {
            if (this.includeComments) lines.push(`${indent}# WCS (raster coverages)`);
            lines.push(`${indent}"wcs_label" "${this.wcsLabel}"`);
            lines.push(`${indent}"wcs_formats" "${this.wcsFormats}"`);
            lines.push('');
        }

        if (this.layerType === 'QUERY' && this.includeComments) {
            lines.push(`${indent}# Note: TYPE QUERY layers are typically query/identify layers and may not render.`);
        }

        while (lines.length && lines[lines.length - 1] === '') lines.pop();
    }
}
