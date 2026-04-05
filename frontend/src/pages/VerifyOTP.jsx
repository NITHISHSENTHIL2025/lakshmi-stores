import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext'; // 🚨 NEW: Added Auth Context

const VerifyOTP = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth(); // 🚨 NEW: Extract the login function
  
  // Grab the email passed from the Register page, or fallback to local storage
  const email = location.state?.email || localStorage.getItem('pendingVerificationEmail');

  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [timer, setTimer] = useState(60); 

  useEffect(() => {
    if (!email) {
      toast.error('Session expired. Please register again.');
      navigate('/login');
    }

    let interval;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timer, email, navigate]);

  const handleVerify = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) return toast.error('OTP must be exactly 6 digits.');

    setLoading(true);
    try {
      const response = await api.post('/auth/verify-otp', { email, otp });
      
      toast.success('Account Verified! Welcome to Lakshmi Stores.');
      localStorage.removeItem('pendingVerificationEmail');
      
      // 🚨 NEW: Tell React the user is logged in so the Navbar updates instantly!
      login(response.data.user);
      
      // 🚨 FAST SPA REDIRECT: Uses React Router instead of hard reload
      if (response.data.user.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/');
      }
      
    } catch (error) {
      toast.error(error.response?.data?.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (timer > 0) return; 

    setResendLoading(true);
    try {
      const response = await api.post('/auth/resend-otp', { email });
      toast.success(response.data.message || 'New OTP sent!');
      setTimer(60); 
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to resend OTP.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl shadow-gray-200/50 p-8 md:p-12 border border-gray-100 animate-slideUp relative overflow-hidden">
        
        <div className="absolute top-0 right-0 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>

        <div className="text-center mb-8 relative z-10">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center text-4xl mx-auto mb-6 shadow-inner border border-blue-100">
            ✉️
          </div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Verify Email</h1>
          <p className="text-gray-500 font-bold mt-2 text-sm leading-relaxed">
            We sent a 6-digit code to <br/>
            <strong className="text-gray-900">{email}</strong>
          </p>
        </div>

        <form onSubmit={handleVerify} className="space-y-6 relative z-10">
          <div>
            <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 text-center">Enter Verification Code</label>
            <input
              type="text"
              maxLength="6"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))} 
              className="w-full bg-gray-50 text-gray-900 px-6 py-5 rounded-2xl font-black text-4xl text-center tracking-[0.5em] border-2 border-transparent focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
              placeholder="••••••"
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="w-full bg-gray-900 text-white font-black py-4 rounded-2xl hover:bg-black hover:shadow-xl hover:-translate-y-1 transition-all disabled:opacity-50 disabled:hover:transform-none"
          >
            {loading ? 'Verifying...' : 'Verify & Login'}
          </button>
        </form>

        <div className="mt-8 text-center relative z-10 border-t border-gray-100 pt-6 flex flex-col items-center gap-2">
          <p className="text-sm font-bold text-gray-500">Didn't receive the code?</p>
          <button
            type="button"
            onClick={handleResend}
            disabled={timer > 0 || resendLoading}
            className={`text-sm font-black uppercase tracking-widest px-6 py-2 rounded-full transition-colors ${
              timer > 0 
                ? 'text-gray-400 bg-gray-100 cursor-not-allowed' 
                : 'text-blue-600 bg-blue-50 hover:bg-blue-100 cursor-pointer'
            }`}
          >
            {resendLoading ? 'Sending...' : timer > 0 ? `Resend in ${timer}s` : 'Resend Code'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VerifyOTP;