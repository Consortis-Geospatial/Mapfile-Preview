import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { NewMapPayload } from '../../core/mapfile.service';
import { TranslateModule } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
/**
 * Dialog: συμπληρώνεις το payload για POST /api/new
 *
 * Κρατάμε το UI απλό:
 * - name/alias/fileName
 * - epsg/units/size/extent
 * - overwrite
 * - (optional) paths + OWS metadata
 */
@Component({
  selector: 'app-new-map-dialog',
  standalone: true,
  templateUrl: './new-map-dialog.component.html',
  styleUrls: ['./new-map-dialog.component.scss'],
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslateModule,
    CommonModule
  ]
})
export class NewMapDialogComponent {
  private fb = inject(FormBuilder);
  private ref = inject(MatDialogRef<NewMapDialogComponent>);
  private data = inject(MAT_DIALOG_DATA) as { preset?: Partial<NewMapPayload>; mode?: 'quickCostume' } | null;

  /** When true, render the "quick" dialog (only name/alias/fileName/overwrite) */
  quickCostume = this.data?.mode === 'quickCostume';

  form = this.fb.group({
    name: [''],
    alias: [''],
    fileName: [''],

    epsg: [2100, [Validators.required]],
    units: ['METERS', [Validators.required]],

    sizeX: [800, [Validators.required]],
    sizeY: [600, [Validators.required]],

    extentMinX: [0, [Validators.required]],
    extentMinY: [0, [Validators.required]],
    extentMaxX: [1000, [Validators.required]],
    extentMaxY: [1000, [Validators.required]],

    overwrite: [false],

    // optional
    shapePath: [''],
    fontsetPath: [''],
    symbolsetPath: [''],

    // legacy (single-language) helpers
    title: [''],
    abstract: [''],

    // OWS / OGC (MAP-level WEB/METADATA)
    owsTitleEl: [''],
    owsTitleEn: [''],
    owsAbstractEl: [''],
    owsAbstractEn: [''],

    owsOnlineResource: [''],
    owsServiceOnlineResource: [''],

    wmsLanguages: [''],
    wfsLanguages: [''],

    wmsSrs: [''],
    wfsSrs: [''],
    wmsBboxExtended: [false],

    wmsEnableRequest: [''],
    wfsEnableRequest: [''],
    wmsSldEnabled: [false],
    wmsFeatureInfoMimeType: [''],

    wmsKeywordlistIsoItems: [''],
    wmsKeywordlistVocabulary: [''],
    owsKeywordlistIsoItems: [''],
    owsKeywordlistVocabulary: [''],

    // COSTUME
    wmsCostumeCapabilities: [''],
    wfsCostumeCapabilities: [''],
    owsCostumeTemporalReference: [''],
    owsCostumeMpocName: [''],
    owsCostumeMpocEmail: [''],
    owsCostumeMetadataDate: [''],
    owsCostumeResourceLocator: [''],
    owsCostumeKeyword: [''],
    owsFees: [''],
    owsAccessConstraints: [''],
    owsContactPerson: [''],
    owsContactOrganization: [''],
    owsContactPosition: [''],

    wfsCostumeDsidCode: [''],
    wfsCostumeDsidNs: ['']
  });

