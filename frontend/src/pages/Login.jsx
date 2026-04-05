import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom'; 
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext'; 

const Login = () => {
  const navigate = useNavigate();
  const { user, login } = useAuth(); 
  const [searchParams] = useSearchParams(); 

  const [view, setView] = useState('login'); 
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', password: '', confirmPassword: ''
  });
  const [otp, setOtp] = useState('');
  const [isValid, setIsValid] = useState(false);
  const [pwdStrength, setPwdStrength] = useState(0);

  // 🚨 Handle "Session Expired" redirect from Axios Interceptor
  useEffect(() => {
    if (searchParams.get('expired')) {
      toast.error('Session expired. Please log in again.');
      window.history.replaceState(null, '', '/login');
    }
  }, [searchParams]);

  // 🚨 SMART REDIRECT LOGIC: The Traffic Cop
  // If a user is detected in Context, instantly route them based on their role
  useEffect(() => {
    if (user && !error) {
      if (user.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/');
      }
    }
  }, [user, error, navigate]);

  useEffect(() => {
    const { name, email, phone, password, confirmPassword } = formData;
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    
    let strength = 0;
    if (password.length > 0) strength = 1;
    if (password.length >= 6) strength = 2;
    if (password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password)) strength = 3;
    setPwdStrength(strength);

    if (view === 'login') {
      setIsValid(emailValid && password.length > 0);
    } else if (view === 'register') {
      const phoneValid = phone.length >= 10;
      const passwordsMatch = password === confirmPassword;
      setIsValid(name && emailValid && phoneValid && strength >= 2 && passwordsMatch);
    } else if (view === 'otp') {
      setIsValid(otp.length === 6);
    }
  }, [formData, view, otp]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError(''); 
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!isValid) return;
    setLoading(true); 
    setError('');

    try {
      if (view === 'login') {
        const response = await api.post('/auth/login', { 
          email: formData.email, 
          password: formData.password 
        });
        
        toast.success(response.data.user.role === 'admin' ? 'Welcome back, Admin!' : 'Login successful!');
        login(response.data.user); // Triggers the useEffect Traffic Cop above
        
      } else if (view === 'register') {
        await api.post('/auth/register', { 
          name: formData.name, email: formData.email, password: formData.password, phone: formData.phone 
        });
        toast.success('Code sent to your email!');
        setView('otp'); 

      } else if (view === 'otp') {
        const response = await api.post('/auth/verify-otp', { 
          email: formData.email, 
          otp 
        });
        
        toast.success('Account verified!');
        login(response.data.user); // Triggers the useEffect Traffic Cop above
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Authentication failed. Check your connection.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const getPwdStrengthColor = () => {
    if (pwdStrength === 1) return 'bg-red-500 w-1/3';
    if (pwdStrength === 2) return 'bg-yellow-500 w-2/3';
    if (pwdStrength === 3) return 'bg-green-500 w-full';
    return 'bg-gray-200 w-0';
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 min-h-[85vh] bg-gray-50">
      <div className="max-w-[400px] w-full bg-white p-8 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 transition-all">
        
        {view !== 'otp' ? (
          <>
            <div className="text-center mb-8">
              <h1 className="text-2xl font-black text-gray-900 tracking-tight mb-1">
                {view === 'login' ? 'Welcome back' : 'Create an account'}
              </h1>
              <p className="text-sm font-medium text-gray-500">
                {view === 'login' ? 'Enter your details to continue.' : 'Join to skip the line.'}
              </p>
            </div>

            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm font-semibold rounded-xl text-center animate-fadeIn">
                {error}
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-4">
              {view === 'register' && (
                <div className="space-y-4 animate-fadeIn">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Full Name</label>
                    <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-gray-900 focus:bg-white outline-none transition-all" placeholder="John Doe" required />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Phone</label>
                    <input type="tel" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-gray-900 focus:bg-white outline-none transition-all" placeholder="10-digit mobile" required />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Email</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-gray-900 focus:bg-white outline-none transition-all" placeholder="name@example.com" required />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1 ml-1">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">Password</label>
                  
                  {view === 'login' && (
                    <Link to="/forgot-password" className="text-xs font-bold text-orange-500 hover:text-orange-600 transition-colors">
                      Forgot Password?
                    </Link>
                  )}
                </div>
                
                <input type="password" name="password" value={formData.password} onChange={handleChange} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-gray-900 focus:bg-white outline-none transition-all" placeholder="••••••••" required />
                
                {view === 'register' && formData.password.length > 0 && (
                  <div className="mt-2 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full transition-all duration-300 ${getPwdStrengthColor()}`}></div>
                  </div>
                )}
              </div>

              {view === 'register' && (
                <div className="animate-fadeIn">
                  <label className="block text-xs font-bold text-gray-700 mb-1 uppercase tracking-wider">Confirm Password</label>
                  <input type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} className={`w-full px-4 py-3 bg-gray-50 border rounded-xl text-sm font-medium focus:ring-2 outline-none transition-all ${formData.confirmPassword && formData.password !== formData.confirmPassword ? 'border-red-300 focus:ring-red-500' : 'border-gray-200 focus:ring-gray-900 focus:bg-white'}`} placeholder="••••••••" required />
                </div>
              )}

              <button 
                type="submit" 
                disabled={!isValid || loading} 
                className="w-full bg-gray-900 hover:bg-black text-white py-3.5 rounded-xl font-bold text-sm shadow-sm transition-all disabled:opacity-50 mt-2 flex justify-center items-center cursor-pointer"
              >
                {loading ? (
                   <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                ) : (
                  view === 'login' ? 'Continue' : 'Create Account'
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button 
                type="button" 
                onClick={() => { setView(view === 'login' ? 'register' : 'login'); setError(''); setFormData({name:'', email:'', phone:'', password:'', confirmPassword:''}); }}
                className="text-sm font-semibold text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
              >
                {view === 'login' ? "Don't have an account? Sign up" : "Already have an account? Log in"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleAuth} className="space-y-4 animate-fadeIn text-center">
            <div className="mb-6">
              <div className="mx-auto bg-orange-50 w-16 h-16 rounded-full flex items-center justify-center mb-4 text-2xl">✉️</div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">Verify Email</h2>
              <p className="text-sm text-gray-500 mt-2">Code sent to <b className="text-gray-900">{formData.email}</b></p>
            </div>

            <input 
              type="text" 
              maxLength="6"
              value={otp} 
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '')); setError(''); }} 
              className="w-full text-center tracking-[1em] font-black text-2xl px-4 py-4 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900 outline-none transition-all" 
              placeholder="••••••" 
            />

            <button type="submit" disabled={!isValid || loading} className="w-full bg-orange-600 hover:bg-orange-700 text-white py-3.5 rounded-xl font-bold text-sm shadow-sm transition-all disabled:opacity-50 flex justify-center items-center cursor-pointer">
              {loading ? 'Verifying...' : 'Verify & Continue'}
            </button>
            
            <button type="button" onClick={() => { setView('login'); setOtp(''); setError(''); }} className="text-sm font-semibold text-gray-500 mt-4 hover:text-gray-900 cursor-pointer">
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;