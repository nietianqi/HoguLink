import type { CustomerAuthText } from './customer-auth-i18n';

export type CustomerAuthMode = 'login' | 'register' | 'forgot' | 'verify' | 'reset';
export type AuthField = 'name' | 'email' | 'password' | 'terms';
export type AuthFieldErrors = Partial<Record<AuthField, CustomerAuthText>>;
export type AuthInput = { name: string; email: string; password: string; termsAccepted: boolean };

/** Read the form itself, including values filled by a browser/password manager without change events. */
export function customerAuthInput(data: FormData): AuthInput {
  return {
    name: String(data.get('name') ?? '').trim(),
    email: String(data.get('email') ?? '').trim(),
    password: String(data.get('password') ?? ''),
    termsAccepted: data.get('terms') === 'on',
  };
}
export function validateCustomerAuth(mode: CustomerAuthMode, input: AuthInput): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  if (mode === 'register') {
    if (!input.name) errors.name = 'nameRequired';
    else if (input.name.length > 80) errors.name = 'nameLong';
    if (!input.termsAccepted) errors.terms = 'termsRequired';
  }
  if (['login', 'register', 'forgot'].includes(mode)) {
    if (!input.email) errors.email = 'emailRequired';
    else if (input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
      errors.email = 'emailInvalid';
  }
  if (['login', 'register', 'reset'].includes(mode)) {
    if (!input.password) errors.password = 'passwordRequired';
    else if (mode !== 'login' && input.password.length < 12) errors.password = 'passwordShort';
    else if (input.password.length > 128) errors.password = 'passwordLong';
  }
  return errors;
}

export function authFieldError(
  field: string,
): { field: AuthField; message: CustomerAuthText } | undefined {
  if (field === 'name') return { field, message: 'nameRequired' };
  if (field === 'email') return { field, message: 'emailInvalid' };
  if (field === 'password') return { field, message: 'passwordHelp' };
  if (field === 'termsAccepted') return { field: 'terms', message: 'termsRequired' };
}

export function authRequestError(mode: CustomerAuthMode, code: string): CustomerAuthText {
  if (code === 'INVALID_CREDENTIALS') return 'credentials';
  if (code === 'EMAIL_NOT_VERIFIED') return 'unverified';
  if (code === 'TOKEN_INVALID') return 'invalid';
  if (code === 'RATE_LIMITED') return 'limited';
  // The API rejects writes from a page address it does not serve (e.g. localhost vs 127.0.0.1).
  if (code === 'ORIGIN_REJECTED') return 'originError';
  if (code === 'SERVICE_UNAVAILABLE') return 'serviceError';
  if (code === 'FORBIDDEN') return 'refreshError';
  if (mode === 'register') return 'registerError';
  if (mode === 'login') return 'loginError';
  if (mode === 'forgot') return 'emailError';
  return 'error';
}
