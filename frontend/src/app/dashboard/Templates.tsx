import React, { useState, useMemo, useCallback } from 'react';
import { Plus, Search, AlertCircle, X } from 'lucide-react';
import {
  getAllTemplates,
  createTemplate,
  updateTemplate,
  deactivateTemplate,
  recordTemplateUsage,
  TEMPLATE_CATEGORIES,
  type ProposalTemplate,
  type TemplateCategory,
} from '../../utils/templates';
import { useVaultContract } from '../../hooks/useVaultContract';
import { useToast } from '../../context/ToastContext';

// Role constants: 0=Member, 1=Treasurer, 2=Admin
const ROLE_ADMIN = 2;
const ROLE_TREASURER = 1;

interface CreateFormState {
  name: string;
  category: TemplateCategory;
  description: string;
  recipient: string;
  token: string;
  amount: string;
  memo: string;
  minAmount: string;
  maxAmount: string;
}

const EMPTY_FORM: CreateFormState = {
  name: '', category: 'Custom', description: '',
  recipient: '', token: '', amount: '', memo: '',
  minAmount: '', maxAmount: '',
};

interface UseFormState {
  recipient: string;
  amount: string;
  memo: string;
}

// ── Version badge ──────────────────────────────────────────────────────────
const VersionBadge: React.FC<{ version: number }> = ({ version }) => (
  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-700 text-gray-400 border border-gray-600">
    v{version}
  </span>
);

// ── Use Template modal ─────────────────────────────────────────────────────
const UseModal: React.FC<{
  template: ProposalTemplate;
  onClose: () => void;
  onSubmit: (overrides: UseFormState) => void;
}> = ({ template, onClose, onSubmit }) => {
  const [form, setForm] = useState<UseFormState>({
    recipient: template.recipient.includes('{{') ? '' : template.recipient,
    amount: template.amount.includes('{{') ? '' : template.amount,
    memo: template.memo.includes('{{') ? '' : template.memo,
  });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) {
      setError('Amount must be a positive number');
      return;
    }
    if (template.minAmount && amt < Number(template.minAmount)) {
      setError(`Amount must be at least ${template.minAmount} stroops`);
      return;
    }
    if (template.maxAmount && amt > Number(template.maxAmount)) {
      setError(`Amount must be at most ${template.maxAmount} stroops`);
      return;
    }
    onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Use: {template.name}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Recipient</label>
            <input
              value={form.recipient}
              onChange={(e) => setForm((p) => ({ ...p, recipient: e.target.value }))}
              placeholder={template.recipient}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Amount (stroops)
              {(template.minAmount || template.maxAmount) && (
                <span className="ml-2 text-gray-500">
                  {template.minAmount && `min: ${template.minAmount}`}
                  {template.minAmount && template.maxAmount && ' · '}
                  {template.maxAmount && `max: ${template.maxAmount}`}
                </span>
              )}
            </label>
            <input
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              placeholder={template.amount}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Memo</label>
            <input
              value={form.memo}
              onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
              placeholder={template.memo}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">Cancel</button>
            <button type="submit" className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium">Create Proposal</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────────────────────
