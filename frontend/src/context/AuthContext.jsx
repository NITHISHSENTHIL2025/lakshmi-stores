import { createContext, useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import api from "../api/axios";

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkLoggedIn = async () => {
      try {
        // 🚨 No local storage check needed. The browser sends the cookie automatically!
        const response = await api.get('/auth/me');
        setUser(response.data.user); 
      } catch (error) {
        // If it fails, the cookie is missing, expired, or invalid.
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkLoggedIn();
  }, []);

  // 🚨 Login now only updates UI state. Cookies are set by the backend.
  const login = (userData) => {
    setUser(userData);
    if (userData.role === 'admin') {
      navigate('/admin');
    } else {
      navigate('/');
    }
  };

  // 🚨 Logout now hits the backend to destroy the secure cookies
  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.error("Logout error", err);
    } finally {
      setUser(null);
      
      // 1. Destroy the saved cart and local user data
      localStorage.removeItem('lakshmi_cart');
      localStorage.removeItem('customerData');
      
      // 2. Force a HARD browser reload to the login page. 
      // This instantly flushes all React Context states from memory!
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