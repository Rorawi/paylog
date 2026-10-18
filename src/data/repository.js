import { getSupabaseClient, getSupabaseUserId } from './supabaseClient.js';

const STORAGE_KEY = 'paylog.data.v1';
const MIGRATION_KEY = 'paylog.supabase-migration.v1';
const DATA_TABLE = 'paylog_data';
const RECEIPT_BUCKET = 'payment-receipts';
export const PAYMENT_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const PAYMENT_RECEIPT_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,.gif,.bmp,image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/gif,image/bmp';

const receiptTypes = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};
const receiptExtensions = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

export function paymentReceiptFileError(file) {
  if (!file) return '';
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const mimeType = String(file.type || '').toLowerCase();
  if (!receiptTypes[mimeType] && !receiptExtensions[extension]) return 'Choose a JPG, PNG, WebP, HEIC, AVIF, GIF or BMP image.';
  if (file.size > PAYMENT_RECEIPT_MAX_BYTES) return 'The image must be 10 MB or smaller.';
  return '';
}

function receiptContentType(file) {
  const mimeType = String(file.type || '').toLowerCase();
  if (receiptTypes[mimeType]) return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  return receiptExtensions[extension];
}

async function assertOwnedReceiptPath(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('The receipt image path is missing.');
  const userId = await getSupabaseUserId();
  if (path.split('/')[0] !== userId) throw new Error('This receipt belongs to another Paylog session.');
  return userId;
}

const emptyState = () => ({
  version: 1,
  agreements: [],
  payments: [],
  earnings: [],
  maintenanceRecords: [],
  expenses: [],
  heldTransfers: [],
  ownerAllocations: [],
});

function normalizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('This backup file does not contain Paylog data.');
  }
  return {
    version: 1,
    agreements: Array.isArray(input.agreements) ? input.agreements : [],
    payments: Array.isArray(input.payments) ? input.payments : [],
    earnings: Array.isArray(input.earnings) ? input.earnings : [],
    maintenanceRecords: Array.isArray(input.maintenanceRecords) ? input.maintenanceRecords : [],
    expenses: Array.isArray(input.expenses) ? input.expenses : [],
    heldTransfers: Array.isArray(input.heldTransfers) ? input.heldTransfers : [],
    ownerAllocations: Array.isArray(input.ownerAllocations) ? input.ownerAllocations : [],
  };
}

