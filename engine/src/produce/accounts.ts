// The Google Flow accounts a film can run on, in the order n8n's `Assign
// Accounts`, `IMG Account` and `IMG Cooldown Guard` list them (three copies in
// n8n, one here). The first is the Ultra family manager — the only account
// Google serves the free low-priority video model to.
export const ACCOUNTS = [
  'fermafabiz@gmail.com',
  'houseofvideos01@gmail.com',
  'houseofvideos02@gmail.com',
];
export const MANAGER = ACCOUNTS[0];
/** One image model string; n8n keeps it in three places that must agree. */
export const IMAGE_MODEL = 'nano-banana-2';
