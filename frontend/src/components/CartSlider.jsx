import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext'; 
import { load } from '@cashfreepayments/cashfree-js';
import { useState, useEffect } from 'react';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';

const CartSlider = () => {
  const { isCartOpen, setIsCartOpen, cartItems, updateQuantity, removeFromCart, cartTotal, clearCart } = useCart();
  const { user } = useAuth(); 
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [paymentMethod, setPaymentMethod] = useState('online'); 
  const [pickupTime, setPickupTime] = useState('ASAP');
  const [specificTime, setSpecificTime] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  
  const [isSuccess, setIsSuccess] = useState(false);
  const [isShopOpen, setIsShopOpen] = useState(true);
  
  const navigate = useNavigate();

  // 🚨 FINAL AUDIT FIX: Calculate dynamic minimum time (Right Now)
  const now = new Date();
  const currentHours = now.getHours().toString().padStart(2, '0');
  const currentMinutes = now.getMinutes().toString().padStart(2, '0');
  const dynamicMinTime = `${currentHours}:${currentMinutes}`;

  useEffect(() => {
    if (isCartOpen) {
      api.get('/store/status').then(res => setIsShopOpen(res.data.isOpen)).catch(()=>setIsShopOpen(true));
    }
  }, [isCartOpen]);

  const handleCheckout = async () => {
    if (cartItems.length === 0 || !isShopOpen) return;
    setError(null);
    
    if (pickupTime === 'LATER' && !specificTime) {
      setError("Please select a specific time for pickup.");
      return;
    }

    if (!user) { 
      setIsCartOpen(false); 
      navigate('/login'); 
      return; 
    }

    setLoading(true);

    const userId = user.id;
    const safeEmail = user.email || 'guest@lakshmistores.com';
    const safePhone = user.phone || '9999999999';
    const finalPickupTime = pickupTime === 'LATER' ? specificTime : 'ASAP';

    try {
      const response = await api.post('/payment/create-order', {
        orderAmount: cartTotal,
        customerEmail: safeEmail,
        customerPhone: safePhone,
        userId: userId,
        items: cartItems.map(item => ({
          id: item.id, name: item.name, price: item.price, quantity: item.quantity, category: item.category
        })),
        totalAmount: cartTotal,
        paymentMethod: paymentMethod, 
        pickupTime: finalPickupTime,
        customerNote: customerNote
      });

      if (response.data.isCash) {
        setIsSuccess(true);
        clearCart();
        setTimeout(() => {
          setIsSuccess(false);
          setIsCartOpen(false);
          navigate('/orders'); 
          setLoading(false);
        }, 2000);
        return;
      }

      if (response.data.success) {
        const cashfreeMode = import.meta.env.VITE_CASHFREE_MODE || "sandbox";
        const cashfree = await load({ mode: cashfreeMode }); 
        
        cashfree.checkout({ paymentSessionId: response.data.payment_session_id, redirectTarget: "_self" });
        setIsCartOpen(false); 
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Checkout failed. Please try again.');
      setLoading(false);
    }
  };

  if (!isCartOpen) return null;

  if (isSuccess) {
    return (
      <>
        <div className="fixed inset-0 bg-gray-900/80 backdrop-blur-md z-[10000] transition-opacity" />
        <div className="fixed inset-y-0 right-0 w-full md:w-[450px] bg-white shadow-2xl z-[10000] flex flex-col items-center justify-center p-8 text-center border-l border-gray-100">
          <div className="w-32 h-32 bg-green-500 text-white rounded-full flex items-center justify-center text-7xl mb-8 shadow-xl shadow-green-500/40">✓</div>
          <h2 className="text-4xl font-black text-gray-900 mb-2 tracking-tight">Confirmed!</h2>
          <p className="text-gray-500 font-bold mb-8 text-lg">Generating your pickup token...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[10000] transition-opacity" onClick={() => setIsCartOpen(false)} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[450px] bg-white shadow-2xl z-[10000] flex flex-col border-l border-gray-100">
        
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white z-10">
          <h2 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2"><span>🛒</span> Your Cart</h2>
          <button onClick={() => setIsCartOpen(false)} className="w-10 h-10 bg-gray-50 text-gray-600 rounded-full hover:bg-gray-200 hover:text-red-500 transition-colors flex items-center justify-center font-bold text-xl cursor-pointer">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
          {cartItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4"><div className="text-7xl opacity-50">🛍️</div><p className="font-bold text-lg">Your cart is empty</p><button onClick={() => setIsCartOpen(false)} className="px-6 py-3 bg-white border border-gray-200 rounded-xl text-gray-900 font-bold hover:border-orange-500 transition cursor-pointer shadow-sm">Start Shopping</button></div>
          ) : (
            cartItems.map((item) => {
              const isLoose = item.category?.toLowerCase().includes('loose');
              const stepAmount = isLoose ? 0.25 : 1;
              const maxLimit = item.maxStock || 99;

              return (
                <div key={item.id} className="flex gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100 relative">
                  <div className="w-20 h-20 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-center overflow-hidden p-2">
                    {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-contain mix-blend-multiply" /> : <span className="text-3xl">📦</span>}
                  </div>
                  <div className="flex-1 flex flex-col justify-between py-1">
                    <div>
                      <h3 className="font-bold text-gray-900 leading-tight line-clamp-1 pr-6 text-sm">{item.name}</h3>
                      <p className="font-black text-gray-900 mt-1">₹{item.price}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center bg-gray-100 rounded-lg overflow-hidden h-8 border border-gray-200">
                        <button onClick={() => item.quantity <= stepAmount ? removeFromCart(item.id) : updateQuantity(item.id, item.quantity - stepAmount)} className="w-8 flex items-center justify-center font-black text-gray-600 hover:bg-gray-200 hover:text-red-500 transition cursor-pointer">−</button>
                        <span className="w-10 flex items-center justify-center font-black text-xs bg-white h-full">{item.quantity}{isLoose && 'kg'}</span>
                        <button onClick={() => updateQuantity(item.id, item.quantity + stepAmount)} disabled={item.quantity >= maxLimit} className="w-8 flex items-center justify-center font-black text-gray-600 hover:bg-gray-200 hover:text-green-600 transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">+</button>
                      </div>
                      <button onClick={() => removeFromCart(item.id)} className="text-xs font-bold text-gray-400 hover:text-red-500 transition underline decoration-dotted cursor-pointer">Remove</button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {cartItems.length > 0 && (
          <div className="bg-white border-t border-gray-100 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-10">
            {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm font-bold rounded-xl border border-red-100 flex items-center gap-2"><span>⚠️</span> {error}</div>}

            <div className="space-y-4 mb-6">
              <div className="bg-gray-50 p-1 rounded-xl flex flex-col font-bold text-sm">
                <div className="flex">
                  <button onClick={() => setPickupTime('ASAP')} className={`flex-1 py-3 rounded-lg transition-colors cursor-pointer ${pickupTime === 'ASAP' ? 'bg-white shadow-sm text-orange-600 border border-orange-100' : 'text-gray-500 hover:text-gray-900'}`}>🏃 ASAP Pickup</button>
                  <button onClick={() => setPickupTime('LATER')} className={`flex-1 py-3 rounded-lg transition-colors cursor-pointer ${pickupTime === 'LATER' ? 'bg-white shadow-sm text-orange-600 border border-orange-100' : 'text-gray-500 hover:text-gray-900'}`}>🕒 Pick up Later</button>
                </div>
                {pickupTime === 'LATER' && (
                  <div className="mt-2 p-2 bg-white rounded-lg border border-orange-100 flex items-center gap-2">
                    <span className="text-gray-400 text-xs uppercase tracking-widest pl-2">Select Time:</span>
                    <input 
                      type="time" 
                      value={specificTime} 
                      onChange={(e) => setSpecificTime(e.target.value)} 
                      
                      // 🚨 FINAL AUDIT FIX: Restricts users from picking a time in the past
                      min={dynamicMinTime}
                      max="22:00" 
                      
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-md p-2 outline-none focus:border-orange-500 text-gray-900" 
                    />
                  </div>
                )}
              </div>

              <textarea placeholder="Special instructions? (e.g., Pack in cloth bag)" value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm font-bold text-gray-900 outline-none focus:border-orange-500 focus:bg-white transition-colors resize-none h-16 shadow-inner" />

              <div className="grid grid-cols-2 gap-2">
                <div onClick={() => setPaymentMethod('online')} className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${paymentMethod === 'online' ? 'border-green-500 bg-green-50 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
                  <span className="block text-2xl mb-1">💳</span><span className={`text-xs font-black uppercase ${paymentMethod === 'online' ? 'text-green-700' : 'text-gray-500'}`}>Pay Online</span>
                </div>
                <div onClick={() => setPaymentMethod('cash')} className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${paymentMethod === 'cash' ? 'border-orange-500 bg-orange-50 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
                  <span className="block text-2xl mb-1">💵</span><span className={`text-xs font-black uppercase ${paymentMethod === 'cash' ? 'text-orange-700' : 'text-gray-500'}`}>Pay at Counter</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-end mb-6 bg-gray-50 p-4 rounded-xl border border-gray-200">
              <span className="text-gray-500 font-bold uppercase tracking-widest text-xs">Total Due</span>
              <span className="text-4xl font-black text-gray-900 tracking-tighter">₹{cartTotal}</span>
            </div>

            <button onClick={handleCheckout} disabled={loading || !isShopOpen} className={`w-full text-white py-4 rounded-2xl font-black text-xl transition-all flex justify-center items-center gap-2 ${!isShopOpen ? 'bg-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 shadow-xl shadow-orange-500/30 transform hover:scale-[1.02] active:scale-95 cursor-pointer'}`}>
              {loading ? <span className="animate-spin">⏳</span> : !isShopOpen ? <span>Shop is Closed</span> : <span>{paymentMethod === 'online' ? 'Pay Securely' : 'Place Order'} ➔</span>}
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default CartSlider;