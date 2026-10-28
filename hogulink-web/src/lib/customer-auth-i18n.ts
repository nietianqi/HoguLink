import type { Locale } from '@hogulink/contracts';
const text = {
  demoLogin: ['サンプル予約を試す', 'Try sample bookings', '体验示例预约'],
  demoHelp: [
    '共有のサンプルアカウントです。実在の個人情報は入力しないでください。',
    'This is a shared sample account. Use fictional personal information.',
    '这是共享示例账号，请使用虚构的个人资料。',
  ],
  title: ['アカウント', 'Your account', '顾客账号'],
  login: ['ログイン', 'Sign in', '登录'],
  register: ['アカウント作成', 'Create account', '注册账号'],
  help: [
    'ご本人のメールで登録すると、予約と住所を安全に管理できます。',
    'Use your own email to keep your bookings and addresses private.',
    '使用自己的邮箱注册，独立管理预约和地址。',
  ],
  name: ['お名前', 'Your name', '姓名'],
  email: ['メールアドレス', 'Email address', '邮箱'],
  password: ['パスワード', 'Password', '密码'],
  passwordHelp: [
    '12〜128文字で設定してください。',
    'Use 12–128 characters.',
    '请设置 12–128 位密码。',
  ],
  nameRequired: ['お名前を入力してください。', 'Enter your name.', '请填写姓名。'],
  nameLong: [
    'お名前は80文字以内で入力してください。',
    'Use no more than 80 characters for your name.',
    '姓名不能超过 80 个字符。',
  ],
  emailRequired: [
    'メールアドレスを入力してください。',
    'Enter your email address.',
    '请填写邮箱地址。',
  ],
  emailInvalid: [
    '有効なメールアドレスを入力してください。',
    'Enter a valid email address, such as name@example.com.',
    '邮箱格式不正确，请填写完整地址，例如 name@example.com。',
  ],
  passwordRequired: ['パスワードを入力してください。', 'Enter your password.', '请填写密码。'],
  passwordShort: [
    'パスワードは12文字以上で設定してください。',
    'Use at least 12 characters for your password.',
    '密码至少需要 12 个字符，请增加长度。',
  ],
  passwordLong: [
    'パスワードは128文字以内で設定してください。',
    'Use no more than 128 characters for your password.',
    '密码不能超过 128 个字符。',
  ],
  termsRequired: [
    '利用規約とプライバシーの説明を確認し、同意してください。',
    'Read and agree to the terms and privacy notice to continue.',
    '请阅读并勾选同意服务条款和隐私说明。',
  ],
  checkFields: [
    '表示された入力項目を確認してください。',
    'Check the highlighted fields below.',
    '请修改下方标红的内容。',
  ],
  networkError: [
    '接続できませんでした。通信環境を確認して再試行してください。入力内容は保持されています。',
    'Could not connect. Check your internet connection and try again. Your entries are still here.',
    '网络连接中断，请检查网络后重试。已填写的内容会保留。',
  ],
  registerError: [
    '登録を完了できませんでした。入力内容は保持されています。少し待って再試行してください。',
    'Registration could not be completed. Your entries are still here; please try again shortly.',
    '暂时无法完成注册，请稍后重试。已填写的内容会保留。',
  ],
  loginError: [
    'ログインできませんでした。少し待って再試行してください。',
    'Could not sign you in. Please try again shortly.',
    '暂时无法登录，请稍后重试。',
  ],
  emailError: [
    'メールのリクエストを受け付けられませんでした。少し待って再試行してください。',
    'Could not request the email. Please try again shortly.',
    '暂时无法申请验证或找回密码邮件，请稍后重试。',
  ],
  originError: [
    'このアドレスからは送信できません。ページを更新し、それでも続く場合は正式なHoguLinkのアドレスから開き直してください。',
    'This page address cannot submit. Refresh the page; if it keeps happening, reopen HoguLink from its official address.',
    '当前网址无法提交。请刷新页面；如果仍然失败，请从 HoguLink 的正式网址重新打开。',
  ],
  serviceError: [
    'サービスに一時的に接続できません。少し待って再試行してください。入力内容は保持されています。',
    'The service is temporarily unreachable. Please try again shortly. Your entries are still here.',
    '服务暂时连接不上，请稍后重试。已填写的内容会保留。',
  ],
  refreshError: [
    'ページを更新して、もう一度お試しください。',
    'Refresh this page and try again.',
    '页面状态已失效，请刷新后重试。',
  ],
  forgot: ['パスワードをお忘れですか', 'Forgot your password?', '忘记密码'],
  reset: ['パスワードの再設定', 'Reset password', '重设密码'],
  verify: ['メールアドレスを確認', 'Verify email', '确认邮箱'],
  send: ['メールを送信', 'Send email', '发送邮件'],
  resend: ['確認メールを再送', 'Resend verification email', '重发验证邮件'],
  sent: [
    '該当するアカウントがある場合はメールを送信します。受信箱をご確認ください。',
    'If the account is eligible, an email will be sent. Please check your inbox.',
    '如果邮箱符合条件，我们会发送邮件，请查看收件箱。',
  ],
  resetSent: [
    'このメールアドレスで登録されている場合、再設定リンクが届きます。迷惑メールフォルダもご確認ください。',
    'If this email is registered, a password reset link will arrive. Check your spam folder too.',
    '如果该邮箱已注册，你会收到密码重设链接。请同时查看收件箱和垃圾邮件。',
  ],
  verificationSent: [
    '確認メールをリクエストしました。メール内のリンクを開いてください。迷惑メールフォルダもご確認ください。',
    'Verification email requested. Open the link in your inbox and check your spam folder too.',
    '验证邮件申请已提交。请到邮箱点击验证链接，并检查垃圾邮件文件夹。',
  ],
  registered: [
    '登録手続きを受け付けました。メール内の確認リンクから認証後にログインしてください。すでに登録済みの場合はログインまたは再設定をご利用ください。',
    'Request received. Verify your email using the link before signing in. If you already have an account, sign in or reset your password.',
    '请到邮箱查收验证邮件，点击链接后即可登录。链接 30 分钟内有效；已注册的邮箱可直接登录或找回密码。',
  ],
  verified: [
    '確認が完了しました。ログインしてください。',
    'Email verified. You can now sign in.',
    '邮箱验证成功，请登录。',
  ],
  changed: [
    '再設定が完了しました。新しいパスワードでログインしてください。',
    'Password reset. Sign in with your new password.',
    '密码已重设，请使用新密码登录。',
  ],
  terms: [
    '利用規約とプライバシーの説明（テスト版）に同意します。',
    'I agree to the test terms and privacy notice.',
    '我同意服务条款和隐私说明（测试版）。',
  ],
  termsLink: ['利用規約', 'Terms', '服务条款'],
  privacyLink: ['プライバシー', 'Privacy', '隐私说明'],
  continue: ['元のページに戻る', 'Continue', '返回原页面'],
  logout: ['ログアウト', 'Sign out', '退出登录'],
  signed: ['ログイン中', 'Signed in', '已登录'],
  working: ['処理中…', 'Please wait…', '处理中…'],
  unavailable: [
    'メール送信が未設定です。現在は検証環境のため、登録完了には運営側の送信設定が必要です。',
    'Email delivery is not configured. Registration requires the test environment operator to configure it.',
    '邮件服务尚未配置，当前为测试环境，完成注册需要运营方接通邮件投递。',
  ],
  invalid: [
    'リンクが期限切れか、すでに使用されています。新しいメールをリクエストしてください。',
    'This link has expired or has already been used. Request a new email.',
    '链接已失效或使用过，请重新申请邮件。',
  ],
  error: [
    '手続きを完了できませんでした。入力内容を確認して再試行してください。',
    'We could not complete this request. Check your details and try again.',
    '暂时无法完成操作，请稍后重试。已填写的内容会保留。',
  ],
  credentials: [
    'メールアドレスまたはパスワードが正しくありません。',
    'Email or password is incorrect.',
    '邮箱或密码不正确。',
  ],
  unverified: [
    'メール内のリンクから確認を完了してください。',
    'Verify your email using the link in your inbox.',
    '请先通过邮件中的链接验证邮箱。',
  ],
  limited: [
    'リクエストが多すぎます。しばらくしてから再試行してください。',
    'Too many requests. Please try again later.',
    '操作过于频繁，请稍后重试。',
  ],
} as const;
export type CustomerAuthText = keyof typeof text;
export function ca(l: Locale, k: keyof typeof text) {
  return text[k][l === 'ja' ? 0 : l === 'en' ? 1 : 2];
}
export function safeAccountReturn(locale: Locale, value: string | null) {
  if (value) value = value.replace(/^\/(ja|en|zh-cn)(?=\/)/, `/${locale}`);
  if (
    !value ||
    !value.startsWith(`/${locale}/`) ||
    value.includes('\\') ||
    /[\u0000-\u001f]/.test(value) ||
    value.split(/[?#]/)[0] === `/${locale}/account/access`
  )
    return `/${locale}/account`;
  return value;
}