export const repository = {
  async uploadPaymentReceipt(paymentId, file) {
    const validationError = paymentReceiptFileError(file);
    if (validationError) throw new Error(validationError);
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId();
    const extension = receiptTypes[String(file.type || '').toLowerCase()] || String(file.name || '').split('.').pop().toLowerCase();
    const path = `${userId}/${paymentId}/${makeId()}.${extension}`;
    const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: receiptContentType(file),
      upsert: false,
    });
    if (error) throw new Error(`Could not upload receipt image: ${error.message}`);
    return path;
  },

  async getPaymentReceiptUrl(path) {
    await assertOwnedReceiptPath(path);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 60 * 10);
    if (error) throw new Error(`Could not open receipt image: ${error.message}`);
    if (!data?.signedUrl) throw new Error('Supabase did not return a receipt image link.');
    return data.signedUrl;
  },

  async deletePaymentReceipt(path) {
    await assertOwnedReceiptPath(path);
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
    if (error) throw new Error(`Could not remove receipt image: ${error.message}`);
  },

  async load() {
    const supabase = getSupabaseClient();
    const userId = await getSupabaseUserId();
    const { data: record, error } = await supabase
      .from(DATA_TABLE)
      .select('payload')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`Could not load Paylog data from Supabase: ${error.message}`);

    if (record?.payload) {
      window.localStorage.setItem(MIGRATION_KEY, 'complete');
      return normalizeState(record.payload);
    }

    if (!window.localStorage.getItem(MIGRATION_KEY)) {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const legacy = raw ? normalizeState(JSON.parse(raw)) : emptyState();
        const hasLegacyRecords = ['agreements', 'payments', 'earnings', 'expenses', 'heldTransfers', 'ownerAllocations'].some((key) => legacy[key].length > 0);
        if (hasLegacyRecords) {
          const saved = await this.save(legacy, userId);
          window.localStorage.setItem(MIGRATION_KEY, 'complete');
          return saved;
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      window.localStorage.setItem(MIGRATION_KEY, 'complete');
    }
    return emptyState();
  },

  async save(data, knownUserId) {
    const supabase = getSupabaseClient();
    const userId = knownUserId || await getSupabaseUserId();
    const payload = normalizeState(data);
    const { data: saved, error } = await supabase
      .from(DATA_TABLE)
      .upsert({ user_id: userId, payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select('payload')
      .single();
    if (error) throw new Error(`Could not save Paylog data to Supabase: ${error.message}`);
    return normalizeState(saved.payload);
  },

  parseBackup(text) {
    return normalizeState(JSON.parse(text));
  },

  backupJson(data) {
    return JSON.stringify(normalizeState(data), null, 2);
  },

  exportCsv(data) {
    const rows = [
      ['record_type', 'date', 'amount', 'vehicle', 'vehicle_owner', 'vehicle_registration', 'total_earned', 'owner_set_aside', 'fuel_set_aside', 'maintenance_set_aside', 'kept', 'category', 'note', 'id', 'linked_id'],
    ];
    for (const agreement of data.agreements) {
      rows.push(['agreement', agreement.startDate, agreement.totalPrice, agreement.id, agreement.payee, agreement.vehicleRegistrationNumber ?? '', '', '', '', '', '', '', `Installment ${agreement.paymentAmount} ${agreement.frequency}; usual payment day ${agreement.paymentDay ?? ''}; daily income ${agreement.dailyIncome ?? ''}; days worked ${agreement.daysWorkedPerWeek ?? ''}; weekly fuel ${agreement.weeklyFuelAmount ?? 0}; weekly maintenance ${agreement.weeklyMaintenanceAmount ?? ''}`, agreement.id, '']);
    }
    for (const payment of data.payments) {
      const agreement = data.agreements.find((item) => item.id === payment.agreementId);
      rows.push([payment.type === 'opening' ? 'previous_payments' : 'payment', payment.date, payment.amount, agreement?.item ?? '', agreement?.payee ?? '', agreement?.vehicleRegistrationNumber ?? '', '', '', '', '', '', '', payment.note ?? '', payment.id, payment.earningId ?? '']);
    }
    for (const earning of data.earnings) {
      const agreement = data.agreements.find((item) => item.id === earning.agreementId);
      rows.push(['earning', earning.date, earning.totalAmount, agreement?.item ?? '', agreement?.payee ?? '', agreement?.vehicleRegistrationNumber ?? '', earning.totalAmount, earning.paymentAmount, earning.fuelAmount ?? 0, earning.maintenanceAmount ?? 0, earning.keptAmount, '', earning.note ?? '', earning.id, earning.paymentId ?? '']);
    }
    for (const expense of data.expenses) {
      const agreement = data.agreements.find((item) => item.id === expense.agreementId);
      rows.push(['expense', expense.date, expense.amount, agreement?.item ?? '', agreement?.payee ?? '', agreement?.vehicleRegistrationNumber ?? '', '', '', '', '', '', expense.category, expense.note ?? '', expense.id, expense.agreementId ?? '']);
    }
    for (const transfer of data.heldTransfers) {
      rows.push([transfer.type === 'given' ? 'money_held' : 'money_returned', transfer.date, transfer.amount, '', transfer.holderName ?? '', '', '', '', '', '', '', '', transfer.note ?? '', transfer.id, transfer.holderId ?? '']);
    }
    for (const allocation of data.ownerAllocations) {
      rows.push([allocation.type === 'set_aside' ? 'owner_money_set_aside' : 'owner_money_released', allocation.date, allocation.amount, '', allocation.holderName ?? '', '', '', '', '', '', '', '', '', allocation.id, allocation.holderId ?? '']);
    }
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return rows.map((row) => row.map(escape).join(',')).join('\r\n');
  },
};

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `pl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
