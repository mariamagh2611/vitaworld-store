import React, { useEffect, useRef, useState } from 'react';
import { t, money, adminLanguage } from './language';
import { businessDate } from '../shared/time';
import {
  campaignSourceNames,
  canonicalCampaignSource,
  groupCampaigns,
  filterCampaignLinks,
  campaignPage,
  campaignMetrics,
  type CampaignMetric,
  type CampaignRow,
  type SavedCampaignLink,
} from '../shared/campaigns';

type Action = (fn: () => Promise<unknown>, message?: string) => Promise<void>;
type Api = (path: string, body?: unknown, method?: string) => Promise<any>;
const sourceLabel = (source: string) =>
  t(campaignSourceNames[canonicalCampaignSource(source)] || source);
const metricLabels = [
  'الزيارات',
  'الوصول لصفحة الشراء',
  'الطلبات',
  'تم توصيلها',
  'الإيراد المسلّم',
];
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="campaign-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button type="button" onClick={close} aria-label={t('إغلاق')}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Pager({
  data,
  change,
}: {
  data: { page: number; pages: number; count: number };
  change: (page: number) => void;
}) {
  return (
    <nav className="campaign-pagination" aria-label={t('صفحات النتائج')}>
      <span>
        {t('عدد النتائج')}: {data.count}
      </span>
      <div>
        <button type="button" disabled={data.page === 1} onClick={() => change(data.page - 1)}>
          {t('السابق')}
        </button>
        <span>
          {data.page} / {data.pages}
        </span>
        <button
          type="button"
          disabled={data.page === data.pages}
          onClick={() => change(data.page + 1)}
        >
          {t('التالي')}
        </button>
      </div>
    </nav>
  );
}
export function Analytics({ action, full, api }: { action: Action; full: boolean; api: Api }) {
  const [data, setData] = useState<{
    metrics: Record<string, number>;
    campaigns: CampaignRow[];
    note: string;
  } | null>(null);
  const [from, setFrom] = useState(businessDate(new Date(Date.now() - 30 * 86400000))),
    [to, setTo] = useState(businessDate());
  const [tab, setTab] = useState<'performance' | 'links'>('performance'),
    [search, setSearch] = useState(''),
    [source, setSource] = useState(''),
    [sort, setSort] = useState<CampaignMetric>('visits');
  const [performancePage, setPerformancePage] = useState(1),
    [linksPage, setLinksPage] = useState(1);
  const [links, setLinks] = useState<SavedCampaignLink[]>([]),
    [creating, setCreating] = useState(false),
    [detail, setDetail] = useState<SavedCampaignLink | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null),
    [target, setTarget] = useState(location.origin + '/'),
    [linkSource, setLinkSource] = useState('facebook'),
    [campaign, setCampaign] = useState(''),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState(''),
    [detailMessage, setDetailMessage] = useState(''),
    [copiedUrl, setCopiedUrl] = useState('');
  const serial = useRef(0),
    saveLock = useRef(false);
  const load = async () => {
    const id = ++serial.current;
    const result = await api('/admin/analytics?from=' + from + '&to=' + to);
    if (id === serial.current) setData(result);
  };
  useEffect(() => {
    void action(load, '');
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load().catch(() => {});
    }, 30000);
    return () => {
      clearInterval(timer);
      serial.current++;
    };
  }, [from, to]);
  useEffect(() => {
    if (full) void action(async () => setLinks(await api('/admin/campaign-links')), '');
  }, [full]);
  const resetPages = () => {
    setPerformancePage(1);
    setLinksPage(1);
    setExpanded(null);
  };
  const copy = (url: string) =>
    void action(async () => {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
    }, '');
  if (!data) return <p className="loading">{t('جارٍ تحميل الطلبات…')}</p>;
  const groups = groupCampaigns(data.campaigns, search, source, sort),
    performance = campaignPage(groups, performancePage),
    saved = campaignPage(filterCampaignLinks(links, search, source), linksPage);
  const sources = [
    ...new Set([
      ...data.campaigns.map((row) => canonicalCampaignSource(row.source)),
      ...links.map((link) => canonicalCampaignSource(link.source)),
    ]),
  ].sort();
  const name = (group: ReturnType<typeof groupCampaigns>[number]) =>
    group.campaign || sourceLabel(group.sources[0].source);
  return (
    <div className="campaign-analytics">
      {full && (
        <div className="campaign-header">
          <div role="tablist" aria-label={t('مصادر المبيعات')}>
            {(['performance', 'links'] as const).map((value) => (
              <button
                key={value}
                id={'campaign-tab-' + value}
                role="tab"
                aria-selected={tab === value}
                aria-controls="campaign-panel"
                tabIndex={tab === value ? 0 : -1}
                onClick={() => setTab(value)}
                onKeyDown={(e) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                    e.preventDefault();
                    const next =
                      e.key === 'Home'
                        ? 'performance'
                        : e.key === 'End'
                          ? 'links'
                          : tab === 'performance'
                            ? 'links'
                            : 'performance';
                    setTab(next);
                    document.getElementById('campaign-tab-' + next)?.focus();
                  }
                }}
              >
                {t(value === 'performance' ? 'الأداء' : 'الروابط')}
              </button>
            ))}
          </div>
          <button
            className="primary"
            type="button"
            onClick={() => {
              setCampaign('');
              setFormError('');
              setCreating(true);
            }}
          >
            {t('إنشاء رابط')}
          </button>
        </div>
      )}
      {!full && (
        <div className="metrics-grid">
          {[
            ['مجموع الطلبات', 'orders'],
            ['مرسل لمورد', 'sent'],
            ['غير مرسل لمورد', 'not_sent'],
            ['قيد التنفيذ', 'in_progress'],
            ['تم التوصيل', 'delivered'],
            ['تم دفع الأرباح', 'profit_paid'],
            ['مرتجع', 'returned'],
            ['ملغى', 'cancelled'],
          ].map(([label, key]) => (
            <div className="metric" key={key}>
              <span>{t(label)}</span>
              <strong>{data.metrics[key]}</strong>
            </div>
          ))}
        </div>
      )}
      <section
        className="panel"
        id="campaign-panel"
        role={full ? 'tabpanel' : undefined}
        aria-labelledby={full ? 'campaign-tab-' + tab : undefined}
      >
        <div className="campaign-filters">
          <label className="campaign-search">
            {t('البحث باسم الحملة')}
            <input
              type="search"
              value={search}
              placeholder={t('اكتب اسم الحملة')}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPages();
              }}
            />
          </label>
          <label>
            {t('المصدر')}
            <select
              aria-label={t('المصدر')}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                resetPages();
              }}
            >
              <option value="">{t('جميع المصادر')}</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
          </label>
          {tab === 'performance' && (
            <>
              <label>
                {t('من تاريخ')}
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    resetPages();
                  }}
                />
              </label>
              <label>
                {t('إلى تاريخ')}
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    resetPages();
                  }}
                />
              </label>
              <label>
                {t('ترتيب حسب')}
                <select
                  aria-label={t('ترتيب حسب')}
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as CampaignMetric);
                    setPerformancePage(1);
                  }}
                >
                  {(['visits', 'orders', 'revenue'] as const).map((metric) => (
                    <option key={metric} value={metric}>
                      {t(metricLabels[campaignMetrics.indexOf(metric)])}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => void action(load, '')}>
                {t('تحديث')}
              </button>
            </>
          )}
        </div>
        {tab === 'performance' ? (
          <>
            <h2>{t('أداء الحملات')}</h2>
            <div className="table-wrap">
              <table className="campaign-table">
                <thead>
                  <tr>
                    <th>{t('الحملة')}</th>
                    {metricLabels.map((label) => (
                      <th key={label}>{t(label)}</th>
                    ))}
                    <th>{t('التفاصيل')}</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.rows.map((group) => (
                    <React.Fragment key={group.id}>
                      <tr>
                        <td>
                          <strong dir="auto">{name(group)}</strong>
                          <span className="campaign-source muted">
                            {group.sources.map((s) => sourceLabel(s.source)).join(' · ')}
                          </span>
                        </td>
                        {campaignMetrics.map((metric) => (
                          <td key={metric}>
                            {metric === 'revenue' ? money(group[metric]) : group[metric]}
                          </td>
                        ))}
                        <td>
                          <button
                            type="button"
                            className="small-button"
                            aria-label={t('تفاصيل الحملة') + ': ' + name(group)}
                            aria-expanded={expanded === group.id}
                            onClick={() => setExpanded(expanded === group.id ? null : group.id)}
                          >
                            {t(expanded === group.id ? 'إخفاء' : 'التفاصيل')}
                          </button>
                        </td>
                      </tr>
                      {expanded === group.id && (
                        <tr className="campaign-breakdown">
                          <td colSpan={7}>
                            <div className="table-wrap">
                              <table aria-label={t('تفاصيل المصادر')}>
                                <thead>
                                  <tr>
                                    <th>{t('المصدر')}</th>
                                    {metricLabels.map((label) => (
                                      <th key={label}>{t(label)}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.sources.map((row) => (
                                    <tr key={row.source}>
                                      <td>{sourceLabel(row.source)}</td>
                                      {campaignMetrics.map((metric) => (
                                        <td key={metric}>
                                          {metric === 'revenue' ? money(row[metric]) : row[metric]}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {!groups.length && (
              <p className="empty-state">
                {t(
                  search || source
                    ? 'لا توجد نتائج تطابق البحث أو الفلاتر.'
                    : 'لا توجد بيانات في الفترة المحددة.',
                )}
              </p>
            )}
            <Pager
              data={performance}
              change={(page) => {
                setPerformancePage(page);
                setExpanded(null);
              }}
            />
            <p className="muted campaign-note">{t(data.note || '')}</p>
          </>
        ) : (
          <>
            <h2>{t('روابط الحملات المحفوظة')}</h2>
            <div className="table-wrap">
              <table className="campaign-table campaign-links-table">
                <thead>
                  <tr>
                    {['الحملة', 'المصدر', 'صفحة الوجهة', 'تاريخ الإنشاء', 'الإجراءات'].map(
                      (label) => (
                        <th key={label}>{t(label)}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {saved.rows.map((link) => (
                    <tr key={link.id}>
                      <td>
                        <strong dir="auto">{link.campaign || t('دون اسم حملة')}</strong>
                      </td>
                      <td>{sourceLabel(link.source)}</td>
                      <td>
                        <span dir="ltr" className="campaign-target" title={link.target}>
                          {link.target}
                        </span>
                      </td>
                      <td>{new Date(link.created_at).toLocaleDateString(adminLanguage())}</td>
                      <td>
                        <div className="campaign-row-actions">
                          <button
                            type="button"
                            className="small-button"
                            onClick={() => copy(link.url)}
                          >
                            {t(copiedUrl === link.url ? 'تم النسخ' : 'نسخ الرابط')}
                          </button>
                          <button
                            type="button"
                            className="small-button"
                            aria-label={
                              t('تفاصيل الرابط') + ': ' + (link.campaign || t('دون اسم حملة'))
                            }
                            onClick={() => {
                              setDetailMessage('');
                              setDetail(link);
                            }}
                          >
                            {t('التفاصيل')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!saved.count && (
              <p className="empty-state">
                {t(
                  search || source
                    ? 'لا توجد نتائج تطابق البحث أو الفلاتر.'
                    : 'لم تنشئ أي رابط بعد.',
                )}
              </p>
            )}
            <Pager data={saved} change={setLinksPage} />
          </>
        )}
      </section>
      {creating && (
        <Dialog
          title={t('إنشاء رابط')}
          close={() => {
            if (!saveLock.current) setCreating(false);
          }}
        >
          <form
            className="campaign-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (saveLock.current) return;
              saveLock.current = true;
              setSaving(true);
              setFormError('');
              void action(async () => {
                try {
                  const link: SavedCampaignLink = await api('/admin/campaign-links', {
                    target,
                    source: linkSource,
                    campaign,
                  });
                  setLinks((current) => [link, ...current.filter((row) => row.id !== link.id)]);
                  setCreating(false);
                  setDetailMessage('');
                  setDetail(link);
                  setTab('links');
                  setSearch('');
                  setSource('');
                  resetPages();
                } catch (error) {
                  setFormError((error as Error).message || t('تعذر إتمام العملية.'));
                } finally {
                  saveLock.current = false;
                  setSaving(false);
                }
              }, '');
            }}
          >
            <p className="muted">
              {t(
                'ضع هذا الرابط في إعلانك أو منشورك. الطلبات القادمة منه ستظهر بالمصدر الذي تختاره.',
              )}
            </p>
            <label>
              {t('رابط الصفحة التي ستعلن عنها')}
              <input
                autoFocus
                required
                dir="ltr"
                maxLength={2000}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            <label>
              {t('المصدر')}
              <select
                aria-label={t('المصدر')}
                value={linkSource}
                onChange={(e) => setLinkSource(e.target.value)}
              >
                {['facebook', 'instagram', 'tiktok', 'google', 'snapchat'].map((s) => (
                  <option key={s} value={s}>
                    {sourceLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('اسم الحملة (اختياري)')}
              <input
                dir="auto"
                maxLength={150}
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
              />
            </label>
            <p role="alert">{formError}</p>
            <div className="dialog-actions">
              <button type="submit" className="primary" disabled={saving}>
                {t(saving ? 'جارٍ الحفظ…' : 'إنشاء الرابط')}
              </button>
              <button type="button" disabled={saving} onClick={() => setCreating(false)}>
                {t('إلغاء')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {detail && (
        <Dialog title={t('تفاصيل الرابط')} close={() => setDetail(null)}>
          <div className="campaign-form">
            <strong dir="auto">{detail.campaign || t('دون اسم حملة')}</strong>
            <span>{sourceLabel(detail.source)}</span>
            <label>
              {t('صفحة الوجهة')}
              <input dir="ltr" readOnly value={detail.target} />
            </label>
            <label>
              {t('رابط الحملة المحفوظ')}
              <input dir="ltr" readOnly value={detail.url} onFocus={(e) => e.target.select()} />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void action(async () => {
                    try {
                      await navigator.clipboard.writeText(detail.url);
                      setDetailMessage(t('تم نسخ الرابط.'));
                    } catch (error) {
                      setDetailMessage((error as Error).message);
                    }
                  }, '')
                }
              >
                {t('نسخ الرابط')}
              </button>
              <button
                type="button"
                onClick={() =>
                  void action(async () => {
                    try {
                      await api('/admin/campaign-links/' + detail.id, undefined, 'DELETE');
                      setLinks((current) => current.filter((link) => link.id !== detail.id));
                      setDetail(null);
                    } catch (error) {
                      setDetailMessage((error as Error).message);
                    }
                  }, '')
                }
              >
                {t('حذف الرابط')}
              </button>
            </div>
            <p role="status">{detailMessage}</p>
            <p className="muted">
              {t('حذف الرابط من القائمة لا يحذف إحصاءاته ولا يوقف الرابط المنشور في إعلانك.')}
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
