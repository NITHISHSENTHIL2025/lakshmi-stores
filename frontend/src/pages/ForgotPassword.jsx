import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Please enter your email.');
    
    setLoading(true);
    try {
      const response = await api.post('/auth/forgot-password', { email });
      toast.success(response.data.message || 'Reset link sent!');
      setIsSent(true);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to send reset link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl shadow-gray-200/50 p-8 md:p-12 border border-gray-100 animate-slideUp relative overflow-hidden">
        
        {/* Background Accent */}
        <div className="absolute top-0 right-0 w-40 h-40 bg-orange-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>

        <div className="text-center mb-8 relative z-10">
          <div className="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center text-4xl mx-auto mb-6 shadow-inner border border-orange-100">
            🔐
          </div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Forgot Password?</h1>
          <p className="text-gray-500 font-bold mt-2 text-sm">
            {isSent ? "Check your inbox for the reset link." : "Enter your email to receive a secure reset link."}
          </p>
        </div>

        {!isSent ? (
          <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Account Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-50 text-gray-900 px-6 py-4 rounded-2xl font-bold border-2 border-transparent focus:bg-white focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all outline-none"
                placeholder="name@example.com"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gray-900 text-white font-black py-4 rounded-2xl hover:bg-black hover:shadow-xl hover:-translate-y-1 transition-all disabled:opacity-50 disabled:hover:transform-none"
            >
              {loading ? 'Sending Secure Link...' : 'Send Reset Link'}
            </button>
          </form>
        ) : (
          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-6 text-center animate-fadeIn relative z-10">
            <p className="text-orange-800 font-bold text-sm">
              We've sent a secure link to <strong>{email}</strong>. It will expire in 15 minutes.
            </p>
            <button 
              onClick={() => setIsSent(false)} 
              className="mt-4 text-xs font-black text-orange-600 uppercase tracking-widest hover:text-orange-700 transition-colors"
            >
              Try another email
            </button>
          </div>
        )}

        <div className="mt-10 text-center relative z-10 border-t border-gray-100 pt-6">
          <Link to="/login" className="text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors">
            ← Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;