let currentTab = 'orders';
let allConcerns = [];
let allSkinTypes = [];

const FULFILLMENT_STATUSES = ['processing', 'confirmed', 'shipped', 'delivered', 'completed', 'cancelled'];

async function checkSetupThenAuth() {
  try {
    const { hasAdmin } = await api('/api/admin/setup-status');
    if (!hasAdmin) {
      showSetup();
    } else {
      checkAuth();
    }
  } catch {
    checkAuth();
  }
}

function showSetup() {
  document.getElementById('setup-screen').style.display = 'block';
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'none';
  setupPasswordToggles();
}

async function checkAuth() {
  try {
    await api('/api/admin/me');
    showDashboard();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'block';
  document.getElementById('dashboard').style.display = 'none';
  setupPasswordToggles();
}

function showDashboard() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'grid';
  switchTab('orders');
}

document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!passwordsMatch('setup-password', 'setup-confirm-password')) return;
  try {
    await api('/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('setup-email').value,
        password: document.getElementById('setup-password').value,
      }),
    });
    showDashboard();
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      }),
    });
    showDashboard();
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('logout-link').addEventListener('click', async (e) => {
  e.preventDefault();
  await api('/api/admin/logout', { method: 'POST' });
  showLogin();
});

document.getElementById('forgot-link').addEventListener('click', (e) => {
  e.preventDefault();
  openForgotPasswordModal();
});

function openForgotPasswordModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal" style="width:400px;">
        <h2 class="mt-0">Reset your password</h2>
        <div id="forgot-modal-content">
          <p style="font-size:0.85rem; color:var(--cream-dim);">Enter your admin email and we'll send a link to reset your password.</p>
          <form id="admin-forgot-form">
            <div class="field"><label for="forgot-admin-email">Email</label><input id="forgot-admin-email" type="email" required></div>
            <div style="display:flex; gap:10px; margin-top:12px;">
              <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
              <button type="submit" class="btn btn-primary">Send reset link</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;

  document.getElementById('admin-forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const result = await api('/api/admin/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: document.getElementById('forgot-admin-email').value }),
      });
      document.getElementById('forgot-modal-content').innerHTML = `
        <p>${result.message}</p>
        <button class="btn btn-outline" onclick="closeModal()">Close</button>`;
    } catch (err) {
      toast(err.message, true);
    }
  });
}

document.querySelectorAll('[data-tab]').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab(link.dataset.tab);
  });
});

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('[data-tab]').forEach((l) => l.classList.toggle('active', l.dataset.tab === tab));
  ['orders', 'products', 'hero', 'settings'].forEach((t) => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'orders') loadOrders();
  if (tab === 'products') loadProducts();
  if (tab === 'hero') loadHeroSlides();
  if (tab === 'settings') loadSettings();
}

// ---- Orders ----
async function loadOrders() {
  const el = document.getElementById('tab-orders');
  el.innerHTML = '<h2>Orders</h2><p>Loading…</p>';
  const orders = await api('/api/admin/orders');

  const totalRevenue = orders.filter((o) => o.payment_status === 'paid').reduce((sum, o) => sum + o.subtotal_pesewas, 0);
  const pendingCod = orders.filter((o) => o.payment_method === 'cod' && o.payment_status === 'pending').length;
  const activeOrders = orders.filter((o) => !['delivered', 'completed', 'cancelled'].includes(o.fulfillment_status)).length;

  el.innerHTML = `
    <div class="admin-toolbar"><h2 class="mt-0">Orders</h2></div>
    <div class="stat-grid">
      <div class="stat-card accent"><div class="stat-label">Total orders</div><div class="stat-value">${orders.length}</div></div>
      <div class="stat-card"><div class="stat-label">In progress</div><div class="stat-value">${activeOrders}</div></div>
      <div class="stat-card"><div class="stat-label">Pending COD payment</div><div class="stat-value">${pendingCod}</div></div>
      <div class="stat-card"><div class="stat-label">Revenue collected</div><div class="stat-value">${formatMoney(totalRevenue)}</div></div>
    </div>
    <div class="admin-card">
      <table class="admin-table">
        <thead><tr><th>Order #</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th>Placed</th><th></th></tr></thead>
        <tbody>${orders.map(orderRow).join('')}</tbody>
      </table>
    </div>`;
}

