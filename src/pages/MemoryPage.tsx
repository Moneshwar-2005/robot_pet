import React, { useState } from 'react';
import { sampleMemoryItems } from '../data/mockData';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { Brain, Search, Plus, Trash2, Filter } from 'lucide-react';

export const MemoryPage: React.FC = () => {
  const [memories, setMemories] = useState(sampleMemoryItems);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [newFact, setNewFact] = useState('');
  const [newCategory, setNewCategory] = useState('Work Routine');
  const [showAdd, setShowAdd] = useState(false);

  const filteredMemories = memories.filter((m) => {
    const matchesCategory = selectedCategory === 'all' || m.category === selectedCategory;
    const matchesSearch = m.fact.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          m.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleAddMemory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFact.trim()) return;

    setMemories([
      {
        id: `mem-${Date.now()}`,
        category: newCategory,
        fact: newFact.trim(),
        confidence: '100%',
        source: 'User Manual Entry',
        lastUpdated: 'Just now',
      },
      ...memories,
    ]);

    setNewFact('');
    setShowAdd(false);
  };

  const handleDeleteMemory = (id: string) => {
    setMemories(memories.filter((m) => m.id !== id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 1: Local Context Store"
        title="Long-Term AI Memory &amp; Knowledge Graph"
        description="Inspect and curate the facts, habits, and preferences Kuro uses to personalize interactions. Vector embeddings and semantic recall via local LLM will be integrated in Phase 2."
      />

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
          onSubmit={handleAddMemory}
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredMemories.map((mem) => (
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
                    Confidence: {mem.confidence} • Source: {mem.source}
                  </span>
                </div>
                <div style={{ fontSize: '13.5px', color: 'var(--text-primary)', marginTop: '2px' }}>
                  {mem.fact}
                </div>
              </div>

              <button
                type="button"
                className="reminder-action-btn"
                style={{ marginLeft: '12px' }}
                onClick={() => handleDeleteMemory(mem.id)}
                title="Remove from memory"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
