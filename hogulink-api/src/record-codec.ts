import { seal, unseal } from './secrets.js';
const fields: Record<string, string[]> = {
  bookings: ['address'],
  addressBooks: ['items'],
  customerAccounts: ['email', 'name'],
  partnerAccounts: ['email', 'name'],
  messages: ['text'],
  partnerApplications: ['draft'],
  adminMembers: ['email', 'name'],
  contentReviews: ['note'],
};
export function encodeRecord(kind: string, value: Record<string, unknown>) {
  const names = fields[kind];
  if (!names) return JSON.stringify(value);
  const body = { ...value },
    privateData: Record<string, unknown> = {};
  for (const name of names)
    if (name in body) {
      privateData[name] = body[name];
      delete body[name];
    }
  if (Object.keys(privateData).length)
    body._sealedPrivate = seal(JSON.stringify(privateData), `record:${kind}:${value.id}`);
  return JSON.stringify(body);
}
export function decodeRecord<T>(kind: string, json: string): T {
  const body = JSON.parse(json);
  if (body._sealedPrivate) {
    const privateData = JSON.parse(
      unseal(body._sealedPrivate, `record:${kind}:${body.id}`).toString(),
    );
    delete body._sealedPrivate;
    Object.assign(body, privateData);
  }
  return body as T;
}
