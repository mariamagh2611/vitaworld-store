import React, { useEffect, useRef, useState } from 'react';
import { t, adminLanguage } from './language';
import { direction } from '../shared/i18n';
import type { Language } from '../shared/types';
type Props = {
  value: string;
  label: string;
  path: string;
  error?: string;
  onChange: (html: string) => void;
  request: (path: string, body?: unknown) => Promise<any>;
  language?: Language;
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
function editorDocument(html: string, label: string, language: Language) {
  const stylesheet =
    document
      .querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="/assets/style.css"]')
      ?.getAttribute('href') || '/assets/style.css';
  return `<!doctype html><html lang="${language}" dir="${direction(language)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; font-src 'self'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${escape(stylesheet)}"><style>body{margin:0;padding:16px;background:#fff}#rich-root{min-height:330px;outline:none;padding:0}#rich-root:empty:before{content:attr(data-placeholder);color:#6c7974}img{max-width:100%;height:auto}table{width:100%}</style></head><body class="storefront"><div id="rich-root" class="product-description formatted-description" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${escape(label)}" data-placeholder="${escape(t('اكتب وصف المنتج هنا…'))}">${html}</div></body></html>`;
}
export function RichTextEditor({
  value,
  label,
  path,
  error,
  onChange,
  request,
  language = adminLanguage(),
}: Props) {
  const [mode, setMode] = useState<'visual' | 'code'>('visual'),
    [document, setDocument] = useState(''),
    [loading, setLoading] = useState(true),
    [problem, setProblem] = useState('');
  const frame = useRef<HTMLIFrameElement>(null),
    lastEmitted = useRef<string | undefined>(undefined),
    initialized = useRef(false),
    selection = useRef<Range | null>(null),
    change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (mode !== 'visual') return;
    if (initialized.current && lastEmitted.current === value) return;
    let current = true;
    setLoading(true);
    setProblem('');
    void request('/admin/content/preview', { html: value })
      .then((result) => {
        if (!current) return;
        setDocument(editorDocument(result.html, label, language));
        lastEmitted.current = value;
        initialized.current = true;
      })
      .catch((error) => {
        if (current) setProblem(error.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [value, mode, label, language]);
  const remember = () => {
    const selected = frame.current?.contentWindow?.getSelection();
    const root = frame.current?.contentDocument?.getElementById('rich-root');
    if (
      selected?.rangeCount &&
      root?.contains(selected.anchorNode) &&
      root.contains(selected.focusNode)
    )
      selection.current = selected.getRangeAt(0).cloneRange();
  };
  const emit = () => {
    const root = frame.current?.contentDocument?.getElementById('rich-root');
    if (!root) return;
    lastEmitted.current = root.innerHTML;
    change.current(root.innerHTML);
    remember();
  };
  const command = (name: string, value?: string) => {
    const doc = frame.current?.contentDocument,
      root = doc?.getElementById('rich-root');
    if (!doc || !root) return;
    root.focus();
    const selected = doc.defaultView?.getSelection();
    if (selection.current) {
      try {
        selected?.removeAllRanges();
        selected?.addRange(selection.current);
      } catch {}
    }
    doc.execCommand('styleWithCSS', false, 'true');
    doc.execCommand(name, false, value);
    emit();
  };
  const loaded = () => {
    const doc = frame.current?.contentDocument,
      root = doc?.getElementById('rich-root');
    if (!doc || !root) return;
    selection.current = null;
    root.addEventListener('input', emit);
    doc.addEventListener('selectionchange', remember);
    doc.addEventListener('click', (event) => {
      if ((event.target as Element)?.closest('a')) event.preventDefault();
    });
    root.addEventListener('paste', (event) => {
      event.preventDefault();
      remember();
      const html = event.clipboardData?.getData('text/html');
      const text = event.clipboardData?.getData('text/plain') || '';
      if (!html) {
        command('insertHTML', escape(text).replace(/\r?\n/g, '<br>'));
        return;
      }
      void request('/admin/content/preview', { html })
        .then((result) => command('insertHTML', result.html))
        .catch((error) => setProblem(error.message));
    });
    root.addEventListener('drop', (event) => {
      event.preventDefault();
      setProblem(t('استخدم اللصق لإضافة النص والصور المنسّقة.'));
    });
  };
  return (
    <div className="rich-text-editor" data-field={path}>
      <div className="rich-editor-heading">
        <strong>{label}</strong>
        <div className="toolbar">
          <button
            type="button"
            className={mode === 'visual' ? 'primary small-button' : 'secondary small-button'}
            aria-pressed={mode === 'visual'}
            onClick={() => {
              initialized.current = false;
              setMode('visual');
            }}
          >
            {t('تعديل بصري')}
          </button>
          <button
            type="button"
            className={mode === 'code' ? 'primary small-button' : 'secondary small-button'}
            aria-pressed={mode === 'code'}
            onClick={() => {
              initialized.current = false;
              setMode('code');
            }}
          >
            {t('كود HTML')}
          </button>
        </div>
      </div>
      {mode === 'visual' ? (
        <>
          <div className="rich-editor-tools" role="toolbar" aria-label={t('تنسيق الوصف')}>
            {(
              [
                'bold',
                'italic',
                'underline',
                'insertUnorderedList',
                'insertOrderedList',
                'justifyRight',
                'justifyCenter',
                'justifyLeft',
                'undo',
                'redo',
                'removeFormat',
              ] as const
            ).map((name) => (
              <button
                type="button"
                key={name}
                className="secondary small-button"
                disabled={loading}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => command(name)}
              >
                {t(
                  {
                    bold: 'عريض',
                    italic: 'مائل',
                    underline: 'تحته خط',
                    insertUnorderedList: 'قائمة نقطية',
                    insertOrderedList: 'قائمة مرقمة',
                    justifyRight: 'محاذاة لليمين',
                    justifyCenter: 'توسيط',
                    justifyLeft: 'محاذاة لليسار',
                    undo: 'تراجع',
                    redo: 'إعادة',
                    removeFormat: 'إزالة التنسيق',
                  }[name],
                )}
              </button>
            ))}
            <select
              aria-label={t('نوع الفقرة')}
              defaultValue="p"
              disabled={loading}
              onMouseDown={remember}
              onChange={(event) => command('formatBlock', event.target.value)}
            >
              <option value="p">{t('فقرة')}</option>
              <option value="h2">{t('عنوان')}</option>
              <option value="h3">{t('عنوان فرعي')}</option>
            </select>
            <label>
              {t('لون النص')}
              <input
                type="color"
                defaultValue="#173d35"
                disabled={loading}
                onFocus={remember}
                onChange={(event) => command('foreColor', event.target.value)}
              />
            </label>
          </div>
          {loading && <p className="muted">{t('جارٍ تجهيز المحرر…')}</p>}
          <iframe
            ref={frame}
            title={t('المحرر البصري · ') + label}
            className="rich-editor-frame"
            sandbox="allow-same-origin"
            srcDoc={document}
            onLoad={loaded}
            aria-invalid={!!error}
          />
          <small className="muted">
            {t('اضغط داخل الوصف وعدّل النص مباشرة. التنسيق يظهر كما سيظهر للزائر.')}
          </small>
        </>
      ) : (
        <textarea
          value={value}
          aria-label={label}
          aria-invalid={!!error}
          onChange={(event) => {
            lastEmitted.current = undefined;
            change.current(event.target.value);
          }}
          rows={12}
        />
      )}
      {(problem || error) && (
        <p className="field-error" role="alert">
          {error || problem}
        </p>
      )}
    </div>
  );
}
