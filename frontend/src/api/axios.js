import axios from 'axios';

const api = axios.create({
  // 🚨 Dynamic URL: Looks for a .env file first, falls back to localhost
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true, // Required for sending HttpOnly secure cookies
});

// ==========================================
// 🛡️ THE SILENT REFRESH INTERCEPTOR
// ==========================================
api.interceptors.response.use(
  (response) => {
    // Any status code within the range of 2xx triggers this function
    // Just pass the good response down to the component
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // If the error is 401 (Unauthorized) AND we haven't already tried to retry it
    if (error.response && error.response.status === 401 && !originalRequest._retry) {
      
      // Mark that we are retrying so we don't get stuck in an infinite loop!
      originalRequest._retry = true;

      // 🚨 CRITICAL GUARD: Do NOT intercept requests to login, logout, OR REFRESH.
      // If the refresh route itself throws a 401, we want it to fail so we can log the user out.
      if (
        originalRequest.url?.includes('/auth/login') || 
        originalRequest.url?.includes('/auth/logout') ||
        originalRequest.url?.includes('/auth/refresh') // 🚨 THIS LINE STOPS THE INFINITE LOOP
      ) {
        return Promise.reject(error);
      }

      try {
        console.log('🔄 Access token expired. Attempting silent refresh...');
        
        // 1. Silently hit our new secure rotation endpoint
        await api.post('/auth/refresh');
        
        console.log('✅ Silent refresh successful! Retrying original request.');
        
        // 2. The backend just gave us a fresh 15-minute Access Cookie. 
        // Let's retry the exact API request that failed milliseconds ago.
        return api(originalRequest);

      } catch (refreshError) {
        // 🚨 THE REFRESH FAILED! 
        // This means the 7-day token expired, the user logged out elsewhere, or the DB hash didn't match.
        console.error('❌ Silent refresh failed. Session is dead.');
        
        // 🚨 NEW FIX: Don't kick the user if they are on a public Auth page!
        const currentPath = window.location.pathname;
        const isPublicAuthPage = 
          currentPath.startsWith('/login') || 
          currentPath.startsWith('/forgot-password') || 
          currentPath.startsWith('/reset-password') || 
          currentPath.startsWith('/verify');

        // Only redirect to login if they are on a protected page
        if (!isPublicAuthPage) {
          window.location.href = '/login?expired=true';
        }
        
        return Promise.reject(refreshError);
      }
    }

    // If it's a normal error (like 400 Bad Request or 404 Not Found), just pass it back
    return Promise.reject(error);
  }
);

export default api;