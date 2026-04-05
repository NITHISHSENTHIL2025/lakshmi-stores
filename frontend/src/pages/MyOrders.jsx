import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

const MyOrders = () => {
  const [activeOrders, setActiveOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { 
    fetchActiveOrders(); 
    const interval = setInterval(() => fetchActiveOrders(true), 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchActiveOrders = async (isSilent = false) => {
    try {
      const response = await api.get('/orders/my-orders');
      
      const active = response.data.data.filter(o => ['paid', 'pending_cash', 'packed', 'ready'].includes(o.orderStatus.toLowerCase()));
      setActiveOrders(active);
    } catch (error) { 
      console.error("Failed to fetch orders"); 
    } finally { 
      if (!isSilent) setLoading(false); 
    }
  };

  const getStatusDisplay = (order) => {
    const s = order.orderStatus.toLowerCase();
    
    if (s === 'ready') return { text: 'READY FOR PICKUP!', color: 'bg-green-500 text-white shadow-lg shadow-green-500/30 animate-pulseSoft', icon: '✅' };
    if (s === 'packed') return { text: 'PACKED & WAITING', color: 'bg-blue-500 text-white shadow-lg shadow-blue-500/30', icon: '🛍️' };
    if (s === 'paid') return { text: 'PREPARING ORDER', color: 'bg-yellow-400 text-yellow-900 shadow-lg shadow-yellow-400/30', icon: '⏳' };
    if (s === 'pending_cash') return { text: 'PAY ON DELIVERY', color: 'bg-orange-500 text-white shadow-lg shadow-orange-500/30', icon: '💵' };
    
    return { text: 'PROCESSING', color: 'bg-gray-200 text-gray-700', icon: '🔄' };
  };

  return (
    <div className="bg-gray-50 min-h-screen pb-24">
      <style>{`
        @keyframes popIn { from { opacity: 0; transform: scale(0.95) translateY(20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        .anim-pop { animation: popIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity: 0; }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 mt-4">
        <h2 className="text-4xl font-black text-gray-900 tracking-tight mb-2">Live Orders</h2>
        <p className="text-gray-500 font-bold mb-8">Track your current purchases in real-time.</p>

        {loading ? (
          <div className="flex justify-center py-20"><div className="text-5xl animate-spin">🛒</div></div>
        ) : activeOrders.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-[2rem] border border-gray-200 shadow-sm anim-pop">
            <div className="text-7xl mb-4 opacity-50">📭</div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">No Active Orders</h3>
            <p className="text-gray-500 font-bold mb-6">You don't have any pending pickups right now.</p>
            <button onClick={() => navigate('/')} className="bg-orange-500 text-white px-8 py-4 rounded-2xl font-black shadow-lg hover:bg-orange-600 transition-transform transform hover:-translate-y-1 cursor-pointer">Start Shopping</button>
          </div>
        ) : (
          <div className="space-y-6">
            {activeOrders.map((order, index) => {
              const status = getStatusDisplay(order);
              let safeToken = order.orderToken;
              if (!safeToken || safeToken === 'WAIT') { safeToken = order.cashfreeOrderId ? order.cashfreeOrderId.slice(-4) : '....'; }
              
              // 🚨 AUDIT FIX: Now rendering the TRUE secure database PIN!
              const secretPin = order.pickupPin || '----'; 
              const isCashOrder = order.paymentType === 'CASH' || order.orderStatus === 'pending_cash';

              return (
                <div key={order.id} style={{ animationDelay: `${index * 0.1}s` }} className="bg-white rounded-[2rem] overflow-hidden shadow-xl shadow-gray-200/50 border border-gray-200 anim-pop">
                  
                  <div className={`px-6 py-4 flex items-center justify-between ${status.color}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{status.icon}</span>
                      <span className="font-black tracking-widest text-sm uppercase">{status.text}</span>
                    </div>
                  </div>

                  <div className="p-6 md:p-8 flex flex-col md:flex-row gap-8">
                    <div className="flex-1 border-b md:border-b-0 md:border-r border-dashed border-gray-200 pb-6 md:pb-0 md:pr-8">
                      <div className="mb-6 bg-gray-50 p-6 rounded-2xl border border-gray-100 text-center">
                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Callout Token</p>
                        <h2 className="text-7xl font-black text-gray-900 tracking-tighter drop-shadow-sm">{safeToken}</h2>
                        <p className="text-xs font-bold text-gray-500 mt-2">Listen for this number at the counter.</p>
                      </div>

                      <div className="bg-green-50 rounded-2xl p-5 border border-green-100 flex items-center justify-between shadow-inner">
                        <div>
                          <p className="text-[10px] font-black text-green-800 uppercase tracking-widest mb-1">Secret Pickup PIN</p>
                          <p className="text-3xl font-black text-green-700 tracking-widest">{secretPin}</p>
                        </div>
                        <div className="text-4xl opacity-50">🔒</div>
                      </div>

                      <div className="mt-4 flex justify-center">
                        {isCashOrder ? (
                          <span className="bg-orange-100 text-orange-800 border border-orange-200 px-4 py-2 rounded-xl text-sm font-black uppercase tracking-widest shadow-sm flex items-center gap-2 w-full justify-center">
                            <span>💵</span> Cash on Delivery
                          </span>
                        ) : (
                          <span className="bg-green-100 text-green-800 border border-green-200 px-4 py-2 rounded-xl text-sm font-black uppercase tracking-widest shadow-sm flex items-center gap-2 w-full justify-center">
                            <span>💳</span> Paid Online
                          </span>
                        )}
                      </div>

                      {order.pickupTime !== 'ASAP' && (
                        <p className="mt-4 text-sm font-bold text-purple-700 bg-purple-50 px-4 py-3 rounded-xl border border-purple-100 text-center flex items-center justify-center gap-2">
                          <span>⌚</span> Scheduled Pickup: {order.pickupTime}
                        </p>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col bg-gray-50/50 p-6 rounded-2xl border border-gray-100">
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"><span>🧾</span> Virtual Bill</p>
                      
                      <div className="flex-1 overflow-y-auto max-h-[220px] pr-2 no-scrollbar space-y-4 mb-4">
                        {order.items.map(item => (
                          <div key={item.id} className="flex justify-between items-start text-sm bg-white p-3 rounded-xl shadow-sm border border-gray-50">
                            <div className="flex-1 pr-4">
                              <p className="font-bold text-gray-900 leading-tight">{item.name}</p>
                              <p className="text-xs font-bold text-gray-400 mt-1">{item.quantity} {item.category?.toLowerCase().includes('loose') ? 'kg' : 'pcs'} × ₹{item.price}</p>
                            </div>
                            <p className="font-black text-gray-900 text-lg">₹{item.price * item.quantity}</p>
                          </div>
                        ))}
                      </div>

                      <div className="pt-4 border-t-2 border-dashed border-gray-200 mt-auto">
                        <div className="flex justify-between items-center mb-1 text-sm font-bold text-gray-500">
                          <span>Payment Method</span>
                          <span className={`uppercase font-black ${isCashOrder ? 'text-orange-600' : 'text-green-600'}`}>
                            {isCashOrder ? 'Pay on Delivery' : 'Paid Online'}
                          </span>
                        </div>
                        <div className="flex justify-between items-end">
                          <span className="font-black text-gray-400 uppercase tracking-widest text-xs">Total Amount</span>
                          <span className="text-4xl font-black text-gray-900 tracking-tighter">₹{order.orderAmount}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
export default MyOrders;