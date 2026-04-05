import { useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext'; // 🚨 Import Context

const MyAccount = () => {
  const { user, logout } = useAuth(); // 🚨 Pull user data and logout function securely
  const [pastOrders, setPastOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { 
    fetchMyOrders(); 
  }, []);

  const fetchMyOrders = async () => {
    try {
      // 🚨 FIX: No need to pass headers! Axios sends the secure cookie automatically.
      const response = await api.get('/orders/my-orders');
      const history = response.data.data.filter(o => ['completed', 'cancelled', 'failed'].includes(o.orderStatus.toLowerCase()));
      setPastOrders(history);
    } catch (error) { 
      console.error("Failed to fetch history"); 
    } finally { 
      setLoading(false); 
    }
  };

  const getCustomerBadge = (order) => {
    const s = order.orderStatus.toLowerCase();
    const isCash = order.paymentType === 'CASH' || s === 'pending_cash';

    if (s === 'failed') return <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm">Payment Failed</span>;
    if (s === 'cancelled') return <span className="px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-[10px] font-black uppercase tracking-widest">Cancelled</span>;
    
    // 🚨 EXPLICIT ACCURATE HISTORY BADGES
    return isCash ? 
      <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm border border-orange-200">COD: Picked Up</span> : 
      <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm border border-green-200">Paid: Picked Up</span>;
  };

  // Safe fallback if user data is still loading
  const customerName = user?.name || 'User';
  const customerEmail = user?.email || '';

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-slideUp pb-24 px-4 mt-6">
      
      <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-gray-100 flex items-center gap-6">
        <div className="w-20 h-20 bg-orange-600 text-white rounded-full flex items-center justify-center text-3xl font-black shadow-lg">
          {customerName.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">{customerName}</h1>
          <p className="text-gray-500 font-bold flex items-center gap-1 text-sm md:text-base">📧 {customerEmail}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 animate-slideUp delay-100">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-2"><span>📜</span> Order History</h2>
            <span className="bg-gray-100 text-gray-600 text-xs font-black px-3 py-1 rounded-lg">{pastOrders.length} Orders</span>
          </div>

          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 no-scrollbar">
            {pastOrders.map((order) => {
              // 🚨 SAFE TOKEN FALLBACK
              const safeToken = order.orderToken || (order.cashfreeOrderId ? order.cashfreeOrderId.slice(-4) : '....');
              
              return (
                <div key={order.id} className="p-5 bg-gray-50 border border-gray-100 rounded-2xl hover:border-gray-300 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Token ID</p>
                      <p className="font-black text-gray-900 text-lg tracking-tight">{safeToken}</p>
                    </div>
                    {getCustomerBadge(order)}
                  </div>

                  <div className="flex justify-between items-end mt-4 pt-4 border-t border-dashed border-gray-200">
                    <p className="text-xs font-bold text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</p>
                    <p className="text-xl font-black text-gray-900">₹{order.orderAmount}</p>
                  </div>
                </div>
              );
            })}
            {pastOrders.length === 0 && !loading && <div className="text-center py-10"><p className="text-gray-400 font-bold">No past orders.</p></div>}
            {loading && <div className="text-center py-10"><div className="animate-spin h-8 w-8 border-4 border-orange-600 border-t-transparent rounded-full mx-auto"></div></div>}
          </div>
        </div>

        <div className="space-y-6 animate-slideUp delay-200">
          <div className="bg-gray-900 p-8 rounded-[2rem] shadow-xl text-white transform transition-transform hover:-translate-y-1">
            <h3 className="text-2xl font-black mb-2 flex items-center gap-2"><span>🎧</span> Store Support</h3>
            <p className="text-gray-400 text-sm font-bold mb-6">Issue with a past pickup? Show your token ID at the main counter for assistance.</p>
          </div>
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
            <h3 className="text-lg font-black text-gray-900 mb-4">Account Settings</h3>
            {/* 🚨 Use the Context Logout function! */}
            <button onClick={logout} className="w-full text-left py-4 px-6 bg-red-50 font-black text-red-500 hover:bg-red-100 rounded-xl transition-colors cursor-pointer">
              Secure Log Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyAccount;