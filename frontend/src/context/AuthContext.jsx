import { createContext, useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkLoggedIn = async () => {
      // 🚨 CRITICAL: Before asking the backend, check if we even have a token
      const token = localStorage.getItem('accessToken');
      
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const response = await api.get('/auth/me');
        setUser(response.data.user);
      } catch (error) {
        // Prevent "Elevator Cart Wipeout" - Only wipe if backend explicitly says 401/403
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
          setUser(null);
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('lakshmi_cart');
          localStorage.removeItem('customerData');
        } else {
          // Network drop or 500 error - Keep the user state as is (handled by interceptor if needed)
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    };
    checkLoggedIn();
  }, []);

  // 🚨 The login function now accepts tokens and saves them
  const login = (userData, accessToken, refreshToken) => {
    setUser(userData);
    
    // Save tokens and user data securely to LocalStorage
    if (accessToken) localStorage.setItem('accessToken', accessToken);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('customerData', JSON.stringify(userData));

    if (userData.role === 'admin') {
      navigate('/admin');
    } else {
      navigate('/');
    }
  };

  const logout = async () => {
    try {
      // Grab refresh token from storage to send in body
      const refreshToken = localStorage.getItem('refreshToken');
      await api.post('/auth/logout', { refreshToken });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      // 🚨 Wipe everything out
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('lakshmi_cart');
      localStorage.removeItem('customerData');
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, loading }}>
      {!loading ? children : (
        <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin h-10 w-10 border-4 border-orange-600 border-t-transparent rounded-full"></div>
        </div>
      )}
    </AuthContext.Provider>
  );
};