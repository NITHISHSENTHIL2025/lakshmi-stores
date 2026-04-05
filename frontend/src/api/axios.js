import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true, 
});

// 🚨 STATE FOR THE RACE CONDITION FIX
let isRefreshing = false;
let refreshSubscribers = [];

// Function to push waiting requests into the line
const subscribeTokenRefresh = (cb) => {
  refreshSubscribers.push(cb);
};

// Function to tell all waiting requests "Go ahead!"
const onRefreshed = () => {
  refreshSubscribers.forEach((cb) => cb());
  refreshSubscribers = [];
};

api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    if (error.response && error.response.status === 401 && !originalRequest._retry) {
      
      // Guard against infinite loops
      if (
        originalRequest.url?.includes('/auth/login') || 
        originalRequest.url?.includes('/auth/logout') ||
        originalRequest.url?.includes('/auth/refresh')
      ) {
        return Promise.reject(error);
      }

      // 🚨 THE QUEUE SYSTEM
      if (isRefreshing) {
        // If another request is already refreshing the token, wait in line.
        return new Promise((resolve) => {
          subscribeTokenRefresh(() => {
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        console.log('🔄 Access token expired. Attempting silent refresh...');
        
        await api.post('/auth/refresh');
        
        console.log('✅ Silent refresh successful! Retrying original request.');
        
        isRefreshing = false;
        onRefreshed(); // Tell all waiting requests to retry now!
        
        return api(originalRequest);

      } catch (refreshError) {
        console.error('❌ Silent refresh failed. Session is dead.');
        
        isRefreshing = false;
        refreshSubscribers = []; // Clear the queue

        const currentPath = window.location.pathname;
        const isPublicAuthPage = 
          currentPath.startsWith('/login') || 
          currentPath.startsWith('/forgot-password') || 
          currentPath.startsWith('/reset-password') || 
          currentPath.startsWith('/verify');

        if (!isPublicAuthPage) {
          window.location.href = '/login?expired=true';
        }
        
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;