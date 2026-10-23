import React, { useState } from 'react';
import { PlannedFeatureNotice } from '../components/common/PlannedFeatureNotice';
import { Bot, Send, User, Sparkles, Mic } from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  isSimulated?: boolean;
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'm-1',
    sender: 'assistant',
    text: "Hello Alex! I am Kuro, your Smart Robot Pet & Personal Productivity Assistant. Right now you are running Phase 1 of our project (Web UI Shell). When Phase 2 launches, I'll connect to our multi-modal AI backend to organize your calendar, track your tasks, and emote through my physical OLED face!",
    timestamp: '9:00 AM',
  },
  {
    id: 'm-2',
    sender: 'user',
    text: 'What are my top priorities for this afternoon?',
    timestamp: '1:15 PM',
  },
  {
    id: 'm-3',
    sender: 'assistant',
    text: "You have 3 priority items: (1) Review the ESP32 microcontroller firmware architecture at 5:00 PM, (2) Finalize morning routine reminders at 6:30 PM, and (3) Stretch and drink water in 20 minutes.",
    timestamp: '1:15 PM',
  },
];

export const AssistantPage: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [inputValue, setInputValue] = useState('');

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: inputValue.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');

    // Local simulated assistant response clearly acknowledging Phase 1
    setTimeout(() => {
      const assistantMsg: ChatMessage = {
        id: `msg-reply-${Date.now()}`,
        sender: 'assistant',
        text: `[Local UI Echo] I received: "${userMsg.text}". In Phase 2, this input will be processed by our conversational intelligence model.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isSimulated: true,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    }, 500);
  };

  const handleQuickCommand = (command: string) => {
    setInputValue(command);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PlannedFeatureNotice
        phase="Phase 1: Conversation UI Shell"
        title="Personal Assistant Chat Interface"
        description="This chat interface demonstrates the desktop companion conversation layout. Real-time LLM inference, memory retrieval, and voice transcription will be wired up during Phase 2."
      />

      <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '620px', padding: 0, overflow: 'hidden' }}>
        {/* Chat Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--bg-card-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="brand-icon-wrap" style={{ width: '32px', height: '32px' }}>
              <Bot size={18} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Kuro Assistant Core</div>
              <div style={{ fontSize: '11px', color: 'var(--status-green)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="brand-pulse-dot" /> Local Simulation Ready
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <span className="badge badge-phase">Local Echo Mode</span>
          </div>
        </div>

        {/* Messages Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '75%',
                }}
              >
                {!isUser && (
                  <div
                    style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '50%',
                      background: 'var(--accent-bg-subtle)',
                      border: '1px solid var(--accent-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-primary)',
                      flexShrink: 0,
                    }}
                  >
                    <Bot size={16} />
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-lg)',
                      backgroundColor: isUser ? 'var(--accent-primary)' : 'var(--bg-card-subtle)',
                      color: isUser ? '#03070d' : 'var(--text-primary)',
                      fontWeight: isUser ? 500 : 400,
                      fontSize: '13.5px',
                      lineHeight: '1.5',
                      border: isUser ? 'none' : '1px solid var(--border-subtle)',
                      borderTopRightRadius: isUser ? '2px' : undefined,
                      borderTopLeftRadius: !isUser ? '2px' : undefined,
                    }}
                  >
                    {msg.text}
                  </div>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', alignSelf: isUser ? 'flex-end' : 'flex-start' }}>
                    {msg.timestamp} {msg.isSimulated && '• (Simulated)'}
                  </span>
                </div>

                {isUser && (
                  <div
                    style={{
                      width: '30px',
                      height: '30px',
                      borderRadius: '50%',
                      background: 'var(--bg-card-hover)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-secondary)',
                      flexShrink: 0,
                    }}
                  >
                    <User size={16} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Quick Command Chips */}
        <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Quick prompts:
          </span>
          {[
            'What is my focus progress today?',
            'Schedule a 25-minute Pomodoro',
            'How is the robot pet feeling right now?',
            'List pending tasks for hardware',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="expression-btn"
              style={{ whiteSpace: 'nowrap', fontSize: '11px' }}
              onClick={() => handleQuickCommand(prompt)}
            >
              <Sparkles size={11} /> {prompt}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={handleSendMessage}
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backgroundColor: 'var(--bg-card)',
          }}
        >
          <input
            type="text"
            placeholder="Type a message or command to test UI interaction..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            style={{
              flex: 1,
              padding: '10px 14px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '13.5px',
            }}
          />

          <button
            type="button"
            className="header-theme-toggle"
            title="Voice Input (Planned for Phase 2)"
            style={{ cursor: 'not-allowed', opacity: 0.6 }}
          >
            <Mic size={18} />
          </button>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ padding: '10px 16px' }}
            disabled={!inputValue.trim()}
          >
            <Send size={15} />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
