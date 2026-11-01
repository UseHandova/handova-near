/**
 * SavedSearches — tenants save a search (area + type + budget) and get alerted
 * when a new matching listing goes live. Persisted to localStorage.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Bell, X, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { useLang } from '@/lib/LangContext';
import { LAGOS_AREAS, PROPERTY_TYPES, type PropertyType } from '@/lib/i18n';
import { toast } from 'sonner';

export interface SavedSearch {
  id: string;
  area: string;
  propertyType: PropertyType | 'all';
  maxRentUsdc: number;
  label: string;
  createdAt: number;
  matches: number;
}

const STORAGE_KEY = 'rentflow_saved_searches';

function load(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedSearch[];
  } catch { /* ignore */ }
  return [
    { id: 's1', area: 'Yaba', propertyType: 'two_bed', maxRentUsdc: 150, label: '2-Bed in Yaba under ₦240k/mo', createdAt: Date.now() - 86400000, matches: 2 },
    { id: 's2', area: 'Lekki Phase 1', propertyType: 'all', maxRentUsdc: 200, label: 'Any property in Lekki under ₦320k/mo', createdAt: Date.now() - 172800000, matches: 0 },
  ];
}

function save(searches: SavedSearch[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(searches)); } catch { /* ignore */ }
}

interface Props { onClose: () => void; }

export default function SavedSearches({ onClose }: Props) {
  const { t } = useLang();
  const [searches, setSearches] = useState<SavedSearch[]>(load);
  const [showForm, setShowForm] = useState(false);
  const [area, setArea] = useState('Yaba');
  const [customArea, setCustomArea] = useState('');
  const [propertyType, setPropertyType] = useState<PropertyType | 'all'>('all');
  const [maxRent, setMaxRent] = useState('200');
  const [areaSearch, setAreaSearch] = useState('');

  useEffect(() => { save(searches); }, [searches]);

  function addSearch() {
    const finalArea = customArea.trim() || area;
    const label = `${propertyType === 'all' ? 'Any type' : propertyType.replace(/_/g, ' ')} in ${finalArea}`;
    const ns: SavedSearch = {
      id: `s${Date.now()}`,
      area: finalArea,
      propertyType,
      maxRentUsdc: parseFloat(maxRent) || 200,
      label,
      createdAt: Date.now(),
      matches: 0,
    };
    setSearches(prev => [ns, ...prev]);
    setShowForm(false);
    setCustomArea(''); setAreaSearch('');
    toast.success(t('search_saved'));
  }

  function deleteSearch(id: string) {
    setSearches(prev => prev.filter(s => s.id !== id));
  }

  const popularAreas = ['Yaba', 'Lekki Phase 1', 'Victoria Island (VI)', 'Ikeja', 'Ikorodu', 'Surulere'];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{
          background: 'var(--glass-card)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid var(--glass-border)', boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          maxHeight: '90dvh', overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Bell className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} />
            <span className="font-bold" style={{ color: 'var(--ink)' }}>{t('saved_searches')}</span>
          </div>
          <div className="flex items-center gap-2">
            <motion.button whileTap={{ scale: 0.92 }} onClick={() => setShowForm(f => !f)}
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: showForm ? 'var(--accent)' : 'var(--surface-strong)', border: '1px solid var(--border)' }}>
              <Plus className="w-4 h-4" style={{ color: showForm ? 'white' : 'var(--ink)' }} />
            </motion.button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-strong)' }}>
              <X className="w-4 h-4" style={{ color: 'var(--ink)' }} />
            </button>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Add form */}
          <AnimatePresence>
            {showForm && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden space-y-3 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>New Saved Search</p>

                {/* Area */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>Area</label>
                  <div className="flex gap-2 flex-wrap mb-2">
                    {popularAreas.map(a => (
                      <button key={a} onClick={() => { setArea(a); setCustomArea(''); }}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold"
                        style={area === a && !customArea ? { background: 'var(--accent)', color: 'white' } : { background: 'var(--surface-strong)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                        {a}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--subtle)' }} />
                    <input value={areaSearch} onChange={e => setAreaSearch(e.target.value)}
                      placeholder="Search any area…" className="w-full pl-9 pr-4 py-2.5 rounded-2xl text-sm outline-none"
                      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                  </div>
                  {areaSearch.trim().length > 1 && (
                    <div className="mt-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                      {LAGOS_AREAS.filter(a => a.toLowerCase().includes(areaSearch.toLowerCase())).slice(0, 4).map(a => (
                        <button key={a} onClick={() => { setCustomArea(a); setArea(a); setAreaSearch(''); }}
                          className="w-full text-left px-4 py-2 text-sm" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--border)' }}>
                          {a}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Type */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>Property Type</label>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setPropertyType('all')}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold"
                      style={propertyType === 'all' ? { background: 'var(--accent)', color: 'white' } : { background: 'var(--surface-strong)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                      Any
                    </button>
                    {PROPERTY_TYPES.slice(0, 5).map(pt => (
                      <button key={pt} onClick={() => setPropertyType(pt)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold"
                        style={propertyType === pt ? { background: 'var(--accent)', color: 'white' } : { background: 'var(--surface-strong)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                        {t(pt)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Max rent */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>Max Rent (USDC/yr)</label>
                  <input value={maxRent} onChange={e => setMaxRent(e.target.value)} inputMode="numeric"
                    className="w-full px-4 py-2.5 rounded-2xl text-sm outline-none"
                    style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                </div>

                <motion.button whileTap={{ scale: 0.97 }} onClick={addSearch}
                  className="w-full py-3 rounded-2xl font-semibold text-white text-sm flex items-center justify-center gap-2"
                  style={{ background: 'var(--accent)' }}>
                  <Bell className="w-4 h-4" /> {t('save_search')}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Saved searches list */}
          {searches.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-3 text-center">
              <Search className="w-10 h-10" style={{ color: 'var(--subtle)' }} />
              <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('no_saved_searches')}</p>
              <p className="text-xs" style={{ color: 'var(--subtle)' }}>Tap + to save a search and get notified when a match goes live.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {searches.map(s => (
                <motion.div key={s.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-2xl"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-soft)' }}>
                    <Bell className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--ink)' }}>{s.label}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {s.matches > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
                          {s.matches} {t('match_found')}
                        </span>
                      )}
                      <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>
                        {s.area} · max ${s.maxRentUsdc} USDC
                      </span>
                    </div>
                  </div>
                  <motion.button whileTap={{ scale: 0.88 }} onClick={() => deleteSearch(s.id)}
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(186,43,76,0.08)' }}>
                    <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--danger)' }} />
                  </motion.button>
                </motion.div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl text-xs" style={{ background: 'var(--accent-soft)' }}>
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span style={{ color: 'var(--accent)' }}>In-app alerts fire instantly. Email/WhatsApp alerts coming soon.</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
