'use client';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  FileCheck2,
  FileText,
  Leaf,
  Link2,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import type {
  Actor,
  ApplicationReviewItem,
  EvidenceInfo,
  EvidenceKind,
  Locale,
  PartnerDraft,
  PartnerInvitation,
  PartnerSnapshot,
} from '@hogulink/contracts';
import { api, ClientError } from '@/lib/api';
import { areaName, dateTime, languageNames } from '@/lib/i18n';
import { onboardingError, ot, type OnboardingText } from '@/lib/onboarding-i18n';
import { useSession } from './booking-form';
import { MobileSheet } from './mobile-ui';

const languages: Locale[] = ['ja', 'en', 'zh-cn'];
const areas = ['shinjuku', 'shibuya', 'minato', 'chuo', 'taito'];
const serviceLanguages = ['ja', 'en', 'zh'];
const dateInput = (at: number) => new Date(at + 9 * 3600000).toISOString().slice(0, 10);
const endOfDate = (v: string) => new Date(`${v}T23:59:59+09:00`).getTime();
const currentConsent = (c: PartnerSnapshot['consent']) =>
  c?.status === 'GRANTED' && c.endsAt > Date.now();
function Status({ locale: l, value }: { locale: Locale; value: string }) {
  return (
    <span className={`partner-status ${value.toLowerCase()}`}>
      {ot(l, value as OnboardingText)}
    </span>
  );
}
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`partner-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ 'aria-label'?: string }>, { 'aria-label': label })
        : children}
    </label>
  );
}
function PrivatePortrait({ id, alt = '' }: { id?: string; alt?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true,
      object = '';
    setUrl('');
    if (id)
      api<EvidenceInfo & { data: string }>(`onboarding/evidence/${id}`)
        .then((e) => {
          if (!live) return;
          const bytes = Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0));
          object = URL.createObjectURL(new Blob([bytes], { type: e.mime }));
          setUrl(object);
        })
        .catch(() => {});
    return () => {
      live = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [id]);
  return (
    <img
      className="partner-portrait"
      src={url || '/portraits/placeholder.svg'}
      alt={alt}
      width={160}
      height={190}
    />
  );
}
async function downloadEvidence(e: EvidenceInfo) {
  const file = await api<EvidenceInfo & { data: string }>(`onboarding/evidence/${e.id}`);
  const url = URL.createObjectURL(
    new Blob([Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))], { type: file.mime }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = e.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PartnerEntry({ locale: l, role }: { locale: Locale; role: 'MERCHANT' | 'STAFF' }) {
  return (
    <Link className="partner-entry" href={`/${l}/onboarding?role=${role}`}>
      <span className="partner-entry-icon">
        <ShieldCheck size={20} />
      </span>
      <span>
        <strong>{ot(l, 'portal')}</strong>
        <small>{ot(l, role === 'MERCHANT' ? 'team' : 'authorization')}</small>
      </span>
      <ArrowUpRight size={17} />
    </Link>
  );
}
function Terms({ locale: l }: { locale: Locale }) {
  const paragraphs =
    l === 'zh-cn'
      ? [
          '实际服务及价格由店铺提供并负责。平台提供展示、预约、审核及交易协助，技师须在已授权店铺范围内履约。',
          '入驻演示不收费用。实际计费应以双方确认的方案、平台服务费版本和订单报价为准；不向技师开设收款钱包。取消、退款及售后依顾客确认的订单条款办理。',
          '仅提交核验所需的必要资料。身份证明及资质证据仅供本人及获授权审核人员核验；店铺只获得拟公开资料与审核状态。平台记录资料版本、操作时间和审核证据。',
          '承诺所填资料真实、持续有效，无反社会势力关联，不开展禁止或未经适用资格核验的服务。资质变化须及时申报；平台可暂停不符合条件的展示与新预约，已有订单仍需妥善处理。',
          '肖像授权须由照片本人另行确认，明确用途及期限，可随时撤回。修改照片、姓名或介绍后，须重新授权和审核；不得用于未经另行同意的广告。',
          '当前为本地演示条款和流程记录。真实经营需完成正式合同、身份核验、适用资质与 PSP 审查的接入。',
        ]
      : l === 'ja'
        ? [
            'サービスの提供・価格・履行責任は店舗に帰属します。プラットフォームは掲載、予約、審査、取引支援を行い、スタッフは承認された所属範囲で業務を行います。',
            'デモ登録に料金は発生しません。実際の料金は合意したプラン・手数料規則・注文見積に従います。スタッフ用の決済ウォレットは提供しません。取消・返金は顧客が確認した注文規則に従います。',
            '必要最小限の資料を提出してください。本人・資格の証拠は本人と権限を持つ審査担当者のみが確認し、店舗には公開予定情報と審査状態を共有します。資料の版と操作・審査記録を保存します。',
            '資料の真正性・有効性、反社会的勢力との無関係を表明し、禁止サービスや未確認の規制対象サービスを提供しないでください。変更は申告が必要です。新規公開・予約が停止しても既存予約への対応は必要です。',
            '肖像同意は本人が別途行い、用途・期限を確認し、いつでも撤回できます。写真・氏名・紹介の変更後は再同意・再審査が必要です。別途の広告利用は含みません。',
            '現在はローカルデモの条項・手続き記録です。実運用には正式契約、本人確認、適用資格およびPSP審査の接続が必要です。',
          ]
        : [
            'The shop provides the service, sets its prices and remains responsible for delivery. The platform supports listings, reservations, review and transactions. Staff work within an authorized shop relationship.',
            'Demo registration is free. Actual charges must follow the agreed plan, versioned platform fees and booking quote. There is no staff payment wallet. Cancellations and refunds follow the terms confirmed for the booking.',
            'Submit only the evidence needed for review. Identity and qualification documents are available only to you and authorized reviewers. The shop receives the proposed public profile and review status. Document versions, actions and review records are retained.',
            'Declare that your details are accurate and current, that you have no antisocial affiliations and that you will not offer prohibited or unverified regulated services. Report changes promptly. Existing reservations must be handled even when new exposure or bookings are suspended.',
            'Portrait authorization is a separate personal choice with a stated purpose and end date. It can be withdrawn at any time. Changes to the photograph, name or introduction require authorization and review again. Separate advertising reuse is excluded.',
            'These are local demo terms and workflow records. Live operations require formal contracts, identity verification, applicable qualification checks and PSP review integrations.',
          ];
  return (
    <details className="partner-terms">
      <summary>{ot(l, 'termsLink')} · partner-2026-10-v1</summary>
      {paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </details>
  );
}

export function PartnerPortal({ locale: l }: { locale: Locale }) {
  const { actor, setActor, loading } = useSession();
  const [role, setRole] = useState<'MERCHANT' | 'STAFF'>('MERCHANT'),
    [register, setRegister] = useState(false),
    [credentials, setCredentials] = useState({ email: '', password: '', name: '' });
  const [data, setData] = useState<PartnerSnapshot>(),
    [draft, setDraft] = useState<PartnerDraft>(),
    [step, setStep] = useState('profile'),
    [busy, setBusy] = useState(false),
    [fetching, setFetching] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [token, setToken] = useState(''),
    [invitation, setInvitation] = useState<{
      shopName: Record<Locale, string>;
      name: string;
      emailHint: string;
      expiresAt: number;
    }>(),
    [binding, setBinding] = useState(false),
    [invitationError, setInvitationError] = useState('');
  const [consentAck, setConsentAck] = useState(false),
    [consentEnd, setConsentEnd] = useState(dateInput(Date.now() + 180 * 86400000));
  const generation = useRef(0);
  const partner = actor?.role === 'MERCHANT' || actor?.role === 'STAFF';
  useEffect(() => {
    const readLink = () => {
      const q = new URLSearchParams(location.search);
      if (q.get('role') === 'STAFF') setRole('STAFF');
      const fragment = new URLSearchParams(location.hash.slice(1)),
        value = fragment.get('invite');
      if (value) {
        setToken(value);
        setRole('STAFF');
        history.replaceState(null, '', location.pathname + location.search);
      }
    };
    readLink();
    window.addEventListener('hashchange', readLink);
    return () => window.removeEventListener('hashchange', readLink);
  }, []);
  useEffect(() => {
    if (!token) return;
    setInvitationError('');
    api<typeof invitation>('auth/partner/invitation', { token })
      .then(setInvitation)
      .catch((e) =>
        setInvitationError(onboardingError(l, e instanceof ClientError ? e.code : undefined)),
      );
  }, [token, l]);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!partner) {
      setData(undefined);
      setDraft(undefined);
      return;
    }
    setFetching(true);
    try {
      const d = await api<PartnerSnapshot>('onboarding/workspace');
      if (request === generation.current) {
        setData(d);
        setDraft(d.application?.draft);
      }
    } catch (e) {
      if (request === generation.current)
        setError(onboardingError(l, e instanceof ClientError ? e.code : undefined));
    } finally {
      if (request === generation.current) setFetching(false);
    }
  }, [partner, actor?.id, actor?.storeId, l]);
  useEffect(() => {
    setData(undefined);
    setDraft(undefined);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  async function action(fn: () => Promise<unknown>, message?: OnboardingText, reload = true) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (reload) await refresh();
      if (message) setNotice(ot(l, message));
      return true;
    } catch (e) {
      setError(onboardingError(l, e instanceof ClientError ? e.code : undefined));
      if (e instanceof ClientError && e.code === 'VERSION_CONFLICT') await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }
  const a = data?.application,
    locked =
      a?.status === 'SUBMITTED' ||
      (a?.type === 'STAFF' && !data?.members.some((m) => m.listing.membershipActive)),
    dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(a?.draft);
  const update = <K extends keyof PartnerDraft>(key: K, value: PartnerDraft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const steps =
    actor?.role === 'STAFF'
      ? data?.legacy
        ? ['profile', 'authorization']
        : ['profile', 'evidence', 'authorization']
      : data?.legacy
        ? ['profile', 'team']
        : ['profile', 'evidence', 'team'];
  const savedEvidence = data?.evidence.filter((e) => a?.draft.evidenceIds.includes(e.id)) ?? [];
  const profileReady =
    !!a &&
    a.draft.legalName.length >= 2 &&
    a.draft.contact.length >= 5 &&
    a.draft.serviceScope.length >= 10 &&
    Object.values(a.draft.description).every((v) => v.length >= 5) &&
    (a.type === 'MERCHANT'
      ? a.draft.legalAddress.length >= 5 && a.draft.emergencyContact.length >= 5
      : a.draft.offeringIds.length > 0);
  const documentsReady =
    savedEvidence.some((e) => e.kind === 'IDENTITY') &&
    (a?.type !== 'MERCHANT' || savedEvidence.some((e) => e.kind === 'BUSINESS')) &&
    (a?.draft.category !== 'LICENSED' || savedEvidence.some((e) => e.kind === 'QUALIFICATION'));
  const ready =
    !!a &&
    !dirty &&
    a.status === 'DRAFT' &&
    profileReady &&
    a.draft.termsAccepted &&
    (a.type !== 'MERCHANT' || a.draft.antisocialDeclaration) &&
    savedEvidence.some((e) => e.kind === 'IDENTITY') &&
    (a.type !== 'MERCHANT' || savedEvidence.some((e) => e.kind === 'BUSINESS')) &&
    (a.draft.category !== 'LICENSED' || savedEvidence.some((e) => e.kind === 'QUALIFICATION')) &&
    (a.type !== 'STAFF' || currentConsent(data?.consent));
  return (
    <div className="partner-page">
      <header className="partner-hero">
        <div>
          <span className="eyebrow">HOGULINK / PARTNER CARE</span>
          <h1>{ot(l, 'title')}</h1>
          <p>{ot(l, 'intro')}</p>
          <div className="partner-hero-tags">
            <span>
              <Leaf size={14} />
              {ot(l, 'noFees')}
            </span>
            <span>
              <ShieldCheck size={14} />
              {ot(l, 'privacy')}
            </span>
          </div>
        </div>
        <div className="partner-hero-mark">
          <Leaf size={84} strokeWidth={0.7} />
          <span>GROW WITH CARE</span>
        </div>
      </header>
      <div className="partner-topline">
        <span>
          <ShieldCheck size={17} />
          {ot(l, 'portal')}
        </span>
        <div>
          {partner && (
            <>
              {(actor.role === 'MERCHANT' ||
                data?.members.some((m) => m.listing.membershipActive)) && (
                <Link href={`/${l}/${actor.role.toLowerCase()}`} className="partner-text-link">
                  {ot(l, 'back')}
                  <ArrowUpRight size={14} />
                </Link>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void action(
                    async () => {
                      await api('auth/logout', {});
                      setActor(null);
                      setData(undefined);
                    },
                    undefined,
                    false,
                  )
                }
              >
                {ot(l, 'logout')}
              </button>
            </>
          )}
          <button
            disabled={busy || fetching || !partner}
            onClick={() => {
              setError('');
              void refresh();
            }}
            aria-label={ot(l, 'refresh')}
          >
            <RefreshCw size={17} className={fetching ? 'spin' : ''} />
          </button>
        </div>
      </div>
      {error && (
        <div className="partner-message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="partner-message" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {invitationError && (
        <div className="partner-message error" role="alert">
          {invitationError}
        </div>
      )}
      {invitation && token && (
        <section className="partner-invitation">
          <div className="partner-invite-symbol">
            <Link2 size={24} />
          </div>
          <div>
            <span className="eyebrow small">{ot(l, 'invitation')}</span>
            <h2>{invitation.shopName[l]}</h2>
            <p>
              {invitation.name} · {invitation.emailHint} · {dateTime(l, invitation.expiresAt)}
            </p>
          </div>
          {actor?.role === 'STAFF' ? (
            <div className="partner-invite-response">
              <label className="partner-check">
                <input
                  type="checkbox"
                  checked={binding}
                  onChange={(e) => setBinding(e.target.checked)}
                />
                <span>{ot(l, 'bindingAck')}</span>
              </label>
              <div className="partner-actions">
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await api('onboarding/invitation-response', {
                        token,
                        action: 'DECLINE',
                        bindingAccepted: false,
                      });
                      setToken('');
                      setInvitation(undefined);
                    })
                  }
                >
                  {ot(l, 'decline')}
                </button>
                <button
                  className="button small"
                  disabled={busy || !binding}
                  onClick={() =>
                    void action(async () => {
                      await api('onboarding/invitation-response', {
                        token,
                        action: 'ACCEPT',
                        bindingAccepted: binding,
                      });
                      setToken('');
                      setInvitation(undefined);
                      setActor(await api<Actor>('auth/session'));
                    }, 'saved')
                  }
                >
                  {ot(l, 'accept')}
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          ) : (
            <p>{ot(l, 'accountHelp')}</p>
          )}
        </section>
      )}
      {loading ? (
        <div className="partner-panel partner-loading">
          <LoaderCircle className="spin" />
          {ot(l, 'working')}
        </div>
      ) : !partner ? (
        <section className="partner-auth">
          <div className="partner-auth-story">
            <span className="eyebrow small">A PLACE FOR YOUR PRACTICE</span>
            <h2>{ot(l, 'portal')}</h2>
            <p>{ot(l, 'accountHelp')}</p>
            <ol>
              {['identityStep', 'consentStep', 'platformReview'].map((v, i) => (
                <li key={v}>
                  <span>0{i + 1}</span>
                  {ot(l, v as OnboardingText)}
                </li>
              ))}
            </ol>
          </div>
          <form
            className="partner-auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                async () => {
                  const next = await api<Actor>(`auth/partner/${register ? 'register' : 'login'}`, {
                    role,
                    ...credentials,
                    ...(!register ? { name: undefined } : {}),
                  });
                  setActor(next);
                  setCredentials({ email: '', password: '', name: '' });
                },
                undefined,
                false,
              );
            }}
          >
            <div className="partner-segment">
              {(['MERCHANT', 'STAFF'] as const).map((v) => (
                <button type="button" key={v} aria-pressed={role === v} onClick={() => setRole(v)}>
                  {ot(l, v === 'MERCHANT' ? 'merchant' : 'staff')}
                </button>
              ))}
            </div>
            <h2>{ot(l, register ? 'register' : 'login')}</h2>
            {register && (
              <Field label={ot(l, 'name')}>
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={credentials.name}
                  autoComplete="name"
                  onChange={(e) => setCredentials({ ...credentials, name: e.target.value })}
                />
              </Field>
            )}
            <Field label={ot(l, 'email')}>
              <input
                required
                type="email"
                autoComplete="email"
                value={credentials.email}
                onChange={(e) => setCredentials({ ...credentials, email: e.target.value })}
              />
            </Field>
            <Field label={ot(l, 'password')}>
              <input
                required
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete={register ? 'new-password' : 'current-password'}
                value={credentials.password}
                onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
              />
            </Field>
            <button className="button full" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                ot(l, register ? 'register' : 'login')
              )}
              <ArrowRight size={16} />
            </button>
            <button
              type="button"
              className="partner-auth-switch"
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {ot(l, register ? 'login' : 'register')}
            </button>
          </form>
        </section>
      ) : (
        <div className="partner-layout">
          <aside className="partner-sidebar">
            <div className="partner-sidebar-user">
              <span>
                <UserRound size={23} />
              </span>
              <div>
                <strong>
                  {actor.displayName ||
                    data?.storeName?.[l] ||
                    ot(l, actor.role === 'MERCHANT' ? 'merchant' : 'staff')}
                </strong>
                <small>{ot(l, actor.role === 'MERCHANT' ? 'merchant' : 'staff')}</small>
              </div>
            </div>
            <nav aria-label={ot(l, 'portal')}>
              {steps.map((s, i) => (
                <button
                  key={s}
                  aria-current={step === s ? 'step' : undefined}
                  onClick={() => {
                    setStep(s);
                    setNotice('');
                  }}
                >
                  <span>0{i + 1}</span>
                  {ot(l, s as OnboardingText)}
                  <ArrowRight size={15} />
                </button>
              ))}
            </nav>
            <div className="partner-sidebar-note">
              <ShieldCheck size={24} />
              <p>{ot(l, 'demo')}</p>
            </div>
          </aside>
          <div className="partner-main">
            {a && (
              <section className="partner-progress">
                <div>
                  <span className="eyebrow small">
                    {a.type === 'MERCHANT' ? 'SHOP APPLICATION' : 'PERSONAL CREDENTIALS'} /{' '}
                    {ot(l, 'version')} {a.revision}
                  </span>
                  <h2>{a.draft.displayName[l]}</h2>
                  <p>{a.feedback || ot(l, a.type === 'STAFF' ? 'contentHelp' : 'noFees')}</p>
                </div>
                <div className="partner-progress-side">
                  <Status locale={l} value={a.status} />
                  {a.validUntil && (
                    <small>
                      {ot(l, 'endsAt')} {dateTime(l, a.validUntil)}
                    </small>
                  )}
                  {a.status === 'DRAFT' && (
                    <button
                      className="button small"
                      disabled={busy || !ready}
                      onClick={() =>
                        void action(
                          () => api('onboarding/application/submit', { version: a.version }),
                          'submitted',
                        )
                      }
                    >
                      {ot(l, 'submit')}
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
              </section>
            )}
            {a && (
              <div className="partner-readiness" aria-label={ot(l, 'notReady')}>
                {(
                  [
                    ['profile', profileReady],
                    ['evidence', documentsReady],
                    ...(a.type === 'STAFF'
                      ? [
                          ['authorization', currentConsent(data?.consent)],
                          ['merchantReview', a.merchantContentHash === a.contentHash],
                        ]
                      : [
                          [
                            'team',
                            data?.members.some(
                              (m) =>
                                m.listing.membershipActive &&
                                m.listing.identityVerified &&
                                m.listing.portraitConsent &&
                                m.listing.publicationStatus === 'PUBLISHED_INDEXABLE',
                            ),
                          ],
                        ]),
                    ['platformReview', a.status === 'APPROVED'],
                  ] as [OnboardingText, boolean | undefined][]
                ).map(([key, ok]) => (
                  <span key={key} className={ok ? 'complete' : ''}>
                    {ok ? <CheckCircle2 size={15} /> : <span className="partner-check-dot" />}
                    {ot(l, key)}
                  </span>
                ))}
              </div>
            )}
            {fetching && !data ? (
              <div className="partner-panel partner-loading">
                <LoaderCircle className="spin" />
              </div>
            ) : (
              <>
                {data?.legacy && <div className="partner-message">{ot(l, 'legacy')}</div>}
                {!a && !data?.legacy && (
                  <section className="partner-panel partner-empty">
                    <Mail size={32} />
                    <h2>{ot(l, 'noInvitation')}</h2>
                  </section>
                )}
                {step === 'profile' && draft && a && (
                  <form
                    className="partner-panel partner-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(
                        () => api('onboarding/application', { version: a.version, draft }, 'PUT'),
                        'saved',
                      );
                      setConsentAck(false);
                    }}
                  >
                    <div className="partner-section-heading">
                      <span>01 / DETAILS</span>
                      <h2>{ot(l, 'profile')}</h2>
                      <p>{ot(l, 'privacy')}</p>
                    </div>
                    <fieldset disabled={busy || locked}>
                      <div className="partner-form-grid">
                        <Field label={ot(l, 'legalName')}>
                          <input
                            maxLength={120}
                            value={draft.legalName}
                            onChange={(e) => update('legalName', e.target.value)}
                          />
                        </Field>
                        <Field label={ot(l, 'contact')}>
                          <input
                            maxLength={150}
                            value={draft.contact}
                            onChange={(e) => update('contact', e.target.value)}
                          />
                        </Field>
                        {a.type === 'MERCHANT' && (
                          <>
                            <Field label={ot(l, 'businessType')}>
                              <select
                                value={draft.businessType}
                                onChange={(e) =>
                                  update(
                                    'businessType',
                                    e.target.value as PartnerDraft['businessType'],
                                  )
                                }
                              >
                                <option value="SOLE_PROPRIETOR">{ot(l, 'sole')}</option>
                                <option value="COMPANY">{ot(l, 'company')}</option>
                              </select>
                            </Field>
                            <Field label={ot(l, 'emergency')}>
                              <input
                                maxLength={150}
                                value={draft.emergencyContact}
                                onChange={(e) => update('emergencyContact', e.target.value)}
                              />
                            </Field>
                            <Field label={ot(l, 'address')} wide>
                              <input
                                maxLength={300}
                                value={draft.legalAddress}
                                onChange={(e) => update('legalAddress', e.target.value)}
                              />
                            </Field>
                          </>
                        )}
                        <Field label={ot(l, 'category')}>
                          <select
                            value={draft.category}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                category: e.target.value as PartnerDraft['category'],
                                offeringIds: a.type === 'STAFF' ? [] : draft.offeringIds,
                              })
                            }
                          >
                            <option value="RELAXATION">{ot(l, 'relaxation')}</option>
                            <option value="LICENSED">{ot(l, 'licensed')}</option>
                          </select>
                        </Field>
                        <Field label={ot(l, 'scope')} wide>
                          <textarea
                            maxLength={1000}
                            rows={3}
                            value={draft.serviceScope}
                            onChange={(e) => update('serviceScope', e.target.value)}
                            placeholder={ot(l, 'scopeHelp')}
                          />
                        </Field>
                      </div>
                      {draft.category === 'LICENSED' && (
                        <p className="partner-message warning">{ot(l, 'regulatedHelp')}</p>
                      )}
                      <div className="partner-multilingual">
                        {languages.map((lang) => (
                          <div key={lang}>
                            <span className="partner-language-label">{languageNames[lang]}</span>
                            <Field label={ot(l, 'displayName')}>
                              <input
                                maxLength={80}
                                value={draft.displayName[lang]}
                                onChange={(e) =>
                                  update('displayName', {
                                    ...draft.displayName,
                                    [lang]: e.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label={ot(l, 'description')}>
                              <textarea
                                rows={3}
                                maxLength={800}
                                value={draft.description[lang]}
                                onChange={(e) =>
                                  update('description', {
                                    ...draft.description,
                                    [lang]: e.target.value,
                                  })
                                }
                              />
                            </Field>
                          </div>
                        ))}
                      </div>
                      <div className="partner-choice-section">
                        <h3>{ot(l, 'areas')}</h3>
                        <div className="partner-choices">
                          {areas.map((v) => (
                            <label key={v}>
                              <input
                                type="checkbox"
                                checked={draft.areas.includes(v)}
                                onChange={(e) =>
                                  update(
                                    'areas',
                                    e.target.checked
                                      ? [...draft.areas, v]
                                      : draft.areas.filter((x) => x !== v),
                                  )
                                }
                              />
                              {areaName(l, v)}
                            </label>
                          ))}
                        </div>
                        <h3>{ot(l, 'languages')}</h3>
                        <div className="partner-choices">
                          {serviceLanguages.map((v) => (
                            <label key={v}>
                              <input
                                type="checkbox"
                                checked={draft.languages.includes(v)}
                                onChange={(e) =>
                                  update(
                                    'languages',
                                    e.target.checked
                                      ? [...draft.languages, v]
                                      : draft.languages.filter((x) => x !== v),
                                  )
                                }
                              />
                              {languageNames[v]}
                            </label>
                          ))}
                        </div>
                      </div>
                      {a.type === 'MERCHANT' ? (
                        <div className="partner-service-fields">
                          <h3>{ot(l, 'serviceName')}</h3>
                          <div className="partner-form-grid">
                            {languages.map((lang) => (
                              <Field key={lang} label={languageNames[lang]}>
                                <input
                                  maxLength={80}
                                  value={draft.serviceName[lang]}
                                  onChange={(e) =>
                                    update('serviceName', {
                                      ...draft.serviceName,
                                      [lang]: e.target.value,
                                    })
                                  }
                                />
                              </Field>
                            ))}
                            <Field label={ot(l, 'duration')}>
                              <input
                                type="number"
                                min={30}
                                max={180}
                                step={15}
                                value={draft.durationMinutes}
                                onChange={(e) => update('durationMinutes', Number(e.target.value))}
                              />
                            </Field>
                            <Field label={ot(l, 'price')}>
                              <input
                                type="number"
                                min={1000}
                                max={100000}
                                value={draft.price}
                                onChange={(e) => update('price', Number(e.target.value))}
                              />
                            </Field>
                            <Field label={ot(l, 'transport')}>
                              <input
                                type="number"
                                min={0}
                                max={30000}
                                value={draft.transportFee}
                                onChange={(e) => update('transportFee', Number(e.target.value))}
                              />
                            </Field>
                          </div>
                        </div>
                      ) : (
                        <div className="partner-choice-section">
                          <h3>{ot(l, 'services')}</h3>
                          {data?.offerings.length ? (
                            <div className="partner-choices">
                              {data.offerings
                                .filter(
                                  (o) =>
                                    (o.regulatoryCategory === draft.category &&
                                      o.active !== false &&
                                      o.approved) ||
                                    draft.offeringIds.includes(o.id),
                                )
                                .map((o) => (
                                  <label key={o.id}>
                                    <input
                                      type="checkbox"
                                      checked={draft.offeringIds.includes(o.id)}
                                      onChange={(e) =>
                                        update(
                                          'offeringIds',
                                          e.target.checked
                                            ? [...draft.offeringIds, o.id]
                                            : draft.offeringIds.filter((x) => x !== o.id),
                                        )
                                      }
                                    />
                                    {o.name[l]} · {o.durationMinutes} min
                                    {o.active === false
                                      ? ` · ${ot(l, 'SUSPENDED')}`
                                      : !o.approved
                                        ? ` · ${ot(l, 'SUBMITTED')}`
                                        : ''}
                                  </label>
                                ))}
                            </div>
                          ) : (
                            <p>{ot(l, 'noServices')}</p>
                          )}
                        </div>
                      )}
                      <Terms locale={l} />
                      <label className="partner-check">
                        <input
                          type="checkbox"
                          checked={draft.termsAccepted}
                          onChange={(e) => update('termsAccepted', e.target.checked)}
                        />
                        <span>{ot(l, 'terms')}</span>
                      </label>
                      {a.type === 'MERCHANT' && (
                        <label className="partner-check">
                          <input
                            type="checkbox"
                            checked={draft.antisocialDeclaration}
                            onChange={(e) => update('antisocialDeclaration', e.target.checked)}
                          />
                          <span>{ot(l, 'antisocial')}</span>
                        </label>
                      )}
                    </fieldset>
                    <div className="partner-savebar">
                      <span>{dirty ? ot(l, 'dirty') : ot(l, 'privacy')}</span>
                      <button className="button" disabled={busy || locked}>
                        {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{' '}
                        {ot(l, a.status === 'APPROVED' ? 'saveAgain' : 'save')}
                      </button>
                    </div>
                  </form>
                )}
                {step === 'profile' && data?.legacy && (
                  <div className="partner-panel">
                    <h2>{ot(l, 'ready')}</h2>
                    <p>{ot(l, 'legacy')}</p>
                    <button
                      className="button secondary"
                      onClick={() => setStep(actor.role === 'STAFF' ? 'authorization' : 'team')}
                    >
                      {ot(l, actor.role === 'STAFF' ? 'authorization' : 'team')}
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}
                {step === 'evidence' && draft && a && (
                  <section className="partner-panel">
                    <div className="partner-section-heading">
                      <span>02 / PRIVATE REVIEW</span>
                      <h2>{ot(l, 'evidence')}</h2>
                      <p>{ot(l, 'documentHelp')}</p>
                    </div>
                    <EvidenceUploader
                      locale={l}
                      evidence={data?.evidence ?? []}
                      draft={draft}
                      disabled={busy || locked}
                      onDraft={setDraft}
                      onUploaded={(e) =>
                        setData((d) =>
                          d
                            ? { ...d, evidence: [...d.evidence.filter((x) => x.id !== e.id), e] }
                            : d,
                        )
                      }
                      onError={setError}
                      onNotice={setNotice}
                      onBusy={setBusy}
                    />
                    <div className="partner-savebar">
                      <span>{dirty ? ot(l, 'dirty') : ot(l, 'privacy')}</span>
                      <button
                        className="button"
                        disabled={busy || locked}
                        onClick={() =>
                          void action(
                            () =>
                              api('onboarding/application', { version: a.version, draft }, 'PUT'),
                            'saved',
                          )
                        }
                      >
                        {ot(l, 'save')}
                        <Check size={16} />
                      </button>
                    </div>
                  </section>
                )}
                {step === 'authorization' && data && (
                  <section className="partner-panel">
                    <div className="partner-section-heading">
                      <span>03 / YOUR IMAGE, YOUR CHOICE</span>
                      <h2>{ot(l, 'authorization')}</h2>
                      <p>{ot(l, 'consentHelp')}</p>
                    </div>
                    <div className="partner-consent-preview">
                      <PrivatePortrait id={a?.draft.portraitId} />
                      <div>
                        <span
                          className={`partner-status ${currentConsent(data.consent) ? 'approved' : 'pending'}`}
                        >
                          {ot(
                            l,
                            currentConsent(data.consent)
                              ? 'granted'
                              : data.consent?.status === 'REVOKED'
                                ? 'REVOKED'
                                : data.consent?.status === 'EXPIRED'
                                  ? 'EXPIRED'
                                  : 'notGranted',
                          )}
                        </span>
                        <h3>{a?.draft.displayName[l] || data.members[0]?.listing.name[l]}</h3>
                        <p>{a?.draft.description[l] || data.members[0]?.listing.description[l]}</p>
                        <small>
                          {data.consentTermsVersion}
                          {data.consent ? ` · v${data.consent.version}` : ''}
                        </small>
                        {data.consent && (
                          <p>
                            {dateTime(l, data.consent.startsAt)} —{' '}
                            {dateTime(l, data.consent.endsAt)}
                          </p>
                        )}
                      </div>
                    </div>
                    {dirty && <p className="partner-message warning">{ot(l, 'dirty')}</p>}
                    <Field label={ot(l, 'endsAt')}>
                      <input
                        type="date"
                        min={dateInput(Date.now())}
                        max={dateInput(Date.now() + 365 * 86400000)}
                        value={consentEnd}
                        onChange={(e) => setConsentEnd(e.target.value)}
                      />
                    </Field>
                    <label className="partner-check">
                      <input
                        type="checkbox"
                        checked={consentAck}
                        onChange={(e) => setConsentAck(e.target.checked)}
                        disabled={busy || dirty}
                      />
                      <span>{ot(l, 'consentAck')}</span>
                    </label>
                    <div className="partner-actions">
                      <button
                        className="button"
                        disabled={
                          busy ||
                          dirty ||
                          !consentAck ||
                          !consentEnd ||
                          (!a?.draft.portraitId && !data.legacy) ||
                          !data.members.some((m) => m.listing.membershipActive)
                        }
                        onClick={() =>
                          void action(
                            () =>
                              api('onboarding/portrait-consent', {
                                version: data.consent?.version ?? 0,
                                action: 'GRANT',
                                termsVersion: data.consentTermsVersion,
                                startsAt: Date.now(),
                                endsAt: endOfDate(consentEnd),
                                acknowledged: consentAck,
                              }),
                            'saved',
                          )
                        }
                      >
                        {ot(l, 'grant')}
                        <ShieldCheck size={16} />
                      </button>
                      <button
                        className="button secondary"
                        disabled={
                          busy ||
                          (!currentConsent(data.consent) &&
                            !data.members[0]?.listing.portraitConsent)
                        }
                        onClick={() =>
                          void action(
                            () =>
                              api('onboarding/portrait-consent', {
                                version: data.consent?.version ?? 0,
                                action: 'REVOKE',
                                termsVersion: data.consentTermsVersion,
                                startsAt: Date.now(),
                                endsAt: Date.now(),
                                acknowledged: false,
                              }),
                            'saved',
                          )
                        }
                      >
                        {ot(l, 'revoke')}
                      </button>
                    </div>
                    <p className="partner-footnote">{ot(l, 'withdrawHelp')}</p>
                  </section>
                )}
                {step === 'team' && data && actor.role === 'MERCHANT' && (
                  <PartnerTeam
                    locale={l}
                    data={data}
                    busy={busy}
                    action={action}
                    onError={setError}
                    onNotice={setNotice}
                    error={error}
                  />
                )}
                {a && data && (
                  <section className="partner-history">
                    <h3>{ot(l, 'history')}</h3>
                    {data.history.slice(0, 8).map((h) => (
                      <div key={h.id}>
                        <span className="partner-history-dot" />
                        <div>
                          <strong>{eventLabel(l, h.action)}</strong>
                          {h.feedback && <p>{h.feedback}</p>}
                          <small>
                            {ot(l, 'version')} {h.revision}
                          </small>
                        </div>
                        <time>{dateTime(l, h.at)}</time>
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <p className="partner-demo-note">
        <ShieldCheck size={16} />
        {ot(l, 'demo')}
      </p>
    </div>
  );
}

function eventLabel(l: Locale, action: string) {
  const keys: Record<string, OnboardingText> = {
    APPLICATION_CREATED: 'register',
    APPLICATION_SAVED: 'save',
    APPLICATION_SUBMITTED: 'submit',
    STAFF_MEMBERSHIP_ACCEPTED: 'accept',
    MERCHANT_CONTENT_APPROVED: 'contentApprove',
    MERCHANT_CONTENT_CHANGES_REQUIRED: 'changes',
    APPLICATION_APPROVE: 'APPROVED',
    APPLICATION_CHANGES_REQUIRED: 'CHANGES_REQUIRED',
    APPLICATION_REJECT: 'REJECTED',
    APPLICATION_SUSPEND: 'SUSPENDED',
    QUALIFICATION_EXPIRED: 'EXPIRED',
    MEMBERSHIP_ENDED: 'end',
  };
  return ot(l, keys[action] ?? 'history');
}

type Action = (
  fn: () => Promise<unknown>,
  message?: OnboardingText,
  reload?: boolean,
) => Promise<boolean>;
function EvidenceUploader({
  locale: l,
  evidence,
  draft,
  disabled,
  onDraft,
  onUploaded,
  onError,
  onNotice,
  onBusy,
}: {
  locale: Locale;
  evidence: EvidenceInfo[];
  draft: PartnerDraft;
  disabled: boolean;
  onDraft: (d: PartnerDraft) => void;
  onUploaded: (e: EvidenceInfo) => void;
  onError: (s: string) => void;
  onNotice: (s: string) => void;
  onBusy: (v: boolean) => void;
}) {
  const [kind, setKind] = useState<EvidenceKind>('IDENTITY');
  async function upload(file: File) {
    if (
      file.size > (file.type === 'application/pdf' ? 350000 : 10000000) ||
      !['image/png', 'image/jpeg', 'application/pdf'].includes(file.type) ||
      (kind === 'PORTRAIT' && file.type === 'application/pdf')
    ) {
      onError(ot(l, 'fileError'));
      return;
    }
    onBusy(true);
    onError('');
    try {
      if (file.size > 350000 && file.type.startsWith('image/')) {
        const bitmap = await createImageBitmap(file);
        try {
          const canvas = document.createElement('canvas');
          let edge = 1600,
            result: Blob | undefined;
          for (let round = 0; round < 4 && !result; round++, edge = Math.floor(edge * 0.75)) {
            const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Image processing unavailable');
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, 'image/jpeg', 0.82),
            );
            if (blob && blob.size <= 350000) result = blob;
          }
          if (!result) throw new Error('Image remains too large');
          file = new File([result], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
            type: 'image/jpeg',
          });
        } finally {
          bitmap.close();
        }
      }
      const encoded = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const e = await api<EvidenceInfo>('onboarding/evidence', {
        name: file.name,
        mime: file.type,
        kind,
        data: encoded,
      });
      onUploaded(e);
      onDraft({
        ...draft,
        ...(kind === 'PORTRAIT'
          ? { portraitId: e.id }
          : { evidenceIds: [...new Set([...draft.evidenceIds, e.id])] }),
      });
      onNotice(ot(l, 'uploaded'));
    } catch (e) {
      onError(onboardingError(l, e instanceof ClientError ? e.code : undefined));
    } finally {
      onBusy(false);
    }
  }
  return (
    <>
      <div className="partner-upload">
        <Upload size={28} />
        <div>
          <strong>{ot(l, 'upload')}</strong>
          <p>{ot(l, 'documentHelp')}</p>
        </div>
        <select
          aria-label={ot(l, 'evidence')}
          value={kind}
          disabled={disabled}
          onChange={(e) => setKind(e.target.value as EvidenceKind)}
        >
          {(['IDENTITY', 'BUSINESS', 'QUALIFICATION', 'PORTRAIT'] as const).map((v) => (
            <option key={v} value={v}>
              {ot(l, v)}
            </option>
          ))}
        </select>
        <input
          aria-label={ot(l, 'upload')}
          type="file"
          accept={kind === 'PORTRAIT' ? '.png,.jpg,.jpeg' : '.png,.jpg,.jpeg,.pdf'}
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
      </div>
      <div className="partner-document-list">
        {evidence.map((e) => {
          const attached =
            e.kind === 'PORTRAIT' ? draft.portraitId === e.id : draft.evidenceIds.includes(e.id);
          return (
            <article key={e.id}>
              <FileText size={21} />
              <div>
                <strong>{e.name}</strong>
                <small>
                  {ot(l, e.kind)} · {Math.ceil(e.size / 1000)} KB{' '}
                  {attached && `· ${ot(l, 'attached')}`}
                </small>
              </div>
              <button
                className="partner-text-link"
                onClick={() => void downloadEvidence(e).catch(() => onError(ot(l, 'error')))}
                aria-label={`${ot(l, 'download')} ${e.name}`}
              >
                {ot(l, 'download')}
                <ArrowUpRight size={13} />
              </button>
              <button
                disabled={disabled}
                className="partner-document-attach"
                aria-label={`${ot(l, attached ? 'remove' : 'attach')} ${e.name}`}
                onClick={() =>
                  onDraft({
                    ...draft,
                    ...(e.kind === 'PORTRAIT'
                      ? { portraitId: attached ? '' : e.id }
                      : {
                          evidenceIds: attached
                            ? draft.evidenceIds.filter((x) => x !== e.id)
                            : [...draft.evidenceIds, e.id],
                        }),
                  })
                }
              >
                {attached ? <X size={16} /> : <Plus size={16} />}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}

function PartnerTeam({
  locale: l,
  data,
  busy,
  action,
  onError,
  onNotice,
  error,
}: {
  locale: Locale;
  data: PartnerSnapshot;
  busy: boolean;
  action: Action;
  onError: (s: string) => void;
  onNotice: (s: string) => void;
  error: string;
}) {
  const [invite, setInvite] = useState({ name: '', email: '' }),
    [link, setLink] = useState(''),
    [selected, setSelected] = useState<{
      member: PartnerSnapshot['members'][number];
      mode: 'content' | 'end';
    }>(),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false);
  function newLink(token: string) {
    setLink(`${location.origin}/${l}/onboarding?role=STAFF#invite=${token}`);
  }
  useEffect(() => {
    if (!selected) return;
    const current = data.members.find((m) => m.listing.id === selected.member.listing.id);
    if (
      current &&
      (current.version !== selected.member.version ||
        current.listing.moderationVersion !== selected.member.listing.moderationVersion)
    ) {
      setSelected({ ...selected, member: current });
      setAck(false);
    }
  }, [data.members, selected]);
  return (
    <>
      <section className="partner-panel">
        <div className="partner-section-heading">
          <span>03 / GROW TOGETHER</span>
          <h2>{ot(l, 'invite')}</h2>
          <p>{ot(l, 'inviteHelp')}</p>
        </div>
        <form
          className="partner-invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const r = await api<{ token: string }>('onboarding/invitations', invite);
              newLink(r.token);
              setInvite({ name: '', email: '' });
            });
          }}
        >
          <Field label={ot(l, 'inviteName')}>
            <input
              required
              minLength={2}
              maxLength={80}
              value={invite.name}
              onChange={(e) => setInvite({ ...invite, name: e.target.value })}
            />
          </Field>
          <Field label={ot(l, 'inviteEmail')}>
            <input
              required
              type="email"
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
            />
          </Field>
          <button disabled={busy} className="button">
            <Plus size={16} />
            {ot(l, 'invite')}
          </button>
        </form>
        {link && (
          <div className="partner-link-result" role="status">
            <p>{ot(l, 'copyHelp')}</p>
            <div>
              <input
                readOnly
                value={link}
                aria-label={ot(l, 'copy')}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="button secondary small"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(link)
                    .then(() => onNotice(ot(l, 'copied')))
                    .catch(() => onError(ot(l, 'error')))
                }
              >
                <Copy size={15} />
                {ot(l, 'copy')}
              </button>
            </div>
          </div>
        )}
        <div className="partner-invitation-list">
          {data.invitations.map((i) => (
            <article key={i.id}>
              <span className="partner-initials">
                <Mail size={19} />
              </span>
              <div>
                <strong>{i.name}</strong>
                <small>{i.email}</small>
                <small>
                  {ot(l, 'endsAt')} {dateTime(l, i.expiresAt)}
                </small>
              </div>
              <Status locale={l} value={i.status} />
              {i.status !== 'ACCEPTED' && (
                <div className="partner-actions">
                  <button
                    className="partner-text-link"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const r = await api<{ token: string }>(`onboarding/invitations/${i.id}`, {
                          version: i.version,
                          action: 'RESEND',
                        });
                        newLink(r.token);
                      })
                    }
                  >
                    {ot(l, 'resend')}
                  </button>
                  {i.status === 'PENDING' && (
                    <button
                      className="partner-text-link danger"
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          api(`onboarding/invitations/${i.id}`, {
                            version: i.version,
                            action: 'REVOKE',
                          }),
                        )
                      }
                    >
                      {ot(l, 'cancelInvite')}
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
      <section className="partner-panel">
        <div className="partner-section-heading">
          <span>PEOPLE & PERMISSIONS</span>
          <h2>{ot(l, 'team')}</h2>
          <p>{ot(l, 'contentHelp')}</p>
        </div>
        <div className="partner-member-grid">
          {data.members.map((m) => (
            <article key={m.listing.id} className="partner-member">
              <div className="partner-member-heading">
                <span className="partner-initials">
                  <UserRound size={24} />
                </span>
                <div>
                  <h3>{m.profile?.displayName[l] || m.listing.name[l]}</h3>
                  <small>
                    {m.listing.membershipActive ? ot(l, 'ACCEPTED') : ot(l, 'SUSPENDED')}
                  </small>
                </div>
                <Status
                  locale={l}
                  value={m.status ?? (m.listing.identityVerified ? 'APPROVED' : 'PENDING')}
                />
              </div>
              <div className="partner-member-checks">
                <span>
                  <CheckCircle2 size={14} />
                  {ot(l, m.merchantApproved ? 'contentApprove' : 'merchantReview')}
                </span>
                <span>
                  <ShieldCheck size={14} />
                  {ot(
                    l,
                    m.consent?.status === 'GRANTED' || m.listing.portraitConsent
                      ? 'granted'
                      : 'notGranted',
                  )}
                </span>
              </div>
              {m.openBookings.length > 0 && (
                <Link className="partner-open-orders" href={`/${l}/merchant?tab=bookings`}>
                  {ot(l, 'openBookings')} · {m.openBookings.length}
                  <ArrowUpRight size={14} />
                </Link>
              )}
              <div className="partner-actions">
                {m.profile && (
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => {
                      setSelected({ member: m, mode: 'content' });
                      setReason('');
                      setAck(false);
                    }}
                  >
                    {ot(l, 'approveContent')}
                    <ArrowUpRight size={14} />
                  </button>
                )}
                {m.listing.membershipActive && (
                  <button
                    className="partner-text-link danger"
                    disabled={busy}
                    onClick={() => {
                      setSelected({ member: m, mode: 'end' });
                      setReason('');
                      setAck(false);
                    }}
                  >
                    {ot(l, 'end')}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {!data.members.length && <p className="partner-empty">{ot(l, 'empty')}</p>}
      </section>
      <MobileSheet
        locale={l}
        open={!!selected}
        onClose={() => {
          if (!busy) setSelected(undefined);
        }}
        title={ot(l, selected?.mode === 'end' ? 'end' : 'approveContent')}
      >
        {selected && (
          <div className="partner-sheet-body">
            <p>{ot(l, selected.mode === 'end' ? 'endHelp' : 'contentHelp')}</p>
            {error && (
              <p className="partner-message error" role="alert">
                {error}
              </p>
            )}
            {selected.mode === 'content' ? (
              <>
                <div className="partner-consent-preview">
                  <PrivatePortrait id={selected.member.profile?.portraitId} />
                  <div>
                    <h3>{selected.member.profile?.displayName[l]}</h3>
                    <p>{selected.member.profile?.description[l]}</p>
                    <Status locale={l} value={selected.member.status ?? 'PENDING'} />
                  </div>
                </div>
                <div className="partner-review-profile">
                  {languages.map((lang) => (
                    <div key={lang}>
                      <small>{languageNames[lang]}</small>
                      <strong>{selected.member.profile?.displayName[lang]}</strong>
                      <p>{selected.member.profile?.description[lang]}</p>
                    </div>
                  ))}
                </div>
                <p>
                  {data.offerings
                    .filter((o) => selected.member.profile?.offeringIds.includes(o.id))
                    .map((o) => o.name[l])
                    .join(' / ')}
                </p>
                <label className="partner-check">
                  <input
                    type="checkbox"
                    checked={ack}
                    disabled={busy}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  <span>{ot(l, 'checkContent')}</span>
                </label>
              </>
            ) : (
              <div className="partner-message warning">
                {ot(l, 'openBookings')} · {selected.member.openBookings.length}
                {selected.member.openBookings.length > 0 && (
                  <Link href={`/${l}/merchant?tab=bookings`}>
                    {ot(l, 'orders')}
                    <ArrowUpRight size={14} />
                  </Link>
                )}
              </div>
            )}
            <Field label={ot(l, 'reason')}>
              <textarea
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={ot(l, 'reasonHelp')}
                disabled={busy}
              />
            </Field>
            <div className="partner-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setSelected(undefined)}
              >
                {ot(l, 'close')}
              </button>
              {selected.mode === 'content' ? (
                <>
                  <button
                    className="button secondary"
                    disabled={
                      busy || reason.trim().length < 10 || selected.member.status !== 'SUBMITTED'
                    }
                    onClick={() =>
                      void action(
                        () =>
                          api(`onboarding/members/${selected.member.applicationId}/content`, {
                            version: selected.member.version,
                            approved: false,
                            feedback: reason,
                          }),
                        'saved',
                      ).then((ok) => {
                        if (ok) setSelected(undefined);
                      })
                    }
                  >
                    {ot(l, 'changes')}
                  </button>
                  <button
                    className="button"
                    disabled={
                      busy ||
                      !ack ||
                      reason.trim().length < 10 ||
                      selected.member.status !== 'SUBMITTED'
                    }
                    onClick={() =>
                      void action(
                        () =>
                          api(`onboarding/members/${selected.member.applicationId}/content`, {
                            version: selected.member.version,
                            approved: true,
                            feedback: reason,
                          }),
                        'saved',
                      ).then((ok) => {
                        if (ok) setSelected(undefined);
                      })
                    }
                  >
                    {ot(l, 'contentApprove')}
                  </button>
                </>
              ) : (
                <button
                  className="button"
                  disabled={busy || reason.trim().length < 10}
                  onClick={() =>
                    void action(
                      () =>
                        api(`onboarding/members/${selected.member.listing.id}/end`, {
                          version: selected.member.listing.moderationVersion ?? 1,
                          reason,
                        }),
                      'saved',
                    ).then((ok) => {
                      if (ok) setSelected(undefined);
                    })
                  }
                >
                  {ot(l, 'confirm')}
                </button>
              )}
            </div>
          </div>
        )}
      </MobileSheet>
    </>
  );
}

const reviewCheckKeys = {
  identity: 'checkIdentity',
  category: 'checkCategory',
  documents: 'checkDocuments',
  content: 'checkContent',
  antisocial: 'checkAntisocial',
  psp: 'checkPsp',
} as const;
export function OnboardingReview({
  locale: l,
  onChanged,
}: {
  locale: Locale;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<ApplicationReviewItem[]>([]),
    [filter, setFilter] = useState('SUBMITTED'),
    [selected, setSelected] = useState<ApplicationReviewItem>(),
    [busy, setBusy] = useState(false),
    [fetching, setFetching] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [decision, setDecision] = useState('CHANGES_REQUIRED'),
    [feedback, setFeedback] = useState(''),
    [validUntil, setValidUntil] = useState(dateInput(Date.now() + 180 * 86400000)),
    [checks, setChecks] = useState({
      identity: false,
      category: false,
      documents: false,
      content: false,
      antisocial: false,
      psp: false,
    });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++generation.current;
    setFetching(true);
    try {
      const list = await api<ApplicationReviewItem[]>('onboarding/reviews');
      if (n === generation.current) {
        setItems(list);
        setSelected((prev) =>
          prev ? list.find((i) => i.application.id === prev.application.id) : undefined,
        );
      }
    } catch (e) {
      if (n === generation.current)
        setError(onboardingError(l, e instanceof ClientError ? e.code : undefined));
    } finally {
      if (n === generation.current) setFetching(false);
    }
  }, [l]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  const filtered = items.filter((i) =>
    filter === 'all' || filter === 'EXPIRING'
      ? filter === 'all' ||
        (i.application.status === 'APPROVED' &&
          !!i.application.validUntil &&
          i.application.validUntil < Date.now() + 30 * 86400000)
      : i.application.status === filter,
  );
  async function review() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await api(`onboarding/reviews/${selected.application.id}`, {
        version: selected.application.version,
        decision,
        feedback,
        ...(decision === 'APPROVE' ? { validUntil: endOfDate(validUntil) } : {}),
        checks,
      });
      setSelected(undefined);
      setNotice(ot(l, 'saved'));
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(onboardingError(l, e instanceof ClientError ? e.code : undefined));
      if (e instanceof ClientError && e.code === 'VERSION_CONFLICT') {
        setChecks({
          identity: false,
          category: false,
          documents: false,
          content: false,
          antisocial: false,
          psp: false,
        });
        setFeedback('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  function select(i: ApplicationReviewItem) {
    setSelected(i);
    setDecision(i.application.status === 'APPROVED' ? 'SUSPEND' : 'CHANGES_REQUIRED');
    setFeedback('');
    setChecks({
      identity: false,
      category: false,
      documents: false,
      content: false,
      antisocial: false,
      psp: false,
    });
    setValidUntil(dateInput(Date.now() + 180 * 86400000));
    setError('');
  }
  const a = selected?.application,
    applicantReady =
      !!a &&
      (a.type === 'MERCHANT' || (selected?.merchantApproved && currentConsent(selected.consent)));
  const reviewReady = Object.entries(checks).every(
    ([k, v]) => (a?.type === 'STAFF' && ['psp', 'antisocial'].includes(k)) || v,
  );
  return (
    <section className="partner-review-section">
      <div className="partner-review-heading">
        <div>
          <span className="eyebrow small">PARTNER TRUST / REVIEW DESK</span>
          <h2>{ot(l, 'reviewTitle')}</h2>
          <p>{ot(l, 'contentHelp')}</p>
        </div>
        <span className="partner-review-count">
          {items.filter((i) => i.application.status === 'SUBMITTED').length}
          <small>{ot(l, 'pending')}</small>
        </span>
      </div>
      {error && !selected && (
        <p className="partner-message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="partner-message" role="status">
          {notice}
        </p>
      )}
      <div className="partner-review-toolbar">
        <div className="partner-segment">
          {[
            ['SUBMITTED', 'pending'],
            ['EXPIRING', 'expiring'],
            ['all', 'all'],
          ].map(([value, key]) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {ot(l, key as OnboardingText)}
            </button>
          ))}
        </div>
        <button
          className="partner-refresh"
          disabled={busy || fetching}
          aria-label={ot(l, 'refresh')}
          onClick={() => {
            setError('');
            void refresh();
          }}
        >
          <RefreshCw size={17} className={fetching ? 'spin' : ''} />
        </button>
      </div>
      <div className="partner-review-cards">
        {filtered.map((i) => (
          <article className="partner-review-card" key={i.application.id}>
            <div className="partner-review-card-type">
              <span>{ot(l, i.application.type === 'MERCHANT' ? 'merchant' : 'staff')}</span>
              <Status locale={l} value={i.application.status} />
            </div>
            <h3>{i.application.draft.displayName[l]}</h3>
            <p>{i.application.draft.legalName}</p>
            <div className="partner-review-checklist">
              <span>
                <FileCheck2 size={15} />
                {ot(l, 'evidence')} · {i.evidence.length}
              </span>
              <span>
                <ShieldCheck size={15} />
                {ot(l, i.application.draft.category === 'LICENSED' ? 'licensed' : 'relaxation')}
              </span>
              {i.application.type === 'STAFF' && (
                <span>{ot(l, i.merchantApproved ? 'contentApprove' : 'merchantReview')}</span>
              )}
            </div>
            <footer>
              <small>
                {ot(l, 'version')} {i.application.revision} ·{' '}
                {dateTime(l, i.application.submittedAt ?? i.application.createdAt)}
              </small>
              <button className="partner-text-link" onClick={() => select(i)}>
                {ot(l, 'review')}
                <ArrowUpRight size={14} />
              </button>
            </footer>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="partner-empty">
          <FileCheck2 size={28} />
          <p>{fetching ? ot(l, 'working') : ot(l, 'empty')}</p>
        </div>
      )}
      <MobileSheet
        locale={l}
        open={!!selected}
        onClose={() => {
          if (!busy) setSelected(undefined);
        }}
        title={ot(l, 'reviewTitle')}
      >
        {selected && a && (
          <div className="partner-sheet-body">
            <div className="partner-review-facts">
              <div>
                <small>{ot(l, 'legalName')}</small>
                <strong>{a.draft.legalName}</strong>
              </div>
              <div>
                <small>{ot(l, 'contact')}</small>
                <strong>{a.draft.contact}</strong>
              </div>
              {a.type === 'MERCHANT' && (
                <>
                  <div>
                    <small>{ot(l, 'address')}</small>
                    <strong>{a.draft.legalAddress}</strong>
                  </div>
                  <div>
                    <small>{ot(l, 'emergency')}</small>
                    <strong>{a.draft.emergencyContact}</strong>
                  </div>
                </>
              )}
              <div>
                <small>{ot(l, 'category')}</small>
                <strong>
                  {ot(l, a.draft.category === 'LICENSED' ? 'licensed' : 'relaxation')}
                </strong>
              </div>
              <div>
                <small>{ot(l, 'version')}</small>
                <strong>
                  {a.revision} / v{a.version}
                </strong>
              </div>
            </div>
            <h3>{ot(l, 'scope')}</h3>
            <p>{a.draft.serviceScope}</p>
            {a.draft.category === 'LICENSED' && (
              <p className="partner-message warning">{ot(l, 'regulatedHelp')}</p>
            )}
            {a.type === 'STAFF' && (
              <>
                <div className="partner-consent-preview">
                  <PrivatePortrait id={a.draft.portraitId} />
                  <div>
                    <strong>
                      {ot(l, selected.merchantApproved ? 'contentApprove' : 'merchantReview')}
                    </strong>
                    <p>{ot(l, currentConsent(selected.consent) ? 'granted' : 'notGranted')}</p>
                    {selected.consent && (
                      <small>
                        {selected.consent.termsVersion} · {dateTime(l, selected.consent.startsAt)} —{' '}
                        {dateTime(l, selected.consent.endsAt)}
                      </small>
                    )}
                  </div>
                </div>
              </>
            )}
            <div className="partner-review-profile">
              {languages.map((lang) => (
                <div key={lang}>
                  <small>{languageNames[lang]}</small>
                  <strong>{a.draft.displayName[lang]}</strong>
                  <p>{a.draft.description[lang]}</p>
                </div>
              ))}
            </div>
            <h3>{ot(l, 'evidence')}</h3>
            <div className="partner-document-list">
              {selected.evidence.map((e) => (
                <article key={e.id}>
                  <FileText size={19} />
                  <div>
                    <strong>{e.name}</strong>
                    <small>
                      {ot(l, e.kind)} · {Math.ceil(e.size / 1000)} KB
                    </small>
                  </div>
                  <button
                    className="partner-text-link"
                    disabled={busy}
                    onClick={() => void downloadEvidence(e).catch(() => setError(ot(l, 'error')))}
                  >
                    {ot(l, 'download')}
                    <ArrowUpRight size={14} />
                  </button>
                </article>
              ))}
            </div>
            {a.type === 'MERCHANT' && (
              <div className="partner-message warning">{ot(l, 'demo')}</div>
            )}
            {['SUBMITTED', 'APPROVED'].includes(a.status) && (
              <>
                <Field label={ot(l, 'platformReview')}>
                  <select
                    disabled={busy}
                    value={decision}
                    onChange={(e) => setDecision(e.target.value)}
                  >
                    {a.status === 'APPROVED' ? (
                      <option value="SUSPEND">{ot(l, 'suspend')}</option>
                    ) : (
                      <>
                        <option value="CHANGES_REQUIRED">{ot(l, 'changes')}</option>
                        <option value="REJECT">{ot(l, 'reject')}</option>
                        <option value="APPROVE" disabled={a.draft.category === 'LICENSED'}>
                          {ot(l, 'approve')}
                        </option>
                      </>
                    )}
                  </select>
                </Field>
                {decision === 'APPROVE' && (
                  <>
                    <div className="partner-review-checks">
                      {Object.entries(reviewCheckKeys)
                        .filter(
                          ([k]) => a.type === 'MERCHANT' || !['psp', 'antisocial'].includes(k),
                        )
                        .map(([k, key]) => (
                          <label key={k} className="partner-check">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={checks[k as keyof typeof checks]}
                              onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })}
                            />
                            <span>{ot(l, key)}</span>
                          </label>
                        ))}
                    </div>
                    <Field label={ot(l, 'endsAt')}>
                      <input
                        type="date"
                        required
                        min={dateInput(Date.now())}
                        max={dateInput(Date.now() + 365 * 86400000)}
                        value={validUntil}
                        disabled={busy}
                        onChange={(e) => setValidUntil(e.target.value)}
                      />
                    </Field>
                    {!applicantReady && (
                      <p className="partner-message warning">
                        {ot(l, 'MERCHANT_REVIEW_REQUIRED')} · {ot(l, 'CONSENT_REQUIRED')}
                      </p>
                    )}
                  </>
                )}
                <Field label={ot(l, 'reason')}>
                  <textarea
                    maxLength={500}
                    rows={3}
                    disabled={busy}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder={ot(l, 'reasonHelp')}
                  />
                </Field>
              </>
            )}
            {error && (
              <p className="partner-message error" role="alert">
                {error}
              </p>
            )}
            <div className="partner-history">
              <h3>{ot(l, 'history')}</h3>
              {selected.history.slice(0, 8).map((h) => (
                <div key={h.id}>
                  <span className="partner-history-dot" />
                  <div>
                    <strong>{eventLabel(l, h.action)}</strong>
                    {h.feedback && <p>{h.feedback}</p>}
                    <small>
                      {ot(l, 'version')} {h.revision}
                    </small>
                  </div>
                  <time>{dateTime(l, h.at)}</time>
                </div>
              ))}
            </div>
            <div className="partner-actions partner-sheet-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setSelected(undefined)}
              >
                {ot(l, 'close')}
              </button>
              {['SUBMITTED', 'APPROVED'].includes(a.status) && (
                <button
                  className="button"
                  disabled={
                    busy ||
                    feedback.trim().length < 10 ||
                    (decision === 'APPROVE' && (!reviewReady || !applicantReady || !validUntil))
                  }
                  onClick={() => void review()}
                >
                  {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{' '}
                  {ot(l, 'confirm')}
                </button>
              )}
            </div>
          </div>
        )}
      </MobileSheet>
    </section>
  );
}
