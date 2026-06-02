import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Headphones, MessageCircle, Send, UserRound, X } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';

const THREAD_KEY = 'lakshmi_support_thread_id';

const starterMessages = [
  {
    id: 'starter',
    senderType: 'assistant',
    senderName: 'Lakshmi Assistant',
    body: 'Hi, I can check item stock, pickup timing, and your latest order. If something went wrong, I will bring the store manager in.'
  }
];

const SmartAssistant = () => {
  const { user } = useAuth();
  const { socket } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [thread, setThread] = useState(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const messagesEndRef = useRef(null);

  const messages = useMemo(() => thread?.messages?.length ? thread.messages : starterMessages, [thread]);
  const needsHuman = ['needs_admin', 'human_active'].includes(thread?.status);
  const isResolved = thread?.status === 'resolved';

  const fetchThread = async (threadId) => {
    if (!threadId) return;
    setIsLoadingThread(true);
    try {
      const { data } = await api.get(`/support/threads/${threadId}`);
      setThread(data.thread);
    } catch {
      localStorage.removeItem(THREAD_KEY);
      setThread(null);
    } finally {
      setIsLoadingThread(false);
    }
  };

  useEffect(() => {
    const savedThreadId = localStorage.getItem(THREAD_KEY);
    if (savedThreadId) fetchThread(savedThreadId);
  }, []);

  useEffect(() => {
    if (!socket || !thread?.id) return undefined;

    const handleSupportUpdate = (payload) => {
      if (payload?.threadId === thread.id) fetchThread(thread.id);
    };

    socket.on('supportUpdated', handleSupportUpdate);
    return () => socket.off('supportUpdated', handleSupportUpdate);
  }, [socket, thread?.id]);

  useEffect(() => {
    if (!thread?.id || (!isOpen && !needsHuman)) return undefined;

    const interval = setInterval(() => fetchThread(thread.id), 12000);
    return () => clearInterval(interval);
  }, [thread?.id, isOpen, needsHuman]);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const sendMessage = async (event) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSending) return;

    setInput('');
    setIsSending(true);

    try {
      const { data } = await api.post('/support/chat', {
        message,
        threadId: thread?.id || localStorage.getItem(THREAD_KEY)
      });

      setThread(data.thread);
      localStorage.setItem(THREAD_KEY, data.thread.id);
    } catch {
      setThread((current) => ({
        ...(current || {}),
        messages: [
          ...(current?.messages || starterMessages),
          {
            id: `error-${Date.now()}`,
            senderType: 'assistant',
            senderName: 'Lakshmi Assistant',
            body: 'I could not send that message right now. Please try again in a moment.'
          }
        ]
      }));
    } finally {
      setIsSending(false);
    }
  };

  const resetThread = () => {
    localStorage.removeItem(THREAD_KEY);
    setThread(null);
    setInput('');
  };

  const getBubbleClass = (senderType) => {
    if (senderType === 'customer') return 'ml-auto bg-gray-900 text-white rounded-br-sm';
    if (senderType === 'admin') return 'mr-auto bg-green-50 text-green-900 border border-green-200 rounded-bl-sm';
    if (senderType === 'system') return 'mx-auto bg-gray-100 text-gray-500 text-center text-xs';
    return 'mr-auto bg-white text-gray-800 border border-gray-100 rounded-bl-sm';
  };

  return (
    <div className="fixed bottom-20 left-4 z-[80] md:bottom-8">
      {isOpen && (
        <div className="mb-3 w-[calc(100vw-2rem)] max-w-[380px] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-2xl shadow-gray-900/20">
          <div className="flex items-center justify-between bg-gray-900 px-4 py-3 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-black leading-tight">Lakshmi Assistant</p>
                <p className="text-[11px] font-bold text-gray-300">
                  {needsHuman ? 'Manager looped in' : 'Live store helper'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {thread?.id && (
                <button
                  type="button"
                  onClick={resetThread}
                  className="rounded-full px-2 py-1 text-[11px] font-black text-gray-300 hover:bg-white/10 hover:text-white"
                >
                  New
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
                aria-label="Close assistant"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {needsHuman && (
            <div className="flex items-center gap-2 border-b border-green-100 bg-green-50 px-4 py-3 text-xs font-bold text-green-800">
              <Headphones className="h-4 w-4" />
              The store manager can see this full conversation.
            </div>
          )}

          {isResolved && (
            <div className="border-b border-gray-200 bg-white px-4 py-3 text-xs font-bold text-gray-500">
              This conversation was resolved. Send a new message to start again.
            </div>
          )}

          <div className="max-h-[420px] min-h-[280px] overflow-y-auto px-4 py-4">
            {isLoadingThread && messages.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm font-bold text-gray-400">
                Loading conversation...
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className="flex flex-col">
                    <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm font-semibold leading-relaxed shadow-sm ${getBubbleClass(message.senderType)}`}>
                      {message.senderType !== 'customer' && message.senderType !== 'system' && (
                        <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide opacity-70">
                          {message.senderType === 'admin' ? <UserRound className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                          {message.senderName || 'Store'}
                        </div>
                      )}
                      {message.body}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <form onSubmit={sendMessage} className="border-t border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={user ? 'Ask about stock, pickup, or orders...' : 'Ask about stock or pickup...'}
                className="h-11 min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-bold outline-none transition focus:border-orange-500 focus:bg-white"
                maxLength={1000}
              />
              <button
                type="submit"
                disabled={isSending || !input.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white shadow-2xl shadow-gray-900/30 transition hover:-translate-y-0.5 hover:bg-black"
        aria-label="Open assistant"
      >
        <MessageCircle className="h-6 w-6" />
        {needsHuman && (
          <span className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full border-2 border-white bg-green-500" />
        )}
      </button>
    </div>
  );
};

export default SmartAssistant;
