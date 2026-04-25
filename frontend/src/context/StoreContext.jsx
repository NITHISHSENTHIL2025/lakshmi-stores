import { createContext, useState, useEffect, useContext } from 'react';
import { io } from 'socket.io-client';
import api from '../api/axios';

const StoreContext = createContext();

export const useStore = () => useContext(StoreContext);

export const StoreProvider = ({ children }) => {
  const [storeStatus, setStoreStatus] = useState({ isOpen: true, closingWarningActive: false });
  const [statusLoading, setStatusLoading] = useState(true);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await api.get('/store/status');
        setStoreStatus(res.data);
      } catch (e) { 
        console.error('Status fetch failed', e); 
      } finally { 
        setStatusLoading(false); 
      }
    };
    
    fetchStatus();
    // Safely poll every 60 seconds as a backup
    const interval = setInterval(fetchStatus, 60000); 

    // Global Socket Connection
    const socketUrl = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace('/api', '');
    const newSocket = io(socketUrl, { withCredentials: true });
    
    newSocket.on('connect', () => console.log('🟢 StoreContext Socket Connected'));
    setSocket(newSocket);

    return () => {
      clearInterval(interval);
      newSocket.disconnect();
    };
  }, []);

  return (
    <StoreContext.Provider value={{ storeStatus, statusLoading, socket }}>
      {children}
    </StoreContext.Provider>
  );
};