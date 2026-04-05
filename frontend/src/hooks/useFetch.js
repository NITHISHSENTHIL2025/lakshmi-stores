import { useState, useEffect } from 'react';
import api from '../api/axios'; // Your shiny new interceptor!

const useFetch = (url, dependencies = []) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // 1. Create the Abort Controller
    const controller = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      try {
        // 2. Pass the abort signal to Axios
        const response = await api.get(url, { signal: controller.signal });
        setData(response.data.data || response.data);
        setError(null);
      } catch (err) {
        // 3. Ignore the error if we intentionally cancelled it
        if (err.name === 'CanceledError' || err.message === 'canceled') {
          console.log(`🛑 API Request Aborted: ${url}`);
        } else {
          setError(err.response?.data?.message || 'Something went wrong');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // 4. THE MAGIC CLEANUP: If the component dies, kill the request instantly
    return () => {
      controller.abort();
    };
    
  // Re-run if the URL or custom dependencies change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...dependencies]); 

  return { data, loading, error, setData };
};

export default useFetch;