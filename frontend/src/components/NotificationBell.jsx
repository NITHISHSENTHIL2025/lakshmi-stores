import React, { useState, useEffect } from 'react';
// Make sure to run: npm install lucide-react (if you haven't already)
import { Bell } from 'lucide-react'; 
import axios from 'axios';

const NotificationBell = () => {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const fetchNotifs = async () => {
      try {
        const { data } = await axios.get('https://lakshmi-stores-api.onrender.com/api/notifications/mine', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        setNotifications(data.data);
      } catch (err) { console.error("Could not fetch notifications"); }
    };
    // Only fetch if logged in
    if (localStorage.getItem('token')) {
      fetchNotifs();
    }
  }, []);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const handleRead = async (id) => {
    // 1. Optimistic UI update (feels instantly fast to the user)
    setNotifications(notifications.map(n => n.id === id ? { ...n, isRead: true } : n));
    
    // 2. Tell the backend silently
    try {
      await axios.put(`https://lakshmi-stores-api.onrender.com/api/notifications/${id}/read`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
    } catch (error) {
      console.error("Failed to mark read");
    }
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="relative p-2 rounded-full hover:bg-gray-100 transition flex items-center justify-center"
      >
        <Bell className="w-6 h-6 text-gray-700" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-[320px] bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-gray-100 overflow-hidden z-[100]">
          <div className="p-4 border-b border-gray-100 bg-gray-50/80 flex justify-between items-center">
            <span className="font-extrabold text-gray-900">Notifications</span>
          </div>
          
          <div className="max-h-[350px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-400 font-medium text-sm">
                You have no new alerts.
              </div>
            ) : (
              notifications.map((n) => (
                <div 
                  key={n.id} 
                  onClick={() => handleRead(n.id)}
                  className={`p-4 border-b border-gray-50 cursor-pointer transition ${!n.isRead ? 'bg-orange-50/50 hover:bg-orange-50' : 'hover:bg-gray-50'}`}
                >
                  <h4 className={`text-sm tracking-wide ${!n.isRead ? 'font-bold text-gray-900' : 'font-semibold text-gray-600'}`}>
                    {n.title}
                  </h4>
                  <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{n.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;