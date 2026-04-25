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
      try {
        const response = await api.get('/auth/me');
        setUser(response.data.user);
      } catch (error) {
        // 🚨 PRODUCTION FIX: Prevent "Elevator Cart Wipeout"
        // Only destroy the cart and session if the backend explicitly says "Unauthorized"
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
          setUser(null);
          localStorage.removeItem('lakshmi_cart');
          localStorage.removeItem('customerData');
        } else {
          // It was just a network drop or server 500 error. Don't wipe the cart!
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    };
    checkLoggedIn();
  }, []);

  const login = (userData) => {
    setUser(userData);
    if (userData.role === 'admin') {
      navigate('/admin');
    } else {
      navigate('/');
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
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