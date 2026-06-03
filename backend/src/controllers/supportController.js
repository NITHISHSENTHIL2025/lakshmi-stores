import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Image as ImageIcon, Bot, UserRound, ShieldCheck } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { useStore } from '../context/StoreContext'; // Added to get socket for real-time updates

const SupportPage = () => {
  const { socket } = useStore(); // Real-time connection
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [threadStatus, setThreadStatus] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 🔥 1. FETCH THREAD HISTORY FUNCTION
  const fetchThread = useCallback(async (threadId) => {
    if (!threadId) {
      setIsLoading(false);
      return;
    }
    try {
      const { data } = await api.get(`/support/threads/${threadId}`);
      if (data.success && data.thread) {
        setMessages(data.thread.messages || []);
        setThreadStatus(data.thread.status);
      }
    } catch (err) {
      // If thread isn't found (deleted from DB), clear the local storage
      localStorage.removeItem('support_thread_id');
      console.error('Failed to load thread history');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 🔥 2. ON MOUNT: CHECK FOR EXISTING CHAT IF REFRESHED
  useEffect(() => {
    const savedThreadId = localStorage.getItem('support_thread_id');
    fetchThread(savedThreadId);
  }, [fetchThread]);

  // 🔥 3. SOCKET CONNECTION: AUTO-UPDATE WITHOUT REFRESHING
  useEffect(() => {
    if (!socket) return;
    
    const handleSupportUpdate = (payload) => {
      const currentThreadId = localStorage.getItem('support_thread_id');
      if (payload && payload.threadId === currentThreadId) {
        fetchThread(currentThreadId); // Silently fetch new messages when admin replies
      }
    };

    socket.on('supportUpdated', handleSupportUpdate);
    return () => socket.off('supportUpdated', handleSupportUpdate);
  }, [socket, fetchThread]);

  // Auto-scroll when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && (file.type === 'image/jpeg' || file.type === 'image/png')) {
      setSelectedFile(file);
      toast.success('Image attached!');
    } else {
      toast.error('Please select a valid JPEG or PNG image.');
    }
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!input.trim() && !selectedFile) return;

    setIsSending(true);
    const threadId = localStorage.getItem('support_thread_id');
    
    const textToSend = input.trim() ? input : "[Photo Attached]";

    const payload = {
      message: textToSend,
      threadId: threadId,
      photo: selectedFile ? "photo_attached_flag" : null 
    };

    // Optimistic UI update
    const displayMsg = selectedFile && input.trim() ? `${input} [Photo Attached]` : textToSend;
    const tempMsg = { id: Date.now(), senderType: 'customer', body: displayMsg };
    setMessages(prev => [...prev, tempMsg]);
    setInput('');
    setSelectedFile(null);

    try {
      const { data } = await api.post('/support/chat', payload);
      if (data.success && data.thread) {
        localStorage.setItem('support_thread_id', data.thread.id);
        setMessages(data.thread.messages || []);
        setThreadStatus(data.thread.status);
      }
    } catch (err) {
      toast.error('Failed to send message.');
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center pt-10 pb-20 px-4">
      
      <div className="w-full max-w-3xl mb-6 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 mb-2">Help & Support</h1>
        <p className="text-gray-500 font-medium flex items-center justify-center gap-2">
          <ShieldCheck className="w-5 h-5 text-green-500" />
          We are here to resolve your issues instantly.
        </p>
      </div>

      <div className="w-full max-w-3xl bg-white/80 backdrop-blur-xl border border-gray-200 rounded-[2rem] shadow-xl overflow-hidden flex flex-col h-[70vh]">
        
        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50">
          
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-gray-400 font-bold animate-pulse">
              Loading conversation...
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Bot className="w-16 h-16 mb-4 opacity-50" />
              <p className="font-semibold">Send a message to start a support ticket.</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.senderType === 'customer' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-5 py-3 text-sm font-semibold leading-relaxed shadow-sm ${
                  msg.senderType === 'customer' 
                    ? 'bg-gray-900 text-white rounded-br-sm' 
                    : msg.senderType === 'admin' 
                      ? 'bg-blue-50 text-blue-900 border border-blue-200 rounded-bl-sm'
                      : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'
                }`}>
                  {msg.senderType !== 'customer' && (
                    <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest opacity-70">
                      {msg.senderType === 'admin' ? <UserRound className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                      {msg.senderName || 'Support'}
                    </div>
                  )}
                  {msg.body.split('\n').map((line, i) => (
                    <span key={i}>{line}<br/></span>
                  ))}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="bg-white border-t border-gray-100 p-4">
          
          {threadStatus === 'needs_admin' && (
            <div className="mb-3 text-center text-xs font-bold text-orange-600 bg-orange-50 py-2 rounded-lg">
              Automated responses are muted. The store admin will reply to you shortly.
            </div>
          )}

          <form onSubmit={sendMessage} className="flex items-center gap-3">
            
            <label className="cursor-pointer shrink-0 p-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl transition text-gray-500 hover:text-gray-900 relative">
              <input type="file" accept="image/jpeg, image/png" className="hidden" onChange={handleFileChange} />
              <ImageIcon className="w-5 h-5" />
              {selectedFile && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>
              )}
            </label>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={selectedFile ? `Attached: ${selectedFile.name}` : "Describe your issue here..."}
              className="flex-1 h-12 bg-gray-50 border border-gray-200 rounded-xl px-4 font-medium text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
            />
            
            <button
              type="submit"
              disabled={(!input.trim() && !selectedFile) || isSending}
              className="shrink-0 flex items-center justify-center h-12 px-6 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SupportPage;