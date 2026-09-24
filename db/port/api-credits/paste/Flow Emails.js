// One item per Google Flow account useapi holds, read from the account list
// `Flow Accounts` fetched just before. That list says whether each account is
// healthy but NOT how many credits it has — credits live on each account's own
// record, which `Flow Account` fetches next, once per item.
//
// An answer that is not a list of accounts (useapi down, the token rotated)
// still emits one item, with no email, so the run carries on to the other
// providers and `Normalize` records the failure instead of the run dying here.
const res = $('Flow Accounts').first().json || {};
const body = res.statusCode === 200 && res.body && typeof res.body === 'object' ? res.body : {};
const emails = Object.keys(body).filter((k) => k.includes('@')).sort();
if (emails.length === 0) return [{ json: { email: null } }];
return emails.map((email) => ({ json: { email } }));
