import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useCart } from '../context/CartContext';

const PaymentStatus = () => {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('order_id');
  const navigate = useNavigate();
  const { clearCart } = useCart();
  const [status, setStatus] = useState('verifying'); 

  useEffect(() => {
    if (orderId) {
      verifyPayment();
    } else {
      setStatus('failed');
    }
  }, [orderId]);

  const verifyPayment = async () => {
    try {
      const response = await api.post('/payment/verify', { order_id: orderId });
      
      if (response.data.success) {
        setStatus('success');
        clearCart(); 
        // 🚨 FIXED: Now explicitly routes to Live Orders!
        setTimeout(() => navigate('/orders'), 3000);
      } else {
        setStatus('failed');
      }
    } catch (error) {
      console.error('Verification failed', error);
      setStatus('failed');
    }
  };

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 md:p-12 rounded-[2rem] shadow-xl border border-gray-100 max-w-md w-full text-center animate-fadeIn">
        
        {status === 'verifying' && (
          <div className="space-y-4">
            <div className="w-16 h-16 border-4 border-orange-200 border-t-orange-600 rounded-full animate-spin mx-auto"></div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">Verifying Payment...</h2>
            <p className="text-gray-500 font-bold">Please don't close this window.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4 animate-slideInRight">
            <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-5xl mx-auto shadow-inner">
              ✓
            </div>
            <h2 className="text-3xl font-black text-gray-900 tracking-tight">Payment Successful!</h2>
            <p className="text-gray-500 font-bold">Your token is ready. Redirecting to live tracking...</p>
          </div>
        )}

        {status === 'failed' && (
          <div className="space-y-4 animate-slideInRight">
            <div className="w-24 h-24 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-5xl mx-auto shadow-inner">
              ✕
            </div>
            <h2 className="text-3xl font-black text-gray-900 tracking-tight">Payment Failed</h2>
            <p className="text-gray-500 font-bold mb-6">Something went wrong with the transaction.</p>
            <button onClick={() => navigate('/')} className="w-full bg-gray-900 hover:bg-black text-white py-4 rounded-xl font-black text-lg transition cursor-pointer">
              Return to Store
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default PaymentStatus;