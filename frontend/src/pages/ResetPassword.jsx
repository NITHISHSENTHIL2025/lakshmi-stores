import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';

const ResetPassword = () => {
  const { token } = useParams(); // Automatically grabs the token from the URL
  const navigate = useNavigate();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) return toast.error('Password must be at least 6 characters.');
    if (password !== confirmPassword) return toast.error('Passwords do not match.');

    setLoading(true);
    try {
      const response = await api.put(`/auth/reset-password/${token}`, { password });
      toast.success(response.data.message || 'Password reset successfully!');
      setIsSuccess(true);
      
      // Automatically redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
      
    } catch (error) {
      toast.error(error.response?.data?.message || 'Token is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl shadow-gray-200/50 p-8 md:p-12 border border-gray-100 animate-slideUp relative overflow-hidden">
        
        {/* Background Accent */}
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-green-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>

        <div className="text-center mb-8 relative z-10">
          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center text-4xl mx-auto mb-6 shadow-inner border border-gray-100">
            {isSuccess ? '✅' : '🔑'}
          </div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">
            {isSuccess ? 'Password Reset!' : 'Set New Password'}
          </h1>
          <p className="text-gray-500 font-bold mt-2 text-sm">
            {isSuccess ? 'Redirecting you to login...' : 'Please enter your new secure password below.'}
          </p>
        </div>

        {!isSuccess && (
          <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">New Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-50 text-gray-900 px-6 py-4 rounded-2xl font-bold border-2 border-transparent focus:bg-white focus:border-gray-900 focus:ring-4 focus:ring-gray-900/10 transition-all outline-none"
                placeholder="At least 6 characters"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full bg-gray-50 text-gray-900 px-6 py-4 rounded-2xl font-bold border-2 outline-none transition-all ${
                  confirmPassword && password !== confirmPassword 
                    ? 'border-red-400 focus:ring-4 focus:ring-red-400/20 bg-red-50' 
                    : 'border-transparent focus:bg-white focus:border-gray-900 focus:ring-4 focus:ring-gray-900/10'
                }`}
                placeholder="Re-enter password"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !password || !confirmPassword}
              className="w-full bg-orange-500 text-white font-black py-4 rounded-2xl hover:bg-orange-600 hover:shadow-xl hover:shadow-orange-500/30 hover:-translate-y-1 transition-all disabled:opacity-50 disabled:hover:transform-none mt-4"
            >
              {loading ? 'Securing Account...' : 'Save New Password'}
            </button>
          </form>
        )}

        <div className="mt-8 text-center relative z-10">
          <Link to="/login" className="text-sm font-bold text-gray-400 hover:text-gray-900 transition-colors">
            Cancel and return to Login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;