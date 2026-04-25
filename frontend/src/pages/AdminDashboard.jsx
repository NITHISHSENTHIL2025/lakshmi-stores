import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import AdminProductManager from '../components/AdminProductManager';
import { io } from 'socket.io-client';
import { useAuth } from "../context/AuthContext";

// 🚨 FIX 1: INITIALIZE SOCKET OUTSIDE THE COMPONENT!
const socketUrl = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace('/api', '');
const socket = io(socketUrl, {
  withCredentials: true,
  transports: ['websocket', 'polling']
});

const AdminDashboard = () => {
  const { logout } = useAuth(); 
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]); 
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [activeView, setActiveView] = useState('live'); 
  
  const [audioEnabled, setAudioEnabled] = useState(() => localStorage.getItem('storeAudio') === 'true');
  // 🚨 FIX 2: Use a Ref for Audio so it doesn't trigger re-renders in our useEffect
  const audioRef = useRef(audioEnabled);
  
  const [posSearchTerm, setPosSearchTerm] = useState('');
  const [storeStatus, setStoreStatus] = useState({ isOpen: true, closingWarningActive: false });
  const [closingError, setClosingError] = useState(''); 
  const [customerRequests, setCustomerRequests] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [handoverModal, setHandoverModal] = useState({ isOpen: false, order: null, step: 'pin', pinInput: '', cashInput: '', change: 0, error: '' });
  
  const prevOrderCount = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    audioRef.current = audioEnabled;
  }, [audioEnabled]);

  const toggleAudio = () => {
    const newState = !audioEnabled;
    setAudioEnabled(newState);
    localStorage.setItem('storeAudio', newState);
    if (newState) playAlarm(); 
  };

  const playAlarm = () => {
    if (!audioRef.current) return; 
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator(); const gainNode = audioCtx.createGain();
      osc.type = 'square'; const now = audioCtx.currentTime;
      for (let i = 0; i < 6; i++) { osc.frequency.setValueAtTime(800, now + (i * 0.5)); osc.frequency.linearRampToValueAtTime(500, now + (i * 0.5) + 0.25); }
      gainNode.gain.setValueAtTime(0, now); gainNode.gain.linearRampToValueAtTime(0.3, now + 0.1); gainNode.gain.setValueAtTime(0.3, now + 2.8); gainNode.gain.linearRampToValueAtTime(0, now + 3.0); 
      osc.connect(gainNode); gainNode.connect(audioCtx.destination); osc.start(now); osc.stop(now + 3.0);
    } catch (e) { }
  };

  // 🚨 FIX 3: Master UseEffect with an EMPTY dependency array []
  useEffect(() => {
    fetchOrders(); fetchProducts(); fetchStoreStatus(); fetchRequests();

    socket.on('connect', () => console.log('🟢 Connected to Live Store Feed'));
    
    socket.on('storeUpdated', () => {
      console.log('⚡ Order received! Refreshing dashboard...');
      fetchOrders(true);
      fetchProducts();
    });

    return () => {
      socket.off('connect');
      socket.off('storeUpdated');
    };
  }, []); 

  useEffect(() => {
    if (!storeStatus.isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
  }, [storeStatus.isOpen]);

  const fetchStoreStatus = async () => { try { const res = await api.get('/store/status'); setStoreStatus(res.data); } catch (e) { } };
  const fetchRequests = async () => { try { const res = await api.get('/store/requests'); setCustomerRequests(res.data.data); } catch (e) { } };
  
  const toggleShutter = async () => { 
    setClosingError('');
    try { 
      const newStatus = !storeStatus.isOpen; 
      await api.post('/store/status', { isOpen: newStatus }); 
      setStoreStatus({ ...storeStatus, isOpen: newStatus, closingWarningActive: false }); 
    } catch (e) { 
      if (e.response && e.response.status === 400) {
        setClosingError(e.response.data.message);
      }
    } 
  };

  const triggerClosingWarning = async () => {
    try {
      await api.post('/store/trigger-warning');
      setStoreStatus({ ...storeStatus, closingWarningActive: true });
    } catch (e) { }
  };

  const clearRequest = async (id) => { try { await api.delete(`/store/requests/${id}`); fetchRequests(); } catch (e) { } };

  const fetchOrders = async (isBackgroundSync = false) => {
    try {
      const response = await api.get('/orders');
      const allOrders = response.data.data;
      
      const active = allOrders.filter(o => ['paid', 'pending_cash', 'packed', 'ready'].includes(o.orderStatus.toLowerCase()));

      if (isBackgroundSync && active.length > prevOrderCount.current && prevOrderCount.current !== 0) playAlarm(); 
      prevOrderCount.current = active.length;
      setOrders(allOrders);
    } catch (error) { } 
    finally { if (!isBackgroundSync) setLoadingOrders(false); }
  };

  const fetchProducts = async () => { try { const response = await api.get('/products'); setProducts(response.data.data); } catch (error) { } };

  const updateOrderStatus = async (id, newStatus) => {
    try {
      // 🚨 PRODUCTION P0 FIX: Backend expects `orderStatus`, NOT `status`
      await api.put(`/orders/${id}/status`, { orderStatus: newStatus.toLowerCase() });
      
      if (['completed', 'cancelled'].includes(newStatus.toLowerCase())) { prevOrderCount.current -= 1; }
      setOrders(orders.map(order => order.id === id ? { ...order, orderStatus: newStatus.toLowerCase() } : order));
    } catch (error) { 
      console.error("Status update failed:", error);
    }
  };

  const startHandover = (order) => setHandoverModal({ isOpen: true, order: order, step: 'pin', pinInput: '', cashInput: '', change: 0, error: '' });

  const processHandover = () => {
    const { order, step, pinInput, cashInput } = handoverModal;
    setHandoverModal(prev => ({ ...prev, error: '' })); 
    
    if (step === 'pin') {
      // 🚨 PRODUCTION P0 FIX: Verify against the secure pickupPin, not the OrderID suffix!
      const expectedPin = String(order.pickupPin); 
      
      if (String(pinInput) === expectedPin) {
        const requiresCash = order.paymentType === 'CASH' || order.orderStatus === 'pending_cash';
        
        if (requiresCash) {
          setHandoverModal({ ...handoverModal, step: 'cash', error: '' }); 
        } else {
          updateOrderStatus(order.id, 'completed');
          setHandoverModal({ ...handoverModal, step: 'success', change: 0, error: '' });
        }
      } else {
        setHandoverModal(prev => ({ ...prev, error: '❌ Incorrect PIN. Ask customer to check their app.' }));
      }
    } 
    else if (step === 'cash') {
      const cash = Number(cashInput);
      if (cash >= order.orderAmount) {
        const changeDue = cash - order.orderAmount;
        updateOrderStatus(order.id, 'completed');
        setHandoverModal({ ...handoverModal, step: 'success', change: changeDue, error: '' });
      } else {
        setHandoverModal(prev => ({ ...prev, error: '❌ Not enough cash provided for the bill.' }));
      }
    }
    else if (step === 'success') {
      setHandoverModal({ isOpen: false, order: null, step: 'pin', pinInput: '', cashInput: '', change: 0, error: '' });
    }
  };

  const handleQuickStock = async (productId, action) => {
    try {
      const response = await api.put(`/products/${productId}/quick-stock`, { action: action });
      if (response.data.success) { setProducts(products.map(p => p.id === productId ? { ...p, real_stock: response.data.real_stock } : p)); }
    } catch (error) { }
  };

  const printLabel = (order) => {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    let displayToken = order.orderToken;
    if (!displayToken || displayToken === 'WAIT') displayToken = order.cashfreeOrderId.slice(-4);
    
    printWindow.document.write(`<html><head><title>Print Label</title><style>body{font-family:monospace;max-width:300px;margin:0 auto;padding:10px;color:black;}h2{margin:0 0 5px 0;text-align:center;font-size:20px;text-transform:uppercase;}.subtitle{text-align:center;font-size:12px;margin-bottom:10px;}.divider{border-top:1px dashed black;margin:10px 0;}.item{display:flex;justify-content:space-between;margin-bottom:5px;font-size:14px;}.bold{font-weight:bold;}.center{text-align:center;}.token{font-size:40px;font-weight:black;text-align:center;border:3px solid black;padding:15px;margin:20px 0;border-radius:10px;}@media print{@page{margin:0;}body{margin:1cm;}}</style></head><body><h2>STORE RECEIPT</h2><div class="subtitle">Quick Pickup Order</div><div class="token">${displayToken}</div><div class="divider"></div><div class="bold" style="margin-bottom:5px;">Items to Pack:</div>${order.items.map(item => `<div class="item"><span>${item.quantity}x ${item.name}</span></div>`).join('')}<div class="divider"></div><div class="center bold" style="font-size:18px;">Amount: Rs. ${order.orderAmount}</div><div class="divider"></div><div class="center" style="font-size:12px;margin-top:20px;">Staple to customer bag.</div><script>window.onload=()=>{window.print();setTimeout(()=>{window.close();},500);}</script></body></html>`);
    printWindow.document.close();
  };

  const safeNumber = (val) => isNaN(Number(val)) ? 0 : Number(val);
  
  const activeOrders = orders.filter(o => ['paid', 'pending_cash', 'packed', 'ready'].includes(o.orderStatus.toLowerCase()));
  const pastOrders = orders.filter(o => ['completed', 'cancelled', 'pending', 'failed'].includes(o.orderStatus.toLowerCase()));
  
  const today = new Date().toDateString();
  const todayOrders = orders.filter(o => new Date(o.createdAt).toDateString() === today && ['paid', 'pending_cash', 'packed', 'ready', 'completed'].includes(o.orderStatus.toLowerCase()));
  const todayRevenue = todayOrders.reduce((sum, order) => sum + safeNumber(order.orderAmount), 0);
  const lowStockItems = products.filter(p => (p.real_stock ?? p.stock) <= 3);
  const filteredPosProducts = products.filter(p => p.name.toLowerCase().includes(posSearchTerm.toLowerCase()));

  const getStatusBadge = (order) => {
    const s = order.orderStatus.toLowerCase();
    const isCash = order.paymentType === 'CASH' || s === 'pending_cash';

    if (s === 'pending') return <span className="px-4 py-1.5 bg-gray-100 text-gray-500 rounded-lg text-[10px] font-black uppercase tracking-widest border border-gray-200">Awaiting Online Payment</span>;
    if (s === 'failed') return <span className="px-4 py-1.5 bg-red-100 text-red-800 rounded-lg text-[10px] font-black uppercase tracking-widest border border-red-200">Payment Failed</span>;
    if (s === 'completed') return <span className="px-4 py-1.5 bg-gray-100 text-gray-800 rounded-lg text-[10px] font-black uppercase tracking-widest border border-gray-200">Completed</span>;

    if (s === 'ready') return <span className="px-4 py-1.5 bg-indigo-100 text-indigo-800 rounded-lg text-[10px] font-black uppercase tracking-widest border border-indigo-200 shadow-sm animate-pulseSoft">Ready</span>;
    if (s === 'packed') return <span className="px-4 py-1.5 bg-blue-100 text-blue-800 rounded-lg text-[10px] font-black uppercase tracking-widest border border-blue-200">Packed</span>;
    
    return isCash ? 
      <span className="px-4 py-1.5 bg-orange-100 text-orange-800 rounded-lg text-[10px] font-black uppercase tracking-widest border border-orange-200 shadow-sm">COD: Collect Cash</span> :
      <span className="px-4 py-1.5 bg-green-100 text-green-800 rounded-lg text-[10px] font-black uppercase tracking-widest border border-green-200 shadow-sm">Paid Online</span>;
  };

  const navLinkClass = (view) => `w-full text-left px-5 py-4 rounded-xl font-bold transition-all flex items-center justify-between cursor-pointer ${activeView === view ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans">
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .anim-slide-up { animation: slideUp 0.3s ease-out forwards; }
      `}</style>
      
      {!storeStatus.isOpen && (
        <div className="fixed inset-0 z-[300] bg-gray-950/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center w-full h-full animate-fadeIn">
          <div className="text-8xl mb-8 animate-bounce">🏪</div>
          <h2 className="text-5xl font-black text-white mb-4 tracking-tighter">Shop is Closed</h2>
          <p className="text-gray-400 font-bold mb-8 max-w-sm text-lg">System is locked. Open the shutter to resume operations.</p>
          <button onClick={toggleShutter} className="px-8 py-4 bg-green-500 hover:bg-green-600 text-white font-black rounded-xl text-lg shadow-lg shadow-green-500/30 transition-transform transform active:scale-95 cursor-pointer">Open Shutter Now</button>
        </div>
      )}

      {/* VERIFICATION MODAL */}
      {handoverModal.isOpen && (
        <div className="fixed inset-0 z-[200] bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-300">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden anim-slide-up border border-gray-100">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-black text-gray-900">
                {handoverModal.step === 'pin' ? '🔒 Secure Handover' : handoverModal.step === 'cash' ? '💵 Collect Payment' : '🎉 Complete'}
              </h2>
              {handoverModal.step !== 'success' && (
                <button onClick={() => setHandoverModal({isOpen: false})} className="text-gray-400 hover:text-red-500 font-black cursor-pointer text-xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-red-50 transition-colors">✕</button>
              )}
            </div>
            
            <div className="p-8 text-center relative">
              {handoverModal.error && (
                <div className="absolute top-2 left-8 right-8 bg-red-50 text-red-600 text-xs font-black py-2 rounded-lg border border-red-200 animate-fadeIn">
                  {handoverModal.error}
                </div>
              )}

              {handoverModal.step === 'pin' ? (
                <div className="pt-4">
                  <p className="text-gray-500 font-bold mb-1">Enter Secret PIN for Token:</p>
                  <p className="text-5xl font-black text-gray-900 mb-6">
                    {handoverModal.order.orderToken && handoverModal.order.orderToken !== 'WAIT' ? handoverModal.order.orderToken : handoverModal.order.cashfreeOrderId.slice(-4)}
                  </p>
                  
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength="4" value={handoverModal.pinInput} onChange={e => setHandoverModal({...handoverModal, pinInput: e.target.value, error: ''})} className={`w-full text-center text-5xl font-black tracking-[0.5em] px-4 py-6 border-2 rounded-2xl outline-none transition-colors shadow-sm mb-8 ${handoverModal.error ? 'border-red-400 focus:border-red-500 bg-red-50' : 'border-gray-200 focus:border-green-500'}`} autoFocus placeholder="••••" />
                  
                  <button onClick={processHandover} className="w-full py-4 bg-gray-900 hover:bg-black text-white font-black rounded-xl text-lg shadow-xl transition-transform transform active:scale-95 cursor-pointer">Verify Match</button>
                </div>
              ) : handoverModal.step === 'cash' ? (
                <div className="pt-4 animate-slideInRight">
                  <p className="text-gray-500 font-bold mb-2">Order Amount Due</p>
                  <h3 className="text-6xl font-black text-gray-900 mb-8 tracking-tighter">₹{handoverModal.order.orderAmount}</h3>
                  <div className="text-left mb-8">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2 block">Cash Handed by Customer (₹)</label>
                    <input type="number" placeholder="e.g., 500" value={handoverModal.cashInput} onChange={e => setHandoverModal({...handoverModal, cashInput: e.target.value, error: ''})} className={`w-full px-6 py-5 text-3xl font-black border-2 rounded-2xl outline-none transition-colors shadow-sm ${handoverModal.error ? 'border-red-400 focus:border-red-500 bg-red-50' : 'border-gray-200 focus:border-orange-500'}`} autoFocus />
                  </div>
                  <button onClick={processHandover} className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-xl text-lg shadow-lg shadow-orange-500/30 transition-transform transform active:scale-95 cursor-pointer">Calculate Change</button>
                </div>
              ) : (
                <div className="pt-4 animate-slideUp">
                  <div className="w-28 h-28 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-6xl mx-auto mb-6 shadow-inner">✓</div>
                  <h3 className="text-3xl font-black text-gray-900 mb-2">Order Complete!</h3>
                  
                  {handoverModal.order.paymentType === 'CASH' || handoverModal.order.orderStatus === 'pending_cash' || handoverModal.change > 0 ? (
                    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6 mb-8 mt-6 shadow-sm text-left">
                      <p className="text-sm font-black text-orange-800 uppercase tracking-widest mb-4 border-b border-orange-200 pb-2">Cash Transaction</p>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-orange-700">Cash Received:</span>
                        <span className="font-black text-orange-900 text-xl">₹{handoverModal.cashInput || handoverModal.order.orderAmount}</span>
                      </div>
                      <div className="flex justify-between items-center mb-4">
                        <span className="font-bold text-orange-700">Bill Amount:</span>
                        <span className="font-black text-orange-900 text-xl">₹{handoverModal.order.orderAmount}</span>
                      </div>
                      <div className="flex justify-between items-center pt-4 border-t border-orange-200">
                        <span className="font-black text-orange-600 uppercase tracking-widest">Give Change:</span>
                        <span className="text-4xl font-black text-orange-600 tracking-tighter">₹{handoverModal.change}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-green-50 border border-green-200 p-6 rounded-2xl mb-8 mt-6 shadow-sm">
                       <p className="text-green-800 font-black text-lg mb-1">Online Payment Verified</p>
                       <p className="text-green-600 font-bold text-sm">Order handed over successfully.</p>
                    </div>
                  )}

                  <button onClick={processHandover} className="w-full py-4 bg-gray-900 hover:bg-black text-white font-black rounded-xl text-lg shadow-xl transition-transform transform active:scale-95 cursor-pointer">Close</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ORDER DETAILS MODAL */}
      {selectedOrder && (
        <div className="fixed inset-0 z-[200] bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-300">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden anim-slide-up border border-gray-100">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-xl font-black text-gray-900">Order Details</h2>
              <button onClick={() => setSelectedOrder(null)} className="text-gray-400 hover:text-red-500 font-black cursor-pointer text-xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-red-50 transition-colors">✕</button>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <span className="text-sm font-bold text-gray-500">Token:</span>
                <span className="ml-2 text-2xl font-black text-gray-900">{selectedOrder.orderToken && selectedOrder.orderToken !== 'WAIT' ? selectedOrder.orderToken : selectedOrder.cashfreeOrderId?.slice(-4)}</span>
              </div>
              <div className="space-y-3 mb-6 max-h-60 overflow-y-auto pr-2">
                {selectedOrder.items.map((item, index) => (
                  <div key={index} className="flex justify-between items-center bg-gray-50 p-3 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="bg-gray-200 text-gray-700 font-black w-8 h-8 flex items-center justify-center rounded-lg">{item.quantity}x</span>
                      <span className="font-bold text-gray-800">{item.name}</span>
                    </div>
                    <span className="font-black text-gray-600">₹{item.price * item.quantity}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 pt-4 flex justify-between items-center">
                <span className="font-bold text-gray-500">Total Amount:</span>
                <span className="text-3xl font-black text-gray-900">₹{selectedOrder.orderAmount}</span>
              </div>
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-100">
              <button onClick={() => setSelectedOrder(null)} className="w-full py-3 bg-gray-900 text-white font-black rounded-xl hover:bg-black transition-colors">Close Details</button>
            </div>
          </div>
        </div>
      )}

      <aside className="w-full md:w-72 bg-gray-950 text-white flex flex-col border-r border-gray-900 shadow-2xl z-10 relative">
        <div className="p-8 pb-4">
          <h2 className="text-3xl font-black tracking-tighter text-white mb-6">Store<span className="text-orange-500">Command</span></h2>
          
          <button onClick={toggleShutter} className={`w-full py-3 rounded-xl font-black text-xs uppercase tracking-widest transition shadow-sm border cursor-pointer mb-3 ${storeStatus.isOpen ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20' : 'bg-red-500 text-white border-red-600 animate-pulseSoft'}`}>
            {storeStatus.isOpen ? '🟢 Shop is Open' : '🔴 SHUTTER DOWN'}
          </button>

          {storeStatus.isOpen && !storeStatus.closingWarningActive && (
            <button onClick={triggerClosingWarning} className="w-full py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition shadow-sm border border-yellow-500/20 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 cursor-pointer">
              ⚠️ Trigger 10-Min Warning
            </button>
          )}
          {storeStatus.closingWarningActive && (
             <div className="w-full py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest text-center border border-red-500/50 bg-red-500/20 text-red-400 animate-pulse">
               Closing Warning Active
             </div>
          )}

          {closingError && (
            <div className="mt-3 p-3 bg-red-900/50 border border-red-500/50 rounded-xl text-xs font-bold text-red-200">
              {closingError}
            </div>
          )}
        </div>
        
        <nav className="flex-1 p-6 space-y-3 mt-2">
          <button onClick={() => setActiveView('live')} className={navLinkClass('live')}><span className="flex items-center gap-4 text-lg"><span>⚡</span> Pack Orders</span>{activeOrders.length > 0 && <span className="bg-white text-gray-900 text-xs px-2.5 py-1 rounded-full">{activeOrders.length}</span>}</button>
          <button onClick={() => setActiveView('pos')} className={navLinkClass('pos')}><span className="flex items-center gap-4 text-lg"><span>🏪</span> Quick POS</span></button>
          <button onClick={() => setActiveView('requests')} className={navLinkClass('requests')}><span className="flex items-center gap-4 text-lg"><span>📝</span> Item Requests</span>{customerRequests.length > 0 && <span className="bg-orange-500 text-white text-xs px-2.5 py-1 rounded-full">{customerRequests.length}</span>}</button>
          <button onClick={() => setActiveView('analytics')} className={navLinkClass('analytics')}><span className="flex items-center gap-4 text-lg"><span>📊</span> Analytics</span>{lowStockItems.length > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-1 rounded-full">!</span>}</button>
          <button onClick={() => setActiveView('products')} className={navLinkClass('products')}><span className="flex items-center gap-4 text-lg"><span>📦</span> Catalog</span></button>
          <button onClick={() => setActiveView('history')} className={navLinkClass('history')}><span className="flex items-center gap-4 text-lg"><span>🕰️</span> History</span></button>
        </nav>
        <div className="p-6 border-t border-gray-900 bg-gray-950">
          <button onClick={logout} className="w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-red-400 bg-gray-900 hover:bg-gray-800 py-4 rounded-xl transition-all font-bold cursor-pointer">
            <span>🔴</span> Secure Log Out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-10 h-screen overflow-y-auto relative bg-gray-50/50">
        {/* ACTIVE ORDERS */}
        {activeView === 'live' && (
          <div className="anim-slide-up">
            <div className="flex justify-between items-center mb-10">
              <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">Active Packing Station</h1>
              <div className="flex items-center gap-3">
                <button onClick={toggleAudio} className={`px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-sm cursor-pointer ${audioEnabled ? 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50' : 'bg-red-500 text-white shadow-lg animate-pulseSoft'}`}>
                  {audioEnabled ? '🔊 Sound On' : '🔇 Enable Sound'}
                </button>
                <span className="bg-gray-900 text-white px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-lg"><span className="w-2 h-2 rounded-full bg-green-500"></span> Sync On</span>
              </div>
            </div>
            
            <div className="bg-white rounded-[2rem] shadow-xl shadow-gray-200/40 border border-gray-100 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    <th className="p-6 pl-8">Order Token</th>
                    <th className="p-6">Items</th>
                    <th className="p-6">Amount</th>
                    <th className="p-6">Live Status</th>
                    <th className="p-6 pr-8 text-right">Fulfillment Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeOrders.map((order) => {
                    let displayToken = order.orderToken;
                    if (!displayToken || displayToken === 'WAIT') displayToken = order.cashfreeOrderId.slice(-4);

                    return (
                      <tr key={order.id} className={`transition-colors ${order.orderStatus.includes('cash') || order.paymentType === 'CASH' ? 'bg-orange-50/30 hover:bg-orange-50' : 'hover:bg-gray-50/50'}`}>
                        <td className="p-6 pl-8">
                          <div className="font-black text-gray-900 text-4xl tracking-tighter">{displayToken}</div>
                          <div className="text-xs font-bold text-gray-500 mt-1 flex items-center gap-1">
                            <span>👤</span> {order.customerEmail ? order.customerEmail.split('@')[0].toUpperCase() : 'GUEST'}
                          </div>
                          {order.pickupTime !== 'ASAP' && <span className="text-[10px] font-black bg-purple-100 text-purple-700 px-2 py-1 rounded-md uppercase tracking-widest mt-2 inline-block shadow-sm">⌚ {order.pickupTime}</span>}
                        </td>
                        <td className="p-6 font-bold text-gray-600 text-sm">{order.items.reduce((acc, item) => acc + item.quantity, 0)} Items</td>
                        <td className="p-6 font-black text-gray-900 text-2xl tracking-tighter">₹{safeNumber(order.orderAmount)}</td>
                        <td className="p-6">{getStatusBadge(order)}</td>
                        <td className="p-6 pr-8 text-right flex justify-end gap-3 items-center">
                          <button onClick={() => setSelectedOrder(order)} className="px-5 py-3 bg-white border border-gray-200 text-gray-700 text-sm font-black rounded-xl hover:bg-gray-50 transition shadow-sm cursor-pointer transform hover:-translate-y-0.5" title="View Details">👁️ View</button>
                          <button onClick={() => printLabel(order)} className="px-5 py-3 bg-white border border-gray-200 text-gray-700 text-sm font-black rounded-xl hover:bg-gray-50 transition shadow-sm cursor-pointer transform hover:-translate-y-0.5" title="Print Label">🖨️</button>
                          {(order.orderStatus.toLowerCase() === 'paid' || order.orderStatus.toLowerCase() === 'pending_cash') && 
                            <button onClick={() => updateOrderStatus(order.id, 'packed')} className="px-6 py-3 bg-gray-900 text-white text-sm font-black rounded-xl hover:bg-gray-800 transition shadow-lg cursor-pointer transform hover:-translate-y-0.5">📦 Pack Order</button>}
                          {order.orderStatus.toLowerCase() === 'packed' && 
                            <button onClick={() => updateOrderStatus(order.id, 'ready')} className="px-6 py-3 bg-orange-500 text-white text-sm font-black rounded-xl hover:bg-orange-600 transition shadow-lg shadow-orange-500/30 cursor-pointer">🔔 Call Token</button>}
                          {order.orderStatus.toLowerCase() === 'ready' && 
                            <button onClick={() => startHandover(order)} className="px-6 py-3 bg-green-500 text-white text-sm font-black rounded-xl hover:bg-green-600 transition shadow-lg shadow-green-500/30 cursor-pointer flex items-center gap-2 transform hover:scale-105"><span>🔒</span> VERIFY PIN</button>}
                        </td>
                      </tr>
                    );
                  })}
                  {activeOrders.length === 0 && (<tr><td colSpan="5" className="p-20 text-center text-gray-400 font-bold text-xl">All caught up! No active orders.</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* REQUESTS */}
        {activeView === 'requests' && (
          <div className="anim-slide-up">
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">Customer Item Requests</h1>
            <p className="text-gray-500 font-bold mb-10">This is what people are searching for that you don't have in stock.</p>
            <div className="bg-white rounded-[2rem] shadow-xl shadow-gray-200/40 border border-gray-100 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead><tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest"><th className="p-6 pl-8">Missing Item Name</th><th className="p-6">Requested By</th><th className="p-6">Last Searched</th><th className="p-6 pr-8 text-right">Action</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {customerRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-gray-50/50 transition-colors"><td className="p-6 pl-8 font-black text-gray-900 text-xl">{req.itemName}</td><td className="p-6 font-bold text-orange-600">{req.requestCount} Customers</td><td className="p-6 font-bold text-gray-500">{new Date(req.updatedAt).toLocaleDateString()}</td><td className="p-6 pr-8 text-right"><button onClick={() => clearRequest(req.id)} className="px-5 py-2.5 bg-white border border-gray-200 text-red-500 text-sm font-black rounded-xl shadow-sm hover:bg-red-50 cursor-pointer">Clear Request</button></td></tr>
                  ))}
                  {customerRequests.length === 0 && (<tr><td colSpan="4" className="p-20 text-center text-gray-400 font-bold text-xl">No missing item requests!</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* POS */}
        {activeView === 'pos' && (
          <div className="anim-slide-up">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-4">
              <div><h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">Quick POS (Offline)</h1><p className="text-gray-500 font-bold">Tap [-1] for walk-in sales.</p></div>
              <div className="relative w-full md:w-80"><input type="text" placeholder="Scan or search..." value={posSearchTerm} onChange={(e) => setPosSearchTerm(e.target.value)} className="w-full px-5 py-4 bg-white border border-gray-200 rounded-2xl font-bold focus:ring-2 focus:ring-orange-500 outline-none pl-12 shadow-sm transition-shadow hover:shadow-md" /><span className="absolute left-4 top-4 opacity-50 text-xl">🔍</span></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPosProducts.map(product => (
                <div key={product.id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex items-center justify-between hover:border-orange-200 transition-all hover:shadow-lg transform hover:-translate-y-1">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-gray-50 rounded-2xl overflow-hidden border border-gray-100 flex items-center justify-center p-2">
                      {product.imageUrl ? <img src={product.imageUrl} className="w-full h-full object-contain mix-blend-multiply"/> : <span className="text-xl">📦</span>}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 leading-tight line-clamp-1 text-lg">{product.name}</h3>
                      <p className="text-[10px] font-black text-gray-400 mt-1 uppercase tracking-widest">Stock: <span className="text-gray-900 text-lg ml-1">{product.real_stock ?? product.stock}</span></p>
                    </div>
                  </div>
                  
                  {/* COMPLETED POS QUICK STOCK BUTTONS */}
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => handleQuickStock(product.id, 'decrease')} 
                      disabled={(product.real_stock ?? product.stock) <= 0} 
                      className="w-12 h-10 bg-gray-100 hover:bg-red-100 text-red-600 font-black rounded-xl transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center">
                      -1
                    </button>
                    <button 
                      onClick={() => handleQuickStock(product.id, 'increase')} 
                      className="w-12 h-10 bg-gray-100 hover:bg-green-100 text-green-600 font-black rounded-xl transition-colors cursor-pointer flex items-center justify-center">
                      +1
                    </button>
                  </div>
                </div>
              ))}
              {filteredPosProducts.length === 0 && (
                <div className="col-span-full text-center py-20 text-gray-400 font-bold text-xl">No products found for your search.</div>
              )}
            </div>
          </div>
        )}

        {/* ANALYTICS */}
        {activeView === 'analytics' && (
          <div className="anim-slide-up">
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-8">Store Analytics</h1>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                <p className="text-gray-400 font-black text-[10px] uppercase tracking-widest mb-2">Today's Revenue</p>
                <h3 className="text-5xl font-black text-gray-900 tracking-tighter">₹{todayRevenue}</h3>
              </div>
              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                <p className="text-gray-400 font-black text-[10px] uppercase tracking-widest mb-2">Today's Orders</p>
                <h3 className="text-5xl font-black text-gray-900 tracking-tighter">{todayOrders.length}</h3>
              </div>
              <div className="bg-red-50 p-8 rounded-[2rem] shadow-sm border border-red-100">
                <p className="text-red-400 font-black text-[10px] uppercase tracking-widest mb-2">Low Stock Alerts</p>
                <h3 className="text-5xl font-black text-red-600 tracking-tighter">{lowStockItems.length}</h3>
              </div>
            </div>

            {lowStockItems.length > 0 && (
              <div>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight mb-4 flex items-center gap-2"><span>⚠️</span> Items Needing Restock</h2>
                <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        <th className="p-6 pl-8">Product Name</th>
                        <th className="p-6">Current Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lowStockItems.map(item => (
                        <tr key={item.id}>
                          <td className="p-6 pl-8 font-bold text-gray-900">{item.name}</td>
                          <td className="p-6"><span className="px-3 py-1 bg-red-100 text-red-700 rounded-lg font-black text-sm">{item.real_stock ?? item.stock} left</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PRODUCTS / CATALOG */}
        {activeView === 'products' && (
          <div className="anim-slide-up">
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-8">Catalog Manager</h1>
            <AdminProductManager products={products} fetchProducts={fetchProducts} />
          </div>
        )}

        {/* HISTORY */}
        {activeView === 'history' && (
          <div className="anim-slide-up">
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-8">Order History</h1>
            <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    <th className="p-6 pl-8">Date</th>
                    <th className="p-6">Token/ID</th>
                    <th className="p-6">Amount</th>
                    <th className="p-6">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pastOrders.slice(0, 50).map(order => (
                    <tr key={order.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-6 pl-8 font-bold text-gray-500 text-sm">{new Date(order.createdAt).toLocaleString()}</td>
                      <td className="p-6 font-black text-gray-900">{order.orderToken && order.orderToken !== 'WAIT' ? order.orderToken : order.cashfreeOrderId?.slice(-4)}</td>
                      <td className="p-6 font-black text-gray-900">₹{order.orderAmount}</td>
                      <td className="p-6">{getStatusBadge(order)}</td>
                    </tr>
                  ))}
                  {pastOrders.length === 0 && (<tr><td colSpan="4" className="p-20 text-center text-gray-400 font-bold text-xl">No past orders yet.</td></tr>)}
                </tbody>
              </table>
              {pastOrders.length > 50 && <div className="p-4 text-center text-gray-400 font-bold text-sm bg-gray-50">Showing last 50 orders</div>}
            </div>
          </div>
        )}

      </main>
    </div>
  );
};

export default AdminDashboard;