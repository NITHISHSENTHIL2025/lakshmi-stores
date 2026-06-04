import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Image as ImageIcon, Bot, UserRound, ShieldCheck, Plus, MessageSquare, Lock } from 'lucide-react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { useStore } from '../context/StoreContext'; 

const SupportPage = () => {
  const { socket } = useStore(); 
  
  // Sidebar & Thread State
  const [threadHistory, setThreadHistory] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  
  // Active Chat State
  const [messages, setMessages] = useState([]);
  const [threadStatus, setThreadStatus] = useState(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null); 
  
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load all historical threads for the sidebar
  const loadSidebarHistory = async () => {
    const savedIds = JSON.parse(localStorage.getItem('support_thread_ids') || '[]');
    const fetchedThreads = [];
    for (let id of savedIds) {
      try {
        const { data } = await api.get(`/support/threads/${id}`);
        if (data.success && data.thread) fetchedThreads.push(data.thread);
      } catch (err) {
        // If thread deleted from DB, remove from local storage array
        const newIds = savedIds.filter(savedId => savedId !== id);
        localStorage.setItem('support_thread_ids', JSON.stringify(newIds));
      }
    }
    // Sort newest first
    setThreadHistory(fetchedThreads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
  };

  // Fetch a specific thread's messages
  const fetchThread = useCallback(async (threadId) => {
    setIsLoading(true);
    if (!threadId) {
      setMessages([]);
      setThreadStatus(null);
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
      setActiveThreadId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initialization
  useEffect(() => {
    loadSidebarHistory().then(() => {
      const savedIds = JSON.parse(localStorage.getItem('support_thread_ids') || '[]');
      if (savedIds.length > 0) {
        setActiveThreadId(savedIds[savedIds.length - 1]); // Load most recent
      } else {
        setIsLoading(false);
      }
    });
  }, []);

  // Watch for Active Thread Changes
  useEffect(() => {
    fetchThread(activeThreadId);
  }, [activeThreadId, fetchThread]);

  // Real-time Socket Updates
  useEffect(() => {
    if (!socket) return;
    const handleSupportUpdate = (payload) => {
      if (payload && payload.threadId === activeThreadId) {
        fetchThread(activeThreadId); 
      }
      loadSidebarHistory(); // Refresh sidebar statuses
    };
    socket.on('supportUpdated', handleSupportUpdate);
    return () => socket.off('supportUpdated', handleSupportUpdate);
  }, [socket, activeThreadId, fetchThread]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startNewChat = () => {
    setActiveThreadId(null);
    setMessages([]);
    setThreadStatus(null);
    setInput('');
    setSelectedFile(null);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && (file.type === 'image/jpeg' || file.type === 'image/png')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedFile({ file, base64: reader.result }); 
        toast.success('Image attached!');
      };
      reader.readAsDataURL(file); 
    } else {
      toast.error('Please select a valid JPEG or PNG image.');
    }
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!input.trim() && !selectedFile) return;

    setIsSending(true);
    const textToSend = input.trim() ? input : "Here is my photo proof:";

    const payload = {
      message: textToSend,
      threadId: activeThreadId, // Send null if it's a new chat
      photo: selectedFile ? selectedFile.base64 : null
    };

    const displayMsg = selectedFile ? `${textToSend}ATTACHED_IMG:${selectedFile.base64}` : textToSend;
    const tempMsg = { id: Date.now(), senderType: 'customer', body: displayMsg };
    setMessages(prev => [...prev, tempMsg]);
    setInput('');
    setSelectedFile(null);

    try {
      const { data } = await api.post('/support/chat', payload);
      if (data.success && data.thread) {
        // Save to Local Storage Array
        const savedIds = JSON.parse(localStorage.getItem('support_thread_ids') || '[]');
        if (!savedIds.includes(data.thread.id)) {
          savedIds.push(data.thread.id);
          localStorage.setItem('support_thread_ids', JSON.stringify(savedIds));
        }
        
        if (!activeThreadId) {
          setActiveThreadId(data.thread.id);
        }
        setMessages(data.thread.messages || []);
        setThreadStatus(data.thread.status);
        loadSidebarHistory();
      }
    } catch (err) {
      toast.error('Failed to send message.');
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
    } finally {
      setIsSending(false);
    }
  };

  const renderMessageBody = (body) => {
    if (body.includes('ATTACHED_IMG:')) {
      const parts = body.split('ATTACHED_IMG:');
      return (
        <div className="flex flex-col gap-3">
          {parts[0] && <span>{parts[0]}</span>}
          <img src={parts[1]} alt="Customer Upload" className="max-w-[200px] rounded-lg border border-white/20 shadow-sm" />
        </div>
      );
    }
    return body.split('\n').map((line, i) => <span key={i}>{line}<br/></span>);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col items-center pt-8 pb-20 px-4 font-sans">
      
      <div className="w-full max-w-6xl mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-1">Support Center</h1>
          <p className="text-gray-500 font-medium flex items-center gap-2 text-sm">
            <ShieldCheck className="w-4 h-4 text-green-500" /> We are here to resolve your issues.
          </p>
        </div>
      </div>

      {/* Main Glassmorphism Container */}
      <div className="w-full max-w-6xl bg-white/70 backdrop-blur-2xl border border-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col md:flex-row h-[75vh]">
        
        {/* SIDEBAR */}
        <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-gray-100/80 bg-white/40 flex flex-col">
          <div className="p-5 border-b border-gray-100/80">
            <button 
              onClick={startNewChat}
              className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-black text-white px-4 py-3 rounded-xl font-bold transition shadow-sm"
            >
              <Plus className="w-4 h-4" /> New Conversation
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {threadHistory.length === 0 ? (
              <div className="text-center text-sm font-semibold text-gray-400 mt-10">No past conversations</div>
            ) : (
              threadHistory.map(thread => (
                <button
                  key={thread.id}
                  onClick={() => setActiveThreadId(thread.id)}
                  className={`w-full text-left p-4 rounded-2xl transition border ${activeThreadId === thread.id ? 'bg-white border-gray-200 shadow-sm' : 'border-transparent hover:bg-white/60'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-black text-gray-900 uppercase tracking-widest flex items-center gap-1.5">
                      <MessageSquare className="w-3 h-3 text-orange-500" /> Ticket
                    </span>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${thread.status === 'resolved' ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                      {thread.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 font-medium line-clamp-1">
                    {thread.lastMessagePreview?.includes('ATTACHED_IMG:') ? '📷 Sent a photo' : thread.lastMessagePreview || 'New conversation'}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* CHAT AREA */}
        <div className="flex-1 flex flex-col bg-transparent">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {isLoading ? (
              <div className="h-full flex items-center justify-center text-gray-400 font-bold animate-pulse">Loading...</div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <Bot className="w-16 h-16 mb-4 opacity-40" />
                <p className="font-semibold text-sm">Send a message to start a new support ticket.</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.senderType === 'customer' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-3xl px-5 py-3.5 text-sm font-semibold leading-relaxed shadow-sm ${
                    msg.senderType === 'customer' 
                      ? 'bg-blue-600 text-white rounded-br-sm' 
                      : msg.senderType === 'admin' 
                        ? 'bg-gray-900 text-white rounded-bl-sm'
                        : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'
                  }`}>
                    {msg.senderType !== 'customer' && (
                      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest opacity-70">
                        {msg.senderType === 'admin' ? <UserRound className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                        {msg.senderName || 'Support'}
                      </div>
                    )}
                    {renderMessageBody(msg.body)} 
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* INPUT AREA */}
          <div className="p-5 bg-white/50 backdrop-blur-md border-t border-gray-100/80">
            {threadStatus === 'resolved' ? (
              <div className="flex items-center justify-center gap-2 bg-gray-100/80 text-gray-500 py-4 rounded-2xl text-sm font-bold border border-gray-200">
                <Lock className="w-4 h-4" /> This conversation has been resolved and closed.
              </div>
            ) : (
              <form onSubmit={sendMessage} className="flex items-center gap-3">
                <label className="cursor-pointer shrink-0 p-3.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl transition text-gray-500 hover:text-blue-600 relative shadow-sm">
                  <input type="file" accept="image/jpeg, image/png" className="hidden" onChange={handleFileChange} />
                  <ImageIcon className="w-5 h-5" />
                  {selectedFile && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full"></span>}
                </label>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={selectedFile ? `Attached: ${selectedFile.file.name}` : "Describe your issue here..."}
                  className="flex-1 h-14 bg-white border border-gray-200 rounded-2xl px-5 font-semibold text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition shadow-sm"
                />
                <button
                  type="submit"
                  disabled={(!input.trim() && !selectedFile) || isSending}
                  className="shrink-0 flex items-center justify-center h-14 w-14 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupportPage;