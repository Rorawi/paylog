import { getSupabaseClient, getSupabaseUserId } from './supabaseClient.js';

const STORAGE_KEY = 'paylog.data.v1';
const MIGRATION_KEY = 'paylog.supabase-migration.v1';
const DATA_TABLE = 'paylog_data';

const emptyState = () => ({
  version: 1,
  agreements: [],
  payments: [],
  earnings: [],
  maintenanceRecords: [],
  expenses: [],
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
  };
}

export const repository = {
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
        const hasLegacyRecords = ['agreements', 'payments', 'earnings', 'expenses'].some((key) => legacy[key].length > 0);
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
      ['record_type', 'date', 'amount', 'agreement', 'payee', 'item', 'total_earned', 'owner_set_aside', 'fuel_set_aside', 'maintenance_set_aside', 'kept', 'category', 'note', 'id', 'linked_id'],
    ];
    for (const agreement of data.agreements) {
      rows.push(['agreement', agreement.startDate, agreement.totalPrice, agreement.id, agreement.payee, agreement.item, '', '', '', '', '', '', `Installment ${agreement.paymentAmount} ${agreement.frequency}; usual payment day ${agreement.paymentDay ?? ''}; daily income ${agreement.dailyIncome ?? ''}; days worked ${agreement.daysWorkedPerWeek ?? ''}; weekly fuel ${agreement.weeklyFuelAmount ?? 0}; weekly maintenance ${agreement.weeklyMaintenanceAmount ?? ''}`, agreement.id, '']);
    }
    for (const payment of data.payments) {
      const agreement = data.agreements.find((item) => item.id === payment.agreementId);
      rows.push([payment.type === 'opening' ? 'previous_payments' : 'payment', payment.date, payment.amount, agreement?.item ?? '', agreement?.payee ?? '', agreement?.item ?? '', '', '', '', '', '', '', payment.note ?? '', payment.id, payment.earningId ?? '']);
    }
    for (const earning of data.earnings) {
      const agreement = data.agreements.find((item) => item.id === earning.agreementId);
      rows.push(['earning', earning.date, earning.totalAmount, agreement?.item ?? '', agreement?.payee ?? '', agreement?.item ?? '', earning.totalAmount, earning.paymentAmount, earning.fuelAmount ?? 0, earning.maintenanceAmount ?? 0, earning.keptAmount, '', earning.note ?? '', earning.id, earning.paymentId ?? '']);
    }
    for (const expense of data.expenses) {
      const agreement = data.agreements.find((item) => item.id === expense.agreementId);
      rows.push(['expense', expense.date, expense.amount, agreement?.item ?? '', agreement?.payee ?? '', agreement?.item ?? '', '', '', '', '', '', expense.category, expense.note ?? '', expense.id, expense.agreementId ?? '']);
    }
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return rows.map((row) => row.map(escape).join(',')).join('\r\n');
  },
};

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `pl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
