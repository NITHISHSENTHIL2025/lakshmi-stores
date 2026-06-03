import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, Headphones, Send, UserRound } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';

const statusLabel = {
  ai_answering: 'AI handled',
  needs_admin: 'Needs owner',
  human_active: 'Owner active',
  resolved: 'Resolved'
};

const AdminSupportInbox = ({ socket, onCountChange }) => {
  const [threads, setThreads] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [reply, setReply] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || threads[0] || null,
    [threads, selectedThreadId]
  );

  const fetchThreads = useCallback(async () => {
    try {
      const { data } = await api.get('/support/threads?status=active');
      const nextThreads = (data.data || []).filter((thread) => ['needs_admin', 'human_active'].includes(thread.status));
      setThreads(nextThreads);
      onCountChange?.(nextThreads.filter((thread) => thread.status === 'needs_admin').length);

      if (!selectedThreadId && nextThreads.length > 0) {
        setSelectedThreadId(nextThreads[0].id);
      }
    } catch {
      toast.error('Could not load support inbox.');
    } finally {
      setIsLoading(false);
    }
  }, [onCountChange, selectedThreadId]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    if (!socket) return undefined;
    socket.on('supportUpdated', fetchThreads);
    return () => socket.off('supportUpdated', fetchThreads);
  }, [socket, fetchThreads]);

  const sendReply = async (event) => {
    event.preventDefault();
    if (!selectedThread || !reply.trim() || isSending) return;

    setIsSending(true);
    try {
      const { data } = await api.post(`/support/threads/${selectedThread.id}/messages`, {
        message: reply.trim()
      });
      setThreads((current) => current.map((thread) => (
        thread.id === data.thread.id ? data.thread : thread
      )));
      setReply('');
      toast.success('Reply sent. AI is quiet on this chat.');
    } catch {
      toast.error('Reply failed.');
    } finally {
      setIsSending(false);
    }
  };

  const resolveThread = async () => {
    if (!selectedThread) return;
    try {
      await api.put(`/support/threads/${selectedThread.id}/resolve`);
      toast.success('Conversation resolved.');
      setSelectedThreadId(null);
      fetchThreads();
    } catch {
      toast.error('Could not resolve conversation.');
    }
  };

  const getMessageClass = (senderType) => {
    if (senderType === 'customer') return 'bg-gray-900 text-white ml-auto rounded-br-sm';
    if (senderType === 'admin') return 'bg-green-50 text-green-900 border border-green-200 mr-auto rounded-bl-sm';
    if (senderType === 'system') return 'bg-gray-100 text-gray-500 mx-auto text-center text-xs';
    return 'bg-white text-gray-800 border border-gray-100 mr-auto rounded-bl-sm';
  };

  // 🔥 THE FIX: Parse the Base64 image and render an actual Image tag
  const renderMessageBody = (body) => {
    if (body.includes('ATTACHED_IMG:')) {
      const parts = body.split('ATTACHED_IMG:');
      return (
        <div className="flex flex-col gap-3">
          {parts[0] && <span>{parts[0]}</span>}
          <img src={parts[1]} alt="Customer Upload" className="max-w-[250px] rounded-lg border border-gray-700 shadow-sm" />
        </div>
      );
    }
    return body.split('\n').map((line, i) => <span key={i}>{line}<br/></span>);
  };

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-lg font-black text-gray-400">
        Loading support inbox...
      </div>
    );
  }

  return (
    <div className="anim-slide-up">
      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900">Support Queue</h1>
          <p className="mt-2 font-bold text-gray-500">Only escalated customer issues appear here. AI keeps answering routine questions.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-gray-500 shadow-sm border border-gray-100">
          <Headphones className="h-4 w-4 text-orange-600" />
          {threads.length} active chats
        </div>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-[2rem] border border-gray-100 bg-white p-16 text-center shadow-sm">
          <Bot className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h2 className="text-2xl font-black text-gray-900">No owner handoffs</h2>
          <p className="mx-auto mt-2 max-w-md font-bold text-gray-500">The assistant is handling normal stock, pickup, and order questions in the background.</p>
        </div>
      ) : (
        <div className="grid min-h-[640px] grid-cols-1 overflow-hidden rounded-[2rem] border border-gray-100 bg-white shadow-xl shadow-gray-200/40 lg:grid-cols-[360px_1fr]">
          <aside className="border-b border-gray-100 bg-gray-50 lg:border-b-0 lg:border-r">
            <div className="border-b border-gray-100 p-4">
              <p className="text-xs font-black uppercase tracking-widest text-gray-400">Customer handoffs</p>
            </div>
            <div className="max-h-[640px] overflow-y-auto">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => setSelectedThreadId(thread.id)}
                  className={`w-full border-b border-gray-100 p-4 text-left transition hover:bg-white ${selectedThread?.id === thread.id ? 'bg-white' : ''}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-black text-gray-900">
                      {thread.customerName || thread.customerEmail || 'Guest customer'}
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${thread.status === 'needs_admin' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {statusLabel[thread.status] || thread.status}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-gray-500">
                    {thread.lastMessagePreview?.includes('ATTACHED_IMG:') ? '📷 Sent a photo' : thread.lastMessagePreview || 'New conversation'}
                  </p>
                  <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {new Date(thread.updatedAt).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex min-h-[640px] flex-col">
            {selectedThread && (
              <>
                <div className="flex flex-col gap-4 border-b border-gray-100 p-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      {selectedThread.status === 'needs_admin' && <CircleAlert className="h-5 w-5 text-red-500" />}
                      <h2 className="text-xl font-black text-gray-900">
                        {selectedThread.customerName || selectedThread.customerEmail || 'Guest customer'}
                      </h2>
                    </div>
                    <p className="mt-1 text-sm font-bold text-gray-500">
                      {selectedThread.customerEmail || 'No email'} {selectedThread.customerPhone ? `- ${selectedThread.customerPhone}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={resolveThread}
                    className="flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-black text-green-700 transition hover:bg-green-100"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Resolve
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto bg-gray-50 px-5 py-5">
                  <div className="space-y-3">
                    {selectedThread.messages?.map((message) => (
                      <div key={message.id} className="flex flex-col">
                        <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm font-semibold leading-relaxed shadow-sm ${getMessageClass(message.senderType)}`}>
                          {message.senderType !== 'customer' && message.senderType !== 'system' && (
                            <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide opacity-70">
                              {message.senderType === 'admin' ? <UserRound className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                              {message.senderName || 'Store'}
                            </div>
                          )}
                          {renderMessageBody(message.body)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <form onSubmit={sendReply} className="border-t border-gray-100 bg-white p-4">
                  <div className="mb-3 rounded-xl bg-orange-50 px-4 py-3 text-xs font-bold text-orange-800">
                    Once you reply, the AI stays silent and lets you handle the customer directly.
                  </div>
                  <div className="flex gap-3">
                    <input
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      placeholder="Type as Vignesh from the store..."
                      className="h-12 min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 font-bold outline-none transition focus:border-orange-500 focus:bg-white"
                    />
                    <button
                      type="submit"
                      disabled={!reply.trim() || isSending}
                      className="flex h-12 items-center gap-2 rounded-xl bg-gray-900 px-5 font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      <Send className="h-4 w-4" />
                      Send
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default AdminSupportInbox;