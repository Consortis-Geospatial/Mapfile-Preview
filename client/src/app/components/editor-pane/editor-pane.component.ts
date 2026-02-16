import { AfterViewInit, Component, ElementRef, EventEmitter, OnDestroy, Output, ViewChild } from '@angular/core';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
//import 'monaco-editor/min/vs/editor/editor.main.css';
import { Subscription } from 'rxjs';
import { EditorInsertService } from '../../core/editor-insert.service';




@Component({
  selector: 'app-editor-pane',
  templateUrl: './editor-pane.component.html',
  styleUrls: ['./editor-pane.component.scss'],
  standalone: true
})
export class EditorPaneComponent implements AfterViewInit, OnDestroy {
  @ViewChild('editorContainer', { static: true }) editorContainer!: ElementRef<HTMLDivElement>;
  @Output() contentChange = new EventEmitter<string>();
  @Output() saveRequest = new EventEmitter<void>();

  private editorInstance!: monaco.editor.IStandaloneCodeEditor;
  private initialValue = '';
  private ro?: ResizeObserver;
  private sub = new Subscription();
  private lastSelection: monaco.Selection | null = null;

  private themeObserver?: MutationObserver;

  private colorSchemeMql?: MediaQueryList;
  private colorSchemeListener?: () => void;


  private isDarkTheme(): boolean {
    // Prefer explicit app theme (e.g., <html data-theme="dark">) if present,
    // otherwise fall back to OS preference.
    if (typeof window === 'undefined') return false;

    try {
      if (typeof document !== 'undefined') {
        const html = document.documentElement;
        const body = document.body;

        const attrTheme =
          (html?.getAttribute('data-theme') || body?.getAttribute('data-theme') || '').toLowerCase();

        if (attrTheme === 'dark') return true;
        if (attrTheme === 'light') return false;

        // Common class conventions
        const classDark =
          html?.classList?.contains('dark') ||
          html?.classList?.contains('dark-theme') ||
          body?.classList?.contains('dark') ||
          body?.classList?.contains('dark-theme');

        const classLight =
          html?.classList?.contains('light') ||
          html?.classList?.contains('light-theme') ||
          body?.classList?.contains('light') ||
          body?.classList?.contains('light-theme');

        if (classDark) return true;
        if (classLight) return false;
      }
    } catch {
      // ignore and fall through to matchMedia
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }

  private applyMonacoTheme(): void {
    // Monaco theme is global across editors
    try {
      monaco.editor.setTheme(this.isDarkTheme() ? 'vs-dark' : 'vs');
    } catch { /* noop */ }
  }

  private setupThemeSync(): void {
    // Listen to explicit theme changes in the DOM (e.g., data-theme / class toggles)
    if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
      this.themeObserver = new MutationObserver(() => this.applyMonacoTheme());

      // Observe both <html> and <body> since apps vary in where they attach theme state
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class']
      });

