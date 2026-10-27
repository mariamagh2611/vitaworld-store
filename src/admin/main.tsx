import { Analytics } from './analytics';
import { MAX_ADDITIONAL_META_PIXELS } from '../shared/meta-pixels';
import { campaignSourceNames as sourceNames } from '../shared/campaigns';
import { BundlesEditor } from './bundles';
import { BulkImporter } from './bulk-import';
import { localizedCategory } from '../shared/i18n';
import { normalizeSearch } from '../shared/search';
import { policyKeys, policyLabels, policyVisible } from '../shared/policies';
import { productCopy, updateProductCopy, type ProductCopy } from './product-copy';
import {
  landingFormAppearance,
  landingAppearanceLabels,
  landingBadgeText,
} from '../shared/landing-appearance';
import { toLocalDateTime, toUtcDateTime } from './deadline';
import { pricedProduct } from '../shared/commerce';
import { keepAccordionHeader } from './accordion';
import { ProfitPreview } from './profit-preview';
import {
  shippingLabels,
  financialLabels,
  financialLabel,
  orderPhaseLabels,
  callLabels,
  activeCallStatus,
  closedOrder,
  statusTone,
  postponementNote,
  cancellationReason,
  postponementDate,
} from '../shared/order-status';
import { businessDate } from '../shared/time';
import React, { useEffect, useState, createContext, useContext, useId, useRef } from 'react';
import type { Category } from '../shared/types';
import type { FieldIssue } from '../shared/validation';
import { createRoot } from 'react-dom/client';
import { prepareImage } from './images';
import {
  productFromCatalog,
  importedDescription,
  emptyProduct,
  catalogText,
} from './catalog-import';
import { RecommendationPicker } from './recommendations';
import { RichTextEditor } from './rich-text-editor';
import { ImageHint, ImageGuide, type ImagePurpose } from './image-guide';
import { OrderPricingPanel } from './order-pricing';
import { OrderIcon } from './order-icons';
import { OrderReceipt } from './order-receipt';
import { orderPricing } from '../shared/order-pricing';
import '../styles.css';
import {
  defaults,
  PRODUCT_DESCRIPTION_LIMIT,
  formDefaults,
  type FormContent,
  type Settings,
  type Product,
  type ShippingCosts,
  type Block,
} from '../shared/types';
import { t, money, adminLanguage, setAdminLanguage } from './language';
import {
  languageNames,
  direction,
  languages,
  languageOf,
  storefrontSettings,
  storeTranslator,
  storeCopyKeys,
  updateContent,
  contentKeys,
  localizedForm,
  localizedLandingButton,
  enabledStoreLanguages,
} from '../shared/i18n';
import type { Language } from '../shared/types';
let csrf = '';
class ApiError extends Error {
  constructor(
    message: string,
    public details: FieldIssue[] = [],
  ) {
    super(message);
  }
}
const FieldErrors = createContext<Record<string, FieldIssue>>({});
async function api<T = any>(
  path: string,
  body?: unknown,
  method = body ? 'POST' : 'GET',
): Promise<T> {
  const form = body instanceof FormData;
  const r = await fetch('/api' + path, {
    method,
    headers: {
      ...(!form ? { 'Content-Type': 'application/json' } : {}),
      'X-CSRF-Token': csrf,
      'X-UI-Language': adminLanguage(),
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new ApiError(data.message || t('تعذر إتمام العملية.'), data.details || []);
  return data;
}
async function upload(file: File) {
  const { blob, width, height } = await prepareImage(file);
  const form = new FormData();
  form.append('file', blob, 'image.webp');
  form.append('width', String(width));
  form.append('height', String(height));
  return api<{ url: string; width: number; height: number }>('/admin/media', form);
}
type Action = (fn: () => Promise<unknown>, message?: string) => Promise<void>;
function Field({
  label,
  value,
  onChange,
  type = 'text',
  wide = false,
  autoComplete,
  required = false,
  minLength,
  min,
  max,
  step,
  path,
  secret = false,
  dir,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  wide?: boolean;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  min?: number;
  max?: number;
  step?: number;
  path?: string;
  secret?: boolean;
  dir?: 'rtl' | 'ltr' | 'auto';
}) {
  const error = useContext(FieldErrors)[path || ''],
    id = useId();
  const [visible, setVisible] = useState(false);
  useEffect(() => setVisible(false), [label]);
  if (type === 'password')
    return (
      <div className={wide ? 'wide' : ''} data-field={path}>
        <label htmlFor={id}>{label}</label>
        <div className="password-input">
          <input
            id={id}
            type={visible ? 'text' : 'password'}
            value={value}
            autoComplete={autoComplete}
            required={required}
            minLength={minLength}
            aria-invalid={!!error}
            aria-describedby={error ? id + '-error' : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          {!secret && (
            <button
              type="button"
              aria-label={(visible ? t('إخفاء ') : t('إظهار ')) + label}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? t('إخفاء') : t('إظهار')}
            </button>
          )}
        </div>
        {error && (
          <small className="field-error" id={id + '-error'}>
            {error.message}
          </small>
        )}
      </div>
    );
  return (
    <div className={'field' + (wide ? ' wide' : '')} data-field={path}>
      <label htmlFor={id}>{label}</label>
      {type === 'textarea' ? (
        <textarea
          id={id}
          dir={dir || 'auto'}
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? id + '-error' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          dir={dir || (['tel', 'email', 'url', 'number'].includes(type) ? 'ltr' : 'auto')}
          type={type}
          min={min}
          max={max}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          step={step ?? (type === 'number' ? 'any' : undefined)}
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? id + '-error' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error && (
        <small className="field-error" id={id + '-error'}>
          {error.message}
        </small>
      )}
    </div>
  );
}
function Check({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="admin-check">
      <input
        type="checkbox"
        disabled={disabled}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
function Upload({
  onUpload,
  action,
  label = t('رفع صورة'),
  purpose = 'general',
  multiple = false,
  compact = false,
  maxFiles = 1,
  onUploads,
}: {
  onUpload?: (data: { url: string; width: number; height: number }) => void;
  action: Action;
  label?: string;
  purpose?: ImagePurpose;
  multiple?: boolean;
  compact?: boolean;
  maxFiles?: number;
  onUploads?: (data: { url: string; width: number; height: number }[]) => void;
}) {
  return (
    <div className="image-upload" data-image-purpose={purpose}>
      <label className="small-button">
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple={multiple}
          onChange={(e) => {
            const files = Array.from(e.target.files || []).slice(0, maxFiles);
            if (files.length)
              void action(async () => {
                const results = [];
                for (const file of files) results.push(await upload(file));
                if (onUploads) onUploads(results);
                else results.forEach((result) => onUpload?.(result));
              }, t('تم تجهيز الصورة ورفعها.'));
            e.target.value = '';
          }}
        />
      </label>
      {compact ? (
        <details className="image-upload-guide">
          <summary>{t('نصائح الصور')}</summary>
          <ImageHint purpose={purpose} />
        </details>
      ) : (
        <ImageHint purpose={purpose} />
      )}
    </div>
  );
}
const labels: Record<string, string> = {
  overview: 'نظرة عامة',
  orders: 'الطلبات',
  products: 'المنتجات والصفحات',
  categories: 'أقسام المنتجات',
  analytics: 'مصادر المبيعات',
  pixels: 'البكسلات والتتبع',
  settings: 'إعدادات المتجر',
  appearance: 'الرئيسية والمظهر',
  integration: 'الربط مع مورد',
  media: 'مكتبة الصور',
  account: 'حساب المالك',
};
function App() {
  const feedback = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [language, updateLanguage] = useState(adminLanguage());
  useEffect(() => {
    const listener = () => updateLanguage(adminLanguage());
    window.addEventListener('admin-language', listener);
    return () => window.removeEventListener('admin-language', listener);
  }, []);
  const [auth, setAuth] = useState<any>(null),
    [page, setPage] = useState(
      location.pathname.split('/')[2] === 'jobs'
        ? 'integration'
        : location.pathname.split('/')[2] || 'overview',
    ),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notices, setNotices] = useState<any[]>([]);
  const refreshAuth = async () => {
    const a = await api('/auth/status');
    csrf = a.csrf || '';
    if (a.authenticated) setAdminLanguage(languageOf(a.adminLanguage));
    setAuth(a);
  };
  useEffect(() => {
    const finishSetup = async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get('setup');
      if (token) {
        history.replaceState({}, '', location.pathname + location.search);
        try {
          await api('/auth/bootstrap', { token });
        } catch (e) {
          setError(t((e as Error).message));
        }
      }
      await refreshAuth();
    };
    const finish = () => void finishSetup().catch((e) => setError(t(e.message)));
    finish();
    const handler = () =>
      setPage(
        location.pathname.split('/')[2] === 'jobs'
          ? 'integration'
          : location.pathname.split('/')[2] || 'overview',
      );
    window.addEventListener('popstate', handler);
    window.addEventListener('hashchange', finish);
    return () => {
      window.removeEventListener('popstate', handler);
      window.removeEventListener('hashchange', finish);
    };
  }, []);
  const action: Action = async (fn, message = t('تم حفظ التغييرات.')) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!notice && !error) return;
    const frame = requestAnimationFrame(() => {
      if (error && document.querySelector('.admin-content [aria-invalid="true"]')) return;
      feedback.current?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'center',
      });
      feedback.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [notice, error]);
  const navigate = (p: string) => {
    history.pushState({}, '', '/admin/' + p);
    setPage(p);
    setError('');
    setNotice('');
    setMenuOpen(false);
  };
  useEffect(() => setMenuOpen(false), [page, auth?.authenticated]);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() =>
      sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus(),
    );
    const closeOnResize = () => {
      if (innerWidth > 900) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
      }
      if (event.key !== 'Tab') return;
      const elements = Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select') ||
          [],
      ).filter((element) => element.getClientRects().length);
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('resize', closeOnResize);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('resize', closeOnResize);
      window.removeEventListener('keydown', onKey);
      menuButton.current?.focus({ preventScroll: true });
    };
  }, [menuOpen]);
  useEffect(() => {
    if (!auth?.authenticated) return;
    const update = () =>
      void api('/admin/notices')
        .then(setNotices)
        .catch(() => {});
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [auth?.authenticated]);
  if (!auth) return <div className="loading">{error || t('جارٍ تحميل لوحة الإدارة…')}</div>;
  if (!auth.authenticated)
    return (
      <>
        <div className="login-language">
          <LanguagePicker action={action} />
        </div>
        <Login auth={auth} action={action} error={error} done={refreshAuth} busy={busy} />
      </>
    );
  return (
    <div className={'admin-shell' + (menuOpen ? ' admin-menu-open' : '')}>
      {menuOpen && (
        <div
          className="admin-menu-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        ref={sidebar}
        id="admin-navigation"
        className="admin-sidebar"
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen || undefined}
        aria-label={t('قائمة الإدارة')}
      >
        <button
          type="button"
          className="admin-menu-close"
          aria-label={t('إغلاق القائمة')}
          onClick={() => setMenuOpen(false)}
        >
          ×
        </button>
        <a className="brand" href="/" target="_blank" rel="noreferrer">
          {t('دار الإدارة')}
          <span>✦</span>
        </a>
        <nav className="admin-navigation" aria-label={t('صفحات الإدارة')}>
          {Object.entries(labels).map(([key, label]) => (
            <a
              key={key}
              href={'/admin/' + key}
              className={page === key ? 'active' : ''}
              aria-current={page === key ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(key);
              }}
            >
              {t(label)}
            </a>
          ))}
        </nav>
        <LanguagePicker authenticated={auth.authenticated} action={action} />
        <a className="sidebar-bottom" href="/" target="_blank" rel="noreferrer">
          {t('عرض المتجر ↗')}
        </a>
        <a
          className="sidebar-mowarid-link"
          href="https://mowarid.ma/login"
          target="_blank"
          rel="noopener noreferrer"
        >
          <OrderIcon name="send" />
          {t('حسابي في مورد')}
        </a>
        <button
          className="small-button logout-button"
          onClick={() =>
            void action(async () => {
              await api('/admin/logout', {});
              await refreshAuth();
            }, '')
          }
        >
          {t('تسجيل الخروج')}
        </button>
      </aside>
      <main className="admin-content" aria-busy={busy} inert={menuOpen || undefined}>
        <header className="admin-header">
          <div className="admin-heading">
            <button
              type="button"
              ref={menuButton}
              className="admin-menu-toggle"
              aria-label={t('فتح قائمة الإدارة')}
              aria-controls="admin-navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1>{t(labels[page] || 'لوحة الإدارة')}</h1>
              <p>{t('كل تفاصيل متجرك، في مكان واحد.')}</p>
            </div>
          </div>
          <a href="/" target="_blank" rel="noreferrer" className="secondary">
            {t('معاينة المتجر ↗')}
          </a>
        </header>
        {error && (
          <div role="alert" className="notice" ref={feedback} tabIndex={-1}>
            {error}
          </div>
        )}
        {notices.map((n) => (
          <div role="alert" className="notice" key={n.id}>
            {t(n.message)}
            {n.action === 'cloudflare' ? (
              <a
                href="https://dash.cloudflare.com"
                target="_blank"
                rel="noreferrer"
                className="small-button"
              >
                {t('فتح حساب Cloudflare')}
              </a>
            ) : n.action === 'pixels' ? (
              <>
                <button className="small-button" onClick={() => navigate('pixels')}>
                  {t('إعداد البكسلات')}
                </button>
                <button
                  className="small-button"
                  onClick={() =>
                    void action(async () => {
                      await api('/admin/pixels/retry', {});
                      setNotices(await api('/admin/notices'));
                    }, t('أُعيدت جدولة الأحداث المؤهلة. تأكد من اكتمال إعداد Meta.'))
                  }
                >
                  {t('إعادة المحاولة')}
                </button>
              </>
            ) : (
              <button
                className="small-button"
                onClick={() =>
                  void action(async () => {
                    await api('/admin/sync/backup', {});
                    setNotices(await api('/admin/notices'));
                  }, t('بدأ حفظ نسخة الأمان.'))
                }
              >
                {t('إعادة المحاولة')}
              </button>
            )}
          </div>
        ))}
        {notice && (
          <div role="status" className="notice success" ref={feedback} tabIndex={-1}>
            {notice}
          </div>
        )}
        {busy && <p className="muted">{t('جارٍ تنفيذ العملية…')}</p>}
        {page === 'overview' || page === 'analytics' ? (
          <Analytics key={page} api={api} action={action} full={page === 'analytics'} />
        ) : page === 'products' ? (
          <Products
            action={action}
            clearValidation={() => {
              setError('');
              setNotice('');
            }}
          />
        ) : page === 'categories' ? (
          <Categories action={action} />
        ) : page === 'orders' ? (
          <Orders action={action} />
        ) : ['settings', 'appearance', 'pixels', 'integration'].includes(page) ? (
          <SettingsPage kind={page} action={action} />
        ) : page === 'media' ? (
          <Media action={action} />
        ) : page === 'account' ? (
          <Account action={action} />
        ) : null}
      </main>
    </div>
  );
}
function RecoveryFile({
  codes,
  email,
  done,
  backupKey,
}: {
  backupKey?: string;
  codes: string[];
  email: string;
  done?: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const download = () => {
    const data = {
      format: 'mowarid-owner-recovery',
      version: 1,
      store: location.origin,
      email,
      codes,
      createdAt: new Date().toISOString(),
      ...(backupKey ? { backupKey } : {}),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'store-recovery.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  };
  return (
    <>
      <p>
        {t(
          'نزّل ملف الاسترداد واحفظه في مكان خاص. إذا نسيت كلمة المرور، اختر «نسيت كلمة المرور» وارفع هذا الملف. لا تشاركه مع أي شخص.',
        )}
      </p>
      <button className="primary" type="button" onClick={download}>
        {t('تنزيل ملف الاسترداد')}
      </button>
      <details className="recovery-details">
        <summary>{t('عرض الرموز للحفظ اليدوي')}</summary>
        <pre className="recovery-codes">{codes.join('\n')}</pre>
      </details>
      {done && (
        <button className="secondary" type="button" disabled={!saved} onClick={done}>
          {t('حفظت الملف · دخول الإدارة')}
        </button>
      )}
    </>
  );
}
function Login({
  auth,
  action,
  error,
  done,
  busy,
}: {
  auth: any;
  action: Action;
  error: string;
  done: () => Promise<void>;
  busy: boolean;
}) {
  const [setupCode, setSetupCode] = useState(''),
    [siteKey, setSiteKey] = useState(''),
    [setupSecret, setSetupSecret] = useState(''),
    [backupKey, setBackupKey] = useState('');
  const captchaSiteKey = auth.setup
    ? /^0x[A-Za-z0-9_-]{15,98}$/.test(siteKey.trim())
      ? siteKey.trim()
      : ''
    : auth.turnstileSiteKey;
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [recover, setRecover] = useState(false),
    [code, setCode] = useState(''),
    [codes, setCodes] = useState<string[]>([]),
    [captcha, setCaptcha] = useState(''),
    [captchaVersion, setCaptchaVersion] = useState(0),
    [captchaError, setCaptchaError] = useState(false),
    [fileName, setFileName] = useState('');
  useEffect(() => {
    if (
      !captchaSiteKey ||
      (auth.setup && (!auth.manualBootstrap || !auth.canSetup)) ||
      codes.length
    )
      return;
    let widget: string | undefined,
      disposed = false;
    setCaptcha('');
    setCaptchaError(false);
    const render = () => {
      if (disposed) return;
      widget = (window as any).turnstile.render('#admin-captcha', {
        sitekey: captchaSiteKey,
        action: auth.setup ? 'setup' : recover ? 'recover' : 'login',
        callback: (value: string) => {
          setCaptcha(value);
          setCaptchaError(false);
        },
        'expired-callback': () => setCaptcha(''),
        'error-callback': () => {
          setCaptcha('');
          setCaptchaError(true);
        },
      });
    };
    const failed = () => setCaptchaError(true);
    let script = document.querySelector<HTMLScriptElement>('script[data-owner-turnstile]');
    if ((window as any).turnstile) render();
    else {
      if (!script) {
        script = document.createElement('script');
        script.dataset.ownerTurnstile = 'true';
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        document.head.append(script);
      }
      script.addEventListener('load', render);
      script.addEventListener('error', failed);
    }
    return () => {
      disposed = true;
      script?.removeEventListener('load', render);
      script?.removeEventListener('error', failed);
      if (widget !== undefined) (window as any).turnstile?.remove(widget);
    };
  }, [captchaSiteKey, auth.canSetup, auth.setup, recover, codes.length, captchaVersion]);
  const accept = async (r: any) => {
    if (r.csrf) csrf = r.csrf;
    if (r.email) setEmail(r.email);
    if (r.installationKey) setBackupKey(r.installationKey);
    setSetupSecret('');
    setSetupCode('');
    if (r.recovery) setCodes(r.recovery);
    else await done();
  };
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand">
          {auth.logo ? (
            <img className="owner-logo" src={auth.logo} alt="" />
          ) : (
            <span className="brand-mark">{t('د')}</span>
          )}
          {t('إدارة')}
          {auth.brand || t('المتجر')}
        </div>
        <h1>
          {codes.length
            ? t('احفظ وسيلة استعادة حسابك')
            : auth.setup
              ? t('أهلاً بمتجرك الجديد')
              : recover
                ? t('استعادة حسابك')
                : t('تسجيل الدخول')}
        </h1>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {codes.length ? (
          <>
            <RecoveryFile
              codes={codes}
              email={email}
              backupKey={backupKey}
              done={() => void done()}
            />
          </>
        ) : auth.setup && !auth.canSetup ? (
          auth.manualBootstrap ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  await api('/auth/bootstrap', { token: setupCode });
                  setSetupCode('');
                  await done();
                }, '');
              }}
            >
              <p>
                {t(
                  'أدخل رمز التثبيت الخاص الذي اخترته في Cloudflare. يُستخدم مرة واحدة لإنشاء حسابك.',
                )}
              </p>
              <Field
                label={t('رمز التثبيت الخاص')}
                type="password"
                value={setupCode}
                onChange={setSetupCode}
                required
                autoComplete="off"
              />
              <button className="primary" disabled={busy}>
                {t('متابعة إنشاء الحساب')}
              </button>
            </form>
          ) : (
            <p>
              {t(
                'لم يكتمل إنشاء حساب المالك بعد. استخدم النافذة التي يفتحها التثبيت تلقائيًا لإكمال الإعداد بأمان.',
              )}
            </p>
          )
        ) : (
          <>
            {auth.setup && (
              <p className="muted">{t('اختر بريدك وكلمة مرورك. هذه الخطوة مطلوبة مرة واحدة.')}</p>
            )}
            {recover && (
              <p className="muted">
                {t(
                  'اختر كلمة مرور جديدة، ثم استخدم ملف الاسترداد أو مفتاح الدخول الذي حفظته سابقًا.',
                )}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  try {
                    const r = auth.setup
                      ? await api('/auth/setup', {
                          email,
                          password,
                          ...(auth.manualBootstrap
                            ? {
                                turnstileSiteKey: siteKey,
                                turnstileSecret: setupSecret,
                                turnstileToken: captcha,
                              }
                            : {}),
                        })
                      : recover
                        ? await api('/auth/recover', {
                            email,
                            password,
                            code,
                            turnstileToken: captcha,
                          })
                        : await api('/auth/login', { email, password, turnstileToken: captcha });
                    await accept(r);
                  } finally {
                    setCaptchaVersion((v) => v + 1);
                  }
                }, '');
              }}
            >
              {auth.setup && auth.manualBootstrap && (
                <section className="setup-security-fields">
                  <h3>{t('حماية متجرك من الطلبات الآلية')}</h3>
                  <p>
                    {t(
                      'أنشئ أداة Turnstile مجانية في Cloudflare بوضع Invisible، وأضف نطاق متجرك أدناه، ثم انسخ المفتاحين.',
                    )}
                  </p>
                  <code>{location.hostname}</code>
                  <p>
                    <a
                      href="https://dash.cloudflare.com/?to=/:account/turnstile"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('فتح Cloudflare Turnstile')}
                    </a>
                  </p>
                  <Field
                    label={t('Turnstile Site Key')}
                    value={siteKey}
                    onChange={setSiteKey}
                    required
                    autoComplete="off"
                  />
                  <Field
                    label={t('Turnstile Secret Key')}
                    value={setupSecret}
                    onChange={setSetupSecret}
                    required
                    type="password"
                    autoComplete="off"
                  />
                  <div id="admin-captcha"></div>
                </section>
              )}
              <Field
                label={t('البريد الإلكتروني')}
                value={email}
                onChange={setEmail}
                type="email"
                autoComplete="username"
                required
              />
              <Field
                label={recover ? t('كلمة المرور الجديدة') : t('كلمة المرور')}
                value={password}
                onChange={setPassword}
                type="password"
                autoComplete={auth.setup || recover ? 'new-password' : 'current-password'}
                minLength={auth.setup || recover ? 8 : undefined}
                required
              />
              {(auth.setup || recover) && (
                <p className="muted">{t('8 أحرف على الأقل، تتضمن حروفًا وأرقامًا.')}</p>
              )}
              {recover && (
                <>
                  <label className="small-button">
                    {t('اختيار ملف الاسترداد')}
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file)
                          void action(async () => {
                            if (file.size > 16384)
                              throw new Error(t('اختر ملف الاسترداد الذي نزّلته من حساب المتجر.'));
                            let data;
                            try {
                              data = JSON.parse(await file.text());
                            } catch {
                              throw new Error(t('ملف الاسترداد غير صالح.'));
                            }
                            if (
                              data.format !== 'mowarid-owner-recovery' ||
                              data.version !== 1 ||
                              typeof data.email !== 'string' ||
                              !Array.isArray(data.codes) ||
                              !data.codes.length ||
                              data.codes.some(
                                (v: unknown) => typeof v !== 'string' || v.length > 100,
                              )
                            )
                              throw new Error(t('ملف الاسترداد غير صالح.'));
                            setEmail(data.email);
                            setCode(data.codes[0]);
                            setFileName(file.name);
                          }, '');
                      }}
                    />
                  </label>
                  {fileName && (
                    <p role="status" className="muted">
                      {t('تم اختيار ملف الاسترداد.')}
                    </p>
                  )}
                  <details className="recovery-details">
                    <summary>{t('لديّ رمز محفوظ بدل الملف')}</summary>
                    <Field
                      label={t('رمز الاسترداد')}
                      value={code}
                      onChange={setCode}
                      autoComplete="off"
                    />
                  </details>
                </>
              )}
              {!auth.setup && <div id="admin-captcha" />}
              {captchaError && (
                <p className="error-text">
                  {t('تعذر التحقق الأمني. تحقق من الاتصال ثم')}{' '}
                  <button
                    type="button"
                    className="small-button"
                    onClick={() => setCaptchaVersion((v) => v + 1)}
                  >
                    {t('أعد المحاولة')}
                  </button>
                </p>
              )}
              <button
                className="primary"
                disabled={
                  busy ||
                  (auth.setup &&
                    auth.manualBootstrap &&
                    (!captchaSiteKey || !setupSecret || !captcha)) ||
                  (!auth.setup && !!auth.turnstileSiteKey && !captcha) ||
                  (recover && !code)
                }
                type="submit"
              >
                {auth.setup
                  ? t('إنشاء حسابي')
                  : recover
                    ? t('استعادة الحساب بالملف')
                    : t('تسجيل الدخول')}
              </button>
            </form>
            {!auth.setup && (
              <div className="login-actions">
                <button
                  className="small-button"
                  type="button"
                  onClick={() => {
                    setRecover(!recover);
                    setPassword('');
                  }}
                >
                  {recover ? t('العودة لتسجيل الدخول') : t('نسيت كلمة المرور')}
                </button>
              </div>
            )}
          </>
        )}
        {auth.privacyVisible !== false && (
          <p className="login-privacy">
            <a href="/policies/privacy" target="_blank" rel="noreferrer">
              {t('سياسة الخصوصية')}
            </a>
          </p>
        )}
      </section>
    </main>
  );
}
function SettingsPage({ kind, action }: { kind: string; action: Action }) {
  const saveLock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [freeShippingEnabled, setFreeShippingEnabled] = useState(false);
  const [editingLanguage, setEditingLanguage] = useState<Language>('ar');
  const [savingLanguages, setSavingLanguages] = useState(false);
  const [s, setS] = useState<Settings>(defaults),
    [ready, setReady] = useState(false),
    [secrets, setSecrets] = useState({ mowarid: '', meta: '' }),
    [saved, setSaved] = useState<string[]>([]),
    [health, setHealth] = useState(''),
    [pixelSnippet, setPixelSnippet] = useState(''),
    [pixelStatus, setPixelStatus] = useState<any>(null),
    [metaTestCode, setMetaTestCode] = useState(''),
    [testingMeta, setTestingMeta] = useState(false),
    [additionalSecrets, setAdditionalSecrets] = useState<Record<string, string>>({}),
    [additionalTests, setAdditionalTests] = useState<Record<string, string>>({}),
    [integrationStatus, setIntegrationStatus] = useState<any>(null);
  const refreshPixelStatus = async () => setPixelStatus(await api('/admin/pixels/status'));
  const load = async () => {
    const r = await api('/admin/settings');
    setS(r.settings);
    setEditingLanguage(r.settings.storeLanguage);
    setFreeShippingEnabled(r.settings.cartFreeShippingThreshold > 0);
    setSaved(r.credentials);
    setReady(true);
  };
  useEffect(() => {
    void action(load, '');
  }, [kind]);
  useEffect(() => {
    if (kind === 'pixels') void refreshPixelStatus().catch(() => {});
  }, [kind]);
  useEffect(() => {
    if (kind !== 'integration') return;
    const update = () =>
      void api('/admin/integration/status')
        .then(setIntegrationStatus)
        .catch(() => {});
    update();
    const timer = setInterval(update, 8000);
    return () => clearInterval(timer);
  }, [kind]);
  const displayed = storefrontSettings({ ...s, storeLanguage: editingLanguage });
  const availableLanguages = enabledStoreLanguages(s);
  const saveStoreLanguages = (storeLanguage: Language, storeLanguages: Language[]) => {
    const previous = { storeLanguage: s.storeLanguage, storeLanguages: s.storeLanguages };
    setS((current) => ({ ...current, storeLanguage, storeLanguages }));
    setSavingLanguages(true);
    void action(async () => {
      try {
        const next = await api(
          '/admin/store-languages',
          { storeLanguage, storeLanguages },
          'PATCH',
        );
        setS((current) => ({ ...current, ...next }));
      } catch (error) {
        setS((current) => ({ ...current, ...previous }));
        throw error;
      } finally {
        setSavingLanguages(false);
      }
    }, '');
  };
  const chooseLanguages = (storeLanguages: Language[]) => {
    if (!storeLanguages.length || savingLanguages) return;
    saveStoreLanguages(
      storeLanguages.includes(s.storeLanguage) ? s.storeLanguage : storeLanguages[0],
      storeLanguages,
    );
  };
  const field = (key: keyof Settings, label: string, type = 'text', wide = false) => (
    <Field
      key={key}
      label={label}
      value={displayed[key] as string | number}
      onChange={(v) =>
        setS(
          contentKeys.includes(key as any)
            ? updateContent(s, { [key]: v }, editingLanguage)
            : { ...s, [key]: type === 'number' ? Math.round(Number(v) * 100) : v },
        )
      }
      type={type}
      wide={wide}
    />
  );
  const productInfoField = (
    key: Exclude<keyof Settings['productInfo'], 'showDeliveryReturns'>,
    label: string,
    type = 'text',
  ) => (
    <Field
      label={label}
      type={type}
      value={displayed.productInfo[key]}
      onChange={(value) =>
        setS(
          updateContent(
            s,
            { productInfo: { ...displayed.productInfo, [key]: value } },
            editingLanguage,
          ),
        )
      }
    />
  );
  const price = (key: 'shippingCasa' | 'shippingOther', label: string) => (
    <Field
      label={label}
      value={s[key] / 100}
      onChange={(v) => setS({ ...s, [key]: Math.round(Number(v) * 100) })}
      type="number"
    />
  );
  const save = async () => {
    if (freeShippingEnabled && s.cartFreeShippingThreshold <= 0)
      throw new Error(t('أدخل مبلغًا أكبر من صفر لتفعيل الشحن المجاني للسلة.'));
    await api('/admin/settings', { ...s, adminLanguage: adminLanguage() }, 'PUT');
    if (kind === 'pixels') {
      if (secrets.meta.trim()) {
        await api('/admin/credentials', { meta: secrets.meta.trim() }, 'PUT');
        setSecrets((current) => ({ ...current, meta: '' }));
      }
      for (const destination of s.facebookAdditionalPixels) {
        const token = additionalSecrets[destination.id]?.trim();
        if (!token) continue;
        await api('/admin/credentials', { meta: token, metaPixel: destination.pixel }, 'PUT');
        setAdditionalSecrets((current) => ({ ...current, [destination.id]: '' }));
      }
      const current = await api('/admin/settings');
      setSaved(current.credentials);
    }
    if (kind === 'pixels') await refreshPixelStatus();
  };
  if (!ready) return <p className="loading">{t('جارٍ التحميل…')}</p>;
  const saveConnection = async () => {
    if (secrets.mowarid.trim())
      await api('/admin/credentials', { mowarid: secrets.mowarid.trim() }, 'PUT');
    await save();
    setSecrets({ ...secrets, mowarid: '' });
    await load();
  };
  if (kind === 'integration')
    return (
      <section className="panel">
        <h2>{t('اربط متجرك بمنصة مورد')}</h2>
        <p>
          {t(
            'احفظ مفتاحك، افحص الاتصال، ثم زامن المنتجات. بعد ذلك تُحدّث المنتجات وحالات الطلبات تلقائيًا.',
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(saveConnection, t('تم حفظ الربط مع مورد.'));
          }}
        >
          <Field
            label={t('مفتاح مورد') + (saved.includes('mowarid') ? t(' · محفوظ') : '')}
            value={secrets.mowarid}
            onChange={(v) => setSecrets({ ...secrets, mowarid: v })}
            type="password"
            autoComplete="off"
          />
          {saved.includes('mowarid') && (
            <p className="muted">{t('اترك الخانة فارغة للاحتفاظ بالمفتاح المحفوظ.')}</p>
          )}
          <Check
            label={t('إرسال الطلبات تلقائيًا إلى مورد')}
            value={s.autoConfirm}
            onChange={(v) => setS({ ...s, autoConfirm: v })}
          />
          <p className="muted">
            {t(
              'عند تعطيله، تؤكد الطلب هاتفيًا ثم ترسله من صفحة الطلبات. عند تفعيله، يصل الطلب إلى مورد بعد حفظه في المتجر.',
            )}
          </p>
          <div className="toolbar">
            <button type="submit" className="primary">
              {t('حفظ')}
            </button>
            <button
              type="button"
              onClick={() =>
                void action(async () => {
                  await saveConnection();
                  await api('/admin/connection', {});
                  setHealth(t('الاتصال بمورد سليم.'));
                }, '')
              }
            >
              {t('فحص الاتصال')}
            </button>
            <button
              type="button"
              onClick={() =>
                void action(async () => {
                  await saveConnection();
                  await api('/admin/integration/sync', {});
                  setIntegrationStatus(await api('/admin/integration/status'));
                }, t('بدأ تحديث منتجات مورد والمدن. تظهر المنتجات تدريجيًا، ويستمر التحديث تلقائيًا.'))
              }
            >
              {t('مزامنة المنتجات')}
            </button>
          </div>
        </form>
        {health && <p className="notice success">{health}</p>}
        {integrationStatus && (
          <div className="integration-summary">
            <p role="status">
              {integrationStatus.syncing
                ? t('جارٍ تحديث المنتجات والمدن…')
                : integrationStatus.ready
                  ? t('الربط جاهز')
                  : saved.includes('mowarid')
                    ? t('زامن المنتجات لإكمال الربط')
                    : t('أدخل مفتاح مورد للبدء')}
            </p>
            {integrationStatus.products > 0 && (
              <p>
                {t('المنتجات والمتغيرات المتاحة للاختيار:')}
                {integrationStatus.products}
              </p>
            )}
            {integrationStatus.lastUpdated && (
              <p className="muted">
                {t('آخر تحديث:')}{' '}
                {new Date(integrationStatus.lastUpdated).toLocaleString(
                  adminLanguage() === 'ar' ? 'ar-MA' : adminLanguage(),
                  {
                    timeZone: 'Africa/Casablanca',
                  },
                )}
              </p>
            )}
            {saved.includes('mowarid') && (
              <p>
                {integrationStatus.liveUpdates
                  ? t('تحديث حالات الطلبات المباشر: متصل')
                  : t('تحديث حالات الطلبات: المزامنة الاحتياطية تعمل')}
              </p>
            )}
            {integrationStatus.liveUpdatesError && (
              <>
                <p className="muted">{t(integrationStatus.liveUpdatesError)}</p>
                <button
                  onClick={() =>
                    void action(async () => {
                      await api('/admin/integration/webhooks', {});
                      setIntegrationStatus(await api('/admin/integration/status'));
                    }, t('بدأ فحص التحديث المباشر.'))
                  }
                >
                  {t('إعادة فحص التحديث المباشر')}
                </button>
              </>
            )}
            {integrationStatus.error && <p className="notice">{t(integrationStatus.error)}</p>}
          </div>
        )}
      </section>
    );

  return (
    <section className="panel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (saveLock.current) return;
          saveLock.current = true;
          setSaving(true);
          void action(save).finally(() => {
            saveLock.current = false;
            setSaving(false);
          });
        }}
      >
        {['settings', 'appearance'].includes(kind) && (
          <label className="content-language-picker">
            {t('لغة المحتوى الذي تعدّله')}
            <select
              aria-label={t('لغة المحتوى الذي تعدّله')}
              value={editingLanguage}
              onChange={(event) => setEditingLanguage(languageOf(event.target.value))}
            >
              {languages.map((language) => (
                <option value={language} key={language}>
                  {languageNames[language]}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="settings-grid">
          {kind === 'settings' ? (
            <>
              <div className="wide translation-settings">
                <LanguagePicker authenticated action={action} />
                <fieldset className="store-languages-settings" disabled={savingLanguages}>
                  <legend>{t('اللغات المتاحة للزائر')}</legend>
                  {languages.map((language) => (
                    <Check
                      key={language}
                      label={t('تفعيل اللغة {language}', { language: languageNames[language] })}
                      disabled={
                        availableLanguages.length === 1 && availableLanguages.includes(language)
                      }
                      value={availableLanguages.includes(language)}
                      onChange={(enabled) =>
                        chooseLanguages(
                          enabled
                            ? [...availableLanguages, language]
                            : availableLanguages.filter((value) => value !== language),
                        )
                      }
                    />
                  ))}
                </fieldset>
                <label>
                  {t('اللغة الافتراضية للمتجر')}
                  <select
                    aria-label={t('اللغة الافتراضية للمتجر')}
                    disabled={savingLanguages}
                    value={s.storeLanguage}
                    onChange={(event) =>
                      saveStoreLanguages(languageOf(event.target.value), availableLanguages)
                    }
                  >
                    {availableLanguages.map((language) => (
                      <option value={language} key={language}>
                        {languageNames[language]}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  {t(
                    'يظهر زر تبديل اللغة للزبون عند تفعيل أكثر من لغة. احتفظ بلغة واحدة على الأقل؛ اختيار الزبون لا يغيّر لغة الإدارة أو اللغة الافتراضية.',
                  )}
                </p>
                <p className="muted">
                  {t('لغتان مستقلتان؛ تغيير لغة الإدارة لا يغيّر لغة المتجر.')}
                </p>
                <p className="muted">
                  {t(
                    'تُجهّز عبارات الواجهة تلقائيًا. تُحفظ تعديلات كل لغة منفصلة. الصور وأسماء المنتجات والمحتوى الخاص لا تُترجم تلقائيًا.',
                  )}
                </p>
              </div>
              {field('brand', t('اسم المتجر'))}
              {field('whatsapp', t('رقم واتساب بالصيغة الدولية دون +'), 'tel')}
              {field('contactEmail', t('إيميل التواصل'), 'email')}
              {field('contactPhone', t('هاتف التواصل'), 'tel')}
              <fieldset className="wide">
                <legend>{t('وسائل التواصل في الفوتر')}</legend>
                <div className="form-grid">
                  {Object.keys(s.socials).map((name) => (
                    <Field
                      key={name}
                      label={name}
                      type="url"
                      value={s.socials[name as keyof typeof s.socials]}
                      onChange={(value) => setS({ ...s, socials: { ...s.socials, [name]: value } })}
                    />
                  ))}
                </div>
              </fieldset>
              {field('announcement', t('الشريط الترويجي'), 'text', true)}
              {field('logo', t('رابط اللوجو'))}
              {field('favicon', t('رابط الأيقونة'))}
              <Upload
                action={action}
                label={t('رفع لوجو')}
                purpose="logo"
                onUpload={(r) => setS({ ...s, logo: r.url })}
              />
              <Upload
                action={action}
                label={t('رفع أيقونة')}
                purpose="favicon"
                onUpload={(r) => setS({ ...s, favicon: r.url })}
              />
              <InterfaceCopy s={s} language={editingLanguage} setS={setS} />
              {price('shippingCasa', t('شحن الطلب إلى الدار البيضاء — درهم'))}
              {price('shippingOther', t('شحن الطلب إلى باقي المدن — درهم'))}
              <div className="wide free-shipping-settings">
                <h3>{t('شحن مجاني حسب مجموع السلة')}</h3>
                <Check
                  label={t('تفعيل الشحن المجاني للسلة عند بلوغ مبلغ معين')}
                  value={freeShippingEnabled}
                  onChange={(enabled) => {
                    setFreeShippingEnabled(enabled);
                    if (!enabled) setS({ ...s, cartFreeShippingThreshold: 0 });
                  }}
                />
                {freeShippingEnabled && (
                  <Field
                    label={t('مجموع المنتجات المطلوب للشحن المجاني — درهم')}
                    value={s.cartFreeShippingThreshold ? s.cartFreeShippingThreshold / 100 : ''}
                    type="number"
                    onChange={(value) =>
                      setS({ ...s, cartFreeShippingThreshold: Math.round(Number(value) * 100) })
                    }
                  />
                )}
                <p className="muted">
                  {t(
                    'اختر المبلغ حسب دراستك. يُحسب من مجموع المنتجات بعد العروض، ويخص السلة فقط. لا يشمل طلبات اللاندينج باج. نراجع تغطية تكلفة المنتجات وتوصيل مورد قبل تفعيله.',
                  )}
                </p>
              </div>
              <p className="muted wide">
                {t('رسم واحد للطلب كاملًا. عرض الشحن المجاني يعفي السلة كاملة.')}
              </p>
              <details className="wide product-info-settings">
                <summary>{t('معلومات صفحة المنتج')}</summary>
                <div className="form-grid">
                  <Check
                    label={t('إظهار ملخص التوصيل والاسترجاع في صفحة المنتج')}
                    value={s.productInfo.showDeliveryReturns}
                    onChange={(showDeliveryReturns) =>
                      setS({ ...s, productInfo: { ...s.productInfo, showDeliveryReturns } })
                    }
                  />
                  {productInfoField('deliveryReturnsTitle', t('عنوان ملخص التوصيل والاسترجاع'))}
                  {productInfoField(
                    'deliveryReturnsText',
                    t('نص ملخص التوصيل والاسترجاع'),
                    'textarea',
                  )}
                  {productInfoField('deliveryTitle', t('عنوان أيقونة التوصيل'))}
                  {productInfoField('deliveryText', t('نص أيقونة التوصيل'), 'textarea')}
                  <p className="muted">
                    {t(
                      'استخدم {casa} و{other} لإظهار رسوم التوصيل الحالية. تعديل النص لا يغيّر الرسوم.',
                    )}
                  </p>
                  {productInfoField('paymentTitle', t('عنوان أيقونة الدفع'))}
                  {productInfoField('paymentText', t('نص أيقونة الدفع'), 'textarea')}
                </div>
              </details>
              <section className="wide policy-settings">
                <h2>{t('صفحات المتجر')}</h2>
                <p className="muted">
                  {t(
                    'اختر الصفحات التي تظهر للزائر. تعطيل الصفحة يخفي رابطها ويوقف فتحها، مع الاحتفاظ بالنص لإعادة تفعيلها لاحقًا.',
                  )}
                </p>
                <p className="muted">
                  {t(
                    'نسّق النص باستخدام # للعناوين، و**نص** للخط العريض، و- للقوائم. يظهر التنسيق تلقائيًا في صفحة المتجر.',
                  )}
                </p>
                {policyKeys.map((key) => (
                  <div className="policy-setting" key={key}>
                    <Check
                      label={t('إظهار صفحة {page}', { page: t(policyLabels[key]) })}
                      value={policyVisible(s, key)}
                      onChange={(enabled) =>
                        setS({
                          ...s,
                          policyVisibility: {
                            ...defaults.policyVisibility,
                            ...s.policyVisibility,
                            [key]: enabled,
                          },
                        })
                      }
                    />
                    {field(key, t(policyLabels[key]), 'textarea', true)}
                  </div>
                ))}
              </section>
            </>
          ) : kind === 'pixels' ? (
            <>
              {field('facebookPixel', t('معرّف بكسل Meta / Facebook'))}
              <Field
                label={t('أو الصق كود بكسل Meta لاستخراج المعرّف')}
                type="textarea"
                value={pixelSnippet}
                onChange={setPixelSnippet}
                wide
              />
              <button
                type="button"
                className="secondary"
                disabled={!pixelSnippet.trim()}
                onClick={() =>
                  void action(async () => {
                    const ids = [
                      ...new Set(
                        [
                          ...pixelSnippet.matchAll(
                            /fbq\(\s*['"]init['"]\s*,\s*['"](\d{5,30})['"]/g,
                          ),
                        ].map((m) => m[1]),
                      ),
                    ];
                    if (ids.length !== 1)
                      throw new Error(t('الصق كود بكسل واحد، أو أدخل المعرّف مباشرة.'));
                    const next = { ...s, facebookPixel: ids[0] };
                    await api('/admin/settings', next, 'PUT');
                    setS(next);
                    setPixelSnippet('');
                  }, t('تم حفظ معرّف البكسل وتفعيله.'))
                }
              >
                {t('استخراج معرّف البكسل وحفظه')}
              </button>
              <fieldset className="wide">
                <legend>TikTok Ads</legend>
                {field('tiktokPixel', 'TikTok Pixel ID')}
                <p className="muted">
                  {t(
                    'أدخل معرّف البكسل من TikTok Events Manager. نسجّل الزيارات ومشاهدة المنتجات وبدء إتمام الطلب وLead بعد حفظ الطلب بنجاح.',
                  )}
                </p>
              </fieldset>
              {field('googleId', 'Google Tag / GA4 ID')}
              <fieldset className="wide">
                <legend>Google Ads</legend>
                {field('googleAdsId', t('معرّف تحويل Google Ads (AW-)'))}
                {field('googleAdsLeadLabel', t('تصنيف تحويل الطلب (Conversion Label)'))}
                <p className="muted">
                  {t(
                    'انسخ المعرّف والتصنيف من إعداد تحويل الموقع في Google Ads. يُرسل التحويل بعد حفظ الطلب فقط، ويعني طلبًا مسجّلًا وليس بيعًا موصلًا. يمكنك إبقاء GA4 مفعّلًا معه.',
                  )}
                </p>
              </fieldset>
              {field('snapPixel', 'Snapchat Pixel ID')}
              <details className="wide">
                <summary>{t('إعداد تتبع Meta عبر السيرفر')}</summary>
                <Field
                  secret
                  autoComplete="new-password"
                  label={'Meta CAPI Token ' + (saved.includes('meta') ? t('· محفوظ') : '')}
                  type="password"
                  value={secrets.meta}
                  onChange={(v) => setSecrets({ ...secrets, meta: v })}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void action(async () => {
                      await save();
                    }, t('تم حفظ السر.'))
                  }
                >
                  {t('حفظ CAPI Token')}
                </button>
                <p className="muted">
                  {t(
                    'الرمز مشفّر على الخادم ولا يمكن استرجاع قيمته من لوحة الإدارة. اترك الخانة فارغة للاحتفاظ بالرمز المحفوظ.',
                  )}
                </p>
                <p className="muted">
                  {t(
                    'نرسل زيارات الصفحات وبدء الطلب عبر CAPI، وحدث Lead بعد حفظ الطلب. يُرسل Purchase عند التوصيل الفعلي فقط.',
                  )}
                </p>
                {pixelStatus && (
                  <p role="status">
                    {t(
                      (
                        {
                          not_configured: 'احفظ معرّف البكسل ورمز CAPI أولًا.',
                          awaiting_event: 'الرمز محفوظ. لم يُختبر قبول Meta للأحداث بعد.',
                          connected: 'أكدت Meta قبول أحداث السيرفر.',
                          rejected: 'رفضت Meta آخر محاولة. راجع معرّف البكسل وصلاحية رمز CAPI.',
                        } as Record<string, string>
                      )[pixelStatus.connection],
                    )}
                    {pixelStatus.errorCode ? ' (' + pixelStatus.errorCode + ')' : ''}
                  </p>
                )}
                {pixelStatus?.web && (
                  <p className="muted">
                    {t('أحداث الويب: أُرسلت')} {pixelStatus.web.sent}
                    {' · '}
                    {t('بانتظار الإرسال')} {pixelStatus.web.pending}
                    {' · '}
                    {t('تعذر إرسالها')} {pixelStatus.web.failed}
                  </p>
                )}
                <Field
                  label={t('رمز اختبار Meta')}
                  value={metaTestCode}
                  onChange={setMetaTestCode}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={testingMeta || !/^TEST\d{3,20}$/.test(metaTestCode.trim())}
                  onClick={() => {
                    if (testingMeta) return;
                    setTestingMeta(true);
                    void action(async () => {
                      try {
                        await api(
                          '/admin/pixels/test',
                          { testEventCode: metaTestCode.trim() },
                          'POST',
                        );
                      } finally {
                        try {
                          await refreshPixelStatus();
                        } finally {
                          setTestingMeta(false);
                        }
                      }
                    }, t('قبلت Meta حدث الاختبار. راجع Événements de test.'));
                  }}
                >
                  {t('إرسال حدث اختبار')}
                </button>
                <p className="muted">
                  {t(
                    'انسخ الرمز من Événements de test. نرسل PageView للاختبار فقط، ولا نحفظ الرمز أو ننشئ طلبًا. اختبر البكسل بفتح واجهة المتجر، وليس لوحة الإدارة.',
                  )}
                </p>
                {!!pixelStatus?.web?.failed && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void action(async () => {
                        await api('/admin/pixels/retry', {}, 'POST');
                        await refreshPixelStatus();
                      }, t('تمت جدولة إعادة المحاولة.'))
                    }
                  >
                    {t('إعادة إرسال الأحداث المتعثرة')}
                  </button>
                )}
              </details>
              <details className="wide additional-meta-settings">
                <summary>{t('تتبع Meta إضافي (اختياري)')}</summary>
                <p className="muted">
                  {t(
                    'يمكن للحسابات الإعلانية مشاركة البكسل الأساسي. أضف مصدرًا آخر فقط إذا أردت أن يستقبل أحداث المتجر بشكل مستقل؛ هذا لا ينسخ الحملات أو تعلّمها.',
                  )}
                </p>
                {s.facebookAdditionalPixels.map((destination, index) => {
                  const status = pixelStatus?.additional?.find(
                    (p: any) => p.pixel === destination.pixel,
                  );
                  const update = (change: Partial<typeof destination>) =>
                    setS({
                      ...s,
                      facebookAdditionalPixels: s.facebookAdditionalPixels.map((p) =>
                        p.id === destination.id ? { ...p, ...change } : p,
                      ),
                    });
                  return (
                    <section className="panel additional-meta-destination" key={destination.id}>
                      <div className="toolbar">
                        <b>{destination.label || t('تتبع Meta إضافي')}</b>
                        <Check
                          label={t('تفعيل التتبع')}
                          value={destination.enabled}
                          onChange={(enabled) => update({ enabled })}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setS({
                              ...s,
                              facebookAdditionalPixels: s.facebookAdditionalPixels.filter(
                                (p) => p.id !== destination.id,
                              ),
                            });
                            setAdditionalSecrets((current) => ({
                              ...current,
                              [destination.id]: '',
                            }));
                          }}
                        >
                          {t('حذف')}
                        </button>
                      </div>
                      <div className="settings-grid">
                        <Field
                          label={t('اسم التتبع')}
                          value={destination.label}
                          onChange={(label) => update({ label })}
                        />
                        <Field
                          label={t('معرّف البكسل الإضافي')}
                          path={`facebookAdditionalPixels.${index}.pixel`}
                          value={destination.pixel}
                          onChange={(pixel) => {
                            update({ pixel });
                            setAdditionalSecrets((current) => ({
                              ...current,
                              [destination.id]: '',
                            }));
                          }}
                        />
                        <Field
                          secret
                          autoComplete="new-password"
                          label={
                            'Meta CAPI Token ' +
                            (saved.includes('meta:' + destination.pixel) ? t('· محفوظ') : '')
                          }
                          type="password"
                          value={additionalSecrets[destination.id] || ''}
                          onChange={(token) =>
                            setAdditionalSecrets({ ...additionalSecrets, [destination.id]: token })
                          }
                        />
                      </div>
                      <p className="muted">
                        {t(
                          'استخدم رمز CAPI المصرّح له بهذا البكسل. اترك الخانة فارغة للاحتفاظ بالرمز المحفوظ.',
                        )}
                      </p>
                      <button
                        type="button"
                        className="secondary"
                        disabled={saving}
                        onClick={() => void action(save, t('تم حفظ التغييرات.'))}
                      >
                        {t('حفظ التتبع الإضافي')}
                      </button>
                      {status && (
                        <p role="status">
                          {t(
                            (
                              {
                                disabled: 'التتبع متوقف.',
                                not_configured: 'احفظ معرّف البكسل ورمز CAPI أولًا.',
                                awaiting_event: 'الرمز محفوظ. لم يُختبر قبول Meta للأحداث بعد.',
                                connected: 'أكدت Meta قبول أحداث السيرفر.',
                                rejected:
                                  'رفضت Meta آخر محاولة. راجع معرّف البكسل وصلاحية رمز CAPI.',
                              } as Record<string, string>
                            )[status.connection],
                          )}
                          {status.errorCode ? ' (' + status.errorCode + ')' : ''}
                        </p>
                      )}
                      {status?.events && (
                        <p className="muted">
                          {t('أحداث التتبع: أُرسلت')} {status.events.sent}
                          {' · '}
                          {t('بانتظار الإرسال')} {status.events.pending}
                          {' · '}
                          {t('تعذر إرسالها')} {status.events.failed}
                        </p>
                      )}
                      {!!status?.events?.failed && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            void action(async () => {
                              await api(
                                '/admin/pixels/retry',
                                { pixel: destination.pixel },
                                'POST',
                              );
                              await refreshPixelStatus();
                            }, t('تمت جدولة إعادة المحاولة.'))
                          }
                        >
                          {t('إعادة إرسال الأحداث المتعثرة')}
                        </button>
                      )}
                      <Field
                        label={t('رمز اختبار Meta')}
                        value={additionalTests[destination.id] || ''}
                        onChange={(value) =>
                          setAdditionalTests({ ...additionalTests, [destination.id]: value })
                        }
                      />
                      <button
                        type="button"
                        className="secondary"
                        disabled={
                          testingMeta ||
                          !status?.enabled ||
                          !status?.saved ||
                          !/^TEST\d{3,20}$/.test(additionalTests[destination.id]?.trim() || '')
                        }
                        onClick={() => {
                          setTestingMeta(true);
                          void action(async () => {
                            try {
                              await api(
                                '/admin/pixels/test',
                                {
                                  pixel: destination.pixel,
                                  testEventCode: additionalTests[destination.id].trim(),
                                },
                                'POST',
                              );
                            } finally {
                              try {
                                await refreshPixelStatus();
                              } finally {
                                setTestingMeta(false);
                              }
                            }
                          }, t('قبلت Meta حدث الاختبار. راجع Événements de test.'));
                        }}
                      >
                        {t('إرسال حدث اختبار')}
                      </button>
                    </section>
                  );
                })}
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    !/^\d{5,30}$/.test(s.facebookPixel) ||
                    s.facebookAdditionalPixels.length >= MAX_ADDITIONAL_META_PIXELS
                  }
                  onClick={() =>
                    setS({
                      ...s,
                      facebookAdditionalPixels: [
                        ...s.facebookAdditionalPixels,
                        { id: crypto.randomUUID(), pixel: '', label: '', enabled: true },
                      ],
                    })
                  }
                >
                  {t('إضافة تتبع Meta')}
                </button>
                <p className="muted">
                  {t(
                    'الرموز مشفّرة ولا تظهر في واجهة المتجر. التعطيل يوقف الإرسال؛ الحذف يزيل الرمز المحفوظ عند حفظ الإعدادات.',
                  )}
                </p>
              </details>
            </>
          ) : (
            <>
              <AppearanceSettings
                s={displayed}
                setS={(value) =>
                  setS(
                    updateContent(
                      {
                        ...s,
                        theme: value.theme,
                        branding: value.branding,
                        typography: value.typography,
                        home: {
                          ...s.home,
                          showSearch: value.home.showSearch,
                          showPriceSort: value.home.showPriceSort,
                          showNavigation: value.home.showNavigation,
                          heroCardImages: value.home.heroCardImages,
                          licenseCard: {
                            ...s.home.licenseCard,
                            enabled: value.home.licenseCard.enabled,
                          },
                        },
                      },
                      { home: value.home, heroTitle: value.heroTitle, heroText: value.heroText },
                      editingLanguage,
                    ),
                  )
                }
                action={action}
              />
              <InterfaceCopy s={s} language={editingLanguage} setS={setS} />
            </>
          )}
        </div>
        <button className="primary" type="submit" disabled={savingLanguages || saving}>
          {saving ? t('جارٍ الحفظ…') : t('حفظ الإعدادات')}
        </button>
      </form>
    </section>
  );
}
function AppearanceSettings({
  s,
  setS,
  action,
}: {
  s: Settings;
  setS: (s: Settings) => void;
  action: Action;
}) {
  const latest = useRef(s);
  latest.current = s;
  const heroCard = (index: number, url: string) => {
    const current = latest.current;
    const images = [...(current.home.heroCardImages || ['', ''])] as [string, string];
    images[index] = url;
    const next = { ...current, home: { ...current.home, heroCardImages: images } };
    latest.current = next;
    setS(next);
  };
  const home = <K extends keyof Settings['home']>(key: K, value: Settings['home'][K]) =>
    setS({ ...s, home: { ...s.home, [key]: value } });
  const text = (key: keyof Settings['home'], label: string, type = 'text') => (
    <Field label={label} value={s.home[key] as string} onChange={(v) => home(key, v)} type={type} />
  );
  const list = (key: 'benefits' | 'heroProof', label: string) => (
    <div className="wide">
      <h3>{label}</h3>
      {s.home[key].map((value, i) => (
        <div className="toolbar" key={i}>
          <Field
            label={label + ' ' + (i + 1)}
            value={value}
            onChange={(v) =>
              home(
                key,
                s.home[key].map((old, j) => (i === j ? v : old)),
              )
            }
          />
          <button
            type="button"
            className="small-button"
            onClick={() =>
              home(
                key,
                s.home[key].filter((_, j) => j !== i),
              )
            }
          >
            {t('حذف العبارة')}
          </button>
        </div>
      ))}
      {s.home[key].length < 6 && (
        <button
          type="button"
          className="secondary"
          onClick={() => home(key, [...s.home[key], t('عبارة جديدة')])}
        >
          {t('إضافة عبارة')}
        </button>
      )}
    </div>
  );
  return (
    <>
      <details className="wide appearance-controls">
        <summary>{t('عرض الشعار')}</summary>
        <div className="form-grid">
          <Field
            label={t('عرض الشعار (بالبكسل)')}
            type="number"
            min={64}
            max={220}
            step={1}
            value={s.branding.logoWidth}
            onChange={(value) =>
              setS({ ...s, branding: { ...s.branding, logoWidth: Number(value) } })
            }
          />
          <Field
            label={t('تكبير الشعار داخل الإطار')}
            type="number"
            min={1}
            max={6}
            step={0.1}
            value={s.branding.logoZoom}
            onChange={(value) =>
              setS({ ...s, branding: { ...s.branding, logoZoom: Number(value) } })
            }
          />
          <Check
            label={t('إظهار اسم المتجر بجانب الشعار')}
            value={s.branding.showName}
            onChange={(showName) => setS({ ...s, branding: { ...s.branding, showName } })}
          />
          <p className="muted">
            {t('ارفع التكبير إذا كانت الصورة تحتوي على هوامش فارغة. لا يغيّر ذلك ملف الشعار.')}
          </p>
        </div>
      </details>
      <details className="wide appearance-controls">
        <summary>{t('الخط وحجم الكتابة')}</summary>
        <div className="form-grid">
          <label>
            {t('خط المتجر')}
            <select
              aria-label={t('خط المتجر')}
              value={s.typography.family}
              onChange={(e) =>
                setS({
                  ...s,
                  typography: {
                    ...s.typography,
                    family: e.target.value as Settings['typography']['family'],
                  },
                })
              }
            >
              <option value="plex">IBM Plex Sans Arabic</option>
              <option value="system">{t('خط الجهاز')}</option>
            </select>
          </label>
          <Field
            label={t('حجم النص على الحاسوب')}
            type="number"
            min={16}
            max={20}
            step={1}
            value={s.typography.desktopSize}
            onChange={(v) =>
              setS({ ...s, typography: { ...s.typography, desktopSize: Number(v) } })
            }
          />
          <Field
            label={t('حجم النص على الهاتف')}
            type="number"
            min={16}
            max={20}
            step={1}
            value={s.typography.mobileSize}
            onChange={(v) => setS({ ...s, typography: { ...s.typography, mobileSize: Number(v) } })}
          />
          <label>
            {t('سُمك النص')}
            <select
              aria-label={t('سُمك النص')}
              value={s.typography.weight}
              onChange={(e) =>
                setS({
                  ...s,
                  typography: {
                    ...s.typography,
                    weight: Number(e.target.value) as 400 | 500 | 600,
                  },
                })
              }
            >
              <option value="400">{t('عادي')}</option>
              <option value="500">{t('متوسط')}</option>
              <option value="600">{t('واضح')}</option>
            </select>
          </label>
          <p className="muted">
            {t('اختر حجمًا من 16 إلى 20. يشمل نصوص المتجر والمنتجات وصفحة الطلب.')}
          </p>
        </div>
      </details>
      <h2 className="wide">{t('ألوان المتجر')}</h2>
      {(
        Object.entries({
          primary: t('لون الأزرار والشريط'),
          background: t('خلفية المتجر'),
          surface: t('خلفية البطاقات'),
          text: t('لون النص'),
          muted: t('لون النص الثانوي'),
          accent: t('لون التفاصيل'),
          line: t('لون الحدود'),
        }) as [keyof Settings['theme'], string][]
      ).map(([key, label]) => (
        <Field
          key={key}
          label={label}
          type="color"
          value={s.theme[key]}
          onChange={(v) => setS({ ...s, theme: { ...s.theme, [key]: v } })}
        />
      ))}
      <h2 className="wide">{t('أعلى الصفحة الرئيسية')}</h2>
      <Check
        label={t('إظهار القائمة العلوية للمتجر')}
        value={s.home.showNavigation !== false}
        onChange={(value) => home('showNavigation', value)}
      />
      <Check
        label={t('إظهار مربع البحث في المتجر')}
        value={s.home.showSearch !== false}
        onChange={(v) => home('showSearch', v)}
      />
      <Check
        label={t('إظهار ترتيب المنتجات حسب السعر')}
        value={s.home.showPriceSort !== false}
        onChange={(v) => home('showPriceSort', v)}
      />
      <Check
        label={t('إظهار القسم الرئيسي')}
        value={s.home.showHero}
        onChange={(v) => home('showHero', v)}
      />
      {text('tagline', t('الوصف أسفل اسم المتجر'))}
      {text('heroEyebrow', t('العبارة أعلى عنوان الرئيسية'))}
      <Field
        label={t('عنوان الرئيسية')}
        value={s.heroTitle}
        onChange={(v) => setS({ ...s, heroTitle: v })}
        type="textarea"
      />
      <Field
        label={t('وصف الرئيسية')}
        value={s.heroText}
        onChange={(v) => setS({ ...s, heroText: v })}
        type="textarea"
      />
      {text('heroButtonText', t('نص زر الرئيسية'))}
      {s.home.heroImage && !s.home.heroCardImages?.some(Boolean) ? (
        <Upload
          label={t('رفع صورة الرئيسية')}
          purpose="hero"
          action={action}
          onUpload={(r) =>
            setS({
              ...s,
              home: {
                ...s.home,
                heroImage: r.url,
                heroImageWidth: r.width,
                heroImageHeight: r.height,
              },
            })
          }
        />
      ) : (
        <div className="wide hero-card-settings">
          <h3>{t('صورتا القسم الرئيسي')}</h3>
          <p className="muted">
            {t('يمكنك تغيير كل صورة على حدة. عند إزالتها نستخدم صورة المنتج تلقائيًا.')}
          </p>
          <div className="settings-grid">
            {[0, 1].map((index) => (
              <div className="hero-card-setting" key={index}>
                <Upload
                  label={t(index === 0 ? 'تغيير الصورة الأولى' : 'تغيير الصورة الثانية')}
                  purpose="hero-card"
                  compact
                  action={action}
                  onUpload={(image) => heroCard(index, image.url)}
                />
                {s.home.heroCardImages?.[index] && (
                  <>
                    <img
                      className="settings-image"
                      src={s.home.heroCardImages[index]}
                      alt={t(index === 0 ? 'الصورة الأولى' : 'الصورة الثانية')}
                    />
                    <button
                      type="button"
                      className="small-button"
                      onClick={() => heroCard(index, '')}
                    >
                      {t('استخدام صورة المنتج تلقائيًا')}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {s.home.heroImage && !s.home.heroCardImages?.some(Boolean) && (
        <div className="wide">
          <img className="settings-image" src={s.home.heroImage} alt={t('صورة الرئيسية')} />
          <button type="button" className="small-button" onClick={() => home('heroImage', '')}>
            {t('إزالة صورة الرئيسية')}
          </button>
        </div>
      )}
      {list('heroProof', t('عبارات أسفل زر الرئيسية'))}
      <h2 className="wide">{t('شريط المزايا')}</h2>
      <Check
        label={t('إظهار شريط المزايا')}
        value={s.home.showBenefits}
        onChange={(v) => home('showBenefits', v)}
      />
      {list('benefits', t('عبارات شريط المزايا'))}
      <div className="editor-block wide license-card-settings">
        <h3>{t('بطاقة تراخيص المنتجات')}</h3>
        <Check
          label={t('إظهار بطاقة التراخيص والشهادات')}
          value={s.home.licenseCard.enabled}
          onChange={(enabled) => home('licenseCard', { ...s.home.licenseCard, enabled })}
        />
        <p className="muted">
          {t(
            'فعّلها عندما تتوفر بيانات التسجيل أو الشهادات المطابقة لمنتجاتك. شعارات الهيئات لا تثبت الترخيص وحدها.',
          )}
        </p>
        <Field
          label={t('عنوان بطاقة التراخيص')}
          value={s.home.licenseCard.title}
          onChange={(title) => home('licenseCard', { ...s.home.licenseCard, title })}
        />
        <Field
          label={t('وصف بطاقة التراخيص')}
          type="textarea"
          value={s.home.licenseCard.text}
          onChange={(text) => home('licenseCard', { ...s.home.licenseCard, text })}
        />
        <Field
          label={t('رابط التسجيل أو الشهادات (اختياري)')}
          value={s.home.licenseCard.documentUrl}
          onChange={(documentUrl) => home('licenseCard', { ...s.home.licenseCard, documentUrl })}
        />
      </div>
      <h2 className="wide">{t('قسم المنتجات')}</h2>
      {text('productsEyebrow', t('العبارة أعلى قائمة المنتجات'))}
      {text('productsTitle', t('عنوان قائمة المنتجات'))}
      {text('productTagline', t('العبارة داخل بطاقة المنتج'))}
      {text('featuredBadge', t('شارة المنتج المميز'))}
      {text('emptyTitle', t('عنوان القائمة الفارغة'))}
      {text('emptyText', t('وصف القائمة الفارغة'))}
      <h2 className="wide">{t('قسم لماذا نحن؟')}</h2>
      <Check
        label={t('إظهار قسم لماذا نحن')}
        value={s.home.showPromise}
        onChange={(v) => home('showPromise', v)}
      />
      {text('promiseEyebrow', t('العبارة أعلى قسم لماذا نحن'))}
      {text('promiseTitle', t('عنوان قسم لماذا نحن'), 'textarea')}
      {s.home.promiseCards.map((card, i) => (
        <div className="editor-block wide" key={i}>
          <Field
            label={t('عنوان الميزة ') + (i + 1)}
            value={card.title}
            onChange={(v) =>
              home(
                'promiseCards',
                s.home.promiseCards.map((c, j) => (i === j ? { ...c, title: v } : c)),
              )
            }
          />
          <Field
            label={t('وصف الميزة ') + (i + 1)}
            value={card.text}
            onChange={(v) =>
              home(
                'promiseCards',
                s.home.promiseCards.map((c, j) => (i === j ? { ...c, text: v } : c)),
              )
            }
            type="textarea"
          />
          <button
            type="button"
            className="small-button"
            onClick={() =>
              home(
                'promiseCards',
                s.home.promiseCards.filter((_, j) => j !== i),
              )
            }
          >
            {t('حذف الميزة')}
          </button>
        </div>
      ))}
      {s.home.promiseCards.length < 6 && (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            home('promiseCards', [...s.home.promiseCards, { title: t('ميزة جديدة'), text: '' }])
          }
        >
          {t('إضافة ميزة')}
        </button>
      )}
      <h2 className="wide">{t('أسفل المتجر')}</h2>
      {text('footerText', t('وصف أسفل المتجر'), 'textarea')}
    </>
  );
}
function Categories({ action }: { action: Action }) {
  const [rows, setRows] = useState<Category[]>([]),
    [draft, setDraft] = useState<Category | null>(null),
    [nameLanguage, setNameLanguage] = useState<Language>('ar'),
    [defaultNameLanguage, setDefaultNameLanguage] = useState<Language>('ar');
  const load = async () => setRows(await api('/admin/categories'));
  useEffect(() => {
    void api('/admin/settings').then(({ settings }) => {
      setNameLanguage(settings.storeLanguage);
      setDefaultNameLanguage(settings.storeLanguage);
    });
  }, []);
  useEffect(() => {
    void action(load, '');
  }, []);
  const move = (index: number, direction: number) =>
    void action(async () => {
      const ids = rows.map((category) => category.id),
        target = index + direction;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      await api('/admin/categories/order', { ids }, 'PATCH');
      await load();
    }, t('تم ترتيب الأقسام.'));
  return (
    <section className="panel">
      <p className="muted">
        {t(
          'أنشئ أقسامك، ثم اختر قسم كل منتج من صفحة تعديله. تظهر الأقسام في الرئيسية، وتعرض المنتجات المتوافقة مع سلة الزبون.',
        )}
      </p>
      <div className="toolbar">
        <button
          className="primary"
          onClick={() =>
            setDraft({
              id: crypto.randomUUID(),
              name: '',
              translations: {},
              image: '',
              icon: '🛍️',
              position: rows.length ? Math.max(...rows.map((row) => row.position)) + 1 : 0,
              active: 1,
            })
          }
        >
          {t('إضافة قسم +')}
        </button>
      </div>
      {draft && (
        <article className="editor-block category-editor">
          <div className="category-name-language">
            <label>
              {t('لغة اسم القسم')}
              <select
                aria-label={t('لغة اسم القسم')}
                value={nameLanguage}
                onChange={(e) => setNameLanguage(languageOf(e.target.value))}
              >
                {languages.map((language) => (
                  <option key={language} value={language}>
                    {languageNames[language]}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label={t('اسم القسم — {language}', { language: languageNames[nameLanguage] })}
              dir={direction(nameLanguage)}
              value={
                draft.translations?.[nameLanguage] ??
                (nameLanguage === defaultNameLanguage ? draft.name : '')
              }
              onChange={(name) =>
                setDraft({
                  ...draft,
                  ...(nameLanguage === defaultNameLanguage ? { name } : {}),
                  translations: { ...draft.translations, [nameLanguage]: name },
                })
              }
            />
          </div>
          <Field
            label={t('رمز القسم (اختياري)')}
            value={draft.icon}
            onChange={(icon) => setDraft({ ...draft, icon })}
          />
          <p className="muted">{t('يمكن استخدام رمز مثل 🏠 أو صورة من جهازك.')}</p>
          {draft.image && (
            <img className="category-admin-image" src={draft.image} alt={t('صورة القسم')} />
          )}
          <Upload
            action={action}
            label={t('رفع صورة القسم')}
            purpose="category"
            onUpload={(image) => setDraft({ ...draft, image: image.url })}
          />
          {draft.image && (
            <button className="small-button" onClick={() => setDraft({ ...draft, image: '' })}>
              {t('إزالة صورة القسم')}
            </button>
          )}
          <Check
            label={t('إظهار القسم في المتجر')}
            value={!!draft.active}
            onChange={(active) => setDraft({ ...draft, active: Number(active) })}
          />
          <div className="toolbar">
            <button
              className="primary"
              onClick={() =>
                void action(async () => {
                  await api(
                    '/admin/categories/' + draft.id,
                    {
                      ...draft,
                      name:
                        draft.translations?.[defaultNameLanguage]?.trim() ||
                        draft.name.trim() ||
                        languages
                          .map((language) => draft.translations?.[language]?.trim())
                          .find(Boolean) ||
                        '',
                    },
                    'PUT',
                  );
                  setDraft(null);
                  await load();
                }, t('تم حفظ القسم.'))
              }
            >
              {t('حفظ القسم')}
            </button>
            <button onClick={() => setDraft(null)}>{t('إغلاق')}</button>
          </div>
        </article>
      )}
      <div className="category-admin-list">
        {rows.map((category, index) => (
          <article className="category-admin-row" key={category.id}>
            <span className="category-icon">
              {category.image ? (
                <img src={category.image} alt="" width="64" height="64" loading="lazy" />
              ) : (
                category.icon || '🛍️'
              )}
            </span>
            <strong>{localizedCategory(category, nameLanguage).name}</strong>
            <span className="badge">{category.active ? t('ظاهر') : t('مخفي')}</span>
            <div className="toolbar">
              <button
                aria-label={t('تقديم ') + category.name}
                disabled={!index}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                aria-label={t('تأخير ') + category.name}
                disabled={index === rows.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button onClick={() => setDraft({ ...category })}>{t('تعديل')}</button>
              <button
                className="danger-button"
                onClick={() => {
                  if (
                    confirm(
                      t('حذف قسم «') + category.name + t('»؟ ستبقى منتجاته في المتجر دون قسم.'),
                    )
                  )
                    void action(async () => {
                      await api('/admin/categories/' + category.id, undefined, 'DELETE');
                      if (draft?.id === category.id) setDraft(null);
                      await load();
                    }, t('تم حذف القسم؛ المنتجات محفوظة.'));
                }}
              >
                {t('حذف القسم')}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <p className="empty-state">
          {t('أضف أول قسم، مثل العناية أو المنزل، بالاسم والصورة اللذين تختارهما.')}
        </p>
      )}
    </section>
  );
}
function CatalogPrices({ catalog }: { catalog: Record<string, any> }) {
  const cents = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    const amount = Math.round(value * 100);
    return Number.isSafeInteger(amount) ? amount : null;
  };
  const customer = cents(catalog.suggested_retail_price),
    marketer = cents(catalog.fulfillment_price),
    profit = customer !== null && marketer !== null ? customer - marketer : null;
  return (
    <span className="catalog-prices">
      <span className="catalog-price">
        <small>{t('سعر الزبون')}</small>
        <strong>{customer === null ? t('غير متاح') : money(customer)}</strong>
      </span>
      <span className="catalog-price">
        <small>{t('سعر المسوق')}</small>
        <strong>{marketer === null ? t('غير متاح') : money(marketer)}</strong>
      </span>
      <span
        className={'catalog-price catalog-profit' + (profit !== null && profit < 0 ? ' loss' : '')}
      >
        <small>{t('الربح (دون توصيل)')}</small>
        <strong>{profit === null ? t('غير متاح') : money(profit)}</strong>
      </span>
    </span>
  );
}

function Products({ action, clearValidation }: { action: Action; clearValidation: () => void }) {
  const [sectionsCollapsed, setSectionsCollapsed] = useState(false);
  const validationFailure = useRef(false);
  const landingEditor = useRef<HTMLDetailsElement>(null);
  const [pricingSettings, setPricingSettings] = useState<Settings>(defaults);
  const [maximumShipping, setMaximumShipping] = useState<number | null>(null);
  const [providerShipping, setProviderShipping] = useState<ShippingCosts | null>(null);
  const [rows, setRows] = useState<Product[]>([]),
    [catalog, setCatalog] = useState<any[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [errors, setErrors] = useState<Record<string, FieldIssue>>({}),
    [catalogSearch, setCatalogSearch] = useState(''),
    [productSearch, setProductSearch] = useState(''),
    [productStatus, setProductStatus] = useState('all'),
    [landingChoiceSearch, setLandingChoiceSearch] = useState(''),
    [descriptionSource, setDescriptionSource] = useState<'text' | 'html'>('text'),
    [linkedCatalog, setLinkedCatalog] = useState<any>(null),
    [draft, setDraft] = useState<Product | null>(null),
    [preview, setPreview] = useState(false),
    [previewDocument, setPreviewDocument] = useState(''),
    [previewLanguage, setPreviewLanguage] = useState<Language>('ar'),
    [previewMode, setPreviewMode] = useState<'product' | 'landing'>('product'),
    [previewLoading, setPreviewLoading] = useState(false),
    [shippingDefaults, setShippingDefaults] = useState({
      casa: defaults.shippingCasa,
      other: defaults.shippingOther,
    }),
    [drag, setDrag] = useState(''),
    [contentLanguage, setContentLanguage] = useState<Language>('ar'),
    [storeLanguage, setStoreLanguage] = useState<Language>('ar');
  const contentBaseLanguage = draft?.presentation?.contentLanguage || storeLanguage;
  const content = draft ? productCopy(draft, contentLanguage, contentBaseLanguage) : null;
  const copyPath = (field: keyof ProductCopy) =>
    contentLanguage === contentBaseLanguage
      ? field === 'descriptionFormat' || field === 'descriptionHtml'
        ? 'presentation.' + field
        : field
      : `presentation.translations.${contentLanguage}.${field}`;
  const editCopy = (change: Partial<ProductCopy>) => {
    if (validationFailure.current) {
      clearValidation();
      validationFailure.current = false;
    }
    setErrors({});
    setDraft((current) =>
      current ? updateProductCopy(current, contentLanguage, contentBaseLanguage, change) : current,
    );
  };
  const landingLanguage = draft?.presentation?.landingLanguage ?? storeLanguage;
  const landingUISettings = { ...defaults, storeLanguage: landingLanguage };
  const productFormDefaults = localizedForm(landingUISettings);
  const load = async () => {
    const [ps, cs, settings, cats] = await Promise.all([
      api('/admin/products'),
      api('/admin/catalog'),
      api('/admin/settings'),
      api('/admin/categories'),
    ]);
    setRows(ps);
    setPricingSettings(settings.settings);
    setMaximumShipping(settings.maximumShipping);
    setProviderShipping(settings.shippingCosts);
    setStoreLanguage(settings.settings.storeLanguage);
    setContentLanguage(settings.settings.storeLanguage);
    setCatalog(cs);
    setCategories(cats);
    setShippingDefaults({
      casa: settings.settings.shippingCasa,
      other: settings.settings.shippingOther,
    });
  };
  useEffect(() => {
    void action(load, '');
  }, []);
  useEffect(() => {
    setErrors({});
    setSectionsCollapsed(false);
    setPreview(false);
    setContentLanguage(
      (pricingSettings.storeLanguages || [storeLanguage]).length > 1
        ? draft?.presentation?.contentLanguage || storeLanguage
        : storeLanguage,
    );
  }, [draft?.id]);
  useEffect(() => {
    if (!draft?.sku) {
      setLinkedCatalog(null);
      return;
    }
    const matching = catalog.find((c) => c.sku === draft.sku);
    if (matching) {
      setLinkedCatalog(matching);
      return;
    }
    let current = true;
    void api('/admin/catalog?q=' + encodeURIComponent(draft.sku))
      .then((rows) => {
        if (current) setLinkedCatalog(rows.find((c: any) => c.sku === draft.sku) || null);
      })
      .catch(() => {
        if (current) setLinkedCatalog(null);
      });
    return () => {
      current = false;
    };
  }, [draft?.sku, catalog]);
  const submit = (fn: () => Promise<unknown>) => async () => {
    setErrors({});
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError && error.details.length) {
        validationFailure.current = true;
        const field = error.details[0].field;
        const translated = field.match(/^presentation\.translations\.(ar|fr|en)\./);
        if (translated) setContentLanguage(languageOf(translated[1]));
        else if (
          ['name', 'description', 'keywords', 'presentation.descriptionHtml'].includes(field)
        )
          setContentLanguage(contentBaseLanguage);
        setErrors(Object.fromEntries(error.details.map((issue) => [issue.field, issue])));
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const element = document.querySelector<HTMLElement>(
              '[data-field="' + CSS.escape(error.details[0].field) + '"]',
            );
            let parent = element?.parentElement;
            while (parent) {
              if (parent instanceof HTMLDetailsElement) parent.open = true;
              parent = parent.parentElement;
            }
            element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element
              ?.querySelector<HTMLElement>('input,textarea,select,button')
              ?.focus({ preventScroll: true });
          }),
        );
      }
      throw error;
    }
  };
  const chooseCatalog = (c: any) => {
    setErrors({});
    setLinkedCatalog(c);
    setDraft(productFromCatalog(draft!, c, descriptionSource));
  };
  const prepareProduct = (p: Product): Product => {
    const next = structuredClone(p);
    next.presentation = {
      ...next.presentation,
      landingFormAppearance: landingFormAppearance(next, pricingSettings),
    };
    if (
      next.presentation?.bundleMode === undefined &&
      next.offers.length &&
      next.offers.every((o) => o.quantity >= 2)
    )
      next.presentation = { ...next.presentation, bundleMode: true, quantityPricing: undefined };
    return next;
  };
  const fresh = (): Product => prepareProduct(emptyProduct(storeLanguage));
  const patch = (key: keyof Product, value: unknown) => {
    if (validationFailure.current) {
      clearValidation();
      validationFailure.current = false;
    }
    setErrors((issues) =>
      Object.fromEntries(
        Object.entries(issues).filter(([field]) => field !== key && !field.startsWith(key + '.')),
      ),
    );
    setDraft((p) => {
      if (!p) return null;
      const next = { ...p, [key]: value };
      return next;
    });
  };
  const automaticForm: Block | null =
    draft && !draft.blocks.some((b) => b.type === 'ORDER_FORM')
      ? {
          id: 'auto-form-' + draft.id,
          type: 'ORDER_FORM',
          order: draft.blocks.length,
          enabled: true,
          settings: {
            codBadgeText: landingBadgeText(
              { ...draft, pageMode: 'landing' },
              {},
              landingUISettings,
            ),
          },
        }
      : null;
  const blockPatch = (id: string, change: Partial<Block>) =>
    patch(
      'blocks',
      draft!.blocks.some((b) => b.id === id)
        ? draft!.blocks.map((b) => (b.id === id ? { ...b, ...change } : b))
        : automaticForm?.id === id
          ? [...draft!.blocks, { ...automaticForm, ...change }]
          : draft!.blocks,
    );
  const blockSettings = (id: string, key: string, value: unknown) => {
    const b = draft!.blocks.find((b) => b.id === id) || automaticForm!;
    blockPatch(id, { settings: { ...b.settings, [key]: value } });
  };
  const reorder = (from: string, to: string) => {
    const next = [...draft!.blocks],
      index = next.findIndex((b) => b.id === from),
      target = next.findIndex((b) => b.id === to);
    if (index < 0 || target < 0) return;
    const [b] = next.splice(index, 1);
    next.splice(target, 0, b);
    patch(
      'blocks',
      next.map((b, i) => ({ ...b, order: i })),
    );
  };
  const duplicateButton = (id: string) => {
    const blocks = draft!.blocks;
    const index = blocks.findIndex((b) => b.id === id && b.type === 'CTA');
    if (index < 0 || blocks.length >= 50) return;
    const copy = { ...structuredClone(blocks[index]), id: crypto.randomUUID() };
    const next = [...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)];
    patch(
      'blocks',
      next.map((b, order) => ({ ...b, order })),
    );
  };
  const previewDraft = (mode: 'product' | 'landing') =>
    void action(
      submit(async () => {
        const r = await api('/admin/preview', {
          ...draft,
          pageMode: mode,
          presentation: {
            ...draft!.presentation,
            landingLanguage,
            contentLanguage: contentBaseLanguage,
          },
          previewLanguage: mode === 'landing' ? landingLanguage : storeLanguage,
        });
        setPreviewMode(mode);
        setPreviewLanguage(mode === 'landing' ? landingLanguage : storeLanguage);
        setPreviewDocument(r.html);
        setPreview(true);
        requestAnimationFrame(() =>
          document
            .querySelector('.product-draft-preview')
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
        );
      }),
      '',
    );
  const matchesProduct = (p: Product) =>
    normalizeSearch(p.name + ' ' + p.sku).includes(normalizeSearch(productSearch)) &&
    (productStatus === 'all' || (productStatus === 'published' ? !!p.active : !p.active));
  if (!draft)
    return (
      <section className="panel">
        <BulkImporter
          scope={csrf.slice(0, 16)}
          existing={rows}
          query={productSearch}
          onQuery={setProductSearch}
          request={api}
          onImported={load}
        >
          <button className="primary" onClick={() => setDraft(fresh())}>
            {t('إضافة منتج +')}
          </button>
          <button onClick={() => void action(load, t('تم تحديث المنتجات.'))}>{t('تحديث')}</button>
        </BulkImporter>
        <label className="products-status-filter">
          {t('حالة المنتجات')}
          <select
            aria-label={t('حالة المنتجات')}
            value={productStatus}
            onChange={(e) => setProductStatus(e.target.value)}
          >
            <option value="all">{t('كل المنتجات')}</option>
            <option value="published">{t('مفعّلة')}</option>
            <option value="draft">{t('مسودة')}</option>
          </select>
        </label>
        <div className="table-wrap">
          <table className="admin-products-table">
            <thead>
              <tr>
                <th>{t('المنتج')}</th>
                <th>{t('القسم')}</th>
                <th>{t('السعر')}</th>
                <th>{t('التوفر')}</th>
                <th>{t('الحالة')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.filter(matchesProduct).map((p) => (
                <tr key={p.id}>
                  <td className="admin-product-title">
                    <div className="product-cell">
                      {p.image && (
                        <img src={p.image} alt="" loading="lazy" width="48" height="48" />
                      )}
                      <span>
                        {p.name}
                        <small>{p.sku}</small>
                      </span>
                    </div>
                  </td>
                  <td data-label={t('القسم')}>
                    {categories.find((c) => c.id === p.categoryId)
                      ? localizedCategory(
                          categories.find((c) => c.id === p.categoryId)!,
                          storeLanguage,
                        ).name
                      : t('دون قسم')}
                  </td>
                  <td data-label={t('السعر')}>{money(p.price)}</td>
                  <td data-label={t('التوفر')}>
                    {p.stock > 0 ? t('متاح للطلب') : t('غير متوفر حاليًا')}
                  </td>
                  <td data-label={t('الحالة')}>
                    <span className={'badge ' + (p.verified ? 'ok' : 'error')}>
                      {p.active
                        ? p.storefrontVisible === 0
                          ? t('بالرابط فقط')
                          : t('ظاهر في المتجر')
                        : t('مسودة')}{' '}
                      · {p.verified ? t('موثق') : t('غير موثق')}
                    </span>
                  </td>
                  <td className="admin-product-actions">
                    <button className="small-button" onClick={() => setDraft(prepareProduct(p))}>
                      {t('تعديل')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="empty-state">{t('أضف منتجًا واربطه بكتالوج مورد.')}</p>}
        {!!rows.length && !rows.some(matchesProduct) && (
          <p className="empty-state">{t('لا توجد منتجات مطابقة للبحث.')}</p>
        )}
      </section>
    );
  return (
    <FieldErrors.Provider value={errors}>
      <div className="toolbar product-editor-toolbar">
        <div className="product-save-controls">
          <button
            className="primary"
            onClick={() =>
              void action(
                submit(async () => {
                  await api(
                    '/admin/products/' + draft.id,
                    {
                      ...draft,
                      presentation: {
                        ...draft.presentation,
                        landingLanguage,
                        contentLanguage: contentBaseLanguage,
                      },
                    },
                    'PUT',
                  );
                  await load();
                  setDraft(null);
                }),
                t('تم حفظ المنتج.'),
              )
            }
          >
            {t('حفظ المنتج')}
          </button>
          <div className={'product-publish-state ' + (draft.active ? 'is-published' : 'is-draft')}>
            <Check
              label={t('نشر المنتج')}
              value={!!draft.active}
              onChange={(value) => patch('active', Number(value))}
            />
            <small>{t(draft.active ? 'سيُنشر عند الحفظ' : 'سيُحفظ كمسودة')}</small>
          </div>
        </div>
        <button onClick={() => previewDraft(draft.pageMode || 'product')}>
          {t('معاينة المسودة')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (landingEditor.current) {
              landingEditor.current.open = true;
              landingEditor.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }}
        >
          {t('تعديل صفحة الهبوط')}
        </button>
        <button
          type="button"
          onClick={() => {
            const collapse = !sectionsCollapsed;
            document
              .querySelectorAll<HTMLDetailsElement>(
                '.product-editor-section,.offers-subsection,.product-optional-section,.bundle-row-options,.product-customization',
              )
              .forEach((section) => {
                section.open = !collapse;
              });
            setSectionsCollapsed(collapse);
            if (collapse)
              document
                .querySelector('.product-editor-toolbar')
                ?.scrollIntoView({ block: 'start', behavior: 'instant' });
          }}
        >
          {t(sectionsCollapsed ? 'فتح جميع الأقسام' : 'طي جميع الأقسام')}
        </button>
        <button onClick={() => setDraft(null)}>{t('العودة للمنتجات')}</button>
      </div>
      {preview && (
        <section className="panel product-draft-preview">
          <div className="toolbar">
            <h3>
              {t('معاينة قبل النشر ·')}
              {draft.name}
            </h3>
            <button className="small-button" onClick={() => setPreview(false)}>
              {t('إغلاق المعاينة')}
            </button>
            {previewMode !== 'landing' && (
              <label>
                {t('لغة المعاينة')}
                <select
                  aria-label={t('لغة المعاينة')}
                  disabled={previewLoading}
                  value={previewLanguage}
                  onChange={(event) => {
                    const language = languageOf(event.target.value);
                    setPreviewLoading(true);
                    void action(async () => {
                      const result = await api('/admin/preview', {
                        ...draft,
                        pageMode: previewMode,
                        presentation: {
                          ...draft.presentation,
                          landingLanguage,
                          contentLanguage: contentBaseLanguage,
                        },
                        previewLanguage: language,
                      });
                      setPreviewDocument(result.html);
                      setPreviewLanguage(language);
                    }, '').finally(() => setPreviewLoading(false));
                  }}
                >
                  {languages.map((language) => (
                    <option key={language} value={language}>
                      {languageNames[language]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="muted">
            {t('هذه معاينة فعلية لشكل الصفحة والاستمارة. لا تُرسل منها طلبات.')}
          </p>
          <iframe
            title={t('معاينة صفحة المنتج')}
            className="landing-preview"
            sandbox="allow-same-origin"
            srcDoc={previewDocument}
          />
        </section>
      )}
      <div className="editor-layout product-editor-layout">
        <section
          className="panel"
          onClickCapture={(event) => {
            const summary = (event.target as HTMLElement).closest('summary');
            const details = summary?.parentElement;
            if (
              !summary ||
              !(details instanceof HTMLDetailsElement) ||
              !details.matches(
                '.product-editor-section,.offers-subsection,.product-optional-section,.bundle-row-options,.product-customization',
              )
            )
              return;
            event.preventDefault();
            keepAccordionHeader(details, () => {
              details.open = !details.open;
            });
          }}
        >
          <details className="product-editor-section" open>
            <summary>{t('المنتج')}</summary>
            <div className="product-editor-section-body">
              <details className="product-optional-section" open={!draft.sku}>
                <summary>
                  {draft.sku ? t('تغيير منتج مورد') + ' · ' + draft.sku : t('اختيار منتج من مورد')}
                </summary>
                <div className="catalog-search-row">
                  <Field
                    label={t('البحث في منتجات مورد بالاسم أو SKU')}
                    value={catalogSearch}
                    onChange={setCatalogSearch}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void action(async () => {
                        setCatalog(
                          await api('/admin/catalog?q=' + encodeURIComponent(catalogSearch)),
                        );
                      }, t('تم تحديث نتائج الكتالوج. اختر المنتج من البطاقات.'))
                    }
                  >
                    {t('بحث في الكتالوج')}
                  </button>
                  <label>
                    {t('نوع الوصف المستورد من مورد')}
                    <select
                      aria-label={t('نوع الوصف المستورد من مورد')}
                      value={descriptionSource}
                      onChange={(event) =>
                        setDescriptionSource(event.target.value as 'text' | 'html')
                      }
                    >
                      <option value="text">{t('وصف نصي عادي')}</option>
                      <option value="html">{t('وصف HTML منسّق')}</option>
                    </select>
                  </label>
                </div>
                <div className="catalog-grid" aria-label={t('منتجات مورد')}>
                  {catalog.map((c) => (
                    <button
                      type="button"
                      className="catalog-card"
                      key={c.sku}
                      aria-label={t('اختيار ') + (c.name || c.parent_name || c.sku)}
                      aria-pressed={draft.sku === c.sku}
                      onClick={() => chooseCatalog(c)}
                    >
                      {c.main_image || c.images?.[0] ? (
                        <img
                          src={c.main_image || c.images[0]}
                          alt={c.name || c.parent_name || ''}
                          loading="lazy"
                          width="120"
                          height="120"
                        />
                      ) : (
                        <span className="catalog-placeholder">{t('لا توجد صورة')}</span>
                      )}
                      <strong>{c.name || c.parent_name || c.sku}</strong>
                      <small>
                        {t('كود المنتج:')}
                        {c.sku}
                      </small>
                      <CatalogPrices catalog={c} />
                      <small>
                        {c.stock_quantity > 0 && c.is_active !== false
                          ? t('متاح للطلب')
                          : t('غير متوفر حاليًا')}
                      </small>
                      <span>
                        {draft.sku === c.sku ? t('✓ المنتج المختار') : t('اختيار المنتج')}
                      </span>
                    </button>
                  ))}
                  {!catalog.length && (
                    <p className="muted">
                      {t('لا توجد نتائج. غيّر البحث أو زامن المنتجات من صفحة الربط مع مورد.')}
                    </p>
                  )}
                </div>
              </details>
              <div className="product-basics-grid">
                <Field
                  path="sku"
                  label={t('كود المنتج لدى مورد')}
                  value={draft.sku}
                  onChange={(v) => patch('sku', v)}
                />
                <label data-field="categoryId">
                  {t('قسم المنتج')}
                  <select
                    aria-invalid={!!errors.categoryId}
                    value={draft.categoryId || ''}
                    onChange={(event) => patch('categoryId', event.target.value || null)}
                  >
                    <option value="">{t('دون قسم')}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {localizedCategory(category, storeLanguage).name}
                        {category.active ? '' : t(' · القسم مخفي')}
                      </option>
                    ))}
                  </select>
                  {errors.categoryId && (
                    <small className="field-error">{errors.categoryId.message}</small>
                  )}
                </label>{' '}
              </div>
              <details className="product-optional-section product-url-options">
                <summary>
                  {t('رابط المنتج')} <small dir="ltr">/{draft.slug || '…'}</small>
                </summary>
                <Field
                  path="slug"
                  label={t('الرابط (حروف إنجليزية وشرطات)')}
                  value={draft.slug}
                  onChange={(v) => patch('slug', v)}
                />
              </details>

              <div className="product-media-editor">
                <div className="product-media-toolbar">
                  <strong>{t('صور المنتج')}</strong>
                  {new Set([draft.image, ...(draft.gallery || [])].filter(Boolean)).size < 12 && (
                    <Upload
                      action={action}
                      purpose="product"
                      label={t('إضافة صور')}
                      multiple
                      compact
                      maxFiles={
                        12 - new Set([draft.image, ...(draft.gallery || [])].filter(Boolean)).size
                      }
                      onUploads={(uploaded) => {
                        setDraft((current) => {
                          if (!current) return current;
                          const gallery = [
                            ...new Set(
                              [
                                current.image,
                                ...(current.gallery || []),
                                ...uploaded.map((image) => image.url),
                              ].filter(Boolean),
                            ),
                          ].slice(0, 12);
                          return { ...current, image: current.image || gallery[0] || '', gallery };
                        });
                        setErrors((issues) =>
                          Object.fromEntries(
                            Object.entries(issues).filter(
                              ([field]) => field !== 'image' && field !== 'gallery',
                            ),
                          ),
                        );
                      }}
                    />
                  )}
                  <details className="product-image-link">
                    <summary>{t('رابط صورة خارجي (اختياري)')}</summary>
                    <Field
                      path="image"
                      label={t('رابط صورة البطاقة')}
                      value={draft.image}
                      onChange={(v) => patch('image', v)}
                    />
                  </details>
                </div>
                <div className="product-gallery-editor">
                  {[...new Set([draft.image, ...(draft.gallery || [])].filter(Boolean))].map(
                    (image) => (
                      <div
                        key={image}
                        className={
                          'gallery-editor-row' + (image === draft.image ? ' is-main-image' : '')
                        }
                      >
                        <img src={image} alt="" loading="lazy" />
                        {image === draft.image && (
                          <span className="gallery-main-badge">{t('الرئيسية')}</span>
                        )}
                        <div className="gallery-image-actions">
                          <button
                            type="button"
                            className={
                              image === draft.image
                                ? 'primary small-button'
                                : 'secondary small-button'
                            }
                            aria-pressed={image === draft.image}
                            aria-label={
                              image === draft.image ? t('الصورة الرئيسية') : t('تعيين كصورة رئيسية')
                            }
                            title={
                              image === draft.image ? t('الصورة الرئيسية') : t('تعيين كصورة رئيسية')
                            }
                            onClick={() =>
                              setDraft((p) =>
                                p
                                  ? {
                                      ...p,
                                      image,
                                      gallery: [
                                        ...new Set(
                                          [image, p.image, ...(p.gallery || [])].filter(Boolean),
                                        ),
                                      ].slice(0, 12),
                                    }
                                  : p,
                              )
                            }
                          >
                            {image === draft.image ? '★' : '☆'}
                          </button>
                          <button
                            type="button"
                            className="danger small-button"
                            aria-label={t('حذف الصورة')}
                            title={t('حذف الصورة')}
                            onClick={() =>
                              setDraft((p) => {
                                if (!p) return p;
                                const gallery = (p.gallery || []).filter((url) => url !== image);
                                return {
                                  ...p,
                                  gallery,
                                  image: p.image === image ? gallery[0] || '' : p.image,
                                };
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </details>
          <details className="product-editor-section" open>
            <summary>{t('محتوى المنتج')}</summary>
            <div className="product-editor-section-body product-copy-editor">
              <div className="product-copy-heading">
                {(pricingSettings.storeLanguages || [storeLanguage]).length > 1 && (
                  <label>
                    {t('لغة محتوى المنتج')}
                    <select
                      aria-label={t('لغة محتوى المنتج')}
                      value={contentLanguage}
                      onChange={(event) => setContentLanguage(languageOf(event.target.value))}
                    >
                      {languages.map((language) => (
                        <option key={language} value={language}>
                          {languageNames[language]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Field
                  path={copyPath('name')}
                  dir={contentLanguage === 'ar' ? 'rtl' : 'ltr'}
                  label={t('اسم المنتج')}
                  value={content!.name}
                  onChange={(name) => editCopy({ name })}
                />
              </div>
              <div className="product-description-tools">
                <label>
                  {t('طريقة عرض الوصف')}
                  <select
                    aria-label={t('طريقة عرض الوصف')}
                    value={content!.descriptionFormat}
                    onChange={(event) => {
                      const format = event.target.value as 'text' | 'html';
                      editCopy({
                        descriptionFormat: format,
                        ...(format === 'html' && !content!.descriptionHtml
                          ? {
                              descriptionHtml: content!.description
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/\n/g, '<br />'),
                            }
                          : format === 'text' && content!.descriptionFormat === 'html'
                            ? { description: catalogText(content!.descriptionHtml) }
                            : {}),
                      });
                    }}
                  >
                    <option value="text">{t('وصف نصي عادي')}</option>
                    <option value="html">{t('وصف HTML منسّق')}</option>
                  </select>
                </label>
                {linkedCatalog && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      const imported = importedDescription(linkedCatalog, descriptionSource);
                      editCopy({
                        description: imported.description,
                        descriptionFormat: imported.descriptionFormat,
                        descriptionHtml: imported.descriptionHtml || '',
                      });
                    }}
                  >
                    {t('استيراد الوصف من مورد')}
                  </button>
                )}
              </div>
              {contentLanguage !== contentBaseLanguage && (
                <small className="muted">{t('الحقول الفارغة تستخدم محتوى المنتج الأصلي.')}</small>
              )}
              {content!.descriptionFormat === 'html' ? (
                <RichTextEditor
                  key={draft.id + '-' + contentLanguage}
                  label={t('الوصف')}
                  language={contentLanguage}
                  path={copyPath('descriptionHtml')}
                  value={content!.descriptionHtml}
                  error={errors[copyPath('descriptionHtml')]?.message}
                  request={api}
                  onChange={(descriptionHtml) => editCopy({ descriptionHtml })}
                />
              ) : (
                <Field
                  path={copyPath('description')}
                  dir={contentLanguage === 'ar' ? 'rtl' : 'ltr'}
                  label={t('الوصف')}
                  type="textarea"
                  value={content!.description}
                  onChange={(description) => editCopy({ description })}
                />
              )}
              <Field
                path={copyPath('keywords')}
                dir={contentLanguage === 'ar' ? 'rtl' : 'ltr'}
                label={t('كلمات مفتاحية (اختياري)')}
                value={content!.keywords}
                onChange={(keywords) => editCopy({ keywords })}
              />
            </div>
          </details>
          <details className="product-editor-section" open>
            <summary>{t('السعر والباقات')}</summary>
            <div className="product-editor-section-body">
              <div className="product-price-grid">
                <Field
                  path="price"
                  label={t('السعر الأصلي بالدرهم')}
                  value={draft.price / 100}
                  type="number"
                  onChange={(v) => patch('price', Math.round(Number(v) * 100))}
                />
                <div className="product-sale-field">
                  <Check
                    label={t('تفعيل سعر عرض')}
                    value={!!draft.presentation?.promotion}
                    onChange={(enabled) =>
                      patch('presentation', {
                        ...draft.presentation,
                        promotion: enabled
                          ? { price: Math.round(draft.price * 0.9), endsAt: null }
                          : null,
                      })
                    }
                  />
                  {draft.presentation?.promotion && (
                    <Field
                      path="presentation.promotion.price"
                      label={t('سعر العرض بالدرهم')}
                      type="number"
                      value={draft.presentation.promotion.price / 100}
                      onChange={(value) =>
                        patch('presentation', {
                          ...draft.presentation,
                          promotion: {
                            ...draft.presentation!.promotion!,
                            price: Math.round(Number(value) * 100),
                          },
                        })
                      }
                    />
                  )}
                </div>
                {draft.presentation?.promotion && (
                  <DeadlineField
                    value={draft.presentation.promotion.endsAt}
                    onChange={(endsAt) =>
                      patch('presentation', {
                        ...draft.presentation,
                        promotion: { ...draft.presentation!.promotion!, endsAt },
                      })
                    }
                  />
                )}
              </div>

              <ProfitPreview
                product={draft}
                settings={pricingSettings}
                maximumShipping={maximumShipping}
                shippingCosts={providerShipping}
                t={t}
                money={money}
                options={[
                  {
                    label: 'السعر الحالي',
                    quantity: 1,
                    total: pricedProduct(draft).price,
                    repeatable: true,
                  },
                ]}
              />
              <BundlesEditor
                product={draft}
                settings={pricingSettings}
                maximumShipping={maximumShipping}
                shippingCosts={providerShipping}
                t={t}
                money={money}
                onOffers={(offers) => patch('offers', offers)}
                onPresentation={(changes) =>
                  patch('presentation', { ...draft.presentation, ...changes })
                }
              />
            </div>
          </details>
          <details className="product-editor-section">
            <summary>{t('التوصيل')}</summary>
            <div className="product-editor-section-body">
              <label>
                {t('توصيل هذا المنتج')}
                <select
                  aria-label={t('توصيل هذا المنتج')}
                  value={
                    draft.presentation?.freeShipping
                      ? 'free'
                      : draft.shippingCasa != null || draft.shippingOther != null
                        ? 'custom'
                        : 'inherit'
                  }
                  onChange={(event) => {
                    const mode = event.target.value;
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            shippingCasa:
                              mode === 'custom'
                                ? (current.shippingCasa ?? shippingDefaults.casa)
                                : null,
                            shippingOther:
                              mode === 'custom'
                                ? (current.shippingOther ?? shippingDefaults.other)
                                : null,
                            presentation: {
                              ...current.presentation,
                              freeShipping: mode === 'free',
                            },
                          }
                        : current,
                    );
                    setErrors({});
                    if (validationFailure.current) {
                      clearValidation();
                      validationFailure.current = false;
                    }
                  }}
                >
                  <option value="inherit">{t('حسب إعدادات المتجر')}</option>
                  <option value="free">{t('مجاني لهذا المنتج وباقاته')}</option>
                  <option value="custom">{t('رسوم خاصة لهذا المنتج')}</option>
                </select>
              </label>
              {!draft.presentation?.freeShipping &&
                (draft.shippingCasa != null || draft.shippingOther != null) && (
                  <div className="settings-grid">
                    <Field
                      path="shippingCasa"
                      label={t('توصيل المنتج داخل الدار البيضاء — درهم')}
                      type="number"
                      value={(draft.shippingCasa ?? shippingDefaults.casa) / 100}
                      onChange={(v) => patch('shippingCasa', Math.round(Number(v) * 100))}
                    />
                    <Field
                      path="shippingOther"
                      label={t('توصيل المنتج خارج الدار البيضاء — درهم')}
                      type="number"
                      value={(draft.shippingOther ?? shippingDefaults.other) / 100}
                      onChange={(v) => patch('shippingOther', Math.round(Number(v) * 100))}
                    />
                  </div>
                )}
              <p className="muted">
                {t(
                  'الباقات تتبع توصيل المنتج، إلا إذا اخترت التوصيل المجاني لباقة محددة. التوصيل المجاني للمنتج يشمل جميع باقاته.',
                )}
              </p>
            </div>
          </details>
          <details className="product-editor-section">
            <summary>{t('إعدادات إضافية')}</summary>
            <div className="product-editor-section-body">
              <details className="product-optional-section">
                <summary>{t('المنتجات المقترحة')}</summary>
                <div className="product-editor-section-body">
                  <label>
                    {t('طريقة اختيار المنتجات المقترحة')}
                    <select
                      aria-label={t('طريقة اختيار المنتجات المقترحة')}
                      value={draft.presentation?.recommendationMode || 'auto'}
                      onChange={(event) =>
                        patch('presentation', {
                          ...draft.presentation,
                          recommendationMode: event.target.value,
                        })
                      }
                    >
                      <option value="auto">{t('اختيار تلقائي')}</option>
                      <option value="manual">{t('أختار المنتجات بنفسي')}</option>
                      <option value="hidden">{t('إخفاء الاقتراحات')}</option>
                    </select>
                  </label>
                  {draft.presentation?.recommendationMode === 'manual' && (
                    <RecommendationPicker
                      product={draft}
                      products={rows}
                      language={storeLanguage}
                      request={api}
                      run={action}
                      onToggle={(id) =>
                        setDraft((p) => {
                          if (!p) return p;
                          const ids = p.presentation?.recommendedIds || [];
                          return {
                            ...p,
                            presentation: {
                              ...p.presentation,
                              recommendedIds: ids.includes(id)
                                ? ids.filter((value) => value !== id)
                                : [...ids, id].slice(0, 8),
                            },
                          };
                        })
                      }
                      onImported={(updated, id) => {
                        setRows(updated);
                        setDraft((p) =>
                          p
                            ? {
                                ...p,
                                presentation: {
                                  ...p.presentation,
                                  recommendedIds: [
                                    ...new Set([...(p.presentation?.recommendedIds || []), id]),
                                  ].slice(0, 8),
                                },
                              }
                            : p,
                        );
                      }}
                    />
                  )}
                </div>
              </details>
              <details className="product-optional-section">
                <summary>{t('النشر والمظهر')}</summary>
                <div className="product-editor-section-body product-appearance-grid">
                  <Check
                    label={t('إظهار في واجهة المتجر')}
                    value={draft.storefrontVisible !== 0}
                    onChange={(v) => patch('storefrontVisible', Number(v))}
                  />
                  <p className="muted">
                    {t(
                      'عند إخفائه يبقى المنتج المنشور قابلًا للشراء من رابطه، ويختفي من الرئيسية والأقسام والبحث والاقتراحات.',
                    )}
                  </p>
                  <Check
                    label={t('منتج مميز')}
                    value={!!draft.featured}
                    onChange={(v) => patch('featured', Number(v))}
                  />
                  <p className="muted product-featured-note">
                    {t(
                      'المنتج المميز يظهر قبل المنتجات غير المميزة، وتظهر على بطاقته شارة التميّز. يجب حفظه ونشره وإظهاره في المتجر.',
                    )}
                  </p>
                  <Field
                    path="color"
                    label={t('لون أزرار المنتج العادي')}
                    value={draft.color}
                    type="color"
                    onChange={(v) => patch('color', v)}
                  />
                </div>
              </details>
              <details className="product-optional-section">
                <summary>{t('الرابط الأساسي للمنتج')}</summary>
                <div className="product-editor-section-body">
                  {' '}
                  <label>
                    {t('طريقة عرض المنتج')}
                    <select
                      aria-label={t('طريقة عرض المنتج')}
                      value={draft.pageMode || 'product'}
                      onChange={(event) => patch('pageMode', event.target.value)}
                    >
                      <option value="product">{t('منتج عادي')}</option>
                      <option value="landing">{t('صفحة هبوط بالصور')}</option>
                    </select>
                  </label>
                  <p className="muted">
                    {draft.pageMode === 'landing'
                      ? t(
                          'يفتح الرابط الأساسي لاندينج باج بالصور واستمارة مستقلة. روابط السياسات أسفلها.',
                        )
                      : t(
                          'يفتح الرابط الأساسي صفحة عادية بالصور والوصف والعروض والإضافة إلى السلة. بيانات التوصيل عند إتمام الطلب.',
                        )}
                  </p>
                </div>
              </details>
            </div>
          </details>
        </section>
        <section className="panel">
          <details className="landing-products-editor" open>
            <summary>{t('المنتجات المتاحة للاختيار في الصفحة العادية والهبوط')}</summary>
            <p className="muted">
              {t(
                'المنتج الحالي متاح تلقائيًا. اختر حتى 6 منتجات إضافية؛ يطلب الزائر منتجًا واحدًا بسعره وباقاته. تظهر المنتجات المنشورة والمتوفرة فقط، حتى إن كانت مخفية من واجهة المتجر.',
              )}
            </p>
            <label>
              {t('البحث باسم أو كود المنتج')}
              <input
                type="search"
                value={landingChoiceSearch}
                onChange={(e) => setLandingChoiceSearch(e.target.value)}
              />
            </label>
            <div className="landing-products-picker">
              {rows
                .filter(
                  (p) =>
                    p.id !== draft.id &&
                    normalizeSearch(p.name + ' ' + p.sku).includes(
                      normalizeSearch(landingChoiceSearch),
                    ),
                )
                .map((p) => {
                  const ids = draft.presentation?.landingProductIds || [];
                  const selected = ids.includes(p.id);
                  const componentIds = draft.presentation?.landingPackComponentIds || [];
                  return (
                    <div className="landing-product-pick" key={p.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!selected && ids.length >= 6}
                          onChange={(e) =>
                            patch('presentation', {
                              ...draft.presentation,
                              landingProductIds: e.target.checked
                                ? [...ids, p.id]
                                : ids.filter((id) => id !== p.id),
                              landingPackComponentIds: e.target.checked
                                ? componentIds
                                : componentIds.filter((id) => id !== p.id),
                            })
                          }
                        />
                        {p.image && (
                          <img src={p.image} alt="" width="48" height="48" loading="lazy" />
                        )}
                        <span>
                          {p.name}
                          <small>
                            {p.sku} · {money(p.price)} ·{' '}
                            {t(
                              p.active && p.verified && p.stock > 0
                                ? 'متاح للطلب'
                                : 'غير متوفر حاليًا',
                            )}
                          </small>
                        </span>
                      </label>
                      {selected && (
                        <Check
                          label={t('مكوّن من الباك الحالي (قطعة واحدة)')}
                          value={componentIds.includes(p.id)}
                          onChange={(checked) =>
                            patch('presentation', {
                              ...draft.presentation,
                              landingPackComponentIds: checked
                                ? [...componentIds, p.id]
                                : componentIds.filter((id) => id !== p.id),
                            })
                          }
                        />
                      )}
                    </div>
                  );
                })}
            </div>
            <p className="muted">
              {t(
                'لحساب توفير الباك، حدّد مكوّناته الفردية فقط (منتجان على الأقل، قطعة من كل منتج). يظهر التوفير عندما يكون الباك أرخص من مجموع أسعارها الحالية. عدّل سعر كل منتج من صفحته.',
              )}
            </p>
          </details>
        </section>
        <section className="panel product-form-editor-panel">
          <details
            ref={landingEditor}
            className="product-customization"
            open={draft.pageMode === 'landing'}
          >
            <summary>{t('صفحة الهبوط')}</summary>
            <h2>{t('صور صفحة الهبوط وأزرارها واستمارتها')}</h2>
            <p className="muted">
              {t(
                'جهّز صفحة الإعلان للمنتج نفسه، حتى إذا كان الرابط الأساسي يعرض منتجًا عاديًا. ارفع الصور وأضف أزرار الشراء والاستمارة ورتّبها بالأسهم.',
              )}
            </p>
            <div className="product-presentation-links">
              <strong>{t('صفحتان للمنتج نفسه')}</strong>
              <p className="muted">
                {t(
                  'المتجر يعرض الصفحة العادية. استخدم رابط اللاندينج باج للإعلانات؛ لا تحتاج إلى تكرار المنتج.',
                )}
              </p>
              {draft.slug && (
                <div className="toolbar">
                  <a
                    className="secondary"
                    href={'/shop/' + draft.slug}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('فتح الصفحة العادية ↗')}
                  </a>
                  <a
                    className="secondary"
                    href={'/offers/' + draft.slug}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('فتح اللاندينج باج ↗')}
                  </a>
                </div>
              )}
              <small>{t('الروابط تعمل بعد حفظ المنتج ونشره.')}</small>
              <label>
                {t('لغة اللاندينج باج')}
                <select
                  aria-label={t('لغة اللاندينج باج')}
                  value={landingLanguage}
                  onChange={(event) =>
                    patch('presentation', {
                      ...draft.presentation,
                      landingLanguage: languageOf(event.target.value),
                    })
                  }
                >
                  {languages.map((language) => (
                    <option key={language} value={language}>
                      {languageNames[language]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                {t(
                  'اختر اللغة المطابقة للصورة. الأزرار والاستمارة والسياسات بهذه اللغة، دون زر تبديل للزائر. يمكنك تعديل النصوص الخاصة بها أدناه.',
                )}
              </p>
            </div>
            <div className="product-presentation-links landing-footer-settings">
              <strong>{t('التواصل أسفل صفحة الهبوط')}</strong>
              <Check
                label={t('إظهار الهاتف والبريد أسفل صفحة الهبوط')}
                value={draft.presentation?.landingFooter?.contact !== false}
                onChange={(contact) =>
                  patch('presentation', {
                    ...draft.presentation,
                    landingFooter: { ...draft.presentation?.landingFooter, contact },
                  })
                }
              />
              <Check
                label={t('إظهار روابط التواصل الاجتماعي أسفل صفحة الهبوط')}
                value={draft.presentation?.landingFooter?.socials !== false}
                onChange={(socials) =>
                  patch('presentation', {
                    ...draft.presentation,
                    landingFooter: { ...draft.presentation?.landingFooter, socials },
                  })
                }
              />
              <p className="muted">
                {t('هذه الخيارات خاصة بصفحة هبوط هذا المنتج. زر واتساب العائم مستقل عنها.')}
              </p>
            </div>
            <details className="landing-form-appearance" open>
              <summary>{t('ألوان استمارة الهبوط')}</summary>
              <p className="muted">
                {t(
                  'ألوان خاصة بصفحة هبوط هذا المنتج فقط. لا تغيّر استمارة المنتج العادي أو صفحات المنتجات الأخرى.',
                )}
              </p>
              <div className="settings-grid">
                {Object.entries(landingAppearanceLabels).map(([key, label]) => (
                  <Field
                    key={key}
                    path={'presentation.landingFormAppearance.' + key}
                    label={t(label)}
                    type="color"
                    value={
                      landingFormAppearance(draft, pricingSettings)[
                        key as keyof typeof landingAppearanceLabels
                      ]
                    }
                    onChange={(value) =>
                      patch('presentation', {
                        ...draft.presentation,
                        landingFormAppearance: {
                          ...landingFormAppearance(draft, pricingSettings),
                          [key]: value,
                        },
                      })
                    }
                  />
                ))}
              </div>
            </details>
            <div className="toolbar landing-editor-actions">
              {(['IMAGE', 'CTA', 'ORDER_FORM'] as const).map((type) => (
                <button
                  key={type}
                  disabled={
                    draft.blocks.length >= 50 ||
                    (type === 'ORDER_FORM' &&
                      draft.blocks.some((block) => block.type === 'ORDER_FORM'))
                  }
                  onClick={() =>
                    patch('blocks', [
                      ...draft.blocks,
                      {
                        id: crypto.randomUUID(),
                        type,
                        order: draft.blocks.length,
                        enabled: true,
                        settings: {},
                      },
                    ])
                  }
                >
                  {type === 'IMAGE' ? t('صورة +') : type === 'CTA' ? t('زر +') : t('استمارة +')}
                </button>
              ))}
              <button type="button" className="secondary" onClick={() => previewDraft('landing')}>
                {t('معاينة صفحة الهبوط')}
              </button>
            </div>
            {draft.blocks.some((block) => block.type === 'CTA' && block.enabled) &&
              draft.blocks.some((block) => block.type === 'ORDER_FORM') &&
              !draft.blocks.some((block) => block.type === 'ORDER_FORM' && block.enabled) && (
                <p className="notice">
                  {t('استمارة الطلب مخفية. أظهرها ليتمكن زر الشراء من الانتقال إليها.')}
                </p>
              )}
            {[...draft.blocks, ...(automaticForm ? [automaticForm] : [])].map((source, i) => {
              const b: Block = {
                ...source,
                settings:
                  source.type === 'ORDER_FORM'
                    ? localizedForm(landingUISettings, {
                        ...source.settings,
                        codBadgeText: landingBadgeText(
                          { ...draft, pageMode: 'landing' },
                          source.settings,
                          landingUISettings,
                        ),
                      })
                    : source.settings,
              };
              return (
                <article
                  className="editor-block"
                  draggable={b.id !== automaticForm?.id}
                  key={b.id}
                  onDragStart={() => setDrag(b.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => reorder(drag, b.id)}
                >
                  <div className="toolbar">
                    <b>
                      ⋮⋮{' '}
                      {b.type === 'IMAGE'
                        ? t('صورة')
                        : b.type === 'CTA'
                          ? t('زر شراء')
                          : t('استمارة')}
                    </b>
                    <>
                      <Check
                        label={t('ظاهر')}
                        value={b.enabled}
                        onChange={(v) => blockPatch(b.id, { enabled: v })}
                      />
                      <button
                        disabled={b.id === automaticForm?.id}
                        onClick={() => i > 0 && reorder(b.id, draft.blocks[i - 1].id)}
                      >
                        ↑
                      </button>
                      <button
                        onClick={() =>
                          b.id !== automaticForm?.id &&
                          i < draft.blocks.length - 1 &&
                          reorder(b.id, draft.blocks[i + 1].id)
                        }
                      >
                        ↓
                      </button>
                    </>
                    {b.type === 'CTA' && (
                      <button
                        type="button"
                        disabled={draft.blocks.length >= 50}
                        onClick={() => duplicateButton(b.id)}
                      >
                        {t('نسخ الزر')}
                      </button>
                    )}
                    <button
                      disabled={b.id === automaticForm?.id}
                      onClick={() =>
                        patch(
                          'blocks',
                          draft.blocks
                            .filter((x) => x.id !== b.id)
                            .map((b, i) => ({ ...b, order: i })),
                        )
                      }
                    >
                      {t('حذف')}
                    </button>
                  </div>
                  {b.type === 'IMAGE' ? (
                    <>
                      {b.settings.image && (
                        <a
                          href={b.settings.image}
                          target="_blank"
                          rel="noreferrer"
                          title={t('عرض الصورة بحجمها الكامل')}
                        >
                          <img src={b.settings.image} alt={t('معاينة')} />
                        </a>
                      )}
                      <Upload
                        action={action}
                        purpose="landing"
                        onUpload={(r) =>
                          blockPatch(b.id, {
                            settings: {
                              ...b.settings,
                              image: r.url,
                              width: r.width,
                              height: r.height,
                            },
                          })
                        }
                      />
                      <Field
                        path={`blocks.${i}.settings.image`}
                        label={t('رابط الصورة')}
                        value={b.settings.image || ''}
                        onChange={(v) => blockSettings(b.id, 'image', v)}
                      />
                      <Field
                        path={`blocks.${i}.settings.alt`}
                        label={t('وصف الصورة')}
                        value={b.settings.alt || ''}
                        onChange={(v) => blockSettings(b.id, 'alt', v)}
                      />
                      <div className="settings-grid">
                        <Field
                          path={`blocks.${i}.settings.width`}
                          label={t('عرض الصورة الأصلي')}
                          type="number"
                          value={b.settings.width || 1000}
                          onChange={(v) => blockSettings(b.id, 'width', Number(v))}
                        />
                        <Field
                          path={`blocks.${i}.settings.height`}
                          label={t('ارتفاع الصورة الأصلي')}
                          type="number"
                          value={b.settings.height || 1000}
                          onChange={(v) => blockSettings(b.id, 'height', Number(v))}
                        />
                      </div>
                    </>
                  ) : b.type === 'CTA' ? (
                    <>
                      <p className="muted">
                        {t('زر الشراء ينقل الزبون مباشرة إلى استمارة الطلب في هذه الصفحة.')}
                      </p>
                      <Field
                        path={`blocks.${i}.settings.text`}
                        label={t('نص الزر')}
                        value={localizedLandingButton(
                          landingUISettings,
                          b.settings.text as string | undefined,
                        )}
                        onChange={(v) => blockSettings(b.id, 'text', v)}
                      />
                      <div className="settings-grid">
                        <Field
                          path={`blocks.${i}.settings.color`}
                          label={t('لون الزر')}
                          type="color"
                          value={b.settings.color || draft.color}
                          onChange={(v) => blockSettings(b.id, 'color', v)}
                        />
                        <Field
                          path={`blocks.${i}.settings.textColor`}
                          label={t('لون النص')}
                          type="color"
                          value={b.settings.textColor || '#ffffff'}
                          onChange={(v) => blockSettings(b.id, 'textColor', v)}
                        />
                        <Field
                          path={`blocks.${i}.settings.backgroundColor`}
                          label={t('خلفية المساحة حول الزر')}
                          type="color"
                          value={b.settings.backgroundColor || landingUISettings.theme.background}
                          onChange={(v) => blockSettings(b.id, 'backgroundColor', v)}
                        />
                        <Field
                          path={`blocks.${i}.settings.size`}
                          label={t('حجم النص')}
                          type="number"
                          value={b.settings.size || 18}
                          onChange={(v) => blockSettings(b.id, 'size', Number(v))}
                        />
                        <Field
                          path={`blocks.${i}.settings.margin`}
                          label={t('المسافة حول الزر')}
                          type="number"
                          value={b.settings.margin ?? 24}
                          onChange={(v) => blockSettings(b.id, 'margin', Number(v))}
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <p className="muted">
                        {t(
                          'الاسم والهاتف والمدينة والعنوان مطلوبة للتوصيل. يمكنك تعديل تسمياتها والنص داخل الخانات وإظهار الملاحظات أو إخفائها.',
                        )}
                      </p>
                      <Field
                        path={`blocks.${i}.settings.codBadgeText`}
                        label={t('شارة الدفع أعلى الاستمارة')}
                        value={b.settings.codBadgeText ?? productFormDefaults.codBadgeText}
                        onChange={(v) => blockSettings(b.id, 'codBadgeText', v)}
                      />
                      <small className="muted">{t('اترك النص فارغًا لإخفاء الشارة.')}</small>
                      <Field
                        path={`blocks.${i}.settings.formTitle`}
                        label={t('عنوان الاستمارة')}
                        value={
                          b.settings.formTitle ??
                          (draft.offers.length ? productFormDefaults.formTitle : t('أكمل طلبك'))
                        }
                        onChange={(v) => blockSettings(b.id, 'formTitle', v)}
                      />
                      <Field
                        path={`blocks.${i}.settings.formSubtitle`}
                        label={t('وصف أعلى الاستمارة')}
                        value={b.settings.formSubtitle ?? productFormDefaults.formSubtitle}
                        onChange={(v) => blockSettings(b.id, 'formSubtitle', v)}
                      />
                      <Field
                        path={`blocks.${i}.settings.submitText`}
                        label={t('نص زر تأكيد الطلب')}
                        value={b.settings.submitText ?? productFormDefaults.submitText}
                        onChange={(v) => blockSettings(b.id, 'submitText', v)}
                      />
                      {(['name', 'phone', 'city', 'address'] as const).map((key) => (
                        <div className="settings-grid" key={key}>
                          <Field
                            path={`blocks.${i}.settings.${key}Label`}
                            label={
                              t('تسمية خانة ') +
                              {
                                name: t('الاسم'),
                                phone: t('الهاتف'),
                                city: t('المدينة'),
                                address: t('العنوان'),
                              }[key]
                            }
                            value={
                              (b.settings[(key + 'Label') as keyof FormContent] as string) ??
                              (productFormDefaults[
                                (key + 'Label') as keyof typeof productFormDefaults
                              ] as string)
                            }
                            onChange={(v) => blockSettings(b.id, key + 'Label', v)}
                          />
                          <Field
                            path={`blocks.${i}.settings.${key}Placeholder`}
                            label={
                              t('النص داخل خانة ') +
                              {
                                name: t('الاسم'),
                                phone: t('الهاتف'),
                                city: t('المدينة'),
                                address: t('العنوان'),
                              }[key]
                            }
                            value={
                              (b.settings[(key + 'Placeholder') as keyof FormContent] as string) ??
                              (productFormDefaults[
                                (key + 'Placeholder') as keyof typeof productFormDefaults
                              ] as string)
                            }
                            onChange={(v) => blockSettings(b.id, key + 'Placeholder', v)}
                          />
                        </div>
                      ))}
                      <Check
                        label={t('إظهار خانة ملاحظات التوصيل')}
                        value={b.settings.showNotes ?? true}
                        onChange={(v) => blockSettings(b.id, 'showNotes', v)}
                      />
                      {(b.settings.showNotes ?? true) && (
                        <>
                          <Field
                            path={`blocks.${i}.settings.notesLabel`}
                            label={t('تسمية خانة الملاحظات')}
                            value={b.settings.notesLabel ?? productFormDefaults.notesLabel}
                            onChange={(v) => blockSettings(b.id, 'notesLabel', v)}
                          />
                          <Field
                            path={`blocks.${i}.settings.notesPlaceholder`}
                            label={t('النص داخل خانة الملاحظات')}
                            value={
                              b.settings.notesPlaceholder ?? productFormDefaults.notesPlaceholder
                            }
                            onChange={(v) => blockSettings(b.id, 'notesPlaceholder', v)}
                          />
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </details>
        </section>
      </div>
    </FieldErrors.Provider>
  );
}
const statusLabels: Record<string, string> = {
  ...shippingLabels,
  pending_confirmation: 'قيد التأكيد',
  confirmed: 'مؤكد',
  cancelled: 'ملغى',
  not_sent: 'لم يُرسل',
  queued: 'في الانتظار',
  sent: 'أُرسل',
  error: 'خطأ',
  pending: 'قيد الانتظار',
  accepted: 'مقبول',
  in_transit: 'تم الشحن',
  delivered: 'تم التوصيل',
  returned: 'مرتجع',
  deleted: 'محذوف لدى مورد',
};
const orderErrorMessages: Record<string, string> = {
  network_unknown: 'تعذر الاتصال بمورد. الطلب محفوظ وسيُعاد إرساله تلقائيًا.',
  shipping_review_required:
    'تعذر اعتماد بيانات التوصيل التي أعادها مورد. الطلب محفوظ وسعر الزبون لم يتغير.',
  invalid_api_key_or_scope: 'مفتاح مورد غير صالح أو صلاحياته غير كافية. راجع الربط مع مورد.',
  missing_api_key: 'احفظ مفتاح مورد في صفحة الربط قبل إرسال الطلب.',
  rate_limit_exceeded: 'وصل الاتصال بمورد إلى حد الطلبات المؤقت. ستُعاد المحاولة تلقائيًا.',
  catalog_changed_review_required:
    'تغير توفر المنتج أو بيانات توريده. سعر الزبون محفوظ؛ راجع إمكانية توفيره قبل الإرسال.',
  catalog_cost_changed_review_required:
    'تغيرت تكلفة التوريد لدى مورد. سعر الزبون محفوظ؛ راجع الطلب قبل الإرسال.',
};
function Orders({ action }: { action: Action }) {
  const fromPath = () =>
    location.pathname.startsWith('/admin/orders/')
      ? decodeURIComponent(location.pathname.split('/')[3] || '') || null
      : null;
  const [rows, setRows] = useState<any[]>([]),
    [ready, setReady] = useState(false),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState(''),
    [financialFilter, setFinancialFilter] = useState(''),
    [callFilter, setCallFilter] = useState(''),
    [open, setOpen] = useState<string | null>(fromPath),
    [detailRow, setDetailRow] = useState<any>(null),
    [customer, setCustomer] = useState<any>(null),
    [receipt, setReceipt] = useState<any>(null),
    [editing, setEditing] = useState(false);
  const serial = useRef(0);
  const selected = rows.find((o) => o.id === open) || (detailRow?.id === open ? detailRow : null);
  const pending = rows.some(
    (o) =>
      o.status === 'confirmed' && !o.mowarid_id && ['queued', 'sending'].includes(o.sync_status),
  );
  const load = async () => {
    const version = ++serial.current;
    const orders = await api(
      '/admin/orders?page=' +
        page +
        '&shipping=' +
        encodeURIComponent(filter) +
        '&financial=' +
        encodeURIComponent(financialFilter) +
        '&call=' +
        encodeURIComponent(callFilter),
    );
    if (version === serial.current) {
      setRows(orders);
      setReady(true);
      if (open && !orders.some((o: any) => o.id === open)) {
        const detail = await api('/admin/orders/' + encodeURIComponent(open));
        if (version === serial.current) setDetailRow(detail);
      }
    }
  };
  useEffect(() => {
    void action(load, '');
    let inFlight = false;
    const timer = setInterval(
      () => {
        if (document.visibilityState !== 'visible' || inFlight) return;
        inFlight = true;
        void load()
          .catch(() => {})
          .finally(() => (inFlight = false));
      },
      pending ? 2500 : 30000,
    );
    return () => {
      clearInterval(timer);
      serial.current++;
    };
  }, [page, filter, financialFilter, callFilter, pending, open]);
  useEffect(() => {
    const listener = () => {
      setOpen(fromPath());
      setEditing(false);
    };
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);
  useEffect(() => {
    if (!open || !ready || selected) return;
    let current = true;
    void action(async () => {
      const item = await api('/admin/orders/' + encodeURIComponent(open));
      if (current) {
        setDetailRow(item);
        setCustomer({ ...item.customer });
      }
    }, '');
    return () => {
      current = false;
    };
  }, [open, ready, selected]);
  useEffect(() => {
    void api('/admin/orders/sync', {}).catch(() => {});
  }, []);
  const view = (o: any) => {
    setOpen(o.id);
    setDetailRow(o);
    setCustomer({ ...o.customer });
    setEditing(false);
    history.pushState({}, '', '/admin/orders/' + encodeURIComponent(o.id));
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const back = () => {
    setOpen(null);
    setEditing(false);
    history.pushState({}, '', '/admin/orders');
  };
  const doOrder = (id: string, task: string) =>
    action(async () => {
      try {
        await api('/admin/orders/' + id + '/' + task, {});
      } catch (error) {
        await load().catch(() => {});
        throw error;
      }
      await load();
      if (selected?.id === id && !rows.some((o) => o.id === id))
        setDetailRow(await api('/admin/orders/' + encodeURIComponent(id)));
    }, t('تم تحديث الطلب.'));
  const pricing = (o: any) => o.pricing || orderPricing(o);
  const amount = (o: any) => o.delivered_total ?? pricing(o).customer.total ?? o.quote.total;
  const date = (o: any, time = false) => {
    const value = o.created_at || o.remote?.timestamps?.created_at;
    return value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString(adminLanguage() === 'ar' ? 'ar-MA' : adminLanguage(), {
          timeZone: 'Africa/Casablanca',
          ...(time
            ? { hour: '2-digit', minute: '2-digit' }
            : { year: 'numeric', month: '2-digit', day: '2-digit' }),
        })
      : '—';
  };
  const phase = (o: any) =>
    o.shipping_status
      ? shippingLabels[o.shipping_status] ||
        o.remote?.status?.shipping_status_label ||
        statusLabels[o.shipping_status] ||
        o.shipping_status
      : o.sync_status === 'error'
        ? t('خطأ')
        : o.mowarid_id
          ? t('قيد الانتظار')
          : statusLabels[o.status] || o.status;
  const sync = (o: any) =>
    o.mowarid_id
      ? 'وصل إلى مورد'
      : ['queued', 'sending'].includes(o.sync_status)
        ? 'جارٍ الإرسال إلى مورد'
        : statusLabels[o.sync_status] || o.sync_status;
  const phaseCode = (o: any) =>
    o.shipping_status ||
    (o.sync_status === 'error' ? 'error' : o.mowarid_id ? 'pending' : o.status);
  const callStatus = (o: any) =>
    activeCallStatus(
      {
        ...o.remote?.status,
        shipping_status: o.shipping_status || o.remote?.status?.shipping_status,
      },
      o.status,
    );
  const statusBadge = (label: string, code: string) => (
    <span className={'order-status-badge status-' + statusTone(code)}>
      <OrderIcon
        name={
          statusTone(code) === 'danger'
            ? 'close'
            : statusTone(code) === 'success'
              ? 'check'
              : ['shipped', 'in_transit'].includes(code)
                ? 'truck'
                : 'clock'
        }
      />
      {t(label)}
    </span>
  );
  const phaseBadges = (o: any) => (
    <div className="order-phase-badges">
      {statusBadge(phase(o), phaseCode(o))}
      {callStatus(o) && callStatus(o) !== 'pending' && (
        <span
          className={
            'order-status-badge ' +
            (callStatus(o) === 'postponed' ? 'status-postponed' : 'status-warning')
          }
        >
          <OrderIcon name={callStatus(o) === 'postponed' ? 'calendar' : 'phone'} />
          {t(callLabels[callStatus(o)!])}
          {postponementDate(o.remote?.status) ? (
            <time className="order-postponement-note" dateTime={postponementDate(o.remote.status)!}>
              {formatAppointment(postponementDate(o.remote.status)!)}
            </time>
          ) : postponementNote(o.remote?.status) ? (
            <span className="order-postponement-note">
              {postponementNote(o.remote.status).slice(0, 80)}
              {postponementNote(o.remote.status).length > 80 ? '…' : ''}
            </span>
          ) : null}
        </span>
      )}
    </div>
  );
  const formatAppointment = (date: string) =>
    new Date(date).toLocaleString(adminLanguage(), {
      timeZone: 'Africa/Casablanca',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  const number = (o: any) => o.remote?.order_number || o.ref;
  const vendorLink = (o: any) =>
    'https://mowarid.ma/dashboard/orders' +
    (/^#?MDK-[\d-]+$/.test(o.remote?.order_number || '')
      ? '/' + encodeURIComponent(o.remote.order_number.replace(/^#/, ''))
      : '');
  const contacts = (o: any, labelled = false) => (
    <>
      <a
        className={'order-button order-contact-phone' + (labelled ? '' : ' icon-only')}
        aria-label={t('اتصال')}
        title={t('اتصال')}
        href={'tel:' + o.customer.phone}
      >
        <OrderIcon name="phone" />
        {labelled && t('اتصال')}
      </a>
      <a
        className={'order-button order-contact-whatsapp' + (labelled ? '' : ' icon-only')}
        aria-label={t('واتساب')}
        title={t('واتساب')}
        target="_blank"
        rel="noreferrer"
        href={
          'https://wa.me/212' +
          o.customer.phone.slice(1) +
          '?text=' +
          encodeURIComponent(t('مرحبًا ') + o.customer.name + t('، نود تأكيد طلبك ') + o.ref)
        }
      >
        <OrderIcon name="whatsapp" />
        {labelled && t('واتساب')}
      </a>
    </>
  );
  const actions = (o: any, detail = false) => (
    <div className="order-actions">
      {!detail && (
        <button className="order-button" onClick={() => view(o)}>
          <OrderIcon name="eye" />
          {t('التفاصيل')}
        </button>
      )}
      {!detail && (
        <button
          className="order-button icon-only receipt-button"
          aria-label={t('وصل الشراء')}
          title={t('وصل الشراء')}
          onClick={() => setReceipt(o)}
        >
          <OrderIcon name="receipt" />
        </button>
      )}
      {!detail && contacts(o)}
      {o.status === 'pending_confirmation' && !o.post_attempted && !o.mowarid_id && (
        <button
          className="order-button order-button-primary"
          onClick={() => void doOrder(o.id, 'confirm')}
        >
          <OrderIcon name="send" />
          {t('تأكيد وإرسال إلى مورد')}
        </button>
      )}
      {o.status === 'confirmed' && !o.mowarid_id && o.sync_status === 'error' && (
        <button
          className="order-button order-button-primary"
          onClick={() => void doOrder(o.id, 'confirm')}
        >
          <OrderIcon name="send" />
          {t('إعادة الإرسال إلى مورد')}
        </button>
      )}
      {o.post_attempted > 0 && !o.mowarid_id && (
        <button className="order-button" onClick={() => void doOrder(o.id, 'reconcile')}>
          <OrderIcon name="refresh" />
          {t('تحديث حالة الإرسال')}
        </button>
      )}
      {!o.mowarid_id &&
        !o.post_attempted &&
        ['pending_confirmation', 'confirmed'].includes(o.status) && (
          <button
            className="order-button order-button-danger"
            onClick={() => void doOrder(o.id, 'cancel')}
          >
            <OrderIcon name="close" />
            {t('إلغاء الطلب')}
          </button>
        )}
      {detail && o.mowarid_id && (
        <button className="order-button" onClick={() => void doOrder(o.id, 'refresh')}>
          <OrderIcon name="refresh" />
          {t('تحديث الشحن')}
        </button>
      )}
    </div>
  );
  const warnings = (o: any) => (
    <>
      {o.status === 'confirmed' && !o.mowarid_id && (
        <p className={o.sync_status === 'error' ? 'error-text' : 'muted'} role="status">
          {t(
            o.post_attempted > 0
              ? 'لم تتأكد نتيجة الإرسال بعد. حدّث حالة الإرسال قبل إعادة المحاولة.'
              : o.sync_status === 'error'
                ? 'لم يصل الطلب إلى مورد. راجع سبب التعثر ثم أعد الإرسال.'
                : 'الطلب مؤكد محليًا ولم يصل إلى مورد بعد. جارٍ الإرسال تلقائيًا.',
          )}
        </p>
      )}
      {o.last_error &&
        !(o.last_error === 'remote_cod_changed' && closedOrder(o.shipping_status, o.status)) && (
          <p className="error-text">
            {t(
              o.last_error === 'remote_cod_changed'
                ? 'تغيّر مبلغ التحصيل لدى مورد. المبلغ الأصلي محفوظ، وتُحسب قيمة التسليم بالمبلغ المرصود عند التسليم.'
                : orderErrorMessages[o.last_error] ||
                    'تعذر إرسال الطلب إلى مورد. تحقق من الربط ثم أعد المحاولة.',
            )}
          </p>
        )}
      {o.hold_reason && (
        <p className="error-text">
          {o.hold_reason === 'negative_margin_on_shipping_update'
            ? t('أوقف مورد الطلب لأن تعديل الوجهة جعل إجمالي التحصيل أقل من الجملة ورسم الشحن.')
            : t('سبب الإيقاف لدى مورد: ') + o.hold_reason}{' '}
          <a href={vendorLink(o)} target="_blank" rel="noopener noreferrer">
            {t('مراجعة التعديل في لوحة مورد')}
          </a>
        </p>
      )}
      {o.remote?.shipping?.delivery_warning && (
        <p className="error-text">
          {t('تنبيه مورد:')}
          {o.remote.shipping.delivery_warning}
        </p>
      )}
    </>
  );
  if (open) {
    if (!selected)
      return (
        <section className="panel">
          <button className="order-button" onClick={back}>
            <OrderIcon name="back" />
            {t('العودة إلى الطلبات')}
          </button>
          <p>{t('جارٍ تحميل الطلب…')}</p>
        </section>
      );
    const o = selected,
      p = pricing(o),
      canEdit =
        !o.mowarid_id &&
        !o.post_attempted &&
        (o.status === 'pending_confirmation' ||
          (o.status === 'confirmed' && o.sync_status === 'error'));
    const current = o.remote?.customer || o.customer;
    return (
      <article className="editor-block order-full-detail">
        <div className="order-detail-heading">
          <div>
            <h2>{t('تفاصيل الطلب')}</h2>
            <strong>{number(o)}</strong>
            {number(o) !== o.ref && <small className="muted">{o.ref}</small>}
          </div>
          <div className="order-actions">
            <button className="order-button" onClick={back}>
              <OrderIcon name="back" />
              {t('العودة إلى الطلبات')}
            </button>
            <button className="order-button order-button-primary" onClick={() => setReceipt(o)}>
              <OrderIcon name="receipt" />
              {t('وصل الشراء')}
            </button>
            <button
              className="order-button"
              onClick={() =>
                void action(async () => {
                  await api('/admin/orders/sync', {});
                  await load();
                }, '')
              }
            >
              <OrderIcon name="refresh" />
              {t('تحديث')}
            </button>
          </div>
        </div>
        {warnings(o)}
        <div
          className="order-detail order-detail-layout"
          role="region"
          aria-label={t('تفاصيل الأسعار')}
        >
          <OrderPricingPanel pricing={p} view="summary" />
          <div className="order-customer-column" dir={adminLanguage() === 'ar' ? 'rtl' : 'ltr'}>
            <div className="order-facts">
              <div>
                <span>
                  <OrderIcon name="calendar" />
                  {t('التاريخ')}
                </span>
                <strong>{date(o)}</strong>
              </div>
              <div>
                <span>
                  <OrderIcon name="clock" />
                  {t('الوقت')}
                </span>
                <strong>{date(o, true)}</strong>
              </div>
              <div>
                <span>{t('النموذج')}</span>
                <strong>{t('الدفع عند الاستلام')}</strong>
              </div>
              <div>
                <span>{t('الحالة')}</span>
                {phaseBadges(o)}
              </div>
            </div>
            <section className="order-customer-card">
              <h3>
                <OrderIcon name="user" />
                {t('بيانات الزبون')}
              </h3>
              <div className="order-customer-main">
                <div>
                  <strong>{o.customer.name}</strong>
                  <a href={'tel:' + o.customer.phone} dir="ltr">
                    {o.customer.phone}
                  </a>
                  <p>
                    {current.city || o.customer.city} · {current.address || o.customer.address}
                  </p>
                  {o.customer.notes && <p>{o.customer.notes}</p>}
                </div>
                <div className="order-customer-buttons">
                  <div className="order-actions">{contacts(o, true)}</div>
                  {canEdit ? (
                    <button
                      className="order-button"
                      onClick={() => {
                        setCustomer({ ...o.customer });
                        setEditing(!editing);
                      }}
                    >
                      <OrderIcon name="edit" />
                      {t('تعديل بيانات الزبون')}
                    </button>
                  ) : (
                    o.mowarid_id &&
                    !closedOrder(o.shipping_status, o.status) && (
                      <a
                        className="order-button"
                        href={vendorLink(o)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <OrderIcon name="edit" />
                        {t('تعديل العنوان في مورد')}
                      </a>
                    )
                  )}
                </div>
              </div>
              {editing && canEdit && customer && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action(async () => {
                      await api('/admin/orders/' + o.id + '/customer', customer, 'PATCH');
                      await load();
                      setEditing(false);
                    });
                  }}
                >
                  <div className="settings-grid">
                    {['name', 'phone', 'city', 'address', 'notes'].map((k) => (
                      <Field
                        key={k}
                        label={
                          {
                            name: t('الاسم'),
                            phone: t('الهاتف'),
                            city: t('المدينة'),
                            address: t('العنوان'),
                            notes: t('الملاحظات'),
                          }[k]!
                        }
                        value={customer[k]}
                        onChange={(value) => setCustomer({ ...customer, [k]: value })}
                      />
                    ))}
                  </div>
                  <button className="order-button order-button-primary">
                    <OrderIcon name="check" />
                    {t('حفظ التصحيح')}
                  </button>
                </form>
              )}
              {o.original_customer &&
                JSON.stringify(o.original_customer) !== JSON.stringify(o.customer) && (
                  <details>
                    <summary>{t('عرض البيانات الأصلية')}</summary>
                    <p>
                      {o.original_customer.name} · {o.original_customer.phone}
                    </p>
                    <p>
                      {o.original_customer.city} · {o.original_customer.address}
                    </p>
                    <p>{o.original_customer.notes || '—'}</p>
                  </details>
                )}
            </section>
            {o.mowarid_id && closedOrder(o.shipping_status, o.status) && (
              <section
                className="order-cancellation-reason"
                aria-label={t('سبب الإلغاء / الإرجاع')}
              >
                <h3>{t('سبب الإلغاء / الإرجاع')}</h3>
                <p>
                  {cancellationReason(o.remote?.status, o.shipping_status) ||
                    t('لم يرسل مورد سبب الإلغاء أو الإرجاع عبر الربط بعد.')}
                </p>
              </section>
            )}
            <OrderPricingPanel pricing={p} view="products" />
            <section className="order-followup">
              <dl>
                <dt>{t('التسوية')}</dt>
                <dd>
                  {statusBadge(
                    financialLabel(
                      o.financial_status,
                      o.status,
                      o.remote?.status?.financial_status_label,
                      o.shipping_status,
                    ),
                    o.financial_status,
                  )}
                </dd>
                {callStatus(o) && (
                  <>
                    <dt>{t('متابعة الاتصال لدى مورد')}</dt>
                    <dd>{statusBadge(callLabels[callStatus(o)!], callStatus(o)!)}</dd>
                  </>
                )}
                {o.remote?.timestamps?.updated_at && (
                  <>
                    <dt>{t('آخر تحديث')}</dt>
                    <dd>
                      {new Date(o.remote.timestamps.updated_at).toLocaleString(adminLanguage(), {
                        timeZone: 'Africa/Casablanca',
                      })}
                    </dd>
                  </>
                )}
                {callStatus(o) && postponementDate(o.remote?.status) && (
                  <>
                    <dt>{t('موعد الاتصال أو التسليم القادم')}</dt>
                    <dd>
                      <time dateTime={postponementDate(o.remote.status)!}>
                        {formatAppointment(postponementDate(o.remote.status)!)}
                      </time>
                    </dd>
                  </>
                )}
                {callStatus(o) &&
                  postponementNote(o.remote?.status) &&
                  (postponementDate(o.remote?.status) ||
                    postponementNote(o.remote.status).length > 80) && (
                    <>
                      <dt>{t('ملاحظة التأجيل')}</dt>
                      <dd>{postponementNote(o.remote.status)}</dd>
                    </>
                  )}
                {o.mowarid_id && (
                  <>
                    <dt>{t('رقم التتبع')}</dt>
                    <dd>
                      {o.remote?.shipping?.tracking_number || t('لم يوفر مورد رقم التتبع بعد')}
                    </dd>
                  </>
                )}
                {o.mowarid_id && (
                  <>
                    <dt>{t('تتبع الطلب')}</dt>
                    <dd>
                      <a
                        className="order-button"
                        href={vendorLink(o)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <OrderIcon name="send" />
                        {t('تتبع الطلب بمورد')}
                      </a>
                    </dd>
                  </>
                )}
                {o.remote?.shipping?.delivery_agent_phone && (
                  <>
                    <dt>{t('الموزع')}</dt>
                    <dd>
                      <a href={'tel:' + o.remote.shipping.delivery_agent_phone}>
                        {o.remote.shipping.delivery_agent_name} ·{' '}
                        {o.remote.shipping.delivery_agent_phone}
                      </a>
                    </dd>
                  </>
                )}
                {o.attribution?.last?.utm_source && (
                  <>
                    <dt>{t('مصدر الطلب')}</dt>
                    <dd>
                      {t(
                        sourceNames[o.attribution.last.utm_source.toLowerCase()] ||
                          o.attribution.last.utm_source,
                      )}
                    </dd>
                  </>
                )}
                {o.attribution?.last?.utm_campaign && (
                  <>
                    <dt>{t('الحملة')}</dt>
                    <dd>{o.attribution.last.utm_campaign}</dd>
                  </>
                )}
                {o.delivered_total !== null && o.delivered_total !== undefined && (
                  <>
                    <dt>{t('المبلغ المرصود عند التسليم')}</dt>
                    <dd>{money(o.delivered_total)}</dd>
                  </>
                )}
              </dl>
            </section>
          </div>
        </div>
        <div className="order-detail-footer">
          <strong aria-label={t('مبلغ التحصيل')}>{money(amount(o))}</strong>
          {actions(o, true)}
        </div>
        {o.mowarid_id && o.shipping_status === 'pending' && (
          <p className="muted">
            {t('الإلغاء بعد قبول الطلب يتم من')}{' '}
            <a href={vendorLink(o)} target="_blank" rel="noopener noreferrer">
              {t('لوحة مورد')}
            </a>{' '}
            {t('ما دام الطلب قيد التجهيز هناك، ثم تُزامن حالته هنا.')}
          </p>
        )}
        {receipt && <OrderReceipt order={receipt} onClose={() => setReceipt(null)} />}
      </article>
    );
  }
  return (
    <section className="panel order-list-panel">
      <p className="muted order-sync-note">
        {t('تُحدّث حالات الطلبات تلقائيًا أثناء فتح الصفحة.')}
      </p>
      <div className="toolbar">
        <label>
          {t('حالة الشحن والتوريد')}
          <select
            aria-label={t('حالة الشحن والتوريد')}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('الكل')}</option>
            {Object.entries(orderPhaseLabels).map(([code, label]) => (
              <option key={code} value={code}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('حالة الأرباح')}
          <select
            aria-label={t('حالة الأرباح')}
            value={financialFilter}
            onChange={(e) => {
              setFinancialFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('الكل')}</option>
            {Object.entries(financialLabels).map(([code, label]) => (
              <option key={code} value={code}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('حالة الاتصال لدى مورد')}
          <select
            aria-label={t('حالة الاتصال لدى مورد')}
            value={callFilter}
            onChange={(event) => {
              setCallFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('الكل')}</option>
            {Object.entries(callLabels).map(([code, label]) => (
              <option key={code} value={code}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="order-button"
          onClick={() =>
            void action(async () => {
              await api('/admin/orders/sync', {});
              await load();
            }, t('تم طلب التحديث من مورد؛ ستظهر الحالات عند وصولها.'))
          }
        >
          <OrderIcon name="refresh" />
          {t('تحديث')}
        </button>
      </div>
      <div className="table-wrap">
        <table className="admin-orders-table">
          <thead>
            <tr>
              {[
                'رقم الطلب',
                'التاريخ',
                'النموذج',
                'العميل',
                'المستحقات',
                'الحالة',
                'الإجراءات',
              ].map((label) => (
                <th key={label}>{t(label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr className="editor-block order-row" key={o.id}>
                <td data-label={t('رقم الطلب')}>
                  <strong>{number(o)}</strong>
                  {number(o) !== o.ref && <small>{o.ref}</small>}
                </td>
                <td data-label={t('التاريخ')}>
                  {date(o)}
                  <small>{date(o, true)}</small>
                </td>
                <td data-label={t('النموذج')}>{t('الدفع عند الاستلام')}</td>
                <td data-label={t('العميل')}>
                  <strong>{o.customer.name}</strong>
                  <small>{o.customer.city}</small>
                  <strong className="order-customer-total" aria-label={t('مبلغ التحصيل')}>
                    {money(amount(o))}
                  </strong>
                </td>
                <td data-label={t('المستحقات')}>
                  <strong
                    className={
                      'order-profit' +
                      ((pricing(o).merchant.profit ?? 0) < 0 ? ' negative-profit' : '')
                    }
                  >
                    {pricing(o).merchant.profit === null ? '—' : money(pricing(o).merchant.profit)}
                  </strong>
                </td>
                <td data-label={t('الحالة')}>
                  <div className="order-status-cell">
                    {phaseBadges(o)}
                    {o.remote?.shipping?.tracking_number && (
                      <small className="order-tracking-number">
                        <OrderIcon name="truck" />
                        {o.remote.shipping.tracking_number}
                      </small>
                    )}
                    {!o.mowarid_id && <small>{t(sync(o))}</small>}
                    {o.financial_status !== 'pending' &&
                      statusBadge(
                        financialLabel(
                          o.financial_status,
                          o.status,
                          o.remote?.status?.financial_status_label,
                          o.shipping_status,
                        ),
                        o.financial_status,
                      )}
                    {o.hold_reason && <span className="badge error">{t('موقوف للمراجعة')}</span>}
                  </div>
                </td>
                <td data-label={t('الإجراءات')}>
                  {actions(o)}
                  {o.last_error &&
                    !(
                      o.last_error === 'remote_cod_changed' &&
                      closedOrder(o.shipping_status, o.status)
                    ) && (
                      <small className="error-text">
                        {t(
                          orderErrorMessages[o.last_error] ||
                            'راجع تفاصيل الطلب لمعرفة سبب التعثر.',
                        )}
                      </small>
                    )}
                  {o.hold_reason && warnings(o)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="empty-state">{t('لا توجد طلبات لهذه الفترة.')}</p>}
      <div className="toolbar">
        <button className="order-button" disabled={page === 1} onClick={() => setPage(page - 1)}>
          {t('السابق')}
        </button>
        <span>
          {t('صفحة')}
          {page}
        </span>
        <button
          className="order-button"
          disabled={rows.length < 30}
          onClick={() => setPage(page + 1)}
        >
          {t('التالي')}
        </button>
      </div>
      {receipt && <OrderReceipt order={receipt} onClose={() => setReceipt(null)} />}
    </section>
  );
}
function Media({ action }: { action: Action }) {
  const [rows, setRows] = useState<any[]>([]);
  const load = async () => setRows(await api('/admin/media'));
  useEffect(() => {
    void action(load, '');
  }, []);
  return (
    <section className="panel">
      <Upload action={action} onUpload={() => void load()} />
      <ImageGuide />
      <div className="media-grid">
        {rows.map((r) => (
          <article key={r.id}>
            <img src={r.url} alt={t('صورة المتجر')} />
            <small>
              {r.width} × {r.height} · {Math.round(r.size / 1000)} KB
            </small>
            <div className="toolbar">
              <button
                onClick={() =>
                  void action(() => navigator.clipboard.writeText(r.url), t('تم نسخ الرابط.'))
                }
              >
                {t('نسخ الرابط')}
              </button>
              <button
                onClick={() =>
                  void action(async () => {
                    await api('/admin/media/' + r.id, undefined, 'DELETE');
                    await load();
                  }, t('تم حذف الصورة غير المستخدمة.'))
                }
              >
                {t('حذف')}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
function Account({ action }: { action: Action }) {
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [codes, setCodes] = useState<string[]>([]),
    [email, setEmail] = useState('');
  useEffect(() => {
    void action(async () => {
      const a = await api('/admin/account');
      setEmail(a.email);
    }, '');
  }, []);
  return (
    <>
      <section className="panel">
        <h2>{t('تغيير كلمة المرور')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const r = await api('/admin/password', { current, password });
              csrf = r.csrf;
              setCodes(r.recovery);
              setEmail(r.email);
              setCurrent('');
              setPassword('');
            }, t('تم تغيير كلمة المرور وإبطال الجلسات السابقة.'));
          }}
        >
          <Field
            label={t('كلمة المرور الحالية')}
            value={current}
            onChange={setCurrent}
            type="password"
          />
          <Field
            label={t('كلمة المرور الجديدة (8 أحرف على الأقل)')}
            value={password}
            onChange={setPassword}
            type="password"
          />
          <button className="primary">{t('تغيير كلمة المرور')}</button>
        </form>
        {codes.length > 0 && (
          <>
            <h3>{t('ملف الاسترداد الجديد')}</h3>
            <p>{t('أُلغي الملف السابق بعد تغيير كلمة المرور. احفظ الملف الجديد الآن.')}</p>
            <RecoveryFile codes={codes} email={email} />
          </>
        )}
      </section>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

function LanguagePicker({
  authenticated = false,
  action,
}: {
  authenticated?: boolean;
  action: Action;
}) {
  return (
    <label className="language-picker">
      {t('لغة الإدارة')}
      <select
        aria-label={t('لغة الإدارة')}
        value={adminLanguage()}
        onChange={(event) => {
          const language = languageOf(event.target.value);
          if (authenticated)
            void action(async () => {
              await api('/admin/language', { scope: 'admin', language }, 'PATCH');
              setAdminLanguage(language);
            }, '');
          else setAdminLanguage(language);
        }}
      >
        {languages.map((language) => (
          <option key={language} value={language}>
            {languageNames[language]}
          </option>
        ))}
      </select>
    </label>
  );
}

function InterfaceCopy({
  s,
  setS,
  language = s.storeLanguage,
}: {
  s: Settings;
  language?: Language;
  setS: (value: Settings) => void;
}) {
  const [key, setKey] = useState('متابعة التسوق'),
    [filter, setFilter] = useState('');
  const translate = storeTranslator({ ...s, storeLanguage: language }),
    current = s.contentTranslations?.[language]?.copy || {};
  const keys = storeCopyKeys.filter((key) =>
    translate(key).toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <details className="wide translation-settings">
      <summary>
        {t('تخصيص العبارات')} · {languageNames[language]}
      </summary>
      <Field label={t('بحث')} value={filter} onChange={setFilter} />
      <label>
        {t('اختر العبارة')}
        <select
          aria-label={t('اختر العبارة')}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        >
          {keys.map((key) => (
            <option value={key} key={key}>
              {translate(key)}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={t('النص المخصص')}
        type="textarea"
        value={translate(key)}
        onChange={(value) =>
          setS(updateContent(s, { copy: { ...current, [key]: value } }, language))
        }
      />
      <button
        type="button"
        onClick={() => {
          const next = { ...current };
          delete next[key];
          setS(updateContent(s, { copy: next }, language));
        }}
      >
        {t('استعادة النص الافتراضي')}
      </button>
    </details>
  );
}

function DeadlineField({
  value,
  onChange,
}: {
  value?: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <Field
      label={t('نهاية العرض (اختياري، بتوقيت جهازك)')}
      type="datetime-local"
      value={toLocalDateTime(value)}
      onChange={(v) => onChange(toUtcDateTime(String(v)))}
    />
  );
}
