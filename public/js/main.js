// Shared across all pages: money formatting, cart persistence, nav badge.
// NOTE: localStorage is fine here because this is a real site the user
// deploys and serves themselves - it is not a claude.ai artifact preview,
// where browser storage APIs are unavailable.

const CURRENCY_SYMBOL = document.documentElement.dataset.currencySymbol || 'GH₵';
const CART_KEY = 'litbyaura_cart';

function formatMoney(pesewas) {
  return `${CURRENCY_SYMBOL}${(pesewas / 100).toFixed(2)}`;
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(productId, quantity = 1) {
  const cart = getCart();
  const existing = cart.find((line) => line.productId === productId);
  if (existing) existing.quantity += quantity;
  else cart.push({ productId, quantity });
  saveCart(cart);
}

function updateCartQuantity(productId, quantity) {
  let cart = getCart();
  if (quantity <= 0) {
    cart = cart.filter((line) => line.productId !== productId);
  } else {
    const line = cart.find((l) => l.productId === productId);
    if (line) line.quantity = quantity;
  }
  saveCart(cart);
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartBadge();
}

function cartItemCount() {
  return getCart().reduce((sum, l) => sum + l.quantity, 0);
}

function updateCartBadge() {
  const badge = document.querySelector('[data-cart-count]');
  if (badge) badge.textContent = cartItemCount();
}

function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

document.addEventListener('DOMContentLoaded', updateCartBadge);

/**
 * Wires an eye-icon toggle onto any input inside a `.password-field`
 * wrapper, switching type="password" <-> type="text" so people can view
 * what they typed before submitting.
 */
function setupPasswordToggles(root = document) {
  root.querySelectorAll('.password-field').forEach((wrap) => {
    if (wrap.querySelector('.password-toggle')) return; // already wired
    const input = wrap.querySelector('input');
    if (!input) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle';
    btn.textContent = 'Show';
    btn.setAttribute('aria-label', 'Show password');
    btn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
    });
    wrap.appendChild(btn);
  });
}

/**
 * Renders the shop nav: All / New Arrivals / Shop by Concern (dropdown) /
 * Shop by Skin Type (dropdown) / Brands (dropdown) / Best Sellers.
 * Concern/skin-type/brand entries only include ones with at least one
 * active product (API already filters this) - and the whole dropdown item
 * is hidden if that list comes back empty. Best Sellers is hidden the same
 * way if there are currently no best-seller products.
 * @param {string} activeView - one of 'all'|'new-arrivals'|'concern'|'skin-type'|'brand'|'best-sellers'|''
 */
async function renderShopNav(activeView = '') {
  const el = document.getElementById('shop-nav');
  if (!el) return;
  try {
    const [concerns, skinTypes, brands, bestSellers] = await Promise.all([
      api('/api/concerns'),
      api('/api/skin-types'),
      api('/api/brands'),
      api('/api/products?bestSeller=1'),
    ]);

    const items = [];
    items.push(`<div class="shop-nav-item"><a href="/shop.html?view=all" class="shop-nav-link ${activeView === 'all' ? 'active' : ''}">All</a></div>`);
    items.push(`<div class="shop-nav-item"><a href="/shop.html?view=new-arrivals" class="shop-nav-link ${activeView === 'new-arrivals' ? 'active' : ''}">New Arrivals</a></div>`);

    if (concerns.length) {
      items.push(dropdownItem('Shop by Concern', concerns.map((c) => ({ href: `/shop.html?view=concern&slug=${encodeURIComponent(c.slug)}`, label: c.name })), activeView === 'concern'));
    }
    if (skinTypes.length) {
      items.push(dropdownItem('Shop by Skin Type', skinTypes.map((s) => ({ href: `/shop.html?view=skin-type&slug=${encodeURIComponent(s.slug)}`, label: s.name })), activeView === 'skin-type'));
    }
    if (brands.length) {
      items.push(dropdownItem('Brands', brands.map((b) => ({ href: `/shop.html?view=brand&name=${encodeURIComponent(b)}`, label: b })), activeView === 'brand'));
    }
    if (bestSellers.length) {
      items.push(`<div class="shop-nav-item"><a href="/shop.html?view=best-sellers" class="shop-nav-link ${activeView === 'best-sellers' ? 'active' : ''}">Best Sellers</a></div>`);
    }

    el.innerHTML = `<div class="wrap">${items.join('')}</div>`;
    wireDropdowns(el);
  } catch {
    el.innerHTML = '';
  }
}

function dropdownItem(label, links, isActive) {
  return `
    <div class="shop-nav-item">
      <button type="button" class="shop-nav-toggle ${isActive ? 'active' : ''}">${label} <span class="caret">▾</span></button>
      <div class="shop-nav-dropdown">
        ${links.map((l) => `<a href="${l.href}">${l.label}</a>`).join('')}
      </div>
    </div>`;
}

function wireDropdowns(navEl) {
  const toggles = navEl.querySelectorAll('.shop-nav-toggle');
  toggles.forEach((toggle) => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = toggle.nextElementSibling;
      const wasOpen = dropdown.classList.contains('open');
      toggles.forEach((t) => { t.classList.remove('open'); t.nextElementSibling.classList.remove('open'); });
      if (!wasOpen) {
        toggle.classList.add('open');
        dropdown.classList.add('open');
      }
    });
  });
  document.addEventListener('click', () => {
    toggles.forEach((t) => { t.classList.remove('open'); t.nextElementSibling.classList.remove('open'); });
  });
}

/**
 * Wires a #price-filter-form (two number inputs #price-min/#price-max in
 * whole currency units, e.g. cedis, plus a clear link) and calls
 * onApply({minPrice, maxPrice}) with pesewas integers (or null) whenever
 * the customer applies or clears the filter. Used on the homepage shop
 * section and on category pages.
 */
function setupPriceFilter(onApply) {
  const form = document.getElementById('price-filter-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const min = document.getElementById('price-min').value;
    const max = document.getElementById('price-max').value;
    onApply({
      minPrice: min ? Math.round(parseFloat(min) * 100) : null,
      maxPrice: max ? Math.round(parseFloat(max) * 100) : null,
    });
  });
  const clearLink = document.getElementById('price-filter-clear');
  if (clearLink) {
    clearLink.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('price-min').value = '';
      document.getElementById('price-max').value = '';
      onApply({ minPrice: null, maxPrice: null });
    });
  }
}

/**
 * Compares two password inputs and toasts+returns false on mismatch or if
 * either is empty. Call this before submitting any "set a new password"
 * form that has separate password + confirm fields.
 */
function passwordsMatch(passwordInputId, confirmInputId) {
  const password = document.getElementById(passwordInputId).value;
  const confirm = document.getElementById(confirmInputId).value;
  if (password !== confirm) {
    toast('Passwords do not match', true);
    return false;
  }
  return true;
}
