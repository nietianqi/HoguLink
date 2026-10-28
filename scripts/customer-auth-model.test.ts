import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerAuthInput,
  validateCustomerAuth,
  authFieldError,
  authRequestError,
  type AuthInput,
} from '../hogulink-web/src/lib/customer-auth-model';
import { ca } from '../hogulink-web/src/lib/customer-auth-i18n';

const valid: AuthInput = {
  name: 'Test Guest',
  email: 'guest@example.com',
  password: 'Long test password',
  termsAccepted: true,
};

test('registration identifies each field instead of returning a generic input error', () => {
  assert.deepEqual(
    validateCustomerAuth('register', {
      name: '',
      email: 'invalid',
      password: 'short',
      termsAccepted: false,
    }),
    {
      name: 'nameRequired',
      terms: 'termsRequired',
      email: 'emailInvalid',
      password: 'passwordShort',
    },
  );
  assert.deepEqual(validateCustomerAuth('register', valid), {});
  assert.deepEqual(validateCustomerAuth('register', { ...valid, name: 'x'.repeat(81) }), {
    name: 'nameLong',
  });
  assert.deepEqual(validateCustomerAuth('register', { ...valid, password: 'x'.repeat(129) }), {
    password: 'passwordLong',
  });
});

test('minimum password length applies to registration/reset without blocking existing shorter-password logins', () => {
  assert.equal(
    validateCustomerAuth('register', { ...valid, password: 'x'.repeat(11) }).password,
    'passwordShort',
  );
  assert.equal(
    validateCustomerAuth('register', { ...valid, password: 'x'.repeat(12) }).password,
    undefined,
  );
  assert.equal(
    validateCustomerAuth('reset', { ...valid, email: '', password: 'short' }).password,
    'passwordShort',
  );
  assert.deepEqual(
    validateCustomerAuth('login', { ...valid, name: '', password: 'short', termsAccepted: false }),
    {},
  );
  assert.deepEqual(
    validateCustomerAuth('forgot', { ...valid, name: '', password: '', termsAccepted: false }),
    {},
  );
  assert.equal(
    validateCustomerAuth('login', { ...valid, password: '' }).password,
    'passwordRequired',
  );
});

test('autofill submission reads actual form values, trims name/email, and preserves password characters', () => {
  const form = new FormData();
  form.set('name', '  Test Guest  ');
  form.set('email', '  autofilled@example.com  ');
  form.set('password', ' Password with spaces ');
  form.set('terms', 'on');
  const input = customerAuthInput(form);
  assert.equal(input.email, 'autofilled@example.com');
  assert.equal(input.name, 'Test Guest');
  assert.equal(input.password, ' Password with spaces ');
  assert.equal(input.termsAccepted, true);
  assert.deepEqual(validateCustomerAuth('register', input), {});
  assert.equal(customerAuthInput(new FormData()).termsAccepted, false);
});

test('server validation maps only known field names and never exposes raw validator messages', () => {
  assert.deepEqual(authFieldError('email'), { field: 'email', message: 'emailInvalid' });
  assert.deepEqual(authFieldError('termsAccepted'), { field: 'terms', message: 'termsRequired' });
  assert.equal(authFieldError('unknown.internal.field'), undefined);
  assert.equal(authRequestError('register', 'INTERNAL_ERROR'), 'registerError');
  assert.equal(authRequestError('login', 'INTERNAL_ERROR'), 'loginError');
  assert.equal(authRequestError('login', 'INVALID_CREDENTIALS'), 'credentials');
  assert.equal(authRequestError('login', 'EMAIL_NOT_VERIFIED'), 'unverified');
  assert.equal(authRequestError('register', 'RATE_LIMITED'), 'limited');
  assert.equal(authRequestError('register', 'ORIGIN_REJECTED'), 'originError');
  assert.equal(authRequestError('login', 'SERVICE_UNAVAILABLE'), 'serviceError');
  assert.equal(authRequestError('register', 'FORBIDDEN'), 'refreshError');
});

test('every field hint and recovery instruction is available in Chinese, Japanese and English', () => {
  const keys = [
    'nameRequired',
    'nameLong',
    'emailRequired',
    'emailInvalid',
    'passwordRequired',
    'passwordShort',
    'passwordLong',
    'termsRequired',
    'checkFields',
    'networkError',
    'registerError',
    'loginError',
    'emailError',
    'originError',
    'serviceError',
    'resetSent',
    'verificationSent',
  ] as const;
  for (const locale of ['ja', 'en', 'zh-cn'] as const)
    for (const key of keys) {
      const text = ca(locale, key);
      assert(text.length > 0);
      assert(!text.includes('undefined'));
    }
  assert(ca('zh-cn', 'passwordShort').includes('12'));
  assert(!ca('zh-cn', 'registerError').includes('核对输入'));
});