  constructor() {
    // preset (από localStorage ή caller)
    const preset = this.data?.preset ?? {};
    if (preset) {
      const meta: Record<string, any> = (preset as any).metadata ?? {};

      this.form.patchValue({
        name: preset.name ?? '',
        alias: preset.alias ?? '',
        fileName: preset.fileName ?? '',
        epsg: (preset.epsg as any) ?? 2100,
        units: preset.units ?? 'METERS',
        overwrite: !!preset.overwrite,
        shapePath: preset.shapePath ?? '',
        fontsetPath: preset.fontsetPath ?? '',
        symbolsetPath: preset.symbolsetPath ?? '',

        // legacy
        title: preset.title ?? '',
        abstract: preset.abstract ?? '',

        // OWS/OGC from explicit payload fields or from metadata map
        owsTitleEl: (preset as any).owsTitleEl ?? meta['ows_title.el'] ?? '',
        owsTitleEn: (preset as any).owsTitleEn ?? meta['ows_title.en'] ?? '',
        owsAbstractEl: (preset as any).owsAbstractEl ?? meta['ows_abstract.el'] ?? '',
        owsAbstractEn: (preset as any).owsAbstractEn ?? meta['ows_abstract.en'] ?? '',

        owsOnlineResource: preset.owsOnlineResource ?? meta['ows_onlineresource'] ?? '',
        owsServiceOnlineResource: (preset as any).owsServiceOnlineResource ?? meta['ows_service_onlineresource'] ?? '',

        wmsLanguages: (preset as any).wmsLanguages ?? meta['wms_languages'] ?? '',
        wfsLanguages: (preset as any).wfsLanguages ?? meta['wfs_languages'] ?? '',

        wmsSrs: (preset as any).wmsSrs ?? meta['wms_srs'] ?? '',
        wfsSrs: (preset as any).wfsSrs ?? meta['wfs_srs'] ?? '',
        wmsBboxExtended: ((preset as any).wmsBboxExtended ?? meta['wms_bbox_extended']) === true || String((preset as any).wmsBboxExtended ?? meta['wms_bbox_extended'] ?? '').toLowerCase() === 'true',

        wmsEnableRequest: (preset as any).wmsEnableRequest ?? meta['wms_enable_request'] ?? '',
        wfsEnableRequest: (preset as any).wfsEnableRequest ?? meta['wfs_enable_request'] ?? '',
        wmsSldEnabled: ((preset as any).wmsSldEnabled ?? meta['wms_sld_enabled']) === true || String((preset as any).wmsSldEnabled ?? meta['wms_sld_enabled'] ?? '').toLowerCase() === 'true',
        wmsFeatureInfoMimeType: (preset as any).wmsFeatureInfoMimeType ?? meta['wms_feature_info_mime_type'] ?? '',

        wmsKeywordlistIsoItems: (preset as any).wmsKeywordlistIsoItems ?? meta['wms_keywordlist_ISO_items'] ?? '',
        wmsKeywordlistVocabulary: (preset as any).wmsKeywordlistVocabulary ?? meta['wms_keywordlist_vocabulary'] ?? '',
        owsKeywordlistIsoItems: (preset as any).owsKeywordlistIsoItems ?? meta['ows_keywordlist_ISO_items'] ?? '',
        owsKeywordlistVocabulary: (preset as any).owsKeywordlistVocabulary ?? meta['ows_keywordlist_vocabulary'] ?? '',

        wmsCostumeCapabilities: (preset as any).wmsCostumeCapabilities ?? meta['wms_Costume_capabilities'] ?? '',
        wfsCostumeCapabilities: (preset as any).wfsCostumeCapabilities ?? meta['wfs_Costume_capabilities'] ?? '',

        owsCostumeTemporalReference: (preset as any).owsCostumeTemporalReference ?? meta['ows_Costume_temporal_reference'] ?? '',
        owsCostumeMpocName: (preset as any).owsCostumeMpocName ?? meta['ows_Costume_mpoc_name'] ?? '',
        owsCostumeMpocEmail: (preset as any).owsCostumeMpocEmail ?? meta['ows_Costume_mpoc_email'] ?? '',
        owsCostumeMetadataDate: (preset as any).owsCostumeMetadataDate ?? meta['ows_Costume_metadatadate'] ?? '',
        owsCostumeResourceLocator: (preset as any).owsCostumeResourceLocator ?? meta['ows_Costume_resourcelocator'] ?? '',
        owsCostumeKeyword: (preset as any).owsCostumeKeyword ?? meta['ows_Costume_keyword'] ?? '',
        owsFees: (preset as any).owsFees ?? meta['ows_fees'] ?? '',
        owsAccessConstraints: (preset as any).owsAccessConstraints ?? meta['ows_accessconstraints'] ?? '',
        owsContactPerson: (preset as any).owsContactPerson ?? meta['ows_contactperson'] ?? '',
        owsContactOrganization: (preset as any).owsContactOrganization ?? meta['ows_contactorganization'] ?? '',
        owsContactPosition: (preset as any).owsContactPosition ?? meta['ows_contactposition'] ?? '',

        wfsCostumeDsidCode: (preset as any).wfsCostumeDsidCode ?? meta['wfs_Costume_dsid_code'] ?? '',
        wfsCostumeDsidNs: (preset as any).wfsCostumeDsidNs ?? meta['wfs_Costume_dsid_ns'] ?? ''
      });

      // extent
      if (Array.isArray(preset.extent) && preset.extent.length === 4) {
        this.form.patchValue({
          extentMinX: preset.extent[0] as any,
          extentMinY: preset.extent[1] as any,
          extentMaxX: preset.extent[2] as any,
          extentMaxY: preset.extent[3] as any
        });
      }

      // size
      if (Array.isArray(preset.size) && preset.size.length === 2) {
        this.form.patchValue({
          sizeX: preset.size[0] as any,
          sizeY: preset.size[1] as any
        });
      }
    }
  }

