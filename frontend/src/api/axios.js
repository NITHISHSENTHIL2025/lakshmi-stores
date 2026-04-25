import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true,
});

// ============================================================
// CROSS-TAB TOKEN REFRESH WITH BROADCAST CHANNEL
// ============================================================
let isRefreshing = false;
let refreshSubscribers = [];

// Allow multiple tabs to communicate
const authChannel = new BroadcastChannel('auth_sync_channel');

authChannel.onmessage = (event) => {
  if (event.data === 'token_refreshed') {
    onRefreshed();
  }
};

const subscribeTokenRefresh = (cb) => refreshSubscribers.push(cb);

const onRefreshed = () => {
  refreshSubscribers.forEach((cb) => cb());
  refreshSubscribers = [];
  isRefreshing = false;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      const skipUrls = ['/auth/login', '/auth/logout', '/auth/refresh', '/auth/register'];
      if (skipUrls.some((url) => originalRequest.url?.includes(url))) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh(() => resolve(api(originalRequest)));
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await api.post('/auth/refresh');
        
        // 🚨 PRODUCTION FIX: Tell other open tabs that the token is fresh!
        authChannel.postMessage('token_refreshed'); 
        onRefreshed();
        
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshSubscribers = [];

        // Clean up session
        localStorage.removeItem('lakshmi_cart');
        localStorage.removeItem('customerData');

        const publicPaths = ['/login', '/forgot-password', '/reset-password', '/verify'];
        const isPublic = publicPaths.some((p) => window.location.pathname.startsWith(p));

        if (!isPublic) {
          window.location.href = '/login?expired=true';
        }

        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;