      if (document.body) {
        this.themeObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-theme', 'class']
        });
      }
    }

    // Also listen to OS theme changes (useful if the app doesn't set an explicit theme)
    try {
      this.colorSchemeMql = window.matchMedia?.('(prefers-color-scheme: dark)');
      if (this.colorSchemeMql) {
        this.colorSchemeListener = () => {
          // Only react to OS changes when app theme isn't explicitly set
          const htmlTheme = document?.documentElement?.getAttribute('data-theme');
          const bodyTheme = document?.body?.getAttribute('data-theme');
          if (!htmlTheme && !bodyTheme) this.applyMonacoTheme();
        };

        // Support both modern and legacy listeners
        (this.colorSchemeMql as any).addEventListener?.('change', this.colorSchemeListener);
        (this.colorSchemeMql as any).addListener?.(this.colorSchemeListener);
      }
    } catch {
      // ignore
    }
  }

  constructor(private editorInsert: EditorInsertService) { }

  ngAfterViewInit(): void {
    console.debug('[EditorPane] Initializing Monaco editor');

    // Register custom Mapfile language (case-insensitive)
    this.setupMapfileLanguage();

    const prefersDark = this.isDarkTheme();
    this.editorInstance = monaco.editor.create(this.editorContainer.nativeElement, {
      value: this.initialValue,
      language: 'mapfile',
      automaticLayout: true,
      minimap: { enabled: true },
      theme: prefersDark ? 'vs-dark' : 'vs',
      fontSize: 13,
      lineNumbers: 'on',
      padding: { top: 8, bottom: 8 }
    });
    // Keep Monaco theme in sync with app theme toggle
    this.setupThemeSync();
    // Track cursor/selection so toolbar actions can insert at the right place even after focus changes
    this.editorInstance.onDidChangeCursorSelection((e) => {
      this.lastSelection = e.selection;
    });

    // Listen for external insert requests (e.g., Auto Metadata dialog)
    this.sub.add(
      this.editorInsert.insert$.subscribe((text) => this.insertAtCursor(text))
    );



    // Ctrl+S / Cmd+S inside Monaco triggers app Save.
    // This avoids the browser's default \"Save page\" dialog while editing.
    this.editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      this.saveRequest.emit();
    });
    this.ro = new ResizeObserver(() => this.editorInstance?.layout());
    this.ro.observe(this.editorContainer.nativeElement);

    if (this['initialValue']) {
      this['editorInstance'].setValue(this['initialValue']);
    }

    this.editorInstance.onDidChangeModelContent(() => {
      const val = this.editorInstance.getValue();
      this.contentChange.emit(val);
    });
  }

  /** set the whole editor content */
  setContent(text: string, preserveCursor = true): void {
    console.debug('[EditorPane] setContent len=', text?.length ?? 0);
    const model = this.editorInstance.getModel();
    if (model) {
      const pos = this.editorInstance.getPosition();
      model.setValue(text ?? '');
      if (preserveCursor && pos) this.editorInstance.setPosition(pos);
    }
  }

  /** insert text into Monaco at last known cursor/selection */
  private insertAtCursor(text: string): void {
    if (!this.editorInstance) return;

    const selection = this.lastSelection ?? this.editorInstance.getSelection();
    if (!selection) return;

    this.editorInstance.pushUndoStop();
    this.editorInstance.executeEdits('auto-metadata', [
      { range: selection, text, forceMoveMarkers: true }
    ]);
    this.editorInstance.pushUndoStop();

    const newSel = this.editorInstance.getSelection();
    if (newSel) this.lastSelection = newSel;

    this.editorInstance.focus();
  }


  /** get current editor content */
  getContent(): string {
    return this.editorInstance?.getValue() ?? '';
  }

  /** show server validation errors as Monaco markers */
  applyValidationMarkers(errors: { line: number; message: string }[]) {
    const model = this.editorInstance.getModel();
    if (!model) return;

    console.debug('[EditorPane] applyValidationMarkers count=', errors?.length ?? 0);

    const markers: monaco.editor.IMarkerData[] = (errors || []).map(err => ({
      startLineNumber: Math.max(1, err.line),
      endLineNumber: Math.max(1, err.line),
      startColumn: 1,
      endColumn: 1000,
      message: err.message || 'Validation error',
      severity: monaco.MarkerSeverity.Error
    }));

    monaco.editor.setModelMarkers(model, 'mapfile', markers);
  }

  /** clear any markers */
  clearMarkers() {
    const model = this.editorInstance.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, 'mapfile', []);
    }
  }

  ngOnDestroy(): void {
    try { this.sub.unsubscribe(); } catch { }
    try { this.ro?.disconnect(); } catch { }

    // Stop theme listeners
    try { this.themeObserver?.disconnect(); } catch { }
    try {
      if (this.colorSchemeMql && this.colorSchemeListener) {
        (this.colorSchemeMql as any).removeEventListener?.('change', this.colorSchemeListener);
        (this.colorSchemeMql as any).removeListener?.(this.colorSchemeListener);
      }
    } catch { }

    try { this.editorInstance?.dispose(); } catch { }
  }


  // --- Mapfile language setup (syntax highlight, folding, autocomplete) ---

  private setupMapfileLanguage() {
    const KEYWORDS = [
      // blocks
      'MAP', 'END', 'LAYER', 'CLASS', 'STYLE', 'METADATA', 'PROJECTION', 'WEB', 'SYMBOL',
      'SYMBOLSET', 'FONTSET', 'OUTPUTFORMAT', 'FEATURE', 'GRID', 'LEGEND', 'SCALEBAR',
      'QUERYMAP', 'REFERENCE', 'VALIDATION',

      // common map / layer properties
      'NAME', 'STATUS', 'ON', 'OFF', 'TYPE', 'RASTER', 'POINT', 'LINE', 'POLYGON', 'CIRCLE', 'ANNOTATION',
      'DATA', 'CONNECTION', 'CONNECTIONTYPE', 'POSTGIS', 'OGR', 'WMS', 'WFS',
      'TEMPLATE', 'DUMP', 'PROCESSING', 'FILTER', 'FILTERITEM', 'EXPRESSION',
      'LABEL', 'LABELITEM', 'COLOR', 'OUTLINECOLOR', 'WIDTH', 'SIZE', 'ANGLE', 'OPACITY',
      'MINSCALE', 'MAXSCALE', 'MINDISTANCE', 'MAXDISTANCE',

      //OUTPUT Properties
      'MIMETYPE', 'DRIVER', 'EXTENSION', 'IMAGEMODE',

      //LEGEND and LABEL
      'KEYSIZE', 'KEYSPACING', 'OFFSET', 'SHADOWSIZE',

      // map-level stuff
      'DEFRESOLUTION', 'RESOLUTION', 'EXTENT', 'UNITS', 'IMAGECOLOR', 'IMAGETYPE', 'SHAPEPATH', 'CONFIG', 'DEBUG',
      'INCLUDE', 'OFFSITE', 'TRANSPARENT', 'COMPOSITE'
    ];

    // Register language id
    monaco.languages.register({ id: 'mapfile' });

    // Case-insensitive Monarch grammar
    monaco.languages.setMonarchTokensProvider('mapfile', {
      ignoreCase: true,
      tokenPostfix: '.mapfile',
      bbrackets: [
        { open: '{', close: '}', token: 'delimiter.curly' },
        { open: '[', close: ']', token: 'delimiter.square' },
        { open: '(', close: ')', token: 'delimiter.parenthesis' }
      ],
      keywords: KEYWORDS,
      tokenizer: {
        root: [
          // comments (# to end of line)
          [/#.*$/, 'comment'],

          // strings
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],

          // numbers (incl. negatives, floats)
          [/-?\b\d+(\.\d+)?\b/, 'number'],

          // identifiers & keywords (case-insensitive)
          [/[A-Za-z_][A-Za-z0-9_.:-]*/, {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier'
            }
          }],

          // delimiters
          [/[{}()\[\]]/, '@brackets'],
          [/[;,]/, 'delimiter']
        ]
      }
    });

    // Folding on BLOCK ... END
    monaco.languages.setLanguageConfiguration('mapfile', {
      comments: { lineComment: '#' },
      brackets: [['[', ']'], ['(', ')']],
      folding: {
        markers: {
          start: /^\s*(MAP|LAYER|CLASS|STYLE|METADATA|PROJECTION|WEB|SYMBOL|OUTPUTFORMAT|LEGEND|SCALEBAR|QUERYMAP|REFERENCE|GRID|FEATURE|VALIDATION)\b/i,
          end: /^\s*END\b/i
        }
      }
    });

    monaco.languages.registerCompletionItemProvider('mapfile', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions: monaco.languages.CompletionItem[] = KEYWORDS.map(k => ({
          label: k,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: k,
          range
        }));

        return { suggestions };
      }
    });
  }
}