function orderRow(o) {
  const options = FULFILLMENT_STATUSES.includes(o.fulfillment_status)
    ? FULFILLMENT_STATUSES
    : [...FULFILLMENT_STATUSES, o.fulfillment_status]; // preserve any custom status already set
  return `
    <tr>
      <td>${o.order_number}${o.email ? `<br><span style="color:var(--cream-dim); font-size:0.78rem;">${o.email}</span>` : ''}</td>
      <td>${o.customer_name}<br><span style="color:var(--cream-dim); font-size:0.8rem;">${o.phone}</span></td>
      <td>${formatMoney(o.subtotal_pesewas)}</td>
      <td>${o.payment_method.toUpperCase()} — <span class="status-pill ${o.payment_status}">${o.payment_status}</span></td>
      <td>
        <select onchange="handleStatusChange(${o.id}, this)">
          ${options.map((s) => `<option value="${s}" ${o.fulfillment_status === s ? 'selected' : ''}>${s}</option>`).join('')}
          <option value="__other__">Other…</option>
        </select>
      </td>
      <td style="font-size:0.8rem; color:var(--cream-dim);">${new Date(o.created_at).toLocaleDateString()}</td>
      <td>
        ${o.payment_method === 'cod' && o.payment_status === 'pending'
          ? `<button class="btn btn-outline" style="padding:6px 12px; font-size:0.8rem;" onclick="updateOrderStatus(${o.id}, 'paymentStatus', 'paid')">Mark paid</button>`
          : ''}
      </td>
    </tr>`;
}

function handleStatusChange(orderId, select) {
  if (select.value === '__other__') {
    const custom = prompt('Enter a custom fulfillment status:');
    if (!custom) { loadOrders(); return; }
    updateOrderStatus(orderId, 'fulfillmentStatus', custom.trim());
  } else {
    updateOrderStatus(orderId, 'fulfillmentStatus', select.value);
  }
}

async function updateOrderStatus(orderId, field, value) {
  try {
    await api(`/api/admin/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ [field]: value }) });
    toast('Order updated — customer notified by email if one is on file');
    loadOrders();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- Products ----
async function loadProducts() {
  const el = document.getElementById('tab-products');
  el.innerHTML = '<h2>Products</h2><p>Loading…</p>';
  const [products, concerns, skinTypes] = await Promise.all([
    api('/api/admin/products'),
    api('/api/concerns?all=1'), // full fixed list, not just ones currently in use - admin needs to assign new ones too
    api('/api/skin-types?all=1'),
  ]);
  allConcerns = concerns;
  allSkinTypes = skinTypes;

  const activeCount = products.filter((p) => p.is_active).length;
  const lowStockCount = products.filter((p) => p.is_active && p.stock > 0 && p.stock <= 5).length;
  const outOfStockCount = products.filter((p) => p.is_active && p.stock === 0).length;
  const bestSellerCount = products.filter((p) => p.is_active && p.is_best_seller).length;

  el.innerHTML = `
    <div class="admin-toolbar">
      <h2 class="mt-0">Products</h2>
      <button class="btn btn-primary" onclick="openProductModal()">Add product</button>
    </div>
    <div class="stat-grid">
      <div class="stat-card accent"><div class="stat-label">Active products</div><div class="stat-value">${activeCount}</div></div>
      <div class="stat-card"><div class="stat-label">Best sellers</div><div class="stat-value">${bestSellerCount}</div></div>
      <div class="stat-card"><div class="stat-label">Low stock (≤5)</div><div class="stat-value">${lowStockCount}</div></div>
      <div class="stat-card"><div class="stat-label">Out of stock</div><div class="stat-value">${outOfStockCount}</div></div>
    </div>
    <div class="admin-card">
      <table class="admin-table">
        <thead><tr><th>Image</th><th>Name</th><th>Brand</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead>
        <tbody>${products.map(productRow).join('')}</tbody>
      </table>
    </div>`;
  window._products = products;
}

function productRow(p) {
  return `
    <tr>
      <td><img src="${p.image_url}" style="width:40px;height:40px;object-fit:cover;border-radius:3px;"></td>
      <td>${p.name} ${p.is_best_seller ? '<span class="badge-bestseller">★</span>' : ''}<br><span style="color:var(--cream-dim); font-size:0.8rem;">/${p.slug}</span></td>
      <td style="color:var(--cream-dim);">${p.brand || '—'}</td>
      <td>${formatMoney(p.price_pesewas)}</td>
      <td>${p.stock}</td>
      <td>${p.is_active ? '<span class="status-pill paid">active</span>' : '<span class="status-pill cancelled">hidden</span>'}</td>
      <td>
        <button class="btn btn-outline" style="padding:6px 12px; font-size:0.8rem;" onclick="openProductModal(${p.id})">Edit</button>
        ${p.is_active ? `<button class="btn btn-outline" style="padding:6px 12px; font-size:0.8rem; margin-left:6px;" onclick="deleteProduct(${p.id})">Hide</button>` : ''}
      </td>
    </tr>`;
}

function openProductModal(productId) {
  const p = productId ? window._products.find((x) => x.id === productId) : null;
  const images = p && p.images && p.images.length ? p.images.map((i) => i.url) : [''];
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h2 class="mt-0">${p ? 'Edit product' : 'Add product'}</h2>
        <form id="product-form">
          <div class="field"><label for="name">Name</label><input id="name" required value="${p?.name || ''}"></div>
          <div class="field"><label for="brand">Brand (optional, free text)</label><input id="brand" value="${p?.brand || ''}" placeholder="e.g. LitByAura, CeraVe..."></div>
          <div class="field"><label for="description">Description</label><textarea id="description" rows="3">${p?.description || ''}</textarea></div>
          <div class="field-row">
            <div class="field"><label for="price">Price (${document.documentElement.dataset.currencySymbol || 'GH₵'})</label><input id="price" type="number" step="0.01" min="0" required value="${p ? (p.price_pesewas / 100).toFixed(2) : ''}"></div>
            <div class="field"><label for="compareAt">Compare-at price (optional)</label><input id="compareAt" type="number" step="0.01" min="0" value="${p?.compare_at_pesewas ? (p.compare_at_pesewas / 100).toFixed(2) : ''}"></div>
          </div>
          <div class="field"><label for="stock">Stock</label><input id="stock" type="number" min="0" required value="${p?.stock ?? 0}"></div>

          <div class="field"><label><input type="checkbox" id="isBestSeller" ${p?.is_best_seller ? 'checked' : ''} style="width:auto; margin-right:8px;">Mark as Best Seller</label></div>

          <div class="field">
            <label>Shop by Concern</label>
            <div class="checkbox-grid">
              ${allConcerns.map((c) => `<label><input type="checkbox" class="concern-check" value="${c.id}" ${p && p.concernIds && p.concernIds.includes(c.id) ? 'checked' : ''}> ${c.name}</label>`).join('')}
            </div>
          </div>

          <div class="field">
            <label>Shop by Skin Type</label>
            <div class="checkbox-grid">
              ${allSkinTypes.map((s) => `<label><input type="checkbox" class="skintype-check" value="${s.id}" ${p && p.skinTypeIds && p.skinTypeIds.includes(s.id) ? 'checked' : ''}> ${s.name}</label>`).join('')}
            </div>
          </div>

          <div class="field">
            <label>Product images (angles) — first one is the cover photo</label>
            <div id="image-url-list">
              ${images.map((url) => imageUrlRow(url)).join('')}
            </div>
            <button type="button" class="btn btn-outline" style="padding:8px 14px; font-size:0.82rem;" onclick="addImageUrlRow()">+ Add another angle</button>
          </div>

          ${p ? `<div class="field"><label><input type="checkbox" id="isActive" ${p.is_active ? 'checked' : ''} style="width:auto; margin-right:8px;">Active (visible in store)</label></div>` : ''}
          <div style="display:flex; gap:10px; margin-top:20px;">
            <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>`;

  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const concernIds = Array.from(document.querySelectorAll('.concern-check:checked')).map((i) => Number(i.value));
    const skinTypeIds = Array.from(document.querySelectorAll('.skintype-check:checked')).map((i) => Number(i.value));
    const images = Array.from(document.querySelectorAll('#image-url-list input')).map((i) => i.value.trim()).filter(Boolean);
    const body = {
      name: document.getElementById('name').value,
      brand: document.getElementById('brand').value.trim(),
      description: document.getElementById('description').value,
      pricePesewas: Math.round(parseFloat(document.getElementById('price').value) * 100),
      compareAtPesewas: document.getElementById('compareAt').value ? Math.round(parseFloat(document.getElementById('compareAt').value) * 100) : null,
      stock: parseInt(document.getElementById('stock').value, 10),
      isBestSeller: document.getElementById('isBestSeller').checked,
      concernIds,
      skinTypeIds,
      images,
    };
    if (p) body.isActive = document.getElementById('isActive').checked;

    try {
      if (p) await api(`/api/admin/products/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
      closeModal();
      loadProducts();
      toast('Product saved');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function imageUrlRow(value = '') {
  return `<div class="image-url-row"><input value="${value}" placeholder="/images/placeholder.png or https://..."><button type="button" class="btn btn-outline" style="padding:8px 12px;" onclick="this.parentElement.remove()">✕</button></div>`;
}

function addImageUrlRow() {
  document.getElementById('image-url-list').insertAdjacentHTML('beforeend', imageUrlRow());
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

async function deleteProduct(id) {
  if (!confirm('Hide this product from the store? Past orders referencing it will be unaffected.')) return;
  await api(`/api/admin/products/${id}`, { method: 'DELETE' });
  loadProducts();
}

// ---- Hero Slideshow ----
async function loadHeroSlides() {
  const el = document.getElementById('tab-hero');
  el.innerHTML = '<h2>Hero Slides</h2><p>Loading…</p>';
  const slides = await api('/api/admin/hero-slides');
  el.innerHTML = `
    <div class="admin-toolbar">
      <h2 class="mt-0">Hero Slides</h2>
    </div>
    <p style="font-size:0.85rem; color:var(--cream-dim); max-width:560px; margin-bottom:20px;">
      These rotate automatically in the homepage hero banner. Add as many as you like, reorder them,
      or turn one off without deleting it. Changes appear on the site immediately.
    </p>
    <div id="hero-slides-list" style="display:flex; flex-direction:column; gap:12px; max-width:640px;">
      ${slides.map((s, i) => heroSlideRow(s, i, slides.length)).join('') || '<p style="color:var(--cream-dim); font-size:0.85rem;">No slides yet — add one below.</p>'}
    </div>
    <div class="admin-card" style="max-width:640px; margin-top:24px; padding:20px;">
      <h3 class="mt-0" style="font-size:1rem;">Add a slide</h3>
      <form id="add-hero-slide-form">
        <div class="field"><label for="new-slide-url">Image URL</label><input id="new-slide-url" required placeholder="https://... or /images/your-photo.jpg"></div>
        <div class="field"><label for="new-slide-caption">Caption (optional)</label><input id="new-slide-caption" placeholder="e.g. New — Aura Glow Serum"></div>
        <button class="btn btn-primary" type="submit">Add slide</button>
      </form>
    </div>`;

  document.getElementById('add-hero-slide-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/hero-slides', {
        method: 'POST',
        body: JSON.stringify({
          imageUrl: document.getElementById('new-slide-url').value,
          caption: document.getElementById('new-slide-caption').value,
        }),
      });
      loadHeroSlides();
      toast('Slide added');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function heroSlideRow(s, i, total) {
  return `
    <div class="admin-card" style="padding:12px; display:flex; gap:14px; align-items:center; ${s.is_active ? '' : 'opacity:0.5;'}">
      <img src="${s.image_url}" style="width:56px; height:70px; object-fit:cover; border-radius:3px; flex-shrink:0;" onerror="this.style.opacity=0.3">
      <div style="flex:1; min-width:0;">
        <input value="${s.image_url.replace(/"/g, '&quot;')}" style="width:100%; background:transparent; border:1px solid transparent; color:var(--cream); padding:4px 6px; border-radius:3px; font-size:0.82rem;" onfocus="this.style.borderColor='var(--line-strong)'" onblur="this.style.borderColor='transparent'; saveHeroSlide(${s.id}, {imageUrl: this.value})">
        <input value="${s.caption.replace(/"/g, '&quot;')}" placeholder="Caption (optional)" style="width:100%; background:transparent; border:1px solid transparent; color:var(--cream-dim); padding:4px 6px; border-radius:3px; font-size:0.78rem; margin-top:2px;" onfocus="this.style.borderColor='var(--line-strong)'" onblur="this.style.borderColor='transparent'; saveHeroSlide(${s.id}, {caption: this.value})">
      </div>
      <button class="btn btn-outline" style="padding:5px 9px; font-size:0.75rem;" onclick="moveHeroSlide(${s.id}, 'up')" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn btn-outline" style="padding:5px 9px; font-size:0.75rem;" onclick="moveHeroSlide(${s.id}, 'down')" ${i === total - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn btn-outline" style="padding:5px 9px; font-size:0.75rem;" onclick="saveHeroSlide(${s.id}, {isActive: ${!s.is_active}})">${s.is_active ? 'Hide' : 'Show'}</button>
      <button class="btn btn-outline" style="padding:5px 9px; font-size:0.75rem;" onclick="deleteHeroSlide(${s.id})">✕</button>
    </div>`;
}

async function saveHeroSlide(id, changes) {
  try {
    await api(`/api/admin/hero-slides/${id}`, { method: 'PUT', body: JSON.stringify(changes) });
    loadHeroSlides();
  } catch (err) {
    toast(err.message, true);
    loadHeroSlides();
  }
}

async function moveHeroSlide(id, direction) {
  await api(`/api/admin/hero-slides/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) });
  loadHeroSlides();
}

async function deleteHeroSlide(id) {
  if (!confirm('Remove this slide from the homepage?')) return;
  await api(`/api/admin/hero-slides/${id}`, { method: 'DELETE' });
  loadHeroSlides();
}

// ---- Settings: change password ----
function loadSettings() {
  const el = document.getElementById('tab-settings');
  el.innerHTML = `
    <h2>Settings</h2>
    <h3>Change password</h3>
    <form id="admin-password-form" style="max-width:380px;">
      <div class="field password-field"><label for="admin-current-password">Current password</label><input id="admin-current-password" type="password" required></div>
      <div class="field password-field"><label for="admin-new-password">New password (min. 6 characters)</label><input id="admin-new-password" type="password" minlength="6" required></div>
      <div class="field password-field"><label for="admin-confirm-password">Confirm new password</label><input id="admin-confirm-password" type="password" minlength="6" required></div>
      <button class="btn btn-primary" type="submit">Update password</button>
    </form>

    <h3 style="margin-top:36px;">Trust-bar messages</h3>
    <p style="font-size:0.85rem; color:var(--cream-dim); max-width:520px;">
      These are the scrolling messages at the very top of the storefront (e.g. "24/7 customer support").
      Add, edit, reorder, or remove them any time — changes appear on the site immediately, no code or deploy needed.
    </p>
    <div id="announcements-list" class="admin-card" style="max-width:600px; padding:16px; margin-top:12px;">Loading…</div>
    <form id="add-announcement-form" style="display:flex; gap:10px; max-width:600px; margin-top:14px;">
      <input id="new-announcement-text" placeholder="e.g. Free gift on orders over GH₵300" required style="flex:1; background:var(--ink-raised); border:1px solid var(--line-strong); color:var(--cream); border-radius:3px; padding:12px 14px;">
      <button class="btn btn-primary" type="submit">Add</button>
    </form>`;
  setupPasswordToggles();
  document.getElementById('admin-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!passwordsMatch('admin-new-password', 'admin-confirm-password')) return;
    try {
      await api('/api/admin/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: document.getElementById('admin-current-password').value,
          newPassword: document.getElementById('admin-new-password').value,
        }),
      });
      toast('Password updated');
      e.target.reset();
    } catch (err) {
      toast(err.message, true);
    }
  });

  loadAnnouncements();
  document.getElementById('add-announcement-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('new-announcement-text');
    try {
      await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ text: input.value }) });
      input.value = '';
      loadAnnouncements();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function loadAnnouncements() {
  const el = document.getElementById('announcements-list');
  const messages = await api('/api/admin/announcements');
  if (messages.length === 0) {
    el.innerHTML = '<p style="color:var(--cream-dim); font-size:0.85rem;">No messages yet — add one below.</p>';
    return;
  }
  el.innerHTML = messages.map((m, i) => `
    <div style="display:flex; align-items:center; gap:10px; padding:8px 4px; ${i > 0 ? 'border-top:1px solid var(--line);' : ''}">
      <input value="${m.text.replace(/"/g, '&quot;')}" data-id="${m.id}" class="announcement-text-input" style="flex:1; background:transparent; border:1px solid transparent; color:var(--cream); padding:6px 8px; border-radius:3px;" onfocus="this.style.borderColor='var(--line-strong)'" onblur="this.style.borderColor='transparent'; saveAnnouncementText(${m.id}, this.value)">
      <button class="btn btn-outline" style="padding:5px 9px; font-size:0.75rem;" onclick="moveAnnouncement(${m.id}, 'up')" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn btn-outline" style="padding:5px 9px; font-size:0.75rem;" onclick="moveAnnouncement(${m.id}, 'down')" ${i === messages.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn btn-outline" style="padding:5px 9px; font-size:0.75rem;" onclick="deleteAnnouncement(${m.id})">✕</button>
    </div>`).join('');
}

async function saveAnnouncementText(id, text) {
  try {
    await api(`/api/admin/announcements/${id}`, { method: 'PUT', body: JSON.stringify({ text }) });
  } catch (err) {
    toast(err.message, true);
    loadAnnouncements();
  }
}

async function moveAnnouncement(id, direction) {
  await api(`/api/admin/announcements/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) });
  loadAnnouncements();
}

async function deleteAnnouncement(id) {
  await api(`/api/admin/announcements/${id}`, { method: 'DELETE' });
  loadAnnouncements();
}

checkSetupThenAuth();
