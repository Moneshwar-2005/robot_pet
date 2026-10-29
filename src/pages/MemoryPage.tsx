import React, { useState } from 'react';
import type { ClientMemory } from '../lib/adapters';
import { formatConfidence } from '../lib/formatters';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { Brain, Search, Plus, Trash2, Filter, AlertCircle, RefreshCw, Loader2, Pencil, Check, X } from 'lucide-react';

interface MemoryPageProps {
  memories: ClientMemory[];
  loading?: boolean;
  error?: string | null;
  onAddMemory: (data: { category: string; fact: string; confidence?: number; source?: string }) => Promise<boolean>;
  onEditMemory?: (id: string, updates: { category?: string; fact?: string; confidence?: number }) => Promise<boolean>;
  onDeleteMemory: (id: string) => Promise<boolean>;
  onRetry?: () => void;
}

export const MemoryPage: React.FC<MemoryPageProps> = ({
  memories,
  loading = false,
  error = null,
  onAddMemory,
  onEditMemory,
  onDeleteMemory,
  onRetry,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [newFact, setNewFact] = useState('');
  const [newCategory, setNewCategory] = useState('Work Routine');
  const [showAdd, setShowAdd] = useState(false);

  // Editing state for an individual memory
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memoryToDelete, setMemoryToDelete] = useState<ClientMemory | null>(null);
  const [editFact, setEditFact] = useState('');
  const [editCategory, setEditCategory] = useState('');

  const filteredMemories = memories.filter((m) => {
    const matchesCategory = selectedCategory === 'all' || m.category === selectedCategory;
    const matchesSearch =
      m.fact.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleCreateMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFact.trim()) return;

    const ok = await onAddMemory({
      category: newCategory,
      fact: newFact.trim(),
      confidence: 1.0,
      source: 'User Manual Entry',
    });

    if (ok) {
      setNewFact('');
      setShowAdd(false);
    }
  };

  const handleStartEdit = (mem: ClientMemory) => {
    setEditingId(mem.id);
    setEditFact(mem.fact);
    setEditCategory(mem.category);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditFact('');
    setEditCategory('');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editFact.trim() || !onEditMemory) return;
    const ok = await onEditMemory(id, {
      fact: editFact.trim(),
      category: editCategory.trim(),
    });
    if (ok) {
      setEditingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 2: Persistent AI Memory"
        title="Long-Term AI Memory &amp; Knowledge Graph"
        description="Inspect and curate the facts, habits, and preferences Kuro uses to personalize interactions. Authenticated records are stored in your database; local demo mode is active when signed out."
      />

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--status-red)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} style={{ color: 'var(--status-red)', flexShrink: 0 }} />
            <span style={{ fontSize: '13px' }}>{error}</span>
          </div>
          {onRetry && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRetry}
              style={{ padding: '4px 10px', fontSize: '12px' }}
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      {/* Action Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, maxWidth: '400px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search companion memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 32px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '13px',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Filter size={12} /> Category:
          </span>
          {['all', 'Work Routine', 'Pet Preference', 'Health Habit', 'Key Project'].map((cat) => (
            <button
              key={cat}
              type="button"
              className={`expression-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAdd(!showAdd)}
        >
          <Plus size={15} />
          <span>Add Fact</span>
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={handleCreateMemory}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '16px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--accent-border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <input
            type="text"
            placeholder="Fact or preference to remember (e.g. Needs coffee before 10 AM)..."
            value={newFact}
            onChange={(e) => setNewFact(e.target.value)}
            autoFocus
            style={{
              padding: '8px 12px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
            }}
          />
          <div style={{ display: 'flex', gap: '10px' }}>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              style={{
                padding: '8px 12px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="Work Routine">Work Routine</option>
              <option value="Pet Preference">Pet Preference</option>
              <option value="Health Habit">Health Habit</option>
              <option value="Key Project">Key Project</option>
            </select>
            <button type="submit" className="btn btn-primary" disabled={!newFact.trim()}>
              Save Memory
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Memory Items List */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Brain className="card-icon" />
            <h3 className="card-title">Retained Context &amp; Preferences</h3>
          </div>
          <span className="badge badge-neutral">{filteredMemories.length} memories loaded</span>
        </div>

        {loading ? (
          <div className="empty-state">
            <Loader2 className="empty-state-icon" style={{ animation: 'spin 1s linear infinite' }} />
            <div className="empty-state-title">Loading companion memories...</div>
            <p className="empty-state-desc">Fetching personalized facts from your database.</p>
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="empty-state">
            <Brain className="empty-state-icon" />
            <div className="empty-state-title">No companion memories found</div>
            <p className="empty-state-desc">Click "Add Fact" above to store personalized habits, rules, and preferences.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredMemories.map((mem) => {
              const isEditing = editingId === mem.id;

              return (
                <div
                  key={mem.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-card-subtle)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="badge badge-phase">{mem.category}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Confidence: {formatConfidence(mem.confidence)} • Source: {mem.source}
                      </span>
                    </div>

                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                        <input
                          type="text"
                          value={editFact}
                          onChange={(e) => setEditFact(e.target.value)}
                          autoFocus
                          style={{
                            padding: '6px 10px',
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border-strong)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--text-primary)',
                            fontSize: '13px',
                          }}
                        />
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            type="text"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            placeholder="Category..."
                            style={{
                              padding: '4px 8px',
                              background: 'var(--bg-input)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--text-primary)',
                              fontSize: '12px',
                              width: '160px',
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => handleSaveEdit(mem.id)}
                            disabled={!editFact.trim()}
                          >
                            <Check size={12} /> Save
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={handleCancelEdit}
                          >
                            <X size={12} /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '13.5px', color: 'var(--text-primary)', marginTop: '2px' }}>
                        {mem.fact}
                      </div>
                    )}
                  </div>

                  {!isEditing && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px' }}>
                      {onEditMemory && (
                        <button
                          type="button"
                          className="reminder-action-btn"
                          onClick={() => handleStartEdit(mem)}
                          title="Edit fact"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="reminder-action-btn"
                        onClick={() => setMemoryToDelete(mem)}
                        title="Remove from memory"
                        style={{ color: 'var(--status-red)' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Memory Confirmation Modal */}
      {memoryToDelete && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px',
          }}
          onClick={() => setMemoryToDelete(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              maxWidth: '420px',
              width: '100%',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '12px',
                color: 'var(--status-red)',
              }}
            >
              <AlertCircle size={20} />
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Remove Memory?</h4>
            </div>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                marginBottom: '16px',
                lineHeight: 1.5,
              }}
            >
              Are you sure you want to remove this fact from Kuro's memory:{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{memoryToDelete.fact}"</strong>? This action cannot be
              undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setMemoryToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                style={{ backgroundColor: 'var(--status-red)', color: '#fff' }}
                onClick={async () => {
                  await onDeleteMemory(memoryToDelete.id);
                  setMemoryToDelete(null);
                }}
              >
                Remove Fact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
