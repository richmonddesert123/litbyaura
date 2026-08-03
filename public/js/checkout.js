/**
 * Checkout builds its item list from exactly ONE of two sources, never both:
 *
 *  - Buy Now (?buyNow=<productId>&qty=<n> in the URL): a true bypass. The
 *    cart in localStorage is never read here. This matters because an
 *    earlier version added the item to the cart then redirected, which
 *    meant unrelated items already sitting in the cart got swept into the
 *    "buy now" order too.
 *  - Normal checkout (no ?buyNow param): reads the cart as usual.
 *
 * See the manual test at the bottom of this file's comments: add item A to
 * cart, then hit "Order now" on item B from the product page - the
 * resulting order must contain only B, and the cart must still contain
 * only A afterwards (buy-now never touches or clears the cart).
 */

let checkoutItems = []; // [{ productId, quantity, product }]
let selectedPaymentMethod = 'cod';

renderShopNav();

function getCheckoutSource() {
  const params = new URLSearchParams(location.search);
  const buyNowId = params.get('buyNow');
  if (buyNowId) {
    const qty = Math.max(1, parseInt(params.get('qty') || '1', 10));
    return { mode: 'buyNow', items: [{ productId: Number(buyNowId), quantity: qty }] };
  }
  return { mode: 'cart', items: getCart() };
}

async function init() {
  const source = getCheckoutSource();
  if (source.items.length === 0) {
    document.getElementById('summary-lines').innerHTML = '<p>Nothing to check out. <a href="/#shop">Browse products</a>.</p>';
    document.getElementById('submit-btn').disabled = true;
    return;
  }

  const products = await api('/api/products');
  const productsById = Object.fromEntries(products.map((p) => [p.id, p]));

  checkoutItems = source.items
    .map((line) => ({ ...line, product: productsById[line.productId] }))
    .filter((line) => !!line.product);

  renderSummary();
  await renderPaymentMethods();
  await prefillFromAccount();
}

/** If logged in, pre-fills name/phone/email/address/city from the saved
 * account profile so a returning customer doesn't have to retype their
 * shipping info on every order. */
async function prefillFromAccount() {
  try {
    const customer = await api('/api/customers/me');
    document.getElementById('customerName').value = customer.name || '';
    document.getElementById('phone').value = customer.phone || '';
    document.getElementById('email').value = customer.email || '';
    document.getElementById('address').value = customer.address || '';
    document.getElementById('city').value = customer.city || '';
    const form = document.getElementById('checkout-form');
    const banner = document.createElement('p');
    banner.style.cssText = 'font-size:0.85rem; color: var(--gold-bright); margin-bottom:16px;';
    banner.textContent = `Checking out as ${customer.name} (${customer.email})`;
    form.prepend(banner);
  } catch {
    // not logged in - guest checkout, nothing to prefill
  }
}

function renderSummary() {
  let subtotal = 0;
  const lines = checkoutItems.map((line) => {
    const total = line.product.price_pesewas * line.quantity;
    subtotal += total;
    return `<div class="cart-line"><span>${line.product.name} × ${line.quantity}</span><span>${formatMoney(total)}</span></div>`;
  }).join('');
  document.getElementById('summary-lines').innerHTML = lines;
  document.getElementById('summary-total').textContent = formatMoney(subtotal);
}

async function renderPaymentMethods() {
  const container = document.getElementById('payment-methods');
  try {
    const methods = await api('/api/payment-methods'); // backend is the real gate on what's offered
    container.innerHTML = methods.map((m, i) => `
      <label class="payment-option ${i === 0 ? 'selected' : ''}">
        <input type="radio" name="paymentMethod" value="${m.id}" ${i === 0 ? 'checked' : ''}>
        ${m.label}
      </label>`).join('');
    selectedPaymentMethod = methods[0]?.id || 'cod';
    container.querySelectorAll('input[name="paymentMethod"]').forEach((input) => {
      input.addEventListener('change', () => {
        selectedPaymentMethod = input.value;
        container.querySelectorAll('.payment-option').forEach((el) => el.classList.remove('selected'));
        input.closest('.payment-option').classList.add('selected');
      });
    });
  } catch {
    container.innerHTML = '<p>Cash on Delivery</p>';
  }
}

document.getElementById('checkout-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Placing order…';

  const source = getCheckoutSource();
  const payload = {
    customerName: document.getElementById('customerName').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    email: document.getElementById('email').value.trim(),
    city: document.getElementById('city').value.trim(),
    address: document.getElementById('address').value.trim(),
    notes: document.getElementById('notes').value.trim(),
    paymentMethod: selectedPaymentMethod,
    items: source.items,
  };

  try {
    const result = await api('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
    // Buy Now never touched the cart, so nothing to clear in that mode.
    // Normal checkout clears the cart it just checked out.
    if (source.mode === 'cart') clearCart();
    if (result.redirectUrl) {
      location.href = result.redirectUrl; // hand off to Paystack/Hubtel
    } else {
      location.href = result.confirmationUrl;
    }
  } catch (err) {
    toast(err.message, true);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Place order';
  }
});

init();
