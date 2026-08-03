const CodProvider = require('./CodProvider');
const PaystackProvider = require('./PaystackProvider');

const providers = {
  cod: new CodProvider(),
  paystack: new PaystackProvider(),
  // hubtel: new HubtelProvider(),  // add here when ready - nothing else changes
};

function getProvider(id) {
  const provider = providers[id];
  if (!provider) throw new Error(`Unknown payment provider: ${id}`);
  return provider;
}

/** Providers to actually show/accept right now (backend is the real gate). */
function listEnabledProviders() {
  return Object.values(providers).filter((p) => p.isEnabled());
}

/** True if `id` is both a known provider AND currently enabled. */
function isProviderUsable(id) {
  const provider = providers[id];
  return !!provider && provider.isEnabled();
}

module.exports = { providers, getProvider, listEnabledProviders, isProviderUsable };