const Templates: React.FC = () => {
  const { notify } = useToast();
  const { proposeTransfer, getUserRole } = useVaultContract();

  const [templates, setTemplates] = useState<ProposalTemplate[]>(() => getAllTemplates());
  const [search, setSearch] = useState('');
  const [userRole, setUserRole] = useState<number>(0);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [useTarget, setUseTarget] = useState<ProposalTemplate | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ProposalTemplate | null>(null);

  // Load role once
  React.useEffect(() => {
    getUserRole().then((r) => { setUserRole(r); setRoleLoaded(true); }).catch(() => setRoleLoaded(true));
  }, [getUserRole]);

  const refresh = useCallback(() => setTemplates(getAllTemplates()), []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return templates.filter((t) =>
      !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }, [templates, search]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      createTemplate(
        form.name, form.category, form.description,
        form.recipient, form.amount, form.token, form.memo,
        form.minAmount || undefined, form.maxAmount || undefined,
      );
      refresh();
      setForm(EMPTY_FORM);
      setShowCreate(false);
      notify('config_updated', 'Template created', 'success');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create template');
    }
  };

  const handleDeactivate = useCallback(() => {
    if (!deactivateTarget) return;
    try {
      deactivateTemplate(deactivateTarget.id);
      refresh();
      notify('config_updated', 'Template deactivated', 'success');
    } catch (err) {
      notify('config_updated', err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setDeactivateTarget(null);
    }
  }, [deactivateTarget, refresh, notify]);

  const handleUse = useCallback(async (overrides: UseFormState) => {
    if (!useTarget) return;
    try {
      recordTemplateUsage(useTarget.id);
      const recipient = overrides.recipient || useTarget.recipient;
      const token = useTarget.token || 'native';
      await proposeTransfer(recipient, token, overrides.amount, overrides.memo || useTarget.memo);
      refresh();
      setUseTarget(null);
      notify('new_proposal', 'Proposal created from template', 'success');
    } catch (err) {
      notify('config_updated', err instanceof Error ? err.message : 'Failed to create proposal', 'error');
    }
  }, [useTarget, proposeTransfer, refresh, notify]);

  const isAdmin = roleLoaded && userRole >= ROLE_ADMIN;
  const canUse = roleLoaded && userRole >= ROLE_TREASURER;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Templates</h1>
          <p className="text-gray-400 mt-1">Reusable proposal templates</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates…"
              className="pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 w-48"
            />
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create
            </button>
          )}
        </div>
      </div>

      {/* Create form (admin only) */}
      {showCreate && isAdmin && (
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-5">
          <h3 className="text-base font-semibold text-white mb-4">New Template</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name *" className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500" />
              <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as TemplateCategory }))} className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500">
                {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={form.recipient} onChange={(e) => setForm((p) => ({ ...p, recipient: e.target.value }))} placeholder="Recipient * (or {{variable}})" className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500" />
              <input value={form.token} onChange={(e) => setForm((p) => ({ ...p, token: e.target.value }))} placeholder="Token address *" className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500" />
              <input value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} placeholder="Amount * (stroops or {{variable}})" className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500" />
              <input value={form.memo} onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))} placeholder="Memo *" className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500" />
              <input value={form.minAmount} onChange={(e) => setForm((p) => ({ ...p, minAmount: e.target.value }))} placeholder="Min amount (optional)" className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500" />
              <input value={form.maxAmount} onChange={(e) => setForm((p) => ({ ...p, maxAmount: e.target.value }))} placeholder="Max amount (optional)" className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500" />
            </div>
            <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Description" rows={2} className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500 resize-none" />
            {formError && <p className="text-red-400 text-sm flex items-center gap-1"><AlertCircle className="w-4 h-4" />{formError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); setFormError(null); }} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium">Save Template</button>
            </div>
          </form>
        </div>
      )}

      {/* Template list */}
      {filtered.length === 0 ? (
        <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-12 text-center">
          <p className="text-gray-400 font-medium">No templates found</p>
          <p className="text-gray-500 text-sm mt-1">{search ? 'Try a different search term.' : 'Create your first template above.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <div
              key={t.id}
              className={`bg-gray-800/60 border rounded-xl p-4 flex flex-col gap-3 transition-all ${
                !t.isActive ? 'border-gray-700/40 opacity-60' : 'border-gray-700 hover:border-purple-500/40'
              }`}
            >
              {/* Card header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className={`font-semibold text-white text-sm ${!t.isActive ? 'line-through text-gray-500' : ''}`}>
                      {t.name}
                    </h3>
                    <VersionBadge version={t.version ?? 1} />
                    {!t.isActive && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30">Inactive</span>
                    )}
                  </div>
                  <span className="text-xs text-purple-400">{t.category}</span>
                </div>
              </div>

              <p className="text-xs text-gray-400 line-clamp-2">{t.description}</p>

              {/* Details */}
              <div className="space-y-1 text-xs text-gray-500">
                <div className="flex gap-1"><span className="text-gray-600">Recipient:</span><span className="text-gray-400 truncate">{t.recipient}</span></div>
                <div className="flex gap-1"><span className="text-gray-600">Amount:</span><span className="text-gray-400">{t.amount}</span></div>
                {(t.minAmount || t.maxAmount) && (
                  <div className="flex gap-1">
                    <span className="text-gray-600">Bounds:</span>
                    <span className="text-gray-400">{t.minAmount || '—'} – {t.maxAmount || '—'}</span>
                  </div>
                )}
                <div className="flex gap-1"><span className="text-gray-600">Used:</span><span className="text-gray-400">{t.usageCount}×</span></div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-auto pt-2 border-t border-gray-700/50">
                {canUse && t.isActive && (
                  <button
                    onClick={() => setUseTarget(t)}
                    className="flex-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    Use Template
                  </button>
                )}
                {isAdmin && !t.isDefault && t.isActive && (
                  <button
                    onClick={() => setDeactivateTarget(t)}
                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-colors"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Use modal */}
      {useTarget && (
        <UseModal
          template={useTarget}
          onClose={() => setUseTarget(null)}
          onSubmit={handleUse}
        />
      )}

      {/* Deactivate confirmation */}
      {deactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Deactivate Template?</h3>
            <p className="text-gray-400 text-sm">
              <span className="font-medium text-white">{deactivateTarget.name}</span> will be marked inactive and cannot be used to create proposals.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeactivateTarget(null)} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">Cancel</button>
              <button onClick={handleDeactivate} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium">Deactivate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Templates;