  cancel() {
    this.ref.close(null);
  }

  /** convert name -> SAFE_ALIAS (same idea as server) */
  private toSafeAlias(v: string) {
    return String(v || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private toSafeFileName(v: string) {
    const base = String(v || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!base) return '';
    return base.toLowerCase().endsWith('.map') ? base : `${base}.map`;
  }

  /** Generate GUID (UUID v4). Used for COSTUME WFS DSID when user leaves it empty. */
  private uuidV4(): string {
    try {
      // Modern browsers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = globalThis as any;
      if (c?.crypto?.randomUUID) return c.crypto.randomUUID();
    } catch {
      // ignore
    }

    // Fallback (RFC4122-ish)
    // NOTE: Not cryptographically strong, but fine for a DSID placeholder.
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const s4 = () => rnd(0x10000).toString(16).padStart(4, '0');
    return `${s4()}${s4()}-${s4()}-4${s4().slice(1)}-${((8 + rnd(4)).toString(16))}${s4().slice(1)}-${s4()}${s4()}${s4()}`;
  }

  submit() {
    if (this.form.invalid) return;

    const v = this.form.getRawValue();

    // αν ο χρήστης δεν έβαλε alias, το παράγουμε από name
    // (στο Quick Costume: default COSTUME)
    const aliasFallback = this.quickCostume ? 'COSTUME' : 'NEW_MAP';
    const alias = this.toSafeAlias(v.alias || v.name || aliasFallback);

    const fileName = v.fileName?.trim()
      ? this.toSafeFileName(v.fileName)
      : this.toSafeFileName(alias.toLowerCase());

    // Quick mode: return only minimal fields for POST /api/newQuickCostume
    if (this.quickCostume) {
      this.ref.close({
        name: v.name?.trim() || alias,
        alias,
        fileName,
        overwrite: !!v.overwrite
      });
      return;
    }

    // ---------------------------------------------------------------------
    // MAP-level WEB/METADATA map
    // ---------------------------------------------------------------------
    const metadata: Record<string, string> = {};
    const addMeta = (k: string, val: any) => {
      const s = String(val ?? '').trim();
      if (!s) return;
      metadata[k] = s;
    };

    // Service identity (multi-language)
    addMeta('ows_title.el', v.owsTitleEl);
    addMeta('ows_title.en', v.owsTitleEn);
    addMeta('ows_abstract.el', v.owsAbstractEl);
    addMeta('ows_abstract.en', v.owsAbstractEn);

    // URLs
    addMeta('ows_onlineresource', v.owsOnlineResource);
    addMeta('ows_service_onlineresource', v.owsServiceOnlineResource);

    // Languages
    addMeta('wms_languages', v.wmsLanguages);
    addMeta('wfs_languages', v.wfsLanguages);

    // CRS / SRS
    addMeta('wms_srs', v.wmsSrs);
    addMeta('wfs_srs', v.wfsSrs);
    if (v.wmsBboxExtended === true) addMeta('wms_bbox_extended', 'true');

    // Permissions
    addMeta('wms_enable_request', v.wmsEnableRequest);
    addMeta('wfs_enable_request', v.wfsEnableRequest);

    // WMS extras
    if (v.wmsSldEnabled === true) addMeta('wms_sld_enabled', 'true');
    addMeta('wms_feature_info_mime_type', v.wmsFeatureInfoMimeType);

    // Keywords
    addMeta('wms_keywordlist_ISO_items', v.wmsKeywordlistIsoItems);
    addMeta('wms_keywordlist_vocabulary', v.wmsKeywordlistVocabulary);
    addMeta('ows_keywordlist_ISO_items', v.owsKeywordlistIsoItems);
    addMeta('ows_keywordlist_vocabulary', v.owsKeywordlistVocabulary);

    // COSTUME
    addMeta('wms_Costume_capabilities', v.wmsCostumeCapabilities);
    addMeta('wfs_Costume_capabilities', v.wfsCostumeCapabilities);
    addMeta('ows_Costume_temporal_reference', v.owsCostumeTemporalReference);
    addMeta('ows_Costume_mpoc_name', v.owsCostumeMpocName);
    addMeta('ows_Costume_mpoc_email', v.owsCostumeMpocEmail);
    addMeta('ows_Costume_metadatadate', v.owsCostumeMetadataDate);
    addMeta('ows_Costume_resourcelocator', v.owsCostumeResourceLocator);
    addMeta('ows_Costume_keyword', v.owsCostumeKeyword);
    addMeta('ows_fees', v.owsFees);
    addMeta('ows_accessconstraints', v.owsAccessConstraints);
    addMeta('ows_contactperson', v.owsContactPerson);
    addMeta('ows_contactorganization', v.owsContactOrganization);
    addMeta('ows_contactposition', v.owsContactPosition);

    // COSTUME WFS DSID
    const wfsDsidCode = String(v.wfsCostumeDsidCode ?? '').trim();
    const wfsCaps = String(v.wfsCostumeCapabilities ?? '').trim();
    if (wfsCaps && !wfsDsidCode) {
      addMeta('wfs_Costume_dsid_code', this.uuidV4());
    } else {
      addMeta('wfs_Costume_dsid_code', wfsDsidCode);
    }
    addMeta('wfs_Costume_dsid_ns', v.wfsCostumeDsidNs);

    // Keep legacy title/abstract fields for backward compatibility with backends
    // that still map these into METADATA.
    const legacyTitle = String(v.title ?? '').trim();
    const legacyAbstract = String(v.abstract ?? '').trim();
    const compatTitle = String(v.owsTitleEl ?? '').trim() || String(v.owsTitleEn ?? '').trim() || legacyTitle;
    const compatAbstract = String(v.owsAbstractEl ?? '').trim() || String(v.owsAbstractEn ?? '').trim() || legacyAbstract;

    const payload: NewMapPayload = {
      name: v.name?.trim() || alias,
      alias,
      fileName,

      epsg: Number(v.epsg),
      units: v.units || 'METERS',
      size: [Number(v.sizeX), Number(v.sizeY)],
      extent: [Number(v.extentMinX), Number(v.extentMinY), Number(v.extentMaxX), Number(v.extentMaxY)],

      overwrite: !!v.overwrite,

      // optional
      shapePath: v.shapePath?.trim() || undefined,
      fontsetPath: v.fontsetPath?.trim() || undefined,
      symbolsetPath: v.symbolsetPath?.trim() || undefined,

      // legacy fields (kept)
      title: compatTitle || undefined,
      abstract: compatAbstract || undefined,
      owsOnlineResource: String(v.owsOnlineResource ?? '').trim() || undefined,

      // keep these also as top-level for simple backends
      wmsSrs: String(v.wmsSrs ?? '').trim() || undefined,
      wfsSrs: String(v.wfsSrs ?? '').trim() || undefined,

      // full metadata map
      metadata: Object.keys(metadata).length ? metadata : undefined
    };

    this.ref.close(payload);
  }
}