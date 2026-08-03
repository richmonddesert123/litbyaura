document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-auth-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    document.getElementById('login-form').style.display = btn.dataset.authTab === 'login' ? 'block' : 'none';
    document.getElementById('signup-form').style.display = btn.dataset.authTab === 'signup' ? 'block' : 'none';
  });
});

document.querySelectorAll('[data-account-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-account-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    ['orders', 'profile', 'password'].forEach((tab) => {
      document.getElementById(`account-tab-${tab}`).style.display = tab === btn.dataset.accountTab ? 'block' : 'none';
    });
  });
});

async function checkAuth() {
  try {
    const customer = await api('/api/customers/me');
    showAccount(customer);
  } catch {
    showAuth();
  }
}

function showAuth() {
  document.getElementById('account-heading').textContent = 'Log in or create an account';
  document.getElementById('auth-screens').style.display = 'block';
  document.getElementById('account-screen').style.display = 'none';
  setupPasswordToggles();
}

function showAccount(customer) {
  document.getElementById('account-heading').textContent = `Hi, ${customer.name.split(' ')[0]}`;
  document.getElementById('auth-screens').style.display = 'none';
  document.getElementById('account-screen').style.display = 'block';
  document.getElementById('profile-name').value = customer.name || '';
  document.getElementById('profile-email').value = customer.email || '';
  document.getElementById('profile-phone').value = customer.phone || '';
  document.getElementById('profile-city').value = customer.city || '';
  document.getElementById('profile-address').value = customer.address || '';
  setupPasswordToggles();
  loadOrderHistory();
}

document.getElementById('show-forgot-link').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('login-form').style.display = 'none';
  document.querySelector('.auth-switch').style.display = 'none';
  document.getElementById('forgot-form').style.display = 'block';
});

document.getElementById('hide-forgot-link').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('forgot-form').style.display = 'none';
  document.getElementById('login-form').style.display = 'block';
  document.querySelector('.auth-switch').style.display = 'block';
});

document.getElementById('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const result = await api('/api/customers/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email: document.getElementById('forgot-email').value }),
    });
    document.getElementById('forgot-form').innerHTML = `<p>${result.message}</p>`;
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const customer = await api('/api/customers/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
      }),
    });
    showAccount(customer);
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!passwordsMatch('signup-password', 'signup-confirm-password')) return;
  try {
    const customer = await api('/api/customers/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('signup-name').value,
        email: document.getElementById('signup-email').value,
        password: document.getElementById('signup-password').value,
        phone: document.getElementById('signup-phone').value,
      }),
    });
    showAccount(customer);
    toast('Account created');
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/customers/me', {
      method: 'PUT',
      body: JSON.stringify({
        name: document.getElementById('profile-name').value,
        phone: document.getElementById('profile-phone').value,
        city: document.getElementById('profile-city').value,
        address: document.getElementById('profile-address').value,
      }),
    });
    toast('Shipping info saved');
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!passwordsMatch('new-password', 'confirm-password')) return;
  try {
    await api('/api/customers/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: document.getElementById('current-password').value,
        newPassword: document.getElementById('new-password').value,
      }),
    });
    toast('Password updated');
    e.target.reset();
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('logout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/customers/logout', { method: 'POST' });
  location.reload();
});

async function loadOrderHistory() {
  const el = document.getElementById('order-history');
  try {
    const orders = await api('/api/customers/me/orders');
    if (orders.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>No orders yet.</p><a href="/#shop" class="btn btn-primary">Start shopping</a></div>`;
      return;
    }
    el.innerHTML = orders.map((o) => `
      <div class="order-history-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${o.order_number}</strong>
          <span>${formatMoney(o.subtotal_pesewas)}</span>
        </div>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
          <span class="status-pill ${o.payment_status}">Payment: ${o.payment_status}</span>
          <span class="status-pill ${o.fulfillment_status}">${o.fulfillment_status}</span>
        </div>
        <div style="margin-top:10px; font-size:0.85rem; color:var(--cream-dim);">
          ${o.items.map((i) => `${i.product_name} × ${i.quantity}`).join(', ')}
        </div>
        <div style="margin-top:8px; font-size:0.78rem; color:var(--cream-dim);">Placed ${new Date(o.created_at).toLocaleDateString()}</div>
      </div>
    `).join('');
  } catch {
    el.innerHTML = '<p>Could not load your orders.</p>';
  }
}

checkAuth